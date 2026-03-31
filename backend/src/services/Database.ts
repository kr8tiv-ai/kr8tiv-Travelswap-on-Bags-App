// ─── Database Service ──────────────────────────────────────────
// Wraps node:sqlite DatabaseSync with WAL mode, foreign keys,
// and a numbered migration system.
// The DatabaseConnection interface is async to support both
// sync SQLite (via Promise-wrapped calls) and async PostgreSQL.

import { DatabaseSync } from 'node:sqlite';
import { logger } from '../logger.js';
import { migrations } from './migrations/index.js';
import { createDialect, type SqlDialect, type DialectName } from './dialect.js';

// ─── Interfaces ────────────────────────────────────────────────

/** Portable result from a write query (INSERT/UPDATE/DELETE). */
export interface RunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface DatabaseConnection {
  run(sql: string, ...params: unknown[]): Promise<RunResult>;
  get<T = unknown>(sql: string, ...params: unknown[]): Promise<T | undefined>;
  all<T = unknown>(sql: string, ...params: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
}

// ─── NodeSqliteConnection ──────────────────────────────────────

export class NodeSqliteConnection implements DatabaseConnection {
  constructor(private readonly db: DatabaseSync) {}

  async run(sql: string, ...params: unknown[]): Promise<RunResult> {
    const stmt = this.db.prepare(sql);
    return stmt.run(...params);
  }

  async get<T = unknown>(sql: string, ...params: unknown[]): Promise<T | undefined> {
    const stmt = this.db.prepare(sql);
    return stmt.get(...params) as T | undefined;
  }

  async all<T = unknown>(sql: string, ...params: unknown[]): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as T[];
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }
}

// ─── Migration Entry ───────────────────────────────────────────

export interface MigrationEntry {
  name: string;
  up: (conn: DatabaseConnection, dialect: SqlDialect) => Promise<void>;
}

// ─── Database ──────────────────────────────────────────────────

export class Database {
  private db: DatabaseSync | null = null;
  private conn: NodeSqliteConnection | null = null;

  constructor(private readonly dbPath: string) {}

  /** Open the database and configure pragmas (WAL, FK). */
  async connect(): Promise<DatabaseConnection> {
    if (this.conn) return this.conn;

    this.db = new DatabaseSync(this.dbPath);
    this.conn = new NodeSqliteConnection(this.db);

    // WAL mode for concurrent reads + write performance
    await this.conn.exec('PRAGMA journal_mode = WAL');
    // Enforce foreign key constraints
    await this.conn.exec('PRAGMA foreign_keys = ON');

    logger.info({ dbPath: this.dbPath }, 'Database connected');
    return this.conn;
  }

  /** Get the active connection, throwing if not connected. */
  getConnection(): DatabaseConnection {
    if (!this.conn) {
      throw new Error('Database not connected. Call connect() first.');
    }
    return this.conn;
  }

  /** Run all pending migrations in order. */
  async runMigrations(dialectName: DialectName = 'sqlite'): Promise<void> {
    const conn = this.getConnection();
    const dialect = createDialect(dialectName);

    // Create the schema_migrations tracking table
    await conn.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id ${dialect.autoId()},
        name ${dialect.textType()} NOT NULL UNIQUE,
        applied_at ${dialect.textType()} NOT NULL ${dialect.defaultNow()}
      )
    `);

    // Get already-applied migration names
    const applied = (await conn
      .all<{ name: string }>('SELECT name FROM schema_migrations ORDER BY id'))
      .map((row) => row.name);

    const appliedSet = new Set(applied);

    let ranCount = 0;
    for (const migration of migrations) {
      if (appliedSet.has(migration.name)) continue;

      logger.info({ migration: migration.name }, 'Running migration');
      await migration.up(conn, dialect);
      await conn.run(
        'INSERT INTO schema_migrations (name) VALUES (?)',
        migration.name,
      );
      ranCount++;
    }

    if (ranCount > 0) {
      logger.info({ count: ranCount }, 'Migrations complete');
    } else {
      logger.debug('No pending migrations');
    }
  }

  /** Close the database connection. */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.conn = null;
      logger.debug('Database closed');
    }
  }
}
