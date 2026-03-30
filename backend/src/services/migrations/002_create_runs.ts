import type { DatabaseConnection } from '../Database.js';

export const name = '002_create_runs';

export function up(conn: DatabaseConnection): void {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      strategy_id INTEGER NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
      phase TEXT NOT NULL DEFAULT 'PENDING',
      status TEXT NOT NULL DEFAULT 'RUNNING',
      claimed_sol REAL DEFAULT 0,
      swapped_usdc REAL DEFAULT 0,
      allocated_usd REAL DEFAULT 0,
      credits_issued INTEGER DEFAULT 0,
      gift_cards_purchased INTEGER DEFAULT 0,
      claim_tx TEXT,
      swap_tx TEXT,
      error TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    )
  `);
}
