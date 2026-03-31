// ─── BagsClient ────────────────────────────────────────────────
// Wraps @bagsfm/bags-sdk to implement the BagsAdapter interface.
// All PublicKey conversion happens at this boundary — callers deal in strings.

import { BagsSDK } from '@bagsfm/bags-sdk';
import { Connection, PublicKey } from '@solana/web3.js';
import type { BagsClaimablePosition as SdkClaimablePosition } from '@bagsfm/bags-sdk/dist/types/meteora.js';
import type { TradeQuoteResponse as SdkTradeQuoteResponse } from '@bagsfm/bags-sdk/dist/types/trade.js';
import { logger } from '../logger.js';
import type {
  BagsAdapter,
  BagsRateLimitInfo,
  BagsRequestOptions,
  ClaimablePosition,
  ClaimTransaction,
  SwapTransaction,
  TradeQuote,
} from '../types/index.js';

// ─── Config ────────────────────────────────────────────────────

export interface BagsClientConfig {
  apiKey: string;
  rpcUrl: string;
}

// ─── Retry Constants ───────────────────────────────────────────

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1_000;
const TIMEOUT_MS = 30_000;

// ─── Error Classification ──────────────────────────────────────

function isRetryable(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    // Retry on 429 rate limits and 5xx server errors
    if (msg.includes('429') || msg.includes('rate limit')) return true;
    if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('504')) return true;
    if (msg.includes('server error') || msg.includes('internal error')) return true;
    if (msg.includes('timeout') || msg.includes('econnreset') || msg.includes('econnrefused')) return true;
  }
  return false;
}

function isClientError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    // 4xx client errors (but not 429) — don't retry
    if (
      (msg.includes('400') || msg.includes('401') || msg.includes('403') || msg.includes('404')) &&
      !msg.includes('429')
    ) {
      return true;
    }
    if (msg.includes('bad request') || msg.includes('unauthorized') || msg.includes('forbidden')) return true;
  }
  return false;
}

// ─── Type Mapping: SDK → FlightBrain ───────────────────────────

