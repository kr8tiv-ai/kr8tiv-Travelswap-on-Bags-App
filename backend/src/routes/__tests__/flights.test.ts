// ─── Flight Search Route Tests ─────────────────────────────────
// Integration tests for POST /api/flights/search and GET /api/flights/offers/:requestId
// using a mock DuffelClientAdapter.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerAllRoutes, type RouteDeps } from '../index.js';
import type { StrategyService } from '../../services/StrategyService.js';
import type { RunService } from '../../services/RunService.js';
import type { TravelBalanceService } from '../../services/TravelBalanceService.js';
import type { GiftCardService } from '../../services/GiftCardService.js';
import type { PipelineEngine } from '../../engine/types.js';
import type { RunLock } from '../../engine/RunLock.js';
import type { DatabaseConnection } from '../../services/Database.js';
import type { Config } from '../../config/index.js';
import type { DuffelClientAdapter, CachedOfferResult, DuffelOffer } from '../../types/index.js';

// ─── Test Fixtures ─────────────────────────────────────────────

const TEST_TOKEN = 'test-auth-token-flights';

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
  id: 'off_00009htYpSCXrwaB9DnUm0',
  totalAmount: '245.50',
  totalCurrency: 'USD',
  owner: 'American Airlines',
  ownerIata: 'AA',
  expiresAt: '2026-04-01T12:00:00.000Z',
  slices: [
    {
      origin: 'JFK',
      destination: 'LAX',
      duration: 'PT5H30M',
      segments: [
        {
          origin: 'JFK',
          destination: 'LAX',
          departingAt: '2026-04-15T08:00:00',
          arrivingAt: '2026-04-15T11:30:00',
          carrier: 'American Airlines',
          flightNumber: 'AA123',
          duration: 'PT5H30M',
          aircraft: 'Boeing 737-800',
        },
      ],
    },
  ],
  totalStops: 0,
  cabinClass: 'economy',
};

const mockCachedResult: CachedOfferResult = {
  requestId: 'orq_00009hjdomFOCJyxHG7k7k',
  offers: [mockOffer],
  expiresAt: '2026-04-01T12:00:00.000Z',
  createdAt: '2026-03-30T12:00:00.000Z',
  cached: false,
};

// ─── Mock Helpers ──────────────────────────────────────────────

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
    getByStrategyAndWallet: vi.fn().mockReturnValue(null),
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

  return {
    strategyService,
    runService,
    travelBalanceService,
    giftCardService,
    pipelineEngine,
    runLock,
    db,
    config: makeConfig(),
    ...overrides,
  };
}

function authHeaders() {
  return { authorization: `Bearer ${TEST_TOKEN}` };
}

