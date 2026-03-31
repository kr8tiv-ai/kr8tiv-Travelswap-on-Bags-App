import type { DatabaseConnection } from '../Database.js';
import type { SqlDialect } from '../dialect.js';

export const name = '008_create_bookings';

export async function up(conn: DatabaseConnection, d: SqlDialect): Promise<void> {
  await conn.exec(`
    CREATE TABLE IF NOT EXISTS bookings (
      id ${d.autoId()},
      strategy_id ${d.intType()} NOT NULL,
      wallet_address ${d.textType()} NOT NULL,
      offer_id ${d.textType()} NOT NULL,
      duffel_order_id ${d.textType()},
      booking_reference ${d.textType()},
      passenger_data_encrypted ${d.textType()} NOT NULL,
      amount_usd ${d.realType()} NOT NULL,
      currency ${d.textType()} NOT NULL DEFAULT 'USD',
      status ${d.textType()} NOT NULL DEFAULT 'PENDING',
      error_message ${d.textType()},
      created_at ${d.textType()} NOT NULL ${d.defaultNow()},
      updated_at ${d.textType()} NOT NULL ${d.defaultNow()},
      FOREIGN KEY (strategy_id) REFERENCES strategies(id)
    )
  `);

  await conn.exec(`
    CREATE INDEX IF NOT EXISTS idx_bookings_wallet_address
    ON bookings (wallet_address)
  `);

  await conn.exec(`
    CREATE INDEX IF NOT EXISTS idx_bookings_strategy_id
    ON bookings (strategy_id)
  `);

  await conn.exec(`
    CREATE INDEX IF NOT EXISTS idx_bookings_status
    ON bookings (status)
  `);
}
