// ─── Error Alert ────────────────────────────────────────────────
// Dark-themed error display with red accent.

import type { ReactNode } from 'react';

interface ErrorAlertProps {
  readonly children: ReactNode;
  readonly className?: string;
}

export function ErrorAlert({ children, className = '' }: ErrorAlertProps) {
  return (
    <div
      className={`rounded-lg border border-red-800 bg-red-900/30 p-4 text-sm text-red-200 ${className}`}
      role="alert"
    >
      {children}
    </div>
  );
}
