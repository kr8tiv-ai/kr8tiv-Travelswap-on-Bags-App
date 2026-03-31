// ─── Credit Routes ─────────────────────────────────────────────
// Query endpoints for gift card records.

import type { FastifyInstance } from 'fastify';
import type { RouteDeps } from './types.js';

async function creditsRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): Promise<void> {
  const { giftCardService } = deps;

  // GET / — list credits by strategyId or wallet
  app.get('/', async (request, reply) => {
    const { strategyId, wallet } = request.query as {
      strategyId?: string;
      wallet?: string;
    };

    if (strategyId) {
      const numId = Number(strategyId);
      if (isNaN(numId)) {
        reply.status(400).send({ error: 'Invalid strategyId' });
        return;
      }
      return await giftCardService.getByStrategy(numId);
    }

    if (wallet) {
      return await giftCardService.getByWallet(wallet);
    }

    reply.status(400).send({ error: 'strategyId or wallet query parameter is required' });
  });

  // GET /:wallet — get credits for a specific wallet
  app.get('/:wallet', async (request, _reply) => {
    const { wallet } = request.params as { wallet: string };
    return await giftCardService.getByWallet(wallet);
  });
}

export const creditsPlugin = creditsRoutes;
