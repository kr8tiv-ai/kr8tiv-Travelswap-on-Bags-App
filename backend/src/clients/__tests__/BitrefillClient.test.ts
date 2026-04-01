// ─── BitrefillClient Tests ─────────────────────────────────────
// Unit tests for the Bitrefill V2 API client.
// Tests cover: createInvoice success (balance payment with auto_pay),
// createInvoice validation, getOrder success, getBalance success,
// error classification (401 non-retryable, 429 retryable, 500 retryable),
// retry on transient failure, and Bearer token in Authorization header.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createBitrefillClient,
  classifyError,
  isRetryableError,
  isRetryableStatus,
  type BitrefillClientConfig,
} from '../BitrefillClient.js';
import type { BitrefillClientAdapter, BitrefillInvoice, BitrefillOrder, BitrefillBalance } from '../../types/index.js';

// ─── Fetch Mock ────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ─── Helpers ───────────────────────────────────────────────────

function makeConfig(overrides?: Partial<BitrefillClientConfig>): BitrefillClientConfig {
  return {
    apiKey: 'test-bitrefill-api-key',
    baseUrl: 'https://api.bitrefill.test/v2',
    retryBaseDelayMs: 0, // No delays in tests (K018)
    ...overrides,
  };
}

function makeInvoiceResponse(overrides?: Partial<BitrefillInvoice>): BitrefillInvoice {
  return {
    id: 'inv_test_001',
    status: 'completed',
    payment_method: 'balance',
    products: [
      { product_id: 'test-gift-card-code', package_id: 'test-gift-card-code<&>50', quantity: 1 },
    ],
    order_id: 'ord_test_001',
    redemption_info: {
      code: 'GIFTCODE-ABC123',
      instructions: 'Redeem at checkout',
    },
    created_at: '2026-03-30T12:00:00Z',
    ...overrides,
  };
}

function makeOrderResponse(overrides?: Partial<BitrefillOrder>): BitrefillOrder {
  return {
    id: 'ord_test_001',
    status: 'completed',
    redemption_info: {
      code: 'GIFTCODE-ABC123',
      instructions: 'Redeem at checkout',
    },
    created_at: '2026-03-30T12:00:00Z',
    ...overrides,
  };
}

function makeBalanceResponse(overrides?: Partial<BitrefillBalance>): BitrefillBalance {
  return {
    balance: 250.00,
    currency: 'USD',
    ...overrides,
  };
}

