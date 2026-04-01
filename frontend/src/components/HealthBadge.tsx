// ─── Health Badge ───────────────────────────────────────────────
// Shows live readiness status from GET /health/ready.

import { useHealthReady } from '../api/queries';
import { SkeletonLoader, ErrorAlert } from './shared';

export function HealthBadge() {
  const { data, isLoading, isError, error } = useHealthReady();

  if (isLoading) {
    return <SkeletonLoader rows={1} />;
  }

  if (isError) {
    return (
      <div className="rounded-lg border border-red-800 bg-red-900/30 p-4">
        <div className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded-full bg-red-500" />
          <span className="text-sm font-medium text-red-300">Unreachable</span>
        </div>
        <p className="mt-2 text-xs text-red-400">
          {error instanceof Error ? error.message : 'Could not reach health endpoint'}
        </p>
      </div>
    );
  }

  const isReady = data?.status === 'ready';
  const checks = data?.checks ?? {};

  return (
    <div
      className={`rounded-lg border p-4 ${
        isReady
          ? 'border-green-800 bg-green-900/30'
          : 'border-red-800 bg-red-900/30'
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`inline-block h-3 w-3 rounded-full ${
            isReady ? 'bg-green-500' : 'bg-red-500'
          }`}
        />
        <span
          className={`text-sm font-medium ${
            isReady ? 'text-green-300' : 'text-red-300'
          }`}
        >
          {isReady ? 'Healthy' : 'Unhealthy'}
        </span>
      </div>

      {Object.keys(checks).length > 0 && (
        <ul className="mt-3 space-y-1">
          {Object.entries(checks).map(([name, check]) => (
            <li key={name} className="flex items-center gap-2 text-xs">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  check.status === 'ok' ? 'bg-green-400' : 'bg-red-400'
                }`}
              />
              <span className="text-muted-strong">{name}</span>
              {check.error && (
                <span className="text-red-400 truncate max-w-[200px]">
                  — {check.error}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
