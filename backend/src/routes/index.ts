// ─── Route Barrel ──────────────────────────────────────────────
// Registers all route plugins. API routes go under /api prefix
// (behind auth). Health routes are at root (skip auth via
// auth plugin's URL check).

import type { FastifyInstance } from 'fastify';
import { authPlugin } from '../plugins/auth.js';
import { strategiesPlugin } from './strategies.js';
import { runsPlugin } from './runs.js';
import { balancesPlugin } from './balances.js';
import { creditsPlugin } from './credits.js';
import { statsPlugin } from './stats.js';
import { healthPlugin } from './health.js';
import { flightsPlugin } from './flights.js';
import { bookingsPlugin } from './bookings.js';
import { webhooksPlugin } from './webhooks.js';
import { nftMetadataPlugin } from './nft-metadata.js';
import type { RouteDeps } from './types.js';

export type { RouteDeps } from './types.js';

export async function registerAllRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): Promise<void> {
  // Auth plugin — fp()-wrapped, so onRequest hook applies to ALL routes.
  // The hook itself skips /health/* routes by URL check.
  await app.register(authPlugin, { apiAuthToken: deps.config.apiAuthToken });

  // Health routes — no prefix, auth skipped by URL pattern
  await app.register(healthPlugin, deps);

  // API routes — each with /api/* prefix, protected by auth hook
  await app.register(strategiesPlugin, { ...deps, prefix: '/api/strategies' } as RouteDeps & { prefix: string });
  await app.register(runsPlugin, { ...deps, prefix: '/api/runs' } as RouteDeps & { prefix: string });
  await app.register(balancesPlugin, { ...deps, prefix: '/api/balances' } as RouteDeps & { prefix: string });
  await app.register(creditsPlugin, { ...deps, prefix: '/api/credits' } as RouteDeps & { prefix: string });
  await app.register(statsPlugin, { ...deps, prefix: '/api/stats' } as RouteDeps & { prefix: string });
  await app.register(flightsPlugin, { ...deps, prefix: '/api/flights' } as RouteDeps & { prefix: string });
  await app.register(bookingsPlugin, { ...deps, prefix: '/api/bookings' } as RouteDeps & { prefix: string });

  // Webhook routes — prefix /api/webhooks, auth bypassed via URL pattern in auth plugin
  await app.register(webhooksPlugin, { ...deps, prefix: '/api/webhooks' } as RouteDeps & { prefix: string });

  // NFT metadata routes — prefix /api/nft/metadata, auth bypassed for Solana explorer access
  await app.register(nftMetadataPlugin, { ...deps, prefix: '/api/nft/metadata' } as RouteDeps & { prefix: string });
}
