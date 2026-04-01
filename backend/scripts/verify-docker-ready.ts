#!/usr/bin/env npx tsx
// ─── Docker-Ready Startup Verification ────────────────────────
// Proves the full startup path works end-to-end:
//   config → DB → migrations → server → health → API
//
// Runs against SQLite (no Docker/PG needed). The PostgreSQL path
// shares config loading, migration runner, health, and routes —
// only the adapter differs (covered by PostgresConnection tests).
//
// Usage:  npx tsx backend/scripts/verify-docker-ready.ts

import { setTimeout as sleep } from 'node:timers/promises';

// ── Set required env vars BEFORE any app imports ──────────────
// These mirror .env.docker values so the script is self-contained.
process.env.BAGS_API_KEY = 'verify-docker-ready';
process.env.HELIUS_API_KEY = 'verify-docker-ready';
process.env.API_AUTH_TOKEN = 'verify-docker-ready-token';
process.env.GIFT_CARD_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.DRY_RUN = 'true';
process.env.EXECUTION_KILL_SWITCH = 'false';
process.env.DATABASE_PATH = ':memory:';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'warn';
process.env.PORT = '0'; // let OS pick a free port

// ── Imports (after env setup) ─────────────────────────────────
import { loadConfig } from '../src/config/index.js';
import { createDatabaseFactory } from '../src/services/DatabaseFactory.js';
import { createStrategyService } from '../src/services/StrategyService.js';
import { createRunService } from '../src/services/RunService.js';
import { createAuditService } from '../src/services/AuditService.js';
import { createTravelBalanceService } from '../src/services/TravelBalanceService.js';
import { createGiftCardService } from '../src/services/GiftCardService.js';
import { createExecutionPolicy } from '../src/engine/ExecutionPolicy.js';
import { createPipelineEngine } from '../src/engine/PipelineEngine.js';
import { createRunLock } from '../src/engine/RunLock.js';
import { createBagsClient } from '../src/clients/BagsClient.js';
import { createHeliusClient } from '../src/clients/HeliusClient.js';
import { createTravelSwapClient } from '../src/clients/TravelSwapClient.js';
import { wrapWithResilience } from '../src/clients/ResilientClientWrapper.js';
import { buildApp, startServer } from '../src/server.js';
import type { CircuitBreaker } from '../src/utils/resilience.js';

// ── Utilities ─────────────────────────────────────────────────

interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

const results: CheckResult[] = [];

function record(name: string, passed: boolean, detail: string): void {
  results.push({ name, passed, detail });
  const icon = passed ? '✅' : '❌';
  console.log(`  ${icon} ${name}: ${detail}`);
}

// ── Main ──────────────────────────────────────────────────────

