import type { DatabaseConnection } from '../Database.js';

export const name = '005_create_audit_log';

export function up(conn: DatabaseConnection): void {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER REFERENCES runs(id) ON DELETE SET NULL,
      phase TEXT,
      action TEXT NOT NULL,
      details TEXT,
      tx_signature TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}
