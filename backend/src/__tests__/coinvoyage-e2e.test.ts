// ─── CoinVoyage E2E Integration Tests ──────────────────────────
// Full async gift card flow:
//   pipeline run → PENDING gift card with payorder_id
//   → webhook with valid HMAC → PENDING → PURCHASED
//
// Also tests:
//   - graceful degradation (no CoinVoyageClient → stub TRAVEL-XXXXXXXX)
//   - invalid HMAC webhook → 401

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Database } from '../services/Database.js';
import { createStrategyService } from '../services/StrategyService.js';
import { createRunService } from '../services/RunService.js';
import { createAuditService } from '../services/AuditService.js';
import { createTravelBalanceService } from '../services/TravelBalanceService.js';
import { createGiftCardService } from '../services/GiftCardService.js';
import { createExecutionPolicy } from '../engine/ExecutionPolicy.js';
import { createPipelineEngine } from '../engine/PipelineEngine.js';
import { createRunLock } from '../engine/RunLock.js';
import { buildApp } from '../server.js';
import { WEIGHT_SCALE } from '../clients/HeliusClient.js';
import type { Config } from '../config/index.js';
import type { RouteDeps } from '../routes/types.js';
import type {
  BagsAdapter,
  TradeQuote,
  TokenHolder,
  ClaimablePosition,
  CoinVoyageClientAdapter,
  PayOrder,
} from '../types/index.js';
import type { HeliusClient, WeightedHolder } from '../clients/HeliusClient.js';
import type { PipelineDeps } from '../engine/types.js';
import type { GiftCardService } from '../services/GiftCardService.js';
import type { DatabaseConnection } from '../services/Database.js';

// ─── Constants ─────────────────────────────────────────────────

const TEST_TOKEN = 'coinvoyage-e2e-test-token';
const OWNER_WALLET = 'WalletAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const TOKEN_MINT = 'MintBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const WEBHOOK_SECRET = 'e2e-coinvoyage-webhook-secret-key';
const COINVOYAGE_API_KEY = 'e2e-cv-api-key';
const COINVOYAGE_API_SECRET = 'e2e-cv-api-secret';

// Three mock holders for distribution
const MOCK_HOLDERS: TokenHolder[] = [
  { address: 'Acct1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', owner: 'Holder1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', balance: 500_000n },
  { address: 'Acct2AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', owner: 'Holder2AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', balance: 300_000n },
  { address: 'Acct3AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', owner: 'Holder3AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', balance: 200_000n },
];

// ─── Test Config ───────────────────────────────────────────────

