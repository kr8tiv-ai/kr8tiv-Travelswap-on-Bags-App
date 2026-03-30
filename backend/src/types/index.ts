// ─── FlightBrain Domain Types ──────────────────────────────────
// Adapted from PinkBrain Router types for the fee-to-travel-credits pipeline.

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

export type GiftCardStatus = 'PURCHASED' | 'DELIVERED' | 'REDEEMED' | 'EXPIRED';

export type StrategyStatus = 'ACTIVE' | 'PAUSED' | 'ERROR';

/** FlightBrain 5-phase state machine — simplified from Router's 7-phase */
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
