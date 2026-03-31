import type { DatabaseConnection } from '../Database.js';
import type { SqlDialect } from '../dialect.js';

export const name = '006_add_strategy_columns';

export async function up(conn: DatabaseConnection, _d: SqlDialect): Promise<void> {
  // ALTER TABLE ADD COLUMN syntax is identical in SQLite and PostgreSQL
  await conn.exec(`ALTER TABLE strategies ADD COLUMN name TEXT NOT NULL DEFAULT ''`);
  await conn.exec(`ALTER TABLE strategies ADD COLUMN owner_wallet TEXT NOT NULL DEFAULT ''`);
  await conn.exec(`ALTER TABLE strategies ADD COLUMN distribution_top_n INTEGER NOT NULL DEFAULT 100`);
}
