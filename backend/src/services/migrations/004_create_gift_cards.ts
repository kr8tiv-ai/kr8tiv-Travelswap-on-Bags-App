import type { DatabaseConnection } from '../Database.js';

export const name = '004_create_gift_cards';

export function up(conn: DatabaseConnection): void {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS gift_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      strategy_id INTEGER NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
      run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      wallet_address TEXT NOT NULL,
      denomination_usd REAL NOT NULL,
      code_encrypted TEXT,
      status TEXT NOT NULL DEFAULT 'PURCHASED',
      delivered_at TEXT,
      redeemed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}
