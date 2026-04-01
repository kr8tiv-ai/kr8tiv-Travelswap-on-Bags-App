import type { DatabaseConnection } from '../Database.js';
import type { SqlDialect } from '../dialect.js';

export const name = '011_add_gift_card_provider';

export async function up(conn: DatabaseConnection, d: SqlDialect): Promise<void> {
  // Provider attribution: 'coinvoyage', 'bitrefill', or 'stub' (default).
  await conn.exec(
    `ALTER TABLE gift_cards ADD COLUMN provider ${d.textType()} DEFAULT 'stub'`,
  );

  // Bitrefill invoice ID for order tracking (analogous to payorder_id for CoinVoyage).
  await conn.exec(
    `ALTER TABLE gift_cards ADD COLUMN bitrefill_invoice_id ${d.textType()}`,
  );
}
