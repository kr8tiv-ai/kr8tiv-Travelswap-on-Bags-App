// ─── NFT Metadata Route Tests ──────────────────────────────────
// Tests the GET /api/nft/metadata/:id endpoint.
// Validates: Metaplex-standard JSON format, 404 for missing,
// 400 for invalid ID, correct attributes, no auth required.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { nftMetadataPlugin } from '../nft-metadata.js';
import type { TravelPassService } from '../../services/TravelPassService.js';
import type { TravelPass } from '../../types/index.js';
import type { RouteDeps } from '../types.js';

// ─── Helpers ───────────────────────────────────────────────────

function makeTravelPass(overrides?: Partial<TravelPass>): TravelPass {
  return {
    id: '1',
    giftCardId: '42',
    strategyId: '7',
    walletAddress: '9WzDXwBbmPXSvHCrr4iDBf3cXMZxZzHjLdYQHiLLbpNp',
    denominationUsd: 25,
    tokenMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    mintSignature: null,
    metadataUri: null,
    status: 'PENDING',
    errorMessage: null,
    createdAt: '2026-03-31T06:00:00.000Z',
    mintedAt: null,
    ...overrides,
  };
}

function makeMockTravelPassService(travelPass?: TravelPass): TravelPassService {
  return {
    create: vi.fn(),
    getById: vi.fn().mockResolvedValue(travelPass ?? undefined),
    getByGiftCardId: vi.fn(),
    getByWallet: vi.fn(),
    updateMinted: vi.fn(),
    updateFailed: vi.fn(),
  };
}

async function buildTestApp(
  travelPassService?: TravelPassService,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  const deps = {
    travelPassService,
    config: {
      metadataBaseUrl: 'https://flightbrain.example.com',
    },
  } as unknown as RouteDeps;

  await app.register(nftMetadataPlugin, { ...deps, prefix: '/api/nft/metadata' } as RouteDeps & { prefix: string });
  await app.ready();
  return app;
}

// ─── Tests ─────────────────────────────────────────────────────

describe('NFT Metadata Routes', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('GET /api/nft/metadata/:id', () => {
    it('returns valid Metaplex-standard JSON for existing travel pass', async () => {
      const travelPass = makeTravelPass();
      const service = makeMockTravelPassService(travelPass);
      app = await buildTestApp(service);

      const res = await app.inject({
        method: 'GET',
        url: '/api/nft/metadata/1',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      // Metaplex standard fields
      expect(body.name).toBe('TravelPass #1');
      expect(body.description).toContain('$25');
      expect(body.image).toBe('https://flightbrain.example.com/api/nft/image/1');
      expect(body.external_url).toBe('https://flightbrain.example.com/travel-pass/1');

      // Attributes array with trait_type/value pairs
      expect(body.attributes).toBeInstanceOf(Array);
      expect(body.attributes.length).toBeGreaterThanOrEqual(5);

      const attrMap = new Map(body.attributes.map((a: any) => [a.trait_type, a.value]));
      expect(attrMap.get('Travel Type')).toBe('Gift Card');
      expect(attrMap.get('Amount USD')).toBe('25');
      expect(attrMap.get('Token')).toBe('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
      expect(attrMap.get('Strategy')).toBe('7');
      expect(attrMap.get('Status')).toBe('PENDING');
      expect(attrMap.get('Date')).toBe('2026-03-31T06:00:00.000Z');

      // Properties
      expect(body.properties).toEqual({ category: 'travel_pass' });
    });

    it('returns metadata for MINTED travel pass', async () => {
      const travelPass = makeTravelPass({
        status: 'MINTED',
        mintSignature: 'sig123',
        metadataUri: 'https://example.com/metadata/1',
        mintedAt: '2026-03-31T07:00:00.000Z',
      });
      const service = makeMockTravelPassService(travelPass);
      app = await buildTestApp(service);

      const res = await app.inject({
        method: 'GET',
        url: '/api/nft/metadata/1',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      const attrMap = new Map(body.attributes.map((a: any) => [a.trait_type, a.value]));
      expect(attrMap.get('Status')).toBe('MINTED');
    });

    it('returns metadata for PENDING travel pass (URI known before minting)', async () => {
      const travelPass = makeTravelPass({ status: 'PENDING' });
      const service = makeMockTravelPassService(travelPass);
      app = await buildTestApp(service);

      const res = await app.inject({
        method: 'GET',
        url: '/api/nft/metadata/1',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.name).toBe('TravelPass #1');
    });

    it('sets Cache-Control header', async () => {
      const travelPass = makeTravelPass();
      const service = makeMockTravelPassService(travelPass);
      app = await buildTestApp(service);

      const res = await app.inject({
        method: 'GET',
        url: '/api/nft/metadata/1',
      });

      expect(res.headers['cache-control']).toBe('public, max-age=3600');
      expect(res.headers['content-type']).toContain('application/json');
    });
  });

  describe('error cases', () => {
    it('returns 404 for nonexistent travel pass', async () => {
      const service = makeMockTravelPassService(undefined);
      app = await buildTestApp(service);

      const res = await app.inject({
        method: 'GET',
        url: '/api/nft/metadata/999',
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('Travel pass not found');
    });

    it('returns 400 for non-integer ID', async () => {
      const service = makeMockTravelPassService();
      app = await buildTestApp(service);

      const res = await app.inject({
        method: 'GET',
        url: '/api/nft/metadata/abc',
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('Invalid ID');
    });

    it('returns 400 for negative ID', async () => {
      const service = makeMockTravelPassService();
      app = await buildTestApp(service);

      const res = await app.inject({
        method: 'GET',
        url: '/api/nft/metadata/-1',
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 400 for decimal ID', async () => {
      const service = makeMockTravelPassService();
      app = await buildTestApp(service);

      const res = await app.inject({
        method: 'GET',
        url: '/api/nft/metadata/1.5',
      });

      expect(res.statusCode).toBe(400);
    });

    it('returns 503 when travelPassService is not available', async () => {
      app = await buildTestApp(undefined);

      const res = await app.inject({
        method: 'GET',
        url: '/api/nft/metadata/1',
      });

      expect(res.statusCode).toBe(503);
      expect(res.json().error).toContain('not available');
    });

    it('returns 500 when service throws', async () => {
      const service = makeMockTravelPassService();
      (service.getById as any).mockRejectedValue(new Error('DB connection lost'));
      app = await buildTestApp(service);

      const res = await app.inject({
        method: 'GET',
        url: '/api/nft/metadata/1',
      });

      expect(res.statusCode).toBe(500);
      expect(res.json().error).toBe('Internal server error');
    });
  });

  describe('no auth required', () => {
    it('does not require Authorization header', async () => {
      const travelPass = makeTravelPass();
      const service = makeMockTravelPassService(travelPass);
      app = await buildTestApp(service);

      // No auth headers at all — should still succeed
      const res = await app.inject({
        method: 'GET',
        url: '/api/nft/metadata/1',
        headers: {},
      });

      expect(res.statusCode).toBe(200);
    });
  });
});
