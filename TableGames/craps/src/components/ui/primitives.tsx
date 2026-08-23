'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { clsx, type ClassValue } from 'clsx';
import * as React from 'react';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/* ------------------------------------------------------------------ *
 * Button
 * ------------------------------------------------------------------ */

const button = cva(
  'inline-flex items-center justify-center gap-1.5 rounded-md font-medium tracking-wide transition-all duration-100 select-none disabled:pointer-events-none disabled:opacity-35 active:translate-y-px',
  {
    variants: {
      variant: {
        primary:
          'bg-gradient-to-b from-brass-400 to-brass-500 text-pit-950 shadow-[0_1px_0_rgba(255,255,255,0.45)_inset,0_6px_16px_-8px_rgba(212,175,55,0.9)] hover:from-brass-300 hover:to-brass-400',
        secondary:
          'bg-pit-800 text-pit-100 border border-white/10 hover:bg-pit-700 hover:border-white/20',
        ghost: 'text-pit-300 hover:text-pit-100 hover:bg-white/5',
        danger: 'bg-red-900/70 text-red-100 border border-red-500/30 hover:bg-red-800/80',
      },
      size: {
        sm: 'h-7 px-2.5 text-[11px]',
        md: 'h-9 px-3.5 text-xs',
        lg: 'h-11 px-5 text-sm',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(button({ variant, size }), className)} {...props} />;
}

/* ------------------------------------------------------------------ *
 * Toggle
 * ------------------------------------------------------------------ */

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3 py-1.5">
      <span className="min-w-0">
        <span className="block text-xs text-pit-100">{label}</span>
        {hint ? <span className="block text-[10px] leading-tight text-pit-400">{hint}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors',
          checked ? 'border-brass-500/60 bg-brass-500/80' : 'border-white/10 bg-pit-700',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-[18px]' : 'translate-x-0.5',
          )}
        />
      </button>
    </label>
  );
}

/* ------------------------------------------------------------------ *
 * Segmented control
 * ------------------------------------------------------------------ */

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: Array<{ value: T; label: string; title?: string }>;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={cn('inline-flex rounded-md border border-white/10 bg-pit-850 p-0.5', className)}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          title={opt.title}
          onClick={() => onChange(opt.value)}
          className={cn(
            'rounded px-2.5 py-1 text-[11px] font-medium tracking-wide transition-colors',
            value === opt.value
              ? 'bg-brass-500 text-pit-950'
              : 'text-pit-300 hover:bg-white/5 hover:text-pit-100',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Panel
 * ------------------------------------------------------------------ */

export function Panel({
  title,
  action,
  className,
  bodyClassName,
  children,
}: {
  title?: string;
  action?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn('panel flex min-h-0 flex-col', className)}>
      {title ? (
        <header className="flex items-center justify-between border-b border-white/[0.06] px-3 py-2">
          <h2 className="stat-label">{title}</h2>
          {action}
        </header>
      ) : null}
      <div className={cn('min-h-0 flex-1 p-3', bodyClassName)}>{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Stat
 * ------------------------------------------------------------------ */

export function Stat({
  label,
  value,
  tone = 'neutral',
  sub,
}: {
  label: string;
  value: React.ReactNode;
  tone?: 'neutral' | 'up' | 'down';
  sub?: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="stat-label truncate">{label}</div>
      <div
        className={cn(
          'tabular truncate text-sm font-semibold',
          tone === 'up' && 'text-win',
          tone === 'down' && 'text-lose',
          tone === 'neutral' && 'text-pit-100',
        )}
      >
        {value}
      </div>
      {sub ? <div className="tabular truncate text-[10px] text-pit-400">{sub}</div> : null}
    </div>
  );
}

/** Formats a dollar figure the way a rack reads. */
export function money(n: number, opts: { sign?: boolean } = {}): string {
  const rounded = Math.round(n * 100) / 100;
  const abs = Math.abs(rounded);
  const body = abs.toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(abs) ? 0 : 2,
    maximumFractionDigits: 2,
  });
  const sign = rounded < 0 ? '-' : opts.sign && rounded > 0 ? '+' : '';
  return `${sign}$${body}`;
}
