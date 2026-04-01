// ─── Gift Cards Tab ────────────────────────────────────────────
// Gift card delivery and status tracking. Never shows codeEncrypted.
// TravelSwap-aligned dark branding (R035).

import { useState } from 'react';
import { useCredits, useStrategies, useRevealGiftCard } from '../api/queries';
import { SkeletonLoader, ErrorAlert, EmptyState, StatusBadge, BADGE_COLORS } from './shared';
import type { GiftCard, GiftCardStatus } from '../types';

const SOLANA_CLUSTER = import.meta.env.VITE_SOLANA_CLUSTER || 'devnet';

/** Build a Solana Explorer URL for a transaction signature. */
function solanaExplorerUrl(signature: string): string {
  const base = `https://explorer.solana.com/tx/${signature}`;
  return SOLANA_CLUSTER === 'mainnet-beta' ? base : `${base}?cluster=${SOLANA_CLUSTER}`;
}

const GC_STATUS_COLORS: Record<GiftCardStatus, string> = {
  PENDING: BADGE_COLORS.pending,
  PURCHASED: BADGE_COLORS.success,
  DELIVERED: BADGE_COLORS.delivered,
  REDEEMED: BADGE_COLORS.redeemed,
  EXPIRED: BADGE_COLORS.expired,
};

const PROVIDER_COLORS: Record<GiftCard['provider'], string> = {
  coinvoyage: BADGE_COLORS.success,
  bitrefill: BADGE_COLORS.info,
  stub: BADGE_COLORS.neutral,
};

const PROVIDER_LABELS: Record<GiftCard['provider'], string> = {
  coinvoyage: 'CoinVoyage',
  bitrefill: 'Bitrefill',
  stub: 'Stub',
};

const NFT_STATUS_COLORS: Record<string, string> = {
  MINTED: BADGE_COLORS.success,
  PENDING: BADGE_COLORS.pending,
  FAILED: BADGE_COLORS.failed,
};

/** Render the NFT mint status cell. */
function NftCell({ gc }: { gc: GiftCard }) {
  if (!gc.nftStatus) return <span className="text-muted">—</span>;

  if (gc.nftStatus === 'MINTED' && gc.nftMintSignature) {
    return (
      <a
        href={solanaExplorerUrl(gc.nftMintSignature)}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 group"
      >
        <StatusBadge
          label="NFT Minted"
          colorClass={NFT_STATUS_COLORS.MINTED}
          className="group-hover:ring-1 group-hover:ring-green-500/50 transition-shadow"
        />
        <svg className="h-3 w-3 text-muted group-hover:text-green-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
        </svg>
      </a>
    );
  }

  if (gc.nftStatus === 'PENDING') {
    return <StatusBadge label="Minting…" colorClass={NFT_STATUS_COLORS.PENDING} />;
  }

  if (gc.nftStatus === 'FAILED') {
    return <StatusBadge label="Mint Failed" colorClass={NFT_STATUS_COLORS.FAILED} />;
  }

  return <span className="text-muted">—</span>;
}

function formatUsd(val: number): string {
  return val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

/** Render the action cell per gift card status. */
function RevealCell({
  gc,
  revealedCodes,
  revealErrors,
  alreadyRevealedIds,
  isRevealing,
  onReveal,
}: {
  gc: GiftCard;
  revealedCodes: Record<string, string>;
  revealErrors: Record<string, string>;
  alreadyRevealedIds: Record<string, boolean>;
  isRevealing: boolean;
  onReveal: (id: string) => void;
}) {
  // PENDING → awaiting payment
  if (gc.status === 'PENDING') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-yellow-400">
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        Awaiting payment
      </span>
    );
  }

  // EXPIRED → no action
  if (gc.status === 'EXPIRED') {
    return <span className="text-xs text-slate-500">Expired</span>;
  }

  // DELIVERED / REDEEMED → code was already revealed
  if (gc.status === 'DELIVERED' || gc.status === 'REDEEMED') {
    return <span className="text-xs text-blue-400">Code revealed</span>;
  }

  // PURCHASED → revealable
  const revealedCode = revealedCodes[gc.giftCardId];
  const errorMsg = revealErrors[gc.giftCardId];
  const wasAlreadyRevealed = alreadyRevealedIds[gc.giftCardId];

  // Code was just revealed this session
  if (revealedCode) {
    return (
      <div className="space-y-1">
        <div className="inline-flex items-center gap-1.5 rounded bg-green-900/40 border border-green-700 px-2.5 py-1.5">
          <svg className="h-3.5 w-3.5 text-green-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <code className="text-xs font-mono font-semibold text-green-300 select-all">
            {revealedCode}
          </code>
        </div>
        <p className="text-[10px] text-slate-500">Code shown once — save it now</p>
      </div>
    );
  }

  // API said it was already revealed (e.g. from another session)
  if (wasAlreadyRevealed) {
    return (
      <span className="text-xs text-amber-400">Code was already revealed</span>
    );
  }

  // Error during reveal
  if (errorMsg) {
    return (
      <div className="space-y-1">
        <span className="text-xs text-red-400">{errorMsg}</span>
        <button
          onClick={() => onReveal(gc.giftCardId)}
          className="block text-xs text-accent hover:text-accent-hover"
        >
          Retry
        </button>
      </div>
    );
  }

  // Default: show reveal button (blue accent on dark)
  return (
    <button
      onClick={() => onReveal(gc.giftCardId)}
      disabled={isRevealing}
      className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-surface disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    >
      {isRevealing ? (
        <>
          <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Revealing…
        </>
      ) : (
        'Reveal Code'
      )}
    </button>
  );
}

