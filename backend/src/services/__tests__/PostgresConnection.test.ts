import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PostgresConnection } from '../PostgresConnection.js';
import type { Pool, QueryResult } from 'pg';

// ─── Mock Pool ─────────────────────────────────────────────────

function createMockPool(overrides?: Partial<Pool>): Pool {
  return {
    query: vi.fn(),
    end: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as Pool;
}

function makeQueryResult(rows: unknown[] = [], rowCount = 0): QueryResult {
  return {
    rows,
    rowCount,
    command: '',
    oid: 0,
    fields: [],
  } as QueryResult;
}

describe('PostgresConnection', () => {
  let pool: Pool;
  let conn: PostgresConnection;

  beforeEach(() => {
    pool = createMockPool();
    conn = new PostgresConnection(pool);
  });

  describe('run()', () => {
    it('executes parameterized INSERT and returns RunResult', async () => {
      (pool.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(makeQueryResult([], 1))  // INSERT
        .mockResolvedValueOnce(makeQueryResult([{ last_id: 42 }])); // currval

      const result = await conn.run(
        'INSERT INTO strategies (name) VALUES (?)',
        'test',
      );

      // Verify ? was translated to $1
      expect(pool.query).toHaveBeenCalledWith(
        'INSERT INTO strategies (name) VALUES ($1)',
        ['test'],
      );
      expect(result.changes).toBe(1);
      expect(result.lastInsertRowid).toBe(42);
    });

    it('translates multiple ? params to $1, $2, ...', async () => {
      (pool.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(makeQueryResult([], 1))
        .mockResolvedValueOnce(makeQueryResult([{ last_id: 1 }]));

      await conn.run(
        'INSERT INTO runs (strategy_id, phase, status) VALUES (?, ?, ?)',
        1, 'CLAIM', 'RUNNING',
      );

      expect(pool.query).toHaveBeenCalledWith(
        'INSERT INTO runs (strategy_id, phase, status) VALUES ($1, $2, $3)',
        [1, 'CLAIM', 'RUNNING'],
      );
    });

    it('returns changes=0 and lastInsertRowid=0 for non-INSERT queries', async () => {
      (pool.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(makeQueryResult([], 0));

      const result = await conn.run('DELETE FROM strategies WHERE id = ?', 999);
      expect(result.changes).toBe(0);
      expect(result.lastInsertRowid).toBe(0);
    });
  });

  describe('get()', () => {
    it('returns first row from query', async () => {
      const row = { id: 1, name: 'test', token_mint: 'abc' };
      (pool.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(makeQueryResult([row]));

      const result = await conn.get<typeof row>(
        'SELECT * FROM strategies WHERE id = ?', 1,
      );

      expect(pool.query).toHaveBeenCalledWith(
        'SELECT * FROM strategies WHERE id = $1',
        [1],
      );
      expect(result).toEqual(row);
    });

    it('returns undefined when no rows match', async () => {
      (pool.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(makeQueryResult([]));

      const result = await conn.get('SELECT * FROM strategies WHERE id = ?', 999);
      expect(result).toBeUndefined();
    });
  });

  describe('all()', () => {
    it('returns all rows from query', async () => {
      const rows = [
        { id: 1, name: 'a' },
        { id: 2, name: 'b' },
      ];
      (pool.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(makeQueryResult(rows));

      const result = await conn.all<typeof rows[0]>(
        'SELECT * FROM strategies',
      );

      expect(pool.query).toHaveBeenCalledWith(
        'SELECT * FROM strategies',
        [],
      );
      expect(result).toEqual(rows);
    });

    it('returns empty array when no rows', async () => {
      (pool.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(makeQueryResult([]));

      const result = await conn.all('SELECT * FROM strategies WHERE 1 = 0');
      expect(result).toEqual([]);
    });
  });

  describe('exec()', () => {
    it('executes raw SQL without parameters', async () => {
      (pool.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(makeQueryResult());

      await conn.exec('CREATE TABLE test (id SERIAL PRIMARY KEY)');

      expect(pool.query).toHaveBeenCalledWith(
        'CREATE TABLE test (id SERIAL PRIMARY KEY)',
      );
    });
  });

  describe('close()', () => {
    it('ends the pool', async () => {
      await conn.close();
      expect(pool.end).toHaveBeenCalled();
    });
  });

  describe('parameter translation edge cases', () => {
    it('handles SQL with no parameters', async () => {
      (pool.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(makeQueryResult([{ count: 5 }]));

      const result = await conn.get<{ count: number }>('SELECT COUNT(*) as count FROM strategies');
      expect(pool.query).toHaveBeenCalledWith(
        'SELECT COUNT(*) as count FROM strategies',
        [],
      );
      expect(result?.count).toBe(5);
    });

    it('handles INSERT with RETURNING clause', async () => {
      (pool.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(makeQueryResult([{ id: 7 }], 1));

      const result = await conn.run(
        'INSERT INTO strategies (name) VALUES (?) RETURNING id',
        'test',
      );

      expect(result.changes).toBe(1);
      expect(result.lastInsertRowid).toBe(7);
    });
  });
});
