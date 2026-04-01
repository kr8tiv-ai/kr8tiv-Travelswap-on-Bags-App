// ─── Empty State ────────────────────────────────────────────────
// Dark-themed dashed-border empty state with optional icon and action.

import type { ReactNode } from 'react';

interface EmptyStateProps {
  /** Primary message text */
  readonly message: string;
  /** Optional icon element rendered above the message */
  readonly icon?: ReactNode;
  /** Optional action element (button/link) rendered below the message */
  readonly action?: ReactNode;
  readonly className?: string;
}

export function EmptyState({ message, icon, action, className = '' }: EmptyStateProps) {
  return (
    <div
      className={`rounded-lg border-2 border-dashed border-slate-600 p-8 text-center ${className}`}
    >
      {icon && <div className="mb-3 flex justify-center text-slate-500">{icon}</div>}
      <p className="text-sm text-slate-400">{message}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
