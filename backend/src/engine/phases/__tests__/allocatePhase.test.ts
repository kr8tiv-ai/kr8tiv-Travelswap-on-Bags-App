// ─── allocatePhase Tests ───────────────────────────────────────
// Integration tests connecting HeliusClient (mocked) →
// allocatePhase → TravelBalanceService (real, in-memory SQLite).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { allocatePhase } from '../allocatePhase.js';
import type { PhaseContext } from '../../types.js';
import type { PhaseResult, TravelStrategy, TravelRun, DistributionMode } from '../../../types/index.js';
import type { HeliusClient, WeightedHolder } from '../../../clients/HeliusClient.js';
import type { TravelBalanceService } from '../../../services/TravelBalanceService.js';
import { Database, type DatabaseConnection } from '../../../services/Database.js';
import { createTravelBalanceService } from '../../../services/TravelBalanceService.js';
import { WEIGHT_SCALE } from '../../../clients/HeliusClient.js';

// ─── Helpers ───────────────────────────────────────────────────

const OWNER = 'OwnerWalletAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const HOLDER_A = 'HolderAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const HOLDER_B = 'HolderBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const HOLDER_C = 'HolderCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';
const MINT = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';

function makeRun(overrides: Partial<TravelRun> = {}): TravelRun {
  return {
    runId: '1',
    strategyId: '1',
    phase: 'ALLOCATING',
    status: 'RUNNING',
    claimedSol: 1.5,
    swappedUsdc: 100.0,
    allocatedUsd: null,
    creditsIssued: 0,
    giftCardsPurchased: 0,
    errorMessage: null,
    claimTx: 'tx123',
    swapTx: 'tx456',
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

function mockHelius(
  holders: Array<{ owner: string; balance: bigint }> = [],
): HeliusClient {
  const tokenHolders = holders.map((h, i) => ({
    address: `Account${i}`,
    owner: h.owner,
    balance: h.balance,
  }));

  const totalBalance = holders.reduce((sum, h) => sum + h.balance, 0n);

  return {
    getTokenAccounts: vi.fn().mockResolvedValue(tokenHolders),
    getTopHolders: vi.fn().mockResolvedValue(tokenHolders),
    calculateDistributionWeights: vi.fn().mockImplementation(() => {
      if (totalBalance === 0n) return [];
      return tokenHolders.map((h) => ({
        owner: h.owner,
        weight: (h.balance * WEIGHT_SCALE) / totalBalance,
        balance: h.balance,
      }));
    }),
  };
}

function makeCtx(overrides: Partial<PhaseContext> = {}): PhaseContext {
  return {
    run: makeRun(),
    strategy: makeStrategy(),
    bags: {} as PhaseContext['bags'],
    config: {} as PhaseContext['config'],
    isDryRun: false,
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────

describe('allocatePhase', () => {
  let db: Database;
  let conn: DatabaseConnection;
  let balanceSvc: TravelBalanceService;

  beforeEach(async () => {
    db = new Database(':memory:');
    conn = await db.connect();
    await db.runMigrations();
    balanceSvc = createTravelBalanceService(conn);

    // Insert a strategy row for FK constraints
    await conn.run(
      "INSERT INTO strategies (token_mint) VALUES (?)",
      MINT,
    );
  });

  afterEach(() => {
    db.close();
  });

  // ─── Zero / null swappedUsdc ─────────────────────────────

  describe('zero or null swappedUsdc', () => {
    it('returns success with allocatedUsd: 0 when swappedUsdc is null', async () => {
      const ctx = makeCtx({ run: makeRun({ swappedUsdc: null }) });
      const result = await allocatePhase(ctx);

      expect(result.success).toBe(true);
      expect(result.data?.allocatedUsd).toBe(0);
      expect(result.data?.holderCount).toBe(0);
    });

    it('returns success with allocatedUsd: 0 when swappedUsdc is 0', async () => {
      const ctx = makeCtx({ run: makeRun({ swappedUsdc: 0 }) });
      const result = await allocatePhase(ctx);

      expect(result.success).toBe(true);
      expect(result.data?.allocatedUsd).toBe(0);
      expect(result.data?.holderCount).toBe(0);
    });
  });

  // ─── Missing dependencies ───────────────────────────────

  describe('missing dependencies', () => {
    it('returns error when helius is missing for holder-based modes', async () => {
      const ctx = makeCtx({
        strategy: makeStrategy({ distributionMode: 'EQUAL_SPLIT' }),
        travelBalanceService: balanceSvc,
      });
      const result = await allocatePhase(ctx);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('MISSING_DEPENDENCY');
      expect(result.error?.message).toContain('HeliusClient');
    });

    it('returns error when travelBalanceService is missing', async () => {
      const helius = mockHelius();
      const ctx = makeCtx({ helius });
      const result = await allocatePhase(ctx);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('MISSING_DEPENDENCY');
      expect(result.error?.message).toContain('TravelBalanceService');
    });
  });

  // ─── OWNER_ONLY ─────────────────────────────────────────

  describe('OWNER_ONLY mode', () => {
    it('allocates 100% of USDC to the owner wallet', async () => {
      const helius = mockHelius();
      const ctx = makeCtx({
        strategy: makeStrategy({ distributionMode: 'OWNER_ONLY' }),
        helius,
        travelBalanceService: balanceSvc,
      });

      const result = await allocatePhase(ctx);

      expect(result.success).toBe(true);
      expect(result.data?.allocatedUsd).toBe(100);
      expect(result.data?.holderCount).toBe(1);

      // Verify balance was credited
      const balance = await balanceSvc.getByStrategyAndWallet(1, OWNER);
      expect(balance).toBeDefined();
      expect(balance!.balanceUsd).toBe(100);
      expect(balance!.totalEarned).toBe(100);

      // getTopHolders should NOT have been called
      expect(helius.getTopHolders).not.toHaveBeenCalled();
    });
  });

  // ─── EQUAL_SPLIT ────────────────────────────────────────

  describe('EQUAL_SPLIT mode', () => {
    it('divides USDC equally among all holders', async () => {
      const helius = mockHelius([
        { owner: HOLDER_A, balance: 1000n },
        { owner: HOLDER_B, balance: 500n },
        { owner: HOLDER_C, balance: 200n },
      ]);
      const ctx = makeCtx({
        strategy: makeStrategy({ distributionMode: 'EQUAL_SPLIT' }),
        helius,
        travelBalanceService: balanceSvc,
      });

      const result = await allocatePhase(ctx);

      expect(result.success).toBe(true);
      expect(result.data?.holderCount).toBe(3);

      // Each should get ~33.33
      const balA = await balanceSvc.getByStrategyAndWallet(1, HOLDER_A);
      const balB = await balanceSvc.getByStrategyAndWallet(1, HOLDER_B);
      const balC = await balanceSvc.getByStrategyAndWallet(1, HOLDER_C);
      expect(balA).toBeDefined();
      expect(balB).toBeDefined();
      expect(balC).toBeDefined();

      const share = 100 / 3;
      expect(balA!.balanceUsd).toBeCloseTo(share, 2);
      expect(balB!.balanceUsd).toBeCloseTo(share, 2);
      expect(balC!.balanceUsd).toBeCloseTo(share, 2);
    });

    it('falls back to owner when no holders found', async () => {
      const helius = mockHelius([]);
      const ctx = makeCtx({
        strategy: makeStrategy({ distributionMode: 'EQUAL_SPLIT' }),
        helius,
        travelBalanceService: balanceSvc,
      });

      const result = await allocatePhase(ctx);

      expect(result.success).toBe(true);
      const balance = await balanceSvc.getByStrategyAndWallet(1, OWNER);
      expect(balance).toBeDefined();
      expect(balance!.balanceUsd).toBe(100);
    });
  });

  // ─── TOP_N_HOLDERS ──────────────────────────────────────

  describe('TOP_N_HOLDERS mode', () => {
    it('distributes proportionally by holdings to top N', async () => {
      const helius = mockHelius([
        { owner: HOLDER_A, balance: 750n },
        { owner: HOLDER_B, balance: 250n },
      ]);
      const ctx = makeCtx({
        strategy: makeStrategy({
          distributionMode: 'TOP_N_HOLDERS',
          distributionTopN: 5,
        }),
        helius,
        travelBalanceService: balanceSvc,
      });

      const result = await allocatePhase(ctx);

      expect(result.success).toBe(true);
      expect(result.data?.holderCount).toBe(2);

      // Holder A: 75%, Holder B: 25%
      const balA = await balanceSvc.getByStrategyAndWallet(1, HOLDER_A);
      const balB = await balanceSvc.getByStrategyAndWallet(1, HOLDER_B);
      expect(balA!.balanceUsd).toBeCloseTo(75, 1);
      expect(balB!.balanceUsd).toBeCloseTo(25, 1);

      // getTopHolders called with topN
      expect(helius.getTopHolders).toHaveBeenCalledWith(MINT, 5);
    });

    it('falls back to owner when no holders found', async () => {
      const helius = mockHelius([]);
      const ctx = makeCtx({
        strategy: makeStrategy({ distributionMode: 'TOP_N_HOLDERS', distributionTopN: 5 }),
        helius,
        travelBalanceService: balanceSvc,
      });

      const result = await allocatePhase(ctx);

      expect(result.success).toBe(true);
      const balance = await balanceSvc.getByStrategyAndWallet(1, OWNER);
      expect(balance!.balanceUsd).toBe(100);
    });
  });

  // ─── WEIGHTED_BY_HOLDINGS ───────────────────────────────

  describe('WEIGHTED_BY_HOLDINGS mode', () => {
    it('distributes proportionally by holdings to all holders', async () => {
      const helius = mockHelius([
        { owner: HOLDER_A, balance: 600n },
        { owner: HOLDER_B, balance: 300n },
        { owner: HOLDER_C, balance: 100n },
      ]);
      const ctx = makeCtx({
        strategy: makeStrategy({ distributionMode: 'WEIGHTED_BY_HOLDINGS' }),
        helius,
        travelBalanceService: balanceSvc,
      });

      const result = await allocatePhase(ctx);

      expect(result.success).toBe(true);
      expect(result.data?.holderCount).toBe(3);

      // 60%, 30%, 10%
      const balA = await balanceSvc.getByStrategyAndWallet(1, HOLDER_A);
      const balB = await balanceSvc.getByStrategyAndWallet(1, HOLDER_B);
      const balC = await balanceSvc.getByStrategyAndWallet(1, HOLDER_C);
      expect(balA!.balanceUsd).toBeCloseTo(60, 1);
      expect(balB!.balanceUsd).toBeCloseTo(30, 1);
      expect(balC!.balanceUsd).toBeCloseTo(10, 1);

      // Should fetch all holders (MAX_SAFE_INTEGER)
      expect(helius.getTopHolders).toHaveBeenCalledWith(MINT, Number.MAX_SAFE_INTEGER);
    });
  });

  // ─── CUSTOM_LIST ─────────────────────────────────────────

  describe('CUSTOM_LIST mode', () => {
    it('distributes USDC by percentage to custom wallets (50/30/20)', async () => {
      const helius = mockHelius();
      const ctx = makeCtx({
        strategy: makeStrategy({
          distributionMode: 'CUSTOM_LIST',
          customAllocations: [
            { wallet: HOLDER_A, percentage: 50 },
            { wallet: HOLDER_B, percentage: 30 },
            { wallet: HOLDER_C, percentage: 20 },
          ],
        }),
        helius,
        travelBalanceService: balanceSvc,
      });

      const result = await allocatePhase(ctx);

      expect(result.success).toBe(true);
      expect(result.data?.allocatedUsd).toBe(100);
      expect(result.data?.holderCount).toBe(3);

      const balA = await balanceSvc.getByStrategyAndWallet(1, HOLDER_A);
      const balB = await balanceSvc.getByStrategyAndWallet(1, HOLDER_B);
      const balC = await balanceSvc.getByStrategyAndWallet(1, HOLDER_C);
      expect(balA!.balanceUsd).toBe(50);
      expect(balB!.balanceUsd).toBe(30);
      expect(balC!.balanceUsd).toBe(20);

      // HeliusClient should NOT be called for CUSTOM_LIST
      expect(helius.getTopHolders).not.toHaveBeenCalled();
    });

    it('falls back to OWNER_ONLY when customAllocations is null', async () => {
      const helius = mockHelius();
      const ctx = makeCtx({
        strategy: makeStrategy({
          distributionMode: 'CUSTOM_LIST',
          customAllocations: null,
        }),
        helius,
        travelBalanceService: balanceSvc,
      });

      const result = await allocatePhase(ctx);

      expect(result.success).toBe(true);
      expect(result.data?.allocatedUsd).toBe(100);
      expect(result.data?.holderCount).toBe(1);

      const balance = await balanceSvc.getByStrategyAndWallet(1, OWNER);
      expect(balance!.balanceUsd).toBe(100);
      expect(helius.getTopHolders).not.toHaveBeenCalled();
    });

    it('falls back to OWNER_ONLY when customAllocations is empty array', async () => {
      const helius = mockHelius();
      const ctx = makeCtx({
        strategy: makeStrategy({
          distributionMode: 'CUSTOM_LIST',
          customAllocations: [],
        }),
        helius,
        travelBalanceService: balanceSvc,
      });

      const result = await allocatePhase(ctx);

      expect(result.success).toBe(true);
      expect(result.data?.allocatedUsd).toBe(100);
      expect(result.data?.holderCount).toBe(1);

      const balance = await balanceSvc.getByStrategyAndWallet(1, OWNER);
      expect(balance!.balanceUsd).toBe(100);
      expect(helius.getTopHolders).not.toHaveBeenCalled();
    });

    it('allocates 100% to single wallet', async () => {
      const helius = mockHelius();
      const ctx = makeCtx({
        strategy: makeStrategy({
          distributionMode: 'CUSTOM_LIST',
          customAllocations: [
            { wallet: HOLDER_A, percentage: 100 },
          ],
        }),
        helius,
        travelBalanceService: balanceSvc,
      });

      const result = await allocatePhase(ctx);

      expect(result.success).toBe(true);
      expect(result.data?.allocatedUsd).toBe(100);
      expect(result.data?.holderCount).toBe(1);

      const balance = await balanceSvc.getByStrategyAndWallet(1, HOLDER_A);
      expect(balance!.balanceUsd).toBe(100);
      expect(helius.getTopHolders).not.toHaveBeenCalled();
    });

    it('distributes 60/40 split correctly', async () => {
      const helius = mockHelius();
      const ctx = makeCtx({
        run: makeRun({ swappedUsdc: 200 }),
        strategy: makeStrategy({
          distributionMode: 'CUSTOM_LIST',
          customAllocations: [
            { wallet: HOLDER_A, percentage: 60 },
            { wallet: HOLDER_B, percentage: 40 },
          ],
        }),
        helius,
        travelBalanceService: balanceSvc,
      });

      const result = await allocatePhase(ctx);

      expect(result.success).toBe(true);
      expect(result.data?.allocatedUsd).toBe(200);
      expect(result.data?.holderCount).toBe(2);

      const balA = await balanceSvc.getByStrategyAndWallet(1, HOLDER_A);
      const balB = await balanceSvc.getByStrategyAndWallet(1, HOLDER_B);
      expect(balA!.balanceUsd).toBe(120);
      expect(balB!.balanceUsd).toBe(80);
      expect(helius.getTopHolders).not.toHaveBeenCalled();
    });

    it('works without HeliusClient in context', async () => {
      const ctx = makeCtx({
        strategy: makeStrategy({
          distributionMode: 'CUSTOM_LIST',
          customAllocations: [
            { wallet: HOLDER_A, percentage: 50 },
            { wallet: HOLDER_B, percentage: 50 },
          ],
        }),
        // No helius provided
        travelBalanceService: balanceSvc,
      });

      const result = await allocatePhase(ctx);

      expect(result.success).toBe(true);
      expect(result.data?.allocatedUsd).toBe(100);
      expect(result.data?.holderCount).toBe(2);

      const balA = await balanceSvc.getByStrategyAndWallet(1, HOLDER_A);
      const balB = await balanceSvc.getByStrategyAndWallet(1, HOLDER_B);
      expect(balA!.balanceUsd).toBe(50);
      expect(balB!.balanceUsd).toBe(50);
    });
  });

  // ─── Error propagation ──────────────────────────────────

  describe('error propagation', () => {
    it('returns HELIUS_ERROR when getTopHolders fails', async () => {
      const helius = mockHelius();
      helius.getTopHolders = vi.fn().mockRejectedValue(new Error('DAS API timeout'));

      const ctx = makeCtx({
        strategy: makeStrategy({ distributionMode: 'EQUAL_SPLIT' }),
        helius,
        travelBalanceService: balanceSvc,
      });

      const result = await allocatePhase(ctx);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('HELIUS_ERROR');
      expect(result.error?.message).toContain('DAS API timeout');
    });

    it('returns BALANCE_ERROR when allocate() throws', async () => {
      const helius = mockHelius();
      // Create a travelBalanceService that rejects on allocate
      const badSvc: TravelBalanceService = {
        allocate: vi.fn().mockRejectedValue(new Error('DB write failed')),
        deduct: vi.fn().mockResolvedValue(undefined) as any,
        getByStrategyAndWallet: vi.fn().mockResolvedValue(undefined) as any,
        getByStrategy: vi.fn().mockResolvedValue([]) as any,
        getTotal: vi.fn().mockResolvedValue(0) as any,
      };

      const ctx = makeCtx({
        strategy: makeStrategy({ distributionMode: 'OWNER_ONLY' }),
        helius,
        travelBalanceService: badSvc,
      });

      const result = await allocatePhase(ctx);

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('BALANCE_ERROR');
      expect(result.error?.message).toContain('DB write failed');
    });
  });

  // ─── Checkpoint data shape ──────────────────────────────

  describe('checkpoint data', () => {
    it('returns allocatedUsd and holderCount in result.data', async () => {
      const helius = mockHelius([
        { owner: HOLDER_A, balance: 500n },
        { owner: HOLDER_B, balance: 500n },
      ]);
      const ctx = makeCtx({
        run: makeRun({ swappedUsdc: 50.0 }),
        strategy: makeStrategy({ distributionMode: 'EQUAL_SPLIT' }),
        helius,
        travelBalanceService: balanceSvc,
      });

      const result = await allocatePhase(ctx);

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('allocatedUsd');
      expect(result.data).toHaveProperty('holderCount');
      expect(result.data?.holderCount).toBe(2);
      expect(result.data?.allocatedUsd).toBeCloseTo(50, 1);
    });
  });

  // ─── Accumulation across runs ───────────────────────────

  describe('balance accumulation', () => {
    it('upserts balances across multiple allocations', async () => {
      const helius = mockHelius();
      const ctx = makeCtx({
        run: makeRun({ swappedUsdc: 40.0 }),
        strategy: makeStrategy({ distributionMode: 'OWNER_ONLY' }),
        helius,
        travelBalanceService: balanceSvc,
      });

      // First allocation
      await allocatePhase(ctx);
      let balance = await balanceSvc.getByStrategyAndWallet(1, OWNER);
      expect(balance!.balanceUsd).toBe(40);

      // Second allocation
      await allocatePhase(ctx);
      balance = await balanceSvc.getByStrategyAndWallet(1, OWNER);
      expect(balance!.balanceUsd).toBe(80);
      expect(balance!.totalEarned).toBe(80);
    });
  });
});
