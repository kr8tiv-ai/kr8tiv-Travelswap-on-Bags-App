// ─── Booking E2E Integration Test ──────────────────────────────
// Full-stack: real in-memory SQLite, real services (BookingService,
// TravelBalanceService, StrategyService), real Fastify app via
// buildApp. Only DuffelClient is mocked.
// Flow: create strategy → allocate balance → search → book → verify
// booking CONFIRMED, balance deducted, GET /api/bookings returns it.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Database } from '../services/Database.js';
import { createStrategyService, type StrategyService } from '../services/StrategyService.js';
import { createRunService } from '../services/RunService.js';
import { createAuditService } from '../services/AuditService.js';
import { createTravelBalanceService, type TravelBalanceService } from '../services/TravelBalanceService.js';
import { createGiftCardService } from '../services/GiftCardService.js';
import { createBookingService } from '../services/BookingService.js';
import { createExecutionPolicy } from '../engine/ExecutionPolicy.js';
import { createPipelineEngine } from '../engine/PipelineEngine.js';
import { createRunLock } from '../engine/RunLock.js';
import { buildApp } from '../server.js';
import type { Config } from '../config/index.js';
import type { RouteDeps } from '../routes/types.js';
import type {
  BagsAdapter,
  DuffelClientAdapter,
  CachedOfferResult,
  DuffelOffer,
  DuffelOrder,
} from '../types/index.js';

// ─── Test Helpers ──────────────────────────────────────────────

const TEST_TOKEN = 'booking-e2e-test-token';
const ENCRYPTION_KEY = 'a'.repeat(64);

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    bagsApiKey: 'test-bags-key',
    bagsApiBaseUrl: 'https://api.bags.fm',
    heliusApiKey: 'test-helius-key',
    heliusRpcUrl: 'https://mainnet.helius-rpc.com',
    apiAuthToken: TEST_TOKEN,
    giftCardEncryptionKey: ENCRYPTION_KEY,
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
    feeSource: 'CLAIMABLE_POSITIONS' as const,
    swapSlippageBps: 50,
    distributionMode: 'TOP_N_HOLDERS' as const,
    distributionTopN: 100,
    creditMode: 'GIFT_CARD' as const,
    cronExpression: '0 */6 * * *',
    port: 0,
    databasePath: ':memory:',
    logLevel: 'error' as const,
    nodeEnv: 'test' as const,
    corsOrigins: '',
    duffelApiToken: 'duffel_e2e_test_token',
    ...overrides,
  };
}

