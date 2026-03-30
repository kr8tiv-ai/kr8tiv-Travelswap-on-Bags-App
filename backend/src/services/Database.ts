// ─── Database Service ──────────────────────────────────────────
// Wraps node:sqlite DatabaseSync with WAL mode, foreign keys,
// and a numbered migration system.

import { DatabaseSync, type StatementSync, type StatementResultingChanges } from 'node:sqlite';
import { logger } from '../logger.js';
import { migrations } from './migrations/index.js';

// ─── Interfaces ────────────────────────────────────────────────

export interface DatabaseConnection {
  run(sql: string, ...params: unknown[]): StatementResultingChanges;
  get<T = unknown>(sql: string, ...params: unknown[]): T | undefined;
  all<T = unknown>(sql: string, ...params: unknown[]): T[];
  prepare(sql: string): StatementSync;
  exec(sql: string): void;
}

// ─── NodeSqliteConnection ──────────────────────────────────────

export class NodeSqliteConnection implements DatabaseConnection {
  constructor(private readonly db: DatabaseSync) {}

  run(sql: string, ...params: unknown[]): StatementResultingChanges {
    const stmt = this.db.prepare(sql);
    return stmt.run(...params);
  }

  get<T = unknown>(sql: string, ...params: unknown[]): T | undefined {
    const stmt = this.db.prepare(sql);
    return stmt.get(...params) as T | undefined;
  }

  all<T = unknown>(sql: string, ...params: unknown[]): T[] {
    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as T[];
  }

  prepare(sql: string): StatementSync {
    return this.db.prepare(sql);
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }
}

// ─── Migration Entry ───────────────────────────────────────────

export interface MigrationEntry {
  name: string;
  up: (conn: DatabaseConnection) => void;
}

// ─── Database ──────────────────────────────────────────────────

export class Database {
  private db: DatabaseSync | null = null;
  private conn: NodeSqliteConnection | null = null;

  constructor(private readonly dbPath: string) {}

  /** Open the database and configure pragmas (WAL, FK). */
  connect(): DatabaseConnection {
    if (this.conn) return this.conn;

    this.db = new DatabaseSync(this.dbPath);
    this.conn = new NodeSqliteConnection(this.db);

    // WAL mode for concurrent reads + write performance
    this.conn.exec('PRAGMA journal_mode = WAL');
    // Enforce foreign key constraints
    this.conn.exec('PRAGMA foreign_keys = ON');

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
  runMigrations(): void {
    const conn = this.getConnection();

    // Create the schema_migrations tracking table
    conn.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // Get already-applied migration names
    const applied = conn
      .all<{ name: string }>('SELECT name FROM schema_migrations ORDER BY id')
      .map((row) => row.name);

    const appliedSet = new Set(applied);

    let ranCount = 0;
    for (const migration of migrations) {
      if (appliedSet.has(migration.name)) continue;

      logger.info({ migration: migration.name }, 'Running migration');
      migration.up(conn);
      conn.run(
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