export function mapSdkPositionToClaimable(sdkPos: SdkClaimablePosition): ClaimablePosition {
  // All variants share: baseMint, virtualPool, totalClaimableLamportsUserShare, isCustomFeeVault
  const base: Partial<ClaimablePosition> = {
    baseMint: sdkPos.baseMint,
    virtualPool: sdkPos.virtualPool,
    totalClaimableLamportsUserShare: sdkPos.totalClaimableLamportsUserShare,
    isCustomFeeVault: sdkPos.isCustomFeeVault,
  };

  if (!sdkPos.isCustomFeeVault) {
    // MeteoraDbcClaimablePosition — has full DBC fields
    return {
      ...base,
      isMigrated: sdkPos.isMigrated,
      programId: '',
      quoteMint: '',
      virtualPoolAddress: sdkPos.virtualPoolAddress,
      virtualPoolClaimableAmount: sdkPos.virtualPoolClaimableAmount,
      virtualPoolClaimableLamportsUserShare: 0,
      dammPoolClaimableAmount: sdkPos.dammPoolClaimableAmount ?? 0,
      dammPoolClaimableLamportsUserShare: 0,
      dammPoolAddress: sdkPos.dammPoolAddress ?? '',
      dammPositionInfo: sdkPos.dammPositionInfo
        ? {
            position: sdkPos.dammPositionInfo.position,
            pool: sdkPos.dammPositionInfo.pool,
            positionNftAccount: sdkPos.dammPositionInfo.positionNftAccount,
            tokenAMint: sdkPos.dammPositionInfo.tokenAMint,
            tokenBMint: sdkPos.dammPositionInfo.tokenBMint,
            tokenAVault: sdkPos.dammPositionInfo.tokenAVault,
            tokenBVault: sdkPos.dammPositionInfo.tokenBVault,
          }
        : undefined,
      claimableDisplayAmount: sdkPos.claimableDisplayAmount,
      user: '',
      claimerIndex: 0,
      userBps: 0,
      customFeeVault: '',
      customFeeVaultClaimerA: '',
      customFeeVaultClaimerB: '',
      customFeeVaultClaimerSide: 'A',
    } as ClaimablePosition;
  }

  // Custom fee vault variants — check for programId to distinguish V1 vs V2
  if ('programId' in sdkPos) {
    const programId = sdkPos.programId as string;

    // V2 variants (pre/post migration)
    if ('user' in sdkPos && 'quoteMint' in sdkPos) {
      const v2 = sdkPos as Extract<SdkClaimablePosition, { user: string; quoteMint: string }>;
      return {
        ...base,
        isMigrated: v2.isMigrated,
        programId,
        quoteMint: v2.quoteMint,
        virtualPoolAddress: '',
        virtualPoolClaimableAmount: 0,
        virtualPoolClaimableLamportsUserShare: v2.virtualPoolClaimableLamportsUserShare,
        dammPoolClaimableAmount: 0,
        dammPoolClaimableLamportsUserShare:
          'dammPoolClaimableLamportsUserShare' in v2
            ? (v2 as { dammPoolClaimableLamportsUserShare: number }).dammPoolClaimableLamportsUserShare
            : 0,
        dammPoolAddress: 'dammPool' in v2 ? (v2 as { dammPool: string }).dammPool : '',
        dammPositionInfo:
          'dammPositionInfo' in v2 && v2.dammPositionInfo
            ? {
                position: v2.dammPositionInfo.position,
                pool: v2.dammPositionInfo.pool,
                positionNftAccount: v2.dammPositionInfo.positionNftAccount,
                tokenAMint: v2.dammPositionInfo.tokenAMint,
                tokenBMint: v2.dammPositionInfo.tokenBMint,
                tokenAVault: v2.dammPositionInfo.tokenAVault,
                tokenBVault: v2.dammPositionInfo.tokenBVault,
              }
            : undefined,
        claimableDisplayAmount: 0,
        user: v2.user,
        claimerIndex: v2.claimerIndex,
        userBps: v2.userBps,
        customFeeVault: '',
        customFeeVaultClaimerA: '',
        customFeeVaultClaimerB: '',
        customFeeVaultClaimerSide: 'A',
      } as ClaimablePosition;
    }

    // V1 variant — has customFeeVault, customFeeVaultClaimerA/B
    if ('customFeeVault' in sdkPos) {
      const v1 = sdkPos as Extract<SdkClaimablePosition, { customFeeVault: string }>;
      return {
        ...base,
        isMigrated: v1.isMigrated,
        programId,
        quoteMint: '',
        virtualPoolAddress: v1.virtualPoolAddress,
        virtualPoolClaimableAmount: v1.virtualPoolClaimableAmount,
        virtualPoolClaimableLamportsUserShare: 0,
        dammPoolClaimableAmount: v1.dammPoolClaimableAmount ?? 0,
        dammPoolClaimableLamportsUserShare: 0,
        dammPoolAddress: v1.dammPoolAddress ?? '',
        dammPositionInfo: v1.dammPositionInfo
          ? {
              position: v1.dammPositionInfo.position,
              pool: v1.dammPositionInfo.pool,
              positionNftAccount: v1.dammPositionInfo.positionNftAccount,
              tokenAMint: v1.dammPositionInfo.tokenAMint,
              tokenBMint: v1.dammPositionInfo.tokenBMint,
              tokenAVault: v1.dammPositionInfo.tokenAVault,
              tokenBVault: v1.dammPositionInfo.tokenBVault,
            }
          : undefined,
        claimableDisplayAmount: v1.claimableDisplayAmount,
        user: '',
        claimerIndex: 0,
        userBps: 0,
        customFeeVault: v1.customFeeVault,
        customFeeVaultClaimerA: v1.customFeeVaultClaimerA,
        customFeeVaultClaimerB: v1.customFeeVaultClaimerB,
        customFeeVaultClaimerSide: v1.customFeeVaultClaimerSide,
      } as ClaimablePosition;
    }
  }

  // Fallback — shouldn't happen, but handle gracefully
  return {
    ...base,
    isMigrated: false,
    programId: '',
    quoteMint: '',
    virtualPoolAddress: '',
    virtualPoolClaimableAmount: 0,
    virtualPoolClaimableLamportsUserShare: 0,
    dammPoolClaimableAmount: 0,
    dammPoolClaimableLamportsUserShare: 0,
    dammPoolAddress: '',
    claimableDisplayAmount: 0,
    user: '',
    claimerIndex: 0,
    userBps: 0,
    customFeeVault: '',
    customFeeVaultClaimerA: '',
    customFeeVaultClaimerB: '',
    customFeeVaultClaimerSide: 'A',
  } as ClaimablePosition;
}

