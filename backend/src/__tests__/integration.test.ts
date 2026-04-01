// ─── Integration Tests ─────────────────────────────────────────
// Full-stack integration: real in-memory SQLite, real services,
// real Fastify app via buildApp. No mocks.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Database } from '../services/Database.js';
import { createStrategyService } from '../services/StrategyService.js';
import { createRunService } from '../services/RunService.js';
import { createAuditService } from '../services/AuditService.js';
import { createTravelBalanceService } from '../services/TravelBalanceService.js';
import { createGiftCardService } from '../services/GiftCardService.js';
import { createExecutionPolicy } from '../engine/ExecutionPolicy.js';
import { createPipelineEngine } from '../engine/PipelineEngine.js';
import { createRunLock } from '../engine/RunLock.js';
import { buildApp } from '../server.js';
import type { Config } from '../config/index.js';
import type { RouteDeps } from '../routes/types.js';
import type { BagsAdapter } from '../types/index.js';

// ─── Test Helpers ──────────────────────────────────────────────

const TEST_TOKEN = 'integration-test-token';

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    bagsApiKey: 'test-bags-key',
    bagsApiBaseUrl: 'https://api.bags.fm',
    heliusApiKey: 'test-helius-key',
    heliusRpcUrl: 'https://mainnet.helius-rpc.com',
    apiAuthToken: TEST_TOKEN,
    giftCardEncryptionKey: 'a'.repeat(64),
    giftCardDailyLimit: 20,
    giftCardMaxDenomination: 200,
    balanceMaxUsd: 1000,
    travelswapPartnerRef: 'TEST',
    dryRun: false,
    executionKillSwitch: false,
    maxDailyRuns: 4,
    maxClaimableSolPerRun: 100,
    minIntervalMinutes: 60,
    feeThresholdSol: 5,
    feeSource: 'CLAIMABLE_POSITIONS',
    swapSlippageBps: 50,
    distributionMode: 'TOP_N_HOLDERS',
    distributionTopN: 100,
    creditMode: 'GIFT_CARD',
    cronExpression: '0 */6 * * *',
    port: 0,
    databasePath: ':memory:',
    logLevel: 'error',
    nodeEnv: 'test',
    corsOrigins: '',
    signerPrivateKey: undefined,
    ...overrides,
  };
}

// Stub BagsAdapter — only needed for PipelineEngine dep, not exercised in these tests
function stubBagsAdapter(): BagsAdapter {
  const notImplemented = () => Promise.reject(new Error('Not implemented in integration test'));
  return {
    getClaimablePositions: notImplemented,
    getClaimTransactions: notImplemented,
    getTradeQuote: notImplemented,
    createSwapTransaction: notImplemented,
    prepareSwap: notImplemented,
    getTotalClaimableSol: notImplemented,
    getRateLimitStatus: () => ({ remaining: 100, limit: 100, resetAt: Date.now() + 60_000 }),
  };
}

// ─── Test Suite ────────────────────────────────────────────────

describe('Integration: Full App Stack', () => {
  let db: Database;
  let app: FastifyInstance;

  beforeEach(async () => {
    const config = makeConfig();
    db = new Database(':memory:');
    const conn = await db.connect();
    await db.runMigrations();

    const strategyService = createStrategyService(conn);
    const runService = createRunService(conn);
    const auditService = createAuditService(conn);
    const travelBalanceService = createTravelBalanceService(conn);
    const giftCardService = createGiftCardService(conn);
    const executionPolicy = createExecutionPolicy(config, conn);
    const bags = stubBagsAdapter();

    const pipelineEngine = createPipelineEngine({
      runService,
      strategyService,
      auditService,
      executionPolicy,
      bags,
      config,
    });

    const runLock = createRunLock();

    const deps: RouteDeps = {
      strategyService,
      runService,
      travelBalanceService,
      giftCardService,
      pipelineEngine,
      runLock,
      db: conn,
      config,
    };

    app = await buildApp(deps);
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  // ── Health Endpoints ──

  it('GET /health/live returns 200', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/live' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('GET /health/ready returns 200 with DB ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ready');
    expect(body.checks.database.status).toBe('ok');
  });

  // ── Auth ──

  it('GET /api/strategies without token returns 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/strategies' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /api/strategies with wrong token returns 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/strategies',
      headers: { authorization: 'Bearer wrong-token' },
    });
    expect(res.statusCode).toBe(401);
  });

  // ── Strategies CRUD ──

  it('GET /api/strategies returns empty array initially', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/strategies',
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('POST /api/strategies creates a strategy and GET returns it', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/strategies',
      headers: {
        authorization: `Bearer ${TEST_TOKEN}`,
        'content-type': 'application/json',
      },
      payload: {
        name: 'Integration Test Strategy',
        ownerWallet: 'WalletAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        tokenMint: 'MintBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const created = createRes.json();
    expect(created.name).toBe('Integration Test Strategy');
    expect(created.strategyId).toBeDefined();

    // Verify it appears in the list
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/strategies',
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
    });
    expect(listRes.statusCode).toBe(200);
    const strategies = listRes.json();
    expect(strategies).toHaveLength(1);
    expect(strategies[0].name).toBe('Integration Test Strategy');
  });

  // ── Security Headers ──

  it('responses include security headers', async () => {
    const res = await app.inject({ method: 'GET', url: '/health/live' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['x-xss-protection']).toBe('0');
    expect(res.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
  });

  // ── CORS ──

  it('OPTIONS request returns CORS headers', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/health/live',
      headers: {
        origin: 'http://localhost:3000',
        'access-control-request-method': 'GET',
      },
    });
    // With origin: true (no configured origins), all origins are allowed
    expect(res.headers['access-control-allow-origin']).toBeDefined();
  });
});
