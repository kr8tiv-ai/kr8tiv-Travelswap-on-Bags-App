// ─── Resilience Primitives Tests ───────────────────────────────
// Covers CircuitBreaker state machine, retryWithBackoff timing, and
// error classification utilities.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CircuitBreaker,
  CircuitOpenError,
  retryWithBackoff,
  isTransientError,
  isClientError,
} from '../resilience.js';
import type { CircuitBreakerOptions, CircuitState } from '../resilience.js';

// ─── Helpers ───────────────────────────────────────────────────

/** Creates a circuit breaker with low threshold for testing. */
function makeBreaker(
  overrides?: Partial<CircuitBreakerOptions> & { nowFn?: () => number },
): { breaker: CircuitBreaker; transitions: Array<{ from: CircuitState; to: CircuitState }> } {
  const transitions: Array<{ from: CircuitState; to: CircuitState }> = [];
  const breaker = new CircuitBreaker(
    {
      name: overrides?.name ?? 'test',
      failureThreshold: overrides?.failureThreshold ?? 3,
      resetTimeoutMs: overrides?.resetTimeoutMs ?? 1000,
      onStateChange: (from, to) => {
        transitions.push({ from, to });
      },
      ...overrides,
    },
    overrides?.nowFn,
  );
  return { breaker, transitions };
}

/** An error that always fails */
const fail = () => Promise.reject(new Error('boom'));
const succeed = <T>(val: T) => () => Promise.resolve(val);

// ─── CircuitBreaker ────────────────────────────────────────────

