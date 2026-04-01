// ─── Auth Plugin ───────────────────────────────────────────────
// Fastify onRequest hook for Bearer token authentication.
// Uses crypto.timingSafeEqual to prevent timing attacks.
// Skips authentication for health routes (/health/*).

import { timingSafeEqual } from 'crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { logger } from '../logger.js';

export interface AuthPluginOptions {
  apiAuthToken: string;
}

async function authPluginImpl(
  app: FastifyInstance,
  opts: AuthPluginOptions,
): Promise<void> {
  const expectedToken = opts.apiAuthToken;
  const log = logger.child({ component: 'AuthPlugin' });

  app.addHook(
    'onRequest',
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Skip auth for health routes, webhook routes (authenticated by HMAC signature),
      // and NFT metadata routes (must be publicly accessible for Solana explorers)
      if (request.url.startsWith('/health') || request.url.startsWith('/api/webhooks/') || request.url.startsWith('/api/nft/metadata/')) {
        return;
      }

      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        log.warn({ url: request.url, ip: request.ip }, 'Missing or malformed Authorization header');
        reply.status(401).send({ error: 'Unauthorized' });
        return;
      }

      const token = authHeader.slice(7); // "Bearer ".length

      // Use timingSafeEqual to prevent timing attacks
      const tokenBuf = Buffer.from(token);
      const expectedBuf = Buffer.from(expectedToken);

      if (tokenBuf.length !== expectedBuf.length || !timingSafeEqual(tokenBuf, expectedBuf)) {
        log.warn({ url: request.url, ip: request.ip }, 'Invalid auth token');
        reply.status(401).send({ error: 'Unauthorized' });
        return;
      }
    },
  );
}

export const authPlugin = fp(authPluginImpl, {
  name: 'auth',
  fastify: '5.x',
});
