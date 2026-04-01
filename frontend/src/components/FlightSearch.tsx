// ─── Flight Search & Booking (Orchestrator) ───────────────────
// Four-state flow: search → offers → passenger-form → confirmation.
// Delegates rendering to focused sub-components in flights/.

import { useState, useCallback } from 'react';
import {
  useStrategies,
  useFlightSearch,
  useBookFlight,
  useBalances,
} from '../api/queries';
import type {
  CachedOfferResult,
  DuffelOffer,
  Booking,
  PassengerDetails,
  FlightSearchParams,
} from '../types';
import { SearchForm } from './flights/SearchForm';
import { OfferList } from './flights/OfferList';
import { PassengerForm } from './flights/PassengerForm';
import { BookingConfirmation } from './flights/BookingConfirmation';

type FlowState = 'search' | 'offers' | 'passenger-form' | 'confirmation';

export function FlightSearch() {
  // ── Strategy selector ──
  const [strategyId, setStrategyId] = useState('');
  const { data: strategies, isLoading: strategiesLoading } = useStrategies();
  const selectedStrategy = strategies?.find((s) => s.strategyId === strategyId);

  // ── Flow state ──
  const [flowState, setFlowState] = useState<FlowState>('search');
  const [cachedResult, setCachedResult] = useState<CachedOfferResult | null>(null);
  const [selectedOffer, setSelectedOffer] = useState<DuffelOffer | null>(null);
  const [booking, setBooking] = useState<Booking | null>(null);

  // ── Mutations & queries ──
  const searchMutation = useFlightSearch();
  const bookMutation = useBookFlight();
  const { data: balances } = useBalances(strategyId || '');

  // ── Callbacks ──
  const resetToSearch = useCallback(() => {
    setFlowState('search');
    setCachedResult(null);
    setSelectedOffer(null);
    setBooking(null);
    searchMutation.reset();
    bookMutation.reset();
  }, [searchMutation, bookMutation]);

  function handleSearch(params: FlightSearchParams) {
    searchMutation.mutate(params, {
      onSuccess: (data) => {
        setCachedResult(data);
        setFlowState('offers');
      },
    });
  }

  function handleBook(passenger: PassengerDetails) {
    if (!selectedOffer || !cachedResult || !strategyId || !selectedStrategy) return;
    bookMutation.mutate(
      {
        offerId: selectedOffer.id,
        requestId: cachedResult.requestId,
        strategyId,
        walletAddress: selectedStrategy.ownerWallet,
        passengers: [passenger],
      },
      {
        onSuccess: (data) => {
          setBooking(data);
          setFlowState('confirmation');
        },
      },
    );
  }

  // ── Booking error handling ──
  const bookErrorMessage =
    bookMutation.error instanceof Error
      ? bookMutation.error.message
      : bookMutation.isError
        ? 'Booking failed'
        : null;

  const showReSearch =
    bookErrorMessage?.includes('re_search') ||
    bookErrorMessage?.includes('expired');

  // ── Render ──
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-slate-100">Flights</h2>

      {/* Strategy Selector — always visible */}
      <div className="max-w-xs">
        <label className="block text-xs font-medium text-muted mb-1">Strategy</label>
        <select
          value={strategyId}
          onChange={(e) => setStrategyId(e.target.value)}
          className="input-field"
        >
          <option value="">
            {strategiesLoading ? 'Loading…' : 'Select strategy…'}
          </option>
          {strategies?.map((s) => (
            <option key={s.strategyId} value={s.strategyId}>
              {s.name} ({s.strategyId})
            </option>
          ))}
        </select>
      </div>

      {!strategyId && (
        <div className="rounded-lg border-2 border-dashed border-slate-600 p-8 text-center">
          <p className="text-sm text-muted">Select a strategy to search flights.</p>
        </div>
      )}

      {strategyId && flowState === 'search' && (
        <SearchForm
          isPending={searchMutation.isPending}
          error={searchMutation.error instanceof Error ? searchMutation.error : null}
          onSearch={handleSearch}
        />
      )}

      {strategyId && flowState === 'offers' && cachedResult && (
        <OfferList
          offers={cachedResult.offers}
          expiresAt={cachedResult.expiresAt}
          onSelect={(offer) => {
            setSelectedOffer(offer);
            setFlowState('passenger-form');
          }}
          onNewSearch={resetToSearch}
        />
      )}

      {strategyId && flowState === 'passenger-form' && selectedOffer && (
        <PassengerForm
          offer={selectedOffer}
          isPending={bookMutation.isPending}
          error={bookErrorMessage}
          showReSearch={!!showReSearch}
          onBook={handleBook}
          onBack={() => setFlowState('offers')}
          onReSearch={resetToSearch}
        />
      )}

      {strategyId && flowState === 'confirmation' && booking && (
        <BookingConfirmation
          booking={booking}
          balance={balances?.[0]}
          onNewSearch={resetToSearch}
        />
      )}
    </div>
  );
}
