// ─── CoinVoyageClient ──────────────────────────────────────────
// Server-side CoinVoyage V2 API client using Pay Orders (Sale mode).
// Follows the established adapter pattern: factory function returning
// interface (K004), structured error classification, Pino logging.
//
// CoinVoyage V2 API: https://docs.coinvoyage.io
// Auth: X-API-KEY header + HMAC-SHA256 signature for writes.

import { createHmac } from 'node:crypto';
import { logger } from '../logger.js';
import type { PayOrder, PayOrderStatus, CoinVoyageClientAdapter } from '../types/index.js';

// ─── Types ─────────────────────────────────────────────────────

/** Parameters for creating a Sale PayOrder. */
export interface CreateSalePayOrderParams {
  /** Amount in USD to settle. */
  readonly amountUsd: number;
  /** Solana wallet address that receives the USDC settlement. */
  readonly receivingAddress: string;
  /** Arbitrary metadata (e.g., { strategyId, runId, walletAddress }). */
  readonly metadata?: Record<string, unknown>;
}

/** Config for the CoinVoyage client factory. */
export interface CoinVoyageClientConfig {
  /** CoinVoyage API key (X-API-KEY header). */
  readonly apiKey: string;
  /** CoinVoyage API secret for HMAC-SHA256 authorization signatures. */
  readonly apiSecret: string;
  /** Base URL override (default: https://api.coinvoyage.io/v2). */
  readonly baseUrl?: string;
  /** Base delay for retries in milliseconds (default: 1000). Set to 0 in tests. */
  readonly retryBaseDelayMs?: number;
}

// ─── Constants ─────────────────────────────────────────────────

const DEFAULT_BASE_URL = 'https://api.coinvoyage.io/v2';
const MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 1_000;

// USDC on Solana
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// ─── Error Classification ──────────────────────────────────────

export interface CoinVoyageError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly statusCode?: number;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function isRetryableError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes('429') || msg.includes('rate limit')) return true;
    if (msg.includes('timeout') || msg.includes('econnreset') || msg.includes('econnrefused')) return true;
    if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('504')) return true;
    if (msg.includes('fetch failed') || msg.includes('network')) return true;
  }
  return false;
}

function classifyError(err: unknown, statusCode?: number): CoinVoyageError {
  const message = err instanceof Error ? err.message : String(err);
  const retryable = statusCode ? isRetryableStatus(statusCode) : isRetryableError(err);

  return {
    code: statusCode ? `COINVOYAGE_${statusCode}` : 'COINVOYAGE_ERROR',
    message,
    retryable,
    statusCode,
  };
}

// ─── HMAC Authorization ────────────────────────────────────────

function generateAuthSignature(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64');
}

// ─── Factory ───────────────────────────────────────────────────

