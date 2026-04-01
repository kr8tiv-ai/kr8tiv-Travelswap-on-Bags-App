// ─── Passenger Form ────────────────────────────────────────────
// Collects passenger details for booking a selected offer.

import { useState, type FormEvent } from 'react';
import { Field, Spinner } from '../shared';
import type { DuffelOffer, PassengerDetails } from '../../types';

interface PassengerFormProps {
  readonly offer: DuffelOffer;
  readonly isPending: boolean;
  readonly error: string | null;
  readonly showReSearch: boolean;
  readonly onBook: (passenger: PassengerDetails) => void;
  readonly onBack: () => void;
  readonly onReSearch: () => void;
}

export function PassengerForm({
  offer,
  isPending,
  error,
  showReSearch,
  onBook,
  onBack,
  onReSearch,
}: PassengerFormProps) {
  const [givenName, setGivenName] = useState('');
  const [familyName, setFamilyName] = useState('');
  const [bornOn, setBornOn] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [gender, setGender] = useState<'male' | 'female'>('male');
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!givenName.trim()) errs.givenName = 'Given name is required';
    if (!familyName.trim()) errs.familyName = 'Family name is required';
    if (!bornOn) errs.bornOn = 'Date of birth is required';
    if (!email.trim()) errs.email = 'Email is required';
    if (!phoneNumber.trim()) errs.phoneNumber = 'Phone number is required';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    onBook({
      givenName: givenName.trim(),
      familyName: familyName.trim(),
      bornOn,
      email: email.trim(),
      phoneNumber: phoneNumber.trim(),
      gender,
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-slate-700 bg-surface-raised p-6 shadow-sm space-y-4 max-w-2xl"
    >
      <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
        Passenger Details
      </h3>

      {/* Selected offer summary */}
      <div className="rounded-md bg-accent-muted/20 border border-accent-muted/40 p-3 text-sm text-blue-300">
        {offer.owner} — {offer.slices[0]?.origin} →{' '}
        {offer.slices[offer.slices.length - 1]?.destination} —{' '}
        {offer.totalCurrency} {offer.totalAmount}
      </div>

      {error && (
        <div className="rounded-md bg-red-900/30 border border-red-800 p-3 text-sm text-red-300">
          {error}
          {showReSearch && (
            <button
              type="button"
              onClick={onReSearch}
              className="ml-2 underline font-medium"
            >
              Search again
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Given Name" error={errors.givenName}>
          <input
            type="text"
            value={givenName}
            onChange={(e) => setGivenName(e.target.value)}
            className="input-field"
            placeholder="John"
          />
        </Field>
        <Field label="Family Name" error={errors.familyName}>
          <input
            type="text"
            value={familyName}
            onChange={(e) => setFamilyName(e.target.value)}
            className="input-field"
            placeholder="Doe"
          />
        </Field>
        <Field label="Date of Birth" error={errors.bornOn}>
          <input
            type="date"
            value={bornOn}
            onChange={(e) => setBornOn(e.target.value)}
            className="input-field"
          />
        </Field>
        <Field label="Email" error={errors.email}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input-field"
            placeholder="john@example.com"
          />
        </Field>
        <Field label="Phone Number" error={errors.phoneNumber}>
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
            onChange={(e) => setGender(e.target.value as 'male' | 'female')}
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
          disabled={isPending}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? (
            <span className="flex items-center gap-2">
              <Spinner /> Booking…
            </span>
          ) : (
            'Confirm Booking'
          )}
        </button>
        <button
          type="button"
          onClick={onBack}
          disabled={isPending}
          className="rounded-md border border-slate-600 bg-surface px-4 py-2 text-sm font-medium text-slate-300 shadow-sm hover:bg-surface-overlay disabled:opacity-50"
        >
          Back to offers
        </button>
      </div>
    </form>
  );
}
