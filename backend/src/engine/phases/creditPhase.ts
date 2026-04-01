// ─── Credit Phase Handler ──────────────────────────────────────
// Issues travel credits as gift cards when wallet balances exceed
// the strategy's threshold. Triple-fallback chain (D044):
// 1. CoinVoyage: creates a Sale PayOrder → inserts PENDING gift card
//    with payorder_id. Webhook confirms purchase later.
// 2. Bitrefill: balance payment with auto_pay → redemption code
//    available immediately → encrypt + insert PURCHASED with
//    provider='bitrefill'.
// 3. Stub (fallback): generates TRAVEL-XXXXXXXX codes, encrypts with
//    AES-256-GCM, and inserts PURCHASED gift card immediately.
//
// Each provider is tried per-wallet in sequence. If a provider
// throws or returns false, the next is attempted. Deducts from
// travel balance only after a successful record is created (K010).

import { randomUUID } from 'node:crypto';
import { logger } from '../../logger.js';
import { encryptCode } from '../../utils/encryption.js';
import type { PhaseContext } from '../types.js';
import type { PhaseResult, CoinVoyageClientAdapter, BitrefillClientAdapter, GiftCardProvider } from '../../types/index.js';
import type { GiftCardService } from '../../services/GiftCardService.js';

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

  // ── Determine available providers ────────────────────────────
  const hasCoinVoyage = !!ctx.coinVoyageClient;
  const hasBitrefill = !!ctx.bitrefillClient;
  log.info(
    { runId: run.runId, coinvoyage: hasCoinVoyage, bitrefill: hasBitrefill },
    'Credit phase starting — triple-fallback chain',
  );

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

    // ── Triple-fallback per wallet (D044) ────────────────────
    let giftCardId: number | null = null;
    let provider: GiftCardProvider = 'stub';

    // 1. Try CoinVoyage
    if (giftCardId === null && ctx.coinVoyageClient) {
      try {
        giftCardId = await processCoinVoyagePurchase(
          ctx.coinVoyageClient,
          giftCardService,
          strategyId,
          runId,
          balance.walletAddress,
          denomination,
          run.runId,
        );
        if (giftCardId !== null) {
          provider = 'coinvoyage';
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn(
          { runId: run.runId, wallet: balance.walletAddress, denomination, error: message },
          'CoinVoyage failed — falling through to Bitrefill',
        );
      }
    }

    // 2. Try Bitrefill
    if (giftCardId === null && ctx.bitrefillClient) {
      try {
        giftCardId = await processBitrefillPurchase(
          ctx.bitrefillClient,
          giftCardService,
          strategyId,
          runId,
          balance.walletAddress,
          denomination,
          config.giftCardEncryptionKey,
          config.bitrefillProductId,
          run.runId,
        );
        if (giftCardId !== null) {
          provider = 'bitrefill';
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn(
          { runId: run.runId, wallet: balance.walletAddress, denomination, error: message },
          'Bitrefill failed — falling through to stub',
        );
      }
    }

    // 3. Stub fallback
    if (giftCardId === null) {
      try {
        giftCardId = await processStubPurchase(
          giftCardService,
          strategyId,
          runId,
          balance.walletAddress,
          denomination,
          config.giftCardEncryptionKey,
          run.runId,
        );
        if (giftCardId !== null) {
          provider = 'stub';
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error(
          { runId: run.runId, wallet: balance.walletAddress, denomination, error: message },
          'Stub purchase failed — wallet skipped entirely',
        );
      }
    }

    if (giftCardId === null) continue;

    // Deduct balance AFTER successful purchase record creation (K010)
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
    const auditAction = provider === 'coinvoyage' ? 'gift_card_payorder_created' : 'gift_card_purchased';
    if (ctx.auditService) {
      try {
        await ctx.auditService.logTransition(
          runId,
          'CREDITING',
          auditAction,
          {
            walletAddress: balance.walletAddress,
            denomination,
            path: provider,
          },
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn(
          { runId: run.runId, wallet: balance.walletAddress, error: message },
          'Audit log failed for gift card purchase (non-fatal)',
        );
      }
    }

    // ── Fire-and-forget NFT Travel Pass mint ──────────────────
    if (config.nftMintEnabled && ctx.nftMintClient && ctx.travelPassService) {
      try {
        // Create PENDING travel pass record
        const travelPass = await ctx.travelPassService.create({
          giftCardId,
          strategyId,
          walletAddress: balance.walletAddress,
          denominationUsd: denomination,
          tokenMint: strategy.tokenMint,
        });
        const travelPassId = Number(travelPass.id);

        // Build metadata URI
        const metadataUri = `${config.metadataBaseUrl}/api/nft/metadata/${travelPassId}`;

        try {
          // Attempt cNFT mint
          const mintResult = await ctx.nftMintClient.mintTravelPass({
            walletAddress: balance.walletAddress,
            denominationUsd: denomination,
            tokenMint: strategy.tokenMint,
            metadataUri,
          });

          // Mark MINTED
          await ctx.travelPassService.updateMinted(travelPassId, mintResult.signature, metadataUri);

          // Audit success
          if (ctx.auditService) {
            try {
              await ctx.auditService.logTransition(runId, 'CREDITING', 'nft_mint_success', {
                walletAddress: balance.walletAddress,
                travelPassId,
                signature: mintResult.signature,
              });
            } catch {}
          }

          log.info(
            { runId: run.runId, wallet: balance.walletAddress, travelPassId, signature: mintResult.signature.slice(0, 16) + '...' },
            'NFT travel pass minted',
          );
        } catch (mintErr) {
          // Mint failed — record FAILED status, log, continue pipeline
          const mintErrMsg = mintErr instanceof Error ? mintErr.message : String(mintErr);

          try {
            await ctx.travelPassService.updateFailed(travelPassId, mintErrMsg);
          } catch (updateErr) {
            const updateMsg = updateErr instanceof Error ? updateErr.message : String(updateErr);
            log.warn(
              { runId: run.runId, travelPassId, error: updateMsg },
              'Failed to update travel pass to FAILED status (non-fatal)',
            );
          }

          // Audit failure
          if (ctx.auditService) {
            try {
              await ctx.auditService.logTransition(runId, 'CREDITING', 'nft_mint_failed', {
                walletAddress: balance.walletAddress,
                travelPassId,
                error: mintErrMsg,
              });
            } catch {}
          }

          log.warn(
            { runId: run.runId, wallet: balance.walletAddress, travelPassId, error: mintErrMsg },
            'NFT mint failed — travel pass marked FAILED, pipeline continues',
          );
        }
      } catch (tpErr) {
        // TravelPassService.create() failed — skip NFT for this wallet, continue pipeline
        const tpErrMsg = tpErr instanceof Error ? tpErr.message : String(tpErr);
        log.warn(
          { runId: run.runId, wallet: balance.walletAddress, error: tpErrMsg },
          'Failed to create travel pass record — skipping NFT mint for this wallet',
        );
      }
    }

    creditsIssued += denomination;
    giftCardsPurchased += 1;

    log.info(
      { runId: run.runId, wallet: balance.walletAddress, denomination, path: provider },
      'Gift card processed',
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

// ─── CoinVoyage PayOrder Path ──────────────────────────────────

async function processCoinVoyagePurchase(
  coinVoyageClient: CoinVoyageClientAdapter,
  giftCardService: GiftCardService,
  strategyId: number,
  runId: number,
  walletAddress: string,
  denomination: number,
  logRunId: string,
): Promise<number | null> {
  let payOrder;
  try {
    payOrder = await coinVoyageClient.createSalePayOrder({
      amountUsd: denomination,
      receivingAddress: walletAddress,
      metadata: { strategyId: String(strategyId), runId: String(runId) },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(
      { runId: logRunId, wallet: walletAddress, denomination, error: message },
      'CoinVoyage PayOrder creation failed',
    );
    return null;
  }

  try {
    const gc = await giftCardService.purchasePending(
      strategyId,
      runId,
      walletAddress,
      denomination,
      payOrder.id,
    );
    return Number(gc.giftCardId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(
      { runId: logRunId, wallet: walletAddress, denomination, payorderId: payOrder.id, error: message },
      'Failed to insert PENDING gift card record',
    );
    return null;
  }
}

// ─── Bitrefill Balance Payment Path ────────────────────────────

async function processBitrefillPurchase(
  bitrefillClient: BitrefillClientAdapter,
  giftCardService: GiftCardService,
  strategyId: number,
  runId: number,
  walletAddress: string,
  denomination: number,
  encryptionKey: string,
  productId: string,
  logRunId: string,
): Promise<number | null> {
  // Build packageId from productId + denomination (Bitrefill convention)
  const packageId = `${productId}<&>${denomination}`;

  let invoice;
  try {
    invoice = await bitrefillClient.createInvoice({
      productId,
      packageId,
      paymentMethod: 'balance',
      autoPay: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(
      { runId: logRunId, wallet: walletAddress, denomination, error: message },
      'Bitrefill invoice creation failed',
    );
    return null;
  }

  // Extract redemption code — balance payment with auto_pay should
  // return the code immediately in the invoice response.
  const redemptionCode = invoice.redemption_info?.code;
  if (!redemptionCode) {
    log.warn(
      { runId: logRunId, wallet: walletAddress, denomination, invoiceId: invoice.id, status: invoice.status },
      'Bitrefill invoice returned no redemption code — treating as failure',
    );
    return null;
  }

  // Encrypt the redemption code (same AES-256-GCM as stub path)
  let encryptedCode: string;
  try {
    encryptedCode = encryptCode(redemptionCode, encryptionKey);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(
      { runId: logRunId, wallet: walletAddress, error: message },
      'Failed to encrypt Bitrefill redemption code',
    );
    return null;
  }

  // Insert PURCHASED gift card with provider='bitrefill'
  try {
    const gc = await giftCardService.purchaseBitrefill(
      strategyId,
      runId,
      walletAddress,
      denomination,
      encryptedCode,
      invoice.id,
    );

    log.info(
      { runId: logRunId, wallet: walletAddress, denomination, invoiceId: invoice.id, provider: 'bitrefill' },
      'Bitrefill gift card purchased',
    );
    return Number(gc.giftCardId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(
      { runId: logRunId, wallet: walletAddress, denomination, invoiceId: invoice.id, error: message },
      'Failed to insert Bitrefill gift card record',
    );
    return null;
  }
}

// ─── Stub Code Path ────────────────────────────────────────────

async function processStubPurchase(
  giftCardService: GiftCardService,
  strategyId: number,
  runId: number,
  walletAddress: string,
  denomination: number,
  encryptionKey: string,
  logRunId: string,
): Promise<number | null> {
  // Generate and encrypt stub code
  const stubCode = `TRAVEL-${randomUUID().slice(0, 8).toUpperCase()}`;
  let encryptedCode: string;
  try {
    encryptedCode = encryptCode(stubCode, encryptionKey);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(
      { runId: logRunId, wallet: walletAddress, error: message },
      'Failed to encrypt gift card code — skipping wallet',
    );
    return null;
  }

  try {
    const gc = await giftCardService.purchase(
      strategyId,
      runId,
      walletAddress,
      denomination,
      encryptedCode,
    );
    return Number(gc.giftCardId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(
      { runId: logRunId, wallet: walletAddress, denomination, error: message },
      'Gift card purchase failed — skipping wallet',
    );
    return null;
  }
}
