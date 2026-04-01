import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database, type DatabaseConnection } from '../../services/Database.js';
import { createExecutionPolicy, type ExecutionPolicy } from '../ExecutionPolicy.js';
import type { Config } from '../../config/index.js';

/** Build a minimal Config for testing. Override specific fields as needed. */
function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    bagsApiKey: 'test-key',
    bagsApiBaseUrl: 'https://api.test.com',
    heliusApiKey: 'test-helius',
    heliusRpcUrl: 'https://rpc.test.com',
    apiAuthToken: 'test-token',
    giftCardEncryptionKey: 'test-enc-key',
    giftCardDailyLimit: 5,
    giftCardMaxDenomination: 100,
    balanceMaxUsd: 500,
    dryRun: false,
    executionKillSwitch: false,
    maxDailyRuns: 3,
    maxClaimableSolPerRun: 100,
    minIntervalMinutes: 60,
    feeThresholdSol: 5,
    feeSource: 'CLAIMABLE_POSITIONS',
    swapSlippageBps: 50,
    distributionMode: 'TOP_N_HOLDERS',
    distributionTopN: 100,
    creditMode: 'GIFT_CARD',
    cronExpression: '0 */6 * * *',
    port: 3001,
    databasePath: ':memory:',
    logLevel: 'error', // suppress logs in tests
    nodeEnv: 'test',
    corsOrigins: '',
    ...overrides,
  };
}

