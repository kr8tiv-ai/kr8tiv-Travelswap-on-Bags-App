// ─── Database Factory ──────────────────────────────────────────
// Creates and manages database connections based on config.
// When DATABASE_URL is set → PostgreSQL via pg Pool.
// Otherwise → SQLite via node:sqlite.
//
// Usage:
//   const factory = createDatabaseFactory(config);
//   const { conn, dialect, close } = await factory.connect();
//   await factory.runMigrations(conn, dialect);

import { DatabaseSync } from 'node:sqlite';
import { Pool } from 'pg';
import { logger } from '../logger.js';
import { NodeSqliteConnection, type DatabaseConnection, type RunResult } from './Database.js';
import { PostgresConnection } from './PostgresConnection.js';
import { createDialect, type DialectName, type SqlDialect } from './dialect.js';
import { migrations } from './migrations/index.js';

export { type RunResult, type DatabaseConnection } from './Database.js';
export { type SqlDialect, type DialectName } from './dialect.js';

const log = logger.child({ component: 'DatabaseFactory' });

export interface DatabaseHandle {
  /** The active database connection. */
  conn: DatabaseConnection;
  /** The SQL dialect in use. */
  dialect: SqlDialect;
  /** The dialect name ('sqlite' | 'postgres'). */
  dialectName: DialectName;
  /** Close the underlying connection/pool. */
  close: () => void | Promise<void>;
}

export interface DatabaseFactory {
  /** Open the connection and return a handle. */
  connect(): Promise<DatabaseHandle>;
  /** Run all pending migrations using the given handle. */
  runMigrations(handle: DatabaseHandle): Promise<void>;
}

// ─── Migration Runner ──────────────────────────────────────────

async function runMigrations(
  conn: DatabaseConnection,
  dialect: SqlDialect,
): Promise<void> {
  // Create the schema_migrations tracking table
  await conn.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id ${dialect.autoId()},
      name ${dialect.textType()} NOT NULL UNIQUE,
      applied_at ${dialect.textType()} NOT NULL ${dialect.defaultNow()}
    )
  `);

  // Get already-applied migration names
  const applied = (
    await conn.all<{ name: string }>(
      'SELECT name FROM schema_migrations ORDER BY id',
    )
  ).map((row) => row.name);

  const appliedSet = new Set(applied);

  let ranCount = 0;
  for (const migration of migrations) {
    if (appliedSet.has(migration.name)) continue;

    log.info({ migration: migration.name }, 'Running migration');
    await migration.up(conn, dialect);
    await conn.run(
      'INSERT INTO schema_migrations (name) VALUES (?)',
      migration.name,
    );
    ranCount++;
  }

  if (ranCount > 0) {
    log.info({ count: ranCount }, 'Migrations complete');
  } else {
    log.debug('No pending migrations');
  }
}

// ─── SQLite Factory ────────────────────────────────────────────

function createSqliteFactory(dbPath: string): DatabaseFactory {
  let db: DatabaseSync | null = null;
  let conn: NodeSqliteConnection | null = null;
  const dialect = createDialect('sqlite');

  return {
    async connect(): Promise<DatabaseHandle> {
      if (conn) return { conn, dialect, dialectName: 'sqlite', close: () => { db?.close(); db = null; conn = null; } };

      db = new DatabaseSync(dbPath);
      conn = new NodeSqliteConnection(db);

      // WAL mode + foreign keys
      await conn.exec('PRAGMA journal_mode = WAL');
      await conn.exec('PRAGMA foreign_keys = ON');

      log.info({ dbPath }, 'SQLite database connected');

      return {
        conn,
        dialect,
        dialectName: 'sqlite',
        close: () => {
          if (db) {
            db.close();
            db = null;
            conn = null;
            log.debug('SQLite database closed');
          }
        },
      };
    },

    async runMigrations(handle: DatabaseHandle): Promise<void> {
      await runMigrations(handle.conn, handle.dialect);
    },
  };
}

// ─── PostgreSQL Factory ────────────────────────────────────────

function createPostgresFactory(databaseUrl: string): DatabaseFactory {
  let pool: Pool | null = null;
  let pgConn: PostgresConnection | null = null;
  const dialect = createDialect('postgres');

  return {
    async connect(): Promise<DatabaseHandle> {
      if (pgConn && pool) return { conn: pgConn, dialect, dialectName: 'postgres', close: async () => { await pool?.end(); pool = null; pgConn = null; } };

      pool = new Pool({ connectionString: databaseUrl });
      pgConn = new PostgresConnection(pool);

      // Verify connectivity
      await pool.query('SELECT 1');
      log.info('PostgreSQL database connected');

      return {
        conn: pgConn,
        dialect,
        dialectName: 'postgres',
        close: async () => {
          if (pool) {
            await pool.end();
            pool = null;
            pgConn = null;
            log.debug('PostgreSQL connection pool closed');
          }
        },
      };
    },

    async runMigrations(handle: DatabaseHandle): Promise<void> {
      await runMigrations(handle.conn, handle.dialect);
    },
  };
}

// ─── Public Factory ────────────────────────────────────────────

export function createDatabaseFactory(opts: {
  databaseUrl?: string;
  databasePath?: string;
}): DatabaseFactory {
  if (opts.databaseUrl) {
    return createPostgresFactory(opts.databaseUrl);
  }
  return createSqliteFactory(opts.databasePath ?? './data/travelswap.db');
}
