// ─── Resilience Integration Tests ──────────────────────────────
// Slice-level tests proving that circuit breakers, phase retry,
// and the /health/ready endpoint work together end-to-end.
// Uses real Fastify app + in-memory SQLite + mocked external clients.

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
import { CircuitBreaker } from '../utils/resilience.js';
import { wrapWithResilience } from '../clients/ResilientClientWrapper.js';
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

// ─── Constants ─────────────────────────────────────────────────

const TEST_TOKEN = 'resilience-test-token';
const OWNER_WALLET = 'WalletAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const TOKEN_MINT = 'MintBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

const MOCK_HOLDERS: TokenHolder[] = [
  { address: 'Acct1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', owner: 'Holder1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', balance: 500_000n },
  { address: 'Acct2AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', owner: 'Holder2AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', balance: 300_000n },
  { address: 'Acct3AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', owner: 'Holder3AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', balance: 200_000n },
];

// ─── Config ────────────────────────────────────────────────────

function makeConfig(overrides?: Partial<Config>): Config {
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

// ─── Mock Position & Quote ─────────────────────────────────────

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
        venue: 'Orca', inAmount: String(lamports), outAmount: String(usdcAmount),
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        inputMintDecimals: 9, outputMintDecimals: 6,
        marketKey: 'MarketAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', data: '',
      },
    ],
    platformFee: { amount: '0', feeBps: 0, feeAccount: '', segmenterFeeAmount: '0', segmenterFeePct: 0 },
    outTransferFee: '0',
    simulatedComputeUnits: 200_000,
  };
}

// ─── Mock Adapters ─────────────────────────────────────────────

function makeMockBags(opts?: {
  failClaimCount?: number;
}): BagsAdapter {
  const position = makeMockPosition();
  let claimCallCount = 0;
  const failCount = opts?.failClaimCount ?? 0;

  return {
    getClaimablePositions: async () => {
      claimCallCount++;
      if (claimCallCount <= failCount) {
        const err = new Error('Bags API: 503 Service Temporarily Unavailable');
        (err as any).status = 503;
        throw err;
      }
      return [position];
    },

    getTotalClaimableSol: async () => {
      // This is called before getClaimablePositions in claimPhase
      return { totalLamports: 10_000_000_000n, positions: [position] };
    },

    getClaimTransactions: async () => [
      {
        tx: 'mock-claim-tx-base64',
        blockhash: { blockhash: 'MockBlockhash11111111111111111111111111111111', lastValidBlockHeight: 999999 },
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
      remaining: 100, limit: 100, resetAt: Date.now() + 60_000,
    }),
  };
}

/** Mock BagsAdapter that always fails with transient 503 errors. */
function makeAlwaysFailingBags(): BagsAdapter {
  const fail = async () => {
    const err = new Error('Bags API: 503 Service Temporarily Unavailable');
    (err as any).status = 503;
    throw err;
  };

  return {
    getClaimablePositions: fail,
    getTotalClaimableSol: fail,
    getClaimTransactions: fail,
    getTradeQuote: fail,
    createSwapTransaction: fail,
    prepareSwap: fail,
    getRateLimitStatus: () => ({ remaining: 0, limit: 100, resetAt: Date.now() + 60_000 }),
  };
}

