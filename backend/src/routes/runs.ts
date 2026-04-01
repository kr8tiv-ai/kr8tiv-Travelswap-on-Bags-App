// ─── Run Routes ────────────────────────────────────────────────
// Endpoints for listing, triggering, and resuming pipeline runs.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RouteDeps } from './types.js';
import { sendError } from './errors.js';
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
  app.get('/', async (request, reply) => {
    const { strategyId } = request.query as { strategyId?: string };

    if (strategyId) {
      const numId = Number(strategyId);
      if (isNaN(numId)) {
        sendError(reply, 400, 'Invalid strategyId');
        return;
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
      sendError(reply, 400, `Validation failed: ${issues}`);
      return;
    }

    const { strategyId } = parsed.data;

    const acquired = runLock.acquire(strategyId);
    if (!acquired) {
      sendError(reply, 409, 'A run is already in progress for this strategy');
      return;
    }

    try {
      const run = await pipelineEngine.startRun(strategyId);
      reply.status(201).send(run);
    } catch (err) {
      log.error({ error: (err as Error).message, strategyId }, 'Failed to start run');
      sendError(reply, 500, (err as Error).message);
    } finally {
      runLock.release(strategyId);
    }
  });

  // GET /:id — get run by ID
  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const numId = Number(id);

    if (isNaN(numId)) {
      sendError(reply, 400, 'Invalid run ID');
      return;
    }

    const run = await runService.getById(numId);
    if (!run) {
      sendError(reply, 404, 'Run not found');
      return;
    }

    return run;
  });

  // POST /:id/resume — resume a failed run
  app.post('/:id/resume', async (request, reply) => {
    const { id } = request.params as { id: string };
    const numId = Number(id);

    if (isNaN(numId)) {
      sendError(reply, 400, 'Invalid run ID');
      return;
    }

    try {
      const run = await pipelineEngine.resumeRun(numId);
      return run;
    } catch (err) {
      log.error({ error: (err as Error).message, runId: numId }, 'Failed to resume run');
      sendError(reply, 500, (err as Error).message);
    }
  });
}

export const runsPlugin = runsRoutes;