export function mapSdkQuoteToTradeQuote(sdkQuote: SdkTradeQuoteResponse): TradeQuote {
  return {
    requestId: sdkQuote.requestId,
    contextSlot: sdkQuote.contextSlot,
    inAmount: sdkQuote.inAmount,
    inputMint: sdkQuote.inputMint,
    outAmount: sdkQuote.outAmount,
    outputMint: sdkQuote.outputMint,
    minOutAmount: sdkQuote.minOutAmount,
    otherAmountThreshold: sdkQuote.otherAmountThreshold,
    priceImpactPct: sdkQuote.priceImpactPct,
    slippageBps: sdkQuote.slippageBps,
    routePlan: sdkQuote.routePlan.map((leg) => ({
      venue: leg.venue,
      inAmount: leg.inAmount,
      outAmount: leg.outAmount,
      inputMint: leg.inputMint,
      outputMint: leg.outputMint,
      inputMintDecimals: leg.inputMintDecimals,
      outputMintDecimals: leg.outputMintDecimals,
      marketKey: leg.marketKey,
      data: leg.data,
    })),
    platformFee: sdkQuote.platformFee
      ? {
          amount: sdkQuote.platformFee.amount,
          feeBps: sdkQuote.platformFee.feeBps,
          feeAccount: sdkQuote.platformFee.feeAccount,
          segmenterFeeAmount: sdkQuote.platformFee.segmenterFeeAmount,
          segmenterFeePct: sdkQuote.platformFee.segmenterFeePct,
        }
      : { amount: '0', feeBps: 0, feeAccount: '', segmenterFeeAmount: '0', segmenterFeePct: 0 },
    outTransferFee: sdkQuote.outTransferFee ?? '0',
    simulatedComputeUnits: sdkQuote.simulatedComputeUnits ?? 0,
  };
}

// ─── Factory ───────────────────────────────────────────────────

