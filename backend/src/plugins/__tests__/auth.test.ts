// ─── Auth Plugin Tests ─────────────────────────────────────────
// Verifies auth skip patterns including webhook routes (D036).

import { describe, it, expect } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { authPlugin } from '../auth.js';

const AUTH_TOKEN = 'test-token-12345';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(authPlugin, { apiAuthToken: AUTH_TOKEN });

  // Register test routes to exercise auth
  app.get('/health', async () => ({ status: 'ok' }));
  app.get('/health/live', async () => ({ status: 'live' }));
  app.get('/api/strategies', async () => ({ data: [] }));
  app.post('/api/webhooks/coinvoyage', async () => ({ status: 'ok' }));
  app.post('/api/webhooks/other', async () => ({ status: 'ok' }));

  await app.ready();
  return app;
}

describe('Auth Plugin', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('allows health routes without auth', async () => {
    app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });

  it('allows health sub-routes without auth', async () => {
    app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/health/live' });
    expect(res.statusCode).toBe(200);
  });

  it('rejects API routes without auth (401)', async () => {
    app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/strategies' });
    expect(res.statusCode).toBe(401);
  });

  it('allows API routes with valid Bearer token', async () => {
    app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/strategies',
      headers: { authorization: `Bearer ${AUTH_TOKEN}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects API routes with invalid Bearer token (401)', async () => {
    app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/strategies',
      headers: { authorization: 'Bearer wrong-token' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('skips auth for /api/webhooks/ routes (webhook auth bypass)', async () => {
    app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/coinvoyage',
      headers: { 'content-type': 'application/json' },
      payload: '{}',
    });
    // Should not be 401 — webhooks bypass bearer auth
    expect(res.statusCode).not.toBe(401);
  });

  it('skips auth for all /api/webhooks/* routes', async () => {
    app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks/other',
      headers: { 'content-type': 'application/json' },
      payload: '{}',
    });
    expect(res.statusCode).not.toBe(401);
  });
});
