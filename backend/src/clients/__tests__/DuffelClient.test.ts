import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createDuffelClient,
  classifyError,
  mapOffer,
  mapSlice,
  mapSegment,
  countStops,
} from '../DuffelClient.js';
import type { DuffelClientAdapter, CachedOfferResult, FlightSearchParams, CreateOrderParams, PassengerDetails } from '../../types/index.js';

// ─── SDK Mocks ─────────────────────────────────────────────────

const mockOfferRequestsCreate = vi.fn();
const mockOrdersCreate = vi.fn();

vi.mock('@duffel/api', () => {
  class MockDuffel {
    offerRequests = {
      create: mockOfferRequestsCreate,
    };
    orders = {
      create: mockOrdersCreate,
    };
  }

  class MockDuffelError extends Error {
    meta: { status?: number; request_id?: string };
    constructor(
      msg: string,
      meta: { status?: number; request_id?: string } = {},
    ) {
      super(msg);
      this.name = 'DuffelError';
      this.meta = meta;
    }
  }

  return { Duffel: MockDuffel, DuffelError: MockDuffelError };
});

// Dynamically import mocked DuffelError for test assertions
const { DuffelError: MockedDuffelError } = await import('@duffel/api');

// ─── Test Fixtures ─────────────────────────────────────────────

const BASE_PARAMS: FlightSearchParams = {
  origin: 'JFK',
  destination: 'LAX',
  departureDate: '2026-06-15',
  passengers: 1,
  cabinClass: 'economy',
};

function makeRawOffer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'off_test_001',
    total_amount: '199.99',
    total_currency: 'USD',
    expires_at: '2026-06-15T12:00:00Z',
    owner: { name: 'Delta Air Lines', iata_code: 'DL' },
    slices: [
      {
        origin: { iata_code: 'JFK' },
        destination: { iata_code: 'LAX' },
        duration: 'PT5H30M',
        segments: [
          {
            origin: { iata_code: 'JFK' },
            destination: { iata_code: 'LAX' },
            departing_at: '2026-06-15T08:00:00',
            arriving_at: '2026-06-15T11:30:00',
            marketing_carrier: { name: 'Delta Air Lines', iata_code: 'DL' },
            marketing_carrier_flight_number: '1234',
            duration: 'PT5H30M',
            aircraft: { name: 'Boeing 737-800' },
            passengers: [{ cabin_class: 'economy' }],
          },
        ],
      },
    ],
    ...overrides,
  };
}

function makeOfferRequestResponse(
  offers: Record<string, unknown>[] = [makeRawOffer()],
  requestId = 'orq_test_001',
) {
  return {
    data: {
      id: requestId,
      offers,
      slices: [],
      passengers: [],
      created_at: '2026-06-15T10:00:00Z',
    },
  };
}

// ─── Tests ─────────────────────────────────────────────────────