export function createCoinVoyageClient(config: CoinVoyageClientConfig): CoinVoyageClientAdapter {
  const log = logger.child({ component: 'CoinVoyageClient' });

  if (!config.apiKey) throw new Error('CoinVoyageClient: apiKey is required');
  if (!config.apiSecret) throw new Error('CoinVoyageClient: apiSecret is required');

  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const retryBaseDelayMs = config.retryBaseDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  // ─── Retry Logic ─────────────────────────────────────────────

  async function executeWithRetry<T>(
    fn: () => Promise<T>,
    label: string,
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // Don't retry client errors (4xx except 429)
        if (err instanceof Error && err.message.includes('COINVOYAGE_4')) {
          const status = parseInt(err.message.match(/COINVOYAGE_(\d+)/)?.[1] ?? '0', 10);
          if (status >= 400 && status < 500 && status !== 429) {
            log.error({ method: label, error: lastError.message, attempt }, 'Client error — not retrying');
            throw lastError;
          }
        }

        if (attempt < MAX_RETRIES && isRetryableError(err)) {
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

  // ─── HTTP Helpers ────────────────────────────────────────────

  async function apiPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const url = `${baseUrl}${path}`;
    const bodyStr = JSON.stringify(body);
    const signature = generateAuthSignature(bodyStr, config.apiSecret);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': config.apiKey,
        'Authorization': `Signature ${signature}`,
      },
      body: bodyStr,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const classified = classifyError(
        new Error(`CoinVoyage API error: ${response.status} ${text}`),
        response.status,
      );
      throw new Error(`COINVOYAGE_${response.status}: ${text || response.statusText}`);
    }

    const json = await response.json() as { data?: T; error?: string };
    if (json.error) {
      throw new Error(`CoinVoyage API error: ${json.error}`);
    }

    return json.data as T;
  }

  async function apiGet<T>(path: string): Promise<T> {
    const url = `${baseUrl}${path}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-API-KEY': config.apiKey,
      },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`COINVOYAGE_${response.status}: ${text || response.statusText}`);
    }

    const json = await response.json() as { data?: T; error?: string };
    if (json.error) {
      throw new Error(`CoinVoyage API error: ${json.error}`);
    }

    return json.data as T;
  }

  // ─── API Response Mapping ────────────────────────────────────

  function mapPayOrder(raw: Record<string, unknown>): PayOrder {
    return {
      id: (raw.id as string) ?? '',
      mode: (raw.mode as PayOrder['mode']) ?? 'SALE',
      status: (raw.status as PayOrderStatus) ?? 'PENDING',
      metadata: raw.metadata as Record<string, unknown> | undefined,
      depositTxHash: raw.deposit_tx_hash as string | undefined,
      receivingTxHash: raw.receiving_tx_hash as string | undefined,
      createdAt: raw.created_at as string | undefined,
    };
  }

  // ─── Adapter Implementation ──────────────────────────────────

  async function createSalePayOrder(params: CreateSalePayOrderParams): Promise<PayOrder> {
    if (!params.amountUsd || params.amountUsd <= 0) {
      throw new Error('CoinVoyageClient: amountUsd must be positive');
    }
    if (!params.receivingAddress || params.receivingAddress.trim() === '') {
      throw new Error('CoinVoyageClient: receivingAddress is required');
    }

    const start = Date.now();

    log.info(
      {
        method: 'createSalePayOrder',
        amountUsd: params.amountUsd,
        receivingAddress: params.receivingAddress,
      },
      'Creating Sale PayOrder',
    );

    const body = {
      intent: {
        amount: {
          fiat: { amount: params.amountUsd, unit: 'USD' },
        },
        asset: {
          mint: USDC_MINT,
          chain: 'solana',
        },
        receiving_address: params.receivingAddress,
      },
      metadata: {
        items: [
          {
            name: 'TravelSwap Gift Card',
            quantity: 1,
            amount: params.amountUsd,
          },
        ],
        ...(params.metadata ?? {}),
      },
    };

    const raw = await executeWithRetry(
      () => apiPost<Record<string, unknown>>('/pay-orders', body),
      'createSalePayOrder',
    );

    const payOrder = mapPayOrder(raw);

    log.info(
      {
        method: 'createSalePayOrder',
        payOrderId: payOrder.id,
        status: payOrder.status,
        durationMs: Date.now() - start,
      },
      'Sale PayOrder created',
    );

    return payOrder;
  }

  async function getPayOrder(payOrderId: string): Promise<PayOrder> {
    if (!payOrderId || payOrderId.trim() === '') {
      throw new Error('CoinVoyageClient: payOrderId is required');
    }

    const start = Date.now();

    log.info(
      { method: 'getPayOrder', payOrderId },
      'Fetching PayOrder',
    );

    const raw = await executeWithRetry(
      () => apiGet<Record<string, unknown>>(`/pay-orders/${payOrderId}`),
      'getPayOrder',
    );

    const payOrder = mapPayOrder(raw);

    log.info(
      {
        method: 'getPayOrder',
        payOrderId: payOrder.id,
        status: payOrder.status,
        durationMs: Date.now() - start,
      },
      'PayOrder fetched',
    );

    return payOrder;
  }

  return {
    createSalePayOrder,
    getPayOrder,
  };
}

// ─── Webhook Verification ──────────────────────────────────────
// Exported for use by the webhook route handler.

/**
 * Verify a CoinVoyage webhook HMAC-SHA256 signature.
 * The expected header is `CoinVoyage-Webhook-Signature`.
 */
export function verifyCoinVoyageWebhookSignature(
  rawBody: string | Buffer,
  signature: string,
  webhookSecret: string,
): boolean {
  const expected = createHmac('sha256', webhookSecret)
    .update(typeof rawBody === 'string' ? rawBody : rawBody)
    .digest('base64');

  // Timing-safe comparison
  if (expected.length !== signature.length) return false;

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;

  // Use constant-time comparison
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i]! ^ b[i]!;
  }
  return result === 0;
}

// ─── Exported for testing ──────────────────────────────────────

export { classifyError, generateAuthSignature, isRetryableError, isRetryableStatus };

// ─── Utilities ─────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
