import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database, type DatabaseConnection } from '../Database.js';
import { createAuditService, type AuditService } from '../AuditService.js';

describe('AuditService', () => {
  let db: Database;
  let conn: DatabaseConnection;
  let audit: AuditService;
  let strategyId: number;
  let runId: number;

  beforeEach(async () => {
    db = new Database(':memory:');
    conn = await db.connect();
    await db.runMigrations();
    audit = createAuditService(conn);

    // Insert a strategy and a run for FK constraints
    await conn.run(
      "INSERT INTO strategies (token_mint) VALUES (?)",
      'So11111111111111111111111111111111111111112',
    );
    strategyId = 1;

    await conn.run(
      "INSERT INTO runs (strategy_id, phase, status) VALUES (?, ?, ?)",
      strategyId, 'PENDING', 'RUNNING',
    );
    runId = 1;
  });

  afterEach(() => {
    db.close();
  });

  describe('logTransition()', () => {
    it('inserts an audit entry and returns it', async () => {
      const entry = await audit.logTransition(runId, 'CLAIMING', 'start_claim');

      expect(entry.id).toBe(1);
      expect(entry.run_id).toBe(runId);
      expect(entry.phase).toBe('CLAIMING');
      expect(entry.action).toBe('start_claim');
      expect(entry.created_at).toBeTruthy();
    });

    it('stores details as JSON', async () => {
      const details = { amount: 1.5, source: 'test' };
      const entry = await audit.logTransition(runId, 'SWAPPING', 'swap_executed', details);

      expect(entry.details).toBe(JSON.stringify(details));
    });

    it('stores tx_signature when provided', async () => {
      const entry = await audit.logTransition(
        runId, 'CLAIMING', 'claim_success',
        { claimed: 5 },
        'abc123txsig',
      );

      expect(entry.tx_signature).toBe('abc123txsig');
    });

    it('sets tx_signature to null when omitted', async () => {
      const entry = await audit.logTransition(runId, 'PENDING', 'init');

      expect(entry.tx_signature).toBeNull();
    });

    it('sets details to null when omitted', async () => {
      const entry = await audit.logTransition(runId, 'PENDING', 'init');

      expect(entry.details).toBeNull();
    });
  });

  describe('getByRunId()', () => {
    it('returns entries for a specific run ordered by created_at', async () => {
      await audit.logTransition(runId, 'PENDING', 'init');
      await audit.logTransition(runId, 'CLAIMING', 'start_claim');
      await audit.logTransition(runId, 'SWAPPING', 'swap_start');

      const entries = await audit.getByRunId(runId);
      expect(entries).toHaveLength(3);
      expect(entries[0].action).toBe('init');
      expect(entries[1].action).toBe('start_claim');
      expect(entries[2].action).toBe('swap_start');
    });

    it('returns empty array for unknown runId', async () => {
      const entries = await audit.getByRunId(999);
      expect(entries).toEqual([]);
    });

    it('does not return entries from other runs', async () => {
      // Create second run
      await conn.run(
        "INSERT INTO runs (strategy_id, phase, status) VALUES (?, ?, ?)",
        strategyId, 'PENDING', 'RUNNING',
      );
      const run2Id = 2;

      await audit.logTransition(runId, 'PENDING', 'run1_action');
      await audit.logTransition(run2Id, 'PENDING', 'run2_action');

      const run1Entries = await audit.getByRunId(runId);
      expect(run1Entries).toHaveLength(1);
      expect(run1Entries[0].action).toBe('run1_action');
    });
  });

  describe('getLatest()', () => {
    it('returns entries in reverse chronological order', async () => {
      await audit.logTransition(runId, 'PENDING', 'first');
      await audit.logTransition(runId, 'CLAIMING', 'second');
      await audit.logTransition(runId, 'SWAPPING', 'third');

      const entries = await audit.getLatest(10);
      expect(entries).toHaveLength(3);
      // Reverse order (latest first)
      expect(entries[0].action).toBe('third');
      expect(entries[1].action).toBe('second');
      expect(entries[2].action).toBe('first');
    });

    it('respects the limit parameter', async () => {
      await audit.logTransition(runId, 'PENDING', 'a');
      await audit.logTransition(runId, 'CLAIMING', 'b');
      await audit.logTransition(runId, 'SWAPPING', 'c');

      const entries = await audit.getLatest(2);
      expect(entries).toHaveLength(2);
    });

    it('defaults to limit of 50', async () => {
      // Just verify it doesn't throw with no arg
      const entries = await audit.getLatest();
      expect(entries).toHaveLength(0);
    });
  });

  describe('append-only enforcement', () => {
    it('has no update method', () => {
      expect('update' in audit).toBe(false);
      expect('updateEntry' in audit).toBe(false);
    });

    it('has no delete method', () => {
      expect('delete' in audit).toBe(false);
      expect('deleteEntry' in audit).toBe(false);
      expect('remove' in audit).toBe(false);
    });

    it('only exposes logTransition, getByRunId, and getLatest', () => {
      const methods = Object.keys(audit);
      expect(methods.sort()).toEqual(['getByRunId', 'getLatest', 'logTransition']);
    });
  });
});