function stubBagsAdapter(): BagsAdapter {
  const notImplemented = () => Promise.reject(new Error('Not implemented in e2e test'));
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

function authHeaders() {
  return { authorization: `Bearer ${TEST_TOKEN}`, 'content-type': 'application/json' };
}

// ─── Mock DuffelClient ─────────────────────────────────────────

const testOffer: DuffelOffer = {
  id: 'off_e2e_test_001',
  totalAmount: '350.00',
  totalCurrency: 'USD',
  owner: 'Delta Air Lines',
  ownerIata: 'DL',
  expiresAt: '2026-04-01T12:00:00.000Z',
  slices: [{
    origin: 'JFK',
    destination: 'LAX',
    duration: 'PT5H30M',
    segments: [{
      origin: 'JFK',
      destination: 'LAX',
      departingAt: '2026-04-15T08:00:00',
      arrivingAt: '2026-04-15T11:30:00',
      carrier: 'Delta Air Lines',
      flightNumber: 'DL456',
      duration: 'PT5H30M',
      aircraft: 'Boeing 737-900',
    }],
  }],
  totalStops: 0,
  cabinClass: 'economy',
};

const searchResult: CachedOfferResult = {
  requestId: 'orq_e2e_test',
  offers: [testOffer],
  expiresAt: '2026-04-01T12:00:00.000Z',
  createdAt: '2026-03-30T12:00:00.000Z',
  cached: false,
};

const testDuffelOrder: DuffelOrder = {
  id: 'ord_e2e_duffel_001',
  bookingReference: 'E2EREF',
  totalAmount: '350.00',
  totalCurrency: 'USD',
  passengers: [{
    givenName: 'Jane',
    familyName: 'Smith',
    bornOn: '1985-06-20',
    email: 'jane@example.com',
    phoneNumber: '+1987654321',
    gender: 'female',
  }],
  createdAt: '2026-03-30T12:00:00.000Z',
};

function createMockDuffelClient(): DuffelClientAdapter {
  // Store search results in a local cache so getCachedOffers works
  const cache = new Map<string, CachedOfferResult>();

  return {
    searchFlights: vi.fn().mockImplementation(async () => {
      cache.set(searchResult.requestId, searchResult);
      return searchResult;
    }),
    getCachedOffers: vi.fn().mockImplementation((requestId: string) => {
      return cache.get(requestId) ?? null;
    }),
    clearCache: vi.fn().mockImplementation(() => cache.clear()),
    createOrder: vi.fn().mockResolvedValue(testDuffelOrder),
  };
}

// ─── Test Suite ────────────────────────────────────────────────

describe('Booking E2E: search → book → balance deduction → booking record', () => {
  let db: Database;
  let app: FastifyInstance;
  let duffelClient: DuffelClientAdapter;
  let travelBalanceService: TravelBalanceService;
  let strategyService: StrategyService;

  beforeEach(async () => {
    const config = makeConfig();
    db = new Database(':memory:');
    const conn = await db.connect();
    await db.runMigrations();

    strategyService = createStrategyService(conn);
    const runService = createRunService(conn);
    const auditService = createAuditService(conn);
    travelBalanceService = createTravelBalanceService(conn);
    const giftCardService = createGiftCardService(conn);
    const bookingService = createBookingService(conn, ENCRYPTION_KEY);
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
    duffelClient = createMockDuffelClient();

    const deps: RouteDeps = {
      strategyService,
      runService,
      travelBalanceService,
      giftCardService,
      pipelineEngine,
      runLock,
      db: conn,
      config,
      duffelClient,
      bookingService,
    };

    app = await buildApp(deps);
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it('full flow: create strategy → allocate balance → search → book → verify', async () => {
    // 1. Create a strategy via API
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/strategies',
      headers: authHeaders(),
      payload: {
        name: 'E2E Booking Test Strategy',
        ownerWallet: 'E2EWalletAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        tokenMint: 'MintBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const strategy = createRes.json();
    const strategyId = Number(strategy.strategyId);
    const walletAddress = 'E2EWalletAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

    // 2. Allocate travel balance directly via service (no HTTP route for allocate)
    await travelBalanceService.allocate(strategyId, walletAddress, 500.00);

    // 3. Search flights via API
    const searchRes = await app.inject({
      method: 'POST',
      url: '/api/flights/search',
      headers: authHeaders(),
      payload: {
        origin: 'JFK',
        destination: 'LAX',
        departureDate: '2026-04-15',
        passengers: 1,
      },
    });
    expect(searchRes.statusCode).toBe(200);
    const searchBody = searchRes.json();
    expect(searchBody.offers).toHaveLength(1);
    const offerId = searchBody.offers[0].id;
    const requestId = searchBody.requestId;
    expect(offerId).toBe('off_e2e_test_001');

    // 4. Book the flight via API
    const bookRes = await app.inject({
      method: 'POST',
      url: '/api/bookings/book',
      headers: authHeaders(),
      payload: {
        offerId,
        requestId,
        strategyId,
        walletAddress,
        passengers: [{
          givenName: 'Jane',
          familyName: 'Smith',
          bornOn: '1985-06-20',
          email: 'jane@example.com',
          phoneNumber: '+1987654321',
          gender: 'female',
        }],
      },
    });
    expect(bookRes.statusCode).toBe(201);
    const booking = bookRes.json();
    expect(booking.status).toBe('CONFIRMED');
    expect(booking.duffelOrderId).toBe('ord_e2e_duffel_001');
    expect(booking.bookingReference).toBe('E2EREF');
    expect(booking.amountUsd).toBe(350);
    expect(booking.offerId).toBe('off_e2e_test_001');

    // 5. Verify balance was deducted: $500 - $350 = $150
    const balance = await travelBalanceService.getByStrategyAndWallet(strategyId, walletAddress);
    expect(balance).toBeDefined();
    expect(balance!.balanceUsd).toBe(150.00);

    // 6. Verify GET /api/bookings returns the booking (list view)
    const listRes = await app.inject({
      method: 'GET',
      url: `/api/bookings?wallet=${walletAddress}`,
      headers: authHeaders(),
    });
    expect(listRes.statusCode).toBe(200);
    const bookings = listRes.json();
    expect(bookings).toHaveLength(1);
    expect(bookings[0].status).toBe('CONFIRMED');
    // List view returns names-only decryption
    expect(bookings[0].passengers[0].givenName).toBe('Jane');
    expect(bookings[0].passengers[0].familyName).toBe('Smith');
    // Email/phone/dob should be empty in list view
    expect(bookings[0].passengers[0].email).toBe('');

    // 7. Verify GET /api/bookings/:id returns full detail with decrypted PII
    const detailRes = await app.inject({
      method: 'GET',
      url: `/api/bookings/${booking.id}`,
      headers: authHeaders(),
    });
    expect(detailRes.statusCode).toBe(200);
    const detail = detailRes.json();
    expect(detail.passengers[0].email).toBe('jane@example.com');
    expect(detail.passengers[0].phoneNumber).toBe('+1987654321');
    expect(detail.passengers[0].bornOn).toBe('1985-06-20');

    // 8. Verify DuffelClient.createOrder was called correctly
    expect(duffelClient.createOrder).toHaveBeenCalledWith({
      offerId: 'off_e2e_test_001',
      passengers: [{
        givenName: 'Jane',
        familyName: 'Smith',
        bornOn: '1985-06-20',
        email: 'jane@example.com',
        phoneNumber: '+1987654321',
        gender: 'female',
      }],
      amount: 350,
      currency: 'USD',
      metadata: {
        strategyId: String(strategyId),
        walletAddress,
      },
    });
  });

  it('returns 400 for insufficient balance without calling Duffel', async () => {
    // Create strategy
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/strategies',
      headers: authHeaders(),
      payload: {
        name: 'Low Balance Strategy',
        ownerWallet: 'LowBalanceWalletAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        tokenMint: 'MintBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      },
    });
    const strategyId = Number(createRes.json().strategyId);
    const walletAddress = 'LowBalanceWalletAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

    // Allocate only $100 (offer costs $350)
    await travelBalanceService.allocate(strategyId, walletAddress, 100.00);

    // Search first to populate cache
    await app.inject({
      method: 'POST',
      url: '/api/flights/search',
      headers: authHeaders(),
      payload: {
        origin: 'JFK',
        destination: 'LAX',
        departureDate: '2026-04-15',
        passengers: 1,
      },
    });

    // Try to book — should fail with 400
    const bookRes = await app.inject({
      method: 'POST',
      url: '/api/bookings/book',
      headers: authHeaders(),
      payload: {
        offerId: 'off_e2e_test_001',
        requestId: 'orq_e2e_test',
        strategyId,
        walletAddress,
        passengers: [{
          givenName: 'Test',
          familyName: 'User',
          bornOn: '1990-01-01',
          email: 'test@example.com',
          phoneNumber: '+1111111111',
          gender: 'male',
        }],
      },
    });

    expect(bookRes.statusCode).toBe(400);
    expect(bookRes.json().error).toContain('Insufficient balance');

    // Verify DuffelClient.createOrder was NOT called
    expect(duffelClient.createOrder).not.toHaveBeenCalled();

    // Verify balance unchanged at $100
    const balance = await travelBalanceService.getByStrategyAndWallet(strategyId, walletAddress);
    expect(balance!.balanceUsd).toBe(100.00);
  });

  it('returns 400 with re_search when offer request expired', async () => {
    // Create strategy and allocate balance
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/strategies',
      headers: authHeaders(),
      payload: {
        name: 'Expired Offer Strategy',
        ownerWallet: 'ExpiredWalletAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        tokenMint: 'MintBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      },
    });
    const strategyId = Number(createRes.json().strategyId);
    const walletAddress = 'ExpiredWalletAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    await travelBalanceService.allocate(strategyId, walletAddress, 500.00);

    // Don't search first — go straight to booking with unknown requestId
    const bookRes = await app.inject({
      method: 'POST',
      url: '/api/bookings/book',
      headers: authHeaders(),
      payload: {
        offerId: 'off_e2e_test_001',
        requestId: 'orq_nonexistent',
        strategyId,
        walletAddress,
        passengers: [{
          givenName: 'Test',
          familyName: 'User',
          bornOn: '1990-01-01',
          email: 'test@example.com',
          phoneNumber: '+1111111111',
          gender: 'male',
        }],
      },
    });

    expect(bookRes.statusCode).toBe(400);
    expect(bookRes.json().re_search).toBe(true);
  });
});
