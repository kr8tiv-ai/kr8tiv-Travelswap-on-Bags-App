// ─── PipelineEngine Integration Tests ──────────────────────────
// Tests use real SQLite + mocked BagsAdapter to verify the full
// pipeline lifecycle: start, checkpoint, resume, and failure paths.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Database, type DatabaseConnection } from '../../services/Database.js';
import { createRunService, type RunService } from '../../services/RunService.js';
import { createStrategyService, type StrategyService } from '../../services/StrategyService.js';
import { createAuditService, type AuditService } from '../../services/AuditService.js';
import { createExecutionPolicy, type ExecutionPolicy } from '../ExecutionPolicy.js';
import { createPipelineEngine, PHASE_PIPELINE } from '../PipelineEngine.js';
import type { BagsAdapter, ClaimablePosition, TradeQuote, ClaimTransaction, SwapTransaction } from '../../types/index.js';
import type { Config } from '../../config/index.js';
import type { PipelineDeps, PipelineEngine } from '../types.js';
import type { HeliusClient } from '../../clients/HeliusClient.js';
import { WEIGHT_SCALE } from '../../clients/HeliusClient.js';
import { createTravelBalanceService, type TravelBalanceService } from '../../services/TravelBalanceService.js';
import type { GiftCardService } from '../../services/GiftCardService.js';
import type { TravelSwapClient } from '../../clients/TravelSwapClient.js';

// ─── Test Helpers ──────────────────────────────────────────────

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    bagsApiKey: 'test-key',
    bagsApiBaseUrl: 'https://api.test.com',
    heliusApiKey: 'test-helius',
    heliusRpcUrl: 'https://rpc.test.com',
    apiAuthToken: 'test-token',
    giftCardEncryptionKey: 'a'.repeat(64),
    giftCardDailyLimit: 5,
    giftCardMaxDenomination: 100,
    balanceMaxUsd: 500,
    dryRun: true, // default to dry-run for tests
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
    port: 3001,
    databasePath: ':memory:',
    logLevel: 'error',
    nodeEnv: 'test',
    corsOrigins: '',
    ...overrides,
  };
}

function makePosition(overrides: Partial<ClaimablePosition> = {}): ClaimablePosition {
  return {
    isCustomFeeVault: false,
    baseMint: 'So11111111111111111111111111111111111111112',
    isMigrated: false,
    totalClaimableLamportsUserShare: 10_000_000_000, // 10 SOL
    programId: '',
    quoteMint: '',
    virtualPool: 'vpool1',
    virtualPoolAddress: 'vpaddr1',
    virtualPoolClaimableAmount: 1000,
    virtualPoolClaimableLamportsUserShare: 0,
    dammPoolClaimableAmount: 0,
    dammPoolClaimableLamportsUserShare: 0,
    dammPoolAddress: '',
    claimableDisplayAmount: 10,
    user: '',
    claimerIndex: 0,
    userBps: 0,
    customFeeVault: '',
    customFeeVaultClaimerA: '',
    customFeeVaultClaimerB: '',
    customFeeVaultClaimerSide: 'A' as const,
    ...overrides,
  };
}

function makeQuote(overrides: Partial<TradeQuote> = {}): TradeQuote {
  return {
    requestId: 'req-123',
    contextSlot: 100,
    inAmount: '10000000000', // 10 SOL in lamports
    inputMint: 'So11111111111111111111111111111111111111112',
    outAmount: '150000000', // 150 USDC in smallest units (6 decimals)
    outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    minOutAmount: '148500000',
    otherAmountThreshold: '148500000',
    priceImpactPct: '0.01',
    slippageBps: 50,
    routePlan: [],
    platformFee: { amount: '0', feeBps: 0, feeAccount: '', segmenterFeeAmount: '0', segmenterFeePct: 0 },
    outTransferFee: '0',
    simulatedComputeUnits: 200000,
    ...overrides,
  };
}

function makeClaimTx(): ClaimTransaction {
  return {
    tx: 'base64-encoded-claim-tx',
    blockhash: { blockhash: 'abc123', lastValidBlockHeight: 1000 },
  };
}

function makeSwapTx(): SwapTransaction {
  return {
    swapTransaction: 'base64-encoded-swap-tx',
    computeUnitLimit: 200000,
    lastValidBlockHeight: 1000,
    prioritizationFeeLamports: 5000,
  };
}

