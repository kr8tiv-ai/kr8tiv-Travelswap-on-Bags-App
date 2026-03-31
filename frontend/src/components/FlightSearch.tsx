// ─── Flight Search & Booking ───────────────────────────────────
// Four-state flow: search → offers → passenger-form → confirmation.
// Follows GiftCards.tsx pattern for strategy selector and
// StrategyForm.tsx pattern for form state management.

import { useState, useEffect, useCallback, type FormEvent } from 'react';
import {
  useStrategies,
  useFlightSearch,
  useBookFlight,
  useBalances,
} from '../api/queries';
import type {
  CabinClass,
  DuffelOffer,
  CachedOfferResult,
  Booking,
  PassengerDetails,
  BookingStatus,
} from '../types';

// ─── Constants ─────────────────────────────────────────────────

type FlowState = 'search' | 'offers' | 'passenger-form' | 'confirmation';

const CABIN_OPTIONS: { value: CabinClass; label: string }[] = [
  { value: 'economy', label: 'Economy' },
  { value: 'premium_economy', label: 'Premium Economy' },
  { value: 'business', label: 'Business' },
  { value: 'first', label: 'First' },
];

const STATUS_BADGE: Record<BookingStatus, string> = {
  CONFIRMED: 'bg-green-100 text-green-700',
  PENDING: 'bg-yellow-100 text-yellow-700',
  FAILED: 'bg-red-100 text-red-700',
};

// ─── Helpers ───────────────────────────────────────────────────

function formatDuration(iso: string | null): string {
  if (!iso) return '—';
  // ISO 8601 duration: PT2H30M
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!match) return iso;
  const h = match[1] ? `${match[1]}h` : '';
  const m = match[2] ? `${match[2]}m` : '';
  return `${h} ${m}`.trim() || '—';
}

