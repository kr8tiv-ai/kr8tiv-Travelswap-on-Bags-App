// ─── Hotels Tab ────────────────────────────────────────────────
// Destination suggestion cards with TravelSwap referral links.
// Static content — no API calls. Opens travelswap.xyz in new tab.

const DESTINATIONS = [
  { name: 'New York', emoji: '🗽', tagline: 'The city that never sleeps — Times Square to Central Park' },
  { name: 'Paris', emoji: '🗼', tagline: 'Romance, culture, and world-class cuisine await' },
  { name: 'Tokyo', emoji: '⛩️', tagline: 'Ancient temples meet neon-lit futurism' },
  { name: 'London', emoji: '🎡', tagline: 'Royal heritage and vibrant modern energy' },
  { name: 'Dubai', emoji: '🏙️', tagline: 'Luxury towers rising from golden desert sands' },
  { name: 'Cancún', emoji: '🏖️', tagline: 'Crystal waters and white-sand Caribbean bliss' },
] as const;

function getSearchUrl(destination: string): string {
  const params = new URLSearchParams({
    ref: 'FLIGHTBRAIN',
    destination,
  });
  return `https://travelswap.xyz/search?${params.toString()}`;
}

export function Hotels() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-white">Hotels</h2>
        <p className="mt-1 text-muted text-sm">
          Search 2M+ hotels worldwide through TravelSwap. Pick a destination to get started.
        </p>
      </div>

      {/* Destination grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {DESTINATIONS.map((dest) => (
          <div
            key={dest.name}
            className="bg-surface-raised border border-slate-700/60 rounded-xl p-6 flex flex-col"
          >
            <span className="text-4xl mb-3" role="img" aria-label={dest.name}>
              {dest.emoji}
            </span>
            <h3 className="text-lg font-semibold text-slate-200">{dest.name}</h3>
            <p className="text-muted text-sm mt-1 mb-4 flex-1">{dest.tagline}</p>
            <button
              type="button"
              onClick={() => window.open(getSearchUrl(dest.name), '_blank', 'noopener,noreferrer')}
              className="bg-accent hover:bg-accent-hover text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-surface"
            >
              Book on TravelSwap
            </button>
          </div>
        ))}
      </div>

      {/* Footer */}
      <p className="text-muted text-sm text-center">
        Powered by TravelSwap — 2M+ hotels worldwide
      </p>
    </div>
  );
}
