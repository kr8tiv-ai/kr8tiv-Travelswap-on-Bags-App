// ─── Validation Tests ──────────────────────────────────────────
// Zod schema rejection tests for mutation routes (strategies, runs)
// and stats endpoint activeStrategies count.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerAllRoutes, type RouteDeps } from '../index.js';
import type { StrategyService } from '../../services/StrategyService.js';
import type { RunService, AggregateStats } from '../../services/RunService.js';
import type { TravelBalanceService } from '../../services/TravelBalanceService.js';
import type { GiftCardService } from '../../services/GiftCardService.js';
import type { PipelineEngine } from '../../engine/types.js';
import type { RunLock } from '../../engine/RunLock.js';
import type { DatabaseConnection } from '../../services/Database.js';
import type { Config } from '../../config/index.js';
import type { TravelStrategy, TravelRun, TravelBalance, GiftCard } from '../../types/index.js';

// ─── Test Fixtures ─────────────────────────────────────────────

const TEST_TOKEN = 'test-auth-token-xyz';

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    bagsApiKey: 'test-bags-key',
    bagsApiBaseUrl: 'https://api.bags.fm',
    heliusApiKey: 'test-helius-key',
    heliusRpcUrl: 'https://mainnet.helius-rpc.com',
    apiAuthToken: TEST_TOKEN,
    giftCardEncryptionKey: 'a'.repeat(64),
    giftCardDailyLimit: 20,
    giftCardMaxDenomination: 200,
    balanceMaxUsd: 1000,
    travelswapPartnerRef: 'TEST',
    dryRun: false,
    executionKillSwitch: false,
    maxDailyRuns: 4,
    maxClaimableSolPerRun: 100,
    feeThresholdSol: 5,
    feeSource: 'CLAIMABLE_POSITIONS',
    swapSlippageBps: 50,
    distributionMode: 'TOP_N_HOLDERS',
    distributionTopN: 100,
    creditMode: 'GIFT_CARD',
    cronExpression: '0 */6 * * *',
    port: 3001,
    databasePath: ':memory:',
    logLevel: 'error',
    nodeEnv: 'test',
    corsOrigins: '',
    ...overrides,
  };
}

const mockStrategy: TravelStrategy = {
  strategyId: '1',
  name: 'Test Strategy',
  ownerWallet: 'WalletAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  tokenMint: 'MintBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
  feeSource: 'CLAIMABLE_POSITIONS',
  thresholdSol: 5,
  slippageBps: 50,
  distributionMode: 'EQUAL_SPLIT',
  distributionTopN: 100,
  creditMode: 'GIFT_CARD',
  giftCardThresholdUsd: 50,
  cronExpression: '0 */6 * * *',
  enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  lastRunId: null,
};

const mockRun: TravelRun = {
  runId: '1',
  strategyId: '1',
  phase: 'COMPLETE',
  status: 'COMPLETE',
  claimedSol: 10.5,
  swappedUsdc: 150.0,
  allocatedUsd: 150.0,
  creditsIssued: 3,
  giftCardsPurchased: 3,
  errorMessage: null,
  claimTx: 'tx-abc',
  swapTx: 'tx-def',
  startedAt: '2026-01-01T00:00:00.000Z',
  completedAt: '2026-01-01T01:00:00.000Z',
};

const mockStats: AggregateStats = {
  totalRuns: 10,
  completedRuns: 8,
  failedRuns: 2,
  totalClaimedSol: 100,
  totalSwappedUsdc: 1500,
  totalAllocatedUsd: 1500,
  totalCreditsIssued: 30,
  totalGiftCardsPurchased: 25,
};

// ─── Mock Service Factories ────────────────────────────────────

