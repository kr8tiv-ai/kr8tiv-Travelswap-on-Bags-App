// ─── Flight Search Routes ──────────────────────────────────────
// POST /search — search flights via Duffel, returns cached offers
// GET /offers/:requestId — retrieve cached offers by request ID

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { logger } from '../logger.js';
import { sendError } from './errors.js';
import type { RouteDeps } from './types.js';

const log = logger.child({ component: 'routes/flights' });

// ─── Zod Schemas ───────────────────────────────────────────────

const cabinClassSchema = z.enum([
  'economy',
  'premium_economy',
  'business',
  'first',
]);

const searchBodySchema = z.object({
  origin: z
    .string()
    .min(2, 'origin must be at least 2 characters')
    .max(4, 'origin must be at most 4 characters')
    .transform((v) => v.toUpperCase()),
  destination: z
    .string()
    .min(2, 'destination must be at least 2 characters')
    .max(4, 'destination must be at most 4 characters')
    .transform((v) => v.toUpperCase()),
  departureDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'departureDate must be YYYY-MM-DD format'),
  returnDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'returnDate must be YYYY-MM-DD format')
    .optional(),
  passengers: z.coerce.number().int().min(1).max(9).default(1),
  cabinClass: cabinClassSchema.optional(),
});

// ─── Route Plugin ──────────────────────────────────────────────

async function flightsRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): Promise<void> {
  const { duffelClient } = deps;

  // ─── POST /search ────────────────────────────────────────────

  app.post(
    '/search',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!duffelClient) {
        log.warn('Flight search requested but DuffelClient not configured');
        reply.status(503).send({
          error: 'Flight search is not configured. Set DUFFEL_API_TOKEN to enable.',
          statusCode: 503,
        });
        return;
      }

      // Validate body
      const parsed = searchBodySchema.safeParse(request.body);
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

      const { origin, destination, departureDate, returnDate, passengers, cabinClass } = parsed.data;

      log.info(
        { origin, destination, departureDate, returnDate, passengers, cabinClass },
        'Flight search request received',
      );

      try {
        const result = await duffelClient.searchFlights({
          origin,
          destination,
          departureDate,
          returnDate,
          passengers,
          cabinClass,
        });

        reply.status(200).send({
          requestId: result.requestId,
          offers: result.offers,
          expiresAt: result.expiresAt,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error({ err, origin, destination }, 'Flight search failed');
        reply.status(502).send({
          error: `Flight search failed: ${message}`,
          statusCode: 502,
        });
      }
    },
  );

  // ─── GET /offers/:requestId ──────────────────────────────────

  app.get(
    '/offers/:requestId',
    async (
      request: FastifyRequest<{ Params: { requestId: string } }>,
      reply: FastifyReply,
    ) => {
      if (!duffelClient) {
        reply.status(503).send({
          error: 'Flight search is not configured. Set DUFFEL_API_TOKEN to enable.',
          statusCode: 503,
        });
        return;
      }

      const { requestId } = request.params;

      if (!requestId || requestId.trim() === '') {
        reply.status(400).send({
          error: 'requestId parameter is required',
          statusCode: 400,
        });
        return;
      }

      const result = duffelClient.getCachedOffers(requestId);

      if (!result) {
        log.info({ requestId }, 'Cached offers not found or expired');
        reply.status(404).send({
          error: 'Offers not found or expired. Please search again.',
          re_search: true,
          statusCode: 404,
        });
        return;
      }

      reply.status(200).send({
        requestId: result.requestId,
        offers: result.offers,
        expiresAt: result.expiresAt,
      });
    },
  );
}

export const flightsPlugin = flightsRoutes;