describe('CircuitBreaker', () => {
  it('starts in CLOSED state with zero failures', () => {
    const { breaker } = makeBreaker();
    expect(breaker.state).toBe('CLOSED');
    expect(breaker.failures).toBe(0);
  });

  it('passes through successful calls in CLOSED state', async () => {
    const { breaker } = makeBreaker();
    const result = await breaker.execute(succeed(42));
    expect(result).toBe(42);
    expect(breaker.state).toBe('CLOSED');
  });

  it('increments failures on errors in CLOSED state but stays CLOSED below threshold', async () => {
    const { breaker } = makeBreaker({ failureThreshold: 3 });

    await expect(breaker.execute(fail)).rejects.toThrow('boom');
    expect(breaker.failures).toBe(1);
    expect(breaker.state).toBe('CLOSED');

    await expect(breaker.execute(fail)).rejects.toThrow('boom');
    expect(breaker.failures).toBe(2);
    expect(breaker.state).toBe('CLOSED');
  });

  it('transitions CLOSED → OPEN when failure threshold is reached', async () => {
    const { breaker, transitions } = makeBreaker({ failureThreshold: 3 });

    for (let i = 0; i < 3; i++) {
      await expect(breaker.execute(fail)).rejects.toThrow('boom');
    }

    expect(breaker.state).toBe('OPEN');
    expect(breaker.failures).toBe(3);
    expect(transitions).toContainEqual({ from: 'CLOSED', to: 'OPEN' });
  });

  it('rejects immediately with CircuitOpenError when OPEN', async () => {
    const { breaker } = makeBreaker({ failureThreshold: 1 });

    await expect(breaker.execute(fail)).rejects.toThrow('boom');
    expect(breaker.state).toBe('OPEN');

    // Next call should be rejected without calling the function
    const fn = vi.fn(succeed('should not run'));
    await expect(breaker.execute(fn)).rejects.toThrow(CircuitOpenError);
    expect(fn).not.toHaveBeenCalled();
  });

  it('CircuitOpenError contains diagnostic information', async () => {
    const { breaker } = makeBreaker({ failureThreshold: 1, name: 'bags-api' });

    await expect(breaker.execute(fail)).rejects.toThrow();

    try {
      await breaker.execute(succeed('x'));
    } catch (err) {
      expect(err).toBeInstanceOf(CircuitOpenError);
      const coe = err as CircuitOpenError;
      expect(coe.circuitName).toBe('bags-api');
      expect(coe.state).toBe('OPEN');
      expect(coe.failures).toBe(1);
      expect(coe.lastFailureTime).toBeGreaterThan(0);
      expect(coe.message).toContain('bags-api');
      expect(coe.message).toContain('OPEN');
    }
  });

  it('transitions OPEN → HALF_OPEN after reset timeout', async () => {
    let now = 1000;
    const { breaker, transitions } = makeBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 500,
      nowFn: () => now,
    });

    await expect(breaker.execute(fail)).rejects.toThrow();
    expect(breaker.state).toBe('OPEN');

    // Advance time past reset timeout
    now = 1600;
    expect(breaker.state).toBe('HALF_OPEN');
    expect(transitions).toContainEqual({ from: 'OPEN', to: 'HALF_OPEN' });
  });

  it('transitions HALF_OPEN → CLOSED on successful probe', async () => {
    let now = 1000;
    const { breaker, transitions } = makeBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 500,
      nowFn: () => now,
    });

    await expect(breaker.execute(fail)).rejects.toThrow();
    now = 1600; // trigger HALF_OPEN

    const result = await breaker.execute(succeed('recovered'));
    expect(result).toBe('recovered');
    expect(breaker.state).toBe('CLOSED');
    expect(breaker.failures).toBe(0);
    expect(transitions).toContainEqual({ from: 'HALF_OPEN', to: 'CLOSED' });
  });

  it('transitions HALF_OPEN → OPEN on failed probe', async () => {
    let now = 1000;
    const { breaker, transitions } = makeBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 500,
      nowFn: () => now,
    });

    await expect(breaker.execute(fail)).rejects.toThrow();
    now = 1600; // trigger HALF_OPEN

    await expect(breaker.execute(fail)).rejects.toThrow('boom');
    expect(breaker.state).toBe('OPEN');
    expect(transitions.filter((t) => t.to === 'OPEN')).toHaveLength(2);
  });

  it('resets consecutive failure counter on success in CLOSED state', async () => {
    const { breaker } = makeBreaker({ failureThreshold: 3 });

    // Two failures
    await expect(breaker.execute(fail)).rejects.toThrow();
    await expect(breaker.execute(fail)).rejects.toThrow();
    expect(breaker.failures).toBe(2);

    // One success resets the counter
    await breaker.execute(succeed('ok'));
    expect(breaker.failures).toBe(0);
    expect(breaker.state).toBe('CLOSED');
  });

  it('manual reset() returns to CLOSED with zero failures', async () => {
    const { breaker } = makeBreaker({ failureThreshold: 1 });

    await expect(breaker.execute(fail)).rejects.toThrow();
    expect(breaker.state).toBe('OPEN');

    breaker.reset();
    expect(breaker.state).toBe('CLOSED');
    expect(breaker.failures).toBe(0);
  });

  it('snapshot() returns diagnostic info', async () => {
    const { breaker } = makeBreaker({ failureThreshold: 2, name: 'helius' });

    await expect(breaker.execute(fail)).rejects.toThrow();

    const snap = breaker.snapshot();
    expect(snap.name).toBe('helius');
    expect(snap.state).toBe('CLOSED');
    expect(snap.failures).toBe(1);
    expect(snap.lastFailureTime).toBeGreaterThan(0);
  });

  it('fires onStateChange callback on every transition', async () => {
    let now = 1000;
    const transitions: Array<{ from: CircuitState; to: CircuitState; failures: number }> = [];
    const breaker = new CircuitBreaker(
      {
        name: 'test',
        failureThreshold: 1,
        resetTimeoutMs: 100,
        onStateChange: (from, to, info) => {
          transitions.push({ from, to, failures: info.failures });
        },
      },
      () => now,
    );

    await expect(breaker.execute(fail)).rejects.toThrow(); // CLOSED→OPEN
    now = 1200;
    void breaker.state; // OPEN→HALF_OPEN
    await breaker.execute(succeed('ok')); // HALF_OPEN→CLOSED

    expect(transitions).toEqual([
      { from: 'CLOSED', to: 'OPEN', failures: 1 },
      { from: 'OPEN', to: 'HALF_OPEN', failures: 1 },
      { from: 'HALF_OPEN', to: 'CLOSED', failures: 0 },
    ]);
  });
});

