// ─── GiftCardService ───────────────────────────────────────────
// CRUD layer for the gift_cards table. Follows the factory function
// pattern (K004) — createGiftCardService(conn) returns the service
// interface. Status transitions: PURCHASED → DELIVERED → REDEEMED.

import type { DatabaseConnection } from './Database.js';
import type { GiftCard, GiftCardStatus } from '../types/index.js';
import { logger } from '../logger.js';

// ─── DB Row Shape ──────────────────────────────────────────────

interface GiftCardRow {
  id: number;
  strategy_id: number;
  run_id: number;
  wallet_address: string;
  denomination_usd: number;
  code_encrypted: string | null;
  status: GiftCardStatus;
  delivered_at: string | null;
  redeemed_at: string | null;
  created_at: string;
}

// ─── Valid Status Transitions ──────────────────────────────────

const VALID_TRANSITIONS: Record<GiftCardStatus, GiftCardStatus[]> = {
  PURCHASED: ['DELIVERED'],
  DELIVERED: ['REDEEMED'],
  REDEEMED: [],
  EXPIRED: [],
};

// ─── Service Interface ─────────────────────────────────────────

export interface GiftCardService {
  /** Insert a new gift card purchase record. */
  purchase(
    strategyId: number,
    runId: number,
    walletAddress: string,
    denominationUsd: number,
    codeEncrypted: string,
  ): Promise<GiftCard>;

  /** Get all gift cards for a wallet address. */
  getByWallet(walletAddress: string): Promise<GiftCard[]>;

  /** Get all gift cards for a specific run. */
  getByRun(runId: number): Promise<GiftCard[]>;

  /** Get all gift cards for a strategy. */
  getByStrategy(strategyId: number): Promise<GiftCard[]>;

  /** Transition a gift card's status. Sets timestamps on DELIVERED/REDEEMED. */
  updateStatus(giftCardId: number, newStatus: GiftCardStatus): Promise<GiftCard>;
}

// ─── Factory ───────────────────────────────────────────────────

export function createGiftCardService(conn: DatabaseConnection): GiftCardService {
  /** Convert a DB row to the GiftCard domain type. */
  function toGiftCard(row: GiftCardRow): GiftCard {
    return {
      giftCardId: String(row.id),
      strategyId: String(row.strategy_id),
      runId: String(row.run_id),
      walletAddress: row.wallet_address,
      denominationUsd: row.denomination_usd,
      codeEncrypted: row.code_encrypted ?? '',
      status: row.status,
      deliveredAt: row.delivered_at,
      redeemedAt: row.redeemed_at,
      createdAt: row.created_at,
    };
  }

  return {
    async purchase(
      strategyId: number,
      runId: number,
      walletAddress: string,
      denominationUsd: number,
      codeEncrypted: string,
    ): Promise<GiftCard> {
      if (!walletAddress || walletAddress.trim().length === 0) {
        throw new Error('Wallet address must be a non-empty string');
      }
      if (!Number.isFinite(denominationUsd) || denominationUsd <= 0) {
        throw new Error(
          `Denomination must be a positive number, got ${denominationUsd}`,
        );
      }
      if (!codeEncrypted || codeEncrypted.trim().length === 0) {
        throw new Error('Encrypted code must be a non-empty string');
      }

      const result = await conn.run(
        `INSERT INTO gift_cards (strategy_id, run_id, wallet_address, denomination_usd, code_encrypted, status)
         VALUES (?, ?, ?, ?, ?, 'PURCHASED')`,
        strategyId,
        runId,
        walletAddress,
        denominationUsd,
        codeEncrypted,
      );

      // Retrieve via lastInsertRowid — portable across SQLite/PostgreSQL
      const row = await conn.get<GiftCardRow>(
        'SELECT * FROM gift_cards WHERE id = ?',
        result.lastInsertRowid,
      );

      if (!row) {
        throw new Error('Failed to retrieve gift card after purchase insert');
      }

      logger.debug(
        { giftCardId: row.id, strategyId, runId, walletAddress, denominationUsd },
        'Gift card purchased',
      );

      return toGiftCard(row);
    },

    async getByWallet(walletAddress: string): Promise<GiftCard[]> {
      const rows = await conn.all<GiftCardRow>(
        'SELECT * FROM gift_cards WHERE wallet_address = ? ORDER BY id ASC',
        walletAddress,
      );
      return rows.map(toGiftCard);
    },

    async getByRun(runId: number): Promise<GiftCard[]> {
      const rows = await conn.all<GiftCardRow>(
        'SELECT * FROM gift_cards WHERE run_id = ? ORDER BY id ASC',
        runId,
      );
      return rows.map(toGiftCard);
    },

    async getByStrategy(strategyId: number): Promise<GiftCard[]> {
      const rows = await conn.all<GiftCardRow>(
        'SELECT * FROM gift_cards WHERE strategy_id = ? ORDER BY id ASC',
        strategyId,
      );
      return rows.map(toGiftCard);
    },

    async updateStatus(giftCardId: number, newStatus: GiftCardStatus): Promise<GiftCard> {
      const existing = await conn.get<GiftCardRow>(
        'SELECT * FROM gift_cards WHERE id = ?',
        giftCardId,
      );

      if (!existing) {
        throw new Error(`Gift card not found: id=${giftCardId}`);
      }

      const allowed = VALID_TRANSITIONS[existing.status];
      if (!allowed || !allowed.includes(newStatus)) {
        throw new Error(
          `Invalid status transition: ${existing.status} → ${newStatus} (allowed: ${allowed?.join(', ') || 'none'})`,
        );
      }

      // Set timestamps based on target status
      if (newStatus === 'DELIVERED') {
        await conn.run(
          "UPDATE gift_cards SET status = ?, delivered_at = datetime('now') WHERE id = ?",
          newStatus,
          giftCardId,
        );
      } else if (newStatus === 'REDEEMED') {
        await conn.run(
          "UPDATE gift_cards SET status = ?, redeemed_at = datetime('now') WHERE id = ?",
          newStatus,
          giftCardId,
        );
      }

      const updated = await conn.get<GiftCardRow>(
        'SELECT * FROM gift_cards WHERE id = ?',
        giftCardId,
      );

      if (!updated) {
        throw new Error(`Failed to retrieve gift card after status update: id=${giftCardId}`);
      }

      logger.debug(
        { giftCardId, from: existing.status, to: newStatus },
        'Gift card status updated',
      );

      return toGiftCard(updated);
    },
  };
}
