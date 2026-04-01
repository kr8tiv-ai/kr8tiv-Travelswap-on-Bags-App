// ─── GiftCardService Tests ─────────────────────────────────────
// Tests for the new purchasePending() and getByPayorderId() methods
// plus PENDING status transitions. Uses in-memory SQLite via Database.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../Database.js';
import { createGiftCardService, type GiftCardService } from '../GiftCardService.js';
import type { DatabaseConnection } from '../Database.js';

// ─── Setup ─────────────────────────────────────────────────────

let db: Database;
let conn: DatabaseConnection;
let service: GiftCardService;

beforeEach(async () => {
  db = new Database(':memory:');
  conn = await db.connect();
  await db.runMigrations('sqlite');
  service = createGiftCardService(conn);

  // Insert a strategy and run for FK references
  await conn.run(
    `INSERT INTO strategies (name, owner_wallet, token_mint, fee_source, threshold_sol, slippage_bps, distribution_mode, distribution_top_n, credit_mode, gift_card_threshold_usd, cron_expression, enabled)
     VALUES ('test', 'wallet1', 'mint1', 'CLAIMABLE_POSITIONS', 5, 50, 'OWNER_ONLY', 10, 'GIFT_CARD', 50, '0 */6 * * *', 1)`
  );
  await conn.run(
    `INSERT INTO runs (strategy_id, phase, status)
     VALUES (1, 'CREDITING', 'RUNNING')`
  );
});

afterEach(() => {
  db.close();
});

// ─── Tests ─────────────────────────────────────────────────────

describe('GiftCardService', () => {
  describe('purchasePending', () => {
    it('inserts a PENDING gift card with payorder_id', async () => {
      const gc = await service.purchasePending(1, 1, 'wallet1', 100, 'po_abc123');

      expect(gc.status).toBe('PENDING');
      expect(gc.payorderId).toBe('po_abc123');
      expect(gc.paymentStatus).toBe('PENDING');
      expect(gc.denominationUsd).toBe(100);
      expect(gc.walletAddress).toBe('wallet1');
      expect(gc.codeEncrypted).toBe(''); // no code yet
      expect(gc.giftCardId).toBeTruthy();
    });

    it('rejects empty wallet address', async () => {
      await expect(service.purchasePending(1, 1, '', 100, 'po_1'))
        .rejects.toThrow('Wallet address must be a non-empty string');
    });

    it('rejects zero denomination', async () => {
      await expect(service.purchasePending(1, 1, 'wallet1', 0, 'po_1'))
        .rejects.toThrow('Denomination must be a positive number');
    });

    it('rejects negative denomination', async () => {
      await expect(service.purchasePending(1, 1, 'wallet1', -50, 'po_1'))
        .rejects.toThrow('Denomination must be a positive number');
    });

    it('rejects empty payorder ID', async () => {
      await expect(service.purchasePending(1, 1, 'wallet1', 100, ''))
        .rejects.toThrow('PayOrder ID must be a non-empty string');
    });
  });

  describe('getByPayorderId', () => {
    it('returns gift card matching payorder_id', async () => {
      await service.purchasePending(1, 1, 'wallet1', 100, 'po_find_me');

      const found = await service.getByPayorderId('po_find_me');

      expect(found).toBeDefined();
      expect(found!.payorderId).toBe('po_find_me');
      expect(found!.status).toBe('PENDING');
    });

    it('returns undefined for nonexistent payorder_id', async () => {
      const found = await service.getByPayorderId('po_nonexistent');
      expect(found).toBeUndefined();
    });
  });

  describe('PENDING → PURCHASED transition', () => {
    it('allows PENDING → PURCHASED status transition', async () => {
      const gc = await service.purchasePending(1, 1, 'wallet1', 100, 'po_transition');
      const updated = await service.updateStatus(Number(gc.giftCardId), 'PURCHASED');

      expect(updated.status).toBe('PURCHASED');
      expect(updated.payorderId).toBe('po_transition');
    });

    it('allows PENDING → EXPIRED status transition', async () => {
      const gc = await service.purchasePending(1, 1, 'wallet1', 100, 'po_expire');
      const updated = await service.updateStatus(Number(gc.giftCardId), 'EXPIRED');

      expect(updated.status).toBe('EXPIRED');
    });

    it('rejects PENDING → DELIVERED (invalid transition)', async () => {
      const gc = await service.purchasePending(1, 1, 'wallet1', 100, 'po_bad');

      await expect(service.updateStatus(Number(gc.giftCardId), 'DELIVERED'))
        .rejects.toThrow('Invalid status transition');
    });
  });

  describe('existing purchase method still works', () => {
    it('inserts a PURCHASED gift card with encrypted code', async () => {
      const gc = await service.purchase(1, 1, 'wallet1', 50, 'encrypted_code_here');

      expect(gc.status).toBe('PURCHASED');
      expect(gc.codeEncrypted).toBe('encrypted_code_here');
      expect(gc.payorderId).toBeNull();
      expect(gc.paymentStatus).toBeNull();
    });

    it('PURCHASED → DELIVERED still works', async () => {
      const gc = await service.purchase(1, 1, 'wallet1', 50, 'code');
      const updated = await service.updateStatus(Number(gc.giftCardId), 'DELIVERED');

      expect(updated.status).toBe('DELIVERED');
      expect(updated.deliveredAt).toBeTruthy();
    });
  });
});
