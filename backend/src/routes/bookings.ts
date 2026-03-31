// ─── Booking Routes ────────────────────────────────────────────
// POST /book — book a flight offer (validates balance, creates Duffel order, deducts balance)
// GET /       — list bookings by wallet (decrypted names only)
// GET /:id    — full booking detail with decrypted passenger data

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { logger } from '../logger.js';
import type { RouteDeps } from './types.js';

const log = logger.child({ component: 'routes/bookings' });

// ─── Zod Schemas ───────────────────────────────────────────────

const passengerSchema = z.object({
  givenName: z.string().min(1, 'givenName is required'),
  familyName: z.string().min(1, 'familyName is required'),
  bornOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'bornOn must be YYYY-MM-DD'),
  email: z.string().email('invalid email'),
  phoneNumber: z.string().min(1, 'phoneNumber is required'),
  gender: z.enum(['male', 'female']),
});

const bookBodySchema = z.object({
  offerId: z.string().min(1, 'offerId is required'),
  requestId: z.string().min(1, 'requestId is required'),
  strategyId: z.coerce.number().int().positive('strategyId must be a positive integer'),
  walletAddress: z.string().min(1, 'walletAddress is required'),
  passengers: z.array(passengerSchema).min(1, 'at least one passenger is required'),
});

// ─── Route Plugin ──────────────────────────────────────────────

async function bookingsRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): Promise<void> {
  const { duffelClient, bookingService, travelBalanceService } = deps;

  // ─── POST /book ──────────────────────────────────────────────

  app.post(
    '/book',
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Check DuffelClient configured
      if (!duffelClient) {
        log.warn('Booking requested but DuffelClient not configured');
        reply.status(503).send({
          error: 'Flight booking is not configured. Set DUFFEL_API_TOKEN to enable.',
          statusCode: 503,
        });
        return;
      }

      // Check BookingService configured
      if (!bookingService) {
        log.error('Booking requested but BookingService not wired');
        reply.status(500).send({
          error: 'Booking service is not available.',
          statusCode: 500,
        });
        return;
      }

      // Validate body
      const parsed = bookBodySchema.safeParse(request.body);
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

      const { offerId, requestId, strategyId, walletAddress, passengers } = parsed.data;

      // Look up cached offers to validate the offer is still fresh
      const cached = duffelClient.getCachedOffers(requestId);
      if (!cached) {
        log.info({ requestId }, 'Offer request not found or expired');
        reply.status(400).send({
          error: 'Offer expired or not found. Please search again.',
          re_search: true,
          statusCode: 400,
        });
        return;
      }

      const offer = cached.offers.find((o) => o.id === offerId);
      if (!offer) {
        log.info({ offerId, requestId }, 'Offer not found in cached results');
        reply.status(400).send({
          error: 'Offer not found in search results. It may have expired. Please search again.',
          re_search: true,
          statusCode: 400,
        });
        return;
      }

      const totalAmount = parseFloat(offer.totalAmount);

      // Check wallet balance is sufficient BEFORE calling Duffel (K010)
      const balance = await travelBalanceService.getByStrategyAndWallet(strategyId, walletAddress);
      if (!balance || balance.balanceUsd < totalAmount) {
        const available = balance?.balanceUsd ?? 0;
        log.info(
          { walletAddress, strategyId, required: totalAmount, available },
          'Insufficient balance for booking',
        );
        reply.status(400).send({
          error: `Insufficient balance: have $${available.toFixed(2)}, need $${totalAmount.toFixed(2)}`,
          statusCode: 400,
        });
        return;
      }

      // Create Duffel order
      let duffelOrder;
      try {
        duffelOrder = await duffelClient.createOrder({
          offerId,
          passengers,
          amount: totalAmount,
          currency: offer.totalCurrency,
          metadata: {
            strategyId: String(strategyId),
            walletAddress,
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error({ err, offerId, walletAddress }, 'Duffel order creation failed');
        reply.status(502).send({
          error: `Flight booking failed: ${message}`,
          statusCode: 502,
        });
        return;
      }

      // Create booking record with PENDING status, then transition to CONFIRMED
      let booking;
      try {
        booking = await bookingService.create({
          strategyId,
          walletAddress,
          offerId,
          passengers,
          amountUsd: totalAmount,
          currency: offer.totalCurrency,
        });

        booking = await bookingService.updateStatus(booking.id as unknown as number, 'CONFIRMED', {
          duffelOrderId: duffelOrder.id,
          bookingReference: duffelOrder.bookingReference,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error({ err, offerId, walletAddress }, 'Failed to create booking record');
        reply.status(500).send({
          error: `Booking record creation failed: ${message}`,
          statusCode: 500,
        });
        return;
      }

      // Deduct balance AFTER Duffel order succeeds (K010)
      try {
        await travelBalanceService.deduct(strategyId, walletAddress, totalAmount);
      } catch (err) {
        // Balance deduction failed but order was placed — log and continue
        // The booking record still exists (counted as purchased)
        log.error(
          { err, bookingId: booking.id, walletAddress, totalAmount },
          'Balance deduction failed after successful Duffel order — booking still recorded',
        );
      }

      log.info(
        {
          bookingId: booking.id,
          duffelOrderId: duffelOrder.id,
          bookingReference: duffelOrder.bookingReference,
          walletAddress,
          amountUsd: totalAmount,
        },
        'Booking completed',
      );

      reply.status(201).send(booking);
    },
  );

  // ─── GET / ───────────────────────────────────────────────────

  app.get(
    '/',
    async (
      request: FastifyRequest<{ Querystring: { wallet?: string } }>,
      reply: FastifyReply,
    ) => {
      if (!bookingService) {
        reply.status(500).send({
          error: 'Booking service is not available.',
          statusCode: 500,
        });
        return;
      }

      const wallet = (request.query as { wallet?: string })?.wallet;
      if (!wallet || wallet.trim() === '') {
        reply.status(400).send({
          error: 'wallet query parameter is required',
          statusCode: 400,
        });
        return;
      }

      const bookings = await bookingService.getByWallet(wallet);
      reply.status(200).send(bookings);
    },
  );

  // ─── GET /:id ────────────────────────────────────────────────

  app.get(
    '/:id',
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      if (!bookingService) {
        reply.status(500).send({
          error: 'Booking service is not available.',
          statusCode: 500,
        });
        return;
      }

      const { id } = request.params;
      const bookingId = parseInt(id, 10);

      if (isNaN(bookingId) || bookingId <= 0) {
        reply.status(400).send({
          error: 'Invalid booking ID',
          statusCode: 400,
        });
        return;
      }

      const booking = await bookingService.getById(bookingId);
      if (!booking) {
        reply.status(404).send({
          error: 'Booking not found',
          statusCode: 404,
        });
        return;
      }

      reply.status(200).send(booking);
    },
  );
}

export const bookingsPlugin = bookingsRoutes;