// ─── retryWithBackoff ──────────────────────────────────────────

describe('retryWithBackoff', () => {
  it('returns immediately on first success', async () => {
    const result = await retryWithBackoff(() => Promise.resolve('ok'));
    expect(result).toBe('ok');
  });

  it('retries on transient errors and returns on eventual success', async () => {
    let calls = 0;
    const fn = () => {
      calls++;
      if (calls < 3) throw Object.assign(new Error('server error'), { status: 503 });
      return Promise.resolve('recovered');
    };

    const result = await retryWithBackoff(fn, {
      baseDelayMs: 1,
      delayFn: () => Promise.resolve(), // skip actual delays
    });

    expect(result).toBe('recovered');
    expect(calls).toBe(3);
  });

  it('throws the last error when all retries are exhausted', async () => {
    let calls = 0;
    const fn = () => {
      calls++;
      throw new Error(`fail-${calls}`);
    };

    await expect(
      retryWithBackoff(fn, {
        maxRetries: 2,
        baseDelayMs: 1,
        shouldRetry: () => true,
        delayFn: () => Promise.resolve(),
      }),
    ).rejects.toThrow('fail-3'); // 1 initial + 2 retries = 3 total

    expect(calls).toBe(3);
  });

  it('does not retry when shouldRetry returns false', async () => {
    let calls = 0;
    const fn = () => {
      calls++;
      throw Object.assign(new Error('bad request'), { status: 400 });
    };

    await expect(
      retryWithBackoff(fn, {
        maxRetries: 3,
        baseDelayMs: 1,
        shouldRetry: (err) => !isClientError(err),
        delayFn: () => Promise.resolve(),
      }),
    ).rejects.toThrow('bad request');

    expect(calls).toBe(1); // No retries
  });

  it('calls onRetry callback with attempt info before each retry', async () => {
    let calls = 0;
    const retries: Array<{ attempt: number; delayMs: number }> = [];

    const fn = () => {
      calls++;
      if (calls <= 2) throw new Error('timeout');
      return Promise.resolve('done');
    };

    await retryWithBackoff(fn, {
      maxRetries: 3,
      baseDelayMs: 100,
      maxDelayMs: 1000,
      shouldRetry: () => true,
      onRetry: (_err, attempt, delayMs) => retries.push({ attempt, delayMs }),
      delayFn: () => Promise.resolve(),
    });

    expect(retries).toHaveLength(2);
    expect(retries[0].attempt).toBe(1);
    expect(retries[1].attempt).toBe(2);
    // Delays should be in increasing order (exponential)
    expect(retries[1].delayMs).toBeGreaterThanOrEqual(retries[0].delayMs);
  });

  it('respects maxDelayMs cap on backoff calculation', async () => {
    const delays: number[] = [];

    let calls = 0;
    const fn = () => {
      calls++;
      if (calls <= 5) throw new Error('timeout');
      return Promise.resolve('done');
    };

    await retryWithBackoff(fn, {
      maxRetries: 5,
      baseDelayMs: 100,
      maxDelayMs: 250, // should cap exponential growth
      shouldRetry: () => true,
      onRetry: (_err, _attempt, delayMs) => delays.push(delayMs),
      delayFn: () => Promise.resolve(),
    });

    // All delays should be <= maxDelayMs + 30% jitter = 325
    for (const d of delays) {
      expect(d).toBeLessThanOrEqual(325);
    }
  });

  it('uses custom delayFn for sleep', async () => {
    const delayedMs: number[] = [];
    let calls = 0;
    const fn = () => {
      calls++;
      if (calls < 2) throw new Error('econnreset');
      return Promise.resolve('ok');
    };

    await retryWithBackoff(fn, {
      maxRetries: 2,
      baseDelayMs: 50,
      shouldRetry: () => true,
      delayFn: async (ms) => {
        delayedMs.push(ms);
      },
    });

    expect(delayedMs).toHaveLength(1);
    expect(delayedMs[0]).toBeGreaterThanOrEqual(50);
  });
});

