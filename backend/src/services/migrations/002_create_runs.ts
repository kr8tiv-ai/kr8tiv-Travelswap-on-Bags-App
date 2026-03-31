import type { DatabaseConnection } from '../Database.js';
import type { SqlDialect } from '../dialect.js';

export const name = '002_create_runs';

export async function up(conn: DatabaseConnection, d: SqlDialect): Promise<void> {
  await conn.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id ${d.autoId()},
      strategy_id ${d.intType()} NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
      phase ${d.textType()} NOT NULL DEFAULT 'PENDING',
      status ${d.textType()} NOT NULL DEFAULT 'RUNNING',
      claimed_sol ${d.realType()} DEFAULT 0,
      swapped_usdc ${d.realType()} DEFAULT 0,
      allocated_usd ${d.realType()} DEFAULT 0,
      credits_issued ${d.intType()} DEFAULT 0,
      gift_cards_purchased ${d.intType()} DEFAULT 0,
      claim_tx ${d.textType()},
      swap_tx ${d.textType()},
      error ${d.textType()},
      started_at ${d.textType()} NOT NULL ${d.defaultNow()},
      completed_at ${d.textType()}
    )
  `);
}
