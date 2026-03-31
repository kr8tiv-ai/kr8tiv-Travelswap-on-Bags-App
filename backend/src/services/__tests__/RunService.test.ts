import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database, type DatabaseConnection } from '../Database.js';
import { createRunService, type RunService } from '../RunService.js';

describe('RunService', () => {
  let db: Database;
  let conn: DatabaseConnection;
  let runs: RunService;
  let strategyId: number;

  beforeEach(async () => {
    db = new Database(':memory:');
    conn = await db.connect();
    await db.runMigrations();
    runs = createRunService(conn);

    // Insert a strategy for FK constraints (migration 006 adds the new columns with defaults)
    await conn.run(
      "INSERT INTO strategies (token_mint, name, owner_wallet) VALUES (?, ?, ?)",
      'So11111111111111111111111111111111111111112',
      'Test Strategy',
      'wallet123',
    );
    strategyId = 1;
  });

  afterEach(() => {
    db.close();
  });

  describe('create()', () => {
    it('creates a run with initial state PENDING/RUNNING', async () => {
      const run = await runs.create(strategyId);

      expect(run.runId).toBe('1');
      expect(run.strategyId).toBe(String(strategyId));
      expect(run.phase).toBe('PENDING');
      expect(run.status).toBe('RUNNING');
      expect(run.claimedSol).toBe(0);
      expect(run.swappedUsdc).toBe(0);
      expect(run.allocatedUsd).toBe(0);
      expect(run.creditsIssued).toBe(0);
      expect(run.giftCardsPurchased).toBe(0);
      expect(run.errorMessage).toBeNull();
      expect(run.claimTx).toBeNull();
      expect(run.swapTx).toBeNull();
      expect(run.startedAt).toBeTruthy();
      expect(run.completedAt).toBeNull();
    });

    it('converts integer IDs to string domain types', async () => {
      const run = await runs.create(strategyId);
      expect(typeof run.runId).toBe('string');
      expect(typeof run.strategyId).toBe('string');
    });
  });

  describe('getById()', () => {
    it('returns the correct run', async () => {
      const created = await runs.create(strategyId);
      const found = await runs.getById(Number(created.runId));

      expect(found).toBeDefined();
      expect(found!.runId).toBe(created.runId);
      expect(found!.phase).toBe('PENDING');
    });

    it('returns undefined for non-existent ID', async () => {
      expect(await runs.getById(999)).toBeUndefined();
    });
  });

  describe('updatePhase()', () => {
    it('changes phase and records checkpoint data', async () => {
      const run = await runs.create(strategyId);
      const id = Number(run.runId);

      const updated = await runs.updatePhase(id, 'CLAIMING', {
        claimedSol: 5.5,
        claimTx: 'tx_claim_abc123',
      });

      expect(updated.phase).toBe('CLAIMING');
      expect(updated.claimedSol).toBe(5.5);
      expect(updated.claimTx).toBe('tx_claim_abc123');
    });

    it('updates phase without checkpoint data', async () => {
      const run = await runs.create(strategyId);
      const id = Number(run.runId);

      const updated = await runs.updatePhase(id, 'SWAPPING');
      expect(updated.phase).toBe('SWAPPING');
    });

    it('preserves checkpoint data across phase transitions', async () => {
      const run = await runs.create(strategyId);
      const id = Number(run.runId);

      // Phase 1: claiming
      await runs.updatePhase(id, 'CLAIMING', { claimedSol: 3.0, claimTx: 'tx_claim' });

      // Phase 2: swapping — claimedSol from previous phase should persist
      const afterSwap = await runs.updatePhase(id, 'SWAPPING', {
        swappedUsdc: 450.0,
        swapTx: 'tx_swap',
      });

      expect(afterSwap.phase).toBe('SWAPPING');
      expect(afterSwap.claimedSol).toBe(3.0);     // persisted from CLAIMING
      expect(afterSwap.claimTx).toBe('tx_claim');  // persisted from CLAIMING
      expect(afterSwap.swappedUsdc).toBe(450.0);
      expect(afterSwap.swapTx).toBe('tx_swap');
    });
  });

  describe('markFailed()', () => {
    it('sets status=FAILED, records error, sets completed_at', async () => {
      const run = await runs.create(strategyId);
      const id = Number(run.runId);

      const failed = await runs.markFailed(id, 'Insufficient SOL balance');

      expect(failed.status).toBe('FAILED');
      expect(failed.errorMessage).toBe('Insufficient SOL balance');
      expect(failed.completedAt).toBeTruthy();
    });

    it('preserves existing checkpoint data when failing', async () => {
      const run = await runs.create(strategyId);
      const id = Number(run.runId);

      await runs.updatePhase(id, 'CLAIMING', { claimedSol: 2.0 });
      const failed = await runs.markFailed(id, 'Swap failed');

      expect(failed.claimedSol).toBe(2.0);
      expect(failed.status).toBe('FAILED');
    });
  });

  describe('markComplete()', () => {
    it('sets status=COMPLETE, phase=COMPLETE, sets completed_at', async () => {
      const run = await runs.create(strategyId);
      const id = Number(run.runId);

      const completed = await runs.markComplete(id);

      expect(completed.status).toBe('COMPLETE');
      expect(completed.phase).toBe('COMPLETE');
      expect(completed.completedAt).toBeTruthy();
    });
  });

  describe('getByStrategyId()', () => {
    it('returns runs ordered by started_at DESC', async () => {
      await runs.create(strategyId);
      await runs.create(strategyId);
      await runs.create(strategyId);

      const result = await runs.getByStrategyId(strategyId);
      expect(result).toHaveLength(3);

      // Most recent first (highest IDs since started_at is same)
      const ids = result.map((r) => Number(r.runId));
      expect(ids[0]).toBeGreaterThan(ids[1]);
      expect(ids[1]).toBeGreaterThan(ids[2]);
    });

    it('returns empty array for unknown strategy', async () => {
      expect(await runs.getByStrategyId(999)).toEqual([]);
    });

    it('does not return runs from other strategies', async () => {
      // Create second strategy
      await conn.run(
        "INSERT INTO strategies (token_mint, name, owner_wallet) VALUES (?, ?, ?)",
        'mint2',
        'Other',
        'wallet2',
      );
      const strategy2Id = 2;

      await runs.create(strategyId);
      await runs.create(strategy2Id);

      const s1Runs = await runs.getByStrategyId(strategyId);
      expect(s1Runs).toHaveLength(1);
      expect(s1Runs[0].strategyId).toBe(String(strategyId));
    });
  });

  describe('getLatest()', () => {
    it('respects limit parameter', async () => {
      await runs.create(strategyId);
      await runs.create(strategyId);
      await runs.create(strategyId);
      await runs.create(strategyId);
      await runs.create(strategyId);

      const latest2 = await runs.getLatest(strategyId, 2);
      expect(latest2).toHaveLength(2);

      const latest3 = await runs.getLatest(strategyId, 3);
      expect(latest3).toHaveLength(3);
    });

    it('defaults to limit of 10', async () => {
      // Create 12 runs
      for (let i = 0; i < 12; i++) {
        await runs.create(strategyId);
      }

      const latest = await runs.getLatest(strategyId);
      expect(latest).toHaveLength(10);
    });

    it('returns runs in descending order', async () => {
      await runs.create(strategyId);
      await runs.create(strategyId);
      await runs.create(strategyId);

      const latest = await runs.getLatest(strategyId, 10);
      const ids = latest.map((r) => Number(r.runId));
      expect(ids[0]).toBeGreaterThan(ids[1]);
      expect(ids[1]).toBeGreaterThan(ids[2]);
    });
  });
});