function makeE2eConfig(overrides: Partial<Config> = {}): Config {
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

// ─── Mock Position ─────────────────────────────────────────────

function makeMockPosition(): ClaimablePosition {
  return {
    isCustomFeeVault: false,
    baseMint: 'So11111111111111111111111111111111111111112',
    isMigrated: false,
    totalClaimableLamportsUserShare: 10_000_000_000,
    programId: 'ProgramAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    quoteMint: TOKEN_MINT,
    virtualPool: 'VpoolAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    virtualPoolAddress: 'VpoolAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    virtualPoolClaimableAmount: 10,
    virtualPoolClaimableLamportsUserShare: 5_000_000_000,
    dammPoolClaimableAmount: 10,
    dammPoolClaimableLamportsUserShare: 5_000_000_000,
    dammPoolAddress: 'DammAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    claimableDisplayAmount: 10,
    user: OWNER_WALLET,
    claimerIndex: 0,
    userBps: 5000,
    customFeeVault: 'VaultAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    customFeeVaultClaimerA: OWNER_WALLET,
    customFeeVaultClaimerB: OWNER_WALLET,
    customFeeVaultClaimerSide: 'A',
  };
}

// ─── Mock Trade Quote ──────────────────────────────────────────

function makeMockTradeQuote(lamports: number): TradeQuote {
  const usdcAmount = Math.round((lamports / 1e9) * 150 * 1e6);
  return {
    requestId: 'mock-req-1',
    contextSlot: 123456,
    inAmount: String(lamports),
    inputMint: 'So11111111111111111111111111111111111111112',
    outAmount: String(usdcAmount),
    outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    minOutAmount: String(Math.round(usdcAmount * 0.995)),
    otherAmountThreshold: String(Math.round(usdcAmount * 0.995)),
    priceImpactPct: '0.01',
    slippageBps: 50,
    routePlan: [
      {
        venue: 'Orca',
        inAmount: String(lamports),
        outAmount: String(usdcAmount),
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        inputMintDecimals: 9,
        outputMintDecimals: 6,
        marketKey: 'MarketAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        data: '',
      },
    ],
    platformFee: {
      amount: '0',
      feeBps: 0,
      feeAccount: '',
      segmenterFeeAmount: '0',
      segmenterFeePct: 0,
    },
    outTransferFee: '0',
    simulatedComputeUnits: 200_000,
  };
}

// ─── Mock BagsAdapter ──────────────────────────────────────────

function mockBagsAdapter(): BagsAdapter {
  const position = makeMockPosition();

  return {
    getClaimablePositions: async () => [position],
    getTotalClaimableSol: async () => ({
      totalLamports: 10_000_000_000n,
      positions: [position],
    }),
    getClaimTransactions: async () => [
      {
        tx: 'mock-claim-tx-base64',
        blockhash: {
          blockhash: 'MockBlockhash11111111111111111111111111111111',
          lastValidBlockHeight: 999999,
        },
      },
    ],
    getTradeQuote: async (params) => makeMockTradeQuote(params.amount),
    createSwapTransaction: async () => ({
      swapTransaction: 'mock-swap-tx-base64',
      computeUnitLimit: 200_000,
      lastValidBlockHeight: 999999,
      prioritizationFeeLamports: 5000,
    }),
    prepareSwap: async (params) => ({
      quote: makeMockTradeQuote(params.amount),
      swapTx: {
        swapTransaction: 'mock-swap-tx-base64',
        computeUnitLimit: 200_000,
        lastValidBlockHeight: 999999,
        prioritizationFeeLamports: 5000,
      },
    }),
    getRateLimitStatus: () => ({
      remaining: 100,
      limit: 100,
      resetAt: Date.now() + 60_000,
    }),
  };
}

// ─── Mock HeliusClient ─────────────────────────────────────────

function mockHeliusClient(): HeliusClient {
  return {
    getTokenAccounts: async () => [...MOCK_HOLDERS],
    getTopHolders: async (_mint: string, topN: number) => {
      const sorted = [...MOCK_HOLDERS].sort((a, b) => {
        if (a.balance > b.balance) return -1;
        if (a.balance < b.balance) return 1;
        return 0;
      });
      return sorted.slice(0, topN);
    },
    calculateDistributionWeights: (holders: TokenHolder[]): WeightedHolder[] => {
      const totalBalance = holders.reduce((sum, h) => sum + h.balance, 0n);
      if (totalBalance === 0n) return [];
      return holders.map((h) => ({
        owner: h.owner,
        weight: (h.balance * WEIGHT_SCALE) / totalBalance,
        balance: h.balance,
      }));
    },
  };
}

// ─── Mock CoinVoyageClient ─────────────────────────────────────

let payorderCounter = 0;

function mockCoinVoyageClient(): CoinVoyageClientAdapter {
  return {
    createSalePayOrder: async (params) => {
      payorderCounter += 1;
      const payOrder: PayOrder = {
        id: `po_e2e_${payorderCounter}`,
        status: 'PENDING',
        amountUsd: params.amountUsd,
        metadata: params.metadata,
      };
      return payOrder;
    },
    getPayOrder: async (payOrderId: string) => ({
      id: payOrderId,
      status: 'PENDING',
      amountUsd: 50,
    }),
  };
}

// ─── HMAC Helper ───────────────────────────────────────────────

function signPayload(body: string, secret: string = WEBHOOK_SECRET): string {
  return createHmac('sha256', secret).update(body).digest('base64');
}

// ─── Test Harness Builder ──────────────────────────────────────

interface CoinVoyageTestHarness {
  app: FastifyInstance;
  db: Database;
  conn: DatabaseConnection;
  giftCardService: GiftCardService;
}

async function buildCoinVoyageHarness(opts: {
  withCoinVoyage: boolean;
  configOverrides?: Partial<Config>;
}): Promise<CoinVoyageTestHarness> {
  const coinVoyageConfig = opts.withCoinVoyage
    ? {
        coinVoyageApiKey: COINVOYAGE_API_KEY,
        coinVoyageApiSecret: COINVOYAGE_API_SECRET,
        coinVoyageWebhookSecret: WEBHOOK_SECRET,
      }
    : {};

  const config = makeE2eConfig({
    ...coinVoyageConfig,
    ...opts.configOverrides,
  });

  const db = new Database(':memory:');
  const conn = await db.connect();
  await db.runMigrations();

  const strategyService = createStrategyService(conn);
  const runService = createRunService(conn);
  const auditService = createAuditService(conn);
  const travelBalanceService = createTravelBalanceService(conn);
  const giftCardService = createGiftCardService(conn);
  const executionPolicy = createExecutionPolicy(config, conn);
  const bags = mockBagsAdapter();
  const helius = mockHeliusClient();
  const runLock = createRunLock();

  const coinVoyageClient = opts.withCoinVoyage ? mockCoinVoyageClient() : undefined;

  const pipelineDeps: PipelineDeps = {
    runService,
    strategyService,
    auditService,
    executionPolicy,
    bags,
    config,
    helius,
    travelBalanceService,
    giftCardService,
    coinVoyageClient,
  };

  const pipelineEngine = createPipelineEngine(pipelineDeps);

  const routeDeps: RouteDeps = {
    strategyService,
    runService,
    travelBalanceService,
    giftCardService,
    pipelineEngine,
    runLock,
    db: conn,
    config,
    coinVoyageClient,
  };

  const app = await buildApp(routeDeps);

  return { app, db, conn, giftCardService };
}

// ─── Helper: create strategy via API ───────────────────────────

async function createStrategy(
  app: FastifyInstance,
  overrides?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/strategies',
    headers: {
      authorization: `Bearer ${TEST_TOKEN}`,
      'content-type': 'application/json',
    },
    payload: {
      name: 'CoinVoyage E2E Strategy',
      ownerWallet: OWNER_WALLET,
      tokenMint: TOKEN_MINT,
      distributionMode: 'TOP_N_HOLDERS',
      distributionTopN: 100,
      creditMode: 'GIFT_CARD',
      giftCardThresholdUsd: 10,
      thresholdSol: 5,
      ...overrides,
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json() as Record<string, unknown>;
}

// ─── Helper: trigger pipeline run ──────────────────────────────

async function triggerRun(
  app: FastifyInstance,
  strategyId: string,
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/runs',
    headers: {
      authorization: `Bearer ${TEST_TOKEN}`,
      'content-type': 'application/json',
    },
    payload: { strategyId: Number(strategyId) },
  });
  return { statusCode: res.statusCode, body: res.json() as Record<string, unknown> };
}

