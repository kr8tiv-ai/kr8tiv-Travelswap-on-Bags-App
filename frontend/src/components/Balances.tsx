// ─── Balances Tab ──────────────────────────────────────────────
// Per-wallet travel credit balances, filtered by strategy.

import { useState } from 'react';
import { useBalances, useStrategies } from '../api/queries';
import { SkeletonLoader, ErrorAlert, EmptyState } from './shared';

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
      <h2 className="text-lg font-semibold text-white">Balances</h2>

      {/* Strategy selector (required) */}
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
        <EmptyState message="Select a strategy to view wallet balances." />
      )}

      {/* Loading */}
      {strategyId && isLoading && <SkeletonLoader rows={3} />}

      {/* Error */}
      {strategyId && isError && (
        <ErrorAlert>
          Failed to load balances:{' '}
          {error instanceof Error ? error.message : 'Unknown error'}
        </ErrorAlert>
      )}

      {/* Empty */}
      {strategyId && balances && balances.length === 0 && (
        <EmptyState message="No balances found for this strategy." />
      )}

      {/* Table */}
      {balances && balances.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 bg-surface-overlay/30 text-left text-xs font-medium uppercase tracking-wider text-muted">
                <th className="px-4 py-3">Wallet Address</th>
                <th className="px-4 py-3">Balance USD</th>
                <th className="px-4 py-3">Total Earned</th>
                <th className="px-4 py-3">Total Spent</th>
                <th className="px-4 py-3">Updated At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {balances.map((b) => (
                <tr
                  key={b.balanceId}
                  className="bg-surface-raised hover:bg-surface-overlay/40 transition-colors"
                >
                  <td className="px-4 py-3 font-mono text-xs text-muted-strong truncate max-w-[200px]">
                    {b.walletAddress}
                  </td>
                  <td className="px-4 py-3 text-white font-medium">
                    ${formatUsd(b.balanceUsd)}
                  </td>
                  <td className="px-4 py-3 text-green-400">
                    ${formatUsd(b.totalEarned)}
                  </td>
                  <td className="px-4 py-3 text-muted-strong">
                    ${formatUsd(b.totalSpent)}
                  </td>
                  <td className="px-4 py-3 text-muted text-xs">
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
