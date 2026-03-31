// ─── Main Entry Point ──────────────────────────────────────────
// Full service wiring: DB → services → engine → scheduler → server.
// Graceful shutdown tears down in reverse order.

import { logger } from './logger.js';
import { loadConfig } from './config/index.js';
import { Database } from './services/Database.js';
import { createDatabaseFactory } from './services/DatabaseFactory.js';
import { createStrategyService } from './services/StrategyService.js';
import { createRunService } from './services/RunService.js';
import { createAuditService } from './services/AuditService.js';
import { createTravelBalanceService } from './services/TravelBalanceService.js';
import { createGiftCardService } from './services/GiftCardService.js';
import { createExecutionPolicy } from './engine/ExecutionPolicy.js';
import { createPipelineEngine } from './engine/PipelineEngine.js';
import { createRunLock } from './engine/RunLock.js';
import { createSchedulerService } from './services/SchedulerService.js';
import { createBagsClient } from './clients/BagsClient.js';
import { createHeliusClient } from './clients/HeliusClient.js';
import { createTravelSwapClient } from './clients/TravelSwapClient.js';
import { createDuffelClient } from './clients/DuffelClient.js';
import { createBookingService } from './services/BookingService.js';
import { wrapWithResilience } from './clients/ResilientClientWrapper.js';
import { buildApp, startServer } from './server.js';
import type { FastifyInstance } from 'fastify';
import type { CircuitBreaker } from './utils/resilience.js';

const log = logger.child({ component: 'main' });

async function main(): Promise<void> {
  log.info('Starting FlightBrain...');

  // ── Load configuration ──
  const config = loadConfig();

  // ── Database ──
  const dbFactory = createDatabaseFactory({
    databaseUrl: config.databaseUrl,
    databasePath: config.databasePath,
  });
  const dbHandle = await dbFactory.connect();
  const conn = dbHandle.conn;
  await dbFactory.runMigrations(dbHandle);
  log.info({ dialect: dbHandle.dialectName }, 'Database connected and migrations applied');

  // ── Services ──
  const strategyService = createStrategyService(conn);
  const runService = createRunService(conn);
  const auditService = createAuditService(conn);
  const travelBalanceService = createTravelBalanceService(conn);
  const giftCardService = createGiftCardService(conn);

  // ── Clients ──
  const rawBags = createBagsClient({
    apiKey: config.bagsApiKey,
    rpcUrl: config.heliusRpcUrl,
  });
  const rawHelius = createHeliusClient({
    apiKey: config.heliusApiKey,
    rpcUrl: config.heliusRpcUrl,
  });
  const travelSwapClient = createTravelSwapClient(config.travelswapPartnerRef);

  // ── Duffel (optional — only created when API token is configured) ──
  const rawDuffelClient = config.duffelApiToken
    ? createDuffelClient({ apiToken: config.duffelApiToken })
    : undefined;
  if (rawDuffelClient) {
    log.info('DuffelClient created — flight search enabled');
  } else {
    log.info('DuffelClient skipped — DUFFEL_API_TOKEN not set');
  }

  // ── Resilience Wrappers ──
  const circuitBreakers: Record<string, CircuitBreaker> = {};

  const { client: bags, circuitBreaker: bagsCb } = wrapWithResilience('bags', rawBags);
  circuitBreakers.bags = bagsCb;

  const { client: helius, circuitBreaker: heliusCb } = wrapWithResilience('helius', rawHelius);
  circuitBreakers.helius = heliusCb;

  let duffelClient = rawDuffelClient;
  if (rawDuffelClient) {
    const { client: resilientDuffel, circuitBreaker: duffelCb } = wrapWithResilience('duffel', rawDuffelClient);
    duffelClient = resilientDuffel;
    circuitBreakers.duffel = duffelCb;
  }

  log.info(
    { dependencies: Object.keys(circuitBreakers) },
    'Resilience wrappers applied to external clients',
  );

  // ── BookingService (depends on encryption key) ──
  const bookingService = createBookingService(conn, config.giftCardEncryptionKey);

  // ── Engine ──
  const executionPolicy = createExecutionPolicy(config, conn);
  const pipelineEngine = createPipelineEngine({
    runService,
    strategyService,
    auditService,
    executionPolicy,
    bags,
    config,
    helius,
    travelBalanceService,
    giftCardService,
    travelSwapClient,
    circuitBreakers,
  });

  // ── Scheduler ──
  const runLock = createRunLock();
  const scheduler = createSchedulerService({
    strategyService,
    pipelineEngine,
    executionPolicy,
    runLock,
  });

  // ── Server ──
  const app = await buildApp({
    strategyService,
    runService,
    travelBalanceService,
    giftCardService,
    pipelineEngine,
    runLock,
    db: conn,
    config,
    duffelClient,
    bookingService,
    circuitBreakers,
  });

  // ── Graceful Shutdown ──
  let shuttingDown = false;
  function shutdown(signal: string): void {
    if (shuttingDown) return;
    shuttingDown = true;

    log.info({ signal }, 'Graceful shutdown initiated');

    // Reverse order: scheduler → server → database
    try {
      scheduler.stop();
      log.info('Scheduler stopped');
    } catch (err) {
      log.error({ err }, 'Error stopping scheduler');
    }

    app
      .close()
      .then(() => {
        log.info('Server closed');
        try {
          const closeResult = dbHandle.close();
          if (closeResult && typeof (closeResult as Promise<void>).then === 'function') {
            (closeResult as Promise<void>).then(() => {
              log.info('Database closed');
              process.exit(0);
            }).catch((err) => {
              log.error({ err }, 'Error closing database');
              process.exit(1);
            });
          } else {
            log.info('Database closed');
            process.exit(0);
          }
        } catch (err) {
          log.error({ err }, 'Error closing database');
          process.exit(1);
        }
      })
      .catch((err) => {
        log.error({ err }, 'Error closing server');
        process.exit(1);
      });
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // ── Start ──
  await startServer(app, config.port);
  scheduler.start();
  log.info({ port: config.port, env: config.nodeEnv }, 'FlightBrain ready');
}

// ── Top-Level Error Handler ──
main().catch((err) => {
  log.fatal({ err }, 'Fatal startup error');
  process.exit(1);
});
