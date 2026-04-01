// ─── Field ──────────────────────────────────────────────────────
// Dark-themed form field wrapper with label and error display.

import type { ReactNode } from 'react';

interface FieldProps {
  readonly label: string;
  readonly error?: string;
  readonly children: ReactNode;
}

export function Field({ label: labelText, error, children }: FieldProps) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-300 mb-1">
        {labelText}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  );
}
