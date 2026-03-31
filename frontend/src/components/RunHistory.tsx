// ─── Run History Tab ───────────────────────────────────────────
// Displays pipeline runs with trigger/resume mutations.

import { useState } from 'react';
import {
  useRuns,
  useStrategies,
  useTriggerRun,
  useResumeRun,
} from '../api/queries';
import type { TravelRun } from '../types';

const STATUS_BADGE: Record<TravelRun['status'], string> = {
  RUNNING: 'bg-blue-100 text-blue-700',
  COMPLETE: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-700',
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function formatNum(val: number | null): string {
  if (val === null || val === undefined) return '—';
  return val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

export function RunHistory() {
  const [strategyFilter, setStrategyFilter] = useState<string>('');
  const [showTrigger, setShowTrigger] = useState(false);
  const [triggerStrategyId, setTriggerStrategyId] = useState<string>('');

  const { data: strategies } = useStrategies();
  const { data: runs, isLoading, isError, error } = useRuns(
    strategyFilter || undefined,
  );
  const triggerRun = useTriggerRun();
  const resumeRun = useResumeRun();

  function handleTrigger(e: React.FormEvent) {
    e.preventDefault();
    if (!triggerStrategyId) return;
    triggerRun.mutate(
      { strategyId: Number(triggerStrategyId) },
      { onSuccess: () => { setShowTrigger(false); setTriggerStrategyId(''); } },
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Run History</h2>
        <button
          onClick={() => setShowTrigger((v) => !v)}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
        >
          Trigger Run
        </button>
      </div>

      {/* Trigger form */}
      {showTrigger && (
        <form
          onSubmit={handleTrigger}
          className="flex items-end gap-3 rounded-lg border border-gray-200 bg-white p-4"
        >
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Strategy
            </label>
            <select
              value={triggerStrategyId}
              onChange={(e) => setTriggerStrategyId(e.target.value)}
              className="input-field"
              required
            >
              <option value="">Select strategy…</option>
              {strategies?.map((s) => (
                <option key={s.strategyId} value={s.strategyId}>
                  {s.name} ({s.strategyId})
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={triggerRun.isPending || !triggerStrategyId}
            className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-green-700 disabled:opacity-50"
          >
            {triggerRun.isPending ? 'Triggering…' : 'Start'}
          </button>
          <button
            type="button"
            onClick={() => setShowTrigger(false)}
            className="rounded-md bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
          >
            Cancel
          </button>
        </form>
      )}

      {triggerRun.isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Trigger failed: {triggerRun.error instanceof Error ? triggerRun.error.message : 'Unknown error'}
        </div>
      )}

      {/* Strategy filter */}
      <div className="max-w-xs">
        <label className="block text-xs font-medium text-gray-500 mb-1">
          Filter by Strategy
        </label>
        <select
          value={strategyFilter}
          onChange={(e) => setStrategyFilter(e.target.value)}
          className="input-field"
        >
          <option value="">All strategies</option>
          {strategies?.map((s) => (
            <option key={s.strategyId} value={s.strategyId}>
              {s.name} ({s.strategyId})
            </option>
          ))}
        </select>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="rounded-lg border border-gray-200 bg-white p-4 animate-pulse"
            >
              <div className="h-5 w-48 rounded bg-gray-200" />
              <div className="mt-2 h-4 w-96 rounded bg-gray-100" />
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Failed to load runs:{' '}
          {error instanceof Error ? error.message : 'Unknown error'}
        </div>
      )}

      {/* Empty */}
      {runs && runs.length === 0 && (
        <div className="rounded-lg border-2 border-dashed border-gray-300 p-8 text-center">
          <p className="text-sm text-gray-500">No runs found.</p>
        </div>
      )}

      {/* Table */}
      {runs && runs.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                <th className="px-4 py-3">Run ID</th>
                <th className="px-4 py-3">Strategy</th>
                <th className="px-4 py-3">Phase</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Claimed SOL</th>
                <th className="px-4 py-3">Swapped USDC</th>
                <th className="px-4 py-3">Alloc. USD</th>
                <th className="px-4 py-3">Credits</th>
                <th className="px-4 py-3">Gift Cards</th>
                <th className="px-4 py-3">Started</th>
                <th className="px-4 py-3">Completed</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {runs.map((run) => (
                <RunRow key={run.runId} run={run} onResume={resumeRun} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RunRow({
  run,
  onResume,
}: {
  run: TravelRun;
  onResume: ReturnType<typeof useResumeRun>;
}) {
  return (
    <>
      <tr className="hover:bg-gray-50 transition-colors">
        <td className="px-4 py-3 font-mono text-xs text-gray-700">{run.runId}</td>
        <td className="px-4 py-3 font-mono text-xs text-gray-500">{run.strategyId}</td>
        <td className="px-4 py-3 text-gray-600">{run.phase}</td>
        <td className="px-4 py-3">
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGE[run.status]}`}
          >
            {run.status}
          </span>
        </td>
        <td className="px-4 py-3 text-gray-600">{formatNum(run.claimedSol)}</td>
        <td className="px-4 py-3 text-gray-600">{formatNum(run.swappedUsdc)}</td>
        <td className="px-4 py-3 text-gray-600">{formatNum(run.allocatedUsd)}</td>
        <td className="px-4 py-3 text-gray-600">{run.creditsIssued}</td>
        <td className="px-4 py-3 text-gray-600">{run.giftCardsPurchased}</td>
        <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(run.startedAt)}</td>
        <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(run.completedAt)}</td>
        <td className="px-4 py-3">
          {run.status === 'FAILED' && (
            <button
              onClick={() => onResume.mutate(run.runId)}
              disabled={onResume.isPending}
              className="rounded bg-amber-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-50"
            >
              {onResume.isPending ? 'Resuming…' : 'Resume'}
            </button>
          )}
        </td>
      </tr>
      {run.status === 'FAILED' && run.errorMessage && (
        <tr>
          <td colSpan={12} className="px-4 py-2 bg-red-50">
            <p className="text-xs text-red-600">
              <span className="font-medium">Error:</span> {run.errorMessage}
            </p>
          </td>
        </tr>
      )}
    </>
  );
}
