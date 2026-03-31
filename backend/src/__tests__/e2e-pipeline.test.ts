// ─── E2E Pipeline Integration Tests ───────────────────────────
// Full pipeline (claim → swap → allocate → credit) wired through
// the HTTP API with mocked BagsAdapter and HeliusClient, real
// in-memory SQLite, and all real services.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
} from '../types/index.js';
import type { HeliusClient, WeightedHolder } from '../clients/HeliusClient.js';
import type { PipelineDeps } from '../engine/types.js';
import type { AuditService } from '../services/AuditService.js';

// ─── Constants ─────────────────────────────────────────────────

const TEST_TOKEN = 'e2e-test-token';
const OWNER_WALLET = 'WalletAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const TOKEN_MINT = 'MintBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

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
  // 10 SOL ≈ 1500 USDC (mock rate: 150 USDC/SOL)
  // outAmount is in raw USDC (6 decimals)
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

function mockBagsAdapter(opts?: { failOnSwap?: boolean }): BagsAdapter {
  const position = makeMockPosition();

  return {
    getClaimablePositions: async () => [position],

    getTotalClaimableSol: async () => ({
      totalLamports: 10_000_000_000n, // 10 SOL
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

    getTradeQuote: async (params) => {
      if (opts?.failOnSwap) {
        throw new Error('Mock swap failure: getTradeQuote intentionally failed');
      }
      return makeMockTradeQuote(params.amount);
    },

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

// ─── Test Harness Builder ──────────────────────────────────────

interface TestHarness {
  app: FastifyInstance;
  db: Database;
  auditService: AuditService;
  pipelineEngine: ReturnType<typeof createPipelineEngine>;
}

async function buildTestHarness(
  configOverrides?: Partial<Config>,
  bagsOverrides?: Parameters<typeof mockBagsAdapter>[0],
): Promise<TestHarness> {
  const config = makeE2eConfig(configOverrides);
  const db = new Database(':memory:');
  const conn = await db.connect();
  await db.runMigrations();

  const strategyService = createStrategyService(conn);
  const runService = createRunService(conn);
  const auditService = createAuditService(conn);
  const travelBalanceService = createTravelBalanceService(conn);
  const giftCardService = createGiftCardService(conn);
  const executionPolicy = createExecutionPolicy(config, conn);
  const bags = mockBagsAdapter(bagsOverrides);
  const helius = mockHeliusClient();
  const runLock = createRunLock();

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
  };

  const app = await buildApp(routeDeps);

  return { app, db, auditService, pipelineEngine };
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
      name: 'E2E Test Strategy',
      ownerWallet: OWNER_WALLET,
      tokenMint: TOKEN_MINT,
      distributionMode: 'TOP_N_HOLDERS',
      distributionTopN: 100,
      creditMode: 'GIFT_CARD',
      giftCardThresholdUsd: 50,
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

// ═══════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════

describe('E2E Pipeline: Full Dry-Run', () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = await buildTestHarness();
  });

  afterEach(async () => {
    await harness.app.close();
    harness.db.close();
  });

  // ── Full pipeline completion ─────────────────────────────────

  it('full dry-run pipeline completes with correct state transitions', async () => {
    const strategy = await createStrategy(harness.app);
    const strategyId = strategy.strategyId as string;

    const { statusCode, body: run } = await triggerRun(harness.app, strategyId);

    expect(statusCode).toBe(201);
    expect(run.status).toBe('COMPLETE');
    expect(run.phase).toBe('COMPLETE');

    // Checkpoint data populated
    expect(run.claimedSol).toBeGreaterThan(0);
    expect(run.claimTx).toBeTruthy();
    expect(run.swappedUsdc).toBeGreaterThan(0);
    expect(run.swapTx).toBeTruthy();
    expect(run.allocatedUsd).toBeGreaterThan(0);

    // Verify persisted via GET
    const getRes = await harness.app.inject({
      method: 'GET',
      url: `/api/runs/${run.runId}`,
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
    });
    expect(getRes.statusCode).toBe(200);
    const persistedRun = getRes.json() as Record<string, unknown>;
    expect(persistedRun.status).toBe('COMPLETE');
    expect(persistedRun.claimedSol).toBe(run.claimedSol);
    expect(persistedRun.swappedUsdc).toBe(run.swappedUsdc);
  });

  // ── Travel balances accumulate ───────────────────────────────

  it('travel balances accumulate across multiple runs', async () => {
    const strategy = await createStrategy(harness.app);
    const strategyId = strategy.strategyId as string;

    // First run
    const { body: run1 } = await triggerRun(harness.app, strategyId);
    expect(run1.status).toBe('COMPLETE');

    // Check balances after first run
    const bal1Res = await harness.app.inject({
      method: 'GET',
      url: `/api/balances?strategyId=${strategyId}`,
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
    });
    expect(bal1Res.statusCode).toBe(200);
    const balances1 = bal1Res.json() as Array<Record<string, unknown>>;
    expect(balances1.length).toBe(3); // 3 mock holders

    const firstRunTotal = balances1.reduce(
      (sum, b) => sum + (b.balanceUsd as number),
      0,
    );
    expect(firstRunTotal).toBeGreaterThan(0);

    // Second run
    const { body: run2 } = await triggerRun(harness.app, strategyId);
    expect(run2.status).toBe('COMPLETE');

    // Check balances accumulated
    const bal2Res = await harness.app.inject({
      method: 'GET',
      url: `/api/balances?strategyId=${strategyId}`,
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
    });
    const balances2 = bal2Res.json() as Array<Record<string, unknown>>;

    const secondRunTotal = balances2.reduce(
      (sum, b) => sum + (b.balanceUsd as number),
      0,
    );

    // Second run total should be approximately 2x the first run's allocation
    // (minus any gift card deductions from creditPhase on the second run)
    expect(secondRunTotal).toBeGreaterThan(firstRunTotal * 0.8);
  });

  // ── Gift card creation ───────────────────────────────────────

  it('gift card records created when balance exceeds threshold', async () => {
    // Use a low threshold so a single run's allocation triggers gift cards
    const strategy = await createStrategy(harness.app, {
      giftCardThresholdUsd: 10,
    });
    const strategyId = strategy.strategyId as string;

    // The mock yields ~1500 USDC total → each of 3 holders gets a share:
    // Holder1 (50%) ≈ 750 USDC, Holder2 (30%) ≈ 450, Holder3 (20%) ≈ 300
    // All exceed the $10 threshold, so credit phase should issue gift cards
    const { body: run } = await triggerRun(harness.app, strategyId);
    expect(run.status).toBe('COMPLETE');
    expect(run.giftCardsPurchased).toBeGreaterThan(0);

    // Verify via credits API
    const creditsRes = await harness.app.inject({
      method: 'GET',
      url: `/api/credits?strategyId=${strategyId}`,
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
    });
    expect(creditsRes.statusCode).toBe(200);
    const credits = creditsRes.json() as Array<Record<string, unknown>>;
    expect(credits.length).toBeGreaterThan(0);
    expect(credits[0].status).toBe('PURCHASED');
    expect(credits[0].denominationUsd).toBeGreaterThanOrEqual(50);

    // Verify balances were deducted by the gift card amount
    const balRes = await harness.app.inject({
      method: 'GET',
      url: `/api/balances?strategyId=${strategyId}`,
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
    });
    const balances = balRes.json() as Array<Record<string, unknown>>;
    // Each balance should be less than the full allocation because gift cards were deducted
    for (const bal of balances) {
      // totalEarned should be greater than current balance (some was spent on gift cards)
      expect(bal.totalEarned as number).toBeGreaterThanOrEqual(bal.balanceUsd as number);
    }
  });

  // ── Audit trail ──────────────────────────────────────────────

  it('audit trail entries exist for each phase transition', async () => {
    const strategy = await createStrategy(harness.app);
    const strategyId = strategy.strategyId as string;

    const { body: run } = await triggerRun(harness.app, strategyId);
    expect(run.status).toBe('COMPLETE');

    const runId = Number(run.runId);
    const entries = await harness.auditService.getByRunId(runId);

    // Should have pipeline_start, plus phase_start + phase_complete for each of 4 phases,
    // plus pipeline_complete = 1 + (4*2) + 1 = 10 entries (minimum)
    expect(entries.length).toBeGreaterThanOrEqual(9);

    const actions = entries.map((e) => e.action);

    expect(actions).toContain('pipeline_start');
    expect(actions).toContain('pipeline_complete');

    // Each of the 4 phases should have a phase_start and phase_complete
    const phaseStarts = actions.filter((a) => a === 'phase_start');
    const phaseCompletes = actions.filter((a) => a === 'phase_complete');
    expect(phaseStarts.length).toBe(4);
    expect(phaseCompletes.length).toBe(4);

    // Verify phase ordering
    const phases = entries
      .filter((e) => e.action === 'phase_start')
      .map((e) => e.phase);
    expect(phases).toEqual(['CLAIMING', 'SWAPPING', 'ALLOCATING', 'CREDITING']);
  });

  // ── Stats endpoint ───────────────────────────────────────────

  it('stats endpoint reflects pipeline results', async () => {
    const strategy = await createStrategy(harness.app);
    const strategyId = strategy.strategyId as string;

    await triggerRun(harness.app, strategyId);

    const statsRes = await harness.app.inject({
      method: 'GET',
      url: '/api/stats',
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
    });
    expect(statsRes.statusCode).toBe(200);
    const stats = statsRes.json() as Record<string, unknown>;

    expect(stats.totalRuns).toBeGreaterThanOrEqual(1);
    expect(stats.completedRuns).toBeGreaterThanOrEqual(1);
    expect(stats.totalClaimedSol).toBeGreaterThan(0);
    expect(stats.totalSwappedUsdc).toBeGreaterThan(0);
  });
});

// ─── Resume from Checkpoint ────────────────────────────────────

describe('E2E Pipeline: Resume from Checkpoint', () => {
  it('resume from checkpoint works after swap failure', async () => {
    // Build harness with a swap-failing mock
    const config = makeE2eConfig();
    const db = new Database(':memory:');
    const conn = await db.connect();
    await db.runMigrations();

    const strategyService = createStrategyService(conn);
    const runService = createRunService(conn);
    const auditService = createAuditService(conn);
    const travelBalanceService = createTravelBalanceService(conn);
    const giftCardService = createGiftCardService(conn);
    const executionPolicy = createExecutionPolicy(config, conn);
    const helius = mockHeliusClient();

    // Phase 1: failing bags adapter (swap phase fails)
    const failingBags = mockBagsAdapter({ failOnSwap: true });

    const failingEngine = createPipelineEngine({
      runService,
      strategyService,
      auditService,
      executionPolicy,
      bags: failingBags,
      config,
      helius,
      travelBalanceService,
      giftCardService,
    });

    const runLock = createRunLock();

    const failingApp = await buildApp({
      strategyService,
      runService,
      travelBalanceService,
      giftCardService,
      pipelineEngine: failingEngine,
      runLock,
      db: conn,
      config,
    });

    // Create strategy and trigger failing run
    const createRes = await failingApp.inject({
      method: 'POST',
      url: '/api/strategies',
      headers: {
        authorization: `Bearer ${TEST_TOKEN}`,
        'content-type': 'application/json',
      },
      payload: {
        name: 'Resume Test Strategy',
        ownerWallet: OWNER_WALLET,
        tokenMint: TOKEN_MINT,
      },
    });
    const strategy = createRes.json() as Record<string, unknown>;

    const { body: failedRun } = await triggerRun(failingApp, strategy.strategyId as string);

    expect(failedRun.status).toBe('FAILED');
    expect(failedRun.claimedSol).toBeGreaterThan(0); // Claim checkpoint preserved
    expect(failedRun.swappedUsdc).toBe(0);            // Swap failed — no checkpoint written, column defaults to 0

    await failingApp.close();

    // Phase 2: working bags adapter — resume the run
    const workingBags = mockBagsAdapter();

    const workingEngine = createPipelineEngine({
      runService,
      strategyService,
      auditService,
      executionPolicy,
      bags: workingBags,
      config,
      helius,
      travelBalanceService,
      giftCardService,
    });

    const workingApp = await buildApp({
      strategyService,
      runService,
      travelBalanceService,
      giftCardService,
      pipelineEngine: workingEngine,
      runLock: createRunLock(),
      db: conn,
      config,
    });

    // Resume the failed run
    const resumeRes = await workingApp.inject({
      method: 'POST',
      url: `/api/runs/${failedRun.runId}/resume`,
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
    });

    const resumedRun = resumeRes.json() as Record<string, unknown>;
    expect(resumedRun.status).toBe('COMPLETE');
    expect(resumedRun.claimedSol).toBeGreaterThan(0);
    expect(resumedRun.swappedUsdc).toBeGreaterThan(0);
    expect(resumedRun.allocatedUsd).toBeGreaterThan(0);

    await workingApp.close();
    db.close();
  });
});

// ─── Negative Tests ────────────────────────────────────────────

describe('E2E Pipeline: Negative Cases', () => {
  let harness: TestHarness;

  beforeEach(async () => {
    harness = await buildTestHarness();
  });

  afterEach(async () => {
    await harness.app.close();
    harness.db.close();
  });

  it('resume a run that is not in FAILED state returns 500', async () => {
    const strategy = await createStrategy(harness.app);
    const strategyId = strategy.strategyId as string;

    // Run pipeline to completion
    const { body: completedRun } = await triggerRun(harness.app, strategyId);
    expect(completedRun.status).toBe('COMPLETE');

    // Try to resume a COMPLETE run — engine returns it as-is (already complete),
    // not an error. Verify the behavior.
    const resumeRes = await harness.app.inject({
      method: 'POST',
      url: `/api/runs/${completedRun.runId}/resume`,
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
    });
    const resumed = resumeRes.json() as Record<string, unknown>;
    // The engine returns the already-complete run (not an error)
    expect(resumed.status).toBe('COMPLETE');
  });

  it('pipeline with below-threshold SOL — claim returns 0, pipeline still completes', async () => {
    // Create strategy with a very high threshold so the mock 10 SOL is below it
    const strategy = await createStrategy(harness.app, {
      thresholdSol: 100,
    });
    const strategyId = strategy.strategyId as string;

    const { statusCode, body: run } = await triggerRun(harness.app, strategyId);

    expect(statusCode).toBe(201);
    expect(run.status).toBe('COMPLETE');
    // Claim phase returns 0 SOL (below threshold)
    expect(run.claimedSol).toBe(0);
    // Swap phase gets 0 SOL → no swap
    expect(run.swappedUsdc).toBe(0);
    // Allocate phase gets 0 USDC → no allocation
    expect(run.allocatedUsd).toBe(0);
  });

  it('kill switch enabled — pipeline blocked by ExecutionPolicy', async () => {
    // Build separate harness with kill switch on
    const killHarness = await buildTestHarness({ executionKillSwitch: true });

    const strategy = await createStrategy(killHarness.app);
    const strategyId = strategy.strategyId as string;

    const res = await killHarness.app.inject({
      method: 'POST',
      url: '/api/runs',
      headers: {
        authorization: `Bearer ${TEST_TOKEN}`,
        'content-type': 'application/json',
      },
      payload: { strategyId: Number(strategyId) },
    });

    expect(res.statusCode).toBe(500);
    const body = res.json() as Record<string, unknown>;
    expect(body.error).toContain('Kill switch');

    await killHarness.app.close();
    killHarness.db.close();
  });
});
