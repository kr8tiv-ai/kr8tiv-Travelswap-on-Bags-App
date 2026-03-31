// ─── Strategies Tab ────────────────────────────────────────────
// List, create, and edit strategies.

import { useState } from 'react';
import { useStrategies } from '../api/queries';
import { StrategyForm } from './StrategyForm';
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
        <h2 className="text-lg font-semibold text-gray-900">Strategies</h2>
        <button
          onClick={() => setView({ mode: 'create' })}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
        >
          Create Strategy
        </button>
      </div>

      {isLoading && (
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

      {isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Failed to load strategies:{' '}
          {error instanceof Error ? error.message : 'Unknown error'}
        </div>
      )}

      {strategies && strategies.length === 0 && (
        <div className="rounded-lg border-2 border-dashed border-gray-300 p-8 text-center">
          <p className="text-sm text-gray-500">No strategies configured yet.</p>
          <button
            onClick={() => setView({ mode: 'create' })}
            className="mt-3 text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            Create your first strategy →
          </button>
        </div>
      )}

      {strategies && strategies.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Owner</th>
                <th className="px-4 py-3">Distribution</th>
                <th className="px-4 py-3">Cron</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {strategies.map((s) => (
                <tr
                  key={s.strategyId}
                  onClick={() => setView({ mode: 'edit', strategy: s })}
                  className="cursor-pointer hover:bg-gray-50 transition-colors"
                >
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {s.name}
                  </td>
                  <td className="px-4 py-3 text-gray-500 font-mono text-xs truncate max-w-[160px]">
                    {s.ownerWallet}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {s.distributionMode.replace(/_/g, ' ').toLowerCase()}
                  </td>
                  <td className="px-4 py-3 text-gray-500 font-mono text-xs">
                    {s.cronExpression}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        s.enabled
                          ? 'bg-green-100 text-green-700'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {s.enabled ? 'Enabled' : 'Disabled'}
                    </span>
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
