// ─── swapPhase Tests ───────────────────────────────────────────
// Unit tests for swapPhase covering: no SOL claimed (skip), dry-run,
// real mode swap execution, and error paths.

import { describe, it, expect, vi } from 'vitest';
import { swapPhase } from '../swapPhase.js';
import type { PhaseContext } from '../../types.js';
import type {
  TravelRun,
  TravelStrategy,
  BagsAdapter,
  TradeQuote,
  SwapTransaction,
} from '../../../types/index.js';

// ─── Constants ─────────────────────────────────────────────────

const LAMPORTS_PER_SOL = 1_000_000_000;
const USDC_DECIMALS = 6;
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const OWNER = 'OwnerWalletAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const MINT = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';

// ─── Helpers ───────────────────────────────────────────────────

function makeRun(overrides: Partial<TravelRun> = {}): TravelRun {
  return {
    runId: '1',
    strategyId: '1',
    phase: 'SWAPPING',
    status: 'RUNNING',
    claimedSol: 2.0,
    swappedUsdc: null,
    allocatedUsd: null,
    creditsIssued: 0,
    giftCardsPurchased: 0,
    errorMessage: null,
    claimTx: 'claim-tx-123',
    swapTx: null,
    startedAt: new Date().toISOString(),
    completedAt: null,
    ...overrides,
  };
}

function makeStrategy(overrides: Partial<TravelStrategy> = {}): TravelStrategy {
  return {
    strategyId: '1',
    name: 'Test Strategy',
    ownerWallet: OWNER,
    tokenMint: MINT,
    feeSource: 'CLAIMABLE_POSITIONS',
    thresholdSol: 0.1,
    slippageBps: 50,
    distributionMode: 'OWNER_ONLY',
    distributionTopN: 10,
    creditMode: 'GIFT_CARD',
    giftCardThresholdUsd: 25,
    cronExpression: '0 */6 * * *',
    enabled: true,
    customAllocations: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastRunId: null,
    ...overrides,
  };
}

function makeQuote(outAmount: string, overrides: Partial<TradeQuote> = {}): TradeQuote {
  return {
    requestId: 'req-1',
    contextSlot: 12345,
    inAmount: String(2 * LAMPORTS_PER_SOL),
    inputMint: SOL_MINT,
    outAmount,
    outputMint: USDC_MINT,
    minOutAmount: outAmount,
    otherAmountThreshold: outAmount,
    priceImpactPct: '0.01',
    slippageBps: 50,
    routePlan: [],
    platformFee: {
      amount: '0',
      feeBps: 0,
      feeAccount: '',
      segmenterFeeAmount: '0',
      segmenterFeePct: 0,
    },
    outTransferFee: '0',
    simulatedComputeUnits: 200000,
    ...overrides,
  };
}

function makeSwapTx(overrides: Partial<SwapTransaction> = {}): SwapTransaction {
  return {
    swapTransaction: 'base64-swap-tx-data-abcdefghij1234567890',
    computeUnitLimit: 200000,
    lastValidBlockHeight: 50000,
    prioritizationFeeLamports: 5000,
    ...overrides,
  };
}

function mockBags(overrides: Partial<BagsAdapter> = {}): BagsAdapter {
  return {
    getClaimablePositions: vi.fn().mockResolvedValue([]),
    getClaimTransactions: vi.fn().mockResolvedValue([]),
    getTradeQuote: vi.fn().mockResolvedValue(makeQuote('100000000')), // 100 USDC
    createSwapTransaction: vi.fn().mockResolvedValue(makeSwapTx()),
    prepareSwap: vi.fn().mockResolvedValue({}),
    getTotalClaimableSol: vi.fn().mockResolvedValue({ totalLamports: 0n, positions: [] }),
    getRateLimitStatus: vi.fn().mockReturnValue({ remaining: 100, resetAt: 0 }),
    ...overrides,
  } as BagsAdapter;
}

