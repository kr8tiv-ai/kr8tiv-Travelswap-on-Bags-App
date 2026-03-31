// ─── Strategy Form ─────────────────────────────────────────────
// Shared create/edit form for TravelStrategy.

import { useState, type FormEvent } from 'react';
import { useCreateStrategy, useUpdateStrategy } from '../api/queries';
import type {
  TravelStrategy,
  FeeSourceType,
  DistributionMode,
  CreditMode,
} from '../types';

interface StrategyFormProps {
  readonly strategy?: TravelStrategy;
  readonly onSuccess: () => void;
  readonly onCancel: () => void;
}

const FEE_SOURCES: FeeSourceType[] = ['CLAIMABLE_POSITIONS', 'PARTNER_FEES'];

const DISTRIBUTION_MODES: DistributionMode[] = [
  'OWNER_ONLY',
  'TOP_N_HOLDERS',
  'EQUAL_SPLIT',
  'WEIGHTED_BY_HOLDINGS',
  'CUSTOM_LIST',
];

const CREDIT_MODES: CreditMode[] = ['GIFT_CARD', 'DIRECT_TOPUP', 'DUFFEL_BOOKING'];

function label(s: string): string {
  return s
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function StrategyForm({ strategy, onSuccess, onCancel }: StrategyFormProps) {
  const isEdit = !!strategy;

  const [name, setName] = useState(strategy?.name ?? '');
  const [ownerWallet, setOwnerWallet] = useState(strategy?.ownerWallet ?? '');
  const [tokenMint, setTokenMint] = useState(strategy?.tokenMint ?? '');
  const [feeSource, setFeeSource] = useState<FeeSourceType>(
    strategy?.feeSource ?? 'CLAIMABLE_POSITIONS',
  );
  const [thresholdSol, setThresholdSol] = useState(
    strategy?.thresholdSol?.toString() ?? '0.1',
  );
  const [slippageBps, setSlippageBps] = useState(
    strategy?.slippageBps?.toString() ?? '50',
  );
  const [distributionMode, setDistributionMode] = useState<DistributionMode>(
    strategy?.distributionMode ?? 'OWNER_ONLY',
  );
  const [distributionTopN, setDistributionTopN] = useState(
    strategy?.distributionTopN?.toString() ?? '10',
  );
  const [creditMode, setCreditMode] = useState<CreditMode>(
    strategy?.creditMode ?? 'GIFT_CARD',
  );
  const [giftCardThresholdUsd, setGiftCardThresholdUsd] = useState(
    strategy?.giftCardThresholdUsd?.toString() ?? '25',
  );
  const [cronExpression, setCronExpression] = useState(
    strategy?.cronExpression ?? '0 0 * * *',
  );
  const [enabled, setEnabled] = useState(strategy?.enabled ?? true);

  const [errors, setErrors] = useState<Record<string, string>>({});

  const createMutation = useCreateStrategy();
  const updateMutation = useUpdateStrategy();

  const mutation = isEdit ? updateMutation : createMutation;
  const isPending = mutation.isPending;

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Name is required';
    if (!ownerWallet.trim()) errs.ownerWallet = 'Owner wallet is required';
    if (!tokenMint.trim()) errs.tokenMint = 'Token mint is required';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    const params = {
      name: name.trim(),
      ownerWallet: ownerWallet.trim(),
      tokenMint: tokenMint.trim(),
      feeSource,
      thresholdSol: parseFloat(thresholdSol) || 0.1,
      slippageBps: parseInt(slippageBps, 10) || 50,
      distributionMode,
      distributionTopN: parseInt(distributionTopN, 10) || 10,
      creditMode,
      giftCardThresholdUsd: parseFloat(giftCardThresholdUsd) || 25,
      cronExpression: cronExpression.trim(),
      enabled,
    };

    if (isEdit) {
      updateMutation.mutate(
        { id: strategy!.strategyId, ...params },
        { onSuccess },
      );
    } else {
      createMutation.mutate(params, { onSuccess });
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 max-w-2xl">
      <h3 className="text-lg font-semibold text-gray-900">
        {isEdit ? 'Edit Strategy' : 'Create Strategy'}
      </h3>

      {mutation.isError && (
        <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          {mutation.error instanceof Error
            ? mutation.error.message
            : 'Request failed'}
        </div>
      )}

      {/* Name */}
      <Field label="Name" error={errors.name}>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="input-field"
          placeholder="My Travel Strategy"
        />
      </Field>

      {/* Owner Wallet */}
      <Field label="Owner Wallet" error={errors.ownerWallet}>
        <input
          type="text"
          value={ownerWallet}
          onChange={(e) => setOwnerWallet(e.target.value)}
          className="input-field"
          placeholder="Solana wallet address"
          readOnly={isEdit}
        />
      </Field>

      {/* Token Mint */}
      <Field label="Token Mint" error={errors.tokenMint}>
        <input
          type="text"
          value={tokenMint}
          onChange={(e) => setTokenMint(e.target.value)}
          className="input-field"
          placeholder="SPL token mint address"
          readOnly={isEdit}
        />
      </Field>

      {/* Fee Source */}
      <Field label="Fee Source">
        <select
          value={feeSource}
          onChange={(e) => setFeeSource(e.target.value as FeeSourceType)}
          className="input-field"
        >
          {FEE_SOURCES.map((fs) => (
            <option key={fs} value={fs}>
              {label(fs)}
            </option>
          ))}
        </select>
      </Field>

      {/* Threshold SOL */}
      <Field label="Threshold (SOL)">
        <input
          type="number"
          step="0.01"
          min="0"
          value={thresholdSol}
          onChange={(e) => setThresholdSol(e.target.value)}
          className="input-field"
        />
      </Field>

      {/* Slippage BPS */}
      <Field label="Slippage (BPS)">
        <input
          type="number"
          step="1"
          min="0"
          max="10000"
          value={slippageBps}
          onChange={(e) => setSlippageBps(e.target.value)}
          className="input-field"
        />
      </Field>

      {/* Distribution Mode */}
      <Field label="Distribution Mode">
        <select
          value={distributionMode}
          onChange={(e) =>
            setDistributionMode(e.target.value as DistributionMode)
          }
          className="input-field"
        >
          {DISTRIBUTION_MODES.map((dm) => (
            <option key={dm} value={dm}>
              {label(dm)}
            </option>
          ))}
        </select>
      </Field>

      {/* Distribution Top N — shown only when mode is TOP_N_HOLDERS */}
      {distributionMode === 'TOP_N_HOLDERS' && (
        <Field label="Top N Holders">
          <input
            type="number"
            step="1"
            min="1"
            value={distributionTopN}
            onChange={(e) => setDistributionTopN(e.target.value)}
            className="input-field"
          />
        </Field>
      )}

      {/* Credit Mode */}
      <Field label="Credit Mode">
        <select
          value={creditMode}
          onChange={(e) => setCreditMode(e.target.value as CreditMode)}
          className="input-field"
        >
          {CREDIT_MODES.map((cm) => (
            <option key={cm} value={cm}>
              {label(cm)}
            </option>
          ))}
        </select>
      </Field>

      {/* Gift Card Threshold */}
      <Field label="Gift Card Threshold (USD)">
        <input
          type="number"
          step="1"
          min="0"
          value={giftCardThresholdUsd}
          onChange={(e) => setGiftCardThresholdUsd(e.target.value)}
          className="input-field"
        />
      </Field>

      {/* Cron Expression */}
      <Field label="Cron Expression">
        <input
          type="text"
          value={cronExpression}
          onChange={(e) => setCronExpression(e.target.value)}
          className="input-field"
          placeholder="0 0 * * *"
        />
      </Field>

      {/* Enabled */}
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          id="strategy-enabled"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        <label htmlFor="strategy-enabled" className="text-sm font-medium text-gray-700">
          Enabled
        </label>
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending
            ? isEdit
              ? 'Updating…'
              : 'Creating…'
            : isEdit
              ? 'Update Strategy'
              : 'Create Strategy'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ─── Field wrapper ─────────────────────────────────────────────

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
