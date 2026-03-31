// ─── Balance Routes ────────────────────────────────────────────
// Query endpoints for travel balances.

import type { FastifyInstance } from 'fastify';
import type { RouteDeps } from './types.js';

async function balancesRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): Promise<void> {
  const { travelBalanceService } = deps;

  // GET / — list balances by strategyId (required)
  app.get('/', async (request, reply) => {
    const { strategyId } = request.query as { strategyId?: string };

    if (!strategyId) {
      reply.status(400).send({ error: 'strategyId query parameter is required' });
      return;
    }

    const numId = Number(strategyId);
    if (isNaN(numId)) {
      reply.status(400).send({ error: 'Invalid strategyId' });
      return;
    }

    return await travelBalanceService.getByStrategy(numId);
  });

  // GET /:wallet — get balance for a specific wallet
  app.get('/:wallet', async (request, reply) => {
    const { wallet } = request.params as { wallet: string };
    const { strategyId } = request.query as { strategyId?: string };

    if (!strategyId) {
      reply.status(400).send({ error: 'strategyId query parameter is required' });
      return;
    }

    const numId = Number(strategyId);
    if (isNaN(numId)) {
      reply.status(400).send({ error: 'Invalid strategyId' });
      return;
    }

    const balance = await travelBalanceService.getByStrategyAndWallet(numId, wallet);
    if (!balance) {
      reply.status(404).send({ error: 'Balance not found' });
      return;
    }

    return balance;
  });
}

export const balancesPlugin = balancesRoutes;
