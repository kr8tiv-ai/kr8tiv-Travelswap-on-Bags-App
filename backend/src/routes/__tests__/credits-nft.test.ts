// ─── Credits NFT Badge Integration Tests ──────────────────────
// Tests that the credits route merges travel pass NFT data into
// gift card responses when travelPassService is present, and
// returns plain gift cards when it is not.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerAllRoutes, type RouteDeps } from '../index.js';
import type { StrategyService } from '../../services/StrategyService.js';
import type { RunService, AggregateStats } from '../../services/RunService.js';
import type { TravelBalanceService } from '../../services/TravelBalanceService.js';
import type { GiftCardService } from '../../services/GiftCardService.js';
import type { TravelPassService } from '../../services/TravelPassService.js';
import type { PipelineEngine } from '../../engine/types.js';
import type { RunLock } from '../../engine/RunLock.js';
import type { DatabaseConnection } from '../../services/Database.js';
import type { Config } from '../../config/index.js';
import type { GiftCard, TravelPass } from '../../types/index.js';

// ─── Fixtures ──────────────────────────────────────────────────

const TEST_TOKEN = 'test-auth-token-xyz';
const TEST_KEY = 'a'.repeat(64);

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    bagsApiKey: 'test-bags-key',
    bagsApiBaseUrl: 'https://api.bags.fm',
    heliusApiKey: 'test-helius-key',
    heliusRpcUrl: 'https://mainnet.helius-rpc.com',
    apiAuthToken: TEST_TOKEN,
    giftCardEncryptionKey: TEST_KEY,
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
    port: 3001,
    databasePath: ':memory:',
    logLevel: 'error',
    nodeEnv: 'test',
    corsOrigins: '',
    ...overrides,
  };
}