// ─── Helper: POST webhook event ────────────────────────────────

async function postWebhook(
  app: FastifyInstance,
  event: Record<string, unknown>,
  opts?: { secret?: string; omitSignature?: boolean },
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const bodyStr = JSON.stringify(event);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };

  if (!opts?.omitSignature) {
    const secret = opts?.secret ?? WEBHOOK_SECRET;
    headers['coinvoyage-webhook-signature'] = signPayload(bodyStr, secret);
  }

  const res = await app.inject({
    method: 'POST',
    url: '/api/webhooks/coinvoyage',
    headers,
    payload: bodyStr,
  });
  return { statusCode: res.statusCode, body: res.json() as Record<string, unknown> };
}

// ═══════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════

describe('CoinVoyage E2E: Async Gift Card Flow', () => {
  let harness: CoinVoyageTestHarness;

  beforeEach(async () => {
    payorderCounter = 0;
    harness = await buildCoinVoyageHarness({ withCoinVoyage: true });
  });

  afterEach(async () => {
    await harness.app.close();
    harness.db.close();
  });

  it('pipeline creates PENDING gift cards with payorder_id when CoinVoyage is configured', async () => {
    const strategy = await createStrategy(harness.app);
    const strategyId = strategy.strategyId as string;

    const { statusCode, body: run } = await triggerRun(harness.app, strategyId);

    expect(statusCode).toBe(201);
    expect(run.status).toBe('COMPLETE');
    expect(run.giftCardsPurchased).toBeGreaterThan(0);

    // Verify gift cards via credits API
    const creditsRes = await harness.app.inject({
      method: 'GET',
      url: `/api/credits?strategyId=${strategyId}`,
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
    });
    expect(creditsRes.statusCode).toBe(200);
    const credits = creditsRes.json() as Array<Record<string, unknown>>;
    expect(credits.length).toBeGreaterThan(0);

    // All gift cards should be PENDING with a payorder_id
    for (const credit of credits) {
      expect(credit.status).toBe('PENDING');
      expect(credit.payorderId).toBeTruthy();
      expect((credit.payorderId as string).startsWith('po_e2e_')).toBe(true);
      // PENDING cards have no encrypted code (K from T02)
      expect(credit.codeEncrypted).toBeFalsy();
    }
  });

  it('full async flow: pipeline → PENDING → webhook → PURCHASED', async () => {
    const strategy = await createStrategy(harness.app);
    const strategyId = strategy.strategyId as string;

    // Step 1: Run pipeline → creates PENDING gift cards
    const { body: run } = await triggerRun(harness.app, strategyId);
    expect(run.status).toBe('COMPLETE');

    // Step 2: Read PENDING gift cards from DB
    const creditsRes = await harness.app.inject({
      method: 'GET',
      url: `/api/credits?strategyId=${strategyId}`,
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
    });
    const credits = creditsRes.json() as Array<Record<string, unknown>>;
    expect(credits.length).toBeGreaterThan(0);

    // Step 3: Simulate webhook completion for each gift card
    for (const credit of credits) {
      const payorderId = credit.payorderId as string;
      const giftCardCode = `GC-${payorderId}-CODE`;

      const { statusCode, body: webhookResult } = await postWebhook(harness.app, {
        event: 'payorder.completed',
        payorder_id: payorderId,
        status: 'COMPLETED',
        gift_card_code: giftCardCode,
      });

      expect(statusCode).toBe(200);
      expect(webhookResult.status).toBe('processed');
      expect(webhookResult.newStatus).toBe('PURCHASED');
    }

    // Step 4: Verify all gift cards are now PURCHASED
    const updatedCreditsRes = await harness.app.inject({
      method: 'GET',
      url: `/api/credits?strategyId=${strategyId}`,
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
    });
    const updatedCredits = updatedCreditsRes.json() as Array<Record<string, unknown>>;

    for (const credit of updatedCredits) {
      expect(credit.status).toBe('PURCHASED');
      // Purchased cards should have an encrypted code
      expect(credit.codeEncrypted).toBeTruthy();
    }
  });

  it('duplicate webhook for already-PURCHASED card returns 200 (idempotent)', async () => {
    const strategy = await createStrategy(harness.app);
    const strategyId = strategy.strategyId as string;

    // Run pipeline
    const { body: run } = await triggerRun(harness.app, strategyId);
    expect(run.status).toBe('COMPLETE');

    // Get first credit
    const creditsRes = await harness.app.inject({
      method: 'GET',
      url: `/api/credits?strategyId=${strategyId}`,
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
    });
    const credits = creditsRes.json() as Array<Record<string, unknown>>;
    const payorderId = credits[0]!.payorderId as string;

    // First webhook → PURCHASED
    await postWebhook(harness.app, {
      event: 'payorder.completed',
      payorder_id: payorderId,
      status: 'COMPLETED',
      gift_card_code: 'GC-DUPLICATE-TEST',
    });

    // Second webhook → should be idempotent 200
    const { statusCode, body } = await postWebhook(harness.app, {
      event: 'payorder.completed',
      payorder_id: payorderId,
      status: 'COMPLETED',
      gift_card_code: 'GC-DUPLICATE-TEST-2',
    });

    expect(statusCode).toBe(200);
    expect(body.status).toBe('already_processed');
  });

  it('failed payorder webhook transitions PENDING → EXPIRED', async () => {
    const strategy = await createStrategy(harness.app);
    const strategyId = strategy.strategyId as string;

    // Run pipeline → PENDING gift cards
    const { body: run } = await triggerRun(harness.app, strategyId);
    expect(run.status).toBe('COMPLETE');

    // Get first credit
    const creditsRes = await harness.app.inject({
      method: 'GET',
      url: `/api/credits?strategyId=${strategyId}`,
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
    });
    const credits = creditsRes.json() as Array<Record<string, unknown>>;
    const payorderId = credits[0]!.payorderId as string;

    // Send failed webhook
    const { statusCode, body } = await postWebhook(harness.app, {
      event: 'payorder.failed',
      payorder_id: payorderId,
      status: 'FAILED',
    });

    expect(statusCode).toBe(200);
    expect(body.status).toBe('processed');
    expect(body.newStatus).toBe('EXPIRED');

    // Verify in DB
    const giftCard = await harness.giftCardService.getByPayorderId(payorderId);
    expect(giftCard).toBeDefined();
    expect(giftCard!.status).toBe('EXPIRED');
  });
});

