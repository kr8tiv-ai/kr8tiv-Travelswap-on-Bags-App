import type { DatabaseConnection } from '../Database.js';
import type { SqlDialect } from '../dialect.js';

export const name = '004_create_gift_cards';

export async function up(conn: DatabaseConnection, d: SqlDialect): Promise<void> {
  await conn.exec(`
    CREATE TABLE IF NOT EXISTS gift_cards (
      id ${d.autoId()},
      strategy_id ${d.intType()} NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
      run_id ${d.intType()} NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      wallet_address ${d.textType()} NOT NULL,
      denomination_usd ${d.realType()} NOT NULL,
      code_encrypted ${d.textType()},
      status ${d.textType()} NOT NULL DEFAULT 'PURCHASED',
      delivered_at ${d.textType()},
      redeemed_at ${d.textType()},
      created_at ${d.textType()} NOT NULL ${d.defaultNow()}
    )
  `);
}
