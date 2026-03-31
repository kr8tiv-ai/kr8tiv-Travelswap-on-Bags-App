import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database, type DatabaseConnection } from '../Database.js';
import { createTravelBalanceService, type TravelBalanceService } from '../TravelBalanceService.js';

describe('TravelBalanceService', () => {
  let db: Database;
  let conn: DatabaseConnection;
  let svc: TravelBalanceService;
  let strategyId: number;

  const WALLET_A = 'WalletAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const WALLET_B = 'WalletBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

  beforeEach(async () => {
    db = new Database(':memory:');
    conn = await db.connect();
    await db.runMigrations();
    svc = createTravelBalanceService(conn);

    // Insert a strategy for FK constraints
    await conn.run(
      "INSERT INTO strategies (token_mint) VALUES (?)",
      'So11111111111111111111111111111111111111112',
    );
    strategyId = 1;
  });

  afterEach(() => {
    db.close();
  });

  // ─── allocate() ────────────────────────────────────────────

  describe('allocate()', () => {
    it('creates a new balance row on first allocation', async () => {
      const balance = await svc.allocate(strategyId, WALLET_A, 25.50);

      expect(balance.strategyId).toBe(String(strategyId));
      expect(balance.walletAddress).toBe(WALLET_A);
      expect(balance.balanceUsd).toBe(25.50);
      expect(balance.totalEarned).toBe(25.50);
      expect(balance.totalSpent).toBe(0);
      expect(balance.balanceId).toBeTruthy();
      expect(balance.createdAt).toBeTruthy();
      expect(balance.updatedAt).toBeTruthy();
    });

    it('increments balance on second allocation (upsert, never replaces)', async () => {
      await svc.allocate(strategyId, WALLET_A, 10.00);
      const after = await svc.allocate(strategyId, WALLET_A, 15.00);

      expect(after.balanceUsd).toBe(25.00);
      expect(after.totalEarned).toBe(25.00);
      expect(after.totalSpent).toBe(0);
    });

    it('accumulates across many allocations', async () => {
      await svc.allocate(strategyId, WALLET_A, 5.00);
      await svc.allocate(strategyId, WALLET_A, 3.00);
      await svc.allocate(strategyId, WALLET_A, 2.00);
      const result = await svc.allocate(strategyId, WALLET_A, 1.00);

      expect(result.balanceUsd).toBe(11.00);
      expect(result.totalEarned).toBe(11.00);
    });

    it('creates separate balances for different wallets', async () => {
      await svc.allocate(strategyId, WALLET_A, 10.00);
      await svc.allocate(strategyId, WALLET_B, 20.00);

      const a = await svc.getByStrategyAndWallet(strategyId, WALLET_A);
      const b = await svc.getByStrategyAndWallet(strategyId, WALLET_B);

      expect(a?.balanceUsd).toBe(10.00);
      expect(b?.balanceUsd).toBe(20.00);
    });

    it('creates separate balances for different strategies', async () => {
      // Create a second strategy
      await conn.run(
        "INSERT INTO strategies (token_mint) VALUES (?)",
        'TokenMintBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      );
      const strategy2 = 2;

      await svc.allocate(strategyId, WALLET_A, 10.00);
      await svc.allocate(strategy2, WALLET_A, 50.00);

      const bal1 = await svc.getByStrategyAndWallet(strategyId, WALLET_A);
      const bal2 = await svc.getByStrategyAndWallet(strategy2, WALLET_A);

      expect(bal1?.balanceUsd).toBe(10.00);
      expect(bal2?.balanceUsd).toBe(50.00);
    });

    // ── Negative tests ─────────────────────────────────────────

    it('rejects negative allocation amount', async () => {
      await expect(svc.allocate(strategyId, WALLET_A, -5.00)).rejects.toThrow(
        'Allocation amount must be a positive number',
      );
    });

    it('rejects zero allocation amount', async () => {
      await expect(svc.allocate(strategyId, WALLET_A, 0)).rejects.toThrow(
        'Allocation amount must be a positive number',
      );
    });

    it('rejects NaN allocation amount', async () => {
      await expect(svc.allocate(strategyId, WALLET_A, NaN)).rejects.toThrow(
        'Allocation amount must be a positive number',
      );
    });

    it('rejects Infinity allocation amount', async () => {
      await expect(svc.allocate(strategyId, WALLET_A, Infinity)).rejects.toThrow(
        'Allocation amount must be a positive number',
      );
    });

    it('rejects empty wallet address', async () => {
      await expect(svc.allocate(strategyId, '', 10.00)).rejects.toThrow(
        'Wallet address must be a non-empty string',
      );
    });

    it('rejects whitespace-only wallet address', async () => {
      await expect(svc.allocate(strategyId, '   ', 10.00)).rejects.toThrow(
        'Wallet address must be a non-empty string',
      );
    });
  });

  // ─── deduct() ──────────────────────────────────────────────

  describe('deduct()', () => {
    it('deducts from balance and tracks total_spent', async () => {
      await svc.allocate(strategyId, WALLET_A, 100.00);
      const result = await svc.deduct(strategyId, WALLET_A, 30.00);

      expect(result.balanceUsd).toBe(70.00);
      expect(result.totalSpent).toBe(30.00);
      expect(result.totalEarned).toBe(100.00);
    });

    it('allows multiple deductions', async () => {
      await svc.allocate(strategyId, WALLET_A, 100.00);
      await svc.deduct(strategyId, WALLET_A, 20.00);
      const result = await svc.deduct(strategyId, WALLET_A, 30.00);

      expect(result.balanceUsd).toBe(50.00);
      expect(result.totalSpent).toBe(50.00);
    });

    it('allows deducting exact balance to zero', async () => {
      await svc.allocate(strategyId, WALLET_A, 42.00);
      const result = await svc.deduct(strategyId, WALLET_A, 42.00);

      expect(result.balanceUsd).toBe(0);
      expect(result.totalSpent).toBe(42.00);
    });

    it('rejects deduction exceeding balance', async () => {
      await svc.allocate(strategyId, WALLET_A, 10.00);

      await expect(svc.deduct(strategyId, WALLET_A, 15.00)).rejects.toThrow(
        'Insufficient balance: has $10.00, tried to deduct $15.00',
      );
    });

    it('rejects deduction from nonexistent balance', async () => {
      await expect(svc.deduct(strategyId, WALLET_A, 5.00)).rejects.toThrow(
        'No travel balance found',
      );
    });

    it('rejects deduction for unknown wallet', async () => {
      await svc.allocate(strategyId, WALLET_A, 100.00);

      await expect(svc.deduct(strategyId, WALLET_B, 5.00)).rejects.toThrow(
        'No travel balance found',
      );
    });

    // ── Negative tests ─────────────────────────────────────────

    it('rejects negative deduction amount', async () => {
      await svc.allocate(strategyId, WALLET_A, 100.00);

      await expect(svc.deduct(strategyId, WALLET_A, -10.00)).rejects.toThrow(
        'Deduction amount must be a positive number',
      );
    });

    it('rejects zero deduction amount', async () => {
      await svc.allocate(strategyId, WALLET_A, 100.00);

      await expect(svc.deduct(strategyId, WALLET_A, 0)).rejects.toThrow(
        'Deduction amount must be a positive number',
      );
    });

    it('rejects empty wallet on deduction', async () => {
      await expect(svc.deduct(strategyId, '', 5.00)).rejects.toThrow(
        'Wallet address must be a non-empty string',
      );
    });
  });

  // ─── getByStrategyAndWallet() ──────────────────────────────

  describe('getByStrategyAndWallet()', () => {
    it('returns the balance for a known strategy+wallet', async () => {
      await svc.allocate(strategyId, WALLET_A, 33.33);

      const result = await svc.getByStrategyAndWallet(strategyId, WALLET_A);

      expect(result).toBeDefined();
      expect(result!.balanceUsd).toBe(33.33);
      expect(result!.walletAddress).toBe(WALLET_A);
    });

    it('returns undefined for unknown wallet', async () => {
      const result = await svc.getByStrategyAndWallet(strategyId, WALLET_A);
      expect(result).toBeUndefined();
    });

    it('returns undefined for unknown strategy', async () => {
      await svc.allocate(strategyId, WALLET_A, 10.00);
      const result = await svc.getByStrategyAndWallet(999, WALLET_A);
      expect(result).toBeUndefined();
    });
  });

  // ─── getByStrategy() ──────────────────────────────────────

  describe('getByStrategy()', () => {
    it('returns all balances for a strategy', async () => {
      await svc.allocate(strategyId, WALLET_A, 10.00);
      await svc.allocate(strategyId, WALLET_B, 20.00);

      const results = await svc.getByStrategy(strategyId);

      expect(results).toHaveLength(2);
      expect(results[0].walletAddress).toBe(WALLET_A);
      expect(results[1].walletAddress).toBe(WALLET_B);
    });

    it('returns empty array for strategy with no balances', async () => {
      const results = await svc.getByStrategy(strategyId);
      expect(results).toEqual([]);
    });

    it('does not return balances from other strategies', async () => {
      await conn.run(
        "INSERT INTO strategies (token_mint) VALUES (?)",
        'TokenMintBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      );
      const strategy2 = 2;

      await svc.allocate(strategyId, WALLET_A, 10.00);
      await svc.allocate(strategy2, WALLET_B, 99.00);

      const results = await svc.getByStrategy(strategyId);
      expect(results).toHaveLength(1);
      expect(results[0].walletAddress).toBe(WALLET_A);
    });
  });

  // ─── getTotal() ────────────────────────────────────────────

  describe('getTotal()', () => {
    it('returns sum of all balance_usd for a strategy', async () => {
      await svc.allocate(strategyId, WALLET_A, 10.00);
      await svc.allocate(strategyId, WALLET_B, 20.00);

      expect(await svc.getTotal(strategyId)).toBe(30.00);
    });

    it('returns 0 for strategy with no balances', async () => {
      expect(await svc.getTotal(strategyId)).toBe(0);
    });

    it('reflects deductions in total', async () => {
      await svc.allocate(strategyId, WALLET_A, 100.00);
      await svc.allocate(strategyId, WALLET_B, 50.00);
      await svc.deduct(strategyId, WALLET_A, 25.00);

      expect(await svc.getTotal(strategyId)).toBe(125.00);
    });

    it('does not include balances from other strategies', async () => {
      await conn.run(
        "INSERT INTO strategies (token_mint) VALUES (?)",
        'TokenMintBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      );
      const strategy2 = 2;

      await svc.allocate(strategyId, WALLET_A, 10.00);
      await svc.allocate(strategy2, WALLET_B, 999.00);

      expect(await svc.getTotal(strategyId)).toBe(10.00);
    });
  });

  // ─── Row-to-domain mapping ─────────────────────────────────

  describe('domain mapping', () => {
    it('maps all DB row fields to TravelBalance type', async () => {
      const balance = await svc.allocate(strategyId, WALLET_A, 50.00);

      expect(typeof balance.balanceId).toBe('string');
      expect(typeof balance.strategyId).toBe('string');
      expect(typeof balance.walletAddress).toBe('string');
      expect(typeof balance.balanceUsd).toBe('number');
      expect(typeof balance.totalEarned).toBe('number');
      expect(typeof balance.totalSpent).toBe('number');
      expect(typeof balance.createdAt).toBe('string');
      expect(typeof balance.updatedAt).toBe('string');
    });

    it('converts integer IDs to strings', async () => {
      const balance = await svc.allocate(strategyId, WALLET_A, 10.00);
      // DB stores id as integer, domain uses string
      expect(balance.balanceId).toBe('1');
      expect(balance.strategyId).toBe('1');
    });
  });

  // ─── Service interface ─────────────────────────────────────

  describe('service interface', () => {
    it('exposes exactly the expected methods', () => {
      const methods = Object.keys(svc).sort();
      expect(methods).toEqual([
        'allocate',
        'deduct',
        'getByStrategy',
        'getByStrategyAndWallet',
        'getTotal',
      ]);
    });
  });
});
