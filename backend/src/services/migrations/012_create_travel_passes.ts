import type { DatabaseConnection } from '../Database.js';
import type { SqlDialect } from '../dialect.js';

export const name = '012_create_travel_passes';

export async function up(conn: DatabaseConnection, d: SqlDialect): Promise<void> {
  await conn.exec(`
    CREATE TABLE IF NOT EXISTS travel_passes (
      id ${d.autoId()},
      gift_card_id ${d.intType()} NOT NULL REFERENCES gift_cards(id) ON DELETE CASCADE,
      strategy_id ${d.intType()} NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
      wallet_address ${d.textType()} NOT NULL,
      denomination_usd ${d.realType()} NOT NULL,
      token_mint ${d.textType()} NOT NULL,
      mint_signature ${d.textType()},
      metadata_uri ${d.textType()},
      status ${d.textType()} NOT NULL DEFAULT 'PENDING',
      error_message ${d.textType()},
      created_at ${d.textType()} NOT NULL ${d.defaultNow()},
      minted_at ${d.textType()}
    )
  `);
}
