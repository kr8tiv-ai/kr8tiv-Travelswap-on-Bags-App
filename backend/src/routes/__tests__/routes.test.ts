// ─── Route Tests ───────────────────────────────────────────────
// Integration tests for all route modules using Fastify app.inject().
// Services are mocked — no real database.

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

const mockBalance: TravelBalance = {
  balanceId: '1',
  strategyId: '1',
  walletAddress: 'WalletCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
  balanceUsd: 50.0,
  totalEarned: 100.0,
  totalSpent: 50.0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const mockGiftCard: GiftCard = {
  giftCardId: '1',
  strategyId: '1',
  runId: '1',
  walletAddress: 'WalletCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
  denominationUsd: 50,
  codeEncrypted: 'enc-abc',
  status: 'PURCHASED',
  deliveredAt: null,
  redeemedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
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
    allocate: vi.fn().mockReturnValue(mockBalance),
    deduct: vi.fn().mockReturnValue(mockBalance),
    getByStrategyAndWallet: vi.fn().mockReturnValue(mockBalance),
    getByStrategy: vi.fn().mockReturnValue([mockBalance]),
    getTotal: vi.fn().mockReturnValue(50),
  };

  const giftCardService: GiftCardService = {
    purchase: vi.fn().mockReturnValue(mockGiftCard),
    getByWallet: vi.fn().mockReturnValue([mockGiftCard]),
    getByRun: vi.fn().mockReturnValue([mockGiftCard]),
    getByStrategy: vi.fn().mockReturnValue([mockGiftCard]),
    updateStatus: vi.fn().mockReturnValue(mockGiftCard),
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

// ─── Test Helpers ──────────────────────────────────────────────

function authHeaders() {
  return { authorization: `Bearer ${TEST_TOKEN}` };
}

// ─── Tests ─────────────────────────────────────────────────────

describe('Route Modules', () => {
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

  // ─── Auth ──────────────────────────────────────────────────

  describe('Authentication', () => {
    it('returns 401 for API routes without auth token', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/strategies' });
      expect(res.statusCode).toBe(401);
    });

    it('allows health routes without auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/health/live' });
      expect(res.statusCode).toBe(200);
    });
  });

  // ─── Strategies ────────────────────────────────────────────

  describe('GET /api/strategies', () => {
    it('returns all strategies', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/strategies',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([mockStrategy]);
      expect(deps.strategyService.getAll).toHaveBeenCalled();
    });
  });

  describe('POST /api/strategies', () => {
    it('creates a strategy with valid body', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/strategies',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: {
          name: 'New Strategy',
          ownerWallet: 'WalletXXX',
          tokenMint: 'MintYYY',
        },
      });
      expect(res.statusCode).toBe(201);
      expect(deps.strategyService.create).toHaveBeenCalled();
    });

    it('returns 400 when required fields are missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/strategies',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: { name: 'Missing fields' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /api/strategies/:id', () => {
    it('returns a strategy by ID', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/strategies/1',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(mockStrategy);
    });

    it('returns 400 for non-numeric ID', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/strategies/abc',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 404 when strategy not found', async () => {
      vi.mocked(deps.strategyService.getById).mockReturnValueOnce(undefined);
      const res = await app.inject({
        method: 'GET',
        url: '/api/strategies/999',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('PATCH /api/strategies/:id', () => {
    it('updates a strategy', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/strategies/1',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: { name: 'Updated' },
      });
      expect(res.statusCode).toBe(200);
      expect(deps.strategyService.update).toHaveBeenCalledWith(1, { name: 'Updated' });
    });

    it('returns 404 when strategy not found for update', async () => {
      vi.mocked(deps.strategyService.getById).mockReturnValueOnce(undefined);
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/strategies/999',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: { name: 'Updated' },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('DELETE /api/strategies/:id', () => {
    it('returns 501 Not Implemented', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/api/strategies/1',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(501);
    });
  });

  // ─── Runs ──────────────────────────────────────────────────

  describe('GET /api/runs', () => {
    it('returns all runs', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/runs',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([mockRun]);
      expect(deps.runService.getAll).toHaveBeenCalled();
    });

    it('filters by strategyId', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/runs?strategyId=1',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      expect(deps.runService.getByStrategyId).toHaveBeenCalledWith(1);
    });
  });

  describe('POST /api/runs', () => {
    it('triggers a new run', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/runs',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: { strategyId: 1 },
      });
      expect(res.statusCode).toBe(201);
      expect(deps.runLock.acquire).toHaveBeenCalledWith(1);
      expect(deps.pipelineEngine.startRun).toHaveBeenCalledWith(1);
      expect(deps.runLock.release).toHaveBeenCalledWith(1);
    });

    it('returns 409 when run is already in progress', async () => {
      vi.mocked(deps.runLock.acquire).mockReturnValueOnce(false);
      const res = await app.inject({
        method: 'POST',
        url: '/api/runs',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: { strategyId: 1 },
      });
      expect(res.statusCode).toBe(409);
    });

    it('returns 400 when strategyId is missing', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/runs',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it('releases RunLock even when startRun fails', async () => {
      vi.mocked(deps.pipelineEngine.startRun).mockRejectedValueOnce(
        new Error('Pipeline failed'),
      );
      const res = await app.inject({
        method: 'POST',
        url: '/api/runs',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        payload: { strategyId: 1 },
      });
      expect(res.statusCode).toBe(500);
      expect(deps.runLock.release).toHaveBeenCalledWith(1);
    });
  });

  describe('GET /api/runs/:id', () => {
    it('returns a run by ID', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/runs/1',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(mockRun);
    });

    it('returns 404 when run not found', async () => {
      vi.mocked(deps.runService.getById).mockReturnValueOnce(undefined);
      const res = await app.inject({
        method: 'GET',
        url: '/api/runs/999',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /api/runs/:id/resume', () => {
    it('resumes a failed run', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/runs/1/resume',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      expect(deps.pipelineEngine.resumeRun).toHaveBeenCalledWith(1);
    });
  });

  // ─── Balances ──────────────────────────────────────────────

  describe('GET /api/balances', () => {
    it('returns balances for a strategy', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/balances?strategyId=1',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([mockBalance]);
    });

    it('returns 400 when strategyId is missing', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/balances',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /api/balances/:wallet', () => {
    it('returns balance for a wallet', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/balances/WalletCCC?strategyId=1',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(mockBalance);
    });

    it('returns 400 without strategyId', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/balances/WalletCCC',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(400);
    });

    it('returns 404 when balance not found', async () => {
      vi.mocked(deps.travelBalanceService.getByStrategyAndWallet).mockReturnValueOnce(undefined);
      const res = await app.inject({
        method: 'GET',
        url: '/api/balances/WalletXXX?strategyId=1',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(404);
    });
  });

  // ─── Credits ───────────────────────────────────────────────

  describe('GET /api/credits', () => {
    it('returns credits by strategyId', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/credits?strategyId=1',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([mockGiftCard]);
    });

    it('returns credits by wallet', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/credits?wallet=WalletCCC',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      expect(deps.giftCardService.getByWallet).toHaveBeenCalledWith('WalletCCC');
    });

    it('returns 400 when neither strategyId nor wallet is provided', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/credits',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /api/credits/:wallet', () => {
    it('returns credits for a wallet', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/credits/WalletCCC',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      expect(deps.giftCardService.getByWallet).toHaveBeenCalledWith('WalletCCC');
    });
  });

  // ─── Stats ─────────────────────────────────────────────────

  describe('GET /api/stats', () => {
    it('returns aggregate statistics with activeStrategies', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/stats',
        headers: authHeaders(),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toEqual({ ...mockStats, activeStrategies: 1 });
    });
  });

  // ─── Health ────────────────────────────────────────────────

  describe('GET /health/live', () => {
    it('returns ok', async () => {
      const res = await app.inject({ method: 'GET', url: '/health/live' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'ok' });
    });
  });

  describe('GET /health/ready', () => {
    it('returns ready when DB is healthy', async () => {
      const res = await app.inject({ method: 'GET', url: '/health/ready' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('ready');
      expect(body.checks.database.status).toBe('ok');
    });

    it('returns 503 when DB check fails', async () => {
      vi.mocked(deps.db.get).mockImplementationOnce(() => {
        throw new Error('DB connection lost');
      });
      const res = await app.inject({ method: 'GET', url: '/health/ready' });
      expect(res.statusCode).toBe(503);
      const body = res.json();
      expect(body.status).toBe('not_ready');
      expect(body.checks.database.status).toBe('error');
    });
  });
});
