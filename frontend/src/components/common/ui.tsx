import { ReactNode, useState } from 'react';
import { Star, StarFilled } from './Icon';

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
  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      className="flex items-start gap-2.5 rounded-md border border-slate-300 bg-paper-card px-4 py-3 text-sm
        text-slate-700 dark:border-white/15 dark:bg-ink-900 dark:text-slate-200"
    >
      <span
        aria-hidden="true"
        className={`mt-1.5 h-2 w-2 shrink-0 rounded-sm ${
          kind === 'error' ? 'bg-red-700' : 'bg-emerald-800'
        }`}
      />
      <span className="flex-1">{children}</span>
    </div>
  );
}

/** Loading placeholder block (skeleton), used instead of a floating spinner. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`skeleton ${className}`} />;
}

/** Skeleton for a card-shaped record: title line, meta line, progress line. */
export function SkeletonCard() {
  return (
    <div className="card space-y-3" aria-hidden="true">
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-3 w-1/3" />
      <Skeleton className="h-2 w-full" />
    </div>
  );
}

/** Skeleton rows for list/table regions. */
export function SkeletonRows({ rows = 4, className = '' }: { rows?: number; className?: string }) {
  return (
    <div className={`space-y-3 ${className}`} aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 shrink-0" />
          <Skeleton className="h-3 flex-1" />
        </div>
      ))}
    </div>
  );
}

/** Read-only star rating with the numeric average (FR-S3). */
export function RatingStars({
  value,
  count,
  size = 14,
  className = '',
}: {
  value: number;
  count?: number;
  size?: number;
  className?: string;
}) {
  const stars = Math.round(value);
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className="inline-flex" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((i) =>
          i <= stars ? (
            <StarFilled key={i} size={size} className="text-gold-500" />
          ) : (
            <Star key={i} size={size} className="text-slate-300 dark:text-slate-600" />
          ),
        )}
      </span>
      {count ? (
        <span className="text-xs text-slate-600 dark:text-slate-400">
          {value.toFixed(1)} ({count})
        </span>
      ) : null}
    </span>
  );
}

/** Interactive 1-5 star input used on the course detail page. */
export function RatingInput({
  value,
  onChange,
  disabled = false,
  label,
}: {
  value: number;
  onChange: (next: number) => void;
  disabled?: boolean;
  label: string;
}) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <span role="group" aria-label={label} className="inline-flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((i) => (
        <button
          key={i}
          type="button"
          disabled={disabled}
          aria-label={`${i}/5`}
          aria-pressed={value === i}
          onMouseEnter={() => setHover(i)}
          onMouseLeave={() => setHover(0)}
          onFocus={() => setHover(i)}
          onBlur={() => setHover(0)}
          onClick={() => onChange(i)}
          className="rounded p-0.5 transition disabled:cursor-not-allowed disabled:opacity-60"
        >
          {i <= shown ? (
            <StarFilled size={20} className="text-gold-500" />
          ) : (
            <Star size={20} className="text-slate-300 dark:text-slate-600" />
          )}
        </button>
      ))}
    </span>
  );
}

export function ProgressBar({ percent, label }: { percent: number; label: string }) {
  const value = Math.max(0, Math.min(100, percent));
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-sm bg-slate-300/70 dark:bg-white/10"
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="h-full bg-brand-700 transition-colors" style={{ width: `${value}%` }} />
    </div>
  );
}
