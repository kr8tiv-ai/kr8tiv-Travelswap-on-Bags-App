// ─── Observability Tests ───────────────────────────────────────
// Validates correlation IDs, log scrubbing, and request context.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import pino from 'pino';
import { buildApp } from '../server.js';
import { REDACT_PATHS } from '../logger.js';
import type { RouteDeps } from '../routes/types.js';
import type { Config } from '../config/index.js';
import type { StrategyService } from '../services/StrategyService.js';
import type { RunService } from '../services/RunService.js';
import type { TravelBalanceService } from '../services/TravelBalanceService.js';
import type { GiftCardService } from '../services/GiftCardService.js';
import type { PipelineEngine } from '../engine/types.js';
import type { RunLock } from '../engine/RunLock.js';
import type { DatabaseConnection } from '../services/Database.js';

// ─── UUID regex ────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Minimal Config ────────────────────────────────────────────

function makeConfig(): Config {
  return {
    bagsApiKey: 'test-bags-key',
    bagsApiBaseUrl: 'https://api.bags.fm',
    heliusApiKey: 'test-helius-key',
    heliusRpcUrl: 'https://mainnet.helius-rpc.com',
    apiAuthToken: 'test-token-for-observability',
    giftCardEncryptionKey: 'a'.repeat(64),
    giftCardDailyLimit: 20,
    giftCardMaxDenomination: 200,
    balanceMaxUsd: 1000,
    travelswapPartnerRef: 'TEST',
    dryRun: false,
    executionKillSwitch: false,
    maxDailyRuns: 4,
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
  };
}

// ─── Minimal Mock Deps ─────────────────────────────────────────

function createMinimalDeps(): RouteDeps {
  const strategyService: StrategyService = {
    getAll: vi.fn().mockReturnValue([]),
    getById: vi.fn().mockReturnValue(null),
    getActive: vi.fn().mockReturnValue([]),
    create: vi.fn(),
    update: vi.fn(),
  };

  const runService: RunService = {
    create: vi.fn(),
    getById: vi.fn().mockReturnValue(null),
    getAll: vi.fn().mockReturnValue([]),
    getByStrategyId: vi.fn().mockReturnValue([]),
    updatePhase: vi.fn(),
    markFailed: vi.fn(),
    markComplete: vi.fn(),
    getLatest: vi.fn().mockReturnValue([]),
    getAggregateStats: vi.fn().mockReturnValue({
      totalRuns: 0, completedRuns: 0, failedRuns: 0,
      totalClaimedSol: 0, totalSwappedUsdc: 0, totalCreditsIssued: 0,
      totalGiftCardsPurchased: 0,
    }),
  };

  const travelBalanceService: TravelBalanceService = {
    allocate: vi.fn(),
    deduct: vi.fn(),
    getByStrategyAndWallet: vi.fn().mockReturnValue(null),
    getByStrategy: vi.fn().mockReturnValue([]),
    getTotal: vi.fn().mockReturnValue(0),
  };

  const giftCardService: GiftCardService = {
    getById: vi.fn().mockReturnValue(undefined),
    purchase: vi.fn(),
    purchasePending: vi.fn(),
    getByPayorderId: vi.fn().mockReturnValue(undefined),
    getByWallet: vi.fn().mockReturnValue([]),
    getByRun: vi.fn().mockReturnValue([]),
    getByStrategy: vi.fn().mockReturnValue([]),
    updateStatus: vi.fn(),
    confirmPurchase: vi.fn(),
  };

  const pipelineEngine: PipelineEngine = {
    startRun: vi.fn().mockResolvedValue({}),
    resumeRun: vi.fn().mockResolvedValue({}),
  };

  const runLock: RunLock = {
    acquire: vi.fn().mockReturnValue(true),
    release: vi.fn(),
    isLocked: vi.fn().mockReturnValue(false),
    releaseAll: vi.fn(),
  };

  const db = {
    run: vi.fn().mockReturnValue({ changes: 0, lastInsertRowid: 0 }),
    get: vi.fn().mockReturnValue({ ok: 1 }),
    all: vi.fn().mockReturnValue([]),
    prepare: vi.fn(),
    exec: vi.fn(),
  } as unknown as DatabaseConnection;

  return {
    strategyService,
    runService,
    travelBalanceService,
    giftCardService,
    pipelineEngine,
    runLock,
    db,
    config: makeConfig(),
  };
}

