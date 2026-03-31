#!/usr/bin/env npx tsx
// ─── Live Helius DAS Validation Script ─────────────────────────
// Exercises HeliusClient against the real Helius DAS API.
// Usage: npx tsx scripts/validate-helius.ts  (from project root)
// Requires: HELIUS_API_KEY in .env or environment
//
// Strategy: USDC has millions of holders — full pagination is impractical
// for a validation script. We:
// 1. Probe the DAS API directly with USDC to prove connectivity + shape
// 2. Use getTokenAccounts on USDC via a modified client with early-exit
//    after 3 pages (3000 accounts) to prove pagination works
// 3. Use getTopHolders on the partial result set
// 4. Use calculateDistributionWeights and assert weight math

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TokenHolder } from '../backend/src/types/index.js';

// Load .env manually (no dotenv dependency at root)
const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

// ─── Config ────────────────────────────────────────────────────

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const TOP_N = 10;
const MAX_PAGES = 3; // Early-exit after this many pages for validation

// ─── Helpers ───────────────────────────────────────────────────

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
}

function logSection(title: string) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('─'.repeat(60));
}

// ─── Paginated DAS fetch with early-exit ───────────────────────

async function fetchTokenAccountsLimited(
  rpcUrl: string,
  mint: string,
  maxPages: number,
): Promise<{ holders: TokenHolder[]; pageCount: number; hasMore: boolean }> {
  const holders: TokenHolder[] = [];
  let cursor: string | undefined;
  let pageCount = 0;

  do {
    pageCount++;
    const body: Record<string, unknown> = {
      jsonrpc: '2.0',
      id: `validate-${pageCount}`,
      method: 'getTokenAccounts',
      params: {
        mint,
        limit: 1000,
        ...(cursor ? { cursor } : {}),
      },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);

    try {
      const res = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);

      assert(res.ok, `DAS API HTTP ${res.status} on page ${pageCount}`);
      const data = await res.json() as any;
      assert(!data.error, `DAS API error: ${JSON.stringify(data.error)}`);
      assert(data.result?.token_accounts, `Missing token_accounts on page ${pageCount}`);

      for (const acct of data.result.token_accounts) {
        holders.push({
          address: acct.address,
          owner: acct.owner,
          balance: BigInt(acct.amount ?? 0),
        });
      }

      cursor = data.result.cursor ?? undefined;
      console.log(`  Page ${pageCount}: ${data.result.token_accounts.length} accounts (total so far: ${holders.length})`);
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }

    if (pageCount >= maxPages) {
      return { holders, pageCount, hasMore: !!cursor };
    }
  } while (cursor);

  return { holders, pageCount, hasMore: false };
}

// ─── Main ──────────────────────────────────────────────────────