describe('DuffelClient', () => {
  let client: DuffelClientAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T10:00:00Z'));
    client = createDuffelClient({ apiToken: 'test_token', cacheTtlMs: 15 * 60 * 1000, retryBaseDelayMs: 0 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ─── Factory Validation ──────────────────────────────────────

  describe('createDuffelClient()', () => {
    it('throws on empty apiToken', () => {
      expect(() => createDuffelClient({ apiToken: '' })).toThrow(
        'DuffelClient: apiToken is required',
      );
    });
  });

  // ─── searchFlights ───────────────────────────────────────────

  describe('searchFlights()', () => {
    it('creates offer request and returns sorted offers', async () => {
      const cheapOffer = makeRawOffer({ id: 'off_cheap', total_amount: '99.00' });
      const expensiveOffer = makeRawOffer({ id: 'off_expensive', total_amount: '499.00' });
      const midOffer = makeRawOffer({ id: 'off_mid', total_amount: '199.00' });

      mockOfferRequestsCreate.mockResolvedValueOnce(
        makeOfferRequestResponse([expensiveOffer, midOffer, cheapOffer]),
      );

      const result = await client.searchFlights(BASE_PARAMS);

      expect(result.requestId).toBe('orq_test_001');
      expect(result.offers).toHaveLength(3);
      // Sorted by totalAmount ascending
      expect(result.offers[0].id).toBe('off_cheap');
      expect(result.offers[0].totalAmount).toBe('99.00');
      expect(result.offers[1].id).toBe('off_mid');
      expect(result.offers[2].id).toBe('off_expensive');
      expect(result.cached).toBe(false);
    });

    it('passes correct slices for one-way search', async () => {
      mockOfferRequestsCreate.mockResolvedValueOnce(makeOfferRequestResponse());

      await client.searchFlights({ ...BASE_PARAMS, returnDate: undefined });

      expect(mockOfferRequestsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          slices: [
            { origin: 'JFK', destination: 'LAX', departure_date: '2026-06-15', arrival_time: null, departure_time: null },
          ],
          passengers: [{ type: 'adult' }],
          cabin_class: 'economy',
          return_offers: true,
        }),
      );
    });

    it('passes correct slices for round-trip search', async () => {
      mockOfferRequestsCreate.mockResolvedValueOnce(makeOfferRequestResponse());

      await client.searchFlights({ ...BASE_PARAMS, returnDate: '2026-06-22' });

      const callArgs = mockOfferRequestsCreate.mock.calls[0][0];
      expect(callArgs.slices).toHaveLength(2);
      expect(callArgs.slices[0]).toEqual({
        origin: 'JFK',
        destination: 'LAX',
        departure_date: '2026-06-15',
        arrival_time: null,
        departure_time: null,
      });
      expect(callArgs.slices[1]).toEqual({
        origin: 'LAX',
        destination: 'JFK',
        departure_date: '2026-06-22',
        arrival_time: null,
        departure_time: null,
      });
    });

    it('passes correct number of passengers', async () => {
      mockOfferRequestsCreate.mockResolvedValueOnce(makeOfferRequestResponse());

      await client.searchFlights({ ...BASE_PARAMS, passengers: 3 });

      const callArgs = mockOfferRequestsCreate.mock.calls[0][0];
      expect(callArgs.passengers).toHaveLength(3);
      expect(callArgs.passengers).toEqual([
        { type: 'adult' },
        { type: 'adult' },
        { type: 'adult' },
      ]);
    });

    it('uses custom cabin class', async () => {
      mockOfferRequestsCreate.mockResolvedValueOnce(makeOfferRequestResponse());

      await client.searchFlights({ ...BASE_PARAMS, cabinClass: 'business' });

      const callArgs = mockOfferRequestsCreate.mock.calls[0][0];
      expect(callArgs.cabin_class).toBe('business');
    });

    it('defaults cabin class to economy', async () => {
      mockOfferRequestsCreate.mockResolvedValueOnce(makeOfferRequestResponse());

      const { cabinClass, ...paramsNoCabin } = BASE_PARAMS;
      await client.searchFlights(paramsNoCabin as FlightSearchParams);

      const callArgs = mockOfferRequestsCreate.mock.calls[0][0];
      expect(callArgs.cabin_class).toBe('economy');
    });

    it('returns empty offers array when no offers returned', async () => {
      mockOfferRequestsCreate.mockResolvedValueOnce(makeOfferRequestResponse([]));

      const result = await client.searchFlights(BASE_PARAMS);

      expect(result.offers).toEqual([]);
      expect(result.requestId).toBe('orq_test_001');
    });

    it('includes expiresAt and createdAt timestamps', async () => {
      mockOfferRequestsCreate.mockResolvedValueOnce(makeOfferRequestResponse());

      const result = await client.searchFlights(BASE_PARAMS);

      expect(result.expiresAt).toBeDefined();
      expect(result.createdAt).toBeDefined();
      // Expires at is 15 minutes from now
      const expiresMs = new Date(result.expiresAt).getTime();
      const createdMs = new Date(result.createdAt).getTime();
      expect(expiresMs - createdMs).toBe(15 * 60 * 1000);
    });
  });

  // ─── Input Validation ────────────────────────────────────────

  describe('input validation', () => {
    it('throws on empty origin', async () => {
      await expect(
        client.searchFlights({ ...BASE_PARAMS, origin: '' }),
      ).rejects.toThrow('DuffelClient: origin is required');
    });

    it('throws on empty destination', async () => {
      await expect(
        client.searchFlights({ ...BASE_PARAMS, destination: '' }),
      ).rejects.toThrow('DuffelClient: destination is required');
    });

    it('throws on empty departureDate', async () => {
      await expect(
        client.searchFlights({ ...BASE_PARAMS, departureDate: '' }),
      ).rejects.toThrow('DuffelClient: departureDate is required');
    });

    it('throws on zero passengers', async () => {
      await expect(
        client.searchFlights({ ...BASE_PARAMS, passengers: 0 }),
      ).rejects.toThrow('DuffelClient: passengers must be at least 1');
    });

    it('throws on negative passengers', async () => {
      await expect(
        client.searchFlights({ ...BASE_PARAMS, passengers: -1 }),
      ).rejects.toThrow('DuffelClient: passengers must be at least 1');
    });
  });

  // ─── Cache Behavior ──────────────────────────────────────────

  describe('caching', () => {
    it('caches results after search and returns on getCachedOffers', async () => {
      mockOfferRequestsCreate.mockResolvedValueOnce(makeOfferRequestResponse());

      const searchResult = await client.searchFlights(BASE_PARAMS);
      const cached = client.getCachedOffers(searchResult.requestId);

      expect(cached).not.toBeNull();
      expect(cached!.requestId).toBe(searchResult.requestId);
      expect(cached!.cached).toBe(true);
      expect(cached!.offers).toEqual(searchResult.offers);
    });

    it('returns null for unknown requestId', () => {
      const result = client.getCachedOffers('nonexistent_id');
      expect(result).toBeNull();
    });

    it('returns null for expired cache entries', async () => {
      mockOfferRequestsCreate.mockResolvedValueOnce(makeOfferRequestResponse());

      const searchResult = await client.searchFlights(BASE_PARAMS);

      // Advance time past TTL
      vi.advanceTimersByTime(15 * 60 * 1000 + 1);

      const cached = client.getCachedOffers(searchResult.requestId);
      expect(cached).toBeNull();
    });

    it('returns cached result within TTL', async () => {
      mockOfferRequestsCreate.mockResolvedValueOnce(makeOfferRequestResponse());

      const searchResult = await client.searchFlights(BASE_PARAMS);

      // Advance time but stay within TTL
      vi.advanceTimersByTime(14 * 60 * 1000);

      const cached = client.getCachedOffers(searchResult.requestId);
      expect(cached).not.toBeNull();
      expect(cached!.requestId).toBe(searchResult.requestId);
    });

    it('clearCache removes all entries', async () => {
      mockOfferRequestsCreate
        .mockResolvedValueOnce(makeOfferRequestResponse([], 'orq_1'))
        .mockResolvedValueOnce(makeOfferRequestResponse([], 'orq_2'));

      const r1 = await client.searchFlights(BASE_PARAMS);
      const r2 = await client.searchFlights(BASE_PARAMS);

      client.clearCache();

      expect(client.getCachedOffers(r1.requestId)).toBeNull();
      expect(client.getCachedOffers(r2.requestId)).toBeNull();
    });

    it('uses custom cacheTtlMs', async () => {
      const shortTtl = createDuffelClient({ apiToken: 'test', cacheTtlMs: 5000 });
      mockOfferRequestsCreate.mockResolvedValueOnce(makeOfferRequestResponse());

      const result = await shortTtl.searchFlights(BASE_PARAMS);

      // Within 5s — should be cached
      vi.advanceTimersByTime(4000);
      expect(shortTtl.getCachedOffers(result.requestId)).not.toBeNull();

      // Past 5s — should be expired
      vi.advanceTimersByTime(2000);
      expect(shortTtl.getCachedOffers(result.requestId)).toBeNull();
    });
  });

  // ─── Retry Logic ─────────────────────────────────────────────

  describe('retry behavior', () => {
    let retryClient: DuffelClientAdapter;

    beforeEach(() => {
      // Use real timers for retry tests — fake timers interfere with async retry loops
      vi.useRealTimers();
      retryClient = createDuffelClient({
        apiToken: 'test_token',
        cacheTtlMs: 15 * 60 * 1000,
        retryBaseDelayMs: 0,
      });
    });

    afterEach(() => {
      // Restore fake timers for remaining tests
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-06-15T10:00:00Z'));
    });

    it('retries on server errors then succeeds', async () => {
      mockOfferRequestsCreate
        .mockRejectedValueOnce(new Error('503 Service Unavailable'))
        .mockResolvedValueOnce(makeOfferRequestResponse());

      const result = await retryClient.searchFlights(BASE_PARAMS);

      expect(result.offers).toHaveLength(1);
      expect(mockOfferRequestsCreate).toHaveBeenCalledTimes(2);
    });

    it('retries on DuffelError with 429 status', async () => {
      const rateLimitErr = new MockedDuffelError('Rate limited', { status: 429 });

      mockOfferRequestsCreate
        .mockRejectedValueOnce(rateLimitErr)
        .mockResolvedValueOnce(makeOfferRequestResponse());

      const result = await retryClient.searchFlights(BASE_PARAMS);

      expect(result.offers).toHaveLength(1);
      expect(mockOfferRequestsCreate).toHaveBeenCalledTimes(2);
    });

    it('does not retry on 400 client errors', async () => {
      mockOfferRequestsCreate.mockRejectedValueOnce(new Error('400 Bad Request'));

      await expect(retryClient.searchFlights(BASE_PARAMS)).rejects.toThrow('400 Bad Request');
      expect(mockOfferRequestsCreate).toHaveBeenCalledTimes(1);
    });

    it('throws after exhausting retries', async () => {
      const err = new Error('500 Internal Server Error');
      mockOfferRequestsCreate
        .mockRejectedValueOnce(err)
        .mockRejectedValueOnce(err)
        .mockRejectedValueOnce(err)
        .mockRejectedValueOnce(err);

      await expect(retryClient.searchFlights(BASE_PARAMS)).rejects.toThrow(
        '500 Internal Server Error',
      );
      expect(mockOfferRequestsCreate).toHaveBeenCalledTimes(4); // initial + 3 retries
    });
  });
});

