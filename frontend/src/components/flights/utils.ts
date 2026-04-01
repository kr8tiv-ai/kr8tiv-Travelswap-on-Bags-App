// ─── Flight Utilities ──────────────────────────────────────────
// Shared helpers for the flight search flow.

import { useState, useEffect } from 'react';

/** Format ISO 8601 duration (PT2H30M) to human-readable "2h 30m". */
export function formatDuration(iso: string | null): string {
  if (!iso) return '—';
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!match) return iso;
  const h = match[1] ? `${match[1]}h` : '';
  const m = match[2] ? `${match[2]}m` : '';
  return `${h} ${m}`.trim() || '—';
}

/** Countdown hook — returns "Xm Ys remaining" or "Expired". */
export function useCountdown(expiresAt: string | undefined): string {
  const [remaining, setRemaining] = useState('');

  useEffect(() => {
    if (!expiresAt) return;

    function tick() {
      const diff = new Date(expiresAt!).getTime() - Date.now();
      if (diff <= 0) {
        setRemaining('Expired');
        return;
      }
      const mins = Math.floor(diff / 60_000);
      const secs = Math.floor((diff % 60_000) / 1_000);
      setRemaining(`${mins}m ${secs}s remaining`);
    }

    tick();
    const id = setInterval(tick, 1_000);
    return () => clearInterval(id);
  }, [expiresAt]);

  return remaining;
}
