// ─── Booking Route Tests ───────────────────────────────────────
// Tests for POST /api/bookings/book, GET /api/bookings, GET /api/bookings/:id
// using mock DuffelClient and mock BookingService/TravelBalanceService.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerAllRoutes, type RouteDeps } from '../index.js';
import type { StrategyService } from '../../services/StrategyService.js';
import type { RunService } from '../../services/RunService.js';
import type { TravelBalanceService } from '../../services/TravelBalanceService.js';
import type { GiftCardService } from '../../services/GiftCardService.js';
import type { BookingService } from '../../services/BookingService.js';
import type { PipelineEngine } from '../../engine/types.js';
import type { RunLock } from '../../engine/RunLock.js';
import type { DatabaseConnection } from '../../services/Database.js';
import type { Config } from '../../config/index.js';
import type {
  DuffelClientAdapter,
  CachedOfferResult,
  DuffelOffer,
  DuffelOrder,
  Booking,
  TravelBalance,
} from '../../types/index.js';

// ─── Test Fixtures ─────────────────────────────────────────────

const TEST_TOKEN = 'test-auth-token-bookings';

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
    feeThresholdSol: 5,
    feeSource: 'CLAIMABLE_POSITIONS' as const,
    swapSlippageBps: 50,
    distributionMode: 'TOP_N_HOLDERS' as const,
    distributionTopN: 100,
    creditMode: 'GIFT_CARD' as const,
    cronExpression: '0 */6 * * *',
    port: 3001,
    databasePath: ':memory:',
    logLevel: 'error' as const,
    nodeEnv: 'test' as const,
    corsOrigins: '',
    duffelApiToken: 'duffel_test_token',
    ...overrides,
  };
}

const mockOffer: DuffelOffer = {
  id: 'off_booking_test_001',
  totalAmount: '245.50',
  totalCurrency: 'USD',
  owner: 'American Airlines',
  ownerIata: 'AA',
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
      carrier: 'American Airlines',
      flightNumber: 'AA123',
      duration: 'PT5H30M',
      aircraft: 'Boeing 737-800',
    }],
  }],
  totalStops: 0,
  cabinClass: 'economy',
};

const mockCached: CachedOfferResult = {
  requestId: 'orq_booking_test',
  offers: [mockOffer],
  expiresAt: '2026-04-01T12:00:00.000Z',
  createdAt: '2026-03-30T12:00:00.000Z',
  cached: true,
};

const mockDuffelOrder: DuffelOrder = {
  id: 'ord_duffel_001',
  bookingReference: 'ABC123',
  totalAmount: '245.50',
  totalCurrency: 'USD',
  passengers: [{
    givenName: 'John',
    familyName: 'Doe',
    bornOn: '1990-01-15',
    email: 'john@example.com',
    phoneNumber: '+1234567890',
    gender: 'male',
  }],
  createdAt: '2026-03-30T12:00:00.000Z',
};

const validPassengers = [{
  givenName: 'John',
  familyName: 'Doe',
  bornOn: '1990-01-15',
  email: 'john@example.com',
  phoneNumber: '+1234567890',
  gender: 'male' as const,
}];

const mockBalance: TravelBalance = {
  balanceId: '1',
  strategyId: '1',
  walletAddress: 'TestWallet123',
  balanceUsd: 500.00,
  totalEarned: 500.00,
  totalSpent: 0,
  createdAt: '2026-03-30T00:00:00.000Z',
  updatedAt: '2026-03-30T00:00:00.000Z',
};

const mockBooking: Booking = {
  id: '1',
  strategyId: '1',
  walletAddress: 'TestWallet123',
  offerId: 'off_booking_test_001',
  duffelOrderId: null,
  bookingReference: null,
  passengers: validPassengers,
  amountUsd: 245.50,
  currency: 'USD',
  status: 'PENDING',
  errorMessage: null,
  createdAt: '2026-03-30T12:00:00.000Z',
  updatedAt: '2026-03-30T12:00:00.000Z',
};

const confirmedBooking: Booking = {
  ...mockBooking,
  status: 'CONFIRMED',
  duffelOrderId: 'ord_duffel_001',
  bookingReference: 'ABC123',
};

// ─── Mock Helpers ──────────────────────────────────────────────

function createMockDuffelClient(overrides: Partial<DuffelClientAdapter> = {}): DuffelClientAdapter {
  return {
    searchFlights: vi.fn().mockResolvedValue(mockCached),
    getCachedOffers: vi.fn().mockReturnValue(mockCached),
    clearCache: vi.fn(),
    createOrder: vi.fn().mockResolvedValue(mockDuffelOrder),
    ...overrides,
  };
}

