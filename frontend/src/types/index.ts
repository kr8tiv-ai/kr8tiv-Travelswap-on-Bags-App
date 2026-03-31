// ─── FlightBrain Frontend Domain Types ─────────────────────────
// Mirrored from backend/src/types/index.ts — JSON shapes only.

export type FeeSourceType = 'CLAIMABLE_POSITIONS' | 'PARTNER_FEES';

export type DistributionMode =
  | 'OWNER_ONLY'
  | 'TOP_N_HOLDERS'
  | 'EQUAL_SPLIT'
  | 'WEIGHTED_BY_HOLDINGS'
  | 'CUSTOM_LIST';

export type CreditMode = 'GIFT_CARD' | 'DIRECT_TOPUP' | 'DUFFEL_BOOKING';

export type GiftCardStatus = 'PURCHASED' | 'DELIVERED' | 'REDEEMED' | 'EXPIRED';

export type StrategyStatus = 'ACTIVE' | 'PAUSED' | 'ERROR';

export type RunState =
  | 'PENDING'
  | 'CLAIMING'
  | 'SWAPPING'
  | 'ALLOCATING'
  | 'CREDITING'
  | 'COMPLETE'
  | 'FAILED';

// ─── Strategy ──────────────────────────────────────────────────

export interface TravelStrategy {
  readonly strategyId: string;
  readonly name: string;
  readonly ownerWallet: string;
  readonly tokenMint: string;
  readonly feeSource: FeeSourceType;
  readonly thresholdSol: number;
  readonly slippageBps: number;
  readonly distributionMode: DistributionMode;
  readonly distributionTopN: number;
  readonly creditMode: CreditMode;
  readonly giftCardThresholdUsd: number;
  readonly cronExpression: string;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastRunId: string | null;
}

// ─── Run ───────────────────────────────────────────────────────

export interface TravelRun {
  readonly runId: string;
  readonly strategyId: string;
  readonly phase: RunState;
  readonly status: 'RUNNING' | 'COMPLETE' | 'FAILED';
  readonly claimedSol: number | null;
  readonly swappedUsdc: number | null;
  readonly allocatedUsd: number | null;
  readonly creditsIssued: number;
  readonly giftCardsPurchased: number;
  readonly errorMessage: string | null;
  readonly claimTx: string | null;
  readonly swapTx: string | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
}

// ─── Travel Balance ────────────────────────────────────────────

export interface TravelBalance {
  readonly balanceId: string;
  readonly strategyId: string;
  readonly walletAddress: string;
  readonly balanceUsd: number;
  readonly totalEarned: number;
  readonly totalSpent: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ─── Gift Card ─────────────────────────────────────────────────

export interface GiftCard {
  readonly giftCardId: string;
  readonly strategyId: string;
  readonly runId: string;
  readonly walletAddress: string;
  readonly denominationUsd: number;
  readonly codeEncrypted: string;
  readonly status: GiftCardStatus;
  readonly deliveredAt: string | null;
  readonly redeemedAt: string | null;
  readonly createdAt: string;
}

// ─── Aggregate Stats ───────────────────────────────────────────

export interface AggregateStats {
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  totalClaimedSol: number;
  totalSwappedUsdc: number;
  totalAllocatedUsd: number;
  totalCreditsIssued: number;
  totalGiftCardsPurchased: number;
}

// ─── Health ────────────────────────────────────────────────────

export interface HealthReadyResponse {
  status: 'ready' | 'not_ready';
  checks: Record<string, { status: string; error?: string }>;
}

// ─── API Error ─────────────────────────────────────────────────

export interface ApiErrorResponse {
  error: string;
}

// ─── Create / Update DTOs ──────────────────────────────────────

export interface CreateStrategyParams {
  name: string;
  ownerWallet: string;
  tokenMint: string;
  feeSource?: FeeSourceType;
  thresholdSol?: number;
  slippageBps?: number;
  distributionMode?: DistributionMode;
  distributionTopN?: number;
  creditMode?: CreditMode;
  giftCardThresholdUsd?: number;
  cronExpression?: string;
  enabled?: boolean;
}

export interface UpdateStrategyParams {
  name?: string;
  thresholdSol?: number;
  slippageBps?: number;
  distributionMode?: DistributionMode;
  distributionTopN?: number;
  creditMode?: CreditMode;
  giftCardThresholdUsd?: number;
  cronExpression?: string;
  enabled?: boolean;
}

export interface TriggerRunParams {
  strategyId: number;
}

// ─── Duffel / Flight Types ─────────────────────────────────────

export type CabinClass = 'economy' | 'premium_economy' | 'business' | 'first';

/** Parameters for searching flights via Duffel. */
export interface FlightSearchParams {
  readonly origin: string;
  readonly destination: string;
  readonly departureDate: string;
  readonly returnDate?: string;
  readonly passengers: number;
  readonly cabinClass?: CabinClass;
}

/** Simplified segment from Duffel offer slice. */
export interface DuffelSegment {
  readonly origin: string;
  readonly destination: string;
  readonly departingAt: string;
  readonly arrivingAt: string;
  readonly carrier: string;
  readonly flightNumber: string;
  readonly duration: string | null;
  readonly aircraft: string | null;
}

/** Simplified slice from Duffel offer. */
export interface DuffelSlice {
  readonly origin: string;
  readonly destination: string;
  readonly duration: string | null;
  readonly segments: DuffelSegment[];
}

/** Simplified offer from Duffel. */
export interface DuffelOffer {
  readonly id: string;
  readonly totalAmount: string;
  readonly totalCurrency: string;
  readonly owner: string;
  readonly ownerIata: string;
  readonly expiresAt: string;
  readonly slices: DuffelSlice[];
  readonly totalStops: number;
  readonly cabinClass: string;
}

/** Cached offer result with TTL metadata. */
export interface CachedOfferResult {
  readonly requestId: string;
  readonly offers: DuffelOffer[];
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly cached: boolean;
}

// ─── Booking Types ─────────────────────────────────────────────

export type BookingStatus = 'PENDING' | 'CONFIRMED' | 'FAILED';

export interface PassengerDetails {
  readonly givenName: string;
  readonly familyName: string;
  readonly bornOn: string;
  readonly email: string;
  readonly phoneNumber: string;
  readonly gender: 'male' | 'female';
}

export interface Booking {
  readonly id: string;
  readonly strategyId: string;
  readonly walletAddress: string;
  readonly offerId: string;
  readonly duffelOrderId: string | null;
  readonly bookingReference: string | null;
  readonly passengers: PassengerDetails[];
  readonly amountUsd: number;
  readonly currency: string;
  readonly status: BookingStatus;
  readonly errorMessage: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ─── Frontend-only DTOs ────────────────────────────────────────

/** Response shape from POST /api/flights/search */
export interface FlightSearchResponse {
  readonly requestId: string;
  readonly offers: DuffelOffer[];
  readonly expiresAt: string;
}

/** Request body for POST /api/bookings/book */
export interface BookFlightParams {
  readonly offerId: string;
  readonly requestId: string;
  readonly strategyId: string;
  readonly walletAddress: string;
  readonly passengers: PassengerDetails[];
}
