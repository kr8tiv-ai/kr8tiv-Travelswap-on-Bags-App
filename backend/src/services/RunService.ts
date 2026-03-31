// ─── RunService ────────────────────────────────────────────────
// Lifecycle management for pipeline runs. Factory function pattern (K004).

import type { DatabaseConnection } from './Database.js';
import type { TravelRun, RunState } from '../types/index.js';
import { logger } from '../logger.js';

// ─── DB Row Shape ──────────────────────────────────────────────

interface RunRow {
  id: number;
  strategy_id: number;
  phase: RunState;
  status: 'RUNNING' | 'COMPLETE' | 'FAILED';
  claimed_sol: number | null;
  swapped_usdc: number | null;
  allocated_usd: number | null;
  credits_issued: number;
  gift_cards_purchased: number;
  claim_tx: string | null;
  swap_tx: string | null;
  error: string | null;
  started_at: string;
  completed_at: string | null;
}

// ─── Checkpoint Data ───────────────────────────────────────────

export interface PhaseCheckpointData {
  claimedSol?: number;
  swappedUsdc?: number;
  allocatedUsd?: number;
  creditsIssued?: number;
  giftCardsPurchased?: number;
  claimTx?: string;
  swapTx?: string;
}

// ─── Service Interface ─────────────────────────────────────────

export interface AggregateStats {
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  totalClaimedSol: number;
  totalSwappedUsdc: number;
  totalAllocatedUsd: number;
  totalCreditsIssued: number;
  totalGiftCardsPurchased: number;
}

export interface RunService {
  create(strategyId: number): Promise<TravelRun>;
  getById(id: number): Promise<TravelRun | undefined>;
  getAll(): Promise<TravelRun[]>;
  getByStrategyId(strategyId: number): Promise<TravelRun[]>;
  updatePhase(id: number, phase: RunState, data?: PhaseCheckpointData): Promise<TravelRun>;
  markFailed(id: number, error: string): Promise<TravelRun>;
  markComplete(id: number): Promise<TravelRun>;
  getLatest(strategyId: number, limit?: number): Promise<TravelRun[]>;
  getAggregateStats(): Promise<AggregateStats>;
}

// ─── Factory ───────────────────────────────────────────────────

