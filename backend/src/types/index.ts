// ─── TravelSwap Domain Types ──────────────────────────────────
// Adapted from PinkBrain Router types for the fee-to-travel-credits pipeline.
// Extended with Duffel flight search types for M002.

// ─── Bags API (shared with Router) ─────────────────────────────

export type BagsRequestPriority = 'high' | 'low';

export interface BagsRequestOptions {
  priority?: BagsRequestPriority;
}

export interface BagsApiConfig {
  apiKey: string;
  baseUrl: string;
  connection?: unknown;
}

export interface BagsRateLimitInfo {
  remaining: number;
  resetAt: number;
}

export interface ClaimablePosition {
  isCustomFeeVault: boolean;
  baseMint: string;
  isMigrated: boolean;
  totalClaimableLamportsUserShare: number;
  programId: string;
  quoteMint: string;
  virtualPool: string;
  virtualPoolAddress: string;
  virtualPoolClaimableAmount: number;
  virtualPoolClaimableLamportsUserShare: number;
  dammPoolClaimableAmount: number;
  dammPoolClaimableLamportsUserShare: number;
  dammPoolAddress: string;
  dammPositionInfo?: {
    position: string;
    pool: string;
    positionNftAccount: string;
    tokenAMint: string;
    tokenBMint: string;
    tokenAVault: string;
    tokenBVault: string;
  };
  claimableDisplayAmount: number;
  user: string;
  claimerIndex: number;
  userBps: number;
  customFeeVault: string;
  customFeeVaultClaimerA: string;
  customFeeVaultClaimerB: string;
  customFeeVaultClaimerSide: 'A' | 'B';
}

export interface TradeQuote {
  requestId: string;
  contextSlot: number;
  inAmount: string;
  inputMint: string;
  outAmount: string;
  outputMint: string;
  minOutAmount: string;
  otherAmountThreshold: string;
  priceImpactPct: string;
  slippageBps: number;
  routePlan: Array<{
    venue: string;
    inAmount: string;
    outAmount: string;
    inputMint: string;
    outputMint: string;
    inputMintDecimals: number;
    outputMintDecimals: number;
    marketKey: string;
    data: string;
  }>;
  platformFee: {
    amount: string;
    feeBps: number;
    feeAccount: string;
    segmenterFeeAmount: string;
    segmenterFeePct: number;
  };
  outTransferFee: string;
  simulatedComputeUnits: number;
}

export interface SwapTransaction {
  swapTransaction: string;
  computeUnitLimit: number;
  lastValidBlockHeight: number;
  prioritizationFeeLamports: number;
}

export interface ClaimTransaction {
  tx: string;
  blockhash: {
    blockhash: string;
    lastValidBlockHeight: number;
  };
}

// ─── Helius ────────────────────────────────────────────────────

export interface HeliusConfig {
  apiKey: string;
  rpcUrl: string;
}

export interface PriorityFeeEstimate {
  priorityFeeEstimate: number;
  priorityFeeLevels?: {
    min: number;
    low: number;
    medium: number;
    high: number;
    veryHigh: number;
    unsafeMax: number;
  };
}

export interface TokenHolder {
  address: string;
  owner: string;
  balance: bigint;
}

// ─── Core Domain Types ─────────────────────────────────────────

export type FeeSourceType = 'CLAIMABLE_POSITIONS' | 'PARTNER_FEES';

export type DistributionMode =
  | 'OWNER_ONLY'
  | 'TOP_N_HOLDERS'
  | 'EQUAL_SPLIT'
  | 'WEIGHTED_BY_HOLDINGS'
  | 'CUSTOM_LIST';

export type CreditMode = 'GIFT_CARD' | 'DIRECT_TOPUP' | 'DUFFEL_BOOKING';

export type GiftCardStatus = 'PENDING' | 'PURCHASED' | 'DELIVERED' | 'REDEEMED' | 'EXPIRED';

export type StrategyStatus = 'ACTIVE' | 'PAUSED' | 'ERROR';

/** TravelSwap 5-phase state machine — simplified from Router's 7-phase */
export type RunState =
  | 'PENDING'
  | 'CLAIMING'
  | 'SWAPPING'
  | 'ALLOCATING'
  | 'CREDITING'
  | 'COMPLETE'
  | 'FAILED';

// ─── Custom Allocation ─────────────────────────────────────────

export interface CustomAllocation {
  readonly wallet: string;
  readonly percentage: number;
}

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
  readonly customAllocations: CustomAllocation[] | null;
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
  readonly provider: GiftCardProvider;
  readonly payorderId: string | null;
  readonly paymentStatus: string | null;
  readonly errorMessage: string | null;
  readonly bitrefillInvoiceId: string | null;
  readonly deliveredAt: string | null;
  readonly redeemedAt: string | null;
  readonly createdAt: string;
}

