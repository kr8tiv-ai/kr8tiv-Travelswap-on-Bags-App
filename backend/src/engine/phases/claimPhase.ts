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

    // ── Enforce maxClaimableSolPerRun safety cap ──
    const maxSol = ctx.config.maxClaimableSolPerRun ?? Infinity;
    const cappedSol = Math.min(totalSol, maxSol);
    if (cappedSol < totalSol) {
      log.warn(
        { totalSol, maxSol, cappedSol },
        'Claimable SOL exceeds per-run cap — clamping to maxClaimableSolPerRun',
      );
    }

    // Dry-run: return synthetic result without signing transactions
    if (ctx.isDryRun) {
      log.info({ claimedSol: cappedSol }, 'Dry-run claim — skipping transaction signing');
      return {
        success: true,
        data: {
          claimedSol: cappedSol,
          claimTx: 'dry-run-claim-tx',
          dryRun: true,
        },
      };
    }

    // Real mode: signs and sends claim transactions via TransactionSender.
    // Filter positions to stay within the per-run SOL cap.
    let solBudget = cappedSol;
    const cappedPositions = positions.filter((p) => {
      const positionSol = Number(p.totalClaimableLamportsUserShare) / LAMPORTS_PER_SOL;
      if (solBudget <= 0) return false;
      solBudget -= positionSol;
      return true;
    });

    const txSignatures: string[] = [];
    for (const position of cappedPositions) {
      const claimTxs = await ctx.bags.getClaimTransactions(
        ctx.strategy.ownerWallet,
        position,
      );

      if (ctx.transactionSender) {
        // Sign and send each claim transaction on-chain
        for (const claimTx of claimTxs) {
          const sig = await ctx.transactionSender.signAndSend(
            claimTx.tx,
            claimTx.blockhash.lastValidBlockHeight > 0
              ? { blockhash: claimTx.blockhash.blockhash, lastValidBlockHeight: claimTx.blockhash.lastValidBlockHeight }
              : undefined,
          );
          txSignatures.push(sig);
        }
      } else {
        // Fallback: no TransactionSender — collect serialized txs (unsigned)
        log.warn('No TransactionSender configured — collecting serialized txs without signing');
        for (const claimTx of claimTxs) {
          txSignatures.push(claimTx.tx);
        }
      }
    }

    const txSignature = txSignatures.length > 0 ? txSignatures[0] : 'no-tx';

    log.info(
      { claimedSol: cappedSol, txCount: txSignatures.length, capped: cappedSol < totalSol },
      'Claim transactions submitted',
    );

    return {
      success: true,
      data: {
        claimedSol: cappedSol,
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
