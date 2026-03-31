// ─── Strategy Routes ───────────────────────────────────────────
// CRUD endpoints for travel strategies.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RouteDeps } from './types.js';
import { logger } from '../logger.js';

const log = logger.child({ component: 'routes/strategies' });

// ─── Zod Schemas ───────────────────────────────────────────────

const createStrategySchema = z.object({
  name: z.string().min(1).max(100),
  ownerWallet: z.string().min(1).max(64),
  tokenMint: z.string().min(1).max(64),
  feeSource: z.enum(['CLAIMABLE_POSITIONS', 'PARTNER_FEES']).optional(),
  thresholdSol: z.number().positive().optional(),
  slippageBps: z.number().int().min(0).max(1000).optional(),
  distributionMode: z.enum([
    'OWNER_ONLY',
    'TOP_N_HOLDERS',
    'EQUAL_SPLIT',
    'WEIGHTED_BY_HOLDINGS',
    'CUSTOM_LIST',
  ]).optional(),
  distributionTopN: z.number().int().min(1).optional(),
  creditMode: z.enum(['GIFT_CARD', 'DIRECT_TOPUP', 'DUFFEL_BOOKING']).optional(),
  giftCardThresholdUsd: z.number().positive().optional(),
  cronExpression: z.string().max(100).optional(),
  enabled: z.boolean().optional(),
});

const updateStrategySchema = createStrategySchema.partial();

// ─── Route Plugin ──────────────────────────────────────────────

async function strategiesRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): Promise<void> {
  const { strategyService } = deps;

  // GET / — list all strategies
  app.get('/', async (_request, _reply) => {
    return await strategyService.getAll();
  });

  // POST / — create a new strategy
  app.post('/', async (request, reply) => {
    const parsed = createStrategySchema.safeParse(request.body);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      reply.status(400).send({
        error: `Validation failed: ${issues}`,
        statusCode: 400,
      });
      return;
    }

    try {
      const strategy = await strategyService.create(parsed.data);
      reply.status(201).send(strategy);
    } catch (err) {
      log.error({ error: (err as Error).message }, 'Failed to create strategy');
      reply.status(500).send({ error: 'Failed to create strategy' });
    }
  });

  // GET /:id — get strategy by ID
  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const numId = Number(id);

    if (isNaN(numId)) {
      reply.status(400).send({ error: 'Invalid strategy ID' });
      return;
    }

    const strategy = await strategyService.getById(numId);
    if (!strategy) {
      reply.status(404).send({ error: 'Strategy not found' });
      return;
    }

    return strategy;
  });

  // PATCH /:id — update strategy
  app.patch('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const numId = Number(id);

    if (isNaN(numId)) {
      reply.status(400).send({ error: 'Invalid strategy ID' });
      return;
    }

    const parsed = updateStrategySchema.safeParse(request.body);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      reply.status(400).send({
        error: `Validation failed: ${issues}`,
        statusCode: 400,
      });
      return;
    }

    const existing = await strategyService.getById(numId);
    if (!existing) {
      reply.status(404).send({ error: 'Strategy not found' });
      return;
    }

    try {
      const updated = await strategyService.update(numId, parsed.data);
      return updated;
    } catch (err) {
      log.error({ error: (err as Error).message, strategyId: numId }, 'Failed to update strategy');
      reply.status(500).send({ error: 'Failed to update strategy' });
    }
  });

  // DELETE /:id — not implemented
  app.delete('/:id', async (_request, reply) => {
    reply.status(501).send({ error: 'Delete not implemented' });
  });
}

export const strategiesPlugin = strategiesRoutes;
