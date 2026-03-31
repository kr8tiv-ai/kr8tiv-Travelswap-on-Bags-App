// ─── Credit Phase Handler ──────────────────────────────────────
// Issues travel credits as gift cards when wallet balances exceed
// the strategy's threshold. Selects the largest denomination that
// fits ($200/$100/$50), checks ExecutionPolicy, encrypts stub
// codes with AES-256-GCM, and deducts from travel balance only
// after a successful purchase record is created.

import { randomUUID } from 'node:crypto';
import { logger } from '../../logger.js';
import { encryptCode } from '../../utils/encryption.js';
import type { PhaseContext } from '../types.js';
import type { PhaseResult } from '../../types/index.js';

const log = logger.child({ component: 'creditPhase' });

/** Denominations in descending order — pick the largest that fits. */
const DENOMINATIONS = [200, 100, 50] as const;

export async function creditPhase(ctx: PhaseContext): Promise<PhaseResult> {
  const { strategy, run, config } = ctx;

  // ── Guard: required dependencies ─────────────────────────────
  if (!ctx.travelBalanceService) {
    throw new Error(
      'TravelBalanceService is required for credit phase but not available in context',
    );
  }
  if (!ctx.giftCardService) {
    throw new Error(
      'GiftCardService is required for credit phase but not available in context',
    );
  }

  const { travelBalanceService, giftCardService } = ctx;

  // ── Non-GIFT_CARD credit mode — skip ─────────────────────────
  if (strategy.creditMode !== 'GIFT_CARD') {
    log.info(
      { runId: run.runId, creditMode: strategy.creditMode },
      'Credit mode is not GIFT_CARD — skipping',
    );
    return {
      success: true,
      data: { skipped: true, reason: 'creditMode is not GIFT_CARD' },
    };
  }

  // ── Fetch all balances for this strategy ─────────────────────
  const strategyId = Number(strategy.strategyId);
  const runId = Number(run.runId);
  const balances = await travelBalanceService.getByStrategy(strategyId);

  let creditsIssued = 0;
  let giftCardsPurchased = 0;

  for (const balance of balances) {
    if (balance.balanceUsd < strategy.giftCardThresholdUsd) {
      continue;
    }

    // Select largest denomination that fits within the balance
    const denomination = DENOMINATIONS.find((d) => d <= balance.balanceUsd);
    if (!denomination) {
      continue;
    }

    // Check execution policy
    if (ctx.executionPolicy) {
      const gate = await ctx.executionPolicy.canPurchaseGiftCard(strategyId, denomination);
      if (!gate.allowed) {
        log.warn(
          { runId: run.runId, wallet: balance.walletAddress, denomination, reason: gate.reason },
          'Gift card purchase blocked by policy — skipping wallet',
        );
        continue;
      }
    }

    // Generate and encrypt stub code
    const stubCode = `TRAVEL-${randomUUID().slice(0, 8).toUpperCase()}`;
    let encryptedCode: string;
    try {
      encryptedCode = encryptCode(stubCode, config.giftCardEncryptionKey);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(
        { runId: run.runId, wallet: balance.walletAddress, error: message },
        'Failed to encrypt gift card code — skipping wallet',
      );
      continue;
    }

    // Purchase the gift card — if this fails, do NOT deduct balance
    let giftCard;
    try {
      giftCard = await giftCardService.purchase(
        strategyId,
        runId,
        balance.walletAddress,
        denomination,
        encryptedCode,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(
        { runId: run.runId, wallet: balance.walletAddress, denomination, error: message },
        'Gift card purchase failed — skipping wallet',
      );
      continue;
    }

    // Deduct balance AFTER successful purchase
    try {
      await travelBalanceService.deduct(strategyId, balance.walletAddress, denomination);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(
        { runId: run.runId, wallet: balance.walletAddress, denomination, error: message },
        'Balance deduction failed after purchase — wallet processed but deduction failed',
      );
      // Still count as purchased since the gift card record exists
    }

    // Audit log the purchase
    if (ctx.auditService) {
      try {
        await ctx.auditService.logTransition(
          runId,
          'CREDITING',
          'gift_card_purchased',
          {
            walletAddress: balance.walletAddress,
            denomination,
            giftCardId: giftCard.giftCardId,
          },
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn(
          { runId: run.runId, giftCardId: giftCard.giftCardId, error: message },
          'Audit log failed for gift card purchase (non-fatal)',
        );
      }
    }

    creditsIssued += denomination;
    giftCardsPurchased += 1;

    log.info(
      { runId: run.runId, wallet: balance.walletAddress, denomination, giftCardId: giftCard.giftCardId },
      'Gift card purchased',
    );
  }

  log.info(
    { runId: run.runId, creditsIssued, giftCardsPurchased },
    'Credit phase complete',
  );

  return {
    success: true,
    data: { creditsIssued, giftCardsPurchased },
  };
}
