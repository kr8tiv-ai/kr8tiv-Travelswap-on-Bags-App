import type { DatabaseConnection } from '../Database.js';
import type { SqlDialect } from '../dialect.js';

export const name = '007_create_offer_requests';

export async function up(conn: DatabaseConnection, d: SqlDialect): Promise<void> {
  await conn.exec(`
    CREATE TABLE IF NOT EXISTS offer_requests (
      id ${d.autoId()},
      request_id ${d.textType()} NOT NULL UNIQUE,
      origin ${d.textType()} NOT NULL,
      destination ${d.textType()} NOT NULL,
      departure_date ${d.textType()} NOT NULL,
      return_date ${d.textType()},
      passengers ${d.intType()} NOT NULL DEFAULT 1,
      cabin_class ${d.textType()} NOT NULL DEFAULT 'economy',
      offer_count ${d.intType()} NOT NULL DEFAULT 0,
      created_at ${d.textType()} NOT NULL ${d.defaultNow()},
      expires_at ${d.textType()}
    )
  `);

  await conn.exec(`
    CREATE INDEX IF NOT EXISTS idx_offer_requests_request_id
    ON offer_requests (request_id)
  `);

  await conn.exec(`
    CREATE INDEX IF NOT EXISTS idx_offer_requests_created_at
    ON offer_requests (created_at)
  `);
}
