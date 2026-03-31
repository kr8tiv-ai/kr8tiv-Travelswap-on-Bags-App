// ─── HeliusClient ──────────────────────────────────────────────
// DAS API client for snapshotting token holders and calculating
// distribution weights. Uses cursor-based pagination to collect
// all token accounts for a given mint via getTokenAccounts.

import { logger } from '../logger.js';
import type { HeliusConfig, TokenHolder } from '../types/index.js';

// ─── Constants ─────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 30_000;
const DAS_PAGE_LIMIT = 1_000;

/** BigInt scale factor for 18-decimal-place weight precision. */
export const WEIGHT_SCALE = 10n ** 18n;

/** Well-known burn / protocol addresses to exclude from holder lists. */
export const BURN_ADDRESSES: ReadonlySet<string> = new Set([
  '1nc1nerator11111111111111111111111111111111',
  'Dead111111111111111111111111111111111111111',
]);

// ─── Types ─────────────────────────────────────────────────────

export interface WeightedHolder {
  owner: string;
  weight: bigint;
  balance: bigint;
}

/** Shape returned by the Helius DAS `getTokenAccounts` method. */
interface DasTokenAccountsResponse {
  result?: {
    total?: number;
    limit?: number;
    cursor?: string;
    token_accounts?: Array<{
      address: string;
      owner: string;
      amount: number;
    }>;
  };
  error?: { code: number; message: string };
}

export interface HeliusClient {
  getTokenAccounts(mint: string): Promise<TokenHolder[]>;
  getTopHolders(
    mint: string,
    topN: number,
    excludeAddresses?: ReadonlySet<string>,
  ): Promise<TokenHolder[]>;
  calculateDistributionWeights(holders: TokenHolder[]): WeightedHolder[];
}

// ─── Config ────────────────────────────────────────────────────

export interface HeliusClientConfig extends HeliusConfig {
  /** Override fetch timeout in ms (default 30 000). */
  fetchTimeoutMs?: number;
}

// ─── Validation ────────────────────────────────────────────────

function validateMint(mint: string): void {
  if (!mint || mint.trim() === '') {
    throw new Error('HeliusClient: mint address cannot be empty');
  }
  // Solana addresses are base-58, 32–44 chars
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) {
    throw new Error(`HeliusClient: invalid mint address "${mint}"`);
  }
}

// ─── Factory ───────────────────────────────────────────────────

export function createHeliusClient(config: HeliusClientConfig): HeliusClient {
  const log = logger.child({ component: 'HeliusClient' });

  if (!config.apiKey) throw new Error('HeliusClient: apiKey is required');
  if (!config.rpcUrl) throw new Error('HeliusClient: rpcUrl is required');

  const timeoutMs = config.fetchTimeoutMs ?? FETCH_TIMEOUT_MS;

  // ─── getTokenAccounts ──────────────────────────────────────

  async function getTokenAccounts(mint: string): Promise<TokenHolder[]> {
    validateMint(mint);

    const start = Date.now();
    const holders: TokenHolder[] = [];
    let cursor: string | undefined;
    let pageCount = 0;

    do {
      pageCount++;
      const body: Record<string, unknown> = {
        jsonrpc: '2.0',
        id: `helius-gta-${pageCount}`,
        method: 'getTokenAccounts',
        params: {
          mint,
          limit: DAS_PAGE_LIMIT,
          ...(cursor ? { cursor } : {}),
        },
      };

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      let res: Response;
      try {
        res = await fetch(config.rpcUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (err: unknown) {
        clearTimeout(timer);
        if (err instanceof DOMException && err.name === 'AbortError') {
          throw new Error(
            `HeliusClient: getTokenAccounts timed out after ${timeoutMs}ms for mint ${mint}`,
          );
        }
        throw new Error(
          `HeliusClient: network error fetching token accounts for mint ${mint} — ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        clearTimeout(timer);
      }

      if (!res.ok) {
        let bodyExcerpt = '';
        try {
          const text = await res.text();
          bodyExcerpt = text.slice(0, 200);
        } catch { /* ignore */ }
        throw new Error(
          `HeliusClient: getTokenAccounts HTTP ${res.status} for mint ${mint} — ${bodyExcerpt}`,
        );
      }

      let data: DasTokenAccountsResponse;
      try {
        data = (await res.json()) as DasTokenAccountsResponse;
      } catch {
        throw new Error(
          `HeliusClient: malformed JSON response from getTokenAccounts for mint ${mint}`,
        );
      }

      if (data.error) {
        throw new Error(
          `HeliusClient: DAS API error ${data.error.code} — ${data.error.message} (mint: ${mint})`,
        );
      }

      if (!data.result || !data.result.token_accounts) {
        throw new Error(
          `HeliusClient: missing result.token_accounts in response for mint ${mint}`,
        );
      }

      for (const acct of data.result.token_accounts) {
        holders.push({
          address: acct.address,
          owner: acct.owner,
          balance: BigInt(acct.amount ?? 0),
        });
      }

      cursor = data.result.cursor ?? undefined;
    } while (cursor);

    const durationMs = Date.now() - start;
    log.info(
      { method: 'getTokenAccounts', mint, pageCount, holderCount: holders.length, durationMs },
      'Fetched token accounts',
    );

    return holders;
  }

  // ─── getTopHolders ─────────────────────────────────────────

  async function getTopHolders(
    mint: string,
    topN: number,
    excludeAddresses: ReadonlySet<string> = BURN_ADDRESSES,
  ): Promise<TokenHolder[]> {
    const allHolders = await getTokenAccounts(mint);

    const filtered = allHolders.filter(
      (h) => h.balance > 0n && !excludeAddresses.has(h.owner),
    );

    filtered.sort((a, b) => {
      if (a.balance > b.balance) return -1;
      if (a.balance < b.balance) return 1;
      return 0;
    });

    const result = filtered.slice(0, topN);

    log.info(
      {
        method: 'getTopHolders',
        mint,
        topN,
        totalRaw: allHolders.length,
        afterFilter: filtered.length,
        returned: result.length,
      },
      'Filtered top holders',
    );

    return result;
  }

  // ─── calculateDistributionWeights ──────────────────────────

  function calculateDistributionWeights(holders: TokenHolder[]): WeightedHolder[] {
    if (holders.length === 0) return [];

    const totalBalance = holders.reduce((sum, h) => sum + h.balance, 0n);
    if (totalBalance === 0n) return [];

    return holders.map((h) => ({
      owner: h.owner,
      weight: (h.balance * WEIGHT_SCALE) / totalBalance,
      balance: h.balance,
    }));
  }

  return {
    getTokenAccounts,
    getTopHolders,
    calculateDistributionWeights,
  };
}
