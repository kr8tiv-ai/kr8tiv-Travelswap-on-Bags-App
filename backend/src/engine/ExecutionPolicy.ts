// ─── ExecutionPolicy ───────────────────────────────────────────
// Safety controls for FlightBrain pipeline execution.
// Enforces kill switch, dry-run mode, daily limits, and balance caps.

import type { Config } from '../config/index.js';
import type { DatabaseConnection } from '../services/Database.js';
import type { RunState } from '../types/index.js';
import { logger } from '../logger.js';

// ─── Types ─────────────────────────────────────────────────────

export interface PolicyResult {
  readonly allowed: boolean;
  readonly reason?: string;
}

export interface ExecutionPolicy {
  isKillSwitchActive(): boolean;
  isDryRun(): boolean;
  canStartRun(strategyId: number): PolicyResult;
  canExecutePhase(phase: RunState): PolicyResult;
  canPurchaseGiftCard(strategyId: number, denominationUsd: number): PolicyResult;
  canAllocateBalance(walletAddress: string, additionalAmount: number): PolicyResult;
}

// ─── Helpers ───────────────────────────────────────────────────

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

// ─── Factory ───────────────────────────────────────────────────

export function createExecutionPolicy(
  config: Config,
  conn: DatabaseConnection,
): ExecutionPolicy {
  return {
    isKillSwitchActive(): boolean {
      return config.executionKillSwitch;
    },

    isDryRun(): boolean {
      return config.dryRun;
    },

    canStartRun(strategyId: number): PolicyResult {
      // Kill switch blocks everything
      if (config.executionKillSwitch) {
        logger.warn({ strategyId }, 'Kill switch active — run blocked');
        return { allowed: false, reason: 'Kill switch is active' };
      }

      // Check daily run count for this strategy
      const today = todayUtc();
      const row = conn.get<{ count: number }>(
        `SELECT COUNT(*) as count FROM runs
         WHERE strategy_id = ?
         AND started_at >= ?`,
        strategyId,
        today,
      );

      const dailyCount = row?.count ?? 0;
      if (dailyCount >= config.maxDailyRuns) {
        logger.warn(
          { strategyId, dailyCount, maxDailyRuns: config.maxDailyRuns },
          'Daily run limit reached',
        );
        return {
          allowed: false,
          reason: `Daily run limit reached (${dailyCount}/${config.maxDailyRuns})`,
        };
      }

      return { allowed: true };
    },

    canExecutePhase(phase: RunState): PolicyResult {
      if (config.executionKillSwitch) {
        return { allowed: false, reason: 'Kill switch is active' };
      }
      return { allowed: true };
    },

    canPurchaseGiftCard(strategyId: number, denominationUsd: number): PolicyResult {
      if (config.executionKillSwitch) {
        return { allowed: false, reason: 'Kill switch is active' };
      }

      // Check denomination against max
      if (denominationUsd > config.giftCardMaxDenomination) {
        return {
          allowed: false,
          reason: `Denomination $${denominationUsd} exceeds max $${config.giftCardMaxDenomination}`,
        };
      }

      // Check daily gift card count for this strategy
      const today = todayUtc();
      const row = conn.get<{ count: number }>(
        `SELECT COUNT(*) as count FROM gift_cards
         WHERE strategy_id = ?
         AND created_at >= ?`,
        strategyId,
        today,
      );

      const dailyCount = row?.count ?? 0;
      if (dailyCount >= config.giftCardDailyLimit) {
        return {
          allowed: false,
          reason: `Daily gift card limit reached (${dailyCount}/${config.giftCardDailyLimit})`,
        };
      }

      return { allowed: true };
    },

    canAllocateBalance(walletAddress: string, additionalAmount: number): PolicyResult {
      if (config.executionKillSwitch) {
        return { allowed: false, reason: 'Kill switch is active' };
      }

      // Sum current balance across all strategies for this wallet
      const row = conn.get<{ total: number | null }>(
        `SELECT SUM(balance_usd) as total FROM travel_balances
         WHERE wallet_address = ?`,
        walletAddress,
      );

      const currentBalance = row?.total ?? 0;
      const projected = currentBalance + additionalAmount;

      if (projected > config.balanceMaxUsd) {
        return {
          allowed: false,
          reason: `Projected balance $${projected.toFixed(2)} exceeds max $${config.balanceMaxUsd}`,
        };
      }

      return { allowed: true };
    },
  };
}
