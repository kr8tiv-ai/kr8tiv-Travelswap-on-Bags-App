import type { DatabaseConnection } from '../Database.js';

export const name = '001_create_strategies';

export function up(conn: DatabaseConnection): void {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS strategies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_mint TEXT NOT NULL,
      fee_source TEXT DEFAULT 'CLAIMABLE_POSITIONS',
      threshold_sol REAL DEFAULT 5.0,
      slippage_bps INTEGER DEFAULT 50,
      distribution_mode TEXT DEFAULT 'EQUAL_SPLIT',
      credit_mode TEXT DEFAULT 'GIFT_CARD',
      gift_card_threshold_usd REAL DEFAULT 50,
      cron_expression TEXT DEFAULT '0 */6 * * *',
      enabled INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}