function useCountdown(expiresAt: string | undefined): string {
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

// ─── FlightSearch Component ────────────────────────────────────

export function FlightSearch() {
  // ── Strategy selector state ──
  const [strategyId, setStrategyId] = useState('');
  const { data: strategies, isLoading: strategiesLoading } = useStrategies();

  const selectedStrategy = strategies?.find(
    (s) => s.strategyId === strategyId,
  );

  // ── Flow state ──
  const [flowState, setFlowState] = useState<FlowState>('search');
  const [cachedResult, setCachedResult] = useState<CachedOfferResult | null>(
    null,
  );
  const [selectedOffer, setSelectedOffer] = useState<DuffelOffer | null>(null);
  const [booking, setBooking] = useState<Booking | null>(null);

  // ── Search form state ──
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [departureDate, setDepartureDate] = useState('');
  const [returnDate, setReturnDate] = useState('');
  const [passengers, setPassengers] = useState(1);
  const [cabinClass, setCabinClass] = useState<CabinClass>('economy');
  const [searchErrors, setSearchErrors] = useState<Record<string, string>>({});

  // ── Passenger form state ──
  const [givenName, setGivenName] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [bornOn, setBornOn] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [gender, setGender] = useState<'male' | 'female'>('male');
  const [passengerErrors, setPassengerErrors] = useState<
    Record<string, string>
  >({});

  // ── Mutations ──
  const searchMutation = useFlightSearch();
  const bookMutation = useBookFlight();

  // ── Balance query (for confirmation view) ──
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

  // ── Search validation & submit ──
  function validateSearch(): boolean {
    const errs: Record<string, string> = {};
    if (!origin.trim()) errs.origin = 'Origin is required';
    if (!destination.trim()) errs.destination = 'Destination is required';
    if (!departureDate) errs.departureDate = 'Departure date is required';
    setSearchErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    if (!validateSearch()) return;

    searchMutation.mutate(
      {
        origin: origin.trim().toUpperCase(),
        destination: destination.trim().toUpperCase(),
        departureDate,
        returnDate: returnDate || undefined,
        passengers,
        cabinClass,
      },
      {
        onSuccess: (data) => {
          setCachedResult(data);
          setFlowState('offers');
        },
      },
    );
  }

  // ── Passenger validation & booking submit ──
  function validatePassenger(): boolean {
    const errs: Record<string, string> = {};
    if (!givenName.trim()) errs.givenName = 'Given name is required';
    if (!familyName.trim()) errs.familyName = 'Family name is required';
    if (!bornOn) errs.bornOn = 'Date of birth is required';
    if (!email.trim()) errs.email = 'Email is required';
    if (!phoneNumber.trim()) errs.phoneNumber = 'Phone number is required';
    setPassengerErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleBook(e: FormEvent) {
    e.preventDefault();
    if (!validatePassenger()) return;
    if (!selectedOffer || !cachedResult || !strategyId || !selectedStrategy)
      return;

    const passenger: PassengerDetails = {
      givenName: givenName.trim(),
      familyName: familyName.trim(),
      bornOn,
      email: email.trim(),
      phoneNumber: phoneNumber.trim(),
      gender,
    };

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

  // ── Check for re_search hint in error ──
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
      <h2 className="text-lg font-semibold text-gray-900">Flights</h2>

      {/* Strategy Selector — always visible */}
      <div className="max-w-xs">
        <label className="block text-xs font-medium text-gray-500 mb-1">
          Strategy
        </label>
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
        <div className="rounded-lg border-2 border-dashed border-gray-300 p-8 text-center">
          <p className="text-sm text-gray-500">
            Select a strategy to search flights.
          </p>
        </div>
      )}

      {/* ── Search Form ── */}
      {strategyId && flowState === 'search' && (
        <form
          onSubmit={handleSearch}
          className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm space-y-4 max-w-2xl"
        >
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">
            Search Flights
          </h3>

          {searchMutation.isError && (
            <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
              {searchMutation.error instanceof Error
                ? searchMutation.error.message
                : 'Search failed'}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Origin" error={searchErrors.origin}>
              <input
                type="text"
                value={origin}
                onChange={(e) => setOrigin(e.target.value)}
                className="input-field"
                placeholder="JFK"
                maxLength={3}
              />
            </Field>
            <Field label="Destination" error={searchErrors.destination}>
              <input
                type="text"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                className="input-field"
                placeholder="LAX"
                maxLength={3}
              />
            </Field>
            <Field label="Departure Date" error={searchErrors.departureDate}>
              <input
                type="date"
                value={departureDate}
                onChange={(e) => setDepartureDate(e.target.value)}
                className="input-field"
              />
            </Field>
            <Field label="Return Date (optional)">
              <input
                type="date"
                value={returnDate}
                onChange={(e) => setReturnDate(e.target.value)}
                className="input-field"
              />
            </Field>
            <Field label="Passengers">
              <input
                type="number"
                min={1}
                max={9}
                value={passengers}
                onChange={(e) =>
                  setPassengers(Math.max(1, parseInt(e.target.value, 10) || 1))
                }
                className="input-field"
              />
            </Field>
            <Field label="Cabin Class">
              <select
                value={cabinClass}
                onChange={(e) => setCabinClass(e.target.value as CabinClass)}
                className="input-field"
              >
                {CABIN_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={searchMutation.isPending}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {searchMutation.isPending ? (
                <span className="flex items-center gap-2">
                  <Spinner /> Searching…
                </span>
              ) : (
                'Search Flights'
              )}
            </button>
          </div>
        </form>
      )}

      {/* ── Offer List ── */}
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

      {/* ── Passenger Form ── */}
      {strategyId && flowState === 'passenger-form' && selectedOffer && (
        <form
          onSubmit={handleBook}
          className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm space-y-4 max-w-2xl"
        >
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">
            Passenger Details
          </h3>

          {/* Selected offer summary */}
          <div className="rounded-md bg-blue-50 border border-blue-200 p-3 text-sm text-blue-800">
            {selectedOffer.owner} — {selectedOffer.slices[0]?.origin} →{' '}
            {selectedOffer.slices[selectedOffer.slices.length - 1]?.destination}{' '}
            — {selectedOffer.totalCurrency} {selectedOffer.totalAmount}
          </div>

          {bookMutation.isError && (
            <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
              {bookErrorMessage}
              {showReSearch && (
                <button
                  type="button"
                  onClick={resetToSearch}
                  className="ml-2 underline font-medium"
                >
                  Search again
                </button>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Given Name" error={passengerErrors.givenName}>
              <input
                type="text"
                value={givenName}
                onChange={(e) => setGivenName(e.target.value)}
                className="input-field"
                placeholder="John"
              />
            </Field>
            <Field label="Family Name" error={passengerErrors.familyName}>
              <input
                type="text"
                value={familyName}
                onChange={(e) => setFamilyName(e.target.value)}
                className="input-field"
                placeholder="Doe"
              />
            </Field>
            <Field label="Date of Birth" error={passengerErrors.bornOn}>
              <input
                type="date"
                value={bornOn}
                onChange={(e) => setBornOn(e.target.value)}
                className="input-field"
              />
            </Field>
            <Field label="Email" error={passengerErrors.email}>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input-field"
                placeholder="john@example.com"
              />
            </Field>
            <Field label="Phone Number" error={passengerErrors.phoneNumber}>
              <input
                type="tel"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                className="input-field"
                placeholder="+1234567890"
              />
            </Field>
            <Field label="Gender">
              <select
                value={gender}
                onChange={(e) =>
                  setGender(e.target.value as 'male' | 'female')
                }
                className="input-field"
              >
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </Field>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={bookMutation.isPending}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {bookMutation.isPending ? (
                <span className="flex items-center gap-2">
                  <Spinner /> Booking…
                </span>
              ) : (
                'Confirm Booking'
              )}
            </button>
            <button
              type="button"
              onClick={() => setFlowState('offers')}
              disabled={bookMutation.isPending}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50"
            >
              Back to offers
            </button>
          </div>
        </form>
      )}

      {/* ── Confirmation ── */}
      {strategyId && flowState === 'confirmation' && booking && (
        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm space-y-4 max-w-2xl">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">
            Booking Confirmation
          </h3>

          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-gray-500">
                Status:
              </span>
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGE[booking.status]}`}
              >
                {booking.status}
              </span>
            </div>

            {booking.bookingReference && (
              <div>
                <span className="text-sm font-medium text-gray-500">
                  Booking Reference:{' '}
                </span>
                <span className="font-mono text-sm text-gray-900">
                  {booking.bookingReference}
                </span>
              </div>
            )}

            <div>
              <span className="text-sm font-medium text-gray-500">
                Amount:{' '}
              </span>
              <span className="text-sm text-gray-900">
                {booking.currency} {booking.amountUsd.toFixed(2)}
              </span>
            </div>

            {booking.passengers.length > 0 && (
              <div>
                <span className="text-sm font-medium text-gray-500">
                  Passenger:{' '}
                </span>
                <span className="text-sm text-gray-900">
                  {booking.passengers[0].givenName}{' '}
                  {booking.passengers[0].familyName}
                </span>
              </div>
            )}

            {balances && balances.length > 0 && (
              <div className="rounded-md bg-gray-50 border border-gray-200 p-3 text-sm">
                <span className="font-medium text-gray-500">
                  Current Balance:{' '}
                </span>
                <span className="text-gray-900">
                  ${balances[0].balanceUsd.toFixed(2)}
                </span>
              </div>
            )}
          </div>

          <div className="pt-2">
            <button
              type="button"
              onClick={resetToSearch}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
            >
              Search More Flights
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Offer List Sub-Component ──────────────────────────────────

function OfferList({
  offers,
  expiresAt,
  onSelect,
  onNewSearch,
}: {
  offers: DuffelOffer[];
  expiresAt: string;
  onSelect: (offer: DuffelOffer) => void;
  onNewSearch: () => void;
}) {
  const countdown = useCountdown(expiresAt);
  const isExpired = countdown === 'Expired';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">
          {offers.length} Offer{offers.length !== 1 ? 's' : ''} Found
        </h3>
        <div className="flex items-center gap-4">
          <span
            className={`text-xs font-medium ${isExpired ? 'text-red-600' : 'text-gray-500'}`}
          >
            {isExpired ? 'Expired — search again' : countdown}
          </span>
          <button
            type="button"
            onClick={onNewSearch}
            className="text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            New Search
          </button>
        </div>
      </div>

      {offers.length === 0 && (
        <div className="rounded-lg border-2 border-dashed border-gray-300 p-8 text-center">
          <p className="text-sm text-gray-500">
            No offers found. Try different search criteria.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {offers.map((offer) => (
          <div
            key={offer.id}
            className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm hover:border-blue-300 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900">
                    {offer.owner || offer.ownerIata}
                  </span>
                  <span className="text-xs text-gray-400">
                    {offer.ownerIata}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-sm text-gray-600">
                  <span>
                    {offer.slices[0]?.origin} →{' '}
                    {offer.slices[offer.slices.length - 1]?.destination}
                  </span>
                  <span className="text-gray-300">|</span>
                  <span>
                    {offer.totalStops === 0
                      ? 'Direct'
                      : `${offer.totalStops} stop${offer.totalStops > 1 ? 's' : ''}`}
                  </span>
                  <span className="text-gray-300">|</span>
                  <span>{formatDuration(offer.slices[0]?.duration)}</span>
                  <span className="text-gray-300">|</span>
                  <span className="capitalize">{offer.cabinClass}</span>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="text-lg font-semibold text-gray-900">
                    {offer.totalCurrency} {offer.totalAmount}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onSelect(offer)}
                  disabled={isExpired}
                  className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
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

// ─── Shared Helpers ────────────────────────────────────────────

function Field({
  label: labelText,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {labelText}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function Spinner() {
  return (
    <svg
      className="animate-spin h-4 w-4"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
