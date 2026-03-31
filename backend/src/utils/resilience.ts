// ─── Resilience Primitives ─────────────────────────────────────
// Shared circuit breaker, retry-with-backoff, and error classification
// utilities. These are generic — no coupling to Pino, Fastify, or any
// specific client.

// ─── Types ─────────────────────────────────────────────────────

/** Circuit breaker states */
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/** Configuration for CircuitBreaker */
export interface CircuitBreakerOptions {
  /** Name used in error messages and diagnostics */
  name: string;
  /** Number of consecutive failures before tripping to OPEN (default: 5) */
  failureThreshold?: number;
  /** Milliseconds to wait in OPEN before transitioning to HALF_OPEN (default: 30000) */
  resetTimeoutMs?: number;
  /** Called on state transitions. Optional — for logging without coupling to Pino. */
  onStateChange?: (from: CircuitState, to: CircuitState, info: { name: string; failures: number }) => void;
}

/** Configuration for retryWithBackoff */
export interface RetryOptions {
  /** Maximum number of retries (default: 3). Total attempts = maxRetries + 1. */
  maxRetries?: number;
  /** Base delay in milliseconds (default: 1000) */
  baseDelayMs?: number;
  /** Maximum delay cap in milliseconds (default: 30000) */
  maxDelayMs?: number;
  /** Predicate to decide if an error is retryable (default: isTransientError) */
  shouldRetry?: (err: unknown) => boolean;
  /** Called before each retry. Optional — for logging without coupling to Pino. */
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
  /** Custom delay function for testing. Defaults to setTimeout-based sleep. */
  delayFn?: (ms: number) => Promise<void>;
}

// ─── CircuitOpenError ──────────────────────────────────────────

/**
 * Thrown when a call is rejected because the circuit breaker is OPEN.
 */
export class CircuitOpenError extends Error {
  public readonly circuitName: string;
  public readonly state: CircuitState;
  public readonly failures: number;
  public readonly lastFailureTime: number;
  public readonly resetTimeoutMs: number;

  constructor(name: string, failures: number, lastFailureTime: number, resetTimeoutMs: number) {
    super(`Circuit breaker "${name}" is OPEN after ${failures} failures — rejecting call`);
    this.name = 'CircuitOpenError';
    this.circuitName = name;
    this.state = 'OPEN';
    this.failures = failures;
    this.lastFailureTime = lastFailureTime;
    this.resetTimeoutMs = resetTimeoutMs;
  }
}

// ─── CircuitBreaker ────────────────────────────────────────────

/**
 * 3-state circuit breaker: CLOSED → OPEN → HALF_OPEN → CLOSED/OPEN.
 *
 * - CLOSED: calls pass through. Consecutive failures increment counter.
 *   When counter >= failureThreshold, transition to OPEN.
 * - OPEN: calls rejected immediately with CircuitOpenError.
 *   After resetTimeoutMs, transition to HALF_OPEN.
 * - HALF_OPEN: one probe call allowed. Success → CLOSED; Failure → OPEN.
 */
export class CircuitBreaker {
  public readonly name: string;

  private _state: CircuitState = 'CLOSED';
  private _failures = 0;
  private _lastFailureTime = 0;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly onStateChange?: CircuitBreakerOptions['onStateChange'];
  private readonly nowFn: () => number;

  constructor(options: CircuitBreakerOptions, nowFn?: () => number) {
    this.name = options.name;
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 30_000;
    this.onStateChange = options.onStateChange;
    this.nowFn = nowFn ?? (() => Date.now());
  }

  /** Current circuit state */
  get state(): CircuitState {
    // Check if OPEN should transition to HALF_OPEN
    if (this._state === 'OPEN') {
      const elapsed = this.nowFn() - this._lastFailureTime;
      if (elapsed >= this.resetTimeoutMs) {
        this.transition('HALF_OPEN');
      }
    }
    return this._state;
  }

  /** Consecutive failure count */
  get failures(): number {
    return this._failures;
  }

  /** Timestamp of last recorded failure (0 if none) */
  get lastFailureTime(): number {
    return this._lastFailureTime;
  }

  /**
   * Execute an async function through the circuit breaker.
   *
   * - CLOSED: runs fn. On failure, increments counter. Trips to OPEN at threshold.
   * - OPEN: rejects immediately with CircuitOpenError.
   * - HALF_OPEN: runs fn as probe. Success → CLOSED. Failure → OPEN.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const currentState = this.state; // triggers OPEN→HALF_OPEN check

    if (currentState === 'OPEN') {
      throw new CircuitOpenError(
        this.name,
        this._failures,
        this._lastFailureTime,
        this.resetTimeoutMs,
      );
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  /** Reset the breaker to CLOSED with zero failures. */
  reset(): void {
    if (this._state !== 'CLOSED' || this._failures !== 0) {
      this._failures = 0;
      this._lastFailureTime = 0;
      if (this._state !== 'CLOSED') {
        this.transition('CLOSED');
      }
    }
  }

  /** Get a diagnostic snapshot for health endpoints. */
  snapshot(): { name: string; state: CircuitState; failures: number; lastFailureTime: number } {
    return {
      name: this.name,
      state: this.state, // triggers OPEN→HALF_OPEN transition check
      failures: this._failures,
      lastFailureTime: this._lastFailureTime,
    };
  }

  // ─── Internal ────────────────────────────────────────────────