// ─── Mapping Unit Tests ────────────────────────────────────────

describe('mapOffer', () => {
  it('maps a raw Duffel offer to DuffelOffer', () => {
    const raw = {
      id: 'off_001',
      total_amount: '250.00',
      total_currency: 'GBP',
      expires_at: '2026-06-15T12:00:00Z',
      owner: { name: 'British Airways', iata_code: 'BA' },
      slices: [
        {
          origin: { iata_code: 'LHR' },
          destination: { iata_code: 'JFK' },
          duration: 'PT8H',
          segments: [
            {
              origin: { iata_code: 'LHR' },
              destination: { iata_code: 'JFK' },
              departing_at: '2026-06-15T09:00:00',
              arriving_at: '2026-06-15T12:00:00',
              marketing_carrier: { name: 'British Airways', iata_code: 'BA' },
              marketing_carrier_flight_number: '178',
              duration: 'PT8H',
              aircraft: { name: 'Airbus A380' },
              passengers: [{ cabin_class: 'business' }],
            },
          ],
        },
      ],
    };

    const result = mapOffer(raw);

    expect(result.id).toBe('off_001');
    expect(result.totalAmount).toBe('250.00');
    expect(result.totalCurrency).toBe('GBP');
    expect(result.owner).toBe('British Airways');
    expect(result.ownerIata).toBe('BA');
    expect(result.expiresAt).toBe('2026-06-15T12:00:00Z');
    expect(result.slices).toHaveLength(1);
    expect(result.slices[0].origin).toBe('LHR');
    expect(result.slices[0].destination).toBe('JFK');
    expect(result.totalStops).toBe(0); // 1 segment = 0 stops
    expect(result.cabinClass).toBe('business');
  });

  it('handles offer with connecting flight (2 segments = 1 stop)', () => {
    const raw = {
      id: 'off_002',
      total_amount: '150.00',
      total_currency: 'USD',
      expires_at: '2026-06-15T12:00:00Z',
      owner: { name: 'United', iata_code: 'UA' },
      slices: [
        {
          origin: { iata_code: 'JFK' },
          destination: { iata_code: 'LAX' },
          duration: 'PT8H',
          segments: [
            {
              origin: { iata_code: 'JFK' },
              destination: { iata_code: 'ORD' },
              departing_at: '2026-06-15T08:00:00',
              arriving_at: '2026-06-15T10:00:00',
              marketing_carrier: { name: 'United', iata_code: 'UA' },
              marketing_carrier_flight_number: '100',
              duration: 'PT2H',
              aircraft: { name: 'Boeing 737' },
              passengers: [{ cabin_class: 'economy' }],
            },
            {
              origin: { iata_code: 'ORD' },
              destination: { iata_code: 'LAX' },
              departing_at: '2026-06-15T12:00:00',
              arriving_at: '2026-06-15T14:00:00',
              marketing_carrier: { name: 'United', iata_code: 'UA' },
              marketing_carrier_flight_number: '200',
              duration: 'PT4H',
              aircraft: { name: 'Airbus A320' },
              passengers: [{ cabin_class: 'economy' }],
            },
          ],
        },
      ],
    };

    const result = mapOffer(raw);
    expect(result.totalStops).toBe(1);
    expect(result.slices[0].segments).toHaveLength(2);
  });

  it('handles missing owner and slices gracefully', () => {
    const raw = { id: 'off_003', total_amount: '100.00' };
    const result = mapOffer(raw);

    expect(result.id).toBe('off_003');
    expect(result.owner).toBe('');
    expect(result.ownerIata).toBe('');
    expect(result.slices).toEqual([]);
    expect(result.totalStops).toBe(0);
  });
});