// ─── Audit & Phase ─────────────────────────────────────────────

export interface AuditLogEntry {
  readonly logId: number;
  readonly runId: string;
  readonly phase: RunState;
  readonly action: string;
  readonly details: Record<string, unknown>;
  readonly txSignature?: string;
  readonly timestamp: string;
}

export interface PhaseResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
  };
}

// ─── BagsAdapter Interface ─────────────────────────────────────

export interface BagsAdapter {
  getClaimablePositions(
    wallet: string,
    options?: BagsRequestOptions,
  ): Promise<ClaimablePosition[]>;

  getClaimTransactions(
    feeClaimer: string,
    position: ClaimablePosition,
    options?: BagsRequestOptions,
  ): Promise<ClaimTransaction[]>;

  getTradeQuote(
    params: {
      inputMint: string;
      outputMint: string;
      amount: number;
      slippageBps?: number;
    },
    options?: BagsRequestOptions,
  ): Promise<TradeQuote>;

  createSwapTransaction(
    quoteResponse: TradeQuote,
    userPublicKey: string,
    options?: BagsRequestOptions,
  ): Promise<SwapTransaction>;

  prepareSwap(
    params: {
      inputMint: string;
      outputMint: string;
      amount: number;
      userPublicKey: string;
      slippageBps?: number;
      maxPriceImpactBps?: number;
    },
    options?: BagsRequestOptions,
  ): Promise<{ quote: TradeQuote; swapTx: SwapTransaction }>;

  getTotalClaimableSol(
    wallet: string,
    options?: BagsRequestOptions,
  ): Promise<{ totalLamports: bigint; positions: ClaimablePosition[] }>;

  getRateLimitStatus(): BagsRateLimitInfo;
}

// ─── Duffel Flight Search Types ────────────────────────────────

export type CabinClass = 'economy' | 'premium_economy' | 'business' | 'first';