// ─── Error Classification ──────────────────────────────────────

describe('isTransientError', () => {
  it.each([
    ['HTTP 429 via status', { status: 429 }],
    ['HTTP 500 via statusCode', { statusCode: 500 }],
    ['HTTP 502 via response.status', { response: { status: 502 } }],
    ['HTTP 503 via meta.status (Duffel)', { meta: { status: 503 } }],
    ['HTTP 504 via status', { status: 504 }],
  ])('returns true for %s', (_label, errObj) => {
    const err = Object.assign(new Error('test'), errObj);
    expect(isTransientError(err)).toBe(true);
  });

  it.each([
    ['ECONNRESET', 'ECONNRESET'],
    ['ECONNREFUSED', 'ECONNREFUSED'],
    ['ETIMEDOUT', 'ETIMEDOUT'],
    ['EPIPE', 'EPIPE'],
  ])('returns true for Node.js system error code %s', (_label, code) => {
    const err = Object.assign(new Error('network fail'), { code });
    expect(isTransientError(err)).toBe(true);
  });

  it.each([
    'timeout',
    'econnreset',
    'econnrefused',
    '429',
    'rate limit',
    'too many requests',
    '500',
    '502',
    '503',
    '504',
    'server error',
    'socket hang up',
  ])('returns true for message containing "%s"', (pattern) => {
    expect(isTransientError(new Error(`Request failed: ${pattern}`))).toBe(true);
  });

  it.each([
    ['HTTP 400', { status: 400 }],
    ['HTTP 401', { status: 401 }],
    ['HTTP 403', { status: 403 }],
    ['HTTP 404', { status: 404 }],
  ])('returns false for client error %s', (_label, errObj) => {
    const err = Object.assign(new Error('test'), errObj);
    expect(isTransientError(err)).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(isTransientError(null)).toBe(false);
    expect(isTransientError(undefined)).toBe(false);
  });

  it('returns false for plain Error with no matching signals', () => {
    expect(isTransientError(new Error('something went wrong'))).toBe(false);
  });
});

describe('isClientError', () => {
  it.each([
    ['HTTP 400', { status: 400 }],
    ['HTTP 401', { status: 401 }],
    ['HTTP 403', { status: 403 }],
    ['HTTP 404', { status: 404 }],
    ['HTTP 422', { status: 422 }],
  ])('returns true for %s', (_label, errObj) => {
    const err = Object.assign(new Error('test'), errObj);
    expect(isClientError(err)).toBe(true);
  });

  it('returns false for 429 (rate limit is transient, not client error)', () => {
    const err = Object.assign(new Error('test'), { status: 429 });
    expect(isClientError(err)).toBe(false);
  });

  it.each([
    ['HTTP 500', { status: 500 }],
    ['HTTP 503', { status: 503 }],
  ])('returns false for server error %s', (_label, errObj) => {
    const err = Object.assign(new Error('test'), errObj);
    expect(isClientError(err)).toBe(false);
  });

  it.each([
    'bad request',
    'unauthorized',
    'forbidden',
    'not found',
  ])('returns true for message containing "%s"', (pattern) => {
    expect(isClientError(new Error(`API error: ${pattern}`))).toBe(true);
  });

  it('returns false for message with "429" even if it also contains client error text', () => {
    expect(isClientError(new Error('429 bad request'))).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(isClientError(null)).toBe(false);
    expect(isClientError(undefined)).toBe(false);
  });
});
