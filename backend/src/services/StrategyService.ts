// ─── StrategyService ───────────────────────────────────────────
// CRUD for the strategies table. Factory function pattern (K004).

import type { DatabaseConnection } from './Database.js';
import type { TravelStrategy, FeeSourceType, DistributionMode, CreditMode } from '../types/index.js';
import { logger } from '../logger.js';

// ─── DB Row Shape ──────────────────────────────────────────────

interface StrategyRow {
  id: number;
  name: string;
  owner_wallet: string;
  token_mint: string;
  fee_source: FeeSourceType;
  threshold_sol: number;
  slippage_bps: number;
  distribution_mode: DistributionMode;
  distribution_top_n: number;
  credit_mode: CreditMode;
  gift_card_threshold_usd: number;
  cron_expression: string;
  enabled: number; // SQLite stores booleans as 0/1
  created_at: string;
  updated_at: string;
}

// ─── Create Params ─────────────────────────────────────────────

export interface CreateStrategyParams {
  name: string;
  ownerWallet: string;
  tokenMint: string;
  feeSource?: FeeSourceType;
  thresholdSol?: number;
  slippageBps?: number;
  distributionMode?: DistributionMode;
  distributionTopN?: number;
  creditMode?: CreditMode;
  giftCardThresholdUsd?: number;
  cronExpression?: string;
  enabled?: boolean;
}

// ─── Update Fields ─────────────────────────────────────────────

export interface UpdateStrategyFields {
  name?: string;
  ownerWallet?: string;
  tokenMint?: string;
  feeSource?: FeeSourceType;
  thresholdSol?: number;
  slippageBps?: number;
  distributionMode?: DistributionMode;
  distributionTopN?: number;
  creditMode?: CreditMode;
  giftCardThresholdUsd?: number;
  cronExpression?: string;
  enabled?: boolean;
}

// ─── Service Interface ────────────────────────────────────────

export interface StrategyService {
  create(params: CreateStrategyParams): Promise<TravelStrategy>;
  getById(id: number): Promise<TravelStrategy | undefined>;
  getAll(): Promise<TravelStrategy[]>;
  getActive(): Promise<TravelStrategy[]>;
  update(id: number, fields: UpdateStrategyFields): Promise<TravelStrategy>;
}

// ─── Column mapping (camelCase → snake_case) ───────────────────

const FIELD_TO_COLUMN: Record<string, string> = {
  name: 'name',
  ownerWallet: 'owner_wallet',
  tokenMint: 'token_mint',
  feeSource: 'fee_source',
  thresholdSol: 'threshold_sol',
  slippageBps: 'slippage_bps',
  distributionMode: 'distribution_mode',
  distributionTopN: 'distribution_top_n',
  creditMode: 'credit_mode',
  giftCardThresholdUsd: 'gift_card_threshold_usd',
  cronExpression: 'cron_expression',
  enabled: 'enabled',
};

// ─── Factory ───────────────────────────────────────────────────

export function createStrategyService(conn: DatabaseConnection): StrategyService {
  /** Convert a DB row to the TravelStrategy domain type. */
  function toStrategy(row: StrategyRow): TravelStrategy {
    return {
      strategyId: String(row.id),
      name: row.name,
      ownerWallet: row.owner_wallet,
      tokenMint: row.token_mint,
      feeSource: row.fee_source,
      thresholdSol: row.threshold_sol,
      slippageBps: row.slippage_bps,
      distributionMode: row.distribution_mode,
      distributionTopN: row.distribution_top_n,
      creditMode: row.credit_mode,
      giftCardThresholdUsd: row.gift_card_threshold_usd,
      cronExpression: row.cron_expression,
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastRunId: null, // Derived field — populated by query join in S05
    };
  }

  return {
    async create(params: CreateStrategyParams): Promise<TravelStrategy> {
      const result = await conn.run(
        `INSERT INTO strategies (name, owner_wallet, token_mint, fee_source, threshold_sol,
          slippage_bps, distribution_mode, distribution_top_n, credit_mode,
          gift_card_threshold_usd, cron_expression, enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params.name,
        params.ownerWallet,
        params.tokenMint,
        params.feeSource ?? 'CLAIMABLE_POSITIONS',
        params.thresholdSol ?? 5.0,
        params.slippageBps ?? 50,
        params.distributionMode ?? 'EQUAL_SPLIT',
        params.distributionTopN ?? 100,
        params.creditMode ?? 'GIFT_CARD',
        params.giftCardThresholdUsd ?? 50,
        params.cronExpression ?? '0 */6 * * *',
        params.enabled === false ? 0 : 1,
      );

      const row = await conn.get<StrategyRow>(
        'SELECT * FROM strategies WHERE id = ?',
        result.lastInsertRowid,
      );

      if (!row) {
        throw new Error(`Failed to retrieve strategy after insert (id=${result.lastInsertRowid})`);
      }

      logger.debug({ strategyId: row.id }, 'Strategy created');
      return toStrategy(row);
    },

    async getById(id: number): Promise<TravelStrategy | undefined> {
      const row = await conn.get<StrategyRow>(
        'SELECT * FROM strategies WHERE id = ?',
        id,
      );
      return row ? toStrategy(row) : undefined;
    },

    async getAll(): Promise<TravelStrategy[]> {
      const rows = await conn.all<StrategyRow>('SELECT * FROM strategies ORDER BY id ASC');
      return rows.map(toStrategy);
    },

    async getActive(): Promise<TravelStrategy[]> {
      const rows = await conn.all<StrategyRow>(
        'SELECT * FROM strategies WHERE enabled = 1 ORDER BY id ASC',
      );
      return rows.map(toStrategy);
    },

    async update(id: number, fields: UpdateStrategyFields): Promise<TravelStrategy> {
      const setClauses: string[] = [];
      const values: unknown[] = [];

      for (const [field, value] of Object.entries(fields)) {
        const column = FIELD_TO_COLUMN[field];
        if (!column) continue;

        setClauses.push(`${column} = ?`);
        // Convert boolean to integer for SQLite
        values.push(field === 'enabled' ? (value ? 1 : 0) : value);
      }

      if (setClauses.length === 0) {
        const existing = await this.getById(id);
        if (!existing) {
          throw new Error(`Strategy not found (id=${id})`);
        }
        return existing;
      }

      setClauses.push("updated_at = datetime('now')");
      values.push(id);

      await conn.run(
        `UPDATE strategies SET ${setClauses.join(', ')} WHERE id = ?`,
        ...values,
      );

      const row = await conn.get<StrategyRow>(
        'SELECT * FROM strategies WHERE id = ?',
        id,
      );

      if (!row) {
        throw new Error(`Strategy not found after update (id=${id})`);
      }

      logger.debug({ strategyId: id }, 'Strategy updated');
      return toStrategy(row);
    },
  };
}
