// ─── Server Bootstrap ──────────────────────────────────────────
// buildApp(deps) creates the Fastify instance with middleware
// (CORS, rate limiting, security headers, error handling).
// startServer(app, port) binds and listens.

import crypto from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyError, type FastifyRequest, type FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import { logger } from './logger.js';
import { registerAllRoutes, type RouteDeps } from './routes/index.js';
import { staticFilesPlugin } from './plugins/staticFiles.js';

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

  // ── Security Headers (Helmet) ──
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        connectSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        frameAncestors: ["'self'"],  // allows Bags.fm App Store iframe
      },
    },
    // SAMEORIGIN allows Bags.fm App Store to embed this app in an iframe.
    // Use 'deny' if this app should never be iframed.
    frameguard: { action: 'sameorigin' },
  });

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
