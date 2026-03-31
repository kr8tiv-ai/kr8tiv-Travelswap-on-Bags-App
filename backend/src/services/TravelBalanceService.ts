// ─── TravelBalanceService ──────────────────────────────────────
// Per-user travel balance accounting layer. USDC from the
// allocation pipeline is credited here; S04's gift card pipeline
// deducts from here. Key invariant: allocate() upserts —
// incrementing the balance, never replacing it.

import type { DatabaseConnection } from './Database.js';
import type { TravelBalance } from '../types/index.js';
import { logger } from '../logger.js';

// ─── DB Row Shape ──────────────────────────────────────────────

interface TravelBalanceRow {
  id: number;
  strategy_id: number;
  wallet_address: string;
  balance_usd: number;
  total_earned: number;
  total_spent: number;
  created_at: string;
  updated_at: string;
}

// ─── Service Interface ─────────────────────────────────────────

export interface TravelBalanceService {
  /** Credit USDC to a wallet's travel balance. Upserts — creates if new, increments if existing. */
  allocate(strategyId: number, walletAddress: string, amountUsd: number): Promise<TravelBalance>;

  /** Deduct USDC from a wallet's travel balance. Throws if insufficient balance. */
  deduct(strategyId: number, walletAddress: string, amountUsd: number): Promise<TravelBalance>;

  /** Look up a single balance by strategy + wallet. */
  getByStrategyAndWallet(strategyId: number, walletAddress: string): Promise<TravelBalance | undefined>;

  /** All balances for a strategy. */
  getByStrategy(strategyId: number): Promise<TravelBalance[]>;

  /** Sum of all balance_usd for a strategy. Returns 0 if no balances exist. */
  getTotal(strategyId: number): Promise<number>;
}

// ─── Factory ───────────────────────────────────────────────────

export function createTravelBalanceService(conn: DatabaseConnection): TravelBalanceService {
  /** Convert a DB row to the TravelBalance domain type. */
  function toBalance(row: TravelBalanceRow): TravelBalance {
    return {
      balanceId: String(row.id),
      strategyId: String(row.strategy_id),
      walletAddress: row.wallet_address,
      balanceUsd: row.balance_usd,
      totalEarned: row.total_earned,
      totalSpent: row.total_spent,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /** Validate allocation/deduction amount — must be a positive finite number. */
  function validateAmount(amount: number, operation: string): void {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error(
        `${operation} amount must be a positive number, got ${amount}`,
      );
    }
  }

  /** Validate wallet address — must be a non-empty string. */
  function validateWallet(walletAddress: string): void {
    if (!walletAddress || walletAddress.trim().length === 0) {
      throw new Error('Wallet address must be a non-empty string');
    }
  }

  return {
    async allocate(strategyId: number, walletAddress: string, amountUsd: number): Promise<TravelBalance> {
      validateAmount(amountUsd, 'Allocation');
      validateWallet(walletAddress);

      await conn.run(
        `INSERT INTO travel_balances (strategy_id, wallet_address, balance_usd, total_earned)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(strategy_id, wallet_address) DO UPDATE SET
           balance_usd = balance_usd + ?,
           total_earned = total_earned + ?,
           updated_at = datetime('now')`,
        strategyId,
        walletAddress,
        amountUsd,
        amountUsd,
        amountUsd,
        amountUsd,
      );

      const row = await conn.get<TravelBalanceRow>(
        'SELECT * FROM travel_balances WHERE strategy_id = ? AND wallet_address = ?',
        strategyId,
        walletAddress,
      );

      if (!row) {
        throw new Error(
          `Failed to retrieve travel balance after allocate (strategy=${strategyId}, wallet=${walletAddress})`,
        );
      }

      logger.debug(
        { strategyId, walletAddress, amountUsd, newBalance: row.balance_usd },
        'Travel balance allocated',
      );

      return toBalance(row);
    },

    async deduct(strategyId: number, walletAddress: string, amountUsd: number): Promise<TravelBalance> {
      validateAmount(amountUsd, 'Deduction');
      validateWallet(walletAddress);

      // Check current balance before deducting
      const current = await conn.get<TravelBalanceRow>(
        'SELECT * FROM travel_balances WHERE strategy_id = ? AND wallet_address = ?',
        strategyId,
        walletAddress,
      );

      if (!current) {
        throw new Error(
          `No travel balance found for strategy=${strategyId}, wallet=${walletAddress}`,
        );
      }

      if (current.balance_usd < amountUsd) {
        throw new Error(
          `Insufficient balance: has $${current.balance_usd.toFixed(2)}, tried to deduct $${amountUsd.toFixed(2)}`,
        );
      }

      await conn.run(
        `UPDATE travel_balances
         SET balance_usd = balance_usd - ?,
             total_spent = total_spent + ?,
             updated_at = datetime('now')
         WHERE strategy_id = ? AND wallet_address = ?`,
        amountUsd,
        amountUsd,
        strategyId,
        walletAddress,
      );

      const updated = await conn.get<TravelBalanceRow>(
        'SELECT * FROM travel_balances WHERE strategy_id = ? AND wallet_address = ?',
        strategyId,
        walletAddress,
      );

      if (!updated) {
        throw new Error(
          `Failed to retrieve travel balance after deduct (strategy=${strategyId}, wallet=${walletAddress})`,
        );
      }

      logger.debug(
        { strategyId, walletAddress, amountUsd, newBalance: updated.balance_usd },
        'Travel balance deducted',
      );

      return toBalance(updated);
    },

    async getByStrategyAndWallet(strategyId: number, walletAddress: string): Promise<TravelBalance | undefined> {
      const row = await conn.get<TravelBalanceRow>(
        'SELECT * FROM travel_balances WHERE strategy_id = ? AND wallet_address = ?',
        strategyId,
        walletAddress,
      );
      return row ? toBalance(row) : undefined;
    },

    async getByStrategy(strategyId: number): Promise<TravelBalance[]> {
      const rows = await conn.all<TravelBalanceRow>(
        'SELECT * FROM travel_balances WHERE strategy_id = ? ORDER BY id ASC',
        strategyId,
      );
      return rows.map(toBalance);
    },

    async getTotal(strategyId: number): Promise<number> {
      const row = await conn.get<{ total: number | null }>(
        'SELECT SUM(balance_usd) as total FROM travel_balances WHERE strategy_id = ?',
        strategyId,
      );
      return row?.total ?? 0;
    },
  };
}