  private onSuccess(): void {
    if (this._state === 'HALF_OPEN') {
      this._failures = 0;
      this._lastFailureTime = 0;
      this.transition('CLOSED');
    } else if (this._state === 'CLOSED') {
      // Reset consecutive failure counter on success
      this._failures = 0;
    }
  }

  private onFailure(): void {
    this._failures++;
    this._lastFailureTime = this.nowFn();

    if (this._state === 'HALF_OPEN') {
      // Probe failed — back to OPEN
      this.transition('OPEN');
    } else if (this._state === 'CLOSED' && this._failures >= this.failureThreshold) {
      this.transition('OPEN');
    }
  }

  private transition(to: CircuitState): void {
    const from = this._state;
    this._state = to;
    this.onStateChange?.(from, to, { name: this.name, failures: this._failures });
  }
}

// ─── retryWithBackoff ──────────────────────────────────────────

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Retry an async function with exponential backoff + jitter.
 *
 * Delay formula: min(baseDelay * 2^attempt, maxDelay) + random jitter (0-30%).
 * The jitter percentage is relative to the calculated exponential delay.
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 1_000;
  const maxDelayMs = options?.maxDelayMs ?? 30_000;
  const shouldRetry = options?.shouldRetry ?? isTransientError;
  const onRetry = options?.onRetry;
  const delayFn = options?.delayFn ?? defaultSleep;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      // Last attempt — don't retry
      if (attempt >= maxRetries) {
        break;
      }

      // Check if error is retryable
      if (!shouldRetry(err)) {
        break;
      }

      // Calculate delay: exponential backoff capped at maxDelayMs + 0-30% jitter
      const exponentialDelay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
      const jitter = exponentialDelay * Math.random() * 0.3;
      const delay = Math.round(exponentialDelay + jitter);

      onRetry?.(err, attempt + 1, delay);

      await delayFn(delay);
    }
  }

  throw lastError;
}

// ─── Error Classification ──────────────────────────────────────

/**
 * Returns true for transient/retryable errors:
 * - HTTP 429 (rate limit)
 * - HTTP 5xx (server errors)
 * - Network errors: timeout, ECONNRESET, ECONNREFUSED, ETIMEDOUT, EPIPE
 *
 * Checks:
 * 1. `status` or `statusCode` property on the error/response
 * 2. Error code property (Node.js system errors)
 * 3. Error message substring matching (fallback)
 */
export function isTransientError(err: unknown): boolean {
  if (err == null) return false;

  // Check status code properties (Axios, Fetch wrappers, Duffel, etc.)
  const statusCode = extractStatusCode(err);
  if (statusCode !== undefined) {
    if (statusCode === 429) return true;
    if (statusCode >= 500 && statusCode < 600) return true;
  }

  if (err instanceof Error) {
    // Check Node.js error code (ECONNRESET, ECONNREFUSED, ETIMEDOUT, EPIPE)
    const code = (err as NodeJS.ErrnoException).code;
    if (code && TRANSIENT_ERROR_CODES.has(code)) return true;

    // Fallback: message substring matching
    const msg = err.message.toLowerCase();
    for (const pattern of TRANSIENT_MESSAGE_PATTERNS) {
      if (msg.includes(pattern)) return true;
    }
  }

  return false;
}

/**
 * Returns true for client errors (4xx excluding 429) — these should NOT be retried.
 */
export function isClientError(err: unknown): boolean {
  if (err == null) return false;

  const statusCode = extractStatusCode(err);
  if (statusCode !== undefined) {
    return statusCode >= 400 && statusCode < 500 && statusCode !== 429;
  }

  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    for (const pattern of CLIENT_ERROR_MESSAGE_PATTERNS) {
      if (msg.includes(pattern) && !msg.includes('429')) return true;
    }
  }

  return false;
}

// ─── Internals ─────────────────────────────────────────────────

const TRANSIENT_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

const TRANSIENT_MESSAGE_PATTERNS = [
  '429',
  'rate limit',
  'too many requests',
  '500',
  '502',
  '503',
  '504',
  'server error',
  'internal error',
  'timeout',
  'econnreset',
  'econnrefused',
  'etimedout',
  'epipe',
  'socket hang up',
  'network error',
];

const CLIENT_ERROR_MESSAGE_PATTERNS = [
  '400',
  '401',
  '403',
  '404',
  'bad request',
  'unauthorized',
  'forbidden',
  'not found',
];

/**
 * Extract HTTP status code from an error object.
 * Handles common patterns: err.status, err.statusCode, err.response.status,
 * err.meta.status (Duffel), err.code (when numeric).
 */
function extractStatusCode(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;

  const obj = err as Record<string, unknown>;

  // Direct properties
  if (typeof obj.status === 'number') return obj.status;
  if (typeof obj.statusCode === 'number') return obj.statusCode;

  // Nested response (Axios-style)
  if (typeof obj.response === 'object' && obj.response !== null) {
    const resp = obj.response as Record<string, unknown>;
    if (typeof resp.status === 'number') return resp.status;
    if (typeof resp.statusCode === 'number') return resp.statusCode;
  }

  // Duffel: err.meta.status
  if (typeof obj.meta === 'object' && obj.meta !== null) {
    const meta = obj.meta as Record<string, unknown>;
    if (typeof meta.status === 'number') return meta.status;
  }

  return undefined;
}
