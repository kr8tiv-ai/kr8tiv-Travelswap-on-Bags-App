import type { DatabaseConnection } from '../Database.js';
import type { SqlDialect } from '../dialect.js';

export const name = '001_create_strategies';

export async function up(conn: DatabaseConnection, d: SqlDialect): Promise<void> {
  await conn.exec(`
    CREATE TABLE IF NOT EXISTS strategies (
      id ${d.autoId()},
      token_mint ${d.textType()} NOT NULL,
      fee_source ${d.textType()} DEFAULT 'CLAIMABLE_POSITIONS',
      threshold_sol ${d.realType()} DEFAULT 5.0,
      slippage_bps ${d.intType()} DEFAULT 50,
      distribution_mode ${d.textType()} DEFAULT 'EQUAL_SPLIT',
      credit_mode ${d.textType()} DEFAULT 'GIFT_CARD',
      gift_card_threshold_usd ${d.realType()} DEFAULT 50,
      cron_expression ${d.textType()} DEFAULT '0 */6 * * *',
      enabled ${d.intType()} DEFAULT 1,
      created_at ${d.textType()} NOT NULL ${d.defaultNow()},
      updated_at ${d.textType()} NOT NULL ${d.defaultNow()}
    )
  `);
}