describe('mapSegment', () => {
  it('maps a raw segment to DuffelSegment', () => {
    const raw = {
      origin: { iata_code: 'JFK' },
      destination: { iata_code: 'LAX' },
      departing_at: '2026-06-15T08:00:00',
      arriving_at: '2026-06-15T11:30:00',
      marketing_carrier: { name: 'Delta', iata_code: 'DL' },
      marketing_carrier_flight_number: '1234',
      duration: 'PT5H30M',
      aircraft: { name: 'Boeing 737-800' },
    };

    const result = mapSegment(raw);

    expect(result.origin).toBe('JFK');
    expect(result.destination).toBe('LAX');
    expect(result.departingAt).toBe('2026-06-15T08:00:00');
    expect(result.arrivingAt).toBe('2026-06-15T11:30:00');
    expect(result.carrier).toBe('Delta');
    expect(result.flightNumber).toBe('DL1234');
    expect(result.duration).toBe('PT5H30M');
    expect(result.aircraft).toBe('Boeing 737-800');
  });

  it('handles missing optional fields', () => {
    const raw = {
      origin: { iata_code: 'LHR' },
      destination: { iata_code: 'CDG' },
      departing_at: '2026-07-01T10:00:00',
      arriving_at: '2026-07-01T12:00:00',
    };

    const result = mapSegment(raw);

    expect(result.carrier).toBe('');
    expect(result.flightNumber).toBe('');
    expect(result.duration).toBeNull();
    expect(result.aircraft).toBeNull();
  });
});