function createMockBookingService(overrides: Partial<BookingService> = {}): BookingService {
  return {
    create: vi.fn().mockReturnValue(mockBooking),
    getById: vi.fn().mockReturnValue(confirmedBooking),
    getByWallet: vi.fn().mockReturnValue([confirmedBooking]),
    updateStatus: vi.fn().mockReturnValue(confirmedBooking),
    ...overrides,
  };
}

function createStubDeps(overrides: Partial<RouteDeps> = {}): RouteDeps {
  const strategyService = {
    getAll: vi.fn().mockReturnValue([]),
    getById: vi.fn().mockReturnValue(null),
    getActive: vi.fn().mockReturnValue([]),
    create: vi.fn(),
    update: vi.fn(),
  } as unknown as StrategyService;

  const runService = {
    create: vi.fn(),
    getById: vi.fn().mockReturnValue(null),
    getAll: vi.fn().mockReturnValue([]),
    getByStrategyId: vi.fn().mockReturnValue([]),
    updatePhase: vi.fn(),
    markFailed: vi.fn(),
    markComplete: vi.fn(),
    getLatest: vi.fn().mockReturnValue([]),
    getAggregateStats: vi.fn().mockReturnValue({
      totalRuns: 0, completedRuns: 0, failedRuns: 0,
      totalClaimedSol: 0, totalSwappedUsdc: 0, totalAllocatedUsd: 0,
      totalCreditsIssued: 0, totalGiftCardsPurchased: 0,
    }),
  } as unknown as RunService;

  const travelBalanceService = {
    allocate: vi.fn(),
    deduct: vi.fn(),
    getByStrategyAndWallet: vi.fn().mockReturnValue(mockBalance),
    getByStrategy: vi.fn().mockReturnValue([]),
    getTotal: vi.fn().mockReturnValue(0),
  } as unknown as TravelBalanceService;

  const giftCardService = {
    purchase: vi.fn(),
    getByWallet: vi.fn().mockReturnValue([]),
    getByRun: vi.fn().mockReturnValue([]),
    getByStrategy: vi.fn().mockReturnValue([]),
    updateStatus: vi.fn(),
  } as unknown as GiftCardService;

  const pipelineEngine = {
    startRun: vi.fn(),
    resumeRun: vi.fn(),
  } as unknown as PipelineEngine;

  const runLock = {
    acquire: vi.fn().mockReturnValue(true),
    release: vi.fn(),
    isLocked: vi.fn().mockReturnValue(false),
    releaseAll: vi.fn(),
  } as unknown as RunLock;

  const db = {
    run: vi.fn().mockReturnValue({ changes: 0, lastInsertRowid: 0 }),
    get: vi.fn().mockReturnValue({ ok: 1 }),
    all: vi.fn().mockReturnValue([]),
    prepare: vi.fn(),
    exec: vi.fn(),
  } as unknown as DatabaseConnection;

  const duffelClient = createMockDuffelClient();
  const bookingService = createMockBookingService();

  return {
    strategyService,
    runService,
    travelBalanceService,
    giftCardService,
    pipelineEngine,
    runLock,
    db,
    config: makeConfig(),
    duffelClient,
    bookingService,
    ...overrides,
  };
}

function authHeaders() {
  return { authorization: `Bearer ${TEST_TOKEN}` };
}

// ─── Tests ─────────────────────────────────────────────────────

