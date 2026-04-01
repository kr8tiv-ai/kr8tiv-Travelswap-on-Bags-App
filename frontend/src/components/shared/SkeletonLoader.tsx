// ─── Skeleton Loader ────────────────────────────────────────────
// Dark-themed loading placeholder with pulse animation.

interface SkeletonLoaderProps {
  /** Number of skeleton rows to render. Default: 3 */
  readonly rows?: number;
  readonly className?: string;
}

export function SkeletonLoader({ rows = 3, className = '' }: SkeletonLoaderProps) {
  return (
    <div className={`space-y-3 ${className}`}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="rounded-lg border border-slate-700 bg-surface-raised p-4 animate-pulse"
        >
          <div className="h-5 w-48 rounded bg-surface-overlay" />
          <div className="mt-2 h-4 w-64 rounded bg-slate-700" />
        </div>
      ))}
    </div>
  );
}
