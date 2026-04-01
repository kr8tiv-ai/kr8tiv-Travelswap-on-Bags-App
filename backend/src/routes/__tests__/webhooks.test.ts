// ─── CoinVoyage Webhook Tests ──────────────────────────────────
// Tests for POST /api/webhooks/coinvoyage covering HMAC verification,
// status transitions, idempotency, error paths, and auth bypass.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { webhooksPlugin } from '../webhooks.js';
import { authPlugin } from '../../plugins/auth.js';
import type { GiftCardService } from '../../services/GiftCardService.js';
import type { RouteDeps } from '../types.js';
import type { GiftCard, GiftCardStatus } from '../../types/index.js';
import type { Config } from '../../config/index.js';

// ─── Constants ─────────────────────────────────────────────────

const WEBHOOK_SECRET = 'test-webhook-secret-key-for-hmac';
const AUTH_TOKEN = 'test-auth-bearer-token';
const ENCRYPTION_KEY = 'a'.repeat(64);

// ─── Helpers ───────────────────────────────────────────────────

function signPayload(body: string, secret: string = WEBHOOK_SECRET): string {
  return createHmac('sha256', secret).update(body).digest('base64');
}

function makeGiftCard(overrides: Partial<GiftCard> = {}): GiftCard {
  return {
    giftCardId: '42',
    strategyId: '1',
    runId: '1',
    walletAddress: 'WalletAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    denominationUsd: 50,
    codeEncrypted: '',
    status: 'PENDING' as GiftCardStatus,
    payorderId: 'po_test_123',
    paymentStatus: 'PENDING',
    errorMessage: null,
    deliveredAt: null,
    redeemedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    bagsApiKey: 'test-bags-key',
    bagsApiBaseUrl: 'https://api.bags.fm',
    heliusApiKey: 'test-helius-key',
    heliusRpcUrl: 'https://mainnet.helius-rpc.com',
    apiAuthToken: AUTH_TOKEN,
    giftCardEncryptionKey: ENCRYPTION_KEY,
    giftCardDailyLimit: 20,
    giftCardMaxDenomination: 200,
    balanceMaxUsd: 1000,
    travelswapPartnerRef: 'TEST',
    dryRun: false,
    executionKillSwitch: false,
    maxDailyRuns: 4,
    maxClaimableSolPerRun: 100,
    minIntervalMinutes: 60,
    feeThresholdSol: 5,
    feeSource: 'CLAIMABLE_POSITIONS',
    swapSlippageBps: 50,
    distributionMode: 'TOP_N_HOLDERS',
    distributionTopN: 100,
    creditMode: 'GIFT_CARD',
    cronExpression: '0 */6 * * *',
    port: 3001,
    databasePath: ':memory:',
    logLevel: 'error',
    nodeEnv: 'test',
    corsOrigins: '',
    coinVoyageWebhookSecret: WEBHOOK_SECRET,
    ...overrides,
  } as Config;
}

function createMockGiftCardService(pendingCard?: GiftCard): GiftCardService {
  const confirmedCard = pendingCard
    ? { ...pendingCard, status: 'PURCHASED' as GiftCardStatus, codeEncrypted: 'encrypted-code', paymentStatus: 'COMPLETED' }
    : undefined;

  const expiredCard = pendingCard
    ? { ...pendingCard, status: 'EXPIRED' as GiftCardStatus }
    : undefined;

  return {
    getById: vi.fn().mockResolvedValue(undefined),
    purchase: vi.fn(),
    purchasePending: vi.fn(),
    getByPayorderId: vi.fn().mockResolvedValue(pendingCard),
    getByWallet: vi.fn(),
    getByRun: vi.fn(),
    getByStrategy: vi.fn(),
    updateStatus: vi.fn().mockResolvedValue(expiredCard),
    confirmPurchase: vi.fn().mockResolvedValue(confirmedCard),
  };
}

function createMockDeps(overrides: Partial<RouteDeps> = {}): RouteDeps {
  return {
    strategyService: {} as RouteDeps['strategyService'],
    runService: {} as RouteDeps['runService'],
    travelBalanceService: {} as RouteDeps['travelBalanceService'],
    giftCardService: createMockGiftCardService(),
    pipelineEngine: {} as RouteDeps['pipelineEngine'],
    runLock: {} as RouteDeps['runLock'],
    db: {} as RouteDeps['db'],
    config: makeConfig(),
    ...overrides,
  };
}

// ─── App Builder ───────────────────────────────────────────────