export function GiftCards() {
  const [strategyId, setStrategyId] = useState<string>('');
  const { data: strategies, isLoading: strategiesLoading } = useStrategies();
  const {
    data: cards,
    isLoading,
    isError,
    error,
  } = useCredits({ strategyId: strategyId || undefined });

  // Session-only state for revealed codes — gone on refresh
  const [revealedCodes, setRevealedCodes] = useState<Record<string, string>>({});
  const [revealErrors, setRevealErrors] = useState<Record<string, string>>({});
  const [alreadyRevealedIds, setAlreadyRevealedIds] = useState<Record<string, boolean>>({});

  const revealMutation = useRevealGiftCard();

  const handleReveal = (giftCardId: string) => {
    // Clear previous error for this card
    setRevealErrors((prev) => {
      const next = { ...prev };
      delete next[giftCardId];
      return next;
    });

    revealMutation.mutate(giftCardId, {
      onSuccess: (data) => {
        if (data.alreadyRevealed) {
          setAlreadyRevealedIds((prev) => ({ ...prev, [giftCardId]: true }));
        } else if (data.code) {
          setRevealedCodes((prev) => ({ ...prev, [giftCardId]: data.code! }));
        }
      },
      onError: (err) => {
        setRevealErrors((prev) => ({
          ...prev,
          [giftCardId]: err instanceof Error ? err.message : 'Failed to reveal code',
        }));
      },
    });
  };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-white">Gift Cards</h2>

      {/* Strategy selector */}
      <div className="max-w-xs">
        <label className="block text-xs font-medium text-muted mb-1">
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

      {/* Prompt to select */}
      {!strategyId && (
        <EmptyState message="Select a strategy to view gift cards." />
      )}

      {/* Loading */}
      {strategyId && isLoading && <SkeletonLoader rows={3} />}

      {/* Error */}
      {strategyId && isError && (
        <ErrorAlert>
          Failed to load gift cards:{' '}
          {error instanceof Error ? error.message : 'Unknown error'}
        </ErrorAlert>
      )}

      {/* Empty */}
      {strategyId && cards && cards.length === 0 && (
        <EmptyState message="No gift cards found for this strategy." />
      )}

      {/* Table */}
      {cards && cards.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 bg-surface-overlay/30 text-left text-xs font-medium uppercase tracking-wider text-muted">
                <th className="px-4 py-3">Gift Card ID</th>
                <th className="px-4 py-3">Wallet</th>
                <th className="px-4 py-3">Denomination</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">NFT</th>
                <th className="px-4 py-3">Payment Status</th>
                <th className="px-4 py-3">Delivered At</th>
                <th className="px-4 py-3">Created At</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {cards.map((gc) => {
                const isRevealingThis =
                  revealMutation.isPending &&
                  revealMutation.variables === gc.giftCardId;

                return (
                  <tr
                    key={gc.giftCardId}
                    className="bg-surface-raised hover:bg-surface-overlay/40 transition-colors"
                  >
                    <td className="px-4 py-3 font-mono text-xs text-muted-strong">
                      {gc.giftCardId}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted truncate max-w-[160px]">
                      {gc.walletAddress}
                    </td>
                    <td className="px-4 py-3 text-white font-medium">
                      ${formatUsd(gc.denominationUsd)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge
                        label={gc.status}
                        colorClass={GC_STATUS_COLORS[gc.status]}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge
                        label={PROVIDER_LABELS[gc.provider]}
                        colorClass={PROVIDER_COLORS[gc.provider]}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <NftCell gc={gc} />
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-strong">
                      {gc.payorderId ? (
                        <span className="font-mono">{gc.paymentStatus ?? '—'}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted text-xs">
                      {formatDate(gc.deliveredAt)}
                    </td>
                    <td className="px-4 py-3 text-muted text-xs">
                      {formatDate(gc.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <RevealCell
                        gc={gc}
                        revealedCodes={revealedCodes}
                        revealErrors={revealErrors}
                        alreadyRevealedIds={alreadyRevealedIds}
                        isRevealing={isRevealingThis}
                        onReveal={handleReveal}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