export function createRunService(conn: DatabaseConnection): RunService {
  /** Convert a DB row to the TravelRun domain type. */
  function toRun(row: RunRow): TravelRun {
    return {
      runId: String(row.id),
      strategyId: String(row.strategy_id),
      phase: row.phase,
      status: row.status,
      claimedSol: row.claimed_sol,
      swappedUsdc: row.swapped_usdc,
      allocatedUsd: row.allocated_usd,
      creditsIssued: row.credits_issued,
      giftCardsPurchased: row.gift_cards_purchased,
      errorMessage: row.error,
      claimTx: row.claim_tx,
      swapTx: row.swap_tx,
      startedAt: row.started_at,
      completedAt: row.completed_at,
    };
  }

  return {
    async create(strategyId: number): Promise<TravelRun> {
      const result = await conn.run(
        `INSERT INTO runs (strategy_id, phase, status) VALUES (?, ?, ?)`,
        strategyId,
        'PENDING',
        'RUNNING',
      );

      const row = await conn.get<RunRow>(
        'SELECT * FROM runs WHERE id = ?',
        result.lastInsertRowid,
      );

      if (!row) {
        throw new Error(`Failed to retrieve run after insert (id=${result.lastInsertRowid})`);
      }

      logger.debug({ runId: row.id, strategyId }, 'Run created');
      return toRun(row);
    },

    async getById(id: number): Promise<TravelRun | undefined> {
      const row = await conn.get<RunRow>(
        'SELECT * FROM runs WHERE id = ?',
        id,
      );
      return row ? toRun(row) : undefined;
    },

    async getByStrategyId(strategyId: number): Promise<TravelRun[]> {
      const rows = await conn.all<RunRow>(
        'SELECT * FROM runs WHERE strategy_id = ? ORDER BY started_at DESC, id DESC',
        strategyId,
      );
      return rows.map(toRun);
    },

    async updatePhase(id: number, phase: RunState, data?: PhaseCheckpointData): Promise<TravelRun> {
      // Build dynamic SET clauses for checkpoint data
      const setClauses: string[] = ['phase = ?'];
      const values: unknown[] = [phase];

      if (data) {
        if (data.claimedSol !== undefined) {
          setClauses.push('claimed_sol = ?');
          values.push(data.claimedSol);
        }
        if (data.swappedUsdc !== undefined) {
          setClauses.push('swapped_usdc = ?');
          values.push(data.swappedUsdc);
        }
        if (data.allocatedUsd !== undefined) {
          setClauses.push('allocated_usd = ?');
          values.push(data.allocatedUsd);
        }
        if (data.claimTx !== undefined) {
          setClauses.push('claim_tx = ?');
          values.push(data.claimTx);
        }
        if (data.swapTx !== undefined) {
          setClauses.push('swap_tx = ?');
          values.push(data.swapTx);
        }
        if (data.creditsIssued !== undefined) {
          setClauses.push('credits_issued = ?');
          values.push(data.creditsIssued);
        }
        if (data.giftCardsPurchased !== undefined) {
          setClauses.push('gift_cards_purchased = ?');
          values.push(data.giftCardsPurchased);
        }
      }

      values.push(id);
      await conn.run(
        `UPDATE runs SET ${setClauses.join(', ')} WHERE id = ?`,
        ...values,
      );

      const row = await conn.get<RunRow>(
        'SELECT * FROM runs WHERE id = ?',
        id,
      );

      if (!row) {
        throw new Error(`Run not found after phase update (id=${id})`);
      }

      logger.debug({ runId: id, phase }, 'Run phase updated');
      return toRun(row);
    },

    async markFailed(id: number, error: string): Promise<TravelRun> {
      await conn.run(
        `UPDATE runs SET status = 'FAILED', error = ?, completed_at = datetime('now') WHERE id = ?`,
        error,
        id,
      );

      const row = await conn.get<RunRow>(
        'SELECT * FROM runs WHERE id = ?',
        id,
      );

      if (!row) {
        throw new Error(`Run not found after markFailed (id=${id})`);
      }

      logger.debug({ runId: id, error }, 'Run marked failed');
      return toRun(row);
    },

    async markComplete(id: number): Promise<TravelRun> {
      await conn.run(
        `UPDATE runs SET status = 'COMPLETE', phase = 'COMPLETE', completed_at = datetime('now') WHERE id = ?`,
        id,
      );

      const row = await conn.get<RunRow>(
        'SELECT * FROM runs WHERE id = ?',
        id,
      );

      if (!row) {
        throw new Error(`Run not found after markComplete (id=${id})`);
      }

      logger.debug({ runId: id }, 'Run marked complete');
      return toRun(row);
    },

    async getLatest(strategyId: number, limit = 10): Promise<TravelRun[]> {
      const rows = await conn.all<RunRow>(
        'SELECT * FROM runs WHERE strategy_id = ? ORDER BY started_at DESC, id DESC LIMIT ?',
        strategyId,
        limit,
      );
      return rows.map(toRun);
    },

    async getAll(): Promise<TravelRun[]> {
      const rows = await conn.all<RunRow>(
        'SELECT * FROM runs ORDER BY started_at DESC, id DESC',
      );
      return rows.map(toRun);
    },

    async getAggregateStats(): Promise<AggregateStats> {
      const row = await conn.get<{
        total_runs: number;
        completed_runs: number;
        failed_runs: number;
        total_claimed_sol: number | null;
        total_swapped_usdc: number | null;
        total_allocated_usd: number | null;
        total_credits_issued: number | null;
        total_gift_cards_purchased: number | null;
      }>(
        `SELECT
          COUNT(*) as total_runs,
          SUM(CASE WHEN status = 'COMPLETE' THEN 1 ELSE 0 END) as completed_runs,
          SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed_runs,
          COALESCE(SUM(claimed_sol), 0) as total_claimed_sol,
          COALESCE(SUM(swapped_usdc), 0) as total_swapped_usdc,
          COALESCE(SUM(allocated_usd), 0) as total_allocated_usd,
          COALESCE(SUM(credits_issued), 0) as total_credits_issued,
          COALESCE(SUM(gift_cards_purchased), 0) as total_gift_cards_purchased
        FROM runs`,
      );

      if (!row) {
        return {
          totalRuns: 0,
          completedRuns: 0,
          failedRuns: 0,
          totalClaimedSol: 0,
          totalSwappedUsdc: 0,
          totalAllocatedUsd: 0,
          totalCreditsIssued: 0,
          totalGiftCardsPurchased: 0,
        };
      }

      return {
        totalRuns: row.total_runs,
        completedRuns: row.completed_runs,
        failedRuns: row.failed_runs,
        totalClaimedSol: row.total_claimed_sol ?? 0,
        totalSwappedUsdc: row.total_swapped_usdc ?? 0,
        totalAllocatedUsd: row.total_allocated_usd ?? 0,
        totalCreditsIssued: row.total_credits_issued ?? 0,
        totalGiftCardsPurchased: row.total_gift_cards_purchased ?? 0,
      };
    },
  };
}