function makeGiftCard(overrides: Partial<GiftCard> = {}): GiftCard {
  return {
    giftCardId: '1',
    strategyId: '1',
    runId: '1',
    walletAddress: 'WalletABC',
    denominationUsd: 50,
    codeEncrypted: 'enc_code_1',
    status: 'PURCHASED',
    provider: 'coinvoyage',
    payorderId: null,
    paymentStatus: null,
    errorMessage: null,
    bitrefillInvoiceId: null,
    deliveredAt: null,
    redeemedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeTravelPass(overrides: Partial<TravelPass> = {}): TravelPass {
  return {
    id: '10',
    giftCardId: '1',
    strategyId: '1',
    walletAddress: 'WalletABC',
    denominationUsd: 50,
    tokenMint: 'mint1',
    mintSignature: 'sig_abc123',
    metadataUri: 'https://example.com/meta/1.json',
    status: 'MINTED',
    errorMessage: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    mintedAt: '2026-01-01T01:00:00.000Z',
    ...overrides,
  };
}

function authHeaders() {
  return { authorization: `Bearer ${TEST_TOKEN}` };
}

// ─── Mock Deps ─────────────────────────────────────────────────

function createMockDeps(opts: {
  configOverrides?: Partial<Config>;
  includeTravelPassService?: boolean;
} = {}): RouteDeps {
  const strategyService: StrategyService = {
    getAll: vi.fn().mockReturnValue([]),
    getById: vi.fn().mockReturnValue(undefined),
    getActive: vi.fn().mockReturnValue([]),
    create: vi.fn(),
    update: vi.fn(),
  };

  const runService: RunService = {
    create: vi.fn(),
    getById: vi.fn(),
    getAll: vi.fn().mockReturnValue([]),
    getByStrategyId: vi.fn().mockReturnValue([]),
    updatePhase: vi.fn(),
    markFailed: vi.fn(),
    markComplete: vi.fn(),
    getLatest: vi.fn().mockReturnValue([]),
    getAggregateStats: vi.fn().mockReturnValue({
      totalRuns: 0, completedRuns: 0, failedRuns: 0,
      totalClaimedSol: 0, totalSwappedUsdc: 0, totalAllocatedUsd: 0,
      totalCreditsIssued: 0, totalGiftCardsPurchased: 0,
    } satisfies AggregateStats),
  };

  const travelBalanceService: TravelBalanceService = {
    allocate: vi.fn(),
    deduct: vi.fn(),
    getByStrategyAndWallet: vi.fn(),
    getByStrategy: vi.fn().mockReturnValue([]),
    getTotal: vi.fn().mockReturnValue(0),
  };

  const giftCardService: GiftCardService = {
    getById: vi.fn().mockReturnValue(undefined),
    purchase: vi.fn(),
    purchasePending: vi.fn(),
    purchaseBitrefill: vi.fn(),
    getByPayorderId: vi.fn().mockReturnValue(undefined),
    getByWallet: vi.fn().mockReturnValue([]),
    getByRun: vi.fn().mockReturnValue([]),
    getByStrategy: vi.fn().mockReturnValue([]),
    updateStatus: vi.fn(),
    confirmPurchase: vi.fn(),
  };

  const pipelineEngine: PipelineEngine = {
    startRun: vi.fn().mockResolvedValue(undefined),
    resumeRun: vi.fn().mockResolvedValue(undefined),
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

  const deps: RouteDeps = {
    strategyService,
    runService,
    travelBalanceService,
    giftCardService,
    pipelineEngine,
    runLock,
    db,
    config: makeConfig(opts.configOverrides),
  };

  if (opts.includeTravelPassService) {
    const travelPassService: TravelPassService = {
      create: vi.fn(),
      getById: vi.fn(),
      getByGiftCardId: vi.fn(),
      getByGiftCardIds: vi.fn().mockReturnValue([]),
      getByWallet: vi.fn().mockReturnValue([]),
      updateMinted: vi.fn(),
      updateFailed: vi.fn(),
    };
    (deps as { travelPassService: TravelPassService }).travelPassService = travelPassService;
  }

  return deps;
}

// ─── Tests ─────────────────────────────────────────────────────

describe('GET /api/credits — NFT data merge', () => {
  let app: FastifyInstance;
  let deps: RouteDeps;

  afterEach(async () => {
    await app.close();
  });

  describe('with travelPassService', () => {
    beforeEach(async () => {
      app = Fastify({ logger: false });
      deps = createMockDeps({ includeTravelPassService: true });
      await registerAllRoutes(app, deps);
      await app.ready();
    });

    it('merges nftStatus and nftMintSignature into response when travel pass exists', async () => {
      const gc = makeGiftCard();
      const pass = makeTravelPass({ giftCardId: '1', status: 'MINTED', mintSignature: 'sig_abc123' });

      vi.mocked(deps.giftCardService.getByStrategy).mockResolvedValueOnce([gc]);
      vi.mocked(deps.travelPassService!.getByGiftCardIds).mockResolvedValueOnce([pass]);

      const res = await app.inject({
        method: 'GET',
        url: '/api/credits?strategyId=1',
        headers: authHeaders(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveLength(1);
      expect(body[0].nftStatus).toBe('MINTED');
      expect(body[0].nftMintSignature).toBe('sig_abc123');
    });

    it('returns nftStatus PENDING without nftMintSignature for pending passes', async () => {
      const gc = makeGiftCard();
      const pass = makeTravelPass({
        giftCardId: '1',
        status: 'PENDING',
        mintSignature: null,
        mintedAt: null,
      });

      vi.mocked(deps.giftCardService.getByStrategy).mockResolvedValueOnce([gc]);
      vi.mocked(deps.travelPassService!.getByGiftCardIds).mockResolvedValueOnce([pass]);

      const res = await app.inject({
        method: 'GET',
        url: '/api/credits?strategyId=1',
        headers: authHeaders(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body[0].nftStatus).toBe('PENDING');
      expect(body[0].nftMintSignature).toBeUndefined();
    });

    it('omits NFT fields for gift cards without travel passes', async () => {
      const gc1 = makeGiftCard({ giftCardId: '1' });
      const gc2 = makeGiftCard({ giftCardId: '2' });
      const pass = makeTravelPass({ giftCardId: '1', status: 'MINTED', mintSignature: 'sig_x' });

      vi.mocked(deps.giftCardService.getByStrategy).mockResolvedValueOnce([gc1, gc2]);
      vi.mocked(deps.travelPassService!.getByGiftCardIds).mockResolvedValueOnce([pass]);

      const res = await app.inject({
        method: 'GET',
        url: '/api/credits?strategyId=1',
        headers: authHeaders(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body[0].nftStatus).toBe('MINTED');
      expect(body[1].nftStatus).toBeUndefined();
    });

    it('merges NFT data for wallet-based lookup', async () => {
      const gc = makeGiftCard({ walletAddress: 'WalletXYZ' });
      const pass = makeTravelPass({ giftCardId: '1', status: 'FAILED', mintSignature: null });

      vi.mocked(deps.giftCardService.getByWallet).mockResolvedValueOnce([gc]);
      vi.mocked(deps.travelPassService!.getByGiftCardIds).mockResolvedValueOnce([pass]);

      const res = await app.inject({
        method: 'GET',
        url: '/api/credits?wallet=WalletXYZ',
        headers: authHeaders(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body[0].nftStatus).toBe('FAILED');
      expect(body[0].nftMintSignature).toBeUndefined();
    });
  });

  describe('without travelPassService', () => {
    beforeEach(async () => {
      app = Fastify({ logger: false });
      deps = createMockDeps({ includeTravelPassService: false });
      await registerAllRoutes(app, deps);
      await app.ready();
    });

    it('returns gift cards without NFT fields when travelPassService is undefined', async () => {
      const gc = makeGiftCard();
      vi.mocked(deps.giftCardService.getByStrategy).mockResolvedValueOnce([gc]);

      const res = await app.inject({
        method: 'GET',
        url: '/api/credits?strategyId=1',
        headers: authHeaders(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveLength(1);
      expect(body[0].nftStatus).toBeUndefined();
      expect(body[0].nftMintSignature).toBeUndefined();
    });
  });
});
