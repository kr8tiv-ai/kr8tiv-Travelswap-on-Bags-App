// ─── Run History Tab ───────────────────────────────────────────
// Displays pipeline runs with trigger/resume mutations.

import { useState } from 'react';
import {
  useRuns,
  useStrategies,
  useTriggerRun,
  useResumeRun,
} from '../api/queries';
import { SkeletonLoader, ErrorAlert, EmptyState, StatusBadge, BADGE_COLORS } from './shared';
import type { TravelRun } from '../types';

const RUN_STATUS_COLORS: Record<TravelRun['status'], string> = {
  RUNNING: BADGE_COLORS.running,
  COMPLETE: BADGE_COLORS.complete,
  FAILED: BADGE_COLORS.failed,
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
        <h2 className="text-lg font-semibold text-white">Run History</h2>
        <button
          onClick={() => setShowTrigger((v) => !v)}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent-hover transition-colors"
        >
          Trigger Run
        </button>
      </div>

      {/* Trigger form */}
      {showTrigger && (
        <form
          onSubmit={handleTrigger}
          className="flex items-end gap-3 rounded-lg border border-slate-700 bg-surface-raised p-4"
        >
          <div className="flex-1">
            <label className="block text-xs font-medium text-muted mb-1">
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
            className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-green-500 disabled:opacity-50 transition-colors"
          >
            {triggerRun.isPending ? 'Triggering…' : 'Start'}
          </button>
          <button
            type="button"
            onClick={() => setShowTrigger(false)}
            className="rounded-md bg-slate-700 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-600 transition-colors"
          >
            Cancel
          </button>
        </form>
      )}

      {triggerRun.isError && (
        <ErrorAlert>
          Trigger failed: {triggerRun.error instanceof Error ? triggerRun.error.message : 'Unknown error'}
        </ErrorAlert>
      )}

      {/* Strategy filter */}
      <div className="max-w-xs">
        <label className="block text-xs font-medium text-muted mb-1">
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

      {isLoading && <SkeletonLoader rows={3} />}

      {isError && (
        <ErrorAlert>
          Failed to load runs:{' '}
          {error instanceof Error ? error.message : 'Unknown error'}
        </ErrorAlert>
      )}

      {runs && runs.length === 0 && (
        <EmptyState message="No runs found." />
      )}

      {/* Table */}
      {runs && runs.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-700">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 bg-surface-overlay/30 text-left text-xs font-medium uppercase tracking-wider text-muted">
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
            <tbody className="divide-y divide-slate-700/50">
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
      <tr className="bg-surface-raised hover:bg-surface-overlay/40 transition-colors">
        <td className="px-4 py-3 font-mono text-xs text-muted-strong">{run.runId}</td>
        <td className="px-4 py-3 font-mono text-xs text-muted">{run.strategyId}</td>
        <td className="px-4 py-3 text-muted-strong">{run.phase}</td>
        <td className="px-4 py-3">
          <StatusBadge
            label={run.status}
            colorClass={RUN_STATUS_COLORS[run.status]}
          />
        </td>
        <td className="px-4 py-3 text-muted-strong">{formatNum(run.claimedSol)}</td>
        <td className="px-4 py-3 text-muted-strong">{formatNum(run.swappedUsdc)}</td>
        <td className="px-4 py-3 text-muted-strong">{formatNum(run.allocatedUsd)}</td>
        <td className="px-4 py-3 text-muted-strong">{run.creditsIssued}</td>
        <td className="px-4 py-3 text-muted-strong">{run.giftCardsPurchased}</td>
        <td className="px-4 py-3 text-muted text-xs">{formatDate(run.startedAt)}</td>
        <td className="px-4 py-3 text-muted text-xs">{formatDate(run.completedAt)}</td>
        <td className="px-4 py-3">
          {run.status === 'FAILED' && (
            <button
              onClick={() => onResume.mutate(run.runId)}
              disabled={onResume.isPending}
              className="rounded bg-amber-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-500 disabled:opacity-50 transition-colors"
            >
              {onResume.isPending ? 'Resuming…' : 'Resume'}
            </button>
          )}
        </td>
      </tr>
      {run.status === 'FAILED' && run.errorMessage && (
        <tr>
          <td colSpan={12} className="px-4 py-2 bg-red-900/20">
            <p className="text-xs text-red-300">
              <span className="font-medium">Error:</span> {run.errorMessage}
            </p>
          </td>
        </tr>
      )}
    </>
  );
}
