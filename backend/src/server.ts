// ─── Server Bootstrap ──────────────────────────────────────────
// buildApp(deps) creates the Fastify instance with middleware
// (CORS, rate limiting, security headers, error handling).
// startServer(app, port) binds and listens.

import crypto from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyError, type FastifyRequest, type FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import { logger } from './logger.js';
import { registerAllRoutes, type RouteDeps } from './routes/index.js';
import { staticFilesPlugin } from './plugins/staticFiles.js';

// ─── Security Headers (onSend hook, not @fastify/helmet) ──────

function addSecurityHeaders(
  _request: FastifyRequest,
  reply: FastifyReply,
  payload: unknown,
  done: (err?: Error | null, payload?: unknown) => void,
): void {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('X-XSS-Protection', '0');
  reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  reply.header('X-Download-Options', 'noopen');
  reply.header('X-Permitted-Cross-Domain-Policies', 'none');
  done(null, payload);
}

// ─── Build App ─────────────────────────────────────────────────

export async function buildApp(deps: RouteDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false, // We use our own Pino instance
    disableRequestLogging: true,
    genReqId: () => crypto.randomUUID(),
  });

  // ── CORS ──
  const origins = deps.config.corsOrigins
    ? deps.config.corsOrigins.split(',').map((o) => o.trim()).filter(Boolean)
    : [];
  await app.register(cors, {
    origin: origins.length > 0 ? origins : true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  // ── Rate Limiting ──
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
  });

  // ── Sensible (standardised HTTP errors) ──
  await app.register(sensible);

  // ── Security Headers ──
  app.addHook('onSend', addSecurityHeaders);

  // ── Correlation ID: bind child logger + response header ──
  app.addHook('onRequest', (request, reply, done) => {
    request.log = logger.child({ requestId: request.id });
    reply.header('x-request-id', request.id);
    done();
  });

  // ── Global Error Handler ──
  app.setErrorHandler((error: FastifyError, request: FastifyRequest, reply: FastifyReply) => {
    const statusCode = error.statusCode ?? 500;
    const log = request.log ?? logger.child({ component: 'errorHandler' });

    if (statusCode >= 500) {
      log.error(
        { err: error, method: request.method, url: request.url, statusCode },
        'Internal server error',
      );
    } else {
      log.warn(
        { method: request.method, url: request.url, statusCode, message: error.message },
        'Request error',
      );
    }

    reply.status(statusCode).send({
      error: statusCode >= 500 ? 'Internal Server Error' : error.message,
      statusCode,
    });
  });

  // ── Routes ──
  await registerAllRoutes(app, deps);

  // ── Static Files (SPA) ── must come AFTER API routes so they take priority
  await app.register(staticFilesPlugin, { staticDir: deps.config.staticDir });

  return app;
}

// ─── Start Server ──────────────────────────────────────────────

export async function startServer(app: FastifyInstance, port: number): Promise<void> {
  await app.listen({ port, host: '0.0.0.0' });
  logger.info({ port }, 'Server listening');
}
