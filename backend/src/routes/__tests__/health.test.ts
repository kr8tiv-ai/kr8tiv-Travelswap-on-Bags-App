// ─── Health Endpoint Tests ─────────────────────────────────────
// Validates /health/live and /health/ready behavior including
// per-dependency circuit breaker state checks.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Database } from '../../services/Database.js';
import { createStrategyService } from '../../services/StrategyService.js';
import { createRunService } from '../../services/RunService.js';
import { createTravelBalanceService } from '../../services/TravelBalanceService.js';
import { createGiftCardService } from '../../services/GiftCardService.js';
import { createPipelineEngine } from '../../engine/PipelineEngine.js';
import { createExecutionPolicy } from '../../engine/ExecutionPolicy.js';
import { createRunLock } from '../../engine/RunLock.js';
import { createAuditService } from '../../services/AuditService.js';
import { buildApp } from '../../server.js';
import { CircuitBreaker } from '../../utils/resilience.js';
import type { Config } from '../../config/index.js';
import type { RouteDeps } from '../types.js';
import type { BagsAdapter, ClaimablePosition } from '../../types/index.js';
import type { HeliusClient } from '../../clients/HeliusClient.js';
import type { PipelineDeps } from '../../engine/types.js';

// ─── Minimal Mocks ─────────────────────────────────────────────

function makeConfig(overrides?: Partial<Config>): Config {
  return {
    bagsApiKey: 'test-bags-key',
    bagsApiBaseUrl: 'https://api.bags.fm',
    heliusApiKey: 'test-helius-key',
    heliusRpcUrl: 'https://mainnet.helius-rpc.com',
    apiAuthToken: 'test-token',
    giftCardEncryptionKey: 'a'.repeat(64),
    giftCardDailyLimit: 20,
    giftCardMaxDenomination: 200,
    balanceMaxUsd: 1000,
    travelswapPartnerRef: 'TEST',
    dryRun: true,
    executionKillSwitch: false,
    maxDailyRuns: 10,
    maxClaimableSolPerRun: 100,
    minIntervalMinutes: 60,
    feeThresholdSol: 5,
    feeSource: 'CLAIMABLE_POSITIONS',
    swapSlippageBps: 50,
    distributionMode: 'TOP_N_HOLDERS',
    distributionTopN: 100,
    creditMode: 'GIFT_CARD',
    cronExpression: '0 */6 * * *',
    port: 0,
    databasePath: ':memory:',
    logLevel: 'error',
    nodeEnv: 'test',
    corsOrigins: '',
    signerPrivateKey: undefined,
    ...overrides,
  };
}

function makeMockBags(): BagsAdapter {
  return {
    getClaimablePositions: async () => [],
    getTotalClaimableSol: async () => ({ totalLamports: 0n, positions: [] }),
    getClaimTransactions: async () => [],
    getTradeQuote: async () => ({ requestId: '', contextSlot: 0, inAmount: '0', inputMint: '', outAmount: '0', outputMint: '', minOutAmount: '0', otherAmountThreshold: '0', priceImpactPct: '0', slippageBps: 0, routePlan: [], platformFee: { amount: '0', feeBps: 0, feeAccount: '', segmenterFeeAmount: '0', segmenterFeePct: 0 }, outTransferFee: '0', simulatedComputeUnits: 0 }),
    createSwapTransaction: async () => ({ swapTransaction: '', computeUnitLimit: 0, lastValidBlockHeight: 0, prioritizationFeeLamports: 0 }),
    prepareSwap: async () => ({ quote: {} as any, swapTx: {} as any }),
    getRateLimitStatus: () => ({ remaining: 100, limit: 100, resetAt: Date.now() + 60_000 }),
  };
}

function makeMockHelius(): HeliusClient {
  return {
    getTokenAccounts: async () => [],
    getTopHolders: async () => [],
    calculateDistributionWeights: () => [],
  };
}

// ─── Test Harness ──────────────────────────────────────────────

interface HealthTestHarness {
  app: FastifyInstance;
  db: Database;
  circuitBreakers: Record<string, CircuitBreaker>;
}

async function buildHealthHarness(opts?: {
  includeCircuitBreakers?: boolean;
  includeDuffel?: boolean;
}): Promise<HealthTestHarness> {
  const include = opts?.includeCircuitBreakers ?? true;
  const config = makeConfig();
  const db = new Database(':memory:');
  const conn = await db.connect();
  await db.runMigrations();

  const strategyService = createStrategyService(conn);
  const runService = createRunService(conn);
  const auditService = createAuditService(conn);
  const travelBalanceService = createTravelBalanceService(conn);
  const giftCardService = createGiftCardService(conn);
  const executionPolicy = createExecutionPolicy(config, conn);
  const bags = makeMockBags();
  const helius = makeMockHelius();
  const runLock = createRunLock();

  const circuitBreakers: Record<string, CircuitBreaker> = {};

  if (include) {
    circuitBreakers.bags = new CircuitBreaker({ name: 'bags', failureThreshold: 3 });
    circuitBreakers.helius = new CircuitBreaker({ name: 'helius', failureThreshold: 3 });
    if (opts?.includeDuffel) {
      circuitBreakers.duffel = new CircuitBreaker({ name: 'duffel', failureThreshold: 3 });
    }
  }

  const pipelineDeps: PipelineDeps = {
    runService, strategyService, auditService, executionPolicy,
    bags, config, helius, travelBalanceService, giftCardService,
  };
  const pipelineEngine = createPipelineEngine(pipelineDeps);

  const routeDeps: RouteDeps = {
    strategyService, runService, travelBalanceService, giftCardService,
    pipelineEngine, runLock, db: conn, config,
    circuitBreakers: include ? circuitBreakers : undefined,
  };

  const app = await buildApp(routeDeps);
  return { app, db, circuitBreakers };
}

