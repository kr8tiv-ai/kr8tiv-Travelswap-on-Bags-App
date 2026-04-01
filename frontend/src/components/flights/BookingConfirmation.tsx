// ─── Booking Confirmation ──────────────────────────────────────
// Displays confirmed booking details with status badge and balance info.

import { StatusBadge, BADGE_COLORS } from '../shared';
import type { Booking, BookingStatus, TravelBalance } from '../../types';

const STATUS_COLOR: Record<BookingStatus, string> = {
  CONFIRMED: BADGE_COLORS.success,
  PENDING: BADGE_COLORS.pending,
  FAILED: BADGE_COLORS.failed,
};

interface BookingConfirmationProps {
  readonly booking: Booking;
  readonly balance: TravelBalance | undefined;
  readonly onNewSearch: () => void;
}

export function BookingConfirmation({
  booking,
  balance,
  onNewSearch,
}: BookingConfirmationProps) {
  return (
    <div className="rounded-lg border border-slate-700 bg-surface-raised p-6 shadow-sm space-y-4 max-w-2xl">
      <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
        Booking Confirmation
      </h3>

      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-muted">Status:</span>
          <StatusBadge
            label={booking.status}
            colorClass={STATUS_COLOR[booking.status]}
          />
        </div>

        {booking.bookingReference && (
          <div>
            <span className="text-sm font-medium text-muted">
              Booking Reference:{' '}
            </span>
            <span className="font-mono text-sm text-slate-200">
              {booking.bookingReference}
            </span>
          </div>
        )}

        <div>
          <span className="text-sm font-medium text-muted">Amount: </span>
          <span className="text-sm text-slate-200">
            {booking.currency} {booking.amountUsd.toFixed(2)}
          </span>
        </div>

        {booking.passengers.length > 0 && (
          <div>
            <span className="text-sm font-medium text-muted">
              Passenger:{' '}
            </span>
            <span className="text-sm text-slate-200">
              {booking.passengers[0].givenName}{' '}
              {booking.passengers[0].familyName}
            </span>
          </div>
        )}

        {balance && (
          <div className="rounded-md bg-surface border border-slate-700 p-3 text-sm">
            <span className="font-medium text-muted">Current Balance: </span>
            <span className="text-slate-200">
              ${balance.balanceUsd.toFixed(2)}
            </span>
          </div>
        )}
      </div>

      <div className="pt-2">
        <button
          type="button"
          onClick={onNewSearch}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent-hover"
        >
          Search More Flights
        </button>
      </div>
    </div>
  );
}
