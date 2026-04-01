// ─── Balance Routes ────────────────────────────────────────────
// Query endpoints for travel balances.

import type { FastifyInstance } from 'fastify';
import type { RouteDeps } from './types.js';
import { sendError } from './errors.js';

async function balancesRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): Promise<void> {
  const { travelBalanceService } = deps;

  // GET / — list balances by strategyId (required)
  app.get('/', async (request, reply) => {
    const { strategyId } = request.query as { strategyId?: string };

    if (!strategyId) {
      sendError(reply, 400, 'strategyId query parameter is required');
      return;
    }

    const numId = Number(strategyId);
    if (isNaN(numId)) {
      sendError(reply, 400, 'Invalid strategyId');
      return;
    }

    return await travelBalanceService.getByStrategy(numId);
  });

  // GET /:wallet — get balance for a specific wallet
  app.get('/:wallet', async (request, reply) => {
    const { wallet } = request.params as { wallet: string };
    const { strategyId } = request.query as { strategyId?: string };

    if (!strategyId) {
      sendError(reply, 400, 'strategyId query parameter is required');
      return;
    }

    const numId = Number(strategyId);
    if (isNaN(numId)) {
      sendError(reply, 400, 'Invalid strategyId');
      return;
    }

    const balance = await travelBalanceService.getByStrategyAndWallet(numId, wallet);
    if (!balance) {
      sendError(reply, 404, 'Balance not found');
      return;
    }

    return balance;
  });
}

export const balancesPlugin = balancesRoutes;