describe('mapSlice', () => {
  it('maps a raw slice to DuffelSlice', () => {
    const raw = {
      origin: { iata_code: 'JFK' },
      destination: { iata_code: 'LAX' },
      duration: 'PT5H30M',
      segments: [
        {
          origin: { iata_code: 'JFK' },
          destination: { iata_code: 'LAX' },
          departing_at: '2026-06-15T08:00:00',
          arriving_at: '2026-06-15T11:30:00',
          marketing_carrier: { name: 'Delta', iata_code: 'DL' },
          marketing_carrier_flight_number: '1234',
        },
      ],
    };

    const result = mapSlice(raw);
    expect(result.origin).toBe('JFK');
    expect(result.destination).toBe('LAX');
    expect(result.duration).toBe('PT5H30M');
    expect(result.segments).toHaveLength(1);
  });
});

describe('countStops', () => {
  it('returns 0 for single-segment slices', () => {
    const slices = [
      { origin: 'A', destination: 'B', duration: null, segments: [{ origin: 'A', destination: 'B', departingAt: '', arrivingAt: '', carrier: '', flightNumber: '', duration: null, aircraft: null }] },
    ];
    expect(countStops(slices)).toBe(0);
  });

  it('returns correct count for multi-segment slices', () => {
    const seg = { origin: 'A', destination: 'B', departingAt: '', arrivingAt: '', carrier: '', flightNumber: '', duration: null, aircraft: null };
    const slices = [
      { origin: 'A', destination: 'C', duration: null, segments: [seg, seg, seg] }, // 2 stops
      { origin: 'C', destination: 'A', duration: null, segments: [seg] }, // 0 stops
    ];
    expect(countStops(slices)).toBe(2);
  });
});

describe('classifyError', () => {
  it('classifies DuffelError with status', () => {
    const err = new MockedDuffelError('Validation failed', { status: 422 });

    const result = classifyError(err);

    expect(result.code).toBe('DUFFEL_422');
    expect(result.message).toBe('Validation failed');
    expect(result.retryable).toBe(false);
    expect(result.statusCode).toBe(422);
  });

  it('classifies retryable DuffelError', () => {
    const err = new MockedDuffelError('Server error', { status: 500 });

    const result = classifyError(err);

    expect(result.code).toBe('DUFFEL_500');
    expect(result.retryable).toBe(true);
  });

  it('classifies generic Error', () => {
    const err = new Error('ECONNREFUSED');

    const result = classifyError(err);

    expect(result.code).toBe('DUFFEL_ERROR');
    expect(result.message).toBe('ECONNREFUSED');
    expect(result.retryable).toBe(true);
  });

  it('classifies unknown errors', () => {
    const result = classifyError('string error');

    expect(result.code).toBe('DUFFEL_UNKNOWN');
    expect(result.retryable).toBe(false);
  });
});

