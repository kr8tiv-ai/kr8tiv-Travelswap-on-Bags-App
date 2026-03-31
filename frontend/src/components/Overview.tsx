// ─── Overview Tab ──────────────────────────────────────────────
// Aggregate stats cards + health badge. Data from GET /api/stats.

import { useStats } from '../api/queries';
import { HealthBadge } from './HealthBadge';

interface StatCardProps {
  readonly label: string;
  readonly value: string | number;
  readonly unit?: string;
}

function StatCard({ label, value, unit }: StatCardProps) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-medium text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-gray-900">
        {typeof value === 'number' ? value.toLocaleString() : value}
        {unit && <span className="ml-1 text-sm font-normal text-gray-400">{unit}</span>}
      </p>
    </div>
  );
}

function StatsSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="rounded-lg border border-gray-200 bg-white p-5 animate-pulse">
          <div className="h-4 w-24 rounded bg-gray-200" />
          <div className="mt-2 h-7 w-16 rounded bg-gray-200" />
        </div>
      ))}
    </div>
  );
}

export function Overview() {
  const { data, isLoading, isError, error } = useStats();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">System Health</h2>
        <div className="mt-2 max-w-sm">
          <HealthBadge />
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-gray-900">Aggregate Stats</h2>

        {isLoading && (
          <div className="mt-4">
            <StatsSkeleton />
          </div>
        )}

        {isError && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Failed to load stats:{' '}
            {error instanceof Error ? error.message : 'Unknown error'}
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
