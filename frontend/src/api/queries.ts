// ─── TanStack Query Hooks ──────────────────────────────────────
// One hook per API endpoint. Mutations invalidate related queries.

import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
} from '@tanstack/react-query';
import { apiFetch } from './client';
import type {
  AggregateStats,
  Booking,
  BookFlightParams,
  CachedOfferResult,
  CreateStrategyParams,
  FlightSearchParams,
  GiftCard,
  HealthReadyResponse,
  TravelBalance,
  TravelRun,
  TravelStrategy,
  TriggerRunParams,
  UpdateStrategyParams,
} from '../types';

// ─── Query Keys ────────────────────────────────────────────────

export const queryKeys = {
  stats: ['stats'] as const,
  health: ['health'] as const,
  strategies: ['strategies'] as const,
  strategy: (id: string | number) => ['strategies', String(id)] as const,
  runs: (strategyId?: string | number) =>
    strategyId ? ['runs', { strategyId: String(strategyId) }] as const : ['runs'] as const,
  balances: (strategyId: string | number) => ['balances', { strategyId: String(strategyId) }] as const,
  credits: (params: { strategyId?: string | number; wallet?: string }) =>
    ['credits', params] as const,
  flights: (requestId: string) => ['flights', requestId] as const,
  bookings: (params?: { wallet?: string }) =>
    params ? ['bookings', params] as const : ['bookings'] as const,
  booking: (id: string) => ['bookings', id] as const,
};

// ─── Stats ─────────────────────────────────────────────────────

export function useStats(opts?: Partial<UseQueryOptions<AggregateStats>>) {
  return useQuery<AggregateStats>({
    queryKey: queryKeys.stats,
    queryFn: () => apiFetch<AggregateStats>('/api/stats'),
    staleTime: 30_000,
    ...opts,
  });
}

// ─── Health ────────────────────────────────────────────────────

export function useHealthReady(opts?: Partial<UseQueryOptions<HealthReadyResponse>>) {
  return useQuery<HealthReadyResponse>({
    queryKey: queryKeys.health,
    queryFn: () => apiFetch<HealthReadyResponse>('/health/ready'),
    staleTime: 10_000,
    refetchInterval: 30_000,
    ...opts,
  });
}

// ─── Strategies ────────────────────────────────────────────────

export function useStrategies(opts?: Partial<UseQueryOptions<TravelStrategy[]>>) {
  return useQuery<TravelStrategy[]>({
    queryKey: queryKeys.strategies,
    queryFn: () => apiFetch<TravelStrategy[]>('/api/strategies'),
    staleTime: 30_000,
    ...opts,
  });
}

export function useStrategy(
  id: string | number,
  opts?: Partial<UseQueryOptions<TravelStrategy>>,
) {
  return useQuery<TravelStrategy>({
    queryKey: queryKeys.strategy(id),
    queryFn: () => apiFetch<TravelStrategy>(`/api/strategies/${id}`),
    staleTime: 30_000,
    enabled: !!id,
    ...opts,
  });
}

export function useCreateStrategy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: CreateStrategyParams) =>
      apiFetch<TravelStrategy>('/api/strategies', {
        method: 'POST',
        body: JSON.stringify(params),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.strategies });
    },
  });
}