function makeMockHelius(): HeliusClient {
  return {
    getTokenAccounts: async () => [...MOCK_HOLDERS],
    getTopHolders: async (_mint: string, topN: number) => {
      const sorted = [...MOCK_HOLDERS].sort((a, b) =>
        a.balance > b.balance ? -1 : a.balance < b.balance ? 1 : 0,
      );
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

// ─── Harness Builder ───────────────────────────────────────────

interface ResilienceHarness {
  app: FastifyInstance;
  db: Database;
  circuitBreakers: Record<string, CircuitBreaker>;
}

async function buildResilienceHarness(opts: {
  bags: BagsAdapter;
  wrapBags?: boolean;
}): Promise<ResilienceHarness> {
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
  const helius = makeMockHelius();
  const runLock = createRunLock();

  const circuitBreakers: Record<string, CircuitBreaker> = {};

  // Wrap bags with resilience (circuit breaker + retry) if requested
  let bags: BagsAdapter;
  if (opts.wrapBags !== false) {
    const wrapped = wrapWithResilience('bags', opts.bags, {
      circuitBreaker: { failureThreshold: 3, resetTimeoutMs: 60_000 },
      retry: {
        maxRetries: 2,
        baseDelayMs: 1,   // Near-instant for tests
        maxDelayMs: 5,
        delayFn: async () => {},  // No-op delay for speed
      },
    });
    bags = wrapped.client;
    circuitBreakers.bags = wrapped.circuitBreaker;
  } else {
    bags = opts.bags;
  }

  // Helius gets a circuit breaker too (for health endpoint)
  const heliusCb = new CircuitBreaker({ name: 'helius', failureThreshold: 5 });
  circuitBreakers.helius = heliusCb;

  const pipelineDeps: PipelineDeps & { phaseRetryDelayFn: (ms: number) => Promise<void> } = {
    runService, strategyService, auditService, executionPolicy,
    bags, config, helius, travelBalanceService, giftCardService,
    circuitBreakers,
    phaseRetryDelayFn: async () => {},  // No-op — instant phase retries
  };
  const pipelineEngine = createPipelineEngine(pipelineDeps);

  const routeDeps: RouteDeps = {
    strategyService, runService, travelBalanceService, giftCardService,
    pipelineEngine, runLock, db: conn, config,
    circuitBreakers,
  };

  const app = await buildApp(routeDeps);
  return { app, db, circuitBreakers };
}

// ─── Helpers ───────────────────────────────────────────────────

async function createStrategy(app: FastifyInstance): Promise<Record<string, unknown>> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/strategies',
    headers: { authorization: `Bearer ${TEST_TOKEN}`, 'content-type': 'application/json' },
    payload: {
      name: 'Resilience Test Strategy',
      ownerWallet: OWNER_WALLET,
      tokenMint: TOKEN_MINT,
      distributionMode: 'TOP_N_HOLDERS',
      distributionTopN: 100,
      creditMode: 'GIFT_CARD',
      giftCardThresholdUsd: 50,
      thresholdSol: 5,
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json() as Record<string, unknown>;
}

async function triggerRun(app: FastifyInstance, strategyId: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/runs',
    headers: { authorization: `Bearer ${TEST_TOKEN}`, 'content-type': 'application/json' },
    payload: { strategyId: Number(strategyId) },
  });
  return { statusCode: res.statusCode, body: res.json() as Record<string, unknown> };
}

// ═══════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════

describe('Resilience Integration', () => {
  let harness: ResilienceHarness;

  afterEach(async () => {
    if (harness) {
      await harness.app.close();
      harness.db.close();
    }
  });

  // ── Transient error + retry succeeds ─────────────────────────

  it('pipeline retries transient error and completes successfully', async () => {
    // getTotalClaimableSol is called first and succeeds, then
    // getClaimablePositions fails once with 503, then succeeds.
    // The resilience wrapper's retry should handle this transparently.
    const bags = makeMockBags({ failClaimCount: 1 });
    harness = await buildResilienceHarness({ bags });

    const strategy = await createStrategy(harness.app);
    const { statusCode, body } = await triggerRun(harness.app, strategy.strategyId as string);

    expect(statusCode).toBe(201);
    expect(body.status).toBe('COMPLETE');
    expect(body.claimedSol).toBeGreaterThan(0);
    expect(body.swappedUsdc).toBeGreaterThan(0);

    // Circuit breaker should still be CLOSED after the transient recovery
    const snap = harness.circuitBreakers.bags.snapshot();
    expect(snap.state).toBe('CLOSED');
  });

  // ── Sustained failures → circuit breaker trips ───────────────

  it('sustained failures trip circuit breaker and pipeline reaches FAILED', async () => {
    const bags = makeAlwaysFailingBags();
    harness = await buildResilienceHarness({ bags });

    const strategy = await createStrategy(harness.app);
    const { statusCode, body } = await triggerRun(harness.app, strategy.strategyId as string);

    // Pipeline should reach FAILED
    expect(statusCode).toBe(201);
    expect(body.status).toBe('FAILED');

    // Check the error message contains circuit breaker diagnostic info.
    // The wrapWithResilience wrapper throws CircuitOpenError once the
    // breaker trips, whose message includes 'Circuit breaker' and 'OPEN'.
    const errorMsg = (body.errorMessage as string) ?? '';
    const hasCircuitRef =
      errorMsg.toLowerCase().includes('circuit') ||
      errorMsg.toLowerCase().includes('breaker') ||
      errorMsg.includes('503');
    expect(hasCircuitRef).toBe(true);

    // Circuit breaker should be OPEN after sustained failures
    const snap = harness.circuitBreakers.bags.snapshot();
    expect(snap.state).toBe('OPEN');
    expect(snap.failures).toBeGreaterThanOrEqual(3);
  });

  // ── Health endpoint reflects circuit breaker state ───────────

  it('/health/ready reflects circuit breaker state after pipeline failures', async () => {
    const bags = makeAlwaysFailingBags();
    harness = await buildResilienceHarness({ bags });

    // Before any failures — health should be ready
    const healthBefore = await harness.app.inject({ method: 'GET', url: '/health/ready' });
    expect(healthBefore.statusCode).toBe(200);
    expect(healthBefore.json().status).toBe('ready');
    expect(healthBefore.json().checks.bags.state).toBe('CLOSED');

    // Trigger a failing pipeline run — this will trip the bags circuit breaker
    const strategy = await createStrategy(harness.app);
    await triggerRun(harness.app, strategy.strategyId as string);

    // After failures — health should reflect the tripped breaker
    const healthAfter = await harness.app.inject({ method: 'GET', url: '/health/ready' });
    expect(healthAfter.statusCode).toBe(503);

    const afterBody = healthAfter.json();
    expect(afterBody.status).toBe('not_ready');
    expect(afterBody.checks.bags.status).toBe('error');
    expect(afterBody.checks.bags.state).toBe('OPEN');
    expect(afterBody.checks.bags.lastFailure).toBeGreaterThan(0);
    // Helius still ok
    expect(afterBody.checks.helius.status).toBe('ok');
    expect(afterBody.checks.database.status).toBe('ok');
  });
});