async function verify(): Promise<void> {
  console.log('\n🔍 TravelSwap Docker-Ready Verification\n');

  // ── 1. Config ──
  console.log('── Step 1: Config validation');
  let config;
  try {
    config = loadConfig();
    record('config', true, 'Zod validation passed');
  } catch (err) {
    record('config', false, (err as Error).message);
    bail();
  }

  // ── 2. Database ──
  console.log('── Step 2: Database connection + migrations');
  const dbFactory = createDatabaseFactory({
    databasePath: config!.databasePath,
  });
  const dbHandle = await dbFactory.connect();
  record('db-connect', true, `dialect=${dbHandle.dialectName}`);

  await dbFactory.runMigrations(dbHandle);
  record('migrations', true, 'All migrations applied');

  // ── 3. Wire services ──
  console.log('── Step 3: Service wiring');
  const conn = dbHandle.conn;
  const strategyService = createStrategyService(conn);
  const runService = createRunService(conn);
  const auditService = createAuditService(conn);
  const travelBalanceService = createTravelBalanceService(conn);
  const giftCardService = createGiftCardService(conn);
  const executionPolicy = createExecutionPolicy(config!, conn);

  const rawBags = createBagsClient({
    apiKey: config!.bagsApiKey,
    rpcUrl: config!.heliusRpcUrl,
  });
  const rawHelius = createHeliusClient({
    apiKey: config!.heliusApiKey,
    rpcUrl: config!.heliusRpcUrl,
  });
  const travelSwapClient = createTravelSwapClient(
    config!.travelswapPartnerRef,
  );

  const circuitBreakers: Record<string, CircuitBreaker> = {};
  const { client: bags, circuitBreaker: bagsCb } = wrapWithResilience(
    'bags',
    rawBags,
  );
  circuitBreakers.bags = bagsCb;
  const { client: helius, circuitBreaker: heliusCb } = wrapWithResilience(
    'helius',
    rawHelius,
  );
  circuitBreakers.helius = heliusCb;

  const pipelineEngine = createPipelineEngine({
    runService,
    strategyService,
    auditService,
    executionPolicy,
    bags,
    config: config!,
    helius,
    travelBalanceService,
    giftCardService,
    travelSwapClient,
    circuitBreakers,
  });

  const runLock = createRunLock();

  const bookingService = (await import('../src/services/BookingService.js'))
    .createBookingService(conn, config!.giftCardEncryptionKey);

  record('services', true, 'All services + engine created');

  // ── 4. Build & start server ──
  console.log('── Step 4: Server startup');
  const app = await buildApp({
    strategyService,
    runService,
    travelBalanceService,
    giftCardService,
    pipelineEngine,
    runLock,
    db: conn,
    config: config!,
    bookingService,
    circuitBreakers,
  });

  // Listen on port 0 → OS picks a free port
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  const port =
    typeof address === 'object' && address ? address.port : undefined;
  if (!port) {
    record('server-start', false, 'Could not determine server port');
    await app.close();
    bail();
  }
  const baseUrl = `http://127.0.0.1:${port}`;
  record('server-start', true, `Listening on ${baseUrl}`);

  // ── 5. Health checks ──
  console.log('── Step 5: Endpoint verification');

  // 5a. /health/live
  try {
    const res = await fetch(`${baseUrl}/health/live`);
    const body = await res.json();
    if (res.status === 200 && body.status === 'ok') {
      record('/health/live', true, `200 → ${JSON.stringify(body)}`);
    } else {
      record('/health/live', false, `${res.status} → ${JSON.stringify(body)}`);
    }
  } catch (err) {
    record('/health/live', false, (err as Error).message);
  }

  // 5b. /health/ready
  try {
    const res = await fetch(`${baseUrl}/health/ready`);
    const body = await res.json();
    if (
      res.status === 200 &&
      body.checks?.database?.status === 'ok'
    ) {
      record('/health/ready', true, `200 → database=${body.checks.database.status}`);
    } else {
      record(
        '/health/ready',
        false,
        `${res.status} → ${JSON.stringify(body)}`,
      );
    }
  } catch (err) {
    record('/health/ready', false, (err as Error).message);
  }

  // 5c. /api/strategies (auth required)
  try {
    const res = await fetch(`${baseUrl}/api/strategies`, {
      headers: {
        Authorization: `Bearer ${config!.apiAuthToken}`,
      },
    });
    const body = await res.json();
    if (res.status === 200 && Array.isArray(body)) {
      record(
        '/api/strategies',
        true,
        `200 → array with ${body.length} strategies`,
      );
    } else {
      record(
        '/api/strategies',
        false,
        `${res.status} → ${JSON.stringify(body)}`,
      );
    }
  } catch (err) {
    record('/api/strategies', false, (err as Error).message);
  }

  // ── 6. Shutdown ──
  console.log('── Step 6: Clean shutdown');
  await app.close();
  dbHandle.close();
  record('shutdown', true, 'Server and database closed cleanly');

  // ── Summary ──
  console.log('\n═══════════════════════════════════════════');
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════════\n');

  if (failed > 0) {
    process.exit(1);
  }
}

function bail(): never {
  console.error('\n❌ Fatal: cannot continue verification.\n');
  process.exit(1);
}

verify().catch((err) => {
  console.error('\n❌ Unexpected error during verification:\n', err);
  process.exit(1);
});
