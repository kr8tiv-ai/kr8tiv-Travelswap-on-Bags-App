// ─── Overview Tab ──────────────────────────────────────────────
// Aggregate stats cards + health badge. Data from GET /api/stats.

import { useStats } from '../api/queries';
import { HealthBadge } from './HealthBadge';
import { SkeletonLoader, ErrorAlert } from './shared';

interface StatCardProps {
  readonly label: string;
  readonly value: string | number;
  readonly unit?: string;
}

function StatCard({ label, value, unit }: StatCardProps) {
  return (
    <div className="rounded-lg border border-slate-700 bg-surface-raised p-5">
      <p className="text-sm font-medium text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-white">
        {typeof value === 'number' ? value.toLocaleString() : value}
        {unit && <span className="ml-1 text-sm font-normal text-muted">{unit}</span>}
      </p>
    </div>
  );
}

export function Overview() {
  const { data, isLoading, isError, error } = useStats();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-white">System Health</h2>
        <p className="mt-0.5 text-sm text-muted">DeFi fees → travel credits, automatically</p>
        <div className="mt-2 max-w-sm">
          <HealthBadge />
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-white">Aggregate Stats</h2>

        {isLoading && (
          <div className="mt-4">
            <SkeletonLoader rows={4} />
          </div>
        )}

        {isError && (
          <div className="mt-4">
            <ErrorAlert>
              Failed to load stats:{' '}
              {error instanceof Error ? error.message : 'Unknown error'}
            </ErrorAlert>
          </div>
        )}

        {data && (
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Total Runs" value={data.totalRuns} />
            <StatCard label="Completed" value={data.completedRuns} />
            <StatCard label="Failed" value={data.failedRuns} />
            <StatCard label="SOL Claimed" value={data.totalClaimedSol} unit="SOL" />
            <StatCard label="USDC Swapped" value={data.totalSwappedUsdc} unit="USDC" />
            <StatCard label="USD Allocated" value={data.totalAllocatedUsd} unit="USD" />
            <StatCard label="Credits Issued" value={data.totalCreditsIssued} />
            <StatCard label="Gift Cards" value={data.totalGiftCardsPurchased} />
          </div>
        )}
      </div>
    </div>
  );
}
