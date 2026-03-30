import type { DatabaseConnection } from '../Database.js';

export const name = '003_create_travel_balances';

export function up(conn: DatabaseConnection): void {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS travel_balances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      strategy_id INTEGER NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
      wallet_address TEXT NOT NULL,
      balance_usd REAL DEFAULT 0,
      total_earned REAL DEFAULT 0,
      total_spent REAL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(strategy_id, wallet_address)
    )
  `);
}
