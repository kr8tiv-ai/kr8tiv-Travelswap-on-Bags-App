// ─── Gift Cards Tab ────────────────────────────────────────────
// Gift card delivery and status tracking. Never shows codeEncrypted.

import { useState } from 'react';
import { useCredits, useStrategies } from '../api/queries';
import type { GiftCardStatus } from '../types';

const STATUS_BADGE: Record<GiftCardStatus, string> = {
  PURCHASED: 'bg-yellow-100 text-yellow-700',
  DELIVERED: 'bg-blue-100 text-blue-700',
  REDEEMED: 'bg-green-100 text-green-700',
  EXPIRED: 'bg-gray-100 text-gray-500',
};

function formatUsd(val: number): string {
  return val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
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

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-900">Gift Cards</h2>

      {/* Strategy selector */}
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

      {/* Prompt to select */}
      {!strategyId && (
        <div className="rounded-lg border-2 border-dashed border-gray-300 p-8 text-center">
          <p className="text-sm text-gray-500">
            Select a strategy to view gift cards.
          </p>
        </div>
      )}

      {/* Loading */}
      {strategyId && isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="rounded-lg border border-gray-200 bg-white p-4 animate-pulse"
            >
              <div className="h-5 w-48 rounded bg-gray-200" />
              <div className="mt-2 h-4 w-64 rounded bg-gray-100" />
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {strategyId && isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Failed to load gift cards:{' '}
          {error instanceof Error ? error.message : 'Unknown error'}
        </div>
      )}

      {/* Empty */}
      {strategyId && cards && cards.length === 0 && (
        <div className="rounded-lg border-2 border-dashed border-gray-300 p-8 text-center">
          <p className="text-sm text-gray-500">
            No gift cards found for this strategy.
          </p>
        </div>
      )}

      {/* Table */}
      {cards && cards.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                <th className="px-4 py-3">Gift Card ID</th>
                <th className="px-4 py-3">Wallet</th>
                <th className="px-4 py-3">Denomination</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Delivered At</th>
                <th className="px-4 py-3">Redeemed At</th>
                <th className="px-4 py-3">Created At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {cards.map((gc) => (
                <tr
                  key={gc.giftCardId}
                  className="hover:bg-gray-50 transition-colors"
                >
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">
                    {gc.giftCardId}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500 truncate max-w-[160px]">
                    {gc.walletAddress}
                  </td>
                  <td className="px-4 py-3 text-gray-900 font-medium">
                    ${formatUsd(gc.denominationUsd)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGE[gc.status]}`}
                    >
                      {gc.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {formatDate(gc.deliveredAt)}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {formatDate(gc.redeemedAt)}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {formatDate(gc.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
