// ─── Strategies Tab ────────────────────────────────────────────
// List, create, and edit strategies.

import { useState } from 'react';
import { useStrategies } from '../api/queries';
import { StrategyForm } from './StrategyForm';
import { SkeletonLoader, ErrorAlert, EmptyState, StatusBadge, BADGE_COLORS } from './shared';
import type { TravelStrategy } from '../types';

type ViewState =
  | { mode: 'list' }
  | { mode: 'create' }
  | { mode: 'edit'; strategy: TravelStrategy };

export function Strategies() {
  const [view, setView] = useState<ViewState>({ mode: 'list' });
  const { data: strategies, isLoading, isError, error } = useStrategies();

  if (view.mode === 'create') {
    return (
      <StrategyForm
        onSuccess={() => setView({ mode: 'list' })}
        onCancel={() => setView({ mode: 'list' })}
      />
    );
  }

  if (view.mode === 'edit') {
    return (
      <StrategyForm
        strategy={view.strategy}
        onSuccess={() => setView({ mode: 'list' })}
        onCancel={() => setView({ mode: 'list' })}
      />
    );
  }

  // List view
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Strategies</h2>
        <button
          onClick={() => setView({ mode: 'create' })}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent-hover transition-colors"
        >
          Create Strategy
        </button>
      </div>

      {isLoading && <SkeletonLoader rows={3} />}

      {isError && (
        <ErrorAlert>
          Failed to load strategies:{' '}
          {error instanceof Error ? error.message : 'Unknown error'}
        </ErrorAlert>
      )}

      {strategies && strategies.length === 0 && (
        <EmptyState
          message="No strategies configured yet."
          action={
            <button
              onClick={() => setView({ mode: 'create' })}
              className="text-sm font-medium text-accent hover:text-accent-hover transition-colors"
            >
              Create your first strategy →
            </button>
          }
        />
      )}

      {strategies && strategies.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 bg-surface-overlay/30 text-left text-xs font-medium uppercase tracking-wider text-muted">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Owner</th>
                <th className="px-4 py-3">Distribution</th>
                <th className="px-4 py-3">Cron</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {strategies.map((s) => (
                <tr
                  key={s.strategyId}
                  onClick={() => setView({ mode: 'edit', strategy: s })}
                  className="cursor-pointer bg-surface-raised hover:bg-surface-overlay/40 transition-colors"
                >
                  <td className="px-4 py-3 font-medium text-white">
                    {s.name}
                  </td>
                  <td className="px-4 py-3 text-muted font-mono text-xs truncate max-w-[160px]">
                    {s.ownerWallet}
                  </td>
                  <td className="px-4 py-3 text-muted-strong">
                    {s.distributionMode.replace(/_/g, ' ').toLowerCase()}
                  </td>
                  <td className="px-4 py-3 text-muted font-mono text-xs">
                    {s.cronExpression}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge
                      label={s.enabled ? 'Enabled' : 'Disabled'}
                      colorClass={s.enabled ? BADGE_COLORS.enabled : BADGE_COLORS.disabled}
                    />
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
