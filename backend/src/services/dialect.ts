// ─── SQL Dialect Helper ────────────────────────────────────────
// Resolves syntax differences between SQLite and PostgreSQL for
// use in migration files and queries that must run on both.
//
// Usage:
//   import { createDialect, type SqlDialect } from './dialect.js';
//   const d = createDialect('sqlite');  // or 'postgres'
//   d.autoId()     → 'INTEGER PRIMARY KEY AUTOINCREMENT' | 'SERIAL PRIMARY KEY'
//   d.now()        → "datetime('now')" | 'NOW()'
//   d.boolean(val) → '0'/'1'           | 'FALSE'/'TRUE'
//   d.textType()   → 'TEXT'            | 'TEXT'
//   d.realType()   → 'REAL'            | 'DOUBLE PRECISION'
//   d.intType()    → 'INTEGER'         | 'INTEGER'

export type DialectName = 'sqlite' | 'postgres';

export interface SqlDialect {
  /** The dialect name. */
  readonly name: DialectName;

  /** Auto-incrementing primary key column definition. */
  autoId(): string;

  /** SQL expression for current timestamp. */
  now(): string;

  /** Boolean literal: SQLite uses 0/1, PostgreSQL uses TRUE/FALSE. */
  boolean(val: boolean): string;

  /** Text column type. */
  textType(): string;

  /** Floating-point column type. */
  realType(): string;

  /** Integer column type. */
  intType(): string;

  /** Generate a DEFAULT clause for a timestamp column. */
  defaultNow(): string;
}

// ─── SQLite Dialect ────────────────────────────────────────────

const sqliteDialect: SqlDialect = {
  name: 'sqlite',
  autoId: () => 'INTEGER PRIMARY KEY AUTOINCREMENT',
  now: () => "datetime('now')",
  boolean: (val) => (val ? '1' : '0'),
  textType: () => 'TEXT',
  realType: () => 'REAL',
  intType: () => 'INTEGER',
  defaultNow: () => "DEFAULT (datetime('now'))",
};

// ─── PostgreSQL Dialect ────────────────────────────────────────

const postgresDialect: SqlDialect = {
  name: 'postgres',
  autoId: () => 'SERIAL PRIMARY KEY',
  now: () => 'NOW()',
  boolean: (val) => (val ? 'TRUE' : 'FALSE'),
  textType: () => 'TEXT',
  realType: () => 'DOUBLE PRECISION',
  intType: () => 'INTEGER',
  defaultNow: () => 'DEFAULT NOW()',
};

// ─── Factory ───────────────────────────────────────────────────

export function createDialect(name: DialectName): SqlDialect {
  switch (name) {
    case 'sqlite':
      return sqliteDialect;
    case 'postgres':
      return postgresDialect;
    default:
      throw new Error(`Unknown SQL dialect: ${name as string}`);
  }
}
