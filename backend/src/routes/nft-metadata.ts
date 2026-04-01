// ─── NFT Metadata Route ────────────────────────────────────────
// Serves Metaplex-standard JSON for cNFT travel passes.
// GET /api/nft/metadata/:id — publicly accessible (no auth).
// Solana explorers and wallets resolve this URI to display NFT
// metadata including name, description, image, and attributes.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RouteDeps } from './types.js';
import { logger } from '../logger.js';

const log = logger.child({ component: 'routes/nft-metadata' });

// ─── Validation ────────────────────────────────────────────────

const idParamSchema = z.object({
  id: z.string().regex(/^\d+$/, 'ID must be a positive integer'),
});

// ─── Route Registration ────────────────────────────────────────

async function nftMetadataRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): Promise<void> {
  const { travelPassService, config } = deps;

  // GET /api/nft/metadata/:id — returns Metaplex-standard JSON
  app.get<{ Params: { id: string } }>('/:id', async (request, reply) => {
    if (!travelPassService) {
      reply.status(503).send({ error: 'NFT metadata service not available' });
      return;
    }

    // ── Validate :id ──
    const parseResult = idParamSchema.safeParse(request.params);
    if (!parseResult.success) {
      reply.status(400).send({ error: 'Invalid ID: must be a positive integer' });
      return;
    }

    const id = Number(parseResult.data.id);

    try {
      const travelPass = await travelPassService.getById(id);
      if (!travelPass) {
        reply.status(404).send({ error: 'Travel pass not found' });
        return;
      }

      // ── Build Metaplex-standard metadata ──
      const metadata = {
        name: `TravelPass #${travelPass.id}`,
        description: `Travel credit pass worth $${travelPass.denominationUsd} USD, minted on Solana as a compressed NFT.`,
        image: `${config.metadataBaseUrl}/api/nft/image/${travelPass.id}`,
        external_url: `${config.metadataBaseUrl}/travel-pass/${travelPass.id}`,
        attributes: [
          { trait_type: 'Travel Type', value: 'Gift Card' },
          { trait_type: 'Amount USD', value: String(travelPass.denominationUsd) },
          { trait_type: 'Date', value: travelPass.createdAt },
          { trait_type: 'Token', value: travelPass.tokenMint },
          { trait_type: 'Strategy', value: travelPass.strategyId },
          { trait_type: 'Status', value: travelPass.status },
        ],
        properties: {
          category: 'travel_pass',
        },
      };

      reply.header('Content-Type', 'application/json');
      reply.header('Cache-Control', 'public, max-age=3600');
      reply.send(metadata);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      log.error({ error: errorMessage, id }, 'Failed to retrieve travel pass metadata');
      reply.status(500).send({ error: 'Internal server error' });
    }
  });
}

export const nftMetadataPlugin = nftMetadataRoutes;
