// ─── Status Badge ───────────────────────────────────────────────
// Generic dark-themed status badge. Accepts a status→color mapping.

/** Pre-defined dark-theme badge color sets */
export const BADGE_COLORS = {
  // Greens
  success: 'bg-green-900/50 text-green-300',
  enabled: 'bg-green-900/50 text-green-300',
  complete: 'bg-green-900/50 text-green-300',
  // Blues
  info: 'bg-blue-900/50 text-blue-300',
  running: 'bg-blue-900/50 text-blue-300',
  delivered: 'bg-blue-900/50 text-blue-300',
  // Yellows
  warning: 'bg-yellow-900/50 text-yellow-300',
  pending: 'bg-yellow-900/50 text-yellow-300',
  // Reds
  danger: 'bg-red-900/50 text-red-300',
  failed: 'bg-red-900/50 text-red-300',
  expired: 'bg-red-900/50 text-red-300',
  // Neutrals
  neutral: 'bg-slate-700 text-slate-300',
  disabled: 'bg-slate-700 text-slate-400',
  // Emerald
  redeemed: 'bg-emerald-900/50 text-emerald-300',
} as const;

interface StatusBadgeProps {
  /** Display text for the badge */
  readonly label: string;
  /** Tailwind classes for bg + text color */
  readonly colorClass: string;
  readonly className?: string;
}

export function StatusBadge({ label, colorClass, className = '' }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${colorClass} ${className}`}
    >
      {label}
    </span>
  );
}
