// ─── TravelPassService Tests ───────────────────────────────────
// Comprehensive tests for CRUD operations, status transitions,
// validation, and error cases. Uses in-memory SQLite via Database.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../Database.js';
import { createTravelPassService, type TravelPassService } from '../TravelPassService.js';
import type { DatabaseConnection } from '../Database.js';

// ─── Setup ─────────────────────────────────────────────────────

let db: Database;
let conn: DatabaseConnection;
let service: TravelPassService;

beforeEach(async () => {
  db = new Database(':memory:');
  conn = await db.connect();
  await db.runMigrations('sqlite');
  service = createTravelPassService(conn);

  // Insert a strategy, run, and gift card for FK references
  await conn.run(
    `INSERT INTO strategies (name, owner_wallet, token_mint, fee_source, threshold_sol, slippage_bps, distribution_mode, distribution_top_n, credit_mode, gift_card_threshold_usd, cron_expression, enabled)
     VALUES ('test', 'wallet1', 'mint1', 'CLAIMABLE_POSITIONS', 5, 50, 'OWNER_ONLY', 10, 'GIFT_CARD', 50, '0 */6 * * *', 1)`,
  );
  await conn.run(
    `INSERT INTO runs (strategy_id, phase, status)
     VALUES (1, 'CREDITING', 'RUNNING')`,
  );
  await conn.run(
    `INSERT INTO gift_cards (strategy_id, run_id, wallet_address, denomination_usd, code_encrypted, status)
     VALUES (1, 1, 'wallet1', 50, 'enc_code_1', 'PURCHASED')`,
  );
});

afterEach(() => {
  db.close();
});

// ─── Tests ─────────────────────────────────────────────────────

