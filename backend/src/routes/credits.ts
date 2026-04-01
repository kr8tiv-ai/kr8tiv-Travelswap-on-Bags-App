// ─── Credit Routes ─────────────────────────────────────────────
// Query endpoints for gift card records + one-time code reveal.

import type { FastifyInstance } from 'fastify';
import type { RouteDeps } from './types.js';
import { sendError } from './errors.js';
import { decryptCode } from '../utils/encryption.js';
import { logger } from '../logger.js';
import type { GiftCard } from '../types/index.js';

/** Merge NFT status/signature from travel passes into gift card objects. */
async function mergeNftData(
  giftCards: GiftCard[],
  deps: RouteDeps,
): Promise<Array<GiftCard & { nftStatus?: string; nftMintSignature?: string }>> {
  if (!deps.travelPassService || giftCards.length === 0) {
    return giftCards;
  }

  const ids = giftCards.map((gc) => Number(gc.giftCardId));
  const passes = await deps.travelPassService.getByGiftCardIds(ids);

  // Index by gift card ID for O(1) lookups
  const passMap = new Map(passes.map((p) => [p.giftCardId, p]));

  return giftCards.map((gc) => {
    const pass = passMap.get(gc.giftCardId);
    if (!pass) return gc;
    return {
      ...gc,
      nftStatus: pass.status,
      nftMintSignature: pass.mintSignature ?? undefined,
    };
  });
}

async function creditsRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): Promise<void> {
  const { giftCardService, config } = deps;

  // GET / — list credits by strategyId or wallet
  app.get('/', async (request, reply) => {
    const { strategyId, wallet } = request.query as {
      strategyId?: string;
      wallet?: string;
    };

    if (strategyId) {
      const numId = Number(strategyId);
      if (isNaN(numId)) {
        sendError(reply, 400, 'Invalid strategyId');
        return;
      }
      const cards = await giftCardService.getByStrategy(numId);
      return await mergeNftData(cards, deps);
    }

    if (wallet) {
      const cards = await giftCardService.getByWallet(wallet);
      return await mergeNftData(cards, deps);
    }

    sendError(reply, 400, 'strategyId or wallet query parameter is required');
  });

  // GET /:wallet — get credits for a specific wallet
  app.get('/:wallet', async (request, _reply) => {
    const { wallet } = request.params as { wallet: string };
    return await giftCardService.getByWallet(wallet);
  });

  // POST /:id/reveal — decrypt and reveal a PURCHASED gift card code (one-time)
  app.post('/:id/reveal', async (request, reply) => {
    const { id } = request.params as { id: string };
    const numId = Number(id);
    if (isNaN(numId)) {
      sendError(reply, 400, 'Invalid gift card ID');
      return;
    }

    // 503 if encryption key is not configured
    if (!config.giftCardEncryptionKey) {
      sendError(reply, 503, 'Gift card decryption is not configured');
      return;
    }

    const giftCard = await giftCardService.getById(numId);
    if (!giftCard) {
      sendError(reply, 404, 'Gift card not found');
      return;
    }

    // PENDING — code not yet available
    if (giftCard.status === 'PENDING') {
      sendError(reply, 400, 'Gift card code not yet available');
      return;
    }

    // DELIVERED — already revealed
    if (giftCard.status === 'DELIVERED' || giftCard.status === 'REDEEMED') {
      return { code: null, alreadyRevealed: true, giftCard };
    }

    // EXPIRED — not revealable
    if (giftCard.status === 'EXPIRED') {
      sendError(reply, 400, 'Gift card has expired');
      return;
    }

    // PURCHASED — decrypt and transition to DELIVERED
    if (!giftCard.codeEncrypted || giftCard.codeEncrypted.trim().length === 0) {
      logger.error({ giftCardId: id }, 'PURCHASED gift card has empty codeEncrypted');
      sendError(reply, 500, 'Code data is corrupted');
      return;
    }

    try {
      const code = decryptCode(giftCard.codeEncrypted, config.giftCardEncryptionKey);
      const updatedGiftCard = await giftCardService.updateStatus(numId, 'DELIVERED');

      logger.info({ giftCardId: id }, 'Gift card code revealed, status → DELIVERED');

      return { code, giftCard: updatedGiftCard };
    } catch (err) {
      logger.error({ giftCardId: id, err }, 'Failed to decrypt gift card code');
      sendError(reply, 500, 'Failed to decrypt gift card code');
      return;
    }
  });
}

export const creditsPlugin = creditsRoutes;
