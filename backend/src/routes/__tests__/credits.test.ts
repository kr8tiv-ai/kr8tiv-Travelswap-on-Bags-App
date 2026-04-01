// ─── Credits Route Tests ───────────────────────────────────────
// Tests for POST /api/credits/:id/reveal endpoint.

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
import type { GiftCard } from '../../types/index.js';
import { encryptCode } from '../../utils/encryption.js';

// ─── Test Fixtures ─────────────────────────────────────────────

const TEST_TOKEN = 'test-auth-token-xyz';
const TEST_KEY = 'a'.repeat(64);
const PLAIN_CODE = 'GIFT-ABC-12345';
const ENCRYPTED_CODE = encryptCode(PLAIN_CODE, TEST_KEY);

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

function makePurchasedGiftCard(overrides: Partial<GiftCard> = {}): GiftCard {
  return {
    giftCardId: '1',
    strategyId: '1',
    runId: '1',
    walletAddress: 'WalletCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
    denominationUsd: 50,
    codeEncrypted: ENCRYPTED_CODE,
    status: 'PURCHASED',
    payorderId: null,
    paymentStatus: null,
    errorMessage: null,
    deliveredAt: null,
    redeemedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeDeliveredGiftCard(): GiftCard {
  return makePurchasedGiftCard({
    status: 'DELIVERED',
    deliveredAt: '2026-01-02T00:00:00.000Z',
  });
}

function authHeaders() {
  return { authorization: `Bearer ${TEST_TOKEN}` };
}

// ─── Mock Service Factories ────────────────────────────────────

function createMockDeps(configOverrides: Partial<Config> = {}): RouteDeps {
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

  return {
    strategyService,
    runService,
    travelBalanceService,
    giftCardService,
    pipelineEngine,
    runLock,
    db,
    config: makeConfig(configOverrides),
  };
}

// ─── Tests ─────────────────────────────────────────────────────

describe('POST /api/credits/:id/reveal', () => {
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

  it('decrypts PURCHASED card code and transitions to DELIVERED', async () => {
    const purchased = makePurchasedGiftCard();
    const delivered = makeDeliveredGiftCard();
    vi.mocked(deps.giftCardService.getById).mockReturnValueOnce(
      Promise.resolve(purchased),
    );
    vi.mocked(deps.giftCardService.updateStatus).mockReturnValueOnce(
      Promise.resolve(delivered),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/credits/1/reveal',
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.code).toBe(PLAIN_CODE);
    expect(body.giftCard.status).toBe('DELIVERED');
    expect(deps.giftCardService.updateStatus).toHaveBeenCalledWith(1, 'DELIVERED');
  });

  it('returns alreadyRevealed for DELIVERED card', async () => {
    const delivered = makeDeliveredGiftCard();
    vi.mocked(deps.giftCardService.getById).mockReturnValueOnce(
      Promise.resolve(delivered),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/credits/1/reveal',
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.code).toBeNull();
    expect(body.alreadyRevealed).toBe(true);
    expect(body.giftCard.status).toBe('DELIVERED');
  });

  it('returns 404 for non-existent gift card', async () => {
    vi.mocked(deps.giftCardService.getById).mockReturnValueOnce(
      Promise.resolve(undefined),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/credits/999/reveal',
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Gift card not found', statusCode: 404 });
  });

  it('returns 400 for PENDING card', async () => {
    const pending = makePurchasedGiftCard({ status: 'PENDING', codeEncrypted: '' });
    vi.mocked(deps.giftCardService.getById).mockReturnValueOnce(
      Promise.resolve(pending),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/credits/1/reveal',
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Gift card code not yet available', statusCode: 400 });
  });

  it('returns 400 for invalid (non-numeric) ID', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/credits/abc/reveal',
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Invalid gift card ID', statusCode: 400 });
  });

  it('returns 500 when PURCHASED card has empty codeEncrypted', async () => {
    const corrupted = makePurchasedGiftCard({ codeEncrypted: '' });
    vi.mocked(deps.giftCardService.getById).mockReturnValueOnce(
      Promise.resolve(corrupted),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/credits/1/reveal',
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'Code data is corrupted', statusCode: 500 });
  });

  it('returns 400 for EXPIRED card', async () => {
    const expired = makePurchasedGiftCard({ status: 'EXPIRED' });
    vi.mocked(deps.giftCardService.getById).mockReturnValueOnce(
      Promise.resolve(expired),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/credits/1/reveal',
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Gift card has expired', statusCode: 400 });
  });

  it('returns alreadyRevealed for REDEEMED card', async () => {
    const redeemed = makePurchasedGiftCard({
      status: 'REDEEMED',
      deliveredAt: '2026-01-02T00:00:00.000Z',
      redeemedAt: '2026-01-03T00:00:00.000Z',
    });
    vi.mocked(deps.giftCardService.getById).mockReturnValueOnce(
      Promise.resolve(redeemed),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/credits/1/reveal',
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.code).toBeNull();
    expect(body.alreadyRevealed).toBe(true);
  });

  it('returns 401 without auth token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/credits/1/reveal',
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns 503 when giftCardEncryptionKey is missing', async () => {
    // Rebuild app with empty encryption key
    await app.close();
    app = Fastify({ logger: false });
    deps = createMockDeps({ giftCardEncryptionKey: '' });
    await registerAllRoutes(app, deps);
    await app.ready();

    const purchased = makePurchasedGiftCard();
    vi.mocked(deps.giftCardService.getById).mockReturnValueOnce(
      Promise.resolve(purchased),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/credits/1/reveal',
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'Gift card decryption is not configured', statusCode: 503 });
  });

  it('returns 500 when decryption fails (corrupted ciphertext)', async () => {
    const badCrypto = makePurchasedGiftCard({
      codeEncrypted: 'bad:cipher:text',
    });
    vi.mocked(deps.giftCardService.getById).mockReturnValueOnce(
      Promise.resolve(badCrypto),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/credits/1/reveal',
      headers: authHeaders(),
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'Failed to decrypt gift card code', statusCode: 500 });
  });
});
