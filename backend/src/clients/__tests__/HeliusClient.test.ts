import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createHeliusClient,
  BURN_ADDRESSES,
  WEIGHT_SCALE,
  type HeliusClient,
  type HeliusClientConfig,
} from '../HeliusClient.js';

// ─── Helpers ───────────────────────────────────────────────────

const TEST_CONFIG: HeliusClientConfig = {
  apiKey: 'test-key',
  rpcUrl: 'https://rpc.helius.xyz/?api-key=test-key',
  fetchTimeoutMs: 5_000,
};

const VALID_MINT = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const BURN_ADDR = '1nc1nerator11111111111111111111111111111111';
const DEAD_ADDR = 'Dead111111111111111111111111111111111111111';

/** Build a DAS `getTokenAccounts` success response. */
function dasResponse(
  accounts: Array<{ address: string; owner: string; amount: number }>,
  cursor?: string,
) {
  return {
    jsonrpc: '2.0',
    id: 'helius-gta-1',
    result: {
      total: accounts.length,
      limit: 1000,
      ...(cursor ? { cursor } : {}),
      token_accounts: accounts,
    },
  };
}

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain' } });
}

// ─── Test Suite ────────────────────────────────────────────────

describe('HeliusClient', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let client: HeliusClient;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      okJson(dasResponse([])),
    );
    client = createHeliusClient(TEST_CONFIG);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── Factory / Config ──────────────────────────────────────

  describe('createHeliusClient', () => {
    it('throws if apiKey is empty', () => {
      expect(() => createHeliusClient({ ...TEST_CONFIG, apiKey: '' })).toThrow(
        'apiKey is required',
      );
    });

    it('throws if rpcUrl is empty', () => {
      expect(() => createHeliusClient({ ...TEST_CONFIG, rpcUrl: '' })).toThrow(
        'rpcUrl is required',
      );
    });
  });

  // ─── getTokenAccounts ──────────────────────────────────────

  describe('getTokenAccounts', () => {
    it('returns empty array when API returns zero accounts', async () => {
      fetchSpy.mockResolvedValueOnce(okJson(dasResponse([])));
      const result = await client.getTokenAccounts(VALID_MINT);
      expect(result).toEqual([]);
    });

    it('maps accounts to TokenHolder with BigInt balances', async () => {
      const accounts = [
        { address: 'ata1', owner: 'ownerA', amount: 1_000_000 },
        { address: 'ata2', owner: 'ownerB', amount: 500_000 },
      ];
      fetchSpy.mockResolvedValueOnce(okJson(dasResponse(accounts)));

      const result = await client.getTokenAccounts(VALID_MINT);
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        address: 'ata1',
        owner: 'ownerA',
        balance: 1_000_000n,
      });
      expect(result[1]).toEqual({
        address: 'ata2',
        owner: 'ownerB',
        balance: 500_000n,
      });
    });

    it('paginates with cursor until no more pages', async () => {
      const page1 = dasResponse(
        [{ address: 'ata1', owner: 'ownerA', amount: 100 }],
        'cursor-page2',
      );
      const page2 = dasResponse([
        { address: 'ata2', owner: 'ownerB', amount: 200 },
      ]);

      fetchSpy
        .mockResolvedValueOnce(okJson(page1))
        .mockResolvedValueOnce(okJson(page2));

      const result = await client.getTokenAccounts(VALID_MINT);
      expect(result).toHaveLength(2);
      expect(result[0].owner).toBe('ownerA');
      expect(result[1].owner).toBe('ownerB');

      // Verify two fetch calls were made
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      // Verify second call includes cursor
      const secondCallBody = JSON.parse(
        fetchSpy.mock.calls[1][1]!.body as string,
      );
      expect(secondCallBody.params.cursor).toBe('cursor-page2');
    });

    it('sends correct RPC payload structure', async () => {
      fetchSpy.mockResolvedValueOnce(okJson(dasResponse([])));
      await client.getTokenAccounts(VALID_MINT);

      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe(TEST_CONFIG.rpcUrl);
      expect(init!.method).toBe('POST');

      const body = JSON.parse(init!.body as string);
      expect(body.jsonrpc).toBe('2.0');
      expect(body.method).toBe('getTokenAccounts');
      expect(body.params.mint).toBe(VALID_MINT);
      expect(body.params.limit).toBe(1_000);
    });
  });

  // ─── Malformed Inputs ──────────────────────────────────────

  describe('malformed inputs', () => {
    it('throws on empty mint string', async () => {
      await expect(client.getTokenAccounts('')).rejects.toThrow(
        'mint address cannot be empty',
      );
    });

    it('throws on invalid mint format', async () => {
      await expect(client.getTokenAccounts('not-valid!!!')).rejects.toThrow(
        'invalid mint address',
      );
    });
  });

  // ─── Error Paths ───────────────────────────────────────────

  describe('error paths', () => {
    it('throws on HTTP 429 rate limit', async () => {
      fetchSpy.mockResolvedValueOnce(
        errorResponse(429, 'Too Many Requests'),
      );
      await expect(client.getTokenAccounts(VALID_MINT)).rejects.toThrow(
        'HTTP 429',
      );
    });

    it('throws on HTTP 500 server error', async () => {
      fetchSpy.mockResolvedValueOnce(
        errorResponse(500, 'Internal Server Error'),
      );
      await expect(client.getTokenAccounts(VALID_MINT)).rejects.toThrow(
        'HTTP 500',
      );
    });

    it('throws on network timeout with descriptive message', async () => {
      fetchSpy.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            const err = new DOMException('The operation was aborted', 'AbortError');
            setTimeout(() => reject(err), 10);
          }),
      );

      await expect(client.getTokenAccounts(VALID_MINT)).rejects.toThrow(
        /timed out/,
      );
    });

    it('throws on malformed JSON response', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response('not json at all {{{', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      await expect(client.getTokenAccounts(VALID_MINT)).rejects.toThrow(
        'malformed JSON',
      );
    });

    it('throws when result.token_accounts is missing', async () => {
      fetchSpy.mockResolvedValueOnce(
        okJson({ jsonrpc: '2.0', id: '1', result: {} }),
      );
      await expect(client.getTokenAccounts(VALID_MINT)).rejects.toThrow(
        'missing result.token_accounts',
      );
    });

    it('throws on DAS API error response', async () => {
      fetchSpy.mockResolvedValueOnce(
        okJson({
          jsonrpc: '2.0',
          id: '1',
          error: { code: -32600, message: 'Invalid request' },
        }),
      );
      await expect(client.getTokenAccounts(VALID_MINT)).rejects.toThrow(
        'DAS API error -32600',
      );
    });

    it('throws on general network error', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      await expect(client.getTokenAccounts(VALID_MINT)).rejects.toThrow(
        'network error',
      );
    });
  });

  // ─── getTopHolders ─────────────────────────────────────────

  describe('getTopHolders', () => {
    it('returns top N holders sorted by balance descending', async () => {
      const accounts = [
        { address: 'ata1', owner: 'small', amount: 100 },
        { address: 'ata2', owner: 'big', amount: 10_000 },
        { address: 'ata3', owner: 'medium', amount: 5_000 },
      ];
      fetchSpy.mockResolvedValueOnce(okJson(dasResponse(accounts)));

      const result = await client.getTopHolders(VALID_MINT, 2);
      expect(result).toHaveLength(2);
      expect(result[0].owner).toBe('big');
      expect(result[1].owner).toBe('medium');
    });

    it('excludes burn addresses by default', async () => {
      const accounts = [
        { address: 'ata1', owner: 'legit', amount: 1000 },
        { address: 'ata2', owner: BURN_ADDR, amount: 999_999 },
        { address: 'ata3', owner: DEAD_ADDR, amount: 888_888 },
      ];
      fetchSpy.mockResolvedValueOnce(okJson(dasResponse(accounts)));

      const result = await client.getTopHolders(VALID_MINT, 10);
      expect(result).toHaveLength(1);
      expect(result[0].owner).toBe('legit');
    });

    it('excludes zero-balance accounts', async () => {
      const accounts = [
        { address: 'ata1', owner: 'active', amount: 500 },
        { address: 'ata2', owner: 'empty', amount: 0 },
      ];
      fetchSpy.mockResolvedValueOnce(okJson(dasResponse(accounts)));

      const result = await client.getTopHolders(VALID_MINT, 10);
      expect(result).toHaveLength(1);
      expect(result[0].owner).toBe('active');
    });

    it('accepts custom exclude set', async () => {
      const accounts = [
        { address: 'ata1', owner: 'treasury', amount: 999 },
        { address: 'ata2', owner: 'user', amount: 100 },
      ];
      fetchSpy.mockResolvedValueOnce(okJson(dasResponse(accounts)));

      const customExclude = new Set(['treasury']);
      const result = await client.getTopHolders(VALID_MINT, 10, customExclude);
      expect(result).toHaveLength(1);
      expect(result[0].owner).toBe('user');
    });

    it('returns empty array when all holders are filtered out', async () => {
      const accounts = [
        { address: 'ata1', owner: BURN_ADDR, amount: 1000 },
        { address: 'ata2', owner: 'zero', amount: 0 },
      ];
      fetchSpy.mockResolvedValueOnce(okJson(dasResponse(accounts)));

      const result = await client.getTopHolders(VALID_MINT, 10);
      expect(result).toHaveLength(0);
    });

    it('returns empty array when zero holders exist', async () => {
      fetchSpy.mockResolvedValueOnce(okJson(dasResponse([])));
      const result = await client.getTopHolders(VALID_MINT, 10);
      expect(result).toHaveLength(0);
    });
  });

  // ─── calculateDistributionWeights ──────────────────────────

  describe('calculateDistributionWeights', () => {
    it('calculates proportional weights with BigInt precision', () => {
      const holders = [
        { address: 'a1', owner: 'ownerA', balance: 750n },
        { address: 'a2', owner: 'ownerB', balance: 250n },
      ];

      const result = client.calculateDistributionWeights(holders);
      expect(result).toHaveLength(2);

      // ownerA: 750/1000 = 0.75 → 75% of WEIGHT_SCALE
      expect(result[0].weight).toBe((750n * WEIGHT_SCALE) / 1000n);
      expect(result[0].owner).toBe('ownerA');
      expect(result[0].balance).toBe(750n);

      // ownerB: 250/1000 = 0.25 → 25% of WEIGHT_SCALE
      expect(result[1].weight).toBe((250n * WEIGHT_SCALE) / 1000n);
    });

    it('weights sum close to WEIGHT_SCALE (within BigInt rounding)', () => {
      // 3-way split with non-trivial values to test rounding
      const holders = [
        { address: 'a1', owner: 'A', balance: 333n },
        { address: 'a2', owner: 'B', balance: 333n },
        { address: 'a3', owner: 'C', balance: 334n },
      ];

      const result = client.calculateDistributionWeights(holders);
      const totalWeight = result.reduce((sum, h) => sum + h.weight, 0n);

      // With integer division, sum will be slightly less than WEIGHT_SCALE
      // The error should be negligible (< holders.length wei)
      expect(totalWeight).toBeLessThanOrEqual(WEIGHT_SCALE);
      expect(WEIGHT_SCALE - totalWeight).toBeLessThan(BigInt(holders.length));
    });

    it('single holder gets full weight', () => {
      const holders = [{ address: 'a1', owner: 'solo', balance: 42n }];
      const result = client.calculateDistributionWeights(holders);
      expect(result[0].weight).toBe(WEIGHT_SCALE);
    });

    it('returns empty array for empty input', () => {
      expect(client.calculateDistributionWeights([])).toEqual([]);
    });

    it('returns empty array when all balances are zero', () => {
      const holders = [
        { address: 'a1', owner: 'A', balance: 0n },
        { address: 'a2', owner: 'B', balance: 0n },
      ];
      expect(client.calculateDistributionWeights(holders)).toEqual([]);
    });

    it('handles very large token balances without overflow', () => {
      // Simulate a token with huge supply (18-decimal token, ~1 billion tokens)
      const huge = 1_000_000_000n * 10n ** 18n;
      const holders = [
        { address: 'a1', owner: 'whale', balance: huge },
        { address: 'a2', owner: 'minnow', balance: 1n },
      ];
      const result = client.calculateDistributionWeights(holders);
      expect(result[0].weight).toBeGreaterThan(0n);
      expect(result[1].weight).toBe(0n); // minnow is negligible at this scale
    });
  });

  // ─── BURN_ADDRESSES ────────────────────────────────────────

  describe('BURN_ADDRESSES', () => {
    it('contains the incinerator address', () => {
      expect(BURN_ADDRESSES.has('1nc1nerator11111111111111111111111111111111')).toBe(true);
    });

    it('contains the Dead address', () => {
      expect(BURN_ADDRESSES.has('Dead111111111111111111111111111111111111111')).toBe(true);
    });
  });
});
