// ─── Strategy Routes ───────────────────────────────────────────
// CRUD endpoints for travel strategies.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RouteDeps } from './types.js';
import { sendError } from './errors.js';
import { logger } from '../logger.js';

const log = logger.child({ component: 'routes/strategies' });

// ─── Zod Schemas ───────────────────────────────────────────────

const customAllocationSchema = z.object({
  wallet: z.string().min(1).max(64),
  percentage: z.number().min(0).max(100),
});

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
  customAllocations: z.array(customAllocationSchema).optional().refine(
    (arr) => !arr || Math.abs(arr.reduce((s, a) => s + a.percentage, 0) - 100) <= 0.01,
    { message: 'customAllocations percentages must sum to 100' },
  ),
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
      sendError(reply, 400, `Validation failed: ${issues}`);
      return;
    }

    try {
      const strategy = await strategyService.create(parsed.data);
      reply.status(201).send(strategy);
    } catch (err) {
      log.error({ error: (err as Error).message }, 'Failed to create strategy');
      sendError(reply, 500, 'Failed to create strategy');
    }
  });

  // GET /:id — get strategy by ID
  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const numId = Number(id);

    if (isNaN(numId)) {
      sendError(reply, 400, 'Invalid strategy ID');
      return;
    }

    const strategy = await strategyService.getById(numId);
    if (!strategy) {
      sendError(reply, 404, 'Strategy not found');
      return;
    }

    return strategy;
  });

  // PATCH /:id — update strategy
  app.patch('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const numId = Number(id);

    if (isNaN(numId)) {
      sendError(reply, 400, 'Invalid strategy ID');
      return;
    }

    const parsed = updateStrategySchema.safeParse(request.body);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      sendError(reply, 400, `Validation failed: ${issues}`);
      return;
    }

    const existing = await strategyService.getById(numId);
    if (!existing) {
      sendError(reply, 404, 'Strategy not found');
      return;
    }

    try {
      const updated = await strategyService.update(numId, parsed.data);
      return updated;
    } catch (err) {
      log.error({ error: (err as Error).message, strategyId: numId }, 'Failed to update strategy');
      sendError(reply, 500, 'Failed to update strategy');
    }
  });

  // DELETE /:id — not implemented
  app.delete('/:id', async (_request, reply) => {
    sendError(reply, 501, 'Delete not implemented');
  });
}

export const strategiesPlugin = strategiesRoutes;