describe('Booking Routes', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  // ── POST /api/bookings/book ──────────────────────────────────

  describe('POST /api/bookings/book', () => {
    it('creates a booking with valid offer, balance, and passengers', async () => {
      const duffelClient = createMockDuffelClient();
      const bookingService = createMockBookingService();
      const travelBalanceService = {
        allocate: vi.fn(),
        deduct: vi.fn(),
        getByStrategyAndWallet: vi.fn().mockReturnValue(mockBalance),
        getByStrategy: vi.fn().mockReturnValue([]),
        getTotal: vi.fn().mockReturnValue(0),
      } as unknown as TravelBalanceService;

      app = Fastify({ logger: false });
      await registerAllRoutes(app, createStubDeps({
        duffelClient,
        bookingService,
        travelBalanceService,
      }));

      const response = await app.inject({
        method: 'POST',
        url: '/api/bookings/book',
        headers: authHeaders(),
        payload: {
          offerId: 'off_booking_test_001',
          requestId: 'orq_booking_test',
          strategyId: 1,
          walletAddress: 'TestWallet123',
          passengers: validPassengers,
        },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.status).toBe('CONFIRMED');
      expect(body.duffelOrderId).toBe('ord_duffel_001');
      expect(body.bookingReference).toBe('ABC123');

      // Verify balance checked before Duffel call
      expect(travelBalanceService.getByStrategyAndWallet).toHaveBeenCalledWith(1, 'TestWallet123');
      // Verify Duffel order was created
      expect(duffelClient.createOrder).toHaveBeenCalled();
      // Verify balance deducted after Duffel call
      expect(travelBalanceService.deduct).toHaveBeenCalledWith(1, 'TestWallet123', 245.50);
      // Verify booking created then confirmed
      expect(bookingService.create).toHaveBeenCalled();
      expect(bookingService.updateStatus).toHaveBeenCalled();
    });

    it('returns 400 for insufficient balance', async () => {
      const travelBalanceService = {
        allocate: vi.fn(),
        deduct: vi.fn(),
        getByStrategyAndWallet: vi.fn().mockReturnValue({
          ...mockBalance,
          balanceUsd: 100.00, // Less than $245.50
        }),
        getByStrategy: vi.fn().mockReturnValue([]),
        getTotal: vi.fn().mockReturnValue(0),
      } as unknown as TravelBalanceService;

      const duffelClient = createMockDuffelClient();

      app = Fastify({ logger: false });
      await registerAllRoutes(app, createStubDeps({ travelBalanceService, duffelClient }));

      const response = await app.inject({
        method: 'POST',
        url: '/api/bookings/book',
        headers: authHeaders(),
        payload: {
          offerId: 'off_booking_test_001',
          requestId: 'orq_booking_test',
          strategyId: 1,
          walletAddress: 'TestWallet123',
          passengers: validPassengers,
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error).toContain('Insufficient balance');
      // Duffel should NOT have been called
      expect(duffelClient.createOrder).not.toHaveBeenCalled();
    });

    it('returns 400 for zero balance (no balance record)', async () => {
      const travelBalanceService = {
        allocate: vi.fn(),
        deduct: vi.fn(),
        getByStrategyAndWallet: vi.fn().mockReturnValue(undefined),
        getByStrategy: vi.fn().mockReturnValue([]),
        getTotal: vi.fn().mockReturnValue(0),
      } as unknown as TravelBalanceService;

      const duffelClient = createMockDuffelClient();

      app = Fastify({ logger: false });
      await registerAllRoutes(app, createStubDeps({ travelBalanceService, duffelClient }));

      const response = await app.inject({
        method: 'POST',
        url: '/api/bookings/book',
        headers: authHeaders(),
        payload: {
          offerId: 'off_booking_test_001',
          requestId: 'orq_booking_test',
          strategyId: 1,
          walletAddress: 'TestWallet123',
          passengers: validPassengers,
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('Insufficient balance');
      expect(duffelClient.createOrder).not.toHaveBeenCalled();
    });

    it('returns 400 with re_search for expired/missing offer request', async () => {
      const duffelClient = createMockDuffelClient({
        getCachedOffers: vi.fn().mockReturnValue(null),
      });

      app = Fastify({ logger: false });
      await registerAllRoutes(app, createStubDeps({ duffelClient }));

      const response = await app.inject({
        method: 'POST',
        url: '/api/bookings/book',
        headers: authHeaders(),
        payload: {
          offerId: 'off_booking_test_001',
          requestId: 'orq_unknown',
          strategyId: 1,
          walletAddress: 'TestWallet123',
          passengers: validPassengers,
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.re_search).toBe(true);
      expect(body.error).toContain('expired');
    });

    it('returns 400 with re_search for unknown offerId', async () => {
      app = Fastify({ logger: false });
      await registerAllRoutes(app, createStubDeps());

      const response = await app.inject({
        method: 'POST',
        url: '/api/bookings/book',
        headers: authHeaders(),
        payload: {
          offerId: 'off_nonexistent',
          requestId: 'orq_booking_test',
          strategyId: 1,
          walletAddress: 'TestWallet123',
          passengers: validPassengers,
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.re_search).toBe(true);
    });

    it('returns 503 when DuffelClient not configured', async () => {
      app = Fastify({ logger: false });
      await registerAllRoutes(app, createStubDeps({
        duffelClient: undefined,
      }));

      const response = await app.inject({
        method: 'POST',
        url: '/api/bookings/book',
        headers: authHeaders(),
        payload: {
          offerId: 'off_booking_test_001',
          requestId: 'orq_booking_test',
          strategyId: 1,
          walletAddress: 'TestWallet123',
          passengers: validPassengers,
        },
      });

      expect(response.statusCode).toBe(503);
      expect(response.json().error).toContain('not configured');
    });

    it('returns 502 when Duffel order creation fails', async () => {
      const duffelClient = createMockDuffelClient({
        createOrder: vi.fn().mockRejectedValue(new Error('Duffel API error')),
      });

      app = Fastify({ logger: false });
      await registerAllRoutes(app, createStubDeps({ duffelClient }));

      const response = await app.inject({
        method: 'POST',
        url: '/api/bookings/book',
        headers: authHeaders(),
        payload: {
          offerId: 'off_booking_test_001',
          requestId: 'orq_booking_test',
          strategyId: 1,
          walletAddress: 'TestWallet123',
          passengers: validPassengers,
        },
      });

      expect(response.statusCode).toBe(502);
      expect(response.json().error).toContain('Duffel API error');
    });

    it('returns 400 for missing offerId', async () => {
      app = Fastify({ logger: false });
      await registerAllRoutes(app, createStubDeps());

      const response = await app.inject({
        method: 'POST',
        url: '/api/bookings/book',
        headers: authHeaders(),
        payload: {
          requestId: 'orq_booking_test',
          strategyId: 1,
          walletAddress: 'TestWallet123',
          passengers: validPassengers,
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('Validation failed');
    });

    it('returns 400 for missing passengers array', async () => {
      app = Fastify({ logger: false });
      await registerAllRoutes(app, createStubDeps());

      const response = await app.inject({
        method: 'POST',
        url: '/api/bookings/book',
        headers: authHeaders(),
        payload: {
          offerId: 'off_booking_test_001',
          requestId: 'orq_booking_test',
          strategyId: 1,
          walletAddress: 'TestWallet123',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('Validation failed');
    });

    it('returns 400 for invalid passenger fields', async () => {
      app = Fastify({ logger: false });
      await registerAllRoutes(app, createStubDeps());

      const response = await app.inject({
        method: 'POST',
        url: '/api/bookings/book',
        headers: authHeaders(),
        payload: {
          offerId: 'off_booking_test_001',
          requestId: 'orq_booking_test',
          strategyId: 1,
          walletAddress: 'TestWallet123',
          passengers: [{
            givenName: 'John',
            // missing familyName, bornOn, etc.
          }],
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('Validation failed');
    });

    it('returns 401 without auth token', async () => {
      app = Fastify({ logger: false });
      await registerAllRoutes(app, createStubDeps());

      const response = await app.inject({
        method: 'POST',
        url: '/api/bookings/book',
        payload: {
          offerId: 'off_booking_test_001',
          requestId: 'orq_booking_test',
          strategyId: 1,
          walletAddress: 'TestWallet123',
          passengers: validPassengers,
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  // ── GET /api/bookings ────────────────────────────────────────

  describe('GET /api/bookings', () => {
    it('returns bookings for a wallet', async () => {
      const bookingService = createMockBookingService();
      app = Fastify({ logger: false });
      await registerAllRoutes(app, createStubDeps({ bookingService }));

      const response = await app.inject({
        method: 'GET',
        url: '/api/bookings?wallet=TestWallet123',
        headers: authHeaders(),
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toHaveLength(1);
      expect(body[0].walletAddress).toBe('TestWallet123');
      expect(bookingService.getByWallet).toHaveBeenCalledWith('TestWallet123');
    });

    it('returns 400 without wallet query param', async () => {
      app = Fastify({ logger: false });
      await registerAllRoutes(app, createStubDeps());

      const response = await app.inject({
        method: 'GET',
        url: '/api/bookings',
        headers: authHeaders(),
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('wallet');
    });

    it('returns empty array for wallet with no bookings', async () => {
      const bookingService = createMockBookingService({
        getByWallet: vi.fn().mockReturnValue([]),
      });
      app = Fastify({ logger: false });
      await registerAllRoutes(app, createStubDeps({ bookingService }));

      const response = await app.inject({
        method: 'GET',
        url: '/api/bookings?wallet=EmptyWallet',
        headers: authHeaders(),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([]);
    });
  });

  // ── GET /api/bookings/:id ────────────────────────────────────

  describe('GET /api/bookings/:id', () => {
    it('returns full booking detail with decrypted PII', async () => {
      const bookingService = createMockBookingService();
      app = Fastify({ logger: false });
      await registerAllRoutes(app, createStubDeps({ bookingService }));

      const response = await app.inject({
        method: 'GET',
        url: '/api/bookings/1',
        headers: authHeaders(),
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.id).toBe('1');
      expect(body.status).toBe('CONFIRMED');
      expect(body.passengers[0].givenName).toBe('John');
      expect(body.passengers[0].email).toBe('john@example.com');
      expect(bookingService.getById).toHaveBeenCalledWith(1);
    });

    it('returns 404 for nonexistent booking', async () => {
      const bookingService = createMockBookingService({
        getById: vi.fn().mockReturnValue(undefined),
      });
      app = Fastify({ logger: false });
      await registerAllRoutes(app, createStubDeps({ bookingService }));

      const response = await app.inject({
        method: 'GET',
        url: '/api/bookings/999',
        headers: authHeaders(),
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error).toContain('not found');
    });

    it('returns 400 for invalid booking ID', async () => {
      app = Fastify({ logger: false });
      await registerAllRoutes(app, createStubDeps());

      const response = await app.inject({
        method: 'GET',
        url: '/api/bookings/abc',
        headers: authHeaders(),
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('Invalid');
    });
  });
});
