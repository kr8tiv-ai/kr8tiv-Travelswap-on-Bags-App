// ─── Health Badge ───────────────────────────────────────────────
// Shows live readiness status from GET /health/ready.

import { useHealthReady } from '../api/queries';

export function HealthBadge() {
  const { data, isLoading, isError, error } = useHealthReady();

  if (isLoading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4 animate-pulse">
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full bg-gray-200" />
          <div className="h-4 w-24 rounded bg-gray-200" />
        </div>
        <div className="mt-3 space-y-2">
          <div className="h-3 w-32 rounded bg-gray-100" />
          <div className="h-3 w-28 rounded bg-gray-100" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <div className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 rounded-full bg-red-500" />
          <span className="text-sm font-medium text-red-700">Unreachable</span>
        </div>
        <p className="mt-2 text-xs text-red-600">
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
          ? 'border-green-200 bg-green-50'
          : 'border-red-200 bg-red-50'
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
            isReady ? 'text-green-700' : 'text-red-700'
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
              <span className="text-gray-600">{name}</span>
              {check.error && (
                <span className="text-red-500 truncate max-w-[200px]">
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
