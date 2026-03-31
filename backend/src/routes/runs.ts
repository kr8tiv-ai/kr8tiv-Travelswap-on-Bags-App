// ─── Run Routes ────────────────────────────────────────────────
// Endpoints for listing, triggering, and resuming pipeline runs.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RouteDeps } from './types.js';
import { logger } from '../logger.js';

const log = logger.child({ component: 'routes/runs' });

// ─── Zod Schemas ───────────────────────────────────────────────

const createRunSchema = z.object({
  strategyId: z.coerce.number().int().positive(),
});

// ─── Route Plugin ──────────────────────────────────────────────

async function runsRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): Promise<void> {
  const { runService, pipelineEngine, runLock } = deps;

  // GET / — list runs, optionally filtered by strategyId
  app.get('/', async (request, _reply) => {
    const { strategyId } = request.query as { strategyId?: string };

    if (strategyId) {
      const numId = Number(strategyId);
      if (isNaN(numId)) {
        return { error: 'Invalid strategyId' };
      }
      return await runService.getByStrategyId(numId);
    }

    return await runService.getAll();
  });

  // POST / — trigger a new pipeline run
  app.post('/', async (request, reply) => {
    const parsed = createRunSchema.safeParse(request.body);
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

    const { strategyId } = parsed.data;

    const acquired = runLock.acquire(strategyId);
    if (!acquired) {
      reply.status(409).send({ error: 'A run is already in progress for this strategy' });
      return;
    }

    try {
      const run = await pipelineEngine.startRun(strategyId);
      reply.status(201).send(run);
    } catch (err) {
      log.error({ error: (err as Error).message, strategyId }, 'Failed to start run');
      reply.status(500).send({ error: (err as Error).message });
    } finally {
      runLock.release(strategyId);
    }
  });

  // GET /:id — get run by ID
  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const numId = Number(id);

    if (isNaN(numId)) {
      reply.status(400).send({ error: 'Invalid run ID' });
      return;
    }

    const run = await runService.getById(numId);
    if (!run) {
      reply.status(404).send({ error: 'Run not found' });
      return;
    }

    return run;
  });

  // POST /:id/resume — resume a failed run
  app.post('/:id/resume', async (request, reply) => {
    const { id } = request.params as { id: string };
    const numId = Number(id);

    if (isNaN(numId)) {
      reply.status(400).send({ error: 'Invalid run ID' });
      return;
    }

    try {
      const run = await pipelineEngine.resumeRun(numId);
      return run;
    } catch (err) {
      log.error({ error: (err as Error).message, runId: numId }, 'Failed to resume run');
      reply.status(500).send({ error: (err as Error).message });
    }
  });
}

export const runsPlugin = runsRoutes;