// ─── Invalid HMAC ──────────────────────────────────────────────

describe('CoinVoyage E2E: Webhook Security', () => {
  let harness: CoinVoyageTestHarness;

  beforeEach(async () => {
    payorderCounter = 0;
    harness = await buildCoinVoyageHarness({ withCoinVoyage: true });
  });

  afterEach(async () => {
    await harness.app.close();
    harness.db.close();
  });

  it('webhook with invalid HMAC signature returns 401', async () => {
    const { statusCode, body } = await postWebhook(
      harness.app,
      {
        event: 'payorder.completed',
        payorder_id: 'po_e2e_1',
        status: 'COMPLETED',
        gift_card_code: 'GC-INVALID',
      },
      { secret: 'wrong-secret-key' },
    );

    expect(statusCode).toBe(401);
    expect(body.error).toBe('Invalid signature');
  });

  it('webhook with missing signature returns 401', async () => {
    const { statusCode, body } = await postWebhook(
      harness.app,
      {
        event: 'payorder.completed',
        payorder_id: 'po_e2e_1',
        status: 'COMPLETED',
        gift_card_code: 'GC-NOSIG',
      },
      { omitSignature: true },
    );

    expect(statusCode).toBe(401);
    expect(body.error).toBe('Missing signature');
  });
});

