// ─── CoinVoyageClient Tests ────────────────────────────────────
// Unit tests for the CoinVoyage V2 API client.
// Tests cover: createSalePayOrder success, HTTP error handling,
// request shape validation, getPayOrder, retry behavior,
// HMAC signature generation, and webhook signature verification.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createCoinVoyageClient,
  verifyCoinVoyageWebhookSignature,
  classifyError,
  generateAuthSignature,
  isRetryableError,
  isRetryableStatus,
  type CoinVoyageClientConfig,
  type CreateSalePayOrderParams,
} from '../CoinVoyageClient.js';
import type { CoinVoyageClientAdapter, PayOrder } from '../../types/index.js';
import { createHmac } from 'node:crypto';

// ─── Fetch Mock ────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ─── Helpers ───────────────────────────────────────────────────

function makeConfig(overrides?: Partial<CoinVoyageClientConfig>): CoinVoyageClientConfig {
  return {
    apiKey: 'test-api-key',
    apiSecret: 'test-api-secret',
    baseUrl: 'https://api.coinvoyage.test/v2',
    retryBaseDelayMs: 0, // No delays in tests (K018)
    ...overrides,
  };
}

function makePayOrderResponse(overrides?: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    id: 'po_test_001',
    mode: 'SALE',
    status: 'PENDING',
    metadata: { items: [{ name: 'TravelSwap Gift Card', quantity: 1, amount: 50 }] },
    deposit_tx_hash: null,
    receiving_tx_hash: null,
    created_at: '2026-03-30T12:00:00Z',
    ...overrides,
  };
}

function mockFetchSuccess(data: Record<string, unknown>): void {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => ({ data }),
  });
}

function mockFetchError(status: number, body: string = ''): void {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    statusText: `Error ${status}`,
    text: async () => body,
  });
}

// ─── Test Suite ────────────────────────────────────────────────

