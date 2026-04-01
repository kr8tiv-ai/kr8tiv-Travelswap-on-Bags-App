import type { DatabaseConnection } from '../Database.js';
import type { SqlDialect } from '../dialect.js';

export const name = '009_add_gift_card_payorder';

export async function up(conn: DatabaseConnection, d: SqlDialect): Promise<void> {
  // Add payorder_id for CoinVoyage PayOrder tracking
  await conn.exec(
    `ALTER TABLE gift_cards ADD COLUMN payorder_id ${d.textType()}`,
  );

  // Add payment_status for async payment lifecycle (PENDING → COMPLETED/FAILED)
  await conn.exec(
    `ALTER TABLE gift_cards ADD COLUMN payment_status ${d.textType()}`,
  );

  // Add error_message for recording CoinVoyage errors
  await conn.exec(
    `ALTER TABLE gift_cards ADD COLUMN error_message ${d.textType()}`,
  );

  // Index on payorder_id for webhook lookup by payorder
  await conn.exec(
    `CREATE INDEX IF NOT EXISTS idx_gift_cards_payorder_id ON gift_cards (payorder_id)`,
  );
}
