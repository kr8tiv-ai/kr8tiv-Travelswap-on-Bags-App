import { describe, it, expect, beforeEach } from 'vitest';
import { createRunLock, type RunLock } from '../RunLock.js';

describe('RunLock', () => {
  let lock: RunLock;

  beforeEach(() => {
    lock = createRunLock();
  });

  describe('acquire()', () => {
    it('returns true on first acquire for a strategy', () => {
      expect(lock.acquire(1)).toBe(true);
    });

    it('returns false on second acquire for the same strategy', () => {
      lock.acquire(1);
      expect(lock.acquire(1)).toBe(false);
    });

    it('allows acquiring different strategy IDs independently', () => {
      expect(lock.acquire(1)).toBe(true);
      expect(lock.acquire(2)).toBe(true);
    });
  });

  describe('release()', () => {
    it('allows re-acquisition after release', () => {
      lock.acquire(1);
      lock.release(1);
      expect(lock.acquire(1)).toBe(true);
    });

    it('is a no-op when strategy is not locked', () => {
      // Should not throw
      lock.release(999);
    });
  });

  describe('isLocked()', () => {
    it('returns false for an unlocked strategy', () => {
      expect(lock.isLocked(1)).toBe(false);
    });

    it('returns true after acquire', () => {
      lock.acquire(1);
      expect(lock.isLocked(1)).toBe(true);
    });

    it('returns false after release', () => {
      lock.acquire(1);
      lock.release(1);
      expect(lock.isLocked(1)).toBe(false);
    });
  });

  describe('releaseAll()', () => {
    it('clears all held locks', () => {
      lock.acquire(1);
      lock.acquire(2);
      lock.acquire(3);
      lock.releaseAll();

      expect(lock.isLocked(1)).toBe(false);
      expect(lock.isLocked(2)).toBe(false);
      expect(lock.isLocked(3)).toBe(false);
    });

    it('allows re-acquisition after releaseAll', () => {
      lock.acquire(1);
      lock.releaseAll();
      expect(lock.acquire(1)).toBe(true);
    });
  });
});
