// ─── Balances Tab ──────────────────────────────────────────────
// Per-wallet travel credit balances, filtered by strategy.

import { useState } from 'react';
import { useBalances, useStrategies } from '../api/queries';

function formatUsd(val: number): string {
  return val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function Balances() {
  const [strategyId, setStrategyId] = useState<string>('');
  const { data: strategies, isLoading: strategiesLoading } = useStrategies();
  const {
    data: balances,
    isLoading,
    isError,
    error,
  } = useBalances(strategyId);

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-900">Balances</h2>

      {/* Strategy selector (required) */}
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
            Select a strategy to view wallet balances.
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
          Failed to load balances:{' '}
          {error instanceof Error ? error.message : 'Unknown error'}
        </div>
      )}

      {/* Empty */}
      {strategyId && balances && balances.length === 0 && (
        <div className="rounded-lg border-2 border-dashed border-gray-300 p-8 text-center">
          <p className="text-sm text-gray-500">
            No balances found for this strategy.
          </p>
        </div>
      )}

      {/* Table */}
      {balances && balances.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                <th className="px-4 py-3">Wallet Address</th>
                <th className="px-4 py-3">Balance USD</th>
                <th className="px-4 py-3">Total Earned</th>
                <th className="px-4 py-3">Total Spent</th>
                <th className="px-4 py-3">Updated At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {balances.map((b) => (
                <tr
                  key={b.balanceId}
                  className="hover:bg-gray-50 transition-colors"
                >
                  <td className="px-4 py-3 font-mono text-xs text-gray-700 truncate max-w-[200px]">
                    {b.walletAddress}
                  </td>
                  <td className="px-4 py-3 text-gray-900 font-medium">
                    ${formatUsd(b.balanceUsd)}
                  </td>
                  <td className="px-4 py-3 text-green-600">
                    ${formatUsd(b.totalEarned)}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    ${formatUsd(b.totalSpent)}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {formatDate(b.updatedAt)}
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