function createMockDuffelClient(overrides: Partial<DuffelClientAdapter> = {}): DuffelClientAdapter {
  return {
    searchFlights: vi.fn().mockResolvedValue(mockCachedResult),
    getCachedOffers: vi.fn().mockReturnValue(null),
    clearCache: vi.fn(),
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────

describe('Flight Search Routes', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  // ── POST /api/flights/search ─────────────────────────────────

  describe('POST /api/flights/search', () => {
    it('returns search results with requestId, offers, and expiresAt', async () => {
      const duffelClient = createMockDuffelClient();
      app = Fastify({ logger: false });
      await registerAllRoutes(app, createStubDeps({ duffelClient }));

      const response = await app.inject({
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

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.requestId).toBe('orq_00009hjdomFOCJyxHG7k7k');
      expect(body.offers).toHaveLength(1);
      expect(body.offers[0].id).toBe('off_00009htYpSCXrwaB9DnUm0');
      expect(body.expiresAt).toBe('2026-04-01T12:00:00.000Z');

      // Verify DuffelClient was called with correct params
      expect(duffelClient.searchFlights).toHaveBeenCalledWith({
        origin: 'JFK',
        destination: 'LAX',
        departureDate: '2026-04-15',
        returnDate: undefined,
        passengers: 1,
        cabinClass: undefined,
      });
    });

    it('accepts optional returnDate and cabinClass', async () => {
      const duffelClient = createMockDuffelClient();
      app = Fastify({ logger: false });
      await registerAllRoutes(app, createStubDeps({ duffelClient }));

      const response = await app.inject({
        method: 'POST',
        url: '/api/flights/search',
        headers: authHeaders(),
        payload: {
          origin: 'lhr',
          destination: 'cdg',
          departureDate: '2026-05-01',
          returnDate: '2026-05-08',
          passengers: 2,
          cabinClass: 'business',
        },
      });

      expect(response.statusCode).toBe(200);
      // Verify origin/destination are uppercased
      expect(duffelClient.searchFlights).toHaveBeenCalledWith({
        origin: 'LHR',
        destination: 'CDG',
        departureDate: '2026-05-01',
        returnDate: '2026-05-08',
        passengers: 2,
        cabinClass: 'business',
      });
    });

    it('returns 400 for missing required fields', async () => {
      const duffelClient = createMockDuffelClient();
      app = Fastify({ logger: false });
      await registerAllRoutes(app, createStubDeps({ duffelClient }));

      const response = await app.inject({
        method: 'POST',
        url: '/api/flights/search',
        headers: authHeaders(),
        payload: {
          origin: 'JFK',
          // missing destination and departureDate
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error).toContain('Validation failed');
    });

    it('returns 400 for invalid departureDate format', async () => {
      const duffelClient = createMockDuffelClient();
      app = Fastify({ logger: false });
      await registerAllRoutes(app, createStubDeps({ duffelClient }));

      const response = await app.inject({
        method: 'POST',
        url: '/api/flights/search',
        headers: authHeaders(),
        payload: {
          origin: 'JFK',
          destination: 'LAX',
          departureDate: '15/04/2026', // wrong format
          passengers: 1,
        },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error).toContain('YYYY-MM-DD');
    });

    it('returns 400 for invalid passengers count', async () => {
      const duffelClient = createMockDuffelClient();
      app = Fastify({ logger: false });
      await registerAllRoutes(app, createStubDeps({ duffelClient }));

      const response = await app.inject({
        method: 'POST',
        url: '/api/flights/search',
        headers: authHeaders(),
        payload: {
          origin: 'JFK',
          destination: 'LAX',
          departureDate: '2026-04-15',
          passengers: 15, // max is 9
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 502 when DuffelClient throws', async () => {
      const duffelClient = createMockDuffelClient({
        searchFlights: vi.fn().mockRejectedValue(new Error('Duffel API timeout')),
      });
      app = Fastify({ logger: false });
      await registerAllRoutes(app, createStubDeps({ duffelClient }));

      const response = await app.inject({
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

      expect(response.statusCode).toBe(502);
      const body = response.json();
      expect(body.error).toContain('Duffel API timeout');
    });

    it('returns 503 when DuffelClient is not configured', async () => {
      app = Fastify({ logger: false });
      // No duffelClient provided
      await registerAllRoutes(app, createStubDeps());

      const response = await app.inject({
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

      expect(response.statusCode).toBe(503);
      const body = response.json();
      expect(body.error).toContain('not configured');
    });

    it('returns 401 without auth token', async () => {
      const duffelClient = createMockDuffelClient();
      app = Fastify({ logger: false });
      await registerAllRoutes(app, createStubDeps({ duffelClient }));

      const response = await app.inject({
        method: 'POST',
        url: '/api/flights/search',
        // no auth header
        payload: {
          origin: 'JFK',
          destination: 'LAX',
          departureDate: '2026-04-15',
          passengers: 1,
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  // ── GET /api/flights/offers/:requestId ───────────────────────

  describe('GET /api/flights/offers/:requestId', () => {
    it('returns cached offers when available', async () => {
      const cachedResult: CachedOfferResult = {
        ...mockCachedResult,
        cached: true,
      };
      const duffelClient = createMockDuffelClient({
        getCachedOffers: vi.fn().mockReturnValue(cachedResult),
      });
      app = Fastify({ logger: false });
      await registerAllRoutes(app, createStubDeps({ duffelClient }));

      const response = await app.inject({
        method: 'GET',
        url: '/api/flights/offers/orq_00009hjdomFOCJyxHG7k7k',
        headers: authHeaders(),
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.requestId).toBe('orq_00009hjdomFOCJyxHG7k7k');
      expect(body.offers).toHaveLength(1);
      expect(body.expiresAt).toBe('2026-04-01T12:00:00.000Z');
    });

    it('returns 404 with re_search prompt when offers expired', async () => {
      const duffelClient = createMockDuffelClient({
        getCachedOffers: vi.fn().mockReturnValue(null), // expired
      });
      app = Fastify({ logger: false });
      await registerAllRoutes(app, createStubDeps({ duffelClient }));

      const response = await app.inject({
        method: 'GET',
        url: '/api/flights/offers/orq_expired_request',
        headers: authHeaders(),
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.error).toContain('expired');
      expect(body.re_search).toBe(true);
    });

    it('returns 503 when DuffelClient is not configured', async () => {
      app = Fastify({ logger: false });
      await registerAllRoutes(app, createStubDeps());

      const response = await app.inject({
        method: 'GET',
        url: '/api/flights/offers/orq_some_request',
        headers: authHeaders(),
      });

      expect(response.statusCode).toBe(503);
    });

    it('returns 401 without auth token', async () => {
      const duffelClient = createMockDuffelClient();
      app = Fastify({ logger: false });
      await registerAllRoutes(app, createStubDeps({ duffelClient }));

      const response = await app.inject({
        method: 'GET',
        url: '/api/flights/offers/orq_test',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  // ── Full Flow: Search → Cache Hit → Expiry → 404 ────────────

  describe('Full search → cache → expiry flow', () => {
    it('search returns offers, get returns cache hit, after expiry returns 404', async () => {
      let cacheHasData = true;

      const duffelClient = createMockDuffelClient({
        searchFlights: vi.fn().mockResolvedValue(mockCachedResult),
        getCachedOffers: vi.fn().mockImplementation((requestId: string) => {
          if (!cacheHasData) return null;
          if (requestId === mockCachedResult.requestId) {
            return { ...mockCachedResult, cached: true };
          }
          return null;
        }),
      });

      app = Fastify({ logger: false });
      await registerAllRoutes(app, createStubDeps({ duffelClient }));

      // 1. Search — returns offers
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
      const { requestId } = searchBody;
      expect(requestId).toBe('orq_00009hjdomFOCJyxHG7k7k');
      expect(searchBody.offers).toHaveLength(1);

      // 2. Cache hit — same requestId returns offers
      const cacheRes = await app.inject({
        method: 'GET',
        url: `/api/flights/offers/${requestId}`,
        headers: authHeaders(),
      });
      expect(cacheRes.statusCode).toBe(200);
      const cacheBody = cacheRes.json();
      expect(cacheBody.requestId).toBe(requestId);
      expect(cacheBody.offers).toHaveLength(1);

      // 3. Simulate TTL expiry — cache returns null
      cacheHasData = false;

      const expiredRes = await app.inject({
        method: 'GET',
        url: `/api/flights/offers/${requestId}`,
        headers: authHeaders(),
      });
      expect(expiredRes.statusCode).toBe(404);
      const expiredBody = expiredRes.json();
      expect(expiredBody.re_search).toBe(true);
      expect(expiredBody.error).toContain('expired');
    });
  });
});
