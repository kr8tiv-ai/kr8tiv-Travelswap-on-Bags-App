import type { DatabaseConnection } from '../Database.js';
import type { SqlDialect } from '../dialect.js';

export const name = '010_add_custom_allocations';

export async function up(conn: DatabaseConnection, _d: SqlDialect): Promise<void> {
  // JSON-encoded array of {wallet, percentage} pairs for CUSTOM_LIST distribution mode.
  // NULL means "not using custom allocations".
  await conn.exec(
    `ALTER TABLE strategies ADD COLUMN custom_allocations TEXT DEFAULT NULL`,
  );
}