export function useUpdateStrategy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...params }: UpdateStrategyParams & { id: string | number }) =>
      apiFetch<TravelStrategy>(`/api/strategies/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(params),
      }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: queryKeys.strategies });
      qc.invalidateQueries({ queryKey: queryKeys.strategy(variables.id) });
    },
  });
}

// ─── Runs ──────────────────────────────────────────────────────

export function useRuns(
  strategyId?: string | number,
  opts?: Partial<UseQueryOptions<TravelRun[]>>,
) {
  const path = strategyId
    ? `/api/runs?strategyId=${strategyId}`
    : '/api/runs';
  return useQuery<TravelRun[]>({
    queryKey: queryKeys.runs(strategyId),
    queryFn: () => apiFetch<TravelRun[]>(path),
    staleTime: 30_000,
    ...opts,
  });
}

export function useTriggerRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: TriggerRunParams) =>
      apiFetch<TravelRun>('/api/runs', {
        method: 'POST',
        body: JSON.stringify(params),
      }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: queryKeys.runs() });
      qc.invalidateQueries({ queryKey: queryKeys.runs(variables.strategyId) });
      qc.invalidateQueries({ queryKey: queryKeys.stats });
    },
  });
}

export function useResumeRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string | number) =>
      apiFetch<TravelRun>(`/api/runs/${runId}/resume`, {
        method: 'POST',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.runs() });
      qc.invalidateQueries({ queryKey: queryKeys.stats });
    },
  });
}

// ─── Balances ──────────────────────────────────────────────────

export function useBalances(
  strategyId: string | number,
  opts?: Partial<UseQueryOptions<TravelBalance[]>>,
) {
  return useQuery<TravelBalance[]>({
    queryKey: queryKeys.balances(strategyId),
    queryFn: () => apiFetch<TravelBalance[]>(`/api/balances?strategyId=${strategyId}`),
    staleTime: 30_000,
    enabled: !!strategyId,
    ...opts,
  });
}

// ─── Credits (Gift Cards) ──────────────────────────────────────

export function useCredits(
  params: { strategyId?: string | number; wallet?: string },
  opts?: Partial<UseQueryOptions<GiftCard[]>>,
) {
  const searchParams = new URLSearchParams();
  if (params.strategyId) searchParams.set('strategyId', String(params.strategyId));
  if (params.wallet) searchParams.set('wallet', params.wallet);

  return useQuery<GiftCard[]>({
    queryKey: queryKeys.credits(params),
    queryFn: () => apiFetch<GiftCard[]>(`/api/credits?${searchParams.toString()}`),
    staleTime: 30_000,
    enabled: !!(params.strategyId || params.wallet),
    ...opts,
  });
}

/** Response from POST /api/credits/:id/reveal */
export interface RevealGiftCardResponse {
  code: string | null;
  alreadyRevealed?: boolean;
  giftCard: GiftCard;
}

/** Reveal a PURCHASED gift card's code. Transitions status to DELIVERED. */
export function useRevealGiftCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (giftCardId: string) =>
      apiFetch<RevealGiftCardResponse>(`/api/credits/${giftCardId}/reveal`, {
        method: 'POST',
      }),
    onSuccess: () => {
      // Invalidate all credits queries so status badges refresh
      qc.invalidateQueries({ queryKey: ['credits'] });
    },
  });
}

// ─── Flights ───────────────────────────────────────────────────

/** Mutation that searches flights. Returns cached offers with a requestId for polling. */
export function useFlightSearch() {
  return useMutation({
    mutationFn: (params: FlightSearchParams) =>
      apiFetch<CachedOfferResult>('/api/flights/search', {
        method: 'POST',
        body: JSON.stringify(params),
      }),
  });
}

/** Poll cached offers by requestId (e.g. after a search). */
export function useOffers(
  requestId: string | undefined,
  opts?: Partial<UseQueryOptions<CachedOfferResult>>,
) {
  return useQuery<CachedOfferResult>({
    queryKey: queryKeys.flights(requestId ?? ''),
    queryFn: () => apiFetch<CachedOfferResult>(`/api/flights/offers/${requestId}`),
    staleTime: 30_000,
    enabled: !!requestId,
    ...opts,
  });
}

// ─── Bookings ──────────────────────────────────────────────────

/** Book a flight. On success, invalidates bookings and balances queries. */
export function useBookFlight() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: BookFlightParams) =>
      apiFetch<Booking>('/api/bookings/book', {
        method: 'POST',
        body: JSON.stringify(params),
      }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: queryKeys.bookings() });
      qc.invalidateQueries({ queryKey: queryKeys.balances(variables.strategyId) });
    },
  });
}

/** List bookings, optionally filtered by wallet address. */
export function useBookings(
  wallet: string | undefined,
  opts?: Partial<UseQueryOptions<Booking[]>>,
) {
  const path = wallet
    ? `/api/bookings?wallet=${encodeURIComponent(wallet)}`
    : '/api/bookings';
  return useQuery<Booking[]>({
    queryKey: queryKeys.bookings(wallet ? { wallet } : undefined),
    queryFn: () => apiFetch<Booking[]>(path),
    staleTime: 30_000,
    enabled: !!wallet,
    ...opts,
  });
}

/** Fetch a single booking by ID. */
export function useBooking(
  id: string | undefined,
  opts?: Partial<UseQueryOptions<Booking>>,
) {
  return useQuery<Booking>({
    queryKey: queryKeys.booking(id ?? ''),
    queryFn: () => apiFetch<Booking>(`/api/bookings/${id}`),
    staleTime: 30_000,
    enabled: !!id,
    ...opts,
  });
}
