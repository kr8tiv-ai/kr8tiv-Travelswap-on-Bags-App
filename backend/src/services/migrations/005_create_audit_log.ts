import type { DatabaseConnection } from '../Database.js';
import type { SqlDialect } from '../dialect.js';

export const name = '005_create_audit_log';

export async function up(conn: DatabaseConnection, d: SqlDialect): Promise<void> {
  await conn.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id ${d.autoId()},
      run_id ${d.intType()} REFERENCES runs(id) ON DELETE SET NULL,
      phase ${d.textType()},
      action ${d.textType()} NOT NULL,
      details ${d.textType()},
      tx_signature ${d.textType()},
      created_at ${d.textType()} NOT NULL ${d.defaultNow()}
    )
  `);
}