describe('TravelPassService', () => {
  describe('create', () => {
    it('creates a PENDING travel pass', async () => {
      const pass = await service.create({
        giftCardId: 1,
        strategyId: 1,
        walletAddress: 'wallet1',
        denominationUsd: 50,
        tokenMint: 'mint1',
      });

      expect(pass.status).toBe('PENDING');
      expect(pass.giftCardId).toBe('1');
      expect(pass.strategyId).toBe('1');
      expect(pass.walletAddress).toBe('wallet1');
      expect(pass.denominationUsd).toBe(50);
      expect(pass.tokenMint).toBe('mint1');
      expect(pass.mintSignature).toBeNull();
      expect(pass.metadataUri).toBeNull();
      expect(pass.errorMessage).toBeNull();
      expect(pass.mintedAt).toBeNull();
      expect(pass.id).toBeTruthy();
      expect(pass.createdAt).toBeTruthy();
    });

    it('rejects empty wallet address', async () => {
      await expect(
        service.create({
          giftCardId: 1,
          strategyId: 1,
          walletAddress: '',
          denominationUsd: 50,
          tokenMint: 'mint1',
        }),
      ).rejects.toThrow('Wallet address must be a non-empty string');
    });

    it('rejects whitespace-only wallet address', async () => {
      await expect(
        service.create({
          giftCardId: 1,
          strategyId: 1,
          walletAddress: '   ',
          denominationUsd: 50,
          tokenMint: 'mint1',
        }),
      ).rejects.toThrow('Wallet address must be a non-empty string');
    });

    it('rejects negative denomination', async () => {
      await expect(
        service.create({
          giftCardId: 1,
          strategyId: 1,
          walletAddress: 'wallet1',
          denominationUsd: -10,
          tokenMint: 'mint1',
        }),
      ).rejects.toThrow('Denomination must be a positive number');
    });

    it('rejects zero denomination', async () => {
      await expect(
        service.create({
          giftCardId: 1,
          strategyId: 1,
          walletAddress: 'wallet1',
          denominationUsd: 0,
          tokenMint: 'mint1',
        }),
      ).rejects.toThrow('Denomination must be a positive number');
    });

    it('rejects empty tokenMint', async () => {
      await expect(
        service.create({
          giftCardId: 1,
          strategyId: 1,
          walletAddress: 'wallet1',
          denominationUsd: 50,
          tokenMint: '',
        }),
      ).rejects.toThrow('Token mint must be a non-empty string');
    });

    it('rejects invalid giftCardId', async () => {
      await expect(
        service.create({
          giftCardId: -1,
          strategyId: 1,
          walletAddress: 'wallet1',
          denominationUsd: 50,
          tokenMint: 'mint1',
        }),
      ).rejects.toThrow('Gift card ID must be a positive number');
    });

    it('trims whitespace from wallet and tokenMint', async () => {
      const pass = await service.create({
        giftCardId: 1,
        strategyId: 1,
        walletAddress: '  wallet1  ',
        denominationUsd: 50,
        tokenMint: '  mint1  ',
      });

      expect(pass.walletAddress).toBe('wallet1');
      expect(pass.tokenMint).toBe('mint1');
    });
  });

  describe('getById', () => {
    it('returns a travel pass by ID', async () => {
      const created = await service.create({
        giftCardId: 1,
        strategyId: 1,
        walletAddress: 'wallet1',
        denominationUsd: 50,
        tokenMint: 'mint1',
      });

      const found = await service.getById(Number(created.id));
      expect(found).toBeDefined();
      expect(found!.id).toBe(created.id);
    });

    it('returns undefined for nonexistent ID', async () => {
      const found = await service.getById(99999);
      expect(found).toBeUndefined();
    });
  });

  describe('getByGiftCardId', () => {
    it('returns a travel pass by gift card ID', async () => {
      await service.create({
        giftCardId: 1,
        strategyId: 1,
        walletAddress: 'wallet1',
        denominationUsd: 50,
        tokenMint: 'mint1',
      });

      const found = await service.getByGiftCardId(1);
      expect(found).toBeDefined();
      expect(found!.giftCardId).toBe('1');
    });

    it('returns undefined for nonexistent gift card ID', async () => {
      const found = await service.getByGiftCardId(99999);
      expect(found).toBeUndefined();
    });
  });

  describe('getByGiftCardIds', () => {
    it('returns empty array for empty input', async () => {
      const passes = await service.getByGiftCardIds([]);
      expect(passes).toEqual([]);
    });

    it('returns a single matching travel pass', async () => {
      await service.create({
        giftCardId: 1,
        strategyId: 1,
        walletAddress: 'wallet1',
        denominationUsd: 50,
        tokenMint: 'mint1',
      });

      const passes = await service.getByGiftCardIds([1]);
      expect(passes).toHaveLength(1);
      expect(passes[0].giftCardId).toBe('1');
    });

    it('returns multiple matching travel passes', async () => {
      // Insert a second gift card for FK
      await conn.run(
        `INSERT INTO gift_cards (strategy_id, run_id, wallet_address, denomination_usd, code_encrypted, status)
         VALUES (1, 1, 'wallet1', 25, 'enc_code_2', 'PURCHASED')`,
      );

      await service.create({
        giftCardId: 1,
        strategyId: 1,
        walletAddress: 'wallet1',
        denominationUsd: 50,
        tokenMint: 'mint1',
      });
      await service.create({
        giftCardId: 2,
        strategyId: 1,
        walletAddress: 'wallet1',
        denominationUsd: 25,
        tokenMint: 'mint2',
      });

      const passes = await service.getByGiftCardIds([1, 2]);
      expect(passes).toHaveLength(2);
      const gcIds = passes.map((p) => p.giftCardId).sort();
      expect(gcIds).toEqual(['1', '2']);
    });

    it('returns empty array when no IDs match', async () => {
      const passes = await service.getByGiftCardIds([999, 1000]);
      expect(passes).toEqual([]);
    });

    it('returns only matching passes when some IDs do not exist', async () => {
      await service.create({
        giftCardId: 1,
        strategyId: 1,
        walletAddress: 'wallet1',
        denominationUsd: 50,
        tokenMint: 'mint1',
      });

      const passes = await service.getByGiftCardIds([1, 999]);
      expect(passes).toHaveLength(1);
      expect(passes[0].giftCardId).toBe('1');
    });
  });

  describe('getByWallet', () => {
    it('returns all travel passes for a wallet', async () => {
      // Insert a second gift card for a second pass
      await conn.run(
        `INSERT INTO gift_cards (strategy_id, run_id, wallet_address, denomination_usd, code_encrypted, status)
         VALUES (1, 1, 'wallet1', 25, 'enc_code_2', 'PURCHASED')`,
      );

      await service.create({
        giftCardId: 1,
        strategyId: 1,
        walletAddress: 'wallet1',
        denominationUsd: 50,
        tokenMint: 'mint1',
      });
      await service.create({
        giftCardId: 2,
        strategyId: 1,
        walletAddress: 'wallet1',
        denominationUsd: 25,
        tokenMint: 'mint2',
      });

      const passes = await service.getByWallet('wallet1');
      expect(passes).toHaveLength(2);
    });

    it('returns empty array for wallet with no passes', async () => {
      const passes = await service.getByWallet('unknown_wallet');
      expect(passes).toHaveLength(0);
    });
  });

  describe('updateMinted', () => {
    it('transitions PENDING → MINTED with signature and URI', async () => {
      const created = await service.create({
        giftCardId: 1,
        strategyId: 1,
        walletAddress: 'wallet1',
        denominationUsd: 50,
        tokenMint: 'mint1',
      });

      const minted = await service.updateMinted(
        Number(created.id),
        'sig_abc123',
        'https://example.com/metadata/1.json',
      );

      expect(minted.status).toBe('MINTED');
      expect(minted.mintSignature).toBe('sig_abc123');
      expect(minted.metadataUri).toBe('https://example.com/metadata/1.json');
      expect(minted.mintedAt).toBeTruthy();
    });

    it('throws for nonexistent travel pass', async () => {
      await expect(
        service.updateMinted(99999, 'sig_x', 'https://example.com/metadata.json'),
      ).rejects.toThrow('Travel pass 99999 not found');
    });

    it('throws when transitioning from MINTED (terminal state)', async () => {
      const created = await service.create({
        giftCardId: 1,
        strategyId: 1,
        walletAddress: 'wallet1',
        denominationUsd: 50,
        tokenMint: 'mint1',
      });

      await service.updateMinted(Number(created.id), 'sig_1', 'https://example.com/m.json');

      await expect(
        service.updateMinted(Number(created.id), 'sig_2', 'https://example.com/m2.json'),
      ).rejects.toThrow('Cannot transition travel pass');
    });

    it('throws when transitioning from FAILED', async () => {
      const created = await service.create({
        giftCardId: 1,
        strategyId: 1,
        walletAddress: 'wallet1',
        denominationUsd: 50,
        tokenMint: 'mint1',
      });

      await service.updateFailed(Number(created.id), 'some error');

      await expect(
        service.updateMinted(Number(created.id), 'sig_1', 'https://example.com/m.json'),
      ).rejects.toThrow('Cannot transition travel pass');
    });
  });

  describe('updateFailed', () => {
    it('transitions PENDING → FAILED with error message', async () => {
      const created = await service.create({
        giftCardId: 1,
        strategyId: 1,
        walletAddress: 'wallet1',
        denominationUsd: 50,
        tokenMint: 'mint1',
      });

      const failed = await service.updateFailed(Number(created.id), 'Mint transaction timed out');

      expect(failed.status).toBe('FAILED');
      expect(failed.errorMessage).toBe('Mint transaction timed out');
    });

    it('throws for nonexistent travel pass', async () => {
      await expect(
        service.updateFailed(99999, 'error'),
      ).rejects.toThrow('Travel pass 99999 not found');
    });

    it('throws when transitioning from MINTED', async () => {
      const created = await service.create({
        giftCardId: 1,
        strategyId: 1,
        walletAddress: 'wallet1',
        denominationUsd: 50,
        tokenMint: 'mint1',
      });

      await service.updateMinted(Number(created.id), 'sig_1', 'https://example.com/m.json');

      await expect(
        service.updateFailed(Number(created.id), 'late error'),
      ).rejects.toThrow('Cannot transition travel pass');
    });

    it('throws when transitioning from FAILED (already terminal)', async () => {
      const created = await service.create({
        giftCardId: 1,
        strategyId: 1,
        walletAddress: 'wallet1',
        denominationUsd: 50,
        tokenMint: 'mint1',
      });

      await service.updateFailed(Number(created.id), 'first error');

      await expect(
        service.updateFailed(Number(created.id), 'second error'),
      ).rejects.toThrow('Cannot transition travel pass');
    });
  });

  describe('duplicate giftCardId', () => {
    it('allows creating two passes for different gift cards', async () => {
      await conn.run(
        `INSERT INTO gift_cards (strategy_id, run_id, wallet_address, denomination_usd, code_encrypted, status)
         VALUES (1, 1, 'wallet1', 25, 'enc_code_2', 'PURCHASED')`,
      );

      const p1 = await service.create({
        giftCardId: 1,
        strategyId: 1,
        walletAddress: 'wallet1',
        denominationUsd: 50,
        tokenMint: 'mint1',
      });
      const p2 = await service.create({
        giftCardId: 2,
        strategyId: 1,
        walletAddress: 'wallet1',
        denominationUsd: 25,
        tokenMint: 'mint2',
      });

      expect(p1.id).not.toBe(p2.id);
    });
  });
});
