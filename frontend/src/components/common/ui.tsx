import { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  className?: string;
}

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={`h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600 ${className}`}
    />
  );
}

export function Card({ children, className = '' }: Props) {
  return <div className={`card ${className}`}>{children}</div>;
}

export function Alert({ kind = 'error', children }: { kind?: 'error' | 'success'; children: ReactNode }) {
  const styles =
    kind === 'error'
      ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300'
      : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300';
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`rounded-lg border px-4 py-3 text-sm ${styles}`}>
      {children}
    </div>
  );
}

export function ProgressBar({ percent }: { percent: number }) {
  const value = Math.max(0, Math.min(100, percent));
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
      role="progressbar"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${value}%` }} />
    </div>
  );
}
