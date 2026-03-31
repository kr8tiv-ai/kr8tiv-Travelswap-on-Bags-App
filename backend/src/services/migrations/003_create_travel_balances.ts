import type { DatabaseConnection } from '../Database.js';
import type { SqlDialect } from '../dialect.js';

export const name = '003_create_travel_balances';

export async function up(conn: DatabaseConnection, d: SqlDialect): Promise<void> {
  await conn.exec(`
    CREATE TABLE IF NOT EXISTS travel_balances (
      id ${d.autoId()},
      strategy_id ${d.intType()} NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
      wallet_address ${d.textType()} NOT NULL,
      balance_usd ${d.realType()} DEFAULT 0,
      total_earned ${d.realType()} DEFAULT 0,
      total_spent ${d.realType()} DEFAULT 0,
      created_at ${d.textType()} NOT NULL ${d.defaultNow()},
      updated_at ${d.textType()} NOT NULL ${d.defaultNow()},
      UNIQUE(strategy_id, wallet_address)
    )
  `);
}