async function buildApp(deps: RouteDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  // Register auth plugin first (mirrors real app)
  await app.register(authPlugin, { apiAuthToken: deps.config.apiAuthToken });
  // Register webhook under /api/webhooks prefix
  await app.register(webhooksPlugin, { ...deps, prefix: '/api/webhooks' } as RouteDeps & { prefix: string });
  await app.ready();
  return app;
}

// ─── Tests ─────────────────────────────────────────────────────

describe('POST /api/webhooks/coinvoyage', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  // ── HMAC Verification ──────────────────────────────────────────

  describe('HMAC-SHA256 signature verification', () => {
    it('accepts valid HMAC signature', async () => {
      const pendingCard = makeGiftCard();
      const giftCardService = createMockGiftCardService(pendingCard);
      const deps = createMockDeps({ giftCardService });
      app = await buildApp(deps);

      const payload = JSON.stringify({
        event: 'payorder.completed',
        payorder_id: 'po_test_123',
        status: 'COMPLETED',
        gift_card_code: 'GC-REAL-CODE-123',
      });
      const signature = signPayload(payload);

      const response = await app.inject({
        method: 'POST',
        url: '/api/webhooks/coinvoyage',
        headers: {
          'content-type': 'application/json',
          'coinvoyage-webhook-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe('processed');
      expect(body.giftCardId).toBe('42');
    });

    it('rejects request with missing signature header (401)', async () => {
      const deps = createMockDeps();
      app = await buildApp(deps);

      const response = await app.inject({
        method: 'POST',
        url: '/api/webhooks/coinvoyage',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({
          event: 'payorder.completed',
          payorder_id: 'po_test_123',
          status: 'COMPLETED',
        }),
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().error).toBe('Missing signature');
    });

    it('rejects request with invalid HMAC signature (401)', async () => {
      const deps = createMockDeps();
      app = await buildApp(deps);

      const payload = JSON.stringify({
        event: 'payorder.completed',
        payorder_id: 'po_test_123',
        status: 'COMPLETED',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/webhooks/coinvoyage',
        headers: {
          'content-type': 'application/json',
          'coinvoyage-webhook-signature': 'INVALID_SIGNATURE_HERE',
        },
        payload,
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().error).toBe('Invalid signature');
    });

    it('rejects request signed with wrong secret (401)', async () => {
      const deps = createMockDeps();
      app = await buildApp(deps);

      const payload = JSON.stringify({
        event: 'payorder.completed',
        payorder_id: 'po_test_123',
        status: 'COMPLETED',
      });
      const badSignature = signPayload(payload, 'wrong-secret');

      const response = await app.inject({
        method: 'POST',
        url: '/api/webhooks/coinvoyage',
        headers: {
          'content-type': 'application/json',
          'coinvoyage-webhook-signature': badSignature,
        },
        payload,
      });

      expect(response.statusCode).toBe(401);
      expect(response.json().error).toBe('Invalid signature');
    });
  });

  // ── Auth Bypass ────────────────────────────────────────────────

  describe('auth bypass', () => {
    it('does NOT require Bearer token — webhook uses HMAC auth instead', async () => {
      const pendingCard = makeGiftCard();
      const giftCardService = createMockGiftCardService(pendingCard);
      const deps = createMockDeps({ giftCardService });
      app = await buildApp(deps);

      const payload = JSON.stringify({
        event: 'payorder.completed',
        payorder_id: 'po_test_123',
        status: 'COMPLETED',
        gift_card_code: 'GC-CODE-456',
      });
      const signature = signPayload(payload);

      // No Authorization header — should still work
      const response = await app.inject({
        method: 'POST',
        url: '/api/webhooks/coinvoyage',
        headers: {
          'content-type': 'application/json',
          'coinvoyage-webhook-signature': signature,
        },
        payload,
      });

      // Should NOT be 401 from auth plugin
      expect(response.statusCode).toBe(200);
    });
  });

  // ── Unknown payorder_id ────────────────────────────────────────

  describe('unknown payorder_id', () => {
    it('returns 404 when payorder_id has no matching gift card', async () => {
      const giftCardService = createMockGiftCardService(); // no card
      const deps = createMockDeps({ giftCardService });
      app = await buildApp(deps);

      const payload = JSON.stringify({
        event: 'payorder.completed',
        payorder_id: 'po_unknown_999',
        status: 'COMPLETED',
        gift_card_code: 'GC-CODE',
      });
      const signature = signPayload(payload);

      const response = await app.inject({
        method: 'POST',
        url: '/api/webhooks/coinvoyage',
        headers: {
          'content-type': 'application/json',
          'coinvoyage-webhook-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error).toBe('Unknown payorder_id');
    });
  });

  // ── Status Transition: PENDING → PURCHASED ────────────────────

  describe('completed event → PENDING → PURCHASED', () => {
    it('encrypts code and transitions gift card to PURCHASED', async () => {
      const pendingCard = makeGiftCard();
      const giftCardService = createMockGiftCardService(pendingCard);
      const deps = createMockDeps({ giftCardService });
      app = await buildApp(deps);

      const payload = JSON.stringify({
        event: 'payorder.completed',
        payorder_id: 'po_test_123',
        status: 'COMPLETED',
        gift_card_code: 'REAL-GIFT-CARD-CODE',
      });
      const signature = signPayload(payload);

      const response = await app.inject({
        method: 'POST',
        url: '/api/webhooks/coinvoyage',
        headers: {
          'content-type': 'application/json',
          'coinvoyage-webhook-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe('processed');
      expect(response.json().newStatus).toBe('PURCHASED');

      // Verify confirmPurchase was called with encrypted code (not plaintext)
      expect(giftCardService.confirmPurchase).toHaveBeenCalledOnce();
      const [id, encrypted] = (giftCardService.confirmPurchase as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(id).toBe(42); // Number(giftCardId)
      // Encrypted code should be in iv:ciphertext:authTag format
      expect(encrypted).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
      // Should NOT contain the plaintext
      expect(encrypted).not.toContain('REAL-GIFT-CARD-CODE');
    });

    it('rejects completed event without gift_card_code (400)', async () => {
      const pendingCard = makeGiftCard();
      const giftCardService = createMockGiftCardService(pendingCard);
      const deps = createMockDeps({ giftCardService });
      app = await buildApp(deps);

      const payload = JSON.stringify({
        event: 'payorder.completed',
        payorder_id: 'po_test_123',
        status: 'COMPLETED',
        // Missing gift_card_code
      });
      const signature = signPayload(payload);

      const response = await app.inject({
        method: 'POST',
        url: '/api/webhooks/coinvoyage',
        headers: {
          'content-type': 'application/json',
          'coinvoyage-webhook-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('gift_card_code');
    });
  });

  // ── Idempotency ────────────────────────────────────────────────

  describe('duplicate webhook idempotency', () => {
    it('returns 200 with already_processed for PURCHASED gift card', async () => {
      const purchasedCard = makeGiftCard({ status: 'PURCHASED' as GiftCardStatus, codeEncrypted: 'existing-enc' });
      const giftCardService = createMockGiftCardService(purchasedCard);
      (giftCardService.getByPayorderId as ReturnType<typeof vi.fn>).mockResolvedValue(purchasedCard);
      const deps = createMockDeps({ giftCardService });
      app = await buildApp(deps);

      const payload = JSON.stringify({
        event: 'payorder.completed',
        payorder_id: 'po_test_123',
        status: 'COMPLETED',
        gift_card_code: 'GC-DUPLICATE',
      });
      const signature = signPayload(payload);

      const response = await app.inject({
        method: 'POST',
        url: '/api/webhooks/coinvoyage',
        headers: {
          'content-type': 'application/json',
          'coinvoyage-webhook-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe('already_processed');
      // confirmPurchase should NOT be called for duplicate
      expect(giftCardService.confirmPurchase).not.toHaveBeenCalled();
    });

    it('returns 200 with already_processed for EXPIRED gift card on failed event', async () => {
      const expiredCard = makeGiftCard({ status: 'EXPIRED' as GiftCardStatus });
      const giftCardService = createMockGiftCardService(expiredCard);
      (giftCardService.getByPayorderId as ReturnType<typeof vi.fn>).mockResolvedValue(expiredCard);
      const deps = createMockDeps({ giftCardService });
      app = await buildApp(deps);

      const payload = JSON.stringify({
        event: 'payorder.failed',
        payorder_id: 'po_test_123',
        status: 'FAILED',
      });
      const signature = signPayload(payload);

      const response = await app.inject({
        method: 'POST',
        url: '/api/webhooks/coinvoyage',
        headers: {
          'content-type': 'application/json',
          'coinvoyage-webhook-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe('already_processed');
    });
  });

  // ── Failed Event → PENDING → EXPIRED ──────────────────────────

  describe('failed event → PENDING → EXPIRED', () => {
    it('transitions PENDING gift card to EXPIRED on failed event', async () => {
      const pendingCard = makeGiftCard();
      const giftCardService = createMockGiftCardService(pendingCard);
      const deps = createMockDeps({ giftCardService });
      app = await buildApp(deps);

      const payload = JSON.stringify({
        event: 'payorder.failed',
        payorder_id: 'po_test_123',
        status: 'FAILED',
      });
      const signature = signPayload(payload);

      const response = await app.inject({
        method: 'POST',
        url: '/api/webhooks/coinvoyage',
        headers: {
          'content-type': 'application/json',
          'coinvoyage-webhook-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe('processed');
      expect(giftCardService.updateStatus).toHaveBeenCalledWith(42, 'EXPIRED');
    });
  });

  // ── Status Conflict ────────────────────────────────────────────

  describe('status conflict', () => {
    it('returns 409 when gift card is DELIVERED and completed event arrives', async () => {
      const deliveredCard = makeGiftCard({ status: 'DELIVERED' as GiftCardStatus });
      const giftCardService = createMockGiftCardService(deliveredCard);
      (giftCardService.getByPayorderId as ReturnType<typeof vi.fn>).mockResolvedValue(deliveredCard);
      const deps = createMockDeps({ giftCardService });
      app = await buildApp(deps);

      const payload = JSON.stringify({
        event: 'payorder.completed',
        payorder_id: 'po_test_123',
        status: 'COMPLETED',
        gift_card_code: 'GC-CODE',
      });
      const signature = signPayload(payload);

      const response = await app.inject({
        method: 'POST',
        url: '/api/webhooks/coinvoyage',
        headers: {
          'content-type': 'application/json',
          'coinvoyage-webhook-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().error).toContain('DELIVERED');
    });
  });

  // ── Malformed Payload ──────────────────────────────────────────

  describe('malformed payloads', () => {
    it('returns 400 when payload is missing payorder_id', async () => {
      const deps = createMockDeps();
      app = await buildApp(deps);

      const payload = JSON.stringify({
        event: 'payorder.completed',
        status: 'COMPLETED',
      });
      const signature = signPayload(payload);

      const response = await app.inject({
        method: 'POST',
        url: '/api/webhooks/coinvoyage',
        headers: {
          'content-type': 'application/json',
          'coinvoyage-webhook-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('payorder_id');
    });

    it('returns 400 when payload is missing event', async () => {
      const deps = createMockDeps();
      app = await buildApp(deps);

      const payload = JSON.stringify({
        payorder_id: 'po_test_123',
        status: 'COMPLETED',
      });
      const signature = signPayload(payload);

      const response = await app.inject({
        method: 'POST',
        url: '/api/webhooks/coinvoyage',
        headers: {
          'content-type': 'application/json',
          'coinvoyage-webhook-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(400);
    });
  });

  // ── Acknowledged Events ────────────────────────────────────────

  describe('non-completion events', () => {
    it('acknowledges events that are neither completed nor failed', async () => {
      const pendingCard = makeGiftCard();
      const giftCardService = createMockGiftCardService(pendingCard);
      const deps = createMockDeps({ giftCardService });
      app = await buildApp(deps);

      const payload = JSON.stringify({
        event: 'payorder.awaiting_payment',
        payorder_id: 'po_test_123',
        status: 'AWAITING_PAYMENT',
      });
      const signature = signPayload(payload);

      const response = await app.inject({
        method: 'POST',
        url: '/api/webhooks/coinvoyage',
        headers: {
          'content-type': 'application/json',
          'coinvoyage-webhook-signature': signature,
        },
        payload,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe('acknowledged');
      expect(response.json().event).toBe('payorder.awaiting_payment');
      // No state transitions
      expect(giftCardService.confirmPurchase).not.toHaveBeenCalled();
      expect(giftCardService.updateStatus).not.toHaveBeenCalled();
    });
  });

  // ── Unconfigured Secret → 503 ──────────────────────────────────

  describe('unconfigured webhook secret', () => {
    it('returns 503 when coinVoyageWebhookSecret is not set', async () => {
      const config = makeConfig({ coinVoyageWebhookSecret: undefined });
      const deps = createMockDeps({ config });
      app = await buildApp(deps);

      const response = await app.inject({
        method: 'POST',
        url: '/api/webhooks/coinvoyage',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ event: 'test', payorder_id: 'po_1' }),
      });

      expect(response.statusCode).toBe(503);
      expect(response.json().error).toContain('not configured');
    });
  });
});