function createMockBags(overrides: Partial<BagsAdapter> = {}): BagsAdapter {
  return {
    getClaimablePositions: vi.fn().mockResolvedValue([makePosition()]),
    getClaimTransactions: vi.fn().mockResolvedValue([makeClaimTx()]),
    getTradeQuote: vi.fn().mockResolvedValue(makeQuote()),
    createSwapTransaction: vi.fn().mockResolvedValue(makeSwapTx()),
    prepareSwap: vi.fn().mockResolvedValue({ quote: makeQuote(), swapTx: makeSwapTx() }),
    getTotalClaimableSol: vi.fn().mockResolvedValue({
      totalLamports: 10_000_000_000n,
      positions: [makePosition()],
    }),
    getRateLimitStatus: vi.fn().mockReturnValue({ remaining: 100, resetAt: 0 }),
    ...overrides,
  };
}

function createMockHelius(): HeliusClient {
  const holders = [
    { address: 'acct1', owner: 'wallet123', balance: 1000n },
  ];
  const totalBalance = 1000n;
  return {
    getTokenAccounts: vi.fn().mockResolvedValue(holders),
    getTopHolders: vi.fn().mockResolvedValue(holders),
    calculateDistributionWeights: vi.fn().mockImplementation(() =>
      holders.map((h) => ({
        owner: h.owner,
        weight: (h.balance * WEIGHT_SCALE) / totalBalance,
        balance: h.balance,
      })),
    ),
  };
}

// ─── Test Suite ────────────────────────────────────────────────