function mockFetchSuccess(data: unknown): void {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: async () => data,
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

describe('BitrefillClient', () => {
  let client: BitrefillClientAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    client = createBitrefillClient(makeConfig());
  });

  // ─── Factory Validation ────────────────────────────────────

  describe('factory validation', () => {
    it('throws if apiKey is missing', () => {
      expect(() => createBitrefillClient(makeConfig({ apiKey: '' }))).toThrow(
        'BitrefillClient: apiKey is required',
      );
    });
  });

  // ─── createInvoice ────────────────────────────────────────

  describe('createInvoice', () => {
    it('creates invoice with balance payment and auto_pay', async () => {
      const invoiceData = makeInvoiceResponse();
      mockFetchSuccess(invoiceData);

      const result = await client.createInvoice({
        productId: 'test-gift-card-code',
        packageId: 'test-gift-card-code<&>50',
      });

      expect(result.id).toBe('inv_test_001');
      expect(result.status).toBe('completed');
      expect(result.redemption_info?.code).toBe('GIFTCODE-ABC123');
      expect(result.order_id).toBe('ord_test_001');

      // Verify request shape
      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, options] = mockFetch.mock.calls[0]!;
      expect(url).toBe('https://api.bitrefill.test/v2/invoices');
      expect(options.method).toBe('POST');

      const body = JSON.parse(options.body);
      expect(body.products).toEqual([
        { product_id: 'test-gift-card-code', package_id: 'test-gift-card-code<&>50', quantity: 1 },
      ]);
      expect(body.payment_method).toBe('balance');
      expect(body.auto_pay).toBe(true);
    });

    it('sends custom quantity and payment method when specified', async () => {
      const invoiceData = makeInvoiceResponse();
      mockFetchSuccess(invoiceData);

      await client.createInvoice({
        productId: 'amazon-us',
        packageId: 'amazon-us<&>100',
        quantity: 3,
        paymentMethod: 'bitcoin',
        autoPay: false,
      });

      const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(body.products[0].quantity).toBe(3);
      expect(body.payment_method).toBe('bitcoin');
      expect(body.auto_pay).toBe(false);
    });

    it('throws on empty productId', async () => {
      await expect(
        client.createInvoice({ productId: '', packageId: 'pkg' }),
      ).rejects.toThrow('BitrefillClient: productId is required');
    });

    it('throws on empty packageId', async () => {
      await expect(
        client.createInvoice({ productId: 'prod', packageId: '' }),
      ).rejects.toThrow('BitrefillClient: packageId is required');
    });

    it('throws on whitespace-only productId', async () => {
      await expect(
        client.createInvoice({ productId: '   ', packageId: 'pkg' }),
      ).rejects.toThrow('BitrefillClient: productId is required');
    });
  });

  // ─── getOrder ─────────────────────────────────────────────

  describe('getOrder', () => {
    it('returns order with redemption_info.code', async () => {
      const orderData = makeOrderResponse();
      mockFetchSuccess(orderData);

      const result = await client.getOrder('ord_test_001');

      expect(result.id).toBe('ord_test_001');
      expect(result.status).toBe('completed');
      expect(result.redemption_info?.code).toBe('GIFTCODE-ABC123');

      const [url, options] = mockFetch.mock.calls[0]!;
      expect(url).toBe('https://api.bitrefill.test/v2/orders/ord_test_001');
      expect(options.method).toBe('GET');
    });

    it('throws on empty orderId', async () => {
      await expect(client.getOrder('')).rejects.toThrow(
        'BitrefillClient: orderId is required',
      );
    });

    it('throws on whitespace-only orderId', async () => {
      await expect(client.getOrder('   ')).rejects.toThrow(
        'BitrefillClient: orderId is required',
      );
    });
  });

  // ─── getBalance ───────────────────────────────────────────

  describe('getBalance', () => {
    it('returns account balance', async () => {
      const balanceData = makeBalanceResponse();
      mockFetchSuccess(balanceData);

      const result = await client.getBalance();

      expect(result.balance).toBe(250.00);
      expect(result.currency).toBe('USD');

      const [url, options] = mockFetch.mock.calls[0]!;
      expect(url).toBe('https://api.bitrefill.test/v2/accounts/balance');
      expect(options.method).toBe('GET');
    });
  });

  // ─── Bearer Token Auth ────────────────────────────────────

  describe('Authorization header', () => {
    it('sends Bearer token in Authorization header for POST', async () => {
      mockFetchSuccess(makeInvoiceResponse());

      await client.createInvoice({
        productId: 'test-gift-card-code',
        packageId: 'test-gift-card-code<&>50',
      });

      const [, options] = mockFetch.mock.calls[0]!;
      expect(options.headers['Authorization']).toBe('Bearer test-bitrefill-api-key');
    });

    it('sends Bearer token in Authorization header for GET', async () => {
      mockFetchSuccess(makeOrderResponse());

      await client.getOrder('ord_test_001');

      const [, options] = mockFetch.mock.calls[0]!;
      expect(options.headers['Authorization']).toBe('Bearer test-bitrefill-api-key');
    });
  });

  // ─── Error Classification ─────────────────────────────────

  describe('error classification', () => {
    it('401 is non-retryable — does not retry', async () => {
      mockFetchError(401, 'Unauthorized');

      await expect(
        client.createInvoice({
          productId: 'test-gift-card-code',
          packageId: 'test-gift-card-code<&>50',
        }),
      ).rejects.toThrow('BITREFILL_401');

      // Only one attempt — no retries for 401
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('429 is retryable — retries on rate limit', async () => {
      // First call: 429, then succeed
      mockFetchError(429, 'Rate limited');
      mockFetchSuccess(makeInvoiceResponse());

      const result = await client.createInvoice({
        productId: 'test-gift-card-code',
        packageId: 'test-gift-card-code<&>50',
      });

      expect(result.id).toBe('inv_test_001');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('500 is retryable — retries on server error', async () => {
      // First call: 500, then succeed
      mockFetchError(500, 'Internal Server Error');
      mockFetchSuccess(makeOrderResponse());

      const result = await client.getOrder('ord_test_001');

      expect(result.id).toBe('ord_test_001');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  // ─── Retry on Transient Failure ───────────────────────────

  describe('retry behavior', () => {
    it('retries on network error then succeeds', async () => {
      mockFetch.mockRejectedValueOnce(new Error('fetch failed'));
      mockFetchSuccess(makeBalanceResponse());

      const result = await client.getBalance();

      expect(result.balance).toBe(250.00);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('exhausts retries and throws on persistent failure', async () => {
      // 4 failures (initial + 3 retries)
      mockFetch.mockRejectedValueOnce(new Error('fetch failed'));
      mockFetch.mockRejectedValueOnce(new Error('fetch failed'));
      mockFetch.mockRejectedValueOnce(new Error('fetch failed'));
      mockFetch.mockRejectedValueOnce(new Error('fetch failed'));

      await expect(client.getBalance()).rejects.toThrow('fetch failed');
      expect(mockFetch).toHaveBeenCalledTimes(4);
    });
  });

  // ─── Exported Helpers ─────────────────────────────────────

  describe('classifyError', () => {
    it('classifies with status code', () => {
      const err = classifyError(new Error('test'), 401);
      expect(err.code).toBe('BITREFILL_401');
      expect(err.retryable).toBe(false);
    });

    it('classifies 429 as retryable', () => {
      const err = classifyError(new Error('test'), 429);
      expect(err.code).toBe('BITREFILL_429');
      expect(err.retryable).toBe(true);
    });

    it('classifies 500 as retryable', () => {
      const err = classifyError(new Error('test'), 500);
      expect(err.code).toBe('BITREFILL_500');
      expect(err.retryable).toBe(true);
    });

    it('classifies without status code', () => {
      const err = classifyError(new Error('connection timeout'));
      expect(err.code).toBe('BITREFILL_ERROR');
      expect(err.retryable).toBe(true);
    });
  });

  describe('isRetryableStatus', () => {
    it('returns true for 429', () => expect(isRetryableStatus(429)).toBe(true));
    it('returns true for 500', () => expect(isRetryableStatus(500)).toBe(true));
    it('returns true for 502', () => expect(isRetryableStatus(502)).toBe(true));
    it('returns true for 503', () => expect(isRetryableStatus(503)).toBe(true));
    it('returns false for 400', () => expect(isRetryableStatus(400)).toBe(false));
    it('returns false for 401', () => expect(isRetryableStatus(401)).toBe(false));
    it('returns false for 404', () => expect(isRetryableStatus(404)).toBe(false));
  });

  describe('isRetryableError', () => {
    it('returns true for rate limit error', () => {
      expect(isRetryableError(new Error('rate limit exceeded'))).toBe(true);
    });
    it('returns true for timeout error', () => {
      expect(isRetryableError(new Error('request timeout'))).toBe(true);
    });
    it('returns true for fetch failed', () => {
      expect(isRetryableError(new Error('fetch failed'))).toBe(true);
    });
    it('returns true for network error', () => {
      expect(isRetryableError(new Error('network error'))).toBe(true);
    });
    it('returns false for non-Error', () => {
      expect(isRetryableError('just a string')).toBe(false);
    });
  });
});
