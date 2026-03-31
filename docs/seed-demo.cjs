// Seed script — inserts demo data into FlightBrain SQLite for screenshots.
// Usage: node docs/seed-demo.cjs <db-path>

const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const dbPath = process.argv[2] || path.join(__dirname, '..', 'flightbrain-demo.db');
const db = new DatabaseSync(dbPath);

db.exec('PRAGMA journal_mode=WAL');
db.exec('PRAGMA foreign_keys=ON');

// Track migrations so the backend migration runner skips them
db.exec(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Run migrations inline (SQLite dialect)
db.exec(`
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
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    name TEXT NOT NULL DEFAULT '',
    owner_wallet TEXT NOT NULL DEFAULT '',
    distribution_top_n INTEGER NOT NULL DEFAULT 100
  );

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
  );

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
  );

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
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER REFERENCES runs(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS offer_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id TEXT NOT NULL UNIQUE,
    offers_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    strategy_id INTEGER NOT NULL,
    wallet_address TEXT NOT NULL,
    offer_id TEXT NOT NULL,
    duffel_order_id TEXT,
    booking_reference TEXT,
    passenger_data_encrypted TEXT NOT NULL,
    amount_usd REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    status TEXT NOT NULL DEFAULT 'PENDING',
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (strategy_id) REFERENCES strategies(id)
  );
`);

// Mark all migrations as applied so backend migration runner skips them
db.exec(`
  INSERT INTO schema_migrations (name) VALUES
    ('001_create_strategies'),
    ('002_create_runs'),
    ('003_create_travel_balances'),
    ('004_create_gift_cards'),
    ('005_create_audit_log'),
    ('006_add_strategy_columns'),
    ('007_create_offer_requests'),
    ('008_create_bookings');
`);

// Seed strategies
db.exec(`
  INSERT INTO strategies (name, token_mint, owner_wallet, distribution_mode, credit_mode, threshold_sol, enabled)
  VALUES
    ('PINK Token Travel Fund', 'PINKrucaVNXGMd2qHuTt5Mbo7kUdSsN2JjPUtejQnTE', '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', 'TOP_N', 'GIFT_CARD', 5.0, 1),
    ('BAGS Community Pool', 'BAGSHjhXs3p7PtW5bRPDSLyiFZw1STkST2Q1gg7KQFG', '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy7a8s4gBkVs', 'EQUAL_SPLIT', 'DIRECT_TOPUP', 2.5, 1);
`);

// Seed runs
const now = new Date().toISOString().replace('T', ' ').split('.')[0];
const yesterday = new Date(Date.now() - 86400000).toISOString().replace('T', ' ').split('.')[0];
const twoDaysAgo = new Date(Date.now() - 172800000).toISOString().replace('T', ' ').split('.')[0];

db.exec(`
  INSERT INTO runs (strategy_id, phase, status, claimed_sol, swapped_usdc, allocated_usd, credits_issued, gift_cards_purchased, claim_tx, swap_tx, started_at, completed_at)
  VALUES
    (1, 'COMPLETE', 'COMPLETE', 12.5, 2437.50, 2437.50, 3, 2, '4vJ9JU1bJJE96FwMGz5Cz7E3PzYdDj5LXqsL8CmUAh9WvQYmipFqWTz2H', '3xT8f2uPqJSDFj5LSqsL8CmUAh9WvQYmipFqWTz2HXYZ', '${twoDaysAgo}', '${twoDaysAgo}'),
    (1, 'SWAPPING', 'FAILED', 8.3, 0, 0, 0, 0, '5wK0JV2cKKF07GxNDa6Dz8F4QaZeFk6MYrjqM9DnBi0XwRZYnjqGUxSaI', NULL, '${yesterday}', '${yesterday}'),
    (2, 'PENDING', 'RUNNING', 0, 0, 0, 0, 0, NULL, NULL, '${now}', NULL);
`);

// Seed travel balances
db.exec(`
  INSERT INTO travel_balances (strategy_id, wallet_address, balance_usd, total_earned, total_spent)
  VALUES
    (1, '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', 487.50, 1237.50, 750.00),
    (1, '9vMJfxU1iNqQvGNaMH7eT5iJdBcW3ALBFhqzGPKy4XhP', 312.25, 812.25, 500.00),
    (1, 'HN7cABqLq46Es1jh92dQQisAi5YqGN2ABahFu73zU8EG', 137.75, 387.75, 250.00),
    (2, '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy7a8s4gBkVs', 95.00, 95.00, 0);
`);

// Seed gift cards
db.exec(`
  INSERT INTO gift_cards (strategy_id, run_id, wallet_address, denomination_usd, code_encrypted, status, delivered_at)
  VALUES
    (1, 1, '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', 200, 'enc_demo_card_1', 'PURCHASED', '${twoDaysAgo}'),
    (1, 1, '9vMJfxU1iNqQvGNaMH7eT5iJdBcW3ALBFhqzGPKy4XhP', 100, 'enc_demo_card_2', 'PURCHASED', '${twoDaysAgo}');
`);

// Seed a booking
db.exec(`
  INSERT INTO bookings (strategy_id, wallet_address, offer_id, duffel_order_id, booking_reference, passenger_data_encrypted, amount_usd, status)
  VALUES
    (1, '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', 'off_demo_123', 'ord_demo_456', 'FBDEMO1', 'enc_passenger_data', 347.50, 'CONFIRMED');
`);

console.log('Demo data seeded successfully to:', dbPath);
console.log('Strategies: 2, Runs: 3, Balances: 4, Gift Cards: 2, Bookings: 1');
