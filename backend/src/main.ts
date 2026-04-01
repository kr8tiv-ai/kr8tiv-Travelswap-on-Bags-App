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
import { createCoinVoyageClient } from './clients/CoinVoyageClient.js';
import { createBitrefillClient } from './clients/BitrefillClient.js';
import { createNftMintClient } from './clients/NftMintClient.js';
import { createBookingService } from './services/BookingService.js';
import { createTravelPassService } from './services/TravelPassService.js';
import { createTransactionSender } from './utils/solana.js';
import { wrapWithResilience } from './clients/ResilientClientWrapper.js';
import { buildApp, startServer } from './server.js';
import type { FastifyInstance } from 'fastify';
import type { CircuitBreaker } from './utils/resilience.js';

const log = logger.child({ component: 'main' });

async function main(): Promise<void> {
  log.info('Starting TravelSwap...');

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

  // ── CoinVoyage (optional — only created when API key + secret are configured) ──
  const rawCoinVoyageClient = config.coinVoyageApiKey && config.coinVoyageApiSecret
    ? createCoinVoyageClient({
        apiKey: config.coinVoyageApiKey,
        apiSecret: config.coinVoyageApiSecret,
      })
    : undefined;
  if (rawCoinVoyageClient) {
    log.info('CoinVoyageClient created — autonomous gift card purchase enabled');
  } else {
    log.info('CoinVoyageClient skipped — COINVOYAGE_API_KEY or COINVOYAGE_API_SECRET not set');
  }

  // ── Bitrefill (optional — fallback gift card provider with balance payment) ──
  const rawBitrefillClient = config.bitrefillApiKey
    ? createBitrefillClient({ apiKey: config.bitrefillApiKey })
    : undefined;
  if (rawBitrefillClient) {
    log.info('BitrefillClient created — balance-payment gift card fallback enabled');
  } else {
    log.info('BitrefillClient skipped — BITREFILL_API_KEY not set');
  }

  // ── NftMintClient (optional — only created when NFT minting is enabled and configured) ──
  const rawNftMintClient = config.nftMintEnabled && config.nftMintingKeypairPath && config.nftTreeAddress
    ? createNftMintClient(config)
    : undefined;
  if (rawNftMintClient) {
    log.info('NftMintClient created — cNFT travel pass minting enabled');
  } else if (config.nftMintEnabled) {
    log.warn('NFT minting enabled but missing keypair/tree config — NftMintClient skipped');
  } else {
    log.info('NftMintClient skipped — NFT_MINT_ENABLED not set');
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

  let coinVoyageClient = rawCoinVoyageClient;
  if (rawCoinVoyageClient) {
    const { client: resilientCoinVoyage, circuitBreaker: coinVoyageCb } = wrapWithResilience('coinvoyage', rawCoinVoyageClient);
    coinVoyageClient = resilientCoinVoyage;
    circuitBreakers.coinvoyage = coinVoyageCb;
  }

  let bitrefillClient = rawBitrefillClient;
  if (rawBitrefillClient) {
    const { client: resilientBitrefill, circuitBreaker: bitrefillCb } = wrapWithResilience('bitrefill', rawBitrefillClient);
    bitrefillClient = resilientBitrefill;
    circuitBreakers.bitrefill = bitrefillCb;
  }

  let nftMintClient = rawNftMintClient;
  if (rawNftMintClient) {
    const { client: resilientNft, circuitBreaker: nftCb } = wrapWithResilience('nftMint', rawNftMintClient);
    nftMintClient = resilientNft;
    circuitBreakers.nftMint = nftCb;
  }

  log.info(
    { dependencies: Object.keys(circuitBreakers) },
    'Resilience wrappers applied to external clients',
  );

  // ── BookingService (depends on encryption key) ──
  const bookingService = createBookingService(conn, config.giftCardEncryptionKey);

  // ── TravelPassService (NFT travel pass tracking) ──
  const travelPassService = createTravelPassService(conn);

  // ── TransactionSender (Solana tx signing) ──
  const transactionSender = config.signerPrivateKey
    ? createTransactionSender({
        rpcUrl: config.heliusRpcUrl,
        signerPrivateKey: config.signerPrivateKey,
        commitment: 'confirmed',
      })
    : undefined;

  if (transactionSender) {
    log.info('TransactionSender created — on-chain signing enabled');
  } else if (config.dryRun) {
    log.info('TransactionSender skipped — dry-run mode active');
  } else {
    log.warn('TransactionSender skipped — SIGNER_PRIVATE_KEY not set (transactions will not be signed)');
  }

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
    coinVoyageClient,
    bitrefillClient,
    nftMintClient,
    travelPassService,
    transactionSender,
    circuitBreakers,
  });

  // ── Scheduler ──
  const runLock = createRunLock();
  const scheduler = createSchedulerService({
    strategyService,
    runService,
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
    coinVoyageClient,
    travelPassService,
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
  log.info({ port: config.port, env: config.nodeEnv }, 'TravelSwap ready');
}

// ── Top-Level Error Handler ──
main().catch((err) => {
  log.fatal({ err }, 'Fatal startup error');
  process.exit(1);
});
