import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { authPlugin } from '../auth.js';

const TEST_TOKEN = 'test-secret-token-abc123';

describe('authPlugin', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify({ logger: false });
    await app.register(authPlugin, { apiAuthToken: TEST_TOKEN });

    // Add a test route behind auth
    app.get('/api/test', async () => ({ ok: true }));

    // Add a health route (should skip auth)
    app.get('/health/live', async () => ({ status: 'ok' }));

    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 401 when no Authorization header is provided', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/test',
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'Unauthorized' });
  });

  it('returns 401 when Authorization header is not Bearer scheme', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/test',
      headers: { authorization: 'Basic dXNlcjpwYXNz' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'Unauthorized' });
  });

  it('returns 401 when token is wrong', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/test',
      headers: { authorization: 'Bearer wrong-token' },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'Unauthorized' });
  });

  it('passes through with correct Bearer token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/test',
      headers: { authorization: `Bearer ${TEST_TOKEN}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('skips auth for health routes', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health/live',
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('skips auth for health routes regardless of subpath', async () => {
    // Register another health route
    const app2 = Fastify({ logger: false });
    await app2.register(authPlugin, { apiAuthToken: TEST_TOKEN });
    app2.get('/health/ready', async () => ({ status: 'ok', db: true }));
    await app2.ready();

    const res = await app2.inject({
      method: 'GET',
      url: '/health/ready',
    });

    expect(res.statusCode).toBe(200);
    await app2.close();
  });
});