describe('PipelineEngine', () => {
  let db: Database;
  let conn: DatabaseConnection;
  let runService: RunService;
  let strategyService: StrategyService;
  let auditService: AuditService;
  let executionPolicy: ExecutionPolicy;
  let mockBags: BagsAdapter;
  let mockHelius: HeliusClient;
  let travelBalanceService: TravelBalanceService;
  let mockGiftCardService: GiftCardService;
  let mockTravelSwapClient: TravelSwapClient;
  let engine: PipelineEngine;
  let strategyId: number;
  let config: Config;

  beforeEach(async () => {
    db = new Database(':memory:');
    conn = await db.connect();
    await db.runMigrations();

    config = makeConfig();
    runService = createRunService(conn);
    strategyService = createStrategyService(conn);
    auditService = createAuditService(conn);
    executionPolicy = createExecutionPolicy(config, conn);
    mockBags = createMockBags();
    mockHelius = createMockHelius();
    travelBalanceService = createTravelBalanceService(conn);

    mockGiftCardService = {
      purchase: vi.fn().mockImplementation(async (_sId, _rId, wallet, denom, code) => ({
        giftCardId: '1',
        strategyId: String(_sId),
        runId: String(_rId),
        walletAddress: wallet,
        denominationUsd: denom,
        codeEncrypted: code,
        status: 'PURCHASED' as const,
        deliveredAt: null,
        redeemedAt: null,
        createdAt: new Date().toISOString(),
      })),
      getByWallet: vi.fn().mockResolvedValue([]),
      getByRun: vi.fn().mockResolvedValue([]),
      getByStrategy: vi.fn().mockResolvedValue([]),
      updateStatus: vi.fn().mockResolvedValue(undefined),
    };

    mockTravelSwapClient = {
      getBookingUrl: vi.fn().mockReturnValue('https://travelswap.xyz/book?ref=FLIGHTBRAIN'),
      getGiftCardUrl: vi.fn().mockReturnValue('https://travelswap.xyz/gift-card?ref=FLIGHTBRAIN'),
    };

    // Create a strategy for the tests
    const strategy = await strategyService.create({
      name: 'Test Strategy',
      ownerWallet: 'wallet123',
      tokenMint: 'So11111111111111111111111111111111111111112',
      thresholdSol: 5.0,
      slippageBps: 50,
    });
    strategyId = Number(strategy.strategyId);

    const deps: PipelineDeps = {
      runService,
      strategyService,
      auditService,
      executionPolicy,
      bags: mockBags,
      config,
      helius: mockHelius,
      travelBalanceService,
      giftCardService: mockGiftCardService,
      travelSwapClient: mockTravelSwapClient,
    };

    engine = createPipelineEngine({
      ...deps,
      phaseRetryDelayFn: async () => {},
    } as PipelineDeps & { phaseRetryDelayFn: () => Promise<void> });
  });

  afterEach(() => {
    db.close();
  });

  // ─── Full Pipeline ─────────────────────────────────────────

  describe('startRun() — full dry-run pipeline', () => {
    it('completes all 4 phases and marks run COMPLETE', async () => {
      const run = await engine.startRun(strategyId);

      expect(run.status).toBe('COMPLETE');
      expect(run.phase).toBe('COMPLETE');
    });

    it('persists checkpoint data: claimedSol and claimTx after CLAIMING', async () => {
      const run = await engine.startRun(strategyId);
      const saved = (await runService.getById(Number(run.runId)))!;

      expect(saved.claimedSol).toBe(10); // 10 SOL (10B lamports / 1B)
      expect(saved.claimTx).toBe('dry-run-claim-tx');
    });

    it('persists checkpoint data: swappedUsdc and swapTx after SWAPPING', async () => {
      const run = await engine.startRun(strategyId);
      const saved = (await runService.getById(Number(run.runId)))!;

      expect(saved.swappedUsdc).toBe(150); // 150 USDC (150_000_000 / 1_000_000)
      expect(saved.swapTx).toBe('dry-run-swap-tx');
    });

    it('generates audit trail for each phase transition', async () => {
      const run = await engine.startRun(strategyId);
      const runId = Number(run.runId);
      const entries = await auditService.getByRunId(runId);

      // pipeline_start + 4*(phase_start + phase_complete) + pipeline_complete = 10
      // At minimum: phase_start + phase_complete for each of 4 phases = 8
      const phaseStarts = entries.filter(e => e.action === 'phase_start');
      const phaseCompletes = entries.filter(e => e.action === 'phase_complete');

      expect(phaseStarts.length).toBe(4);
      expect(phaseCompletes.length).toBe(4);
    });

    it('audit entries cover all 4 pipeline phases', async () => {
      const run = await engine.startRun(strategyId);
      const entries = await auditService.getByRunId(Number(run.runId));

      const phases = entries
        .filter(e => e.action === 'phase_start')
        .map(e => e.phase);

      expect(phases).toEqual(['CLAIMING', 'SWAPPING', 'ALLOCATING', 'CREDITING']);
    });
  });

  // ─── Below Threshold ───────────────────────────────────────

  describe('claim phase with below-threshold SOL', () => {
    it('claims 0 SOL and swap skips with 0 USDC', async () => {
      // Return very little claimable SOL (below the 5 SOL threshold)
      (mockBags.getTotalClaimableSol as ReturnType<typeof vi.fn>).mockResolvedValue({
        totalLamports: 1_000_000_000n, // 1 SOL — below threshold of 5
        positions: [makePosition({ totalClaimableLamportsUserShare: 1_000_000_000 })],
      });

      const run = await engine.startRun(strategyId);
      const saved = (await runService.getById(Number(run.runId)))!;

      expect(saved.status).toBe('COMPLETE');
      // claimedSol stays at 0 (default) because claim returned belowThreshold
      expect(saved.claimedSol).toBe(0);
      // swap phase skips because claimedSol = 0
      expect(saved.swappedUsdc).toBe(0);
    });
  });

  // ─── Error Paths ───────────────────────────────────────────

  describe('BagsClient error during SWAPPING', () => {
    it('marks run FAILED at SWAPPING with claim checkpoint preserved', async () => {
      // Claim succeeds but swap fails
      (mockBags.getTradeQuote as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Insufficient liquidity'),
      );

      const run = await engine.startRun(strategyId);
      const saved = (await runService.getById(Number(run.runId)))!;

      expect(saved.status).toBe('FAILED');
      expect(saved.errorMessage).toBe('Insufficient liquidity');

      // Claim checkpoint should be preserved
      expect(saved.claimedSol).toBe(10);
      expect(saved.claimTx).toBe('dry-run-claim-tx');
    });
  });

  describe('BagsClient error during CLAIMING', () => {
    it('marks run FAILED at CLAIMING phase with error', async () => {
      (mockBags.getTotalClaimableSol as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Network timeout'),
      );

      const run = await engine.startRun(strategyId);
      const saved = (await runService.getById(Number(run.runId)))!;

      expect(saved.status).toBe('FAILED');
      expect(saved.errorMessage).toBe('Network timeout');
    });
  });

  // ─── Resume ────────────────────────────────────────────────

  describe('resumeRun()', () => {
    it('skips CLAIMING when checkpoint data present, retries SWAPPING', async () => {
      // First run: claim succeeds, swap fails
      (mockBags.getTradeQuote as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Temporary error'),
      );

      const failedRun = await engine.startRun(strategyId);
      expect(failedRun.status).toBe('FAILED');

      const failedRunId = Number(failedRun.runId);
      const savedFailed = (await runService.getById(failedRunId))!;
      expect(savedFailed.claimedSol).toBe(10);
      expect(savedFailed.claimTx).toBe('dry-run-claim-tx');

      // Fix the mock for retry
      (mockBags.getTradeQuote as ReturnType<typeof vi.fn>).mockResolvedValue(makeQuote());

      // Resume the failed run
      const resumed = await engine.resumeRun(failedRunId);

      expect(resumed.status).toBe('COMPLETE');
      expect(resumed.phase).toBe('COMPLETE');

      // Verify claim checkpoint was NOT overwritten (CLAIMING was skipped)
      const saved = (await runService.getById(failedRunId))!;
      expect(saved.claimedSol).toBe(10);
      expect(saved.claimTx).toBe('dry-run-claim-tx');
      expect(saved.swappedUsdc).toBe(150);
      expect(saved.swapTx).toBe('dry-run-swap-tx');

      // getTotalClaimableSol should only have been called once (during the first startRun)
      expect(mockBags.getTotalClaimableSol).toHaveBeenCalledTimes(1);
    });

    it('returns immediately for already-COMPLETE runs', async () => {
      const completedRun = await engine.startRun(strategyId);
      expect(completedRun.status).toBe('COMPLETE');

      const resumed = await engine.resumeRun(Number(completedRun.runId));
      expect(resumed.status).toBe('COMPLETE');
      expect(resumed.runId).toBe(completedRun.runId);
    });
  });

  // ─── Kill Switch ───────────────────────────────────────────

  describe('kill switch', () => {
    it('blocks phase execution and marks run FAILED with policy reason', async () => {
      // Create engine with kill switch config
      const killConfig = makeConfig({ executionKillSwitch: true });
      const killPolicy = createExecutionPolicy(killConfig, conn);
      const killEngine = createPipelineEngine({
        runService,
        strategyService,
        auditService,
        executionPolicy: killPolicy,
        bags: mockBags,
        config: killConfig,
        helius: mockHelius,
        travelBalanceService,
        giftCardService: mockGiftCardService,
        travelSwapClient: mockTravelSwapClient,
      });

      await expect(killEngine.startRun(strategyId)).rejects.toThrow('Kill switch is active');
    });
  });

  // ─── Policy Gate ───────────────────────────────────────────

  describe('startRun policy checks', () => {
    it('checks canStartRun policy before creating run', async () => {
      // Exhaust daily run limit by creating runs
      const limitConfig = makeConfig({ maxDailyRuns: 1 });
      const limitPolicy = createExecutionPolicy(limitConfig, conn);
      const limitEngine = createPipelineEngine({
        runService,
        strategyService,
        auditService,
        executionPolicy: limitPolicy,
        bags: mockBags,
        config: limitConfig,
        helius: mockHelius,
        travelBalanceService,
        giftCardService: mockGiftCardService,
        travelSwapClient: mockTravelSwapClient,
      });

      // First run should succeed
      const first = await limitEngine.startRun(strategyId);
      expect(first.status).toBe('COMPLETE');

      // Second run should be blocked by daily limit
      await expect(limitEngine.startRun(strategyId)).rejects.toThrow('Daily run limit reached');
    });
  });

  // ─── PHASE_PIPELINE Structure ──────────────────────────────

  describe('PHASE_PIPELINE', () => {
    it('has 4 phase definitions in the correct order', () => {
      expect(PHASE_PIPELINE).toHaveLength(4);
      expect(PHASE_PIPELINE.map(p => p.state)).toEqual([
        'CLAIMING', 'SWAPPING', 'ALLOCATING', 'CREDITING',
      ]);
      expect(PHASE_PIPELINE.map(p => p.nextState)).toEqual([
        'SWAPPING', 'ALLOCATING', 'CREDITING', 'COMPLETE',
      ]);
      expect(PHASE_PIPELINE.map(p => p.phaseKey)).toEqual([
        'claim', 'swap', 'allocate', 'credit',
      ]);
    });
  });

  // ─── Phase-Level Retry ─────────────────────────────────────

  describe('phase-level retry', () => {
    it('retries a phase on transient error and succeeds on second attempt', async () => {
      // First call to getTotalClaimableSol fails with transient error, second succeeds
      let callCount = 0;
      (mockBags.getTotalClaimableSol as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          const err = new Error('503 Service Unavailable');
          (err as unknown as Record<string, number>).status = 503;
          throw err;
        }
        return {
          totalLamports: 10_000_000_000n,
          positions: [makePosition()],
        };
      });

      // Build engine with injectable delay (no-op for fast tests)
      const retryEngine = createPipelineEngine({
        runService,
        strategyService,
        auditService,
        executionPolicy,
        bags: mockBags,
        config,
        helius: mockHelius,
        travelBalanceService,
        giftCardService: mockGiftCardService,
        travelSwapClient: mockTravelSwapClient,
        phaseRetryDelayFn: async () => {},
      } as PipelineDeps & { phaseRetryDelayFn: () => Promise<void> });

      const run = await retryEngine.startRun(strategyId);
      expect(run.status).toBe('COMPLETE');

      // Verify retry was logged in audit trail
      const entries = await auditService.getByRunId(Number(run.runId));
      const retryEntries = entries.filter(e => e.action === 'phase_retry');
      expect(retryEntries.length).toBeGreaterThanOrEqual(1);
    });

    it('fails immediately on non-transient error without retrying', async () => {
      // Return a 401 Unauthorized — should not retry
      (mockBags.getTotalClaimableSol as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        const err = new Error('401 Unauthorized');
        (err as unknown as Record<string, number>).status = 401;
        throw err;
      });

      const retryEngine = createPipelineEngine({
        runService,
        strategyService,
        auditService,
        executionPolicy,
        bags: mockBags,
        config,
        helius: mockHelius,
        travelBalanceService,
        giftCardService: mockGiftCardService,
        travelSwapClient: mockTravelSwapClient,
        phaseRetryDelayFn: async () => {},
      } as PipelineDeps & { phaseRetryDelayFn: () => Promise<void> });

      const run = await retryEngine.startRun(strategyId);
      expect(run.status).toBe('FAILED');

      // getTotalClaimableSol should only be called once (no retries for 401)
      expect(mockBags.getTotalClaimableSol).toHaveBeenCalledTimes(1);

      // No phase_retry audit entries
      const entries = await auditService.getByRunId(Number(run.runId));
      const retryEntries = entries.filter(e => e.action === 'phase_retry');
      expect(retryEntries).toHaveLength(0);
    });

    it('fails after exhausting all retry attempts on sustained transient error', async () => {
      (mockBags.getTotalClaimableSol as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        const err = new Error('502 Bad Gateway');
        (err as unknown as Record<string, number>).status = 502;
        throw err;
      });

      const retryEngine = createPipelineEngine({
        runService,
        strategyService,
        auditService,
        executionPolicy,
        bags: mockBags,
        config,
        helius: mockHelius,
        travelBalanceService,
        giftCardService: mockGiftCardService,
        travelSwapClient: mockTravelSwapClient,
        phaseRetryDelayFn: async () => {},
      } as PipelineDeps & { phaseRetryDelayFn: () => Promise<void> });

      const run = await retryEngine.startRun(strategyId);
      expect(run.status).toBe('FAILED');
      expect(run.errorMessage).toContain('502 Bad Gateway');

      // 1 initial + 2 retries = 3 calls total
      expect(mockBags.getTotalClaimableSol).toHaveBeenCalledTimes(3);
    });

    it('does not re-checkpoint on failed retry attempts — only on final success', async () => {
      // Swap phase: first attempt fails with transient error, second succeeds
      let swapCallCount = 0;
      (mockBags.getTradeQuote as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        swapCallCount++;
        if (swapCallCount === 1) {
          const err = new Error('500 Internal Server Error');
          (err as unknown as Record<string, number>).status = 500;
          throw err;
        }
        return makeQuote();
      });

      const retryEngine = createPipelineEngine({
        runService,
        strategyService,
        auditService,
        executionPolicy,
        bags: mockBags,
        config,
        helius: mockHelius,
        travelBalanceService,
        giftCardService: mockGiftCardService,
        travelSwapClient: mockTravelSwapClient,
        phaseRetryDelayFn: async () => {},
      } as PipelineDeps & { phaseRetryDelayFn: () => Promise<void> });

      const run = await retryEngine.startRun(strategyId);
      expect(run.status).toBe('COMPLETE');

      // Swap checkpoint should reflect the successful attempt
      const saved = (await runService.getById(Number(run.runId)))!;
      expect(saved.swappedUsdc).toBe(150);
      expect(saved.swapTx).toBe('dry-run-swap-tx');
    });
  });
});
