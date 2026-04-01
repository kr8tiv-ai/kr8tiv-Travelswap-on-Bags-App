// ─── Allocate Phase Handler ────────────────────────────────────
// Distributes USDC to holder travel balances based on the
// strategy's distributionMode. Snapshots holders via HeliusClient,
// calculates distribution per mode, and credits TravelBalanceService.

import { logger } from '../../logger.js';
import type { PhaseContext } from '../types.js';
import type { PhaseResult, DistributionMode, TokenHolder, CustomAllocation } from '../../types/index.js';
import type { WeightedHolder } from '../../clients/HeliusClient.js';

const log = logger.child({ component: 'allocatePhase' });

export async function allocatePhase(ctx: PhaseContext): Promise<PhaseResult> {
  const swappedUsdc = ctx.run.swappedUsdc;

  // ── Nothing to allocate ──────────────────────────────────────
  if (!swappedUsdc || swappedUsdc <= 0) {
    log.info({ runId: ctx.run.runId }, 'No USDC to allocate — skipping');
    return { success: true, data: { allocatedUsd: 0, holderCount: 0 } };
  }

  // ── Guard: TravelBalanceService is always required ───────────
  if (!ctx.travelBalanceService) {
    return {
      success: false,
      error: {
        code: 'MISSING_DEPENDENCY',
        message: 'TravelBalanceService is required for allocation but not available in context',
      },
    };
  }

  // ── Guard: HeliusClient is required for holder-based modes ───
  const needsHelius = !['OWNER_ONLY', 'CUSTOM_LIST'].includes(ctx.strategy.distributionMode);
  if (needsHelius && !ctx.helius) {
    return {
      success: false,
      error: {
        code: 'MISSING_DEPENDENCY',
        message: 'HeliusClient is required for allocation but not available in context',
      },
    };
  }

  const { travelBalanceService } = ctx;
  const { strategy } = ctx;
  const strategyId = Number(strategy.strategyId);

  // ── Build allocation map based on distribution mode ──────────
  let allocations: Array<{ wallet: string; amount: number }>;

  try {
    allocations = await buildAllocations(
      strategy.distributionMode,
      strategy.ownerWallet,
      strategy.tokenMint,
      strategy.distributionTopN,
      swappedUsdc,
      ctx.helius ?? null,
      strategy.customAllocations,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ runId: ctx.run.runId, error: message }, 'Failed to build allocation map');
    return {
      success: false,
      error: { code: 'HELIUS_ERROR', message },
    };
  }

  // ── Credit each recipient's travel balance ───────────────────
  let totalAllocated = 0;

  for (const { wallet, amount } of allocations) {
    if (amount <= 0) continue;
    try {
      await travelBalanceService.allocate(strategyId, wallet, amount);
      totalAllocated += amount;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error({ runId: ctx.run.runId, wallet, amount, error: message }, 'Balance allocation failed');
      return {
        success: false,
        error: { code: 'BALANCE_ERROR', message },
      };
    }
  }

  log.info(
    { runId: ctx.run.runId, totalAllocated, holderCount: allocations.length },
    'Allocation complete',
  );

  return {
    success: true,
    data: { allocatedUsd: totalAllocated, holderCount: allocations.length },
  };
}

// ─── Distribution Logic ──────────────────────────────────────────

async function buildAllocations(
  mode: DistributionMode,
  ownerWallet: string,
  tokenMint: string,
  topN: number,
  totalUsdc: number,
  helius: NonNullable<PhaseContext['helius']> | null,
  customAllocations: CustomAllocation[] | null | undefined,
): Promise<Array<{ wallet: string; amount: number }>> {
  switch (mode) {
    case 'OWNER_ONLY':
      return [{ wallet: ownerWallet, amount: totalUsdc }];

    case 'EQUAL_SPLIT': {
      const holders = await helius!.getTopHolders(tokenMint, Number.MAX_SAFE_INTEGER);
      if (holders.length === 0) {
        return [{ wallet: ownerWallet, amount: totalUsdc }];
      }
      const share = totalUsdc / holders.length;
      return holders.map((h) => ({ wallet: h.owner, amount: share }));
    }

    case 'TOP_N_HOLDERS': {
      const holders = await helius!.getTopHolders(tokenMint, topN);
      if (holders.length === 0) {
        return [{ wallet: ownerWallet, amount: totalUsdc }];
      }
      return weightedAllocations(holders, totalUsdc, helius!);
    }

    case 'WEIGHTED_BY_HOLDINGS': {
      const holders = await helius!.getTopHolders(tokenMint, Number.MAX_SAFE_INTEGER);
      if (holders.length === 0) {
        return [{ wallet: ownerWallet, amount: totalUsdc }];
      }
      return weightedAllocations(holders, totalUsdc, helius!);
    }

    case 'CUSTOM_LIST': {
      if (!customAllocations || customAllocations.length === 0) {
        log.warn(
          { mode, ownerWallet },
          'CUSTOM_LIST with no custom allocations — falling back to OWNER_ONLY',
        );
        return [{ wallet: ownerWallet, amount: totalUsdc }];
      }
      return customAllocations.map((a) => ({
        wallet: a.wallet,
        amount: (a.percentage / 100) * totalUsdc,
      }));
    }

    default: {
      // Exhaustiveness guard
      const _exhaustive: never = mode;
      throw new Error(`Unknown distribution mode: ${_exhaustive}`);
    }
  }
}

/** Convert weighted holders into USDC allocation amounts using BigInt precision. */
function weightedAllocations(
  holders: TokenHolder[],
  totalUsdc: number,
  helius: NonNullable<PhaseContext['helius']>,
): Array<{ wallet: string; amount: number }> {
  const weighted: WeightedHolder[] = helius.calculateDistributionWeights(holders);
  const SCALE = 10n ** 18n;
  // Convert totalUsdc to scaled BigInt, divide by weight, convert back
  const totalScaled = BigInt(Math.round(totalUsdc * 1e6)); // 6-decimal USDC precision

  return weighted.map((w) => ({
    wallet: w.owner,
    amount: Number((totalScaled * w.weight) / SCALE) / 1e6,
  }));
}