function createMockDeps(): RouteDeps {
  const strategyService: StrategyService = {
    getAll: vi.fn().mockReturnValue([mockStrategy]),
    getById: vi.fn().mockReturnValue(mockStrategy),
    getActive: vi.fn().mockReturnValue([mockStrategy]),
    create: vi.fn().mockReturnValue(mockStrategy),
    update: vi.fn().mockReturnValue({ ...mockStrategy, name: 'Updated' }),
  };

  const runService: RunService = {
    create: vi.fn().mockReturnValue(mockRun),
    getById: vi.fn().mockReturnValue(mockRun),
    getAll: vi.fn().mockReturnValue([mockRun]),
    getByStrategyId: vi.fn().mockReturnValue([mockRun]),
    updatePhase: vi.fn().mockReturnValue(mockRun),
    markFailed: vi.fn().mockReturnValue(mockRun),
    markComplete: vi.fn().mockReturnValue(mockRun),
    getLatest: vi.fn().mockReturnValue([mockRun]),
    getAggregateStats: vi.fn().mockReturnValue(mockStats),
  };

  const travelBalanceService: TravelBalanceService = {
    allocate: vi.fn().mockReturnValue({} as TravelBalance),
    deduct: vi.fn().mockReturnValue({} as TravelBalance),
    getByStrategyAndWallet: vi.fn().mockReturnValue(undefined),
    getByStrategy: vi.fn().mockReturnValue([]),
    getTotal: vi.fn().mockReturnValue(0),
  };

  const giftCardService: GiftCardService = {
    purchase: vi.fn().mockReturnValue({} as GiftCard),
    getByWallet: vi.fn().mockReturnValue([]),
    getByRun: vi.fn().mockReturnValue([]),
    getByStrategy: vi.fn().mockReturnValue([]),
    updateStatus: vi.fn().mockReturnValue({} as GiftCard),
  };

  const pipelineEngine: PipelineEngine = {
    startRun: vi.fn().mockResolvedValue(mockRun),
    resumeRun: vi.fn().mockResolvedValue(mockRun),
  };

  const runLock: RunLock = {
    acquire: vi.fn().mockReturnValue(true),
    release: vi.fn(),
    isLocked: vi.fn().mockReturnValue(false),
    releaseAll: vi.fn(),
  };

  const db: DatabaseConnection = {
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

function authHeaders() {
  return { authorization: `Bearer ${TEST_TOKEN}` };
}

function jsonHeaders() {
  return { ...authHeaders(), 'content-type': 'application/json' };
}

// ─── Tests ─────────────────────────────────────────────────────

describe('Zod Validation', () => {
  let app: FastifyInstance;
  let deps: RouteDeps;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    deps = createMockDeps();
    await registerAllRoutes(app, deps);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  // ─── POST /api/strategies ──────────────────────────────────

  describe('POST /api/strategies — Zod validation', () => {
    it('rejects empty body with 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/strategies',
        headers: jsonHeaders(),
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toMatch(/^Validation failed:/);
    });

    it('rejects when required fields are missing (only name provided)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/strategies',
        headers: jsonHeaders(),
        payload: { name: 'Test' },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toMatch(/Validation failed:/);
      expect(body.statusCode).toBe(400);
    });

    it('rejects name exceeding 100 characters', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/strategies',
        headers: jsonHeaders(),
        payload: {
          name: 'x'.repeat(101),
          ownerWallet: 'WalletXXX',
          tokenMint: 'MintYYY',
        },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toMatch(/Validation failed:/);
    });

    it('rejects ownerWallet exceeding 64 characters', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/strategies',
        headers: jsonHeaders(),
        payload: {
          name: 'Test',
          ownerWallet: 'W'.repeat(65),
          tokenMint: 'MintYYY',
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects tokenMint exceeding 64 characters', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/strategies',
        headers: jsonHeaders(),
        payload: {
          name: 'Test',
          ownerWallet: 'WalletXXX',
          tokenMint: 'M'.repeat(65),
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects invalid feeSource enum', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/strategies',
        headers: jsonHeaders(),
        payload: {
          name: 'Test',
          ownerWallet: 'WalletXXX',
          tokenMint: 'MintYYY',
          feeSource: 'INVALID_SOURCE',
        },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toMatch(/Validation failed:/);
    });

    it('rejects invalid distributionMode enum', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/strategies',
        headers: jsonHeaders(),
        payload: {
          name: 'Test',
          ownerWallet: 'WalletXXX',
          tokenMint: 'MintYYY',
          distributionMode: 'INVALID_MODE',
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects slippageBps above max (1000)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/strategies',
        headers: jsonHeaders(),
        payload: {
          name: 'Test',
          ownerWallet: 'WalletXXX',
          tokenMint: 'MintYYY',
          slippageBps: 1001,
        },
      });
      expect(res.statusCode).toBe(400);
    });

    it('accepts valid full payload with all optional fields', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/strategies',
        headers: jsonHeaders(),
        payload: {
          name: 'Full Strategy',
          ownerWallet: 'WalletXXX',
          tokenMint: 'MintYYY',
          feeSource: 'CLAIMABLE_POSITIONS',
          thresholdSol: 10,
          slippageBps: 100,
          distributionMode: 'TOP_N_HOLDERS',
          distributionTopN: 50,
          creditMode: 'GIFT_CARD',
          giftCardThresholdUsd: 25,
          cronExpression: '0 */12 * * *',
          enabled: false,
        },
      });
      expect(res.statusCode).toBe(201);
    });
  });

  // ─── PATCH /api/strategies/:id ─────────────────────────────

  describe('PATCH /api/strategies/:id — Zod validation', () => {
    it('rejects non-string name (number)', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/strategies/1',
        headers: jsonHeaders(),
        payload: { name: 12345 },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toMatch(/Validation failed:/);
    });

    it('rejects invalid enum for feeSource', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/strategies/1',
        headers: jsonHeaders(),
        payload: { feeSource: 'BOGUS' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('accepts valid partial update', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/strategies/1',
        headers: jsonHeaders(),
        payload: { name: 'Updated Name' },
      });
      expect(res.statusCode).toBe(200);
    });

    it('accepts empty object (no fields to update)', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/strategies/1',
        headers: jsonHeaders(),
        payload: {},
      });
      // Empty partial is valid — service handles no-op update
      expect(res.statusCode).toBe(200);
    });
  });

  // ─── POST /api/runs ────────────────────────────────────────

  describe('POST /api/runs — Zod validation', () => {
    it('rejects empty body with 400', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/runs',
        headers: jsonHeaders(),
        payload: {},
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toMatch(/Validation failed:/);
    });

    it('rejects non-numeric strategyId', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/runs',
        headers: jsonHeaders(),
        payload: { strategyId: 'abc' },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toMatch(/Validation failed:/);
    });

    it('rejects negative strategyId', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/runs',
        headers: jsonHeaders(),
        payload: { strategyId: -1 },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects zero strategyId', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/runs',
        headers: jsonHeaders(),
        payload: { strategyId: 0 },
      });
      expect(res.statusCode).toBe(400);
    });

    it('accepts valid strategyId', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/runs',
        headers: jsonHeaders(),
        payload: { strategyId: 1 },
      });
      expect(res.statusCode).toBe(201);
    });
  });

  // ─── GET /api/stats ────────────────────────────────────────

  describe('GET /api/stats — activeStrategies', () => {
    it('returns activeStrategies count alongside aggregate stats', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/stats',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.activeStrategies).toBe(1);
      expect(body.totalRuns).toBe(10);
      expect(body.completedRuns).toBe(8);
      expect(deps.strategyService.getActive).toHaveBeenCalled();
    });

    it('returns activeStrategies: 0 when no strategies are active', async () => {
      vi.mocked(deps.strategyService.getActive).mockReturnValueOnce([]);
      const res = await app.inject({
        method: 'GET',
        url: '/api/stats',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.activeStrategies).toBe(0);
    });
  });
});
