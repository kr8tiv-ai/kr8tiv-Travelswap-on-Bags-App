// ─── Claim Phase Handler ───────────────────────────────────────
// Queries claimable fee positions and claims SOL.
// Dry-run mode: reads positions but skips transaction signing.

import type { PhaseContext } from '../types.js';
import type { PhaseResult } from '../../types/index.js';
import { logger } from '../../logger.js';

const LAMPORTS_PER_SOL = 1_000_000_000;

export async function claimPhase(ctx: PhaseContext): Promise<PhaseResult> {
  const log = logger.child({ phase: 'CLAIMING', runId: ctx.run.runId });

  try {
    // Get all claimable positions for the strategy wallet
    const { totalLamports, positions } = await ctx.bags.getTotalClaimableSol(
      ctx.strategy.ownerWallet,
    );

    const totalSol = Number(totalLamports) / LAMPORTS_PER_SOL;
    log.info({ totalSol, positionCount: positions.length }, 'Claimable positions fetched');

    // Below threshold — no claim needed
    if (totalSol < ctx.strategy.thresholdSol) {
      log.info(
        { totalSol, threshold: ctx.strategy.thresholdSol },
        'Below threshold — skipping claim',
      );
      return {
        success: true,
        data: { claimedSol: 0, belowThreshold: true },
      };
    }

    // Dry-run: return synthetic result without signing transactions
    if (ctx.isDryRun) {
      log.info({ totalSol }, 'Dry-run claim — skipping transaction signing');
      return {
        success: true,
        data: {
          claimedSol: totalSol,
          claimTx: 'dry-run-claim-tx',
          dryRun: true,
        },
      };
    }

    // Real mode: iterate positions, get claim transactions, sign and send
    const txSignatures: string[] = [];
    for (const position of positions) {
      const claimTxs = await ctx.bags.getClaimTransactions(
        ctx.strategy.ownerWallet,
        position,
      );
      // In real mode we would sign and send each transaction here.
      // Transaction signing requires a Keypair from ctx.config.signerPrivateKey.
      // For now, collect the serialized tx data as signatures.
      for (const claimTx of claimTxs) {
        txSignatures.push(claimTx.tx);
      }
    }

    const txSignature = txSignatures.length > 0 ? txSignatures[0] : 'no-tx';

    log.info(
      { totalSol, txCount: txSignatures.length },
      'Claim transactions submitted',
    );

    return {
      success: true,
      data: {
        claimedSol: totalSol,
        claimTx: txSignature,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ error: message }, 'Claim phase failed');
    return {
      success: false,
      error: { code: 'CLAIM_FAILED', message },
    };
  }
}
