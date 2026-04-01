// ─── CoinVoyage Webhook Route ──────────────────────────────────
// POST /api/webhooks/coinvoyage receives webhook events from CoinVoyage
// when a PayOrder status changes. Uses HMAC-SHA256 signature verification.
// Auth bypass: this route is NOT behind the Bearer token auth plugin —
// authenticated by webhook signature instead (D036).

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { verifyCoinVoyageWebhookSignature } from '../clients/CoinVoyageClient.js';
import { encryptCode } from '../utils/encryption.js';
import { logger } from '../logger.js';
import { sendError } from './errors.js';
import type { RouteDeps } from './types.js';

const log = logger.child({ component: 'routes/webhooks' });

// ─── Webhook Event Shape ───────────────────────────────────────

interface CoinVoyageWebhookEvent {
  /** CoinVoyage event type (e.g. 'payorder.completed', 'payorder.failed'). */
  event: string;
  /** PayOrder ID this event refers to. */
  payorder_id: string;
  /** New status of the PayOrder. */
  status: string;
  /** Gift card code delivered on completion. */
  gift_card_code?: string;
  /** ISO 8601 timestamp of the event. */
  timestamp?: string;
  /** Additional event data. */
  data?: Record<string, unknown>;
}

// ─── Signature Header ──────────────────────────────────────────

const SIGNATURE_HEADER = 'coinvoyage-webhook-signature';

// ─── Route Plugin ──────────────────────────────────────────────

export async function webhooksPlugin(
  app: FastifyInstance,
  deps: RouteDeps,
): Promise<void> {
  const { giftCardService, config } = deps;
  const webhookSecret = config.coinVoyageWebhookSecret;

  // If no webhook secret configured, register a 503 handler
  if (!webhookSecret) {
    app.post('/coinvoyage', async (_request: FastifyRequest, reply: FastifyReply) => {
      log.warn('CoinVoyage webhook received but coinVoyageWebhookSecret is not configured');
      sendError(reply, 503, 'Webhook endpoint not configured');
    });
    return;
  }

  // ─── Raw body capture ──────────────────────────────────────────
  // Fastify parses JSON by default. We need the raw body for HMAC verification.
  // Use the addContentTypeParser to capture raw body alongside parsed JSON.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_req: FastifyRequest, body: string, done: (err: Error | null, result?: unknown) => void) => {
      try {
        const json = JSON.parse(body);
        // Attach raw body for HMAC verification
        (json as Record<string, unknown>).__rawBody = body;
        done(null, json);
      } catch (err) {
        done(err instanceof Error ? err : new Error(String(err)));
      }
    },
  );

  app.post('/coinvoyage', async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();
    const body = request.body as (CoinVoyageWebhookEvent & { __rawBody?: string }) | null;
    const rawBody = body?.__rawBody ?? '';
    const signature = request.headers[SIGNATURE_HEADER] as string | undefined;

    // ── Validate signature ───────────────────────────────────────
    if (!signature) {
      log.warn(
        { ip: request.ip, url: request.url },
        'Webhook request missing signature header',
      );
      sendError(reply, 401, 'Missing signature');
      return;
    }

    if (!verifyCoinVoyageWebhookSignature(rawBody, signature, webhookSecret)) {
      log.warn(
        {
          ip: request.ip,
          signatureTruncated: signature.substring(0, 8) + '...',
        },
        'Webhook HMAC verification failed',
      );
      sendError(reply, 401, 'Invalid signature');
      return;
    }

    // ── Validate payload ─────────────────────────────────────────
    if (!body || !body.payorder_id || !body.event) {
      log.warn(
        { ip: request.ip, body: body ? { event: body.event, payorder_id: body.payorder_id } : null },
        'Webhook payload missing required fields',
      );
      sendError(reply, 400, 'Invalid webhook payload: missing payorder_id or event');
      return;
    }

    const { payorder_id, event, status, gift_card_code } = body;

    log.info(
      { payorderId: payorder_id, event, status, durationMs: Date.now() - startTime },
      'Webhook event received and authenticated',
    );

    // ── Look up gift card by payorder_id ─────────────────────────
    const giftCard = await giftCardService.getByPayorderId(payorder_id);

    if (!giftCard) {
      log.warn(
        { payorderId: payorder_id, event },
        'Webhook references unknown payorder_id — no matching gift card',
      );
      sendError(reply, 404, 'Unknown payorder_id');
      return;
    }

    // ── Handle completed events ──────────────────────────────────
    if (event === 'payorder.completed' || status === 'COMPLETED') {
      // Idempotency: if already PURCHASED, return success without re-processing
      if (giftCard.status === 'PURCHASED') {
        log.info(
          { giftCardId: giftCard.giftCardId, payorderId: payorder_id },
          'Duplicate webhook — gift card already PURCHASED, returning 200',
        );
        reply.status(200).send({
          status: 'already_processed',
          giftCardId: giftCard.giftCardId,
        });
        return;
      }

      if (giftCard.status !== 'PENDING') {
        log.warn(
          {
            giftCardId: giftCard.giftCardId,
            currentStatus: giftCard.status,
            payorderId: payorder_id,
          },
          'Cannot transition gift card — unexpected status',
        );
        sendError(reply, 409, `Gift card is ${giftCard.status}, cannot transition to PURCHASED`);
        return;
      }

      if (!gift_card_code) {
        log.error(
          { giftCardId: giftCard.giftCardId, payorderId: payorder_id },
          'Completed webhook missing gift_card_code',
        );
        sendError(reply, 400, 'Completed event missing gift_card_code');
        return;
      }

      // Encrypt the gift card code and confirm purchase
      const encryptedCode = encryptCode(gift_card_code, config.giftCardEncryptionKey);
      const updated = await giftCardService.confirmPurchase(
        Number(giftCard.giftCardId),
        encryptedCode,
      );

      log.info(
        {
          giftCardId: updated.giftCardId,
          payorderId: payorder_id,
          fromStatus: 'PENDING',
          toStatus: 'PURCHASED',
          durationMs: Date.now() - startTime,
        },
        'Gift card transitioned PENDING → PURCHASED via webhook',
      );

      reply.status(200).send({
        status: 'processed',
        giftCardId: updated.giftCardId,
        newStatus: updated.status,
      });
      return;
    }

    // ── Handle failed events ─────────────────────────────────────
    if (event === 'payorder.failed' || status === 'FAILED') {
      if (giftCard.status === 'EXPIRED') {
        log.info(
          { giftCardId: giftCard.giftCardId, payorderId: payorder_id },
          'Duplicate failed webhook — gift card already EXPIRED',
        );
        reply.status(200).send({
          status: 'already_processed',
          giftCardId: giftCard.giftCardId,
        });
        return;
      }

      if (giftCard.status === 'PENDING') {
        const updated = await giftCardService.updateStatus(
          Number(giftCard.giftCardId),
          'EXPIRED',
        );

        log.info(
          {
            giftCardId: updated.giftCardId,
            payorderId: payorder_id,
            fromStatus: 'PENDING',
            toStatus: 'EXPIRED',
            durationMs: Date.now() - startTime,
          },
          'Gift card transitioned PENDING → EXPIRED via failed webhook',
        );

        reply.status(200).send({
          status: 'processed',
          giftCardId: updated.giftCardId,
          newStatus: updated.status,
        });
        return;
      }
    }

    // ── Acknowledge other events ─────────────────────────────────
    log.info(
      { payorderId: payorder_id, event, status, giftCardId: giftCard.giftCardId },
      'Webhook event acknowledged (no state change)',
    );

    reply.status(200).send({ status: 'acknowledged', event });
  });
}