/** Parameters for searching flights via Duffel. */
export interface FlightSearchParams {
  /** IATA airport or city code for origin (e.g. "JFK", "LON") */
  readonly origin: string;
  /** IATA airport or city code for destination */
  readonly destination: string;
  /** ISO 8601 date string for outbound departure (YYYY-MM-DD) */
  readonly departureDate: string;
  /** ISO 8601 date string for return departure, omit for one-way */
  readonly returnDate?: string;
  /** Number of adult passengers (default 1) */
  readonly passengers: number;
  /** Desired cabin class (default "economy") */
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

/** Simplified offer from Duffel, containing only fields we surface to the user. */
export interface DuffelOffer {
  /** Duffel offer ID (e.g. "off_00009htYpSCXrwaB9DnUm0") */
  readonly id: string;
  /** Total price as a decimal string (e.g. "45.00") */
  readonly totalAmount: string;
  /** ISO 4217 currency code (e.g. "USD") */
  readonly totalCurrency: string;
  /** Airline name */
  readonly owner: string;
  /** Airline IATA code */
  readonly ownerIata: string;
  /** ISO 8601 datetime when the offer expires */
  readonly expiresAt: string;
  /** Flight slices (legs) */
  readonly slices: DuffelSlice[];
  /** Number of stops (total across all slices) */
  readonly totalStops: number;
  /** Cabin class */
  readonly cabinClass: string;
}

/** Represents a Duffel offer request with its associated offers. */
export interface DuffelOfferRequest {
  /** Duffel offer request ID (e.g. "orq_00009hjdomFOCJyxHG7k7k") */
  readonly requestId: string;
  /** Offers returned from the request, sorted by totalAmount ascending */
  readonly offers: DuffelOffer[];
  /** When the cached result expires (ISO 8601) */
  readonly expiresAt: string;
  /** ISO 8601 datetime when the request was created */
  readonly createdAt: string;
}

/** Cached offer result, wrapping an offer request with TTL metadata. */
export interface CachedOfferResult {
  readonly requestId: string;
  readonly offers: DuffelOffer[];
  readonly expiresAt: string;
  readonly createdAt: string;
  /** Whether this result was served from cache */
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

export interface CreateOrderParams {
  readonly offerId: string;
  readonly passengers: PassengerDetails[];
  readonly amount: number;
  readonly currency: string;
  readonly metadata?: Record<string, string>;
}

export interface DuffelOrder {
  readonly id: string;
  readonly bookingReference: string;
  readonly totalAmount: string;
  readonly totalCurrency: string;
  readonly passengers: PassengerDetails[];
  readonly createdAt: string;
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

/** DuffelClient interface for flight search and order operations. */
export interface DuffelClientAdapter {
  /** Search for flights and cache the results. */
  searchFlights(params: FlightSearchParams): Promise<CachedOfferResult>;
  /** Retrieve cached offers by request ID. Returns null if expired or not found. */
  getCachedOffers(requestId: string): CachedOfferResult | null;
  /** Clear all cached offers. */
  clearCache(): void;
  /** Create a Duffel order (book a flight). */
  createOrder(params: CreateOrderParams): Promise<DuffelOrder>;
}

// ─── CoinVoyage Types ──────────────────────────────────────────

/** CoinVoyage PayOrder status lifecycle. */
export type PayOrderStatus =
  | 'PENDING'
  | 'AWAITING_PAYMENT'
  | 'AWAITING_CONFIRMATION'
  | 'OPTIMISTIC_CONFIRMED'
  | 'EXECUTING_ORDER'
  | 'COMPLETED'
  | 'FAILED'
  | 'EXPIRED'
  | 'REFUNDED';

/** CoinVoyage PayOrder as returned by the API. */
export interface PayOrder {
  readonly id: string;
  readonly mode: 'SALE' | 'DEPOSIT' | 'REFUND';
  readonly status: PayOrderStatus;
  readonly metadata?: Record<string, unknown>;
  readonly depositTxHash?: string;
  readonly receivingTxHash?: string;
  readonly createdAt?: string;
}

/** CoinVoyage client adapter interface. */
export interface CoinVoyageClientAdapter {
  /** Create a Sale PayOrder that settles USDC to a receiving address. */
  createSalePayOrder(params: {
    amountUsd: number;
    receivingAddress: string;
    metadata?: Record<string, unknown>;
  }): Promise<PayOrder>;
  /** Retrieve a PayOrder by ID. */
  getPayOrder(payOrderId: string): Promise<PayOrder>;
}

// ─── Bitrefill Types ───────────────────────────────────────────

/** Bitrefill invoice as returned by POST /v2/invoices. */
export interface BitrefillInvoice {
  readonly id: string;
  readonly status: string;
  readonly payment_method: string;
  readonly products: Array<{
    product_id: string;
    package_id: string;
    quantity: number;
  }>;
  /** Present when auto_pay:true and balance payment succeeds. */
  readonly order_id?: string;
  /** Present when the invoice is completed immediately. */
  readonly redemption_info?: {
    code: string;
    instructions?: string;
  };
  readonly created_at?: string;
}

/** Bitrefill order as returned by GET /v2/orders/{id}. */
export interface BitrefillOrder {
  readonly id: string;
  readonly status: string;
  readonly redemption_info?: {
    code: string;
    instructions?: string;
  };
  readonly created_at?: string;
}

/** Bitrefill account balance as returned by GET /v2/accounts/balance. */
export interface BitrefillBalance {
  readonly balance: number;
  readonly currency: string;
}

/** Bitrefill client adapter interface. */
export interface BitrefillClientAdapter {
  /** Create an invoice (balance payment with auto_pay). Returns invoice with redemption code. */
  createInvoice(params: {
    productId: string;
    packageId: string;
    quantity?: number;
    paymentMethod?: string;
    autoPay?: boolean;
  }): Promise<BitrefillInvoice>;
  /** Retrieve an order by ID. */
  getOrder(orderId: string): Promise<BitrefillOrder>;
  /** Get the account balance. */
  getBalance(): Promise<BitrefillBalance>;
}

// ─── Gift Card Provider ────────────────────────────────────────

export type GiftCardProvider = 'coinvoyage' | 'bitrefill' | 'stub';

// ─── NFT Travel Pass ──────────────────────────────────────────

export type TravelPassStatus = 'PENDING' | 'MINTED' | 'FAILED';

export interface TravelPass {
  readonly id: string;
  readonly giftCardId: string;
  readonly strategyId: string;
  readonly walletAddress: string;
  readonly denominationUsd: number;
  readonly tokenMint: string;
  readonly mintSignature: string | null;
  readonly metadataUri: string | null;
  readonly status: TravelPassStatus;
  readonly errorMessage: string | null;
  readonly createdAt: string;
  readonly mintedAt: string | null;
}

export interface NftMintResult {
  readonly signature: string;
  readonly assetId: string;
}

export interface NftMintClientAdapter {
  mintTravelPass(params: {
    walletAddress: string;
    denominationUsd: number;
    tokenMint: string;
    metadataUri: string;
  }): Promise<NftMintResult>;
}