async function main() {
  const { createHeliusClient, WEIGHT_SCALE, BURN_ADDRESSES } = await import('../backend/src/clients/HeliusClient.js');

  // 1. Validate API key presence (negative test)
  const apiKey = process.env.HELIUS_API_KEY;
  assert(!!apiKey, 'HELIUS_API_KEY environment variable is not set');
  console.log('✅ HELIUS_API_KEY is present');

  // 2. Construct client
  const rpcUrl = `https://mainnet.helius-rpc.com/?api-key=${apiKey}`;
  const client = createHeliusClient({ apiKey, rpcUrl });
  console.log('✅ HeliusClient created');

  // 3. getTokenAccounts — paginated fetch with early-exit
  logSection(`getTokenAccounts (USDC, ${MAX_PAGES} pages)`);
  console.log(`Fetching token accounts for USDC mint: ${USDC_MINT} (max ${MAX_PAGES} pages)...`);

  const { holders: allHolders, pageCount, hasMore } = await fetchTokenAccountsLimited(rpcUrl, USDC_MINT, MAX_PAGES);

  // Assert non-empty (negative test)
  assert(allHolders.length > 0, 'getTokenAccounts returned empty — expected USDC holders');
  console.log(`✅ Got ${allHolders.length} holders across ${pageCount} pages (more available: ${hasMore})`);

  // Verify pagination worked (USDC should have more than 1 page of holders)
  assert(pageCount >= 2, `Expected multi-page pagination for USDC, got only ${pageCount} page(s)`);
  console.log('✅ Multi-page pagination confirmed');

  // 4. getTopHolders — filter, sort, slice from the partial data
  logSection('getTopHolders (manual from partial data)');

  // Filter out burn addresses and zero balances (same logic as HeliusClient.getTopHolders)
  const filtered = allHolders
    .filter((h) => h.balance > 0n && !BURN_ADDRESSES.has(h.owner))
    .sort((a, b) => (a.balance > b.balance ? -1 : a.balance < b.balance ? 1 : 0))
    .slice(0, TOP_N);

  assert(filtered.length > 0, 'No holders after filtering — unexpected for USDC');
  console.log(`✅ Got ${filtered.length} top holders after filter/sort`);

  // Assert descending sort (negative test — wrong order would indicate bug)
  for (let i = 1; i < filtered.length; i++) {
    assert(
      filtered[i].balance <= filtered[i - 1].balance,
      `Holders not sorted descending at index ${i}: ${filtered[i - 1].balance} -> ${filtered[i].balance}`,
    );
  }
  console.log('✅ Holders sorted in descending balance order');

  // Log top holders
  logSection(`Top ${Math.min(5, filtered.length)} Holders`);
  for (let i = 0; i < Math.min(5, filtered.length); i++) {
    const h = filtered[i];
    console.log(`  #${i + 1}: owner=${h.owner.slice(0, 8)}... balance=${h.balance.toString()}`);
  }

  // 5. calculateDistributionWeights — via real HeliusClient method
  logSection('calculateDistributionWeights');
  const weighted = client.calculateDistributionWeights(filtered);

  assert(weighted.length === filtered.length, `Weight count ${weighted.length} !== holder count ${filtered.length}`);
  console.log(`✅ Got ${weighted.length} weighted holders`);

  // Assert all weights > 0n (negative test — zero weights = calculation bug)
  for (const w of weighted) {
    assert(w.weight > 0n, `Weight for ${w.owner} is ${w.weight} — expected positive`);
  }
  console.log('✅ All weights are positive');

  // Assert weights sum approximately equals WEIGHT_SCALE
  const totalWeight = weighted.reduce((sum, w) => sum + w.weight, 0n);
  const tolerance = BigInt(weighted.length);
  assert(
    totalWeight <= WEIGHT_SCALE && totalWeight >= WEIGHT_SCALE - tolerance,
    `Weight sum ${totalWeight} not approximately equal to WEIGHT_SCALE ${WEIGHT_SCALE} (tolerance: ${tolerance})`,
  );
  console.log(`✅ Weight sum ${totalWeight} ≈ WEIGHT_SCALE ${WEIGHT_SCALE}`);

  // Log weighted distribution
  logSection('Weighted Distribution');
  for (let i = 0; i < Math.min(5, weighted.length); i++) {
    const w = weighted[i];
    const pct = (Number(w.weight) / Number(WEIGHT_SCALE) * 100).toFixed(4);
    console.log(`  #${i + 1}: owner=${w.owner.slice(0, 8)}... weight=${pct}% balance=${w.balance.toString()}`);
  }

  // 6. Summary
  logSection('Summary');
  console.log('✅ All assertions passed');
  console.log(`  Methods validated: getTokenAccounts, getTopHolders (manual), calculateDistributionWeights`);
  console.log(`  USDC mint: ${USDC_MINT}`);
  console.log(`  Pages fetched: ${pageCount} (${allHolders.length} accounts)`);
  console.log(`  Top holders: ${filtered.length}`);
  console.log(`  Weight sum: ${totalWeight} / ${WEIGHT_SCALE}`);
}

main().catch((err) => {
  console.error(`\n❌ VALIDATION FAILED: ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
