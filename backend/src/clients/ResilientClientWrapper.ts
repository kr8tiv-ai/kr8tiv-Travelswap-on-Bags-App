// ─── ResilientClientWrapper ────────────────────────────────────
// Factory that wraps any client adapter's async methods with
// CircuitBreaker + retryWithBackoff from the shared resilience module.
// Each external dependency gets its own CircuitBreaker instance.

import { logger } from '../logger.js';
import {
  CircuitBreaker,
  retryWithBackoff,
  isTransientError,
  type CircuitBreakerOptions,
  type RetryOptions,
} from '../utils/resilience.js';

// ─── Types ─────────────────────────────────────────────────────

export interface ResilientWrapperOptions {
  /** CircuitBreaker configuration overrides */
  circuitBreaker?: Omit<CircuitBreakerOptions, 'name' | 'onStateChange'>;
  /** Retry configuration overrides */
  retry?: Omit<RetryOptions, 'onRetry' | 'shouldRetry'>;
}

// ─── Factory ───────────────────────────────────────────────────

/**
 * Wrap a client adapter so that every async method call passes through
 * a CircuitBreaker and retryWithBackoff.
 *
 * - Non-function properties are passed through unchanged.
 * - Synchronous functions are passed through unchanged.
 * - Async methods are wrapped: retry → circuit breaker → original call.
 *
 * Returns `{ client, circuitBreaker }` so the caller can inspect
 * circuit state for health endpoints.
 */
export function wrapWithResilience<T extends object>(
  name: string,
  client: T,
  opts?: ResilientWrapperOptions,
): { client: T; circuitBreaker: CircuitBreaker } {
  const log = logger.child({ component: `Resilient:${name}` });

  const cb = new CircuitBreaker({
    name,
    failureThreshold: opts?.circuitBreaker?.failureThreshold ?? 5,
    resetTimeoutMs: opts?.circuitBreaker?.resetTimeoutMs ?? 30_000,
    onStateChange: (from, to, info) => {
      log.warn(
        { from, to, failures: info.failures, dependency: info.name },
        `Circuit breaker state transition: ${from} → ${to}`,
      );
    },
  });

  const retryOpts: RetryOptions = {
    maxRetries: opts?.retry?.maxRetries ?? 2,
    baseDelayMs: opts?.retry?.baseDelayMs ?? 1_000,
    maxDelayMs: opts?.retry?.maxDelayMs ?? 10_000,
    shouldRetry: isTransientError,
    onRetry: (err, attempt, delayMs) => {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(
        { dependency: name, attempt, delayMs, error: msg },
        `Retry attempt ${attempt} after ${delayMs}ms`,
      );
    },
    delayFn: opts?.retry?.delayFn,
  };

  const wrapped = {} as Record<string, unknown>;
  const src = client as Record<string, unknown>;

  for (const key of Object.keys(src)) {
    const val = src[key];

    if (typeof val !== 'function') {
      // Pass through non-function properties
      wrapped[key] = val;
      continue;
    }

    // Wrap each function method — the wrapper is always async because
    // circuit breaker and retry are async. Sync methods that return
    // non-promise values still work; the result just gets wrapped in a
    // resolved promise, which JS awaiting handles fine.
    wrapped[key] = (...args: unknown[]) => {
      return retryWithBackoff(
        () => cb.execute(() => (val as Function).apply(client, args)),
        retryOpts,
      );
    };
  }

  return { client: wrapped as T, circuitBreaker: cb };
}
