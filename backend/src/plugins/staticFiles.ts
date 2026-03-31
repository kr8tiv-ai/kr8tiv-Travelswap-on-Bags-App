// ─── Static File Serving Plugin ─────────────────────────────────
// Serves the frontend SPA from a configurable directory via
// @fastify/static. API routes registered before this plugin take
// priority. A catch-all GET handler serves index.html for client-
// side routing (SPA fallback).
//
// Skips gracefully when the static directory doesn't exist, so
// the backend works standalone during development/testing.

import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fastifyStatic from '@fastify/static';
import { logger } from '../logger.js';

export interface StaticFilesOptions {
  staticDir?: string;
}

const log = logger.child({ component: 'StaticFiles' });

async function staticFilesPlugin(
  app: FastifyInstance,
  opts: StaticFilesOptions,
): Promise<void> {
  const root = opts.staticDir
    ? resolve(opts.staticDir)
    : resolve(__dirname, '../../frontend/dist');

  if (!existsSync(root)) {
    log.info({ root }, 'Static directory not found — skipping static file serving');
    return;
  }

  const indexPath = join(root, 'index.html');
  const hasIndex = existsSync(indexPath);

  // Register @fastify/static for serving actual static assets.
  // wildcard:false prevents it from handling catch-all — we do
  // that ourselves so API routes aren't shadowed.
  await app.register(fastifyStatic, {
    root,
    prefix: '/',
    wildcard: false,
    decorateReply: true,
  });

  log.info({ root }, 'Static file serving enabled');

  // SPA fallback: any GET that didn't match an API route or static
  // file gets index.html. We set this at low constraint so registered
  // routes always win.
  if (hasIndex) {
    app.setNotFoundHandler(
      (request: FastifyRequest, reply: FastifyReply) => {
        // Only serve index.html for GET requests that aren't API/health routes
        if (
          request.method === 'GET' &&
          !request.url.startsWith('/api/') &&
          !request.url.startsWith('/health')
        ) {
          return reply.type('text/html').sendFile('index.html');
        }

        // For non-GET or API routes, return standard 404
        reply.status(404).send({
          error: 'Not Found',
          statusCode: 404,
        });
      },
    );
  }
}

export { staticFilesPlugin };