export function createBagsClient(config: BagsClientConfig): BagsAdapter {
  const log = logger.child({ component: 'BagsClient' });

  // Validate config
  if (!config.apiKey) throw new Error('BagsClient: apiKey is required');
  if (!config.rpcUrl) throw new Error('BagsClient: rpcUrl is required');

  const connection = new Connection(config.rpcUrl, { commitment: 'confirmed' });
  const sdk = new BagsSDK(config.apiKey, connection, 'confirmed');

  // Track rate limit info from responses
  let rateLimitInfo: BagsRateLimitInfo = { remaining: -1, resetAt: 0 };

  // ─── Retry Logic ─────────────────────────────────────────────

  async function executeWithRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

        try {
          const result = await fn();
          clearTimeout(timeoutId);
          return result;
        } catch (err) {
          clearTimeout(timeoutId);
          throw err;
        }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // Don't retry client errors (4xx except 429)
        if (isClientError(lastError)) {
          log.error({ method: label, error: lastError.message, attempt }, 'Client error — not retrying');
          throw lastError;
        }

        if (attempt < MAX_RETRIES && isRetryable(lastError)) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt);
          log.warn(
            { method: label, error: lastError.message, attempt: attempt + 1, delayMs: delay },
            'Retrying after transient error',
          );
          await sleep(delay);
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

    // Should never reach here, but TypeScript needs it
    throw lastError ?? new Error(`${label}: unknown error`);
  }

  // ─── BagsAdapter Implementation ──────────────────────────────

  async function getClaimablePositions(
    wallet: string,
    _options?: BagsRequestOptions,
  ): Promise<ClaimablePosition[]> {
    validateWalletAddress(wallet);

    const start = Date.now();
    const positions = await executeWithRetry(
      () => sdk.fee.getAllClaimablePositions(new PublicKey(wallet)),
      'getClaimablePositions',
    );
    log.info(
      { method: 'getClaimablePositions', wallet, count: positions.length, durationMs: Date.now() - start },
      'Fetched claimable positions',
    );

    return positions.map(mapSdkPositionToClaimable);
  }

  async function getClaimTransactions(
    feeClaimer: string,
    position: ClaimablePosition,
    _options?: BagsRequestOptions,
  ): Promise<ClaimTransaction[]> {
    validateWalletAddress(feeClaimer);
    validateMintAddress(position.baseMint);

    const start = Date.now();
    const transactions = await executeWithRetry(
      () => sdk.fee.getClaimTransactions(new PublicKey(feeClaimer), new PublicKey(position.baseMint)),
      'getClaimTransactions',
    );
    log.info(
      {
        method: 'getClaimTransactions',
        feeClaimer,
        baseMint: position.baseMint,
        count: transactions.length,
        durationMs: Date.now() - start,
      },
      'Fetched claim transactions',
    );

    return transactions.map((tx) => {
      const serialized = Buffer.from(tx.serialize()).toString('base64');
      return {
        tx: serialized,
        blockhash: {
          blockhash: tx.recentBlockhash ?? '',
          lastValidBlockHeight: 0, // Not available on legacy Transaction — caller should fetch fresh
        },
      };
    });
  }

  async function getTradeQuote(
    params: {
      inputMint: string;
      outputMint: string;
      amount: number;
      slippageBps?: number;
    },
    _options?: BagsRequestOptions,
  ): Promise<TradeQuote> {
    validateMintAddress(params.inputMint);
    validateMintAddress(params.outputMint);

    const start = Date.now();
    const sdkQuote = await executeWithRetry(
      () =>
        sdk.trade.getQuote({
          inputMint: new PublicKey(params.inputMint),
          outputMint: new PublicKey(params.outputMint),
          amount: params.amount,
          slippageBps: params.slippageBps,
        }),
      'getTradeQuote',
    );
    log.info(
      {
        method: 'getTradeQuote',
        inputMint: params.inputMint,
        outputMint: params.outputMint,
        amount: params.amount,
        durationMs: Date.now() - start,
      },
      'Fetched trade quote',
    );

    return mapSdkQuoteToTradeQuote(sdkQuote);
  }

  async function createSwapTransaction(
    quoteResponse: TradeQuote,
    userPublicKey: string,
    _options?: BagsRequestOptions,
  ): Promise<SwapTransaction> {
    validateWalletAddress(userPublicKey);

    // Map FlightBrain TradeQuote back to SDK TradeQuoteResponse format
    const sdkQuoteResponse: SdkTradeQuoteResponse = {
      requestId: quoteResponse.requestId,
      contextSlot: quoteResponse.contextSlot,
      inAmount: quoteResponse.inAmount,
      inputMint: quoteResponse.inputMint,
      outAmount: quoteResponse.outAmount,
      outputMint: quoteResponse.outputMint,
      minOutAmount: quoteResponse.minOutAmount,
      otherAmountThreshold: quoteResponse.otherAmountThreshold,
      priceImpactPct: quoteResponse.priceImpactPct,
      slippageBps: quoteResponse.slippageBps,
      routePlan: quoteResponse.routePlan,
      platformFee: quoteResponse.platformFee,
      outTransferFee: quoteResponse.outTransferFee,
      simulatedComputeUnits: quoteResponse.simulatedComputeUnits,
    };

    const start = Date.now();
    const result = await executeWithRetry(
      () =>
        sdk.trade.createSwapTransaction({
          quoteResponse: sdkQuoteResponse,
          userPublicKey: new PublicKey(userPublicKey),
        }),
      'createSwapTransaction',
    );
    log.info(
      {
        method: 'createSwapTransaction',
        userPublicKey,
        durationMs: Date.now() - start,
      },
      'Created swap transaction',
    );

    return {
      swapTransaction: Buffer.from(result.transaction.serialize()).toString('base64'),
      computeUnitLimit: result.computeUnitLimit,
      lastValidBlockHeight: result.lastValidBlockHeight,
      prioritizationFeeLamports: result.prioritizationFeeLamports,
    };
  }

  async function prepareSwap(
    params: {
      inputMint: string;
      outputMint: string;
      amount: number;
      userPublicKey: string;
      slippageBps?: number;
      maxPriceImpactBps?: number;
    },
    options?: BagsRequestOptions,
  ): Promise<{ quote: TradeQuote; swapTx: SwapTransaction }> {
    const quote = await getTradeQuote(
      {
        inputMint: params.inputMint,
        outputMint: params.outputMint,
        amount: params.amount,
        slippageBps: params.slippageBps,
      },
      options,
    );

    // Check price impact if maxPriceImpactBps is set
    if (params.maxPriceImpactBps !== undefined) {
      const impactBps = Math.round(parseFloat(quote.priceImpactPct) * 100);
      if (impactBps > params.maxPriceImpactBps) {
        throw new Error(
          `Price impact ${impactBps}bps exceeds max ${params.maxPriceImpactBps}bps`,
        );
      }
    }

    const swapTx = await createSwapTransaction(quote, params.userPublicKey, options);
    return { quote, swapTx };
  }

  async function getTotalClaimableSol(
    wallet: string,
    options?: BagsRequestOptions,
  ): Promise<{ totalLamports: bigint; positions: ClaimablePosition[] }> {
    const positions = await getClaimablePositions(wallet, options);
    const totalLamports = positions.reduce(
      (sum, pos) => sum + BigInt(pos.totalClaimableLamportsUserShare),
      0n,
    );

    log.info(
      { method: 'getTotalClaimableSol', wallet, totalLamports: totalLamports.toString(), positionCount: positions.length },
      'Calculated total claimable SOL',
    );

    return { totalLamports, positions };
  }

  function getRateLimitStatus(): BagsRateLimitInfo {
    return { ...rateLimitInfo };
  }

  return {
    getClaimablePositions,
    getClaimTransactions,
    getTradeQuote,
    createSwapTransaction,
    prepareSwap,
    getTotalClaimableSol,
    getRateLimitStatus,
  };
}

// ─── Validation Helpers ────────────────────────────────────────

function validateWalletAddress(address: string): void {
  if (!address || address.trim() === '') {
    throw new Error('BagsClient: wallet address cannot be empty');
  }
  try {
    new PublicKey(address);
  } catch {
    throw new Error(`BagsClient: invalid wallet address "${address}"`);
  }
}

function validateMintAddress(mint: string): void {
  if (!mint || mint.trim() === '') {
    throw new Error('BagsClient: mint address cannot be empty');
  }
  try {
    new PublicKey(mint);
  } catch {
    throw new Error(`BagsClient: invalid mint address "${mint}"`);
  }
}

// ─── Utilities ─────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