describe('ExecutionPolicy', () => {
  let db: Database;
  let conn: DatabaseConnection;
  let strategyId: number;

  beforeEach(async () => {
    db = new Database(':memory:');
    conn = await db.connect();
    await db.runMigrations();

    // Insert a strategy for FK constraints
    await conn.run(
      "INSERT INTO strategies (token_mint) VALUES (?)",
      'So11111111111111111111111111111111111111112',
    );
    strategyId = 1;
  });

  afterEach(() => {
    db.close();
  });

  describe('isKillSwitchActive()', () => {
    it('returns false when kill switch is off', () => {
      const policy = createExecutionPolicy(makeConfig(), conn);
      expect(policy.isKillSwitchActive()).toBe(false);
    });

    it('returns true when kill switch is on', () => {
      const policy = createExecutionPolicy(
        makeConfig({ executionKillSwitch: true }),
        conn,
      );
      expect(policy.isKillSwitchActive()).toBe(true);
    });
  });

  describe('isDryRun()', () => {
    it('returns false by default', () => {
      const policy = createExecutionPolicy(makeConfig(), conn);
      expect(policy.isDryRun()).toBe(false);
    });

    it('returns true when dry run is enabled', () => {
      const policy = createExecutionPolicy(
        makeConfig({ dryRun: true }),
        conn,
      );
      expect(policy.isDryRun()).toBe(true);
    });
  });

  describe('canStartRun()', () => {
    it('allows run when under daily limit', async () => {
      const policy = createExecutionPolicy(makeConfig(), conn);
      const result = await policy.canStartRun(strategyId);
      expect(result.allowed).toBe(true);
    });

    it('blocks run when kill switch is active', async () => {
      const policy = createExecutionPolicy(
        makeConfig({ executionKillSwitch: true }),
        conn,
      );
      const result = await policy.canStartRun(strategyId);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Kill switch');
    });

    it('blocks run when daily limit is reached', async () => {
      const config = makeConfig({ maxDailyRuns: 2 });
      const policy = createExecutionPolicy(config, conn);

      // Insert 2 runs today
      const today = new Date().toISOString().slice(0, 10);
      await conn.run(
        "INSERT INTO runs (strategy_id, phase, status, started_at) VALUES (?, ?, ?, ?)",
        strategyId, 'COMPLETE', 'COMPLETE', today + 'T01:00:00',
      );
      await conn.run(
        "INSERT INTO runs (strategy_id, phase, status, started_at) VALUES (?, ?, ?, ?)",
        strategyId, 'COMPLETE', 'COMPLETE', today + 'T02:00:00',
      );

      const result = await policy.canStartRun(strategyId);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Daily run limit');
    });

    it('allows run when runs are from different strategies', async () => {
      const config = makeConfig({ maxDailyRuns: 1 });
      const policy = createExecutionPolicy(config, conn);

      // Insert strategy 2 and a run for it
      await conn.run("INSERT INTO strategies (token_mint) VALUES (?)", 'otherMint');
      const otherStrategyId = 2;
      const today = new Date().toISOString().slice(0, 10);
      await conn.run(
        "INSERT INTO runs (strategy_id, phase, status, started_at) VALUES (?, ?, ?, ?)",
        otherStrategyId, 'COMPLETE', 'COMPLETE', today + 'T01:00:00',
      );

      // Strategy 1 should still be allowed
      const result = await policy.canStartRun(strategyId);
      expect(result.allowed).toBe(true);
    });

    it('blocks run when minimum interval has not elapsed', async () => {
      const config = makeConfig({ minIntervalMinutes: 60 });
      const now = Date.now();
      // Last run started 30 minutes ago
      const thirtyMinAgo = new Date(now - 30 * 60 * 1000).toISOString();

      await conn.run(
        "INSERT INTO runs (strategy_id, phase, status, started_at) VALUES (?, ?, ?, ?)",
        strategyId, 'COMPLETE', 'COMPLETE', thirtyMinAgo,
      );

      const policy = createExecutionPolicy(config, conn, { nowFn: () => now });
      const result = await policy.canStartRun(strategyId);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Minimum interval not elapsed');
    });

    it('allows run when minimum interval has elapsed', async () => {
      const config = makeConfig({ minIntervalMinutes: 60 });
      const now = Date.now();
      // Last run started 90 minutes ago
      const ninetyMinAgo = new Date(now - 90 * 60 * 1000).toISOString();

      await conn.run(
        "INSERT INTO runs (strategy_id, phase, status, started_at) VALUES (?, ?, ?, ?)",
        strategyId, 'COMPLETE', 'COMPLETE', ninetyMinAgo,
      );

      const policy = createExecutionPolicy(config, conn, { nowFn: () => now });
      const result = await policy.canStartRun(strategyId);
      expect(result.allowed).toBe(true);
    });

    it('allows run when no previous runs exist (interval check skipped)', async () => {
      const config = makeConfig({ minIntervalMinutes: 120 });
      const policy = createExecutionPolicy(config, conn, { nowFn: () => Date.now() });
      const result = await policy.canStartRun(strategyId);
      expect(result.allowed).toBe(true);
    });

    it('skips interval check when minIntervalMinutes is 0', async () => {
      const config = makeConfig({ minIntervalMinutes: 0 });
      const now = Date.now();
      // Last run started 1 second ago
      const oneSecAgo = new Date(now - 1000).toISOString();

      await conn.run(
        "INSERT INTO runs (strategy_id, phase, status, started_at) VALUES (?, ?, ?, ?)",
        strategyId, 'COMPLETE', 'COMPLETE', oneSecAgo,
      );

      const policy = createExecutionPolicy(config, conn, { nowFn: () => now });
      const result = await policy.canStartRun(strategyId);
      expect(result.allowed).toBe(true);
    });

    it('checks interval against most recent run only', async () => {
      const config = makeConfig({ minIntervalMinutes: 60 });
      const now = Date.now();
      // Old run from 2 hours ago
      const twoHoursAgo = new Date(now - 120 * 60 * 1000).toISOString();
      // Recent run 10 minutes ago
      const tenMinAgo = new Date(now - 10 * 60 * 1000).toISOString();

      await conn.run(
        "INSERT INTO runs (strategy_id, phase, status, started_at) VALUES (?, ?, ?, ?)",
        strategyId, 'COMPLETE', 'COMPLETE', twoHoursAgo,
      );
      await conn.run(
        "INSERT INTO runs (strategy_id, phase, status, started_at) VALUES (?, ?, ?, ?)",
        strategyId, 'COMPLETE', 'COMPLETE', tenMinAgo,
      );

      const policy = createExecutionPolicy(config, conn, { nowFn: () => now });
      const result = await policy.canStartRun(strategyId);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Minimum interval not elapsed');
    });
  });

  describe('canExecutePhase()', () => {
    it('allows phase when kill switch is off', () => {
      const policy = createExecutionPolicy(makeConfig(), conn);
      const result = policy.canExecutePhase('CLAIMING');
      expect(result.allowed).toBe(true);
    });

    it('blocks phase when kill switch is active', () => {
      const policy = createExecutionPolicy(
        makeConfig({ executionKillSwitch: true }),
        conn,
      );
      const result = policy.canExecutePhase('SWAPPING');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Kill switch');
    });
  });

  describe('canPurchaseGiftCard()', () => {
    it('allows purchase under limits', async () => {
      const policy = createExecutionPolicy(makeConfig(), conn);
      const result = await policy.canPurchaseGiftCard(strategyId, 50);
      expect(result.allowed).toBe(true);
    });

    it('blocks purchase when kill switch is active', async () => {
      const policy = createExecutionPolicy(
        makeConfig({ executionKillSwitch: true }),
        conn,
      );
      const result = await policy.canPurchaseGiftCard(strategyId, 50);
      expect(result.allowed).toBe(false);
    });

    it('blocks purchase exceeding max denomination', async () => {
      const config = makeConfig({ giftCardMaxDenomination: 100 });
      const policy = createExecutionPolicy(config, conn);
      const result = await policy.canPurchaseGiftCard(strategyId, 150);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('exceeds max');
    });

    it('allows purchase at exactly max denomination', async () => {
      const config = makeConfig({ giftCardMaxDenomination: 100 });
      const policy = createExecutionPolicy(config, conn);
      const result = await policy.canPurchaseGiftCard(strategyId, 100);
      expect(result.allowed).toBe(true);
    });

    it('blocks purchase when daily gift card limit reached', async () => {
      const config = makeConfig({ giftCardDailyLimit: 2 });
      const policy = createExecutionPolicy(config, conn);

      // Insert a run to satisfy FK constraint on gift_cards
      const runResult = await conn.run(
        "INSERT INTO runs (strategy_id, phase, status) VALUES (?, ?, ?)",
        strategyId, 'CREDITING', 'RUNNING',
      );
      const runId = Number(runResult.lastInsertRowid);

      // Insert 2 gift cards today
      const today = new Date().toISOString().slice(0, 10);
      await conn.run(
        "INSERT INTO gift_cards (strategy_id, run_id, wallet_address, denomination_usd, status, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        strategyId, runId, 'wallet1', 50, 'PURCHASED', today + 'T01:00:00',
      );
      await conn.run(
        "INSERT INTO gift_cards (strategy_id, run_id, wallet_address, denomination_usd, status, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        strategyId, runId, 'wallet2', 50, 'PURCHASED', today + 'T02:00:00',
      );

      const result = await policy.canPurchaseGiftCard(strategyId, 50);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Daily gift card limit');
    });
  });

  describe('canAllocateBalance()', () => {
    it('allows allocation when under max', async () => {
      const policy = createExecutionPolicy(makeConfig(), conn);
      const result = await policy.canAllocateBalance('wallet1', 100);
      expect(result.allowed).toBe(true);
    });

    it('blocks allocation when kill switch is active', async () => {
      const policy = createExecutionPolicy(
        makeConfig({ executionKillSwitch: true }),
        conn,
      );
      const result = await policy.canAllocateBalance('wallet1', 100);
      expect(result.allowed).toBe(false);
    });

    it('blocks allocation when projected balance exceeds max', async () => {
      const config = makeConfig({ balanceMaxUsd: 500 });
      const policy = createExecutionPolicy(config, conn);

      // Insert existing balance
      await conn.run(
        "INSERT INTO travel_balances (strategy_id, wallet_address, balance_usd) VALUES (?, ?, ?)",
        strategyId, 'wallet1', 400,
      );

      const result = await policy.canAllocateBalance('wallet1', 200);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('exceeds max');
    });

    it('allows allocation when projected balance equals max', async () => {
      const config = makeConfig({ balanceMaxUsd: 500 });
      const policy = createExecutionPolicy(config, conn);

      await conn.run(
        "INSERT INTO travel_balances (strategy_id, wallet_address, balance_usd) VALUES (?, ?, ?)",
        strategyId, 'wallet1', 400,
      );

      const result = await policy.canAllocateBalance('wallet1', 100);
      expect(result.allowed).toBe(true);
    });

    it('sums balances across all strategies for the same wallet', async () => {
      const config = makeConfig({ balanceMaxUsd: 500 });
      const policy = createExecutionPolicy(config, conn);

      // Add second strategy
      await conn.run("INSERT INTO strategies (token_mint) VALUES (?)", 'otherMint');

      // Balance across two strategies
      await conn.run(
        "INSERT INTO travel_balances (strategy_id, wallet_address, balance_usd) VALUES (?, ?, ?)",
        1, 'wallet1', 200,
      );
      await conn.run(
        "INSERT INTO travel_balances (strategy_id, wallet_address, balance_usd) VALUES (?, ?, ?)",
        2, 'wallet1', 250,
      );

      // Total = 450, adding 100 = 550 > 500
      const result = await policy.canAllocateBalance('wallet1', 100);
      expect(result.allowed).toBe(false);
    });

    it('handles wallet with no existing balance', async () => {
      const config = makeConfig({ balanceMaxUsd: 500 });
      const policy = createExecutionPolicy(config, conn);

      const result = await policy.canAllocateBalance('new_wallet', 400);
      expect(result.allowed).toBe(true);
    });
  });
});
