// ─── Health Routes ─────────────────────────────────────────────
// Liveness and readiness probes. Registered outside /api prefix
// to skip auth.
//
// /health/live  — always 200 if process is running
// /health/ready — per-dependency checks: database (critical),
//   bags (critical), helius (critical), duffel (non-critical).
//   Circuit breaker state is read without making live HTTP calls.

import type { FastifyInstance } from 'fastify';
import type { RouteDeps } from './types.js';
import { logger } from '../logger.js';

const log = logger.child({ component: 'routes/health' });

// ─── Types ─────────────────────────────────────────────────────

interface DependencyCheck {
  status: 'ok' | 'error';
  state?: string;
  lastFailure?: number;
  error?: string;
}

interface ReadyResponse {
  status: 'ready' | 'degraded' | 'not_ready';
  checks: Record<string, DependencyCheck>;
}

// ─── Route Registration ────────────────────────────────────────

async function healthRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): Promise<void> {
  const { db, circuitBreakers } = deps;

  // GET /health/live — always healthy if the process is running
  app.get('/health/live', async (_request, _reply) => {
    return { status: 'ok' };
  });

  // GET /health/ready — check dependencies
  app.get('/health/ready', async (_request, reply) => {
    const checks: Record<string, DependencyCheck> = {};
    let hasCriticalFailure = false;
    let hasNonCriticalFailure = false;

    // ── Database (critical) ──
    try {
      await db.get<{ ok: number }>('SELECT 1 as ok');
      checks.database = { status: 'ok' };
    } catch (err) {
      const msg = (err as Error).message;
      log.error({ error: msg }, 'Database health check failed');
      checks.database = { status: 'error', error: msg };
      hasCriticalFailure = true;
    }

    // ── Circuit-breaker-backed dependencies ──
    if (circuitBreakers) {
      // Bags API (critical)
      if (circuitBreakers.bags) {
        const snap = circuitBreakers.bags.snapshot();
        if (snap.state === 'OPEN') {
          checks.bags = { status: 'error', state: snap.state, lastFailure: snap.lastFailureTime };
          hasCriticalFailure = true;
        } else {
          checks.bags = { status: 'ok', state: snap.state };
        }
      }

      // Helius RPC (critical)
      if (circuitBreakers.helius) {
        const snap = circuitBreakers.helius.snapshot();
        if (snap.state === 'OPEN') {
          checks.helius = { status: 'error', state: snap.state, lastFailure: snap.lastFailureTime };
          hasCriticalFailure = true;
        } else {
          checks.helius = { status: 'ok', state: snap.state };
        }
      }

      // Duffel API (non-critical — only present when configured)
      if (circuitBreakers.duffel) {
        const snap = circuitBreakers.duffel.snapshot();
        if (snap.state === 'OPEN') {
          checks.duffel = { status: 'error', state: snap.state, lastFailure: snap.lastFailureTime };
          hasNonCriticalFailure = true;
        } else {
          checks.duffel = { status: 'ok', state: snap.state };
        }
      }
    }

    // ── Overall status ──
    let status: ReadyResponse['status'];
    let httpCode: number;

    if (hasCriticalFailure) {
      status = 'not_ready';
      httpCode = 503;
    } else if (hasNonCriticalFailure) {
      status = 'degraded';
      httpCode = 200;
    } else {
      status = 'ready';
      httpCode = 200;
    }

    reply.status(httpCode).send({ status, checks } satisfies ReadyResponse);
  });
}

export const healthPlugin = healthRoutes;
