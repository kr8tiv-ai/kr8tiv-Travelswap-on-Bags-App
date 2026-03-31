// ─── PostgresConnection ────────────────────────────────────────
// Implements the async DatabaseConnection interface using the
// `pg` (node-postgres) Pool. Each method maps to a pool.query()
// call with parameterized SQL.
//
// PostgreSQL uses $1, $2, ... for parameters while SQLite uses ?.
// The exec() method runs raw SQL without parameters (for DDL).

import type { Pool, PoolClient, QueryResult } from 'pg';
import type { DatabaseConnection, RunResult } from './Database.js';
import { logger } from '../logger.js';

const log = logger.child({ component: 'PostgresConnection' });

export class PostgresConnection implements DatabaseConnection {
  constructor(private readonly pool: Pool) {}

  async run(sql: string, ...params: unknown[]): Promise<RunResult> {
    const pgSql = sqliteParamsToPostgres(sql);
    const result: QueryResult = await this.pool.query(pgSql, params);
    return {
      changes: result.rowCount ?? 0,
      lastInsertRowid: await this.getLastInsertId(result, pgSql),
    };
  }

  async get<T = unknown>(sql: string, ...params: unknown[]): Promise<T | undefined> {
    const pgSql = sqliteParamsToPostgres(sql);
    const result = await this.pool.query(pgSql, params);
    return (result.rows[0] as T) ?? undefined;
  }

  async all<T = unknown>(sql: string, ...params: unknown[]): Promise<T[]> {
    const pgSql = sqliteParamsToPostgres(sql);
    const result = await this.pool.query(pgSql, params);
    return result.rows as T[];
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  /** Close the pool. */
  async close(): Promise<void> {
    await this.pool.end();
    log.info('PostgreSQL connection pool closed');
  }

  /**
   * Extract last inserted ID from a PostgreSQL result.
   * For INSERT statements, PostgreSQL returns the OID or we can use
   * RETURNING id — but since our interface doesn't modify the SQL,
   * we rely on rows[0]?.id when available, else 0.
   */
  private async getLastInsertId(result: QueryResult, sql: string): Promise<number | bigint> {
    // If the SQL has RETURNING, the result.rows will have the id
    if (result.rows?.[0]?.id !== undefined) {
      return result.rows[0].id;
    }

    // For INSERT statements without RETURNING, try to get the last value
    // from the sequence. This is a best-effort approach.
    const insertMatch = sql.match(/INSERT\s+INTO\s+(\w+)/i);
    if (insertMatch && result.rowCount && result.rowCount > 0) {
      try {
        const seqResult = await this.pool.query(
          `SELECT currval(pg_get_serial_sequence($1, 'id')) as last_id`,
          [insertMatch[1]],
        );
        if (seqResult.rows[0]?.last_id !== undefined) {
          return Number(seqResult.rows[0].last_id);
        }
      } catch {
        // Sequence may not exist for all tables — that's fine
      }
    }

    return 0;
  }
}

// ─── Parameter Translation ─────────────────────────────────────
// SQLite uses ? for positional parameters, PostgreSQL uses $1, $2, ...

function sqliteParamsToPostgres(sql: string): string {
  let paramIndex = 0;
  return sql.replace(/\?/g, () => {
    paramIndex++;
    return `$${paramIndex}`;
  });
}
