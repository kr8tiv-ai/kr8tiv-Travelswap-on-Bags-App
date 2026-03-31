import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database, type DatabaseConnection } from '../Database.js';
import { createGiftCardService, type GiftCardService } from '../GiftCardService.js';

describe('GiftCardService', () => {
  let db: Database;
  let conn: DatabaseConnection;
  let svc: GiftCardService;
  let strategyId: number;
  let runId: number;

  const WALLET_A = 'WalletAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const WALLET_B = 'WalletBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
  const ENCRYPTED_CODE = 'aabbccdd:eeff0011:22334455';

  beforeEach(async () => {
    db = new Database(':memory:');
    conn = await db.connect();
    await db.runMigrations();
    svc = createGiftCardService(conn);

    // Insert a strategy and run for FK constraints
    await conn.run(
      "INSERT INTO strategies (token_mint) VALUES (?)",
      'So11111111111111111111111111111111111111112',
    );
    strategyId = 1;

    await conn.run(
      "INSERT INTO runs (strategy_id) VALUES (?)",
      strategyId,
    );
    runId = 1;
  });

  afterEach(() => {
    db.close();
  });

  // ─── purchase() ────────────────────────────────────────────

  describe('purchase()', () => {
    it('creates a gift card with correct fields', async () => {
      const gc = await svc.purchase(strategyId, runId, WALLET_A, 50, ENCRYPTED_CODE);

      expect(gc.giftCardId).toBe('1');
      expect(gc.strategyId).toBe(String(strategyId));
      expect(gc.runId).toBe(String(runId));
      expect(gc.walletAddress).toBe(WALLET_A);
      expect(gc.denominationUsd).toBe(50);
      expect(gc.status).toBe('PURCHASED');
      expect(gc.deliveredAt).toBeNull();
      expect(gc.redeemedAt).toBeNull();
      expect(gc.createdAt).toBeTruthy();
    });

    it('stores the encrypted code', async () => {
      const gc = await svc.purchase(strategyId, runId, WALLET_A, 100, ENCRYPTED_CODE);
      expect(gc.codeEncrypted).toBe(ENCRYPTED_CODE);
    });

    it('creates multiple gift cards with sequential IDs', async () => {
      const gc1 = await svc.purchase(strategyId, runId, WALLET_A, 50, 'code1:data:tag');
      const gc2 = await svc.purchase(strategyId, runId, WALLET_A, 100, 'code2:data:tag');

      expect(gc1.giftCardId).toBe('1');
      expect(gc2.giftCardId).toBe('2');
    });

    it('allows multiple purchases for same wallet', async () => {
      await svc.purchase(strategyId, runId, WALLET_A, 50, 'c1:d1:t1');
      await svc.purchase(strategyId, runId, WALLET_A, 100, 'c2:d2:t2');
      await svc.purchase(strategyId, runId, WALLET_A, 200, 'c3:d3:t3');

      const all = await svc.getByWallet(WALLET_A);
      expect(all).toHaveLength(3);
    });

    // ── Negative tests ─────────────────────────────────────────

    it('rejects empty wallet address', async () => {
      await expect(svc.purchase(strategyId, runId, '', 50, ENCRYPTED_CODE)).rejects.toThrow(
        'Wallet address must be a non-empty string',
      );
    });

    it('rejects whitespace-only wallet address', async () => {
      await expect(svc.purchase(strategyId, runId, '   ', 50, ENCRYPTED_CODE)).rejects.toThrow(
        'Wallet address must be a non-empty string',
      );
    });

    it('rejects zero denomination', async () => {
      await expect(svc.purchase(strategyId, runId, WALLET_A, 0, ENCRYPTED_CODE)).rejects.toThrow(
        'Denomination must be a positive number',
      );
    });

    it('rejects negative denomination', async () => {
      await expect(svc.purchase(strategyId, runId, WALLET_A, -50, ENCRYPTED_CODE)).rejects.toThrow(
        'Denomination must be a positive number',
      );
    });

    it('rejects empty encrypted code', async () => {
      await expect(svc.purchase(strategyId, runId, WALLET_A, 50, '')).rejects.toThrow(
        'Encrypted code must be a non-empty string',
      );
    });
  });

  // ─── getByWallet() ─────────────────────────────────────────

  describe('getByWallet()', () => {
    it('returns gift cards for matching wallet', async () => {
      await svc.purchase(strategyId, runId, WALLET_A, 50, 'c1:d1:t1');
      await svc.purchase(strategyId, runId, WALLET_B, 100, 'c2:d2:t2');

      const results = await svc.getByWallet(WALLET_A);
      expect(results).toHaveLength(1);
      expect(results[0].walletAddress).toBe(WALLET_A);
    });

    it('returns empty array for non-matching wallet', async () => {
      await svc.purchase(strategyId, runId, WALLET_A, 50, ENCRYPTED_CODE);

      const results = await svc.getByWallet('NonExistentWallet');
      expect(results).toEqual([]);
    });

    it('returns empty array on empty table', async () => {
      const results = await svc.getByWallet(WALLET_A);
      expect(results).toEqual([]);
    });
  });

  // ─── getByRun() ────────────────────────────────────────────

  describe('getByRun()', () => {
    it('returns gift cards for matching run', async () => {
      await svc.purchase(strategyId, runId, WALLET_A, 50, ENCRYPTED_CODE);
      await svc.purchase(strategyId, runId, WALLET_B, 100, 'c2:d2:t2');

      const results = await svc.getByRun(runId);
      expect(results).toHaveLength(2);
    });

    it('returns empty array for non-matching run', async () => {
      await svc.purchase(strategyId, runId, WALLET_A, 50, ENCRYPTED_CODE);

      const results = await svc.getByRun(999);
      expect(results).toEqual([]);
    });

    it('returns empty array on empty table', async () => {
      const results = await svc.getByRun(runId);
      expect(results).toEqual([]);
    });
  });

  // ─── getByStrategy() ──────────────────────────────────────

  describe('getByStrategy()', () => {
    it('returns all gift cards for strategy', async () => {
      await svc.purchase(strategyId, runId, WALLET_A, 50, 'c1:d1:t1');
      await svc.purchase(strategyId, runId, WALLET_B, 100, 'c2:d2:t2');

      const results = await svc.getByStrategy(strategyId);
      expect(results).toHaveLength(2);
    });

    it('returns empty array for strategy with no gift cards', async () => {
      const results = await svc.getByStrategy(strategyId);
      expect(results).toEqual([]);
    });

    it('does not return gift cards from other strategies', async () => {
      await conn.run(
        "INSERT INTO strategies (token_mint) VALUES (?)",
        'TokenMintBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      );
      const strategy2 = 2;
      await conn.run("INSERT INTO runs (strategy_id) VALUES (?)", strategy2);
      const run2 = 2;

      await svc.purchase(strategyId, runId, WALLET_A, 50, 'c1:d1:t1');
      await svc.purchase(strategy2, run2, WALLET_B, 100, 'c2:d2:t2');

      const results = await svc.getByStrategy(strategyId);
      expect(results).toHaveLength(1);
      expect(results[0].walletAddress).toBe(WALLET_A);
    });
  });

  // ─── updateStatus() ───────────────────────────────────────

  describe('updateStatus()', () => {
    it('transitions PURCHASED → DELIVERED and sets delivered_at', async () => {
      const gc = await svc.purchase(strategyId, runId, WALLET_A, 50, ENCRYPTED_CODE);
      const updated = await svc.updateStatus(Number(gc.giftCardId), 'DELIVERED');

      expect(updated.status).toBe('DELIVERED');
      expect(updated.deliveredAt).toBeTruthy();
      expect(updated.redeemedAt).toBeNull();
    });

    it('transitions DELIVERED → REDEEMED and sets redeemed_at', async () => {
      const gc = await svc.purchase(strategyId, runId, WALLET_A, 50, ENCRYPTED_CODE);
      await svc.updateStatus(Number(gc.giftCardId), 'DELIVERED');
      const updated = await svc.updateStatus(Number(gc.giftCardId), 'REDEEMED');

      expect(updated.status).toBe('REDEEMED');
      expect(updated.redeemedAt).toBeTruthy();
      expect(updated.deliveredAt).toBeTruthy();
    });

    it('rejects invalid transition PURCHASED → REDEEMED', async () => {
      const gc = await svc.purchase(strategyId, runId, WALLET_A, 50, ENCRYPTED_CODE);

      await expect(svc.updateStatus(Number(gc.giftCardId), 'REDEEMED')).rejects.toThrow(
        'Invalid status transition',
      );
    });

    it('rejects transition from REDEEMED (terminal state)', async () => {
      const gc = await svc.purchase(strategyId, runId, WALLET_A, 50, ENCRYPTED_CODE);
      await svc.updateStatus(Number(gc.giftCardId), 'DELIVERED');
      await svc.updateStatus(Number(gc.giftCardId), 'REDEEMED');

      await expect(svc.updateStatus(Number(gc.giftCardId), 'DELIVERED')).rejects.toThrow(
        'Invalid status transition',
      );
    });

    it('throws for non-existent gift card', async () => {
      await expect(svc.updateStatus(999, 'DELIVERED')).rejects.toThrow(
        'Gift card not found',
      );
    });
  });

  // ─── Domain mapping ───────────────────────────────────────

  describe('domain mapping', () => {
    it('maps all DB row fields to GiftCard type', async () => {
      const gc = await svc.purchase(strategyId, runId, WALLET_A, 50, ENCRYPTED_CODE);

      expect(typeof gc.giftCardId).toBe('string');
      expect(typeof gc.strategyId).toBe('string');
      expect(typeof gc.runId).toBe('string');
      expect(typeof gc.walletAddress).toBe('string');
      expect(typeof gc.denominationUsd).toBe('number');
      expect(typeof gc.codeEncrypted).toBe('string');
      expect(typeof gc.status).toBe('string');
      expect(typeof gc.createdAt).toBe('string');
    });

    it('converts integer IDs to strings', async () => {
      const gc = await svc.purchase(strategyId, runId, WALLET_A, 50, ENCRYPTED_CODE);
      expect(gc.giftCardId).toBe('1');
      expect(gc.strategyId).toBe('1');
      expect(gc.runId).toBe('1');
    });
  });

  // ─── Service interface ─────────────────────────────────────

  describe('service interface', () => {
    it('exposes exactly the expected methods', () => {
      const methods = Object.keys(svc).sort();
      expect(methods).toEqual([
        'getByRun',
        'getByStrategy',
        'getByWallet',
        'purchase',
        'updateStatus',
      ]);
    });
  });
});