// ─── createOrder Tests ─────────────────────────────────────────

const TEST_PASSENGER: PassengerDetails = {
  givenName: 'John',
  familyName: 'Doe',
  bornOn: '1990-01-15',
  email: 'john@example.com',
  phoneNumber: '+1234567890',
  gender: 'male',
};

const BASE_ORDER_PARAMS: CreateOrderParams = {
  offerId: 'off_test_001',
  passengers: [TEST_PASSENGER],
  amount: 199.99,
  currency: 'USD',
  metadata: { strategyId: '1' },
};

function makeOrderResponse(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      id: 'ord_test_001',
      booking_reference: 'ABC123',
      total_amount: '199.99',
      total_currency: 'USD',
      created_at: '2026-06-15T10:05:00Z',
      ...overrides,
    },
  };
}

describe('createOrder', () => {
  let orderClient: DuffelClientAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    orderClient = createDuffelClient({
      apiToken: 'test_token',
      retryBaseDelayMs: 0,
    });
  });

  it('creates order and returns DuffelOrder', async () => {
    mockOrdersCreate.mockResolvedValueOnce(makeOrderResponse());

    const result = await orderClient.createOrder(BASE_ORDER_PARAMS);

    expect(result.id).toBe('ord_test_001');
    expect(result.bookingReference).toBe('ABC123');
    expect(result.totalAmount).toBe('199.99');
    expect(result.totalCurrency).toBe('USD');
    expect(result.passengers).toEqual([TEST_PASSENGER]);
    expect(result.createdAt).toBe('2026-06-15T10:05:00Z');
  });

  it('passes correct payload to Duffel SDK', async () => {
    mockOrdersCreate.mockResolvedValueOnce(makeOrderResponse());

    await orderClient.createOrder(BASE_ORDER_PARAMS);

    expect(mockOrdersCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'instant',
        selected_offers: ['off_test_001'],
        payments: [{ type: 'balance', amount: '199.99', currency: 'USD' }],
        metadata: { strategyId: '1' },
      }),
    );

    // Check passenger mapping
    const callArgs = mockOrdersCreate.mock.calls[0][0];
    expect(callArgs.passengers[0]).toEqual(
      expect.objectContaining({
        given_name: 'John',
        family_name: 'Doe',
        born_on: '1990-01-15',
        email: 'john@example.com',
        phone_number: '+1234567890',
        gender: 'm',
        type: 'adult',
      }),
    );
  });

  it('retries on 500 server error then succeeds', async () => {
    mockOrdersCreate
      .mockRejectedValueOnce(new Error('500 Internal Server Error'))
      .mockResolvedValueOnce(makeOrderResponse());

    const result = await orderClient.createOrder(BASE_ORDER_PARAMS);

    expect(result.id).toBe('ord_test_001');
    expect(mockOrdersCreate).toHaveBeenCalledTimes(2);
  });

  it('does not retry on 422 client error', async () => {
    const err = new MockedDuffelError('Invalid offer', { status: 422 });
    mockOrdersCreate.mockRejectedValueOnce(err);

    await expect(orderClient.createOrder(BASE_ORDER_PARAMS)).rejects.toThrow('Invalid offer');
    expect(mockOrdersCreate).toHaveBeenCalledTimes(1);
  });

  it('throws after exhausting retries on server errors', async () => {
    const err = new Error('500 Internal Server Error');
    mockOrdersCreate
      .mockRejectedValueOnce(err)
      .mockRejectedValueOnce(err)
      .mockRejectedValueOnce(err)
      .mockRejectedValueOnce(err);

    await expect(orderClient.createOrder(BASE_ORDER_PARAMS)).rejects.toThrow(
      '500 Internal Server Error',
    );
    expect(mockOrdersCreate).toHaveBeenCalledTimes(4);
  });

  it('throws on empty offerId', async () => {
    await expect(
      orderClient.createOrder({ ...BASE_ORDER_PARAMS, offerId: '' }),
    ).rejects.toThrow('DuffelClient: offerId is required');
  });

  it('throws on empty passengers array', async () => {
    await expect(
      orderClient.createOrder({ ...BASE_ORDER_PARAMS, passengers: [] }),
    ).rejects.toThrow('DuffelClient: at least one passenger is required');
  });
});
