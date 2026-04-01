import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database, type DatabaseConnection } from '../Database.js';

// Use in-memory SQLite for tests
const IN_MEMORY = ':memory:';

describe('Database', () => {
  let db: Database;
  let conn: DatabaseConnection;

  beforeEach(async () => {
    db = new Database(IN_MEMORY);
    conn = await db.connect();
  });

  afterEach(() => {
    db.close();
  });

  describe('connect()', () => {
    it('returns a usable connection', async () => {
      // Already connected in beforeEach
      expect(conn).toBeDefined();
      // Verify we can exec a basic query
      const row = await conn.get<{ result: number }>('SELECT 1 + 1 as result');
      expect(row?.result).toBe(2);
    });

    it('returns same connection on repeated calls', async () => {
      const conn2 = await db.connect();
      expect(conn2).toBe(conn);
    });
  });

  describe('getConnection()', () => {
    it('returns connection when connected', () => {
      expect(db.getConnection()).toBe(conn);
    });

    it('throws when not connected', () => {
      const freshDb = new Database(IN_MEMORY);
      expect(() => freshDb.getConnection()).toThrow('Database not connected');
    });
  });

  describe('runMigrations()', () => {
    beforeEach(async () => {
      await db.runMigrations();
    });

    it('creates the schema_migrations tracking table', async () => {
      const table = await conn.get<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
      );
      expect(table).toBeDefined();
      expect(table?.name).toBe('schema_migrations');
    });

    it('records all 12 migrations in schema_migrations', async () => {
      const rows = await conn.all<{ name: string }>(
        'SELECT name FROM schema_migrations ORDER BY id',
      );
      expect(rows).toHaveLength(12);
      expect(rows.map((r) => r.name)).toEqual([
        '001_create_strategies',
        '002_create_runs',
        '003_create_travel_balances',
        '004_create_gift_cards',
        '005_create_audit_log',
        '006_add_strategy_columns',
        '007_create_offer_requests',
        '008_create_bookings',
        '009_add_gift_card_payorder',
        '010_add_custom_allocations',
        '011_add_gift_card_provider',
        '012_create_travel_passes',
      ]);
    });

    it('creates the strategies table with correct columns', async () => {
      const cols = await conn.all<{ name: string; type: string }>(
        "PRAGMA table_info('strategies')",
      );
      const colNames = cols.map((c) => c.name);
      expect(colNames).toContain('id');
      expect(colNames).toContain('token_mint');
      expect(colNames).toContain('fee_source');
      expect(colNames).toContain('threshold_sol');
      expect(colNames).toContain('slippage_bps');
      expect(colNames).toContain('distribution_mode');
      expect(colNames).toContain('credit_mode');
      expect(colNames).toContain('enabled');
      expect(colNames).toContain('created_at');
      expect(colNames).toContain('updated_at');
    });

    it('creates the runs table with correct columns', async () => {
      const cols = await conn.all<{ name: string }>(
        "PRAGMA table_info('runs')",
      );
      const colNames = cols.map((c) => c.name);
      expect(colNames).toContain('id');
      expect(colNames).toContain('strategy_id');
      expect(colNames).toContain('phase');
      expect(colNames).toContain('status');
      expect(colNames).toContain('claimed_sol');
      expect(colNames).toContain('swapped_usdc');
      expect(colNames).toContain('claim_tx');
      expect(colNames).toContain('swap_tx');
      expect(colNames).toContain('started_at');
      expect(colNames).toContain('completed_at');
    });

    it('creates the travel_balances table with correct columns', async () => {
      const cols = await conn.all<{ name: string }>(
        "PRAGMA table_info('travel_balances')",
      );
      const colNames = cols.map((c) => c.name);
      expect(colNames).toContain('id');
      expect(colNames).toContain('strategy_id');
      expect(colNames).toContain('wallet_address');
      expect(colNames).toContain('balance_usd');
      expect(colNames).toContain('total_earned');
      expect(colNames).toContain('total_spent');
    });

    it('creates the gift_cards table with correct columns', async () => {
      const cols = await conn.all<{ name: string }>(
        "PRAGMA table_info('gift_cards')",
      );
      const colNames = cols.map((c) => c.name);
      expect(colNames).toContain('id');
      expect(colNames).toContain('strategy_id');
      expect(colNames).toContain('run_id');
      expect(colNames).toContain('wallet_address');
      expect(colNames).toContain('denomination_usd');
      expect(colNames).toContain('code_encrypted');
      expect(colNames).toContain('status');
    });

    it('creates the audit_log table with correct columns', async () => {
      const cols = await conn.all<{ name: string }>(
        "PRAGMA table_info('audit_log')",
      );
      const colNames = cols.map((c) => c.name);
      expect(colNames).toContain('id');
      expect(colNames).toContain('run_id');
      expect(colNames).toContain('phase');
      expect(colNames).toContain('action');
      expect(colNames).toContain('details');
      expect(colNames).toContain('tx_signature');
      expect(colNames).toContain('created_at');
    });

    it('is idempotent — running twice does not fail or duplicate', async () => {
      // Migrations already ran in beforeEach
      await db.runMigrations(); // second call
      const rows = await conn.all<{ name: string }>(
        'SELECT name FROM schema_migrations ORDER BY id',
      );
      expect(rows).toHaveLength(12);
    });

    it('creates all 8 user tables plus schema_migrations', async () => {
      const tables = await conn.all<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      );
      const tableNames = tables.map((t) => t.name).sort();
      expect(tableNames).toEqual([
        'audit_log',
        'bookings',
        'gift_cards',
        'offer_requests',
        'runs',
        'schema_migrations',
        'strategies',
        'travel_balances',
        'travel_passes',
      ]);
    });
  });
});
