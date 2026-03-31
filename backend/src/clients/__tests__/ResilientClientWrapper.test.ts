// ─── ResilientClientWrapper Tests ──────────────────────────────
// Tests retry + circuit breaker integration at the wrapper level.

import { describe, it, expect, vi } from 'vitest';
import { wrapWithResilience } from '../ResilientClientWrapper.js';
import { CircuitOpenError } from '../../utils/resilience.js';

// ─── Test Client ───────────────────────────────────────────────

interface MockClient {
  fetchData(id: string): Promise<string>;
  syncMethod(): string;
  anotherAsync(a: number, b: number): Promise<number>;
}

function createTestClient(overrides: Partial<MockClient> = {}): MockClient {
  return {
    fetchData: vi.fn().mockResolvedValue('result'),
    syncMethod: vi.fn().mockReturnValue('sync-result'),
    anotherAsync: vi.fn().mockResolvedValue(42),
    ...overrides,
  };
}

// ─── Helpers ───────────────────────────────────────────────────

/** Create a transient error (500) */
function transientError(msg = 'Server error 500'): Error {
  const err = new Error(msg);
  (err as unknown as Record<string, number>).status = 500;
  return err;
}

/** Create a client error (400) */
function clientError(msg = 'Bad request 400'): Error {
  const err = new Error(msg);
  (err as unknown as Record<string, number>).status = 400;
  return err;
}

// ─── Tests ─────────────────────────────────────────────────────

describe('wrapWithResilience', () => {
  const noDelay = async () => {};

  describe('pass-through behavior', () => {
    it('delegates calls to the underlying client on success', async () => {
      const inner = createTestClient();
      const { client } = wrapWithResilience('test', inner, {
        retry: { delayFn: noDelay },
      });

      const result = await client.fetchData('abc');
      expect(result).toBe('result');
      expect(inner.fetchData).toHaveBeenCalledWith('abc');
    });

    it('passes multiple arguments through correctly', async () => {
      const inner = createTestClient();
      const { client } = wrapWithResilience('test', inner, {
        retry: { delayFn: noDelay },
      });

      const result = await client.anotherAsync(3, 7);
      expect(result).toBe(42);
      expect(inner.anotherAsync).toHaveBeenCalledWith(3, 7);
    });

    it('returns a CircuitBreaker instance with the given name', () => {
      const inner = createTestClient();
      const { circuitBreaker } = wrapWithResilience('bags-api', inner);

      expect(circuitBreaker.name).toBe('bags-api');
      expect(circuitBreaker.state).toBe('CLOSED');
    });
  });

  describe('retry on transient error', () => {
    it('retries and succeeds after transient failures', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(transientError())
        .mockRejectedValueOnce(transientError())
        .mockResolvedValue('recovered');

      const inner = createTestClient({ fetchData: fn });
      const { client } = wrapWithResilience('test', inner, {
        retry: { maxRetries: 2, delayFn: noDelay },
      });

      const result = await client.fetchData('x');
      expect(result).toBe('recovered');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('throws after exhausting retries on sustained transient error', async () => {
      const fn = vi.fn().mockRejectedValue(transientError('502 Bad Gateway'));
      const inner = createTestClient({ fetchData: fn });
      const { client } = wrapWithResilience('test', inner, {
        retry: { maxRetries: 2, delayFn: noDelay },
      });

      await expect(client.fetchData('x')).rejects.toThrow('502 Bad Gateway');
      // 1 initial + 2 retries = 3 total, but circuit breaker wraps retry,
      // and retry runs 3 attempts total
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('does not retry on client error (4xx)', async () => {
      const fn = vi.fn().mockRejectedValue(clientError());
      const inner = createTestClient({ fetchData: fn });
      const { client } = wrapWithResilience('test', inner, {
        retry: { maxRetries: 2, delayFn: noDelay },
      });

      await expect(client.fetchData('x')).rejects.toThrow('Bad request 400');
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('circuit breaker trip on sustained failure', () => {
    it('trips circuit after failureThreshold consecutive failures', async () => {
      const fn = vi.fn().mockRejectedValue(transientError());
      const inner = createTestClient({ fetchData: fn });
      const { client, circuitBreaker } = wrapWithResilience('test', inner, {
        circuitBreaker: { failureThreshold: 3 },
        retry: { maxRetries: 0, delayFn: noDelay }, // no retry — each call is 1 attempt
      });

      // 3 failures to trip the breaker
      for (let i = 0; i < 3; i++) {
        await expect(client.fetchData('x')).rejects.toThrow();
      }

      expect(circuitBreaker.state).toBe('OPEN');

      // Next call should be rejected immediately with CircuitOpenError
      await expect(client.fetchData('x')).rejects.toThrow(CircuitOpenError);
      // fn should have been called exactly 3 times (not 4)
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('recovers after circuit transitions to HALF_OPEN and probe succeeds', async () => {
      let now = 0;
      const fn = vi.fn().mockRejectedValue(transientError());
      const inner = createTestClient({ fetchData: fn });

      // Use custom CircuitBreaker to control time
      const { CircuitBreaker } = await import('../../utils/resilience.js');
      const cb = new CircuitBreaker(
        { name: 'test-recovery', failureThreshold: 2, resetTimeoutMs: 5000 },
        () => now,
      );

      // Trip the breaker manually
      for (let i = 0; i < 2; i++) {
        try { await cb.execute(() => Promise.reject(transientError())); } catch {}
      }
      expect(cb.state).toBe('OPEN');

      // Advance time past reset timeout
      now = 6000;
      expect(cb.state).toBe('HALF_OPEN');

      // Probe succeeds
      const result = await cb.execute(() => Promise.resolve('back-online'));
      expect(result).toBe('back-online');
      expect(cb.state).toBe('CLOSED');
    });
  });

  describe('circuit breaker state exposed via snapshot', () => {
    it('snapshot reflects failure count and state', async () => {
      const fn = vi.fn().mockRejectedValue(transientError());
      const inner = createTestClient({ fetchData: fn });
      const { client, circuitBreaker } = wrapWithResilience('test', inner, {
        circuitBreaker: { failureThreshold: 5 },
        retry: { maxRetries: 0, delayFn: noDelay },
      });

      // 2 failures — still CLOSED
      for (let i = 0; i < 2; i++) {
        await expect(client.fetchData('x')).rejects.toThrow();
      }

      const snap = circuitBreaker.snapshot();
      expect(snap.state).toBe('CLOSED');
      expect(snap.failures).toBe(2);
      expect(snap.name).toBe('test');
    });
  });

  describe('interaction between retry and circuit breaker', () => {
    it('retry failures accumulate against circuit breaker counter', async () => {
      const fn = vi.fn().mockRejectedValue(transientError());
      const inner = createTestClient({ fetchData: fn });
      const { client, circuitBreaker } = wrapWithResilience('test', inner, {
        circuitBreaker: { failureThreshold: 5 },
        retry: { maxRetries: 2, delayFn: noDelay },
      });

      // Each call makes 3 attempts (1 + 2 retries) = 3 failures
      await expect(client.fetchData('x')).rejects.toThrow();
      expect(fn).toHaveBeenCalledTimes(3);
      // After the first wrapped call: 3 failures counted by CB
      expect(circuitBreaker.failures).toBe(3);

      // Second call: 2 more failures would hit threshold (5)
      await expect(client.fetchData('x')).rejects.toThrow();
      // At this point CB tripped at failure 5, remaining retries get CircuitOpenError
      expect(circuitBreaker.state).toBe('OPEN');
    });
  });
});