// ─── Graceful Degradation ──────────────────────────────────────

describe('CoinVoyage E2E: Graceful Degradation (no CoinVoyage configured)', () => {
  let harness: CoinVoyageTestHarness;

  beforeEach(async () => {
    harness = await buildCoinVoyageHarness({ withCoinVoyage: false });
  });

  afterEach(async () => {
    await harness.app.close();
    harness.db.close();
  });

  it('pipeline without CoinVoyage generates stub TRAVEL-XXXXXXXX codes with PURCHASED status', async () => {
    const strategy = await createStrategy(harness.app);
    const strategyId = strategy.strategyId as string;

    const { statusCode, body: run } = await triggerRun(harness.app, strategyId);

    expect(statusCode).toBe(201);
    expect(run.status).toBe('COMPLETE');
    expect(run.giftCardsPurchased).toBeGreaterThan(0);

    // Verify gift cards via credits API
    const creditsRes = await harness.app.inject({
      method: 'GET',
      url: `/api/credits?strategyId=${strategyId}`,
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
    });
    expect(creditsRes.statusCode).toBe(200);
    const credits = creditsRes.json() as Array<Record<string, unknown>>;
    expect(credits.length).toBeGreaterThan(0);

    // All gift cards should be immediately PURCHASED with encrypted codes
    for (const credit of credits) {
      expect(credit.status).toBe('PURCHASED');
      expect(credit.codeEncrypted).toBeTruthy();
      // Stub cards have no payorder_id
      expect(credit.payorderId).toBeNull();
    }
  });

  it('webhook endpoint returns 503 when coinVoyageWebhookSecret is not configured', async () => {
    const { statusCode, body } = await postWebhook(
      harness.app,
      {
        event: 'payorder.completed',
        payorder_id: 'po_test_1',
        status: 'COMPLETED',
        gift_card_code: 'GC-503',
      },
    );

    expect(statusCode).toBe(503);
    expect(body.error).toBe('Webhook endpoint not configured');
  });
});
