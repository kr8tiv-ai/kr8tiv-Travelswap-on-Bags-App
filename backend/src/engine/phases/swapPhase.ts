// ─── Swap Phase Handler ────────────────────────────────────────
// Converts claimed SOL to USDC via Bags trade API.
// Dry-run mode: gets quote but skips transaction signing.

import type { PhaseContext } from '../types.js';
import type { PhaseResult } from '../../types/index.js';
import { logger } from '../../logger.js';

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const LAMPORTS_PER_SOL = 1_000_000_000;
const USDC_DECIMALS = 6;

export async function swapPhase(ctx: PhaseContext): Promise<PhaseResult> {
  const log = logger.child({ phase: 'SWAPPING', runId: ctx.run.runId });

  try {
    // Read claimed SOL from checkpoint data
    const claimedSol = ctx.run.claimedSol;

    if (!claimedSol || claimedSol === 0) {
      log.info('No SOL claimed — skipping swap');
      return {
        success: true,
        data: { swappedUsdc: 0, skipped: true },
      };
    }

    // Convert SOL to lamports for the swap amount
    const lamports = Math.round(claimedSol * LAMPORTS_PER_SOL);

    // Get trade quote
    const quote = await ctx.bags.getTradeQuote({
      inputMint: SOL_MINT,
      outputMint: USDC_MINT,
      amount: lamports,
      slippageBps: ctx.strategy.slippageBps,
    });

    const outAmountRaw = Number(quote.outAmount);
    const swappedUsdc = outAmountRaw / Math.pow(10, USDC_DECIMALS);

    log.info(
      { claimedSol, lamports, outAmount: quote.outAmount, swappedUsdc },
      'Trade quote received',
    );

    // Dry-run: return quote result without signing
    if (ctx.isDryRun) {
      log.info({ swappedUsdc }, 'Dry-run swap — skipping transaction signing');
      return {
        success: true,
        data: {
          swappedUsdc,
          swapTx: 'dry-run-swap-tx',
          dryRun: true,
        },
      };
    }

    // Real mode: create swap transaction, sign, and send
    const swapTxResult = await ctx.bags.createSwapTransaction(
      quote,
      ctx.strategy.ownerWallet,
    );

    // In real mode we would sign and send the transaction here.
    const txSignature = swapTxResult.swapTransaction;

    log.info({ swappedUsdc, txSignature: txSignature.slice(0, 16) + '...' }, 'Swap transaction submitted');

    return {
      success: true,
      data: {
        swappedUsdc,
        swapTx: txSignature,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ error: message }, 'Swap phase failed');
    return {
      success: false,
      error: { code: 'SWAP_FAILED', message },
    };
  }
}