function makeCtx(overrides: Partial<PhaseContext> = {}): PhaseContext {
  return {
    run: makeRun(),
    strategy: makeStrategy(),
    bags: mockBags(),
    config: {} as PhaseContext['config'],
    isDryRun: false,
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────

describe('swapPhase', () => {
  // ─── No SOL claimed (skip) ───────────────────────────────

  describe('no SOL claimed — skip', () => {
    it('returns skipped:true when claimedSol is null', async () => {
      const ctx = makeCtx({ run: makeRun({ claimedSol: null }) });

      const result = await swapPhase(ctx);

      expect(result.success).toBe(true);
      expect(result.data?.swappedUsdc).toBe(0);
      expect(result.data?.skipped).toBe(true);
    });

    it('returns skipped:true when claimedSol is 0', async () => {
      const ctx = makeCtx({ run: makeRun({ claimedSol: 0 }) });

      const result = await swapPhase(ctx);

      expect(result.success).toBe(true);
      expect(result.data?.swappedUsdc).toBe(0);
      expect(result.data?.skipped).toBe(true);
    });

    it('does not call getTradeQuote when claimedSol is 0', async () => {
      const bags = mockBags();
      const ctx = makeCtx({ bags, run: makeRun({ claimedSol: 0 }) });

      await swapPhase(ctx);

      expect(bags.getTradeQuote).not.toHaveBeenCalled();
    });

    it('does not call createSwapTransaction when claimedSol is null', async () => {
      const bags = mockBags();
      const ctx = makeCtx({ bags, run: makeRun({ claimedSol: null }) });

      await swapPhase(ctx);

      expect(bags.createSwapTransaction).not.toHaveBeenCalled();
    });
  });

  // ─── Dry-run mode ────────────────────────────────────────

  describe('dry-run mode', () => {
    it('gets trade quote but skips swap transaction', async () => {
      const outUsdc = 150_000_000; // 150 USDC in raw
      const bags = mockBags({
        getTradeQuote: vi.fn().mockResolvedValue(makeQuote(String(outUsdc))),
      });
      const ctx = makeCtx({
        bags,
        isDryRun: true,
        run: makeRun({ claimedSol: 3.0 }),
      });

      const result = await swapPhase(ctx);

      expect(result.success).toBe(true);
      expect(result.data?.swappedUsdc).toBe(150);
      expect(result.data?.swapTx).toBe('dry-run-swap-tx');
      expect(result.data?.dryRun).toBe(true);
      expect(bags.getTradeQuote).toHaveBeenCalledTimes(1);
      expect(bags.createSwapTransaction).not.toHaveBeenCalled();
    });

    it('passes correct lamports amount and slippageBps to getTradeQuote', async () => {
      const bags = mockBags({
        getTradeQuote: vi.fn().mockResolvedValue(makeQuote('50000000')),
      });
      const ctx = makeCtx({
        bags,
        isDryRun: true,
        run: makeRun({ claimedSol: 1.5 }),
        strategy: makeStrategy({ slippageBps: 100 }),
      });

      await swapPhase(ctx);

      expect(bags.getTradeQuote).toHaveBeenCalledWith({
        inputMint: SOL_MINT,
        outputMint: USDC_MINT,
        amount: Math.round(1.5 * LAMPORTS_PER_SOL),
        slippageBps: 100,
      });
    });

    it('calculates fractional USDC correctly', async () => {
      // 25.123456 USDC = 25_123_456 raw
      const bags = mockBags({
        getTradeQuote: vi.fn().mockResolvedValue(makeQuote('25123456')),
      });
      const ctx = makeCtx({
        bags,
        isDryRun: true,
        run: makeRun({ claimedSol: 0.5 }),
      });

      const result = await swapPhase(ctx);

      expect(result.success).toBe(true);
      expect(result.data?.swappedUsdc).toBeCloseTo(25.123456, 6);
    });
  });

  // ─── Real mode ───────────────────────────────────────────

  describe('real mode', () => {
    it('gets quote, creates swap transaction, and returns swapTx signature', async () => {
      const quote = makeQuote('200000000'); // 200 USDC
      const swapTx = makeSwapTx({ swapTransaction: 'real-swap-tx-signature-abcdef123456' });

      const bags = mockBags({
        getTradeQuote: vi.fn().mockResolvedValue(quote),
        createSwapTransaction: vi.fn().mockResolvedValue(swapTx),
      });
      const ctx = makeCtx({
        bags,
        run: makeRun({ claimedSol: 4.0 }),
        strategy: makeStrategy({ slippageBps: 50 }),
      });

      const result = await swapPhase(ctx);

      expect(result.success).toBe(true);
      expect(result.data?.swappedUsdc).toBe(200);
      expect(result.data?.swapTx).toBe('real-swap-tx-signature-abcdef123456');
      expect(result.data?.dryRun).toBeUndefined();
      expect(bags.getTradeQuote).toHaveBeenCalledTimes(1);
      expect(bags.createSwapTransaction).toHaveBeenCalledWith(quote, OWNER);
    });

    it('passes ownerWallet to createSwapTransaction', async () => {
      const customWallet = 'CustomWalletAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
      const quote = makeQuote('50000000');
      const bags = mockBags({
        getTradeQuote: vi.fn().mockResolvedValue(quote),
        createSwapTransaction: vi.fn().mockResolvedValue(makeSwapTx()),
      });
      const ctx = makeCtx({
        bags,
        run: makeRun({ claimedSol: 1.0 }),
        strategy: makeStrategy({ ownerWallet: customWallet, thresholdSol: 0.01 }),
      });

      await swapPhase(ctx);

      expect(bags.createSwapTransaction).toHaveBeenCalledWith(quote, customWallet);
    });

    it('correctly converts claimed SOL to lamports for quote request', async () => {
      const bags = mockBags({
        getTradeQuote: vi.fn().mockResolvedValue(makeQuote('75000000')),
        createSwapTransaction: vi.fn().mockResolvedValue(makeSwapTx()),
      });
      const ctx = makeCtx({
        bags,
        run: makeRun({ claimedSol: 2.5 }),
        strategy: makeStrategy({ slippageBps: 75 }),
      });

      await swapPhase(ctx);

      expect(bags.getTradeQuote).toHaveBeenCalledWith({
        inputMint: SOL_MINT,
        outputMint: USDC_MINT,
        amount: Math.round(2.5 * LAMPORTS_PER_SOL),
        slippageBps: 75,
      });
    });
  });

  // ─── Error handling ──────────────────────────────────────

  describe('error handling', () => {
    it('returns SWAP_FAILED when getTradeQuote throws', async () => {
      const bags = mockBags({
        getTradeQuote: vi.fn().mockRejectedValue(new Error('Jupiter API down')),
      });
      const ctx = makeCtx({
        bags,
        run: makeRun({ claimedSol: 1.0 }),
      });

      const result = await swapPhase(ctx);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('SWAP_FAILED');
      expect(result.error?.message).toContain('Jupiter API down');
    });

    it('returns SWAP_FAILED when createSwapTransaction throws', async () => {
      const bags = mockBags({
        getTradeQuote: vi.fn().mockResolvedValue(makeQuote('100000000')),
        createSwapTransaction: vi.fn().mockRejectedValue(new Error('TX build error')),
      });
      const ctx = makeCtx({
        bags,
        run: makeRun({ claimedSol: 2.0 }),
      });

      const result = await swapPhase(ctx);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('SWAP_FAILED');
      expect(result.error?.message).toContain('TX build error');
    });

    it('handles non-Error throw values', async () => {
      const bags = mockBags({
        getTradeQuote: vi.fn().mockRejectedValue('raw string error'),
      });
      const ctx = makeCtx({ bags, run: makeRun({ claimedSol: 1.0 }) });

      const result = await swapPhase(ctx);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('SWAP_FAILED');
      expect(result.error?.message).toBe('raw string error');
    });

    it('does not call createSwapTransaction when getTradeQuote fails', async () => {
      const bags = mockBags({
        getTradeQuote: vi.fn().mockRejectedValue(new Error('quote failed')),
      });
      const ctx = makeCtx({ bags, run: makeRun({ claimedSol: 1.0 }) });

      await swapPhase(ctx);

      expect(bags.createSwapTransaction).not.toHaveBeenCalled();
    });
  });

  // ─── Edge cases ──────────────────────────────────────────

  describe('edge cases', () => {
    it('handles very small claimedSol amounts', async () => {
      const bags = mockBags({
        getTradeQuote: vi.fn().mockResolvedValue(makeQuote('100')), // 0.0001 USDC
        createSwapTransaction: vi.fn().mockResolvedValue(makeSwapTx()),
      });
      const ctx = makeCtx({
        bags,
        run: makeRun({ claimedSol: 0.000001 }),
      });

      const result = await swapPhase(ctx);

      expect(result.success).toBe(true);
      expect(result.data?.swappedUsdc).toBeCloseTo(0.0001, 6);
      expect(bags.getTradeQuote).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: Math.round(0.000001 * LAMPORTS_PER_SOL),
        }),
      );
    });

    it('handles large claimedSol amounts', async () => {
      const largeSol = 1000;
      const largeUsdc = 150000 * Math.pow(10, USDC_DECIMALS); // 150,000 USDC raw
      const bags = mockBags({
        getTradeQuote: vi.fn().mockResolvedValue(makeQuote(String(largeUsdc))),
        createSwapTransaction: vi.fn().mockResolvedValue(makeSwapTx()),
      });
      const ctx = makeCtx({
        bags,
        run: makeRun({ claimedSol: largeSol }),
      });

      const result = await swapPhase(ctx);

      expect(result.success).toBe(true);
      expect(result.data?.swappedUsdc).toBe(150000);
    });
  });
});
