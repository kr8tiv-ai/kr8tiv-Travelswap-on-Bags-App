// ─── Spinner ────────────────────────────────────────────────────
// Animated SVG spinner. Uses currentColor so it adapts to any context.

interface SpinnerProps {
  /** Tailwind size class, e.g. "h-4 w-4" or "h-6 w-6". Default: "h-4 w-4" */
  readonly size?: string;
  readonly className?: string;
}

export function Spinner({ size = 'h-4 w-4', className = '' }: SpinnerProps) {
  return (
    <svg
      className={`animate-spin ${size} ${className}`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
