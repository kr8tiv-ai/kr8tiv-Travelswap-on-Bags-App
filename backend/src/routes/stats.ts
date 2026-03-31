// ─── Stats Routes ──────────────────────────────────────────────
// Aggregate statistics endpoint.

import type { FastifyInstance } from 'fastify';
import type { RouteDeps } from './types.js';

async function statsRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): Promise<void> {
  const { runService, strategyService } = deps;

  // GET / — aggregate run statistics + active strategies count
  app.get('/', async (_request, _reply) => {
    const stats = await runService.getAggregateStats();
    const activeStrategies = (await strategyService.getActive()).length;
    return { ...stats, activeStrategies };
  });
}

export const statsPlugin = statsRoutes;
