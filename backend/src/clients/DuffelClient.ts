// ─── DuffelClient ──────────────────────────────────────────────
// Wraps @duffel/api SDK for flight search with in-memory offer caching.
// Follows the BagsClient factory pattern: retry logic, error classification,
// structured Pino logging.

import { Duffel, DuffelError } from '@duffel/api';
import { logger } from '../logger.js';
import type {
  CabinClass,
  CachedOfferResult,
  CreateOrderParams,
  DuffelClientAdapter,
  DuffelOffer,
  DuffelOrder,
  DuffelSegment,
  DuffelSlice,
  FlightSearchParams,
  PassengerDetails,
} from '../types/index.js';

// ─── Config ────────────────────────────────────────────────────

export interface DuffelClientConfig {
  /** Duffel API access token */
  apiToken: string;
  /** Cache TTL in milliseconds (default: 15 minutes) */
  cacheTtlMs?: number;
  /** Base delay for retries in milliseconds (default: 1000). Set to 0 in tests. */
  retryBaseDelayMs?: number;
}

// ─── Constants ─────────────────────────────────────────────────

const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1_000; // 15 minutes
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1_000;

// ─── Error Classification ──────────────────────────────────────

function isRetryable(err: unknown): boolean {
  if (err instanceof DuffelError) {
    const status = err.meta?.status;
    if (status === 429) return true;
    if (status && status >= 500) return true;
  }
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes('429') || msg.includes('rate limit')) return true;
    if (msg.includes('timeout') || msg.includes('econnreset') || msg.includes('econnrefused')) return true;
    if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('504')) return true;
  }
  return false;
}

function isClientError(err: unknown): boolean {
  if (err instanceof DuffelError) {
    const status = err.meta?.status;
    if (status && status >= 400 && status < 500 && status !== 429) return true;
  }
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (
      (msg.includes('400') || msg.includes('401') || msg.includes('403') || msg.includes('404')) &&
      !msg.includes('429')
    ) {
      return true;
    }
  }
  return false;
}

/** Structured error returned by the client on failure. */
export interface DuffelClientError {
  code: string;
  message: string;
  retryable: boolean;
  statusCode?: number;
}

function classifyError(err: unknown): DuffelClientError {
  if (err instanceof DuffelError) {
    const status = err.meta?.status;
    return {
      code: `DUFFEL_${status ?? 'UNKNOWN'}`,
      message: err.message,
      retryable: isRetryable(err),
      statusCode: status,
    };
  }
  if (err instanceof Error) {
    return {
      code: 'DUFFEL_ERROR',
      message: err.message,
      retryable: isRetryable(err),
    };
  }
  return {
    code: 'DUFFEL_UNKNOWN',
    message: String(err),
    retryable: false,
  };
}

// ─── Cache Entry ───────────────────────────────────────────────

interface CacheEntry {
  result: CachedOfferResult;
  expiresAtMs: number;
}

// ─── Mapping Helpers ───────────────────────────────────────────

function mapSegment(seg: Record<string, unknown>): DuffelSegment {
  const origin = seg.origin as Record<string, unknown> | undefined;
  const dest = seg.destination as Record<string, unknown> | undefined;
  const carrier = seg.marketing_carrier as Record<string, unknown> | undefined;
  const aircraft = seg.aircraft as Record<string, unknown> | undefined;

  return {
    origin: (origin?.iata_code as string) ?? '',
    destination: (dest?.iata_code as string) ?? '',
    departingAt: (seg.departing_at as string) ?? '',
    arrivingAt: (seg.arriving_at as string) ?? '',
    carrier: (carrier?.name as string) ?? '',
    flightNumber: `${(carrier?.iata_code as string) ?? ''}${(seg.marketing_carrier_flight_number as string) ?? ''}`,
    duration: (seg.duration as string) ?? null,
    aircraft: (aircraft?.name as string) ?? null,
  };
}

function mapSlice(slice: Record<string, unknown>): DuffelSlice {
  const origin = slice.origin as Record<string, unknown> | undefined;
  const dest = slice.destination as Record<string, unknown> | undefined;
  const segments = (slice.segments as Record<string, unknown>[]) ?? [];

  return {
    origin: (origin?.iata_code as string) ?? '',
    destination: (dest?.iata_code as string) ?? '',
    duration: (slice.duration as string) ?? null,
    segments: segments.map(mapSegment),
  };
}

function countStops(slices: DuffelSlice[]): number {
  return slices.reduce((sum, s) => sum + Math.max(0, s.segments.length - 1), 0);
}