// ─── Trip a circuit breaker by calling execute with a failing fn ──

async function tripCircuitBreaker(cb: CircuitBreaker): Promise<void> {
  const threshold = (cb as any).failureThreshold ?? 5;
  for (let i = 0; i < threshold; i++) {
    try {
      await cb.execute(async () => { throw new Error('forced failure'); });
    } catch { /* expected */ }
  }
  // Verify it's actually open
  if (cb.state !== 'OPEN') {
    throw new Error(`Expected circuit breaker ${cb.name} to be OPEN, got ${cb.state}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════

describe('Health Routes', () => {
  let harness: HealthTestHarness;

  afterEach(async () => {
    if (harness) {
      await harness.app.close();
      harness.db.close();
    }
  });

  // ── /health/live ─────────────────────────────────────────────

  it('/health/live returns 200 always', async () => {
    harness = await buildHealthHarness();
    const res = await harness.app.inject({ method: 'GET', url: '/health/live' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  // ── /health/ready — all ok ──────────────────────────────────

  it('/health/ready returns 200 ready when all circuit breakers are closed', async () => {
    harness = await buildHealthHarness({ includeCircuitBreakers: true, includeDuffel: true });
    const res = await harness.app.inject({ method: 'GET', url: '/health/ready' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ready');
    expect(body.checks.database.status).toBe('ok');
    expect(body.checks.bags.status).toBe('ok');
    expect(body.checks.bags.state).toBe('CLOSED');
    expect(body.checks.helius.status).toBe('ok');
    expect(body.checks.helius.state).toBe('CLOSED');
    expect(body.checks.duffel.status).toBe('ok');
    expect(body.checks.duffel.state).toBe('CLOSED');
  });

  // ── /health/ready — critical breaker open → 503 ─────────────

  it('/health/ready returns 503 not_ready when bags circuit breaker is open', async () => {
    harness = await buildHealthHarness({ includeCircuitBreakers: true });
    await tripCircuitBreaker(harness.circuitBreakers.bags);

    const res = await harness.app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(503);

    const body = res.json();
    expect(body.status).toBe('not_ready');
    expect(body.checks.bags.status).toBe('error');
    expect(body.checks.bags.state).toBe('OPEN');
    expect(body.checks.bags.lastFailure).toBeGreaterThan(0);
    // Helius still ok
    expect(body.checks.helius.status).toBe('ok');
  });

  // ── /health/ready — non-critical breaker open → 200 degraded ─

  it('/health/ready returns 200 degraded when duffel circuit breaker is open', async () => {
    harness = await buildHealthHarness({ includeCircuitBreakers: true, includeDuffel: true });
    await tripCircuitBreaker(harness.circuitBreakers.duffel);

    const res = await harness.app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.status).toBe('degraded');
    expect(body.checks.duffel.status).toBe('error');
    expect(body.checks.duffel.state).toBe('OPEN');
    // Critical deps still ok
    expect(body.checks.bags.status).toBe('ok');
    expect(body.checks.helius.status).toBe('ok');
    expect(body.checks.database.status).toBe('ok');
  });

  // ── /health/ready — no duffel configured → omitted ──────────

  it('/health/ready omits duffel check when not configured', async () => {
    harness = await buildHealthHarness({ includeCircuitBreakers: true, includeDuffel: false });
    const res = await harness.app.inject({ method: 'GET', url: '/health/ready' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ready');
    expect(body.checks.duffel).toBeUndefined();
    expect(body.checks.bags).toBeDefined();
    expect(body.checks.helius).toBeDefined();
  });

  // ── /health/ready — helius critical breaker open → 503 ──────

  it('/health/ready returns 503 when helius circuit breaker is open', async () => {
    harness = await buildHealthHarness({ includeCircuitBreakers: true });
    await tripCircuitBreaker(harness.circuitBreakers.helius);

    const res = await harness.app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(503);

    const body = res.json();
    expect(body.status).toBe('not_ready');
    expect(body.checks.helius.status).toBe('error');
    expect(body.checks.helius.state).toBe('OPEN');
    // Bags still ok
    expect(body.checks.bags.status).toBe('ok');
  });

  // ── /health/ready — no circuit breakers at all ──────────────

  it('/health/ready works without circuitBreakers in deps', async () => {
    harness = await buildHealthHarness({ includeCircuitBreakers: false });
    const res = await harness.app.inject({ method: 'GET', url: '/health/ready' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ready');
    expect(body.checks.database.status).toBe('ok');
    // No circuit breaker checks present
    expect(body.checks.bags).toBeUndefined();
    expect(body.checks.helius).toBeUndefined();
  });
});
