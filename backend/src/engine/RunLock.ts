// ─── RunLock ───────────────────────────────────────────────────
// In-memory lock preventing concurrent pipeline runs per strategy.
// Single-threaded model (SQLite) — acquire is synchronous.

export interface RunLock {
  /** Attempt to acquire lock for a strategy. Returns true if acquired, false if already held. */
  acquire(strategyId: number): boolean;
  /** Release lock for a strategy. No-op if not held. */
  release(strategyId: number): void;
  /** Check whether a strategy is currently locked. */
  isLocked(strategyId: number): boolean;
  /** Release all held locks (e.g. on shutdown). */
  releaseAll(): void;
}

// ─── Factory ───────────────────────────────────────────────────

export function createRunLock(): RunLock {
  const locks = new Map<number, boolean>();

  return {
    acquire(strategyId: number): boolean {
      if (locks.get(strategyId)) {
        return false;
      }
      locks.set(strategyId, true);
      return true;
    },

    release(strategyId: number): void {
      locks.delete(strategyId);
    },

    isLocked(strategyId: number): boolean {
      return locks.get(strategyId) === true;
    },

    releaseAll(): void {
      locks.clear();
    },
  };
}
