// ─── Offer List ────────────────────────────────────────────────
// Displays Duffel flight offers with countdown timer and booking action.

import type { DuffelOffer } from '../../types';
import { formatDuration, useCountdown } from './utils';

interface OfferListProps {
  readonly offers: DuffelOffer[];
  readonly expiresAt: string;
  readonly onSelect: (offer: DuffelOffer) => void;
  readonly onNewSearch: () => void;
}

export function OfferList({ offers, expiresAt, onSelect, onNewSearch }: OfferListProps) {
  const countdown = useCountdown(expiresAt);
  const isExpired = countdown === 'Expired';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
          {offers.length} Offer{offers.length !== 1 ? 's' : ''} Found
        </h3>
        <div className="flex items-center gap-4">
          <span
            className={`text-xs font-medium ${isExpired ? 'text-red-400' : 'text-muted'}`}
          >
            {isExpired ? 'Expired — search again' : countdown}
          </span>
          <button
            type="button"
            onClick={onNewSearch}
            className="text-sm font-medium text-accent hover:text-accent-hover"
          >
            New Search
          </button>
        </div>
      </div>

      {offers.length === 0 && (
        <div className="rounded-lg border-2 border-dashed border-slate-600 p-8 text-center">
          <p className="text-sm text-muted">
            No offers found. Try different search criteria.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {offers.map((offer) => (
          <div
            key={offer.id}
            className="rounded-lg border border-slate-700 bg-surface-raised p-4 shadow-sm hover:border-accent/50 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-slate-200">
                    {offer.owner || offer.ownerIata}
                  </span>
                  <span className="text-xs text-muted">
                    {offer.ownerIata}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-sm text-muted">
                  <span>
                    {offer.slices[0]?.origin} →{' '}
                    {offer.slices[offer.slices.length - 1]?.destination}
                  </span>
                  <span className="text-slate-600">|</span>
                  <span>
                    {offer.totalStops === 0
                      ? 'Direct'
                      : `${offer.totalStops} stop${offer.totalStops > 1 ? 's' : ''}`}
                  </span>
                  <span className="text-slate-600">|</span>
                  <span>{formatDuration(offer.slices[0]?.duration)}</span>
                  <span className="text-slate-600">|</span>
                  <span className="capitalize">{offer.cabinClass}</span>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="text-lg font-semibold text-slate-100">
                    {offer.totalCurrency} {offer.totalAmount}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onSelect(offer)}
                  disabled={isExpired}
                  className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Book
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
