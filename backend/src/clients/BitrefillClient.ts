// ─── BitrefillClient ───────────────────────────────────────────
// Server-side Bitrefill V2 API client using balance payment.
// Follows the established adapter pattern: factory function returning
// interface (K004), structured error classification, Pino logging (K018).
//
// Bitrefill V2 API: https://api.bitrefill.com/v2
// Auth: Bearer token in Authorization header.
// Balance payment with auto_pay:true is synchronous — redemption code
// available immediately in the invoice response.

import { logger } from '../logger.js';
import type { BitrefillInvoice, BitrefillOrder, BitrefillBalance, BitrefillClientAdapter } from '../types/index.js';

// ─── Types ─────────────────────────────────────────────────────

/** Parameters for creating a Bitrefill invoice. */
export interface CreateInvoiceParams {
  /** Bitrefill product ID (e.g., 'amazon-us', 'test-gift-card-code'). */
  readonly productId: string;
  /** Package ID for the product (e.g., 'amazon-us<&>50' for $50 denomination). */
  readonly packageId: string;
  /** Quantity of gift cards to purchase (default: 1). */
  readonly quantity?: number;
  /** Payment method (default: 'balance'). */
  readonly paymentMethod?: string;
  /** Auto-pay from balance (default: true). */
  readonly autoPay?: boolean;
}

/** Config for the Bitrefill client factory. */
export interface BitrefillClientConfig {
  /** Bitrefill API key (Bearer token). */
  readonly apiKey: string;
  /** Base URL override (default: https://api.bitrefill.com/v2). */
  readonly baseUrl?: string;
  /** Base delay for retries in milliseconds (default: 1000). Set to 0 in tests. */
  readonly retryBaseDelayMs?: number;
}

// ─── Constants ─────────────────────────────────────────────────

const DEFAULT_BASE_URL = 'https://api.bitrefill.com/v2';
const MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 1_000;

// ─── Error Classification ──────────────────────────────────────

export interface BitrefillError {
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

function classifyError(err: unknown, statusCode?: number): BitrefillError {
  const message = err instanceof Error ? err.message : String(err);
  const retryable = statusCode ? isRetryableStatus(statusCode) : isRetryableError(err);

  return {
    code: statusCode ? `BITREFILL_${statusCode}` : 'BITREFILL_ERROR',
    message,
    retryable,
    statusCode,
  };
}

// ─── Factory ───────────────────────────────────────────────────

export function createBitrefillClient(config: BitrefillClientConfig): BitrefillClientAdapter {
  const log = logger.child({ component: 'BitrefillClient' });

  if (!config.apiKey) throw new Error('BitrefillClient: apiKey is required');

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
        if (err instanceof Error && err.message.includes('BITREFILL_4')) {
          const status = parseInt(err.message.match(/BITREFILL_(\d+)/)?.[1] ?? '0', 10);
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

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`BITREFILL_${response.status}: ${text || response.statusText}`);
    }

    return await response.json() as T;
  }

  async function apiGet<T>(path: string): Promise<T> {
    const url = `${baseUrl}${path}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
      },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`BITREFILL_${response.status}: ${text || response.statusText}`);
    }

    return await response.json() as T;
  }

  // ─── Adapter Implementation ──────────────────────────────────

  async function createInvoice(params: CreateInvoiceParams): Promise<BitrefillInvoice> {
    if (!params.productId || params.productId.trim() === '') {
      throw new Error('BitrefillClient: productId is required');
    }
    if (!params.packageId || params.packageId.trim() === '') {
      throw new Error('BitrefillClient: packageId is required');
    }

    const start = Date.now();

    log.info(
      {
        method: 'createInvoice',
        productId: params.productId,
        packageId: params.packageId,
        paymentMethod: params.paymentMethod ?? 'balance',
      },
      'Creating Bitrefill invoice',
    );

    const body: Record<string, unknown> = {
      products: [
        {
          product_id: params.productId,
          package_id: params.packageId,
          quantity: params.quantity ?? 1,
        },
      ],
      payment_method: params.paymentMethod ?? 'balance',
      auto_pay: params.autoPay ?? true,
    };

    const invoice = await executeWithRetry(
      () => apiPost<BitrefillInvoice>('/invoices', body),
      'createInvoice',
    );

    log.info(
      {
        method: 'createInvoice',
        invoiceId: invoice.id,
        status: invoice.status,
        hasRedemptionCode: !!invoice.redemption_info?.code,
        durationMs: Date.now() - start,
      },
      'Bitrefill invoice created',
    );

    return invoice;
  }

  async function getOrder(orderId: string): Promise<BitrefillOrder> {
    if (!orderId || orderId.trim() === '') {
      throw new Error('BitrefillClient: orderId is required');
    }

    const start = Date.now();

    log.info(
      { method: 'getOrder', orderId },
      'Fetching Bitrefill order',
    );

    const order = await executeWithRetry(
      () => apiGet<BitrefillOrder>(`/orders/${orderId}`),
      'getOrder',
    );

    log.info(
      {
        method: 'getOrder',
        orderId: order.id,
        status: order.status,
        hasRedemptionCode: !!order.redemption_info?.code,
        durationMs: Date.now() - start,
      },
      'Bitrefill order fetched',
    );

    return order;
  }

  async function getBalance(): Promise<BitrefillBalance> {
    const start = Date.now();

    log.info(
      { method: 'getBalance' },
      'Fetching Bitrefill account balance',
    );

    const balance = await executeWithRetry(
      () => apiGet<BitrefillBalance>('/accounts/balance'),
      'getBalance',
    );

    log.info(
      {
        method: 'getBalance',
        balance: balance.balance,
        currency: balance.currency,
        durationMs: Date.now() - start,
      },
      'Bitrefill account balance fetched',
    );

    return balance;
  }

  return {
    createInvoice,
    getOrder,
    getBalance,
  };
}

// ─── Exported for testing ──────────────────────────────────────

export { classifyError, isRetryableError, isRetryableStatus };

// ─── Utilities ─────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
