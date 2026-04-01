// ─── TravelPassService ─────────────────────────────────────────
// CRUD layer for the travel_passes table. Follows the factory
// function pattern (K004). Tracks NFT cNFT mint status for gift
// card purchases — a TravelPass starts PENDING and transitions
// to MINTED or FAILED.

import type { DatabaseConnection } from './Database.js';
import type { TravelPass, TravelPassStatus } from '../types/index.js';
import { logger } from '../logger.js';

// ─── DB Row Shape ──────────────────────────────────────────────

interface TravelPassRow {
  id: number;
  gift_card_id: number;
  strategy_id: number;
  wallet_address: string;
  denomination_usd: number;
  token_mint: string;
  mint_signature: string | null;
  metadata_uri: string | null;
  status: TravelPassStatus;
  error_message: string | null;
  created_at: string;
  minted_at: string | null;
}

// ─── Service Interface ─────────────────────────────────────────

export interface TravelPassService {
  /** Create a new PENDING travel pass record. */
  create(params: {
    giftCardId: number;
    strategyId: number;
    walletAddress: string;
    denominationUsd: number;
    tokenMint: string;
  }): Promise<TravelPass>;

  /** Look up a travel pass by ID. */
  getById(id: number): Promise<TravelPass | undefined>;

  /** Look up a travel pass by gift card ID. */
  getByGiftCardId(giftCardId: number): Promise<TravelPass | undefined>;

  /** Look up travel passes for multiple gift card IDs in one query. */
  getByGiftCardIds(ids: number[]): Promise<TravelPass[]>;

  /** Get all travel passes for a wallet address. */
  getByWallet(walletAddress: string): Promise<TravelPass[]>;

  /** Mark a travel pass as MINTED with signature and metadata URI. */
  updateMinted(id: number, mintSignature: string, metadataUri: string): Promise<TravelPass>;

  /** Mark a travel pass as FAILED with an error message. */
  updateFailed(id: number, errorMessage: string): Promise<TravelPass>;
}

// ─── Factory ───────────────────────────────────────────────────

export function createTravelPassService(conn: DatabaseConnection): TravelPassService {
  function toTravelPass(row: TravelPassRow): TravelPass {
    return {
      id: String(row.id),
      giftCardId: String(row.gift_card_id),
      strategyId: String(row.strategy_id),
      walletAddress: row.wallet_address,
      denominationUsd: row.denomination_usd,
      tokenMint: row.token_mint,
      mintSignature: row.mint_signature,
      metadataUri: row.metadata_uri,
      status: row.status,
      errorMessage: row.error_message,
      createdAt: row.created_at,
      mintedAt: row.minted_at,
    };
  }

  return {
    async create(params): Promise<TravelPass> {
      const { giftCardId, strategyId, walletAddress, denominationUsd, tokenMint } = params;

      if (!walletAddress || walletAddress.trim().length === 0) {
        throw new Error('Wallet address must be a non-empty string');
      }
      if (!Number.isFinite(denominationUsd) || denominationUsd <= 0) {
        throw new Error('Denomination must be a positive number');
      }
      if (!tokenMint || tokenMint.trim().length === 0) {
        throw new Error('Token mint must be a non-empty string');
      }
      if (!Number.isFinite(giftCardId) || giftCardId <= 0) {
        throw new Error('Gift card ID must be a positive number');
      }

      const result = await conn.run(
        `INSERT INTO travel_passes (gift_card_id, strategy_id, wallet_address, denomination_usd, token_mint, status)
         VALUES (?, ?, ?, ?, ?, 'PENDING')`,
        giftCardId,
        strategyId,
        walletAddress.trim(),
        denominationUsd,
        tokenMint.trim(),
      );

      const id = Number(result.lastInsertRowid);
      logger.info({ id, giftCardId, walletAddress }, 'travel_pass created');

      const row = await conn.get<TravelPassRow>('SELECT * FROM travel_passes WHERE id = ?', id);
      if (!row) throw new Error(`Failed to read back travel pass ${id}`);
      return toTravelPass(row);
    },

    async getById(id: number): Promise<TravelPass | undefined> {
      const row = await conn.get<TravelPassRow>('SELECT * FROM travel_passes WHERE id = ?', id);
      return row ? toTravelPass(row) : undefined;
    },

    async getByGiftCardId(giftCardId: number): Promise<TravelPass | undefined> {
      const row = await conn.get<TravelPassRow>(
        'SELECT * FROM travel_passes WHERE gift_card_id = ?',
        giftCardId,
      );
      return row ? toTravelPass(row) : undefined;
    },

    async getByGiftCardIds(ids: number[]): Promise<TravelPass[]> {
      if (ids.length === 0) return [];
      const placeholders = ids.map(() => '?').join(', ');
      const rows = await conn.all<TravelPassRow>(
        `SELECT * FROM travel_passes WHERE gift_card_id IN (${placeholders})`,
        ...ids,
      );
      return rows.map(toTravelPass);
    },

    async getByWallet(walletAddress: string): Promise<TravelPass[]> {
      const rows = await conn.all<TravelPassRow>(
        'SELECT * FROM travel_passes WHERE wallet_address = ? ORDER BY created_at DESC',
        walletAddress,
      );
      return rows.map(toTravelPass);
    },

    async updateMinted(id: number, mintSignature: string, metadataUri: string): Promise<TravelPass> {
      const existing = await conn.get<TravelPassRow>('SELECT * FROM travel_passes WHERE id = ?', id);
      if (!existing) {
        throw new Error(`Travel pass ${id} not found`);
      }
      if (existing.status !== 'PENDING') {
        throw new Error(
          `Cannot transition travel pass ${id} from ${existing.status} to MINTED — only PENDING passes can be minted`,
        );
      }

      await conn.run(
        `UPDATE travel_passes SET status = 'MINTED', mint_signature = ?, metadata_uri = ?, minted_at = datetime('now') WHERE id = ?`,
        mintSignature,
        metadataUri,
        id,
      );

      logger.info({ id, mintSignature }, 'travel_pass minted');

      const row = await conn.get<TravelPassRow>('SELECT * FROM travel_passes WHERE id = ?', id);
      if (!row) throw new Error(`Failed to read back travel pass ${id}`);
      return toTravelPass(row);
    },

    async updateFailed(id: number, errorMessage: string): Promise<TravelPass> {
      const existing = await conn.get<TravelPassRow>('SELECT * FROM travel_passes WHERE id = ?', id);
      if (!existing) {
        throw new Error(`Travel pass ${id} not found`);
      }
      if (existing.status !== 'PENDING') {
        throw new Error(
          `Cannot transition travel pass ${id} from ${existing.status} to FAILED — only PENDING passes can fail`,
        );
      }

      await conn.run(
        `UPDATE travel_passes SET status = 'FAILED', error_message = ? WHERE id = ?`,
        errorMessage,
        id,
      );

      logger.warn({ id, errorMessage }, 'travel_pass failed');

      const row = await conn.get<TravelPassRow>('SELECT * FROM travel_passes WHERE id = ?', id);
      if (!row) throw new Error(`Failed to read back travel pass ${id}`);
      return toTravelPass(row);
    },
  };
}
