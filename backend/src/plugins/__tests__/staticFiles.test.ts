import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { staticFilesPlugin } from '../staticFiles.js';

const TEST_STATIC_DIR = join(tmpdir(), `travelswap-static-test-${process.pid}`);

const INDEX_HTML = `<!DOCTYPE html>
<html><head><title>Test SPA</title></head>
<body><div id="root">SPA</div></body></html>`;

const CSS_CONTENT = 'body { margin: 0; }';

describe('staticFilesPlugin', () => {
  beforeAll(() => {
    // Create a temp static directory with test files
    mkdirSync(join(TEST_STATIC_DIR, 'assets'), { recursive: true });
    writeFileSync(join(TEST_STATIC_DIR, 'index.html'), INDEX_HTML);
    writeFileSync(join(TEST_STATIC_DIR, 'assets', 'style.css'), CSS_CONTENT);
  });

  afterAll(() => {
    // Clean up temp directory
    if (existsSync(TEST_STATIC_DIR)) {
      rmSync(TEST_STATIC_DIR, { recursive: true, force: true });
    }
  });

  describe('when static directory exists', () => {
    let app: FastifyInstance;

    beforeEach(async () => {
      app = Fastify({ logger: false });

      // Register API routes first (simulates real server order)
      app.get('/api/test', async () => ({ ok: true }));
      app.get('/health/live', async () => ({ status: 'ok' }));

      // Register static plugin after API routes
      await app.register(staticFilesPlugin, { staticDir: TEST_STATIC_DIR });

      await app.ready();
    });

    afterEach(async () => {
      await app.close();
    });

    it('serves index.html at root', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/',
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.body).toContain('<div id="root">SPA</div>');
    });

    it('serves static assets', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/assets/style.css',
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toBe(CSS_CONTENT);
    });

    it('SPA fallback returns index.html for unknown routes', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/dashboard/some-page',
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.body).toContain('<div id="root">SPA</div>');
    });

    it('SPA fallback returns index.html for deep nested routes', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/flights/search/results/123',
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('Test SPA');
    });

    it('API routes still work when static plugin is registered', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/test',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    });

    it('health routes still work when static plugin is registered', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/health/live',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: 'ok' });
    });

    it('returns 404 JSON for unknown API routes (not index.html)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/nonexistent',
      });

      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.error).toBe('Not Found');
      expect(body.statusCode).toBe(404);
    });

    it('returns 404 JSON for unknown health routes (not index.html)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/health/nonexistent',
      });

      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.error).toBe('Not Found');
    });

    it('returns 404 JSON for POST to unknown route (not index.html)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/some-unknown-path',
      });

      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.error).toBe('Not Found');
    });
  });

  describe('when static directory does not exist', () => {
    let app: FastifyInstance;

    beforeEach(async () => {
      app = Fastify({ logger: false });

      app.get('/api/test', async () => ({ ok: true }));

      // Register with a nonexistent directory
      await app.register(staticFilesPlugin, {
        staticDir: '/tmp/definitely-does-not-exist-xyz123',
      });

      await app.ready();
    });

    afterEach(async () => {
      await app.close();
    });

    it('skips plugin gracefully — no crash on startup', () => {
      // If we got here, the plugin didn't throw
      expect(true).toBe(true);
    });

    it('API routes still work when static directory is missing', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/test',
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
    });

    it('returns default 404 for unknown routes (no SPA fallback)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/dashboard',
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('when no staticDir option is provided', () => {
    it('uses default path and skips gracefully if it does not exist', async () => {
      const app = Fastify({ logger: false });
      app.get('/api/test', async () => ({ ok: true }));

      // No staticDir — uses default resolved path which won't exist in test env
      await app.register(staticFilesPlugin, {});

      await app.ready();

      const res = await app.inject({
        method: 'GET',
        url: '/api/test',
      });

      expect(res.statusCode).toBe(200);
      await app.close();
    });
  });
});