// ─── Tests ─────────────────────────────────────────────────────

describe('Observability: Correlation IDs', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp(createMinimalDeps());
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns x-request-id header with a valid UUID on every response', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/live' });
    expect(res.statusCode).toBe(200);
    const requestId = res.headers['x-request-id'];
    expect(requestId).toBeDefined();
    expect(typeof requestId).toBe('string');
    expect(requestId).toMatch(UUID_RE);
  });

  it('returns unique x-request-id headers across requests', async () => {
    const res1 = await app.inject({ method: 'GET', url: '/health/live' });
    const res2 = await app.inject({ method: 'GET', url: '/health/live' });
    const id1 = res1.headers['x-request-id'];
    const id2 = res2.headers['x-request-id'];
    expect(id1).not.toBe(id2);
  });

  it('includes x-request-id on error responses', async () => {
    // 404 route doesn't exist
    const res = await app.inject({ method: 'GET', url: '/nonexistent-route' });
    const requestId = res.headers['x-request-id'];
    expect(requestId).toBeDefined();
    expect(requestId).toMatch(UUID_RE);
  });

  it('includes x-request-id on auth-rejected responses', async () => {
    // No auth token → 401
    const res = await app.inject({ method: 'GET', url: '/api/strategies' });
    const requestId = res.headers['x-request-id'];
    expect(requestId).toBeDefined();
    expect(requestId).toMatch(UUID_RE);
  });
});

describe('Observability: Pino Redact Config', () => {
  it('REDACT_PATHS covers all sensitive field names', () => {
    const expectedFields = [
      'apiKey', 'token', 'privateKey', 'encryptionKey',
      'password', 'secret', 'authorization',
    ];
    for (const field of expectedFields) {
      // Both nested (*.field) and top-level (field) paths should be present
      expect(REDACT_PATHS).toContain(`*.${field}`);
      expect(REDACT_PATHS).toContain(field);
    }
  });

  it('Pino redact censors nested sensitive fields', () => {
    // Create a test logger with same redact config but writing to a buffer
    const chunks: string[] = [];
    const testLogger = pino({
      level: 'info',
      redact: {
        paths: REDACT_PATHS,
        censor: '[REDACTED]',
      },
    }, {
      write(chunk: string) {
        chunks.push(chunk);
      },
    } as pino.DestinationStream);

    testLogger.info({ config: { apiKey: 'secret123', name: 'test' } }, 'test log');

    expect(chunks.length).toBe(1);
    const parsed = JSON.parse(chunks[0]);
    expect(parsed.config.apiKey).toBe('[REDACTED]');
    expect(parsed.config.name).toBe('test');
  });

  it('Pino redact censors top-level sensitive fields', () => {
    const chunks: string[] = [];
    const testLogger = pino({
      level: 'info',
      redact: {
        paths: REDACT_PATHS,
        censor: '[REDACTED]',
      },
    }, {
      write(chunk: string) {
        chunks.push(chunk);
      },
    } as pino.DestinationStream);

    testLogger.info({ apiKey: 'super-secret', token: 'jwt-tok', safe: 'visible' }, 'test');

    const parsed = JSON.parse(chunks[0]);
    expect(parsed.apiKey).toBe('[REDACTED]');
    expect(parsed.token).toBe('[REDACTED]');
    expect(parsed.safe).toBe('visible');
  });
});

describe('Observability: Error handler fallback', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp(createMinimalDeps());
  });

  afterEach(async () => {
    await app.close();
  });

  it('error handler logs with request context and does not crash', async () => {
    // Trigger a 401 (auth middleware rejects) — error handler uses request.log
    const res = await app.inject({
      method: 'GET',
      url: '/api/strategies',
    });
    // Should get a structured error, not a crash
    expect(res.statusCode).toBe(401);
    expect(res.json()).toHaveProperty('error');
    // x-request-id still present even on error
    expect(res.headers['x-request-id']).toMatch(UUID_RE);
  });
});
