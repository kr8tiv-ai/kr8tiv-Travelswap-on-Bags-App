// ─── claimPhase Tests ──────────────────────────────────────────
// Unit tests for claimPhase covering: below-threshold skip, dry-run,
// real mode with multiple positions, empty positions, and error paths.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { claimPhase } from '../claimPhase.js';
import type { PhaseContext } from '../../types.js';
import type {
  TravelRun,
  TravelStrategy,
  BagsAdapter,
  ClaimablePosition,
  ClaimTransaction,
} from '../../../types/index.js';

// ─── Constants ─────────────────────────────────────────────────

const LAMPORTS_PER_SOL = 1_000_000_000;
const OWNER = 'OwnerWalletAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const MINT = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';

// ─── Helpers ───────────────────────────────────────────────────

function makeRun(overrides: Partial<TravelRun> = {}): TravelRun {
  return {
    runId: '1',
    strategyId: '1',
    phase: 'CLAIMING',
    status: 'RUNNING',
    claimedSol: null,
    swappedUsdc: null,
    allocatedUsd: null,
    creditsIssued: 0,
    giftCardsPurchased: 0,
    errorMessage: null,
    claimTx: null,
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

function makePosition(overrides: Partial<ClaimablePosition> = {}): ClaimablePosition {
  return {
    isCustomFeeVault: false,
    baseMint: MINT,
    isMigrated: false,
    totalClaimableLamportsUserShare: 100_000_000,
    programId: 'prog1',
    quoteMint: 'So11111111111111111111111111111111111111112',
    virtualPool: 'vpool1',
    virtualPoolAddress: 'vpoolAddr1',
    virtualPoolClaimableAmount: 0.1,
    virtualPoolClaimableLamportsUserShare: 50_000_000,
    dammPoolClaimableAmount: 0.05,
    dammPoolClaimableLamportsUserShare: 50_000_000,
    dammPoolAddress: 'dammAddr1',
    claimableDisplayAmount: 0.1,
    user: OWNER,
    claimerIndex: 0,
    userBps: 10000,
    customFeeVault: '',
    customFeeVaultClaimerA: '',
    customFeeVaultClaimerB: '',
    customFeeVaultClaimerSide: 'A',
    ...overrides,
  };
}

function mockBags(overrides: Partial<BagsAdapter> = {}): BagsAdapter {
  return {
    getClaimablePositions: vi.fn().mockResolvedValue([]),
    getClaimTransactions: vi.fn().mockResolvedValue([]),
    getTradeQuote: vi.fn().mockResolvedValue({}),
    createSwapTransaction: vi.fn().mockResolvedValue({}),
    prepareSwap: vi.fn().mockResolvedValue({}),
    getTotalClaimableSol: vi.fn().mockResolvedValue({
      totalLamports: 0n,
      positions: [],
    }),
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

describe('claimPhase', () => {
  // ─── Below threshold ─────────────────────────────────────

  describe('below threshold', () => {
    it('returns success with belowThreshold:true when total SOL < thresholdSol', async () => {
      const bags = mockBags({
        getTotalClaimableSol: vi.fn().mockResolvedValue({
          totalLamports: BigInt(50_000_000), // 0.05 SOL
          positions: [makePosition()],
        }),
      });
      const ctx = makeCtx({
        bags,
        strategy: makeStrategy({ thresholdSol: 0.1 }),
      });

      const result = await claimPhase(ctx);

      expect(result.success).toBe(true);
      expect(result.data?.belowThreshold).toBe(true);
      expect(result.data?.claimedSol).toBe(0);
    });

    it('returns success with belowThreshold:true when total SOL is exactly 0', async () => {
      const bags = mockBags({
        getTotalClaimableSol: vi.fn().mockResolvedValue({
          totalLamports: 0n,
          positions: [],
        }),
      });
      const ctx = makeCtx({ bags });

      const result = await claimPhase(ctx);

      expect(result.success).toBe(true);
      expect(result.data?.belowThreshold).toBe(true);
      expect(result.data?.claimedSol).toBe(0);
    });

    it('does not call getClaimTransactions when below threshold', async () => {
      const bags = mockBags({
        getTotalClaimableSol: vi.fn().mockResolvedValue({
          totalLamports: BigInt(1_000_000), // 0.001 SOL
          positions: [makePosition()],
        }),
      });
      const ctx = makeCtx({ bags, strategy: makeStrategy({ thresholdSol: 1.0 }) });

      await claimPhase(ctx);

      expect(bags.getClaimTransactions).not.toHaveBeenCalled();
    });
  });

  // ─── Dry-run mode ────────────────────────────────────────

  describe('dry-run mode', () => {
    it('returns claimedSol and dryRun:true without calling getClaimTransactions', async () => {
      const totalLamports = BigInt(2 * LAMPORTS_PER_SOL); // 2.0 SOL
      const bags = mockBags({
        getTotalClaimableSol: vi.fn().mockResolvedValue({
          totalLamports,
          positions: [makePosition()],
        }),
      });
      const ctx = makeCtx({
        bags,
        isDryRun: true,
        strategy: makeStrategy({ thresholdSol: 0.1 }),
      });

      const result = await claimPhase(ctx);

      expect(result.success).toBe(true);
      expect(result.data?.claimedSol).toBe(2.0);
      expect(result.data?.claimTx).toBe('dry-run-claim-tx');
      expect(result.data?.dryRun).toBe(true);
      expect(bags.getClaimTransactions).not.toHaveBeenCalled();
    });

    it('returns correct SOL amount with fractional values in dry-run', async () => {
      const totalLamports = BigInt(1_500_000_000); // 1.5 SOL
      const bags = mockBags({
        getTotalClaimableSol: vi.fn().mockResolvedValue({
          totalLamports,
          positions: [makePosition(), makePosition()],
        }),
      });
      const ctx = makeCtx({
        bags,
        isDryRun: true,
        strategy: makeStrategy({ thresholdSol: 0.01 }),
      });

      const result = await claimPhase(ctx);

      expect(result.success).toBe(true);
      expect(result.data?.claimedSol).toBeCloseTo(1.5, 9);
      expect(result.data?.dryRun).toBe(true);
    });
  });

  // ─── Real mode ───────────────────────────────────────────

  describe('real mode', () => {
    it('iterates all positions and collects claim transaction signatures', async () => {
      const posA = makePosition({ virtualPool: 'poolA' });
      const posB = makePosition({ virtualPool: 'poolB' });
      const totalLamports = BigInt(5 * LAMPORTS_PER_SOL);

      const bags = mockBags({
        getTotalClaimableSol: vi.fn().mockResolvedValue({
          totalLamports,
          positions: [posA, posB],
        }),
        getClaimTransactions: vi.fn()
          .mockResolvedValueOnce([{ tx: 'sig-a1', blockhash: { blockhash: 'bh1', lastValidBlockHeight: 100 } }])
          .mockResolvedValueOnce([
            { tx: 'sig-b1', blockhash: { blockhash: 'bh2', lastValidBlockHeight: 101 } },
            { tx: 'sig-b2', blockhash: { blockhash: 'bh3', lastValidBlockHeight: 102 } },
          ]),
      });

      const ctx = makeCtx({ bags, strategy: makeStrategy({ thresholdSol: 0.01 }) });

      const result = await claimPhase(ctx);

      expect(result.success).toBe(true);
      expect(result.data?.claimedSol).toBe(5.0);
      expect(result.data?.claimTx).toBe('sig-a1'); // first tx signature
      expect(bags.getClaimTransactions).toHaveBeenCalledTimes(2);
      expect(bags.getClaimTransactions).toHaveBeenCalledWith(OWNER, posA);
      expect(bags.getClaimTransactions).toHaveBeenCalledWith(OWNER, posB);
    });

    it('returns "no-tx" when positions exist but yield no claim transactions', async () => {
      const pos = makePosition();
      const totalLamports = BigInt(1 * LAMPORTS_PER_SOL);

      const bags = mockBags({
        getTotalClaimableSol: vi.fn().mockResolvedValue({
          totalLamports,
          positions: [pos],
        }),
        getClaimTransactions: vi.fn().mockResolvedValue([]),
      });

      const ctx = makeCtx({ bags, strategy: makeStrategy({ thresholdSol: 0.01 }) });

      const result = await claimPhase(ctx);

      expect(result.success).toBe(true);
      expect(result.data?.claimedSol).toBe(1.0);
      expect(result.data?.claimTx).toBe('no-tx');
    });

    it('handles single position with single claim transaction', async () => {
      const pos = makePosition();
      const totalLamports = BigInt(3 * LAMPORTS_PER_SOL);

      const bags = mockBags({
        getTotalClaimableSol: vi.fn().mockResolvedValue({
          totalLamports,
          positions: [pos],
        }),
        getClaimTransactions: vi.fn().mockResolvedValue([
          { tx: 'only-sig', blockhash: { blockhash: 'bh', lastValidBlockHeight: 50 } },
        ]),
      });

      const ctx = makeCtx({ bags, strategy: makeStrategy({ thresholdSol: 0.5 }) });

      const result = await claimPhase(ctx);

      expect(result.success).toBe(true);
      expect(result.data?.claimedSol).toBe(3.0);
      expect(result.data?.claimTx).toBe('only-sig');
    });
  });

  // ─── Threshold boundary ──────────────────────────────────

  describe('threshold boundary', () => {
    it('proceeds with claim when total SOL equals thresholdSol exactly', async () => {
      const totalLamports = BigInt(LAMPORTS_PER_SOL); // 1.0 SOL
      const bags = mockBags({
        getTotalClaimableSol: vi.fn().mockResolvedValue({
          totalLamports,
          positions: [makePosition()],
        }),
        getClaimTransactions: vi.fn().mockResolvedValue([
          { tx: 'threshold-sig', blockhash: { blockhash: 'bh', lastValidBlockHeight: 50 } },
        ]),
      });

      const ctx = makeCtx({
        bags,
        strategy: makeStrategy({ thresholdSol: 1.0 }),
      });

      const result = await claimPhase(ctx);

      // 1.0 is NOT < 1.0, so it should proceed
      expect(result.success).toBe(true);
      expect(result.data?.belowThreshold).toBeUndefined();
      expect(result.data?.claimedSol).toBe(1.0);
    });

    it('skips when just below threshold', async () => {
      const totalLamports = BigInt(LAMPORTS_PER_SOL - 1); // 0.999999999 SOL
      const bags = mockBags({
        getTotalClaimableSol: vi.fn().mockResolvedValue({
          totalLamports,
          positions: [makePosition()],
        }),
      });

      const ctx = makeCtx({
        bags,
        strategy: makeStrategy({ thresholdSol: 1.0 }),
      });

      const result = await claimPhase(ctx);

      expect(result.success).toBe(true);
      expect(result.data?.belowThreshold).toBe(true);
      expect(result.data?.claimedSol).toBe(0);
    });
  });

  // ─── Error handling ──────────────────────────────────────

  describe('error handling', () => {
    it('returns CLAIM_FAILED when getTotalClaimableSol throws', async () => {
      const bags = mockBags({
        getTotalClaimableSol: vi.fn().mockRejectedValue(new Error('Bags API timeout')),
      });
      const ctx = makeCtx({ bags });

      const result = await claimPhase(ctx);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('CLAIM_FAILED');
      expect(result.error?.message).toContain('Bags API timeout');
    });

    it('returns CLAIM_FAILED when getClaimTransactions throws', async () => {
      const bags = mockBags({
        getTotalClaimableSol: vi.fn().mockResolvedValue({
          totalLamports: BigInt(2 * LAMPORTS_PER_SOL),
          positions: [makePosition()],
        }),
        getClaimTransactions: vi.fn().mockRejectedValue(new Error('TX build failed')),
      });
      const ctx = makeCtx({
        bags,
        strategy: makeStrategy({ thresholdSol: 0.01 }),
      });

      const result = await claimPhase(ctx);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('CLAIM_FAILED');
      expect(result.error?.message).toContain('TX build failed');
    });

    it('handles non-Error throw values', async () => {
      const bags = mockBags({
        getTotalClaimableSol: vi.fn().mockRejectedValue('string error'),
      });
      const ctx = makeCtx({ bags });

      const result = await claimPhase(ctx);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('CLAIM_FAILED');
      expect(result.error?.message).toBe('string error');
    });

    it('catches error mid-iteration when second position fails', async () => {
      const posA = makePosition({ virtualPool: 'good' });
      const posB = makePosition({ virtualPool: 'bad' });

      const bags = mockBags({
        getTotalClaimableSol: vi.fn().mockResolvedValue({
          totalLamports: BigInt(3 * LAMPORTS_PER_SOL),
          positions: [posA, posB],
        }),
        getClaimTransactions: vi.fn()
          .mockResolvedValueOnce([{ tx: 'sig-ok', blockhash: { blockhash: 'bh', lastValidBlockHeight: 50 } }])
          .mockRejectedValueOnce(new Error('Network error on position B')),
      });
      const ctx = makeCtx({ bags, strategy: makeStrategy({ thresholdSol: 0.01 }) });

      const result = await claimPhase(ctx);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('CLAIM_FAILED');
      expect(result.error?.message).toContain('Network error on position B');
    });
  });

  // ─── Uses correct wallet ─────────────────────────────────

  describe('wallet parameter', () => {
    it('passes strategy.ownerWallet to getTotalClaimableSol', async () => {
      const customWallet = 'CustomWalletAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
      const bags = mockBags({
        getTotalClaimableSol: vi.fn().mockResolvedValue({
          totalLamports: 0n,
          positions: [],
        }),
      });
      const ctx = makeCtx({
        bags,
        strategy: makeStrategy({ ownerWallet: customWallet }),
      });

      await claimPhase(ctx);

      expect(bags.getTotalClaimableSol).toHaveBeenCalledWith(customWallet);
    });

    it('passes strategy.ownerWallet to getClaimTransactions', async () => {
      const customWallet = 'CustomWalletAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
      const pos = makePosition();
      const bags = mockBags({
        getTotalClaimableSol: vi.fn().mockResolvedValue({
          totalLamports: BigInt(2 * LAMPORTS_PER_SOL),
          positions: [pos],
        }),
        getClaimTransactions: vi.fn().mockResolvedValue([
          { tx: 'sig', blockhash: { blockhash: 'bh', lastValidBlockHeight: 50 } },
        ]),
      });
      const ctx = makeCtx({
        bags,
        strategy: makeStrategy({ ownerWallet: customWallet, thresholdSol: 0.01 }),
      });

      await claimPhase(ctx);

      expect(bags.getClaimTransactions).toHaveBeenCalledWith(customWallet, pos);
    });
  });
});