function mapOffer(raw: Record<string, unknown>): DuffelOffer {
  const owner = raw.owner as Record<string, unknown> | undefined;
  const slicesRaw = (raw.slices as Record<string, unknown>[]) ?? [];
  const slices = slicesRaw.map(mapSlice);

  // Extract cabin class from first passenger of first segment
  let cabinClass = 'economy';
  if (slicesRaw.length > 0) {
    const firstSlice = slicesRaw[0];
    const segments = (firstSlice.segments as Record<string, unknown>[]) ?? [];
    if (segments.length > 0) {
      const passengers = (segments[0].passengers as Record<string, unknown>[]) ?? [];
      if (passengers.length > 0) {
        cabinClass = (passengers[0].cabin_class as string) ?? 'economy';
      }
    }
  }

  return {
    id: (raw.id as string) ?? '',
    totalAmount: (raw.total_amount as string) ?? '0',
    totalCurrency: (raw.total_currency as string) ?? 'USD',
    owner: (owner?.name as string) ?? '',
    ownerIata: (owner?.iata_code as string) ?? '',
    expiresAt: (raw.expires_at as string) ?? '',
    slices,
    totalStops: countStops(slices),
    cabinClass,
  };
}

// ─── Factory ───────────────────────────────────────────────────

export function createDuffelClient(config: DuffelClientConfig): DuffelClientAdapter {
  const log = logger.child({ component: 'DuffelClient' });

  if (!config.apiToken) throw new Error('DuffelClient: apiToken is required');

  const cacheTtlMs = config.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const retryBaseDelayMs = config.retryBaseDelayMs ?? BASE_DELAY_MS;
  const duffel = new Duffel({ token: config.apiToken });

  // In-memory offer cache keyed by requestId
  const cache = new Map<string, CacheEntry>();

  // ─── Retry Logic ─────────────────────────────────────────────

  async function executeWithRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await fn();
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        if (isClientError(err)) {
          log.error({ method: label, error: lastError.message, attempt }, 'Client error — not retrying');
          throw lastError;
        }

        if (attempt < MAX_RETRIES && isRetryable(err)) {
          const delay = retryBaseDelayMs * Math.pow(2, attempt);
          log.warn(
            { method: label, error: lastError.message, attempt: attempt + 1, delayMs: delay },
            'Retrying after transient error',
          );
          if (delay > 0) await sleep(delay);
          continue;
        }

        if (attempt === MAX_RETRIES) {
          log.error(
            { method: label, error: lastError.message, totalAttempts: MAX_RETRIES + 1 },
            'All retries exhausted',
          );
        }

        throw lastError;
      }
    }

    throw lastError ?? new Error(`${label}: unknown error`);
  }

  // ─── Cache Management ────────────────────────────────────────

  function pruneExpired(): void {
    const now = Date.now();
    for (const [key, entry] of cache) {
      if (entry.expiresAtMs <= now) {
        cache.delete(key);
        log.debug({ requestId: key }, 'Cache entry expired and pruned');
      }
    }
  }

  // ─── DuffelClientAdapter Implementation ──────────────────────

  async function searchFlights(params: FlightSearchParams): Promise<CachedOfferResult> {
    // Validate required fields
    if (!params.origin || params.origin.trim() === '') {
      throw new Error('DuffelClient: origin is required');
    }
    if (!params.destination || params.destination.trim() === '') {
      throw new Error('DuffelClient: destination is required');
    }
    if (!params.departureDate || params.departureDate.trim() === '') {
      throw new Error('DuffelClient: departureDate is required');
    }
    if (!params.passengers || params.passengers < 1) {
      throw new Error('DuffelClient: passengers must be at least 1');
    }

    const start = Date.now();

    // Build slices — outbound always, return if returnDate is present
    const slices: Array<{ origin: string; destination: string; departure_date: string; arrival_time: null; departure_time: null }> = [
      {
        origin: params.origin,
        destination: params.destination,
        departure_date: params.departureDate,
        arrival_time: null,
        departure_time: null,
      },
    ];

    if (params.returnDate) {
      slices.push({
        origin: params.destination,
        destination: params.origin,
        departure_date: params.returnDate,
        arrival_time: null,
        departure_time: null,
      });
    }

    // Build passengers array
    const passengers: Array<{ type: 'adult' }> = Array.from(
      { length: params.passengers },
      () => ({ type: 'adult' as const }),
    );

    const cabinClass: CabinClass = params.cabinClass ?? 'economy';

    log.info(
      {
        method: 'searchFlights',
        origin: params.origin,
        destination: params.destination,
        departureDate: params.departureDate,
        returnDate: params.returnDate ?? null,
        passengers: params.passengers,
        cabinClass,
      },
      'Searching flights',
    );

    // Create offer request with return_offers=true to get inline offers
    const response = await executeWithRetry(
      () =>
        duffel.offerRequests.create({
          slices,
          passengers,
          cabin_class: cabinClass,
          return_offers: true,
        }),
      'searchFlights',
    );

    const requestId = response.data.id;
    const rawOffers = (response.data.offers ?? []) as Record<string, unknown>[];

    // Map and sort offers by total_amount ascending
    const offers = rawOffers
      .map(mapOffer)
      .sort((a, b) => parseFloat(a.totalAmount) - parseFloat(b.totalAmount));

    const now = Date.now();
    const expiresAtMs = now + cacheTtlMs;
    const expiresAt = new Date(expiresAtMs).toISOString();
    const createdAt = new Date(now).toISOString();

    const result: CachedOfferResult = {
      requestId,
      offers,
      expiresAt,
      createdAt,
      cached: false,
    };

    // Store in cache
    cache.set(requestId, { result, expiresAtMs });

    // Prune expired entries occasionally
    if (cache.size > 10) pruneExpired();

    log.info(
      {
        method: 'searchFlights',
        requestId,
        offerCount: offers.length,
        durationMs: Date.now() - start,
        cacheTtlMs,
      },
      'Flight search complete — offers cached',
    );

    return result;
  }

  function getCachedOffers(requestId: string): CachedOfferResult | null {
    const entry = cache.get(requestId);
    if (!entry) {
      log.debug({ method: 'getCachedOffers', requestId }, 'Cache miss — no entry');
      return null;
    }

    if (entry.expiresAtMs <= Date.now()) {
      cache.delete(requestId);
      log.info({ method: 'getCachedOffers', requestId }, 'Cache miss — entry expired');
      return null;
    }

    log.debug({ method: 'getCachedOffers', requestId, offerCount: entry.result.offers.length }, 'Cache hit');
    return { ...entry.result, cached: true };
  }

  function clearCache(): void {
    const size = cache.size;
    cache.clear();
    log.info({ method: 'clearCache', cleared: size }, 'Offer cache cleared');
  }

  // ─── Order Creation ──────────────────────────────────────────

  async function createOrder(params: CreateOrderParams): Promise<DuffelOrder> {
    if (!params.offerId || params.offerId.trim() === '') {
      throw new Error('DuffelClient: offerId is required');
    }
    if (!params.passengers || params.passengers.length === 0) {
      throw new Error('DuffelClient: at least one passenger is required');
    }

    const start = Date.now();

    // Map PassengerDetails → Duffel passenger payload
    const duffelPassengers = params.passengers.map((p, i) => ({
      id: `passenger_${i}`,
      given_name: p.givenName,
      family_name: p.familyName,
      born_on: p.bornOn,
      email: p.email,
      phone_number: p.phoneNumber,
      gender: (p.gender === 'male' ? 'm' : 'f') as import('@duffel/api').DuffelPassengerGender,
      type: 'adult' as const,
      title: (p.gender === 'male' ? 'mr' : 'ms') as import('@duffel/api').DuffelPassengerTitle,
    }));

    log.info(
      {
        method: 'createOrder',
        offerId: params.offerId,
        passengerCount: params.passengers.length,
        amount: params.amount,
        currency: params.currency,
      },
      'Creating Duffel order',
    );

    const response = await executeWithRetry(
      () =>
        duffel.orders.create({
          type: 'instant',
          selected_offers: [params.offerId],
          passengers: duffelPassengers,
          payments: [
            {
              type: 'balance',
              amount: String(params.amount),
              currency: params.currency,
            },
          ],
          metadata: params.metadata ?? {},
        }),
      'createOrder',
    );

    const data = response.data as unknown as Record<string, unknown>;
    const order: DuffelOrder = {
      id: (data.id as string) ?? '',
      bookingReference: (data.booking_reference as string) ?? '',
      totalAmount: (data.total_amount as string) ?? '0',
      totalCurrency: (data.total_currency as string) ?? 'USD',
      passengers: params.passengers,
      createdAt: (data.created_at as string) ?? new Date().toISOString(),
    };

    log.info(
      {
        method: 'createOrder',
        orderId: order.id,
        bookingReference: order.bookingReference,
        durationMs: Date.now() - start,
      },
      'Duffel order created',
    );

    return order;
  }

  return {
    searchFlights,
    getCachedOffers,
    clearCache,
    createOrder,
  };
}

// ─── Exported for testing ──────────────────────────────────────

export { classifyError, mapOffer, mapSlice, mapSegment, countStops };

// ─── Utilities ─────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
