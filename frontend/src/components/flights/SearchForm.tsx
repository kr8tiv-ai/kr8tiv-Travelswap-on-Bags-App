// ─── Search Form ───────────────────────────────────────────────
// Flight search inputs: strategy-aware origin/destination/date/cabin form.

import { useState, type FormEvent } from 'react';
import { Field, Spinner } from '../shared';
import type { CabinClass, FlightSearchParams } from '../../types';

const CABIN_OPTIONS: { value: CabinClass; label: string }[] = [
  { value: 'economy', label: 'Economy' },
  { value: 'premium_economy', label: 'Premium Economy' },
  { value: 'business', label: 'Business' },
  { value: 'first', label: 'First' },
];

interface SearchFormProps {
  readonly isPending: boolean;
  readonly error: Error | null;
  readonly onSearch: (params: FlightSearchParams) => void;
}

export function SearchForm({ isPending, error, onSearch }: SearchFormProps) {
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [departureDate, setDepartureDate] = useState('');
  const [returnDate, setReturnDate] = useState('');
  const [passengers, setPassengers] = useState(1);
  const [cabinClass, setCabinClass] = useState<CabinClass>('economy');
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!origin.trim()) errs.origin = 'Origin is required';
    if (!destination.trim()) errs.destination = 'Destination is required';
    if (!departureDate) errs.departureDate = 'Departure date is required';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    onSearch({
      origin: origin.trim().toUpperCase(),
      destination: destination.trim().toUpperCase(),
      departureDate,
      returnDate: returnDate || undefined,
      passengers,
      cabinClass,
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-slate-700 bg-surface-raised p-6 shadow-sm space-y-4 max-w-2xl"
    >
      <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
        Search Flights
      </h3>

      {error && (
        <div className="rounded-md bg-red-900/30 border border-red-800 p-3 text-sm text-red-300">
          {error.message || 'Search failed'}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Origin" error={errors.origin}>
          <input
            type="text"
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
            className="input-field"
            placeholder="JFK"
            maxLength={3}
          />
        </Field>
        <Field label="Destination" error={errors.destination}>
          <input
            type="text"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            className="input-field"
            placeholder="LAX"
            maxLength={3}
          />
        </Field>
        <Field label="Departure Date" error={errors.departureDate}>
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
          disabled={isPending}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? (
            <span className="flex items-center gap-2">
              <Spinner /> Searching…
            </span>
          ) : (
            'Search Flights'
          )}
        </button>
      </div>
    </form>
  );
}