describe('CoinVoyageClient', () => {
  let client: CoinVoyageClientAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    client = createCoinVoyageClient(makeConfig());
  });

  // ─── Factory Validation ────────────────────────────────────

  describe('factory validation', () => {
    it('throws if apiKey is missing', () => {
      expect(() => createCoinVoyageClient(makeConfig({ apiKey: '' }))).toThrow(
        'CoinVoyageClient: apiKey is required',
      );
    });

    it('throws if apiSecret is missing', () => {
      expect(() => createCoinVoyageClient(makeConfig({ apiSecret: '' }))).toThrow(
        'CoinVoyageClient: apiSecret is required',
      );
    });
  });

  // ─── createSalePayOrder ────────────────────────────────────

  describe('createSalePayOrder', () => {
    const validParams: CreateSalePayOrderParams = {
      amountUsd: 50,
      receivingAddress: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
      metadata: { strategyId: 'strat_1', runId: 'run_1' },
    };

    it('creates a Sale PayOrder successfully', async () => {
      const rawPayOrder = makePayOrderResponse();
      mockFetchSuccess(rawPayOrder);

      const result = await client.createSalePayOrder(validParams);

      expect(result).toEqual({
        id: 'po_test_001',
        mode: 'SALE',
        status: 'PENDING',
        metadata: { items: [{ name: 'TravelSwap Gift Card', quantity: 1, amount: 50 }] },
        depositTxHash: null,
        receivingTxHash: null,
        createdAt: '2026-03-30T12:00:00Z',
      });
    });

    it('sends correct request shape to CoinVoyage API', async () => {
      mockFetchSuccess(makePayOrderResponse());

      await client.createSalePayOrder(validParams);

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.coinvoyage.test/v2/pay-orders');
      expect(opts.method).toBe('POST');
      expect(opts.headers['Content-Type']).toBe('application/json');
      expect(opts.headers['X-API-KEY']).toBe('test-api-key');
      expect(opts.headers['Authorization']).toMatch(/^Signature /);

      // Verify request body structure
      const body = JSON.parse(opts.body);
      expect(body.intent.amount.fiat).toEqual({ amount: 50, unit: 'USD' });
      expect(body.intent.asset.mint).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
      expect(body.intent.asset.chain).toBe('solana');
      expect(body.intent.receiving_address).toBe(validParams.receivingAddress);
      expect(body.metadata.items).toEqual([
        { name: 'TravelSwap Gift Card', quantity: 1, amount: 50 },
      ]);
      // Custom metadata is merged into metadata object
      expect(body.metadata.strategyId).toBe('strat_1');
      expect(body.metadata.runId).toBe('run_1');
    });

    it('generates valid HMAC-SHA256 authorization signature', async () => {
      mockFetchSuccess(makePayOrderResponse());

      await client.createSalePayOrder(validParams);

      const [, opts] = mockFetch.mock.calls[0];
      const authHeader = opts.headers['Authorization'] as string;
      const signature = authHeader.replace('Signature ', '');

      // Independently compute expected signature
      const expectedSig = createHmac('sha256', 'test-api-secret')
        .update(opts.body)
        .digest('base64');

      expect(signature).toBe(expectedSig);
    });

    it('throws on negative amountUsd', async () => {
      await expect(
        client.createSalePayOrder({ ...validParams, amountUsd: -10 }),
      ).rejects.toThrow('CoinVoyageClient: amountUsd must be positive');
    });

    it('throws on zero amountUsd', async () => {
      await expect(
        client.createSalePayOrder({ ...validParams, amountUsd: 0 }),
      ).rejects.toThrow('CoinVoyageClient: amountUsd must be positive');
    });

    it('throws on empty receivingAddress', async () => {
      await expect(
        client.createSalePayOrder({ ...validParams, receivingAddress: '' }),
      ).rejects.toThrow('CoinVoyageClient: receivingAddress is required');
    });

    it('throws on whitespace-only receivingAddress', async () => {
      await expect(
        client.createSalePayOrder({ ...validParams, receivingAddress: '   ' }),
      ).rejects.toThrow('CoinVoyageClient: receivingAddress is required');
    });

    it('handles 400 client error without retry', async () => {
      mockFetchError(400, 'Invalid request body');

      await expect(client.createSalePayOrder(validParams)).rejects.toThrow('COINVOYAGE_400');
      // 400 is not retryable — should only call fetch once
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('handles 401 unauthorized without retry', async () => {
      mockFetchError(401, 'Unauthorized');

      await expect(client.createSalePayOrder(validParams)).rejects.toThrow('COINVOYAGE_401');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('retries on 500 server error up to MAX_RETRIES', async () => {
      // 4 calls total: 1 initial + 3 retries
      mockFetchError(500, 'Internal Server Error');
      mockFetchError(500, 'Internal Server Error');
      mockFetchError(500, 'Internal Server Error');
      mockFetchError(500, 'Internal Server Error');

      await expect(client.createSalePayOrder(validParams)).rejects.toThrow('COINVOYAGE_500');
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });

    it('retries on 429 rate limit', async () => {
      mockFetchError(429, 'Rate limited');
      mockFetchSuccess(makePayOrderResponse());

      const result = await client.createSalePayOrder(validParams);
      expect(result.id).toBe('po_test_001');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('retries on network error then succeeds', async () => {
      mockFetch.mockRejectedValueOnce(new Error('fetch failed: ECONNRESET'));
      mockFetchSuccess(makePayOrderResponse());

      const result = await client.createSalePayOrder(validParams);
      expect(result.id).toBe('po_test_001');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('handles API-level error in response body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ error: 'Insufficient funds in merchant account' }),
      });

      await expect(client.createSalePayOrder(validParams)).rejects.toThrow(
        'CoinVoyage API error: Insufficient funds in merchant account',
      );
    });

    it('works without optional metadata', async () => {
      mockFetchSuccess(makePayOrderResponse());

      await client.createSalePayOrder({
        amountUsd: 100,
        receivingAddress: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU',
      });

      const [, opts] = mockFetch.mock.calls[0];
      const body = JSON.parse(opts.body);
      // metadata should only contain items (no extra fields)
      expect(body.metadata).toEqual({
        items: [{ name: 'TravelSwap Gift Card', quantity: 1, amount: 100 }],
      });
    });

    it('maps response fields correctly including null tx hashes', async () => {
      const raw = makePayOrderResponse({
        deposit_tx_hash: 'abc123tx',
        receiving_tx_hash: 'def456tx',
        status: 'COMPLETED',
      });
      mockFetchSuccess(raw);

      const result = await client.createSalePayOrder(validParams);
      expect(result.depositTxHash).toBe('abc123tx');
      expect(result.receivingTxHash).toBe('def456tx');
      expect(result.status).toBe('COMPLETED');
    });
  });

  // ─── getPayOrder ───────────────────────────────────────────

  describe('getPayOrder', () => {
    it('fetches a PayOrder by ID', async () => {
      const raw = makePayOrderResponse({ status: 'COMPLETED' });
      mockFetchSuccess(raw);

      const result = await client.getPayOrder('po_test_001');

      expect(result.id).toBe('po_test_001');
      expect(result.status).toBe('COMPLETED');

      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.coinvoyage.test/v2/pay-orders/po_test_001');
      expect(opts.method).toBe('GET');
      expect(opts.headers['X-API-KEY']).toBe('test-api-key');
    });

    it('throws on empty payOrderId', async () => {
      await expect(client.getPayOrder('')).rejects.toThrow(
        'CoinVoyageClient: payOrderId is required',
      );
    });

    it('throws on whitespace-only payOrderId', async () => {
      await expect(client.getPayOrder('   ')).rejects.toThrow(
        'CoinVoyageClient: payOrderId is required',
      );
    });

    it('handles 404 not found', async () => {
      mockFetchError(404, 'PayOrder not found');

      await expect(client.getPayOrder('po_nonexistent')).rejects.toThrow('COINVOYAGE_404');
    });

    it('retries on 503 then succeeds', async () => {
      mockFetchError(503, 'Service temporarily unavailable');
      mockFetchSuccess(makePayOrderResponse());

      const result = await client.getPayOrder('po_test_001');
      expect(result.id).toBe('po_test_001');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});

// ─── Error Classification ──────────────────────────────────────

describe('classifyError', () => {
  it('classifies 429 as retryable', () => {
    const result = classifyError(new Error('Too many requests'), 429);
    expect(result.retryable).toBe(true);
    expect(result.code).toBe('COINVOYAGE_429');
    expect(result.statusCode).toBe(429);
  });

  it('classifies 400 as non-retryable', () => {
    const result = classifyError(new Error('Bad request'), 400);
    expect(result.retryable).toBe(false);
    expect(result.code).toBe('COINVOYAGE_400');
  });

  it('classifies 500+ as retryable', () => {
    expect(classifyError(new Error(''), 500).retryable).toBe(true);
    expect(classifyError(new Error(''), 502).retryable).toBe(true);
    expect(classifyError(new Error(''), 503).retryable).toBe(true);
  });

  it('classifies network errors as retryable without status', () => {
    const result = classifyError(new Error('fetch failed: ECONNRESET'));
    expect(result.retryable).toBe(true);
    expect(result.code).toBe('COINVOYAGE_ERROR');
    expect(result.statusCode).toBeUndefined();
  });

  it('classifies unknown errors as non-retryable', () => {
    const result = classifyError(new Error('some unknown error'));
    expect(result.retryable).toBe(false);
  });
});

// ─── isRetryableStatus / isRetryableError ──────────────────────

describe('isRetryableStatus', () => {
  it('429 is retryable', () => expect(isRetryableStatus(429)).toBe(true));
  it('500 is retryable', () => expect(isRetryableStatus(500)).toBe(true));
  it('503 is retryable', () => expect(isRetryableStatus(503)).toBe(true));
  it('400 is not retryable', () => expect(isRetryableStatus(400)).toBe(false));
  it('401 is not retryable', () => expect(isRetryableStatus(401)).toBe(false));
  it('200 is not retryable', () => expect(isRetryableStatus(200)).toBe(false));
});

describe('isRetryableError', () => {
  it('timeout errors are retryable', () => {
    expect(isRetryableError(new Error('Request timeout'))).toBe(true);
  });
  it('ECONNRESET is retryable', () => {
    expect(isRetryableError(new Error('ECONNRESET'))).toBe(true);
  });
  it('ECONNREFUSED is retryable', () => {
    expect(isRetryableError(new Error('ECONNREFUSED'))).toBe(true);
  });
  it('fetch failed is retryable', () => {
    expect(isRetryableError(new Error('fetch failed'))).toBe(true);
  });
  it('network errors are retryable', () => {
    expect(isRetryableError(new Error('network error'))).toBe(true);
  });
  it('rate limit is retryable', () => {
    expect(isRetryableError(new Error('rate limit exceeded'))).toBe(true);
  });
  it('random errors are not retryable', () => {
    expect(isRetryableError(new Error('validation failed'))).toBe(false);
  });
  it('non-Error values return false', () => {
    expect(isRetryableError('string error')).toBe(false);
  });
});

// ─── HMAC Signature ────────────────────────────────────────────

describe('generateAuthSignature', () => {
  it('produces correct HMAC-SHA256 base64 digest', () => {
    const body = '{"test":"data"}';
    const secret = 'my-secret';

    const expected = createHmac('sha256', secret).update(body).digest('base64');
    const result = generateAuthSignature(body, secret);

    expect(result).toBe(expected);
  });

  it('produces different signatures for different bodies', () => {
    const secret = 'same-secret';
    const sig1 = generateAuthSignature('body1', secret);
    const sig2 = generateAuthSignature('body2', secret);
    expect(sig1).not.toBe(sig2);
  });

  it('produces different signatures for different secrets', () => {
    const body = 'same-body';
    const sig1 = generateAuthSignature(body, 'secret1');
    const sig2 = generateAuthSignature(body, 'secret2');
    expect(sig1).not.toBe(sig2);
  });
});

// ─── Webhook Signature Verification ────────────────────────────

describe('verifyCoinVoyageWebhookSignature', () => {
  const webhookSecret = 'whsec_test_secret';

  it('returns true for valid signature', () => {
    const rawBody = '{"event":"payorder_completed","data":{}}';
    const validSig = createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('base64');

    expect(verifyCoinVoyageWebhookSignature(rawBody, validSig, webhookSecret)).toBe(true);
  });

  it('returns false for invalid signature', () => {
    const rawBody = '{"event":"payorder_completed","data":{}}';
    expect(verifyCoinVoyageWebhookSignature(rawBody, 'invalid-sig', webhookSecret)).toBe(false);
  });

  it('returns false for tampered body', () => {
    const rawBody = '{"event":"payorder_completed","data":{}}';
    const validSig = createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('base64');

    const tamperedBody = '{"event":"payorder_completed","data":{"hacked":true}}';
    expect(verifyCoinVoyageWebhookSignature(tamperedBody, validSig, webhookSecret)).toBe(false);
  });

  it('returns false for wrong webhook secret', () => {
    const rawBody = '{"event":"test"}';
    const sigWithDifferentSecret = createHmac('sha256', 'wrong-secret')
      .update(rawBody)
      .digest('base64');

    expect(verifyCoinVoyageWebhookSignature(rawBody, sigWithDifferentSecret, webhookSecret)).toBe(false);
  });

  it('works with Buffer input', () => {
    const rawBody = Buffer.from('{"event":"test"}');
    const validSig = createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('base64');

    expect(verifyCoinVoyageWebhookSignature(rawBody, validSig, webhookSecret)).toBe(true);
  });
});
