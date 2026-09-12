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
          'bg-gradient-to-b from-brass-400 to-brass-500 text-pit-950 shadow-[0_1px_0_rgba(255,255,255,0.45)_inset,0_6px_16px_-8px_rgba(226,188,78,0.9)] hover:from-brass-300 hover:to-brass-400',
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
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className={cn('flex items-start justify-between gap-3 py-1.5', disabled ? 'opacity-40' : 'cursor-pointer')}>
      <span className="min-w-0">
        <span className="block text-xs text-pit-100">{label}</span>
        {hint ? <span className="block text-[10px] leading-tight text-pit-400">{hint}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
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
  options: ReadonlyArray<{ value: T; label: string; title?: string }>;
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
          aria-pressed={value === opt.value}
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
 * Panel furniture
 * ------------------------------------------------------------------ */

export function Panel({
  title,
  right,
  children,
  className,
}: {
  title?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-lg border border-white/8 bg-pit-900/70 p-3', className)}>
      {title || right ? (
        <header className="mb-2 flex items-center justify-between gap-2">
          {title ? (
            <h3
              className="text-[10px] font-semibold tracking-[0.18em] text-pit-400 uppercase"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {title}
            </h3>
          ) : (
            <span />
          )}
          {right}
        </header>
      ) : null}
      {children}
    </section>
  );
}

/** A label and a value on one line — the whole of a stats panel, repeated. */
export function Stat({
  label,
  value,
  tone,
  title,
}: {
  label: string;
  value: React.ReactNode;
  tone?: 'good' | 'bad' | 'flat';
  title?: string;
}) {
  /*
   * The explanation is spoken as well as hovered.
   *
   * `title` on a bare `<div>` is a mouse-only affordance: no tab stop, no
   * touch, nothing for a screen reader. For several of these stats the
   * tooltip is the only place the number is explained at all — which
   * denominator a measured edge divides by, what the exact figure beside it
   * is. The blackjack table spent four rounds of review finding that class of
   * defect one component at a time, so this copy of the component starts
   * where that one finished: the text stays as `title` for the hover and is
   * repeated to assistive technology.
   *
   * Not a tab stop. Adding one per stat would put a dozen stops through a
   * read-only panel between the player and the buttons they actually need.
   */
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5" title={title}>
      <span className="truncate text-[11px] text-pit-400">
        {label}
        {title ? <span className="sr-only">. {title}</span> : null}
      </span>
      <span
        className={cn(
          'font-mono text-xs tabular-nums',
          tone === 'good' && 'text-win',
          tone === 'bad' && 'text-lose',
          !tone && 'text-pit-100',
        )}
      >
        {value}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Modal
 * ------------------------------------------------------------------ */

/**
 * A dialog that closes on Escape and on a click outside it.
 *
 * Deliberately not a `<dialog>`: the native element's backdrop cannot be
 * styled through the table's blur and its top-layer promotion sits above the
 * toast stack, which is the one thing that should stay visible over a dialog.
 */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const panel = React.useRef<HTMLDivElement>(null);

  /*
   * Escape closes, Tab stays inside, and focus comes back where it started.
   *
   * Round five found this dialog with none of the three: opening it left
   * focus on the button behind it, tabbing walked straight out into the felt,
   * and closing it dropped focus on the document. On a felt whose own
   * documentation claims keyboard-only play was verified, a modal you can tab
   * out of is a modal you can lose.
   */
  React.useEffect(() => {
    if (!open) return;

    const restoreTo = document.activeElement as HTMLElement | null;
    // After the panel has mounted, so there is something to focus.
    const focusables = () =>
      Array.from(
        panel.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);

    const first = focusables()[0];
    (first ?? panel.current)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const active = document.activeElement as HTMLElement | null;
      const at = active ? items.indexOf(active) : -1;
      // Wrap at both ends, and pull focus back in if it has already escaped.
      if (e.shiftKey && (at <= 0)) {
        e.preventDefault();
        items[items.length - 1].focus();
      } else if (!e.shiftKey && (at === -1 || at === items.length - 1)) {
        e.preventDefault();
        items[0].focus();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      restoreTo?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'sweep-in flex max-h-[88vh] w-full flex-col overflow-hidden rounded-xl border border-white/10 bg-pit-900 shadow-2xl',
          wide ? 'max-w-4xl' : 'max-w-lg',
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-white/8 px-4 py-3">
          <div className="min-w-0">
            <h2
              className="text-sm font-semibold tracking-[0.14em] text-brass-300 uppercase"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {title}
            </h2>
            {subtitle ? <p className="mt-0.5 text-[11px] text-pit-400">{subtitle}</p> : null}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            ✕
          </Button>
        </header>
        <div className="thin-scroll min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Meter
 * ------------------------------------------------------------------ */

/** A horizontal bar, 0..1. Used for shoe penetration and for the edge gauge. */
export function Meter({
  value,
  tone = 'brass',
  className,
  label,
}: {
  value: number;
  tone?: 'brass' | 'win' | 'lose';
  className?: string;
  label?: string;
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-pit-800', className)}
      role="meter"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-500',
          tone === 'brass' && 'bg-brass-500',
          tone === 'win' && 'bg-win',
          tone === 'lose' && 'bg-lose',
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Number input
 * ------------------------------------------------------------------ */

/** A dollar field that edits cents and never lets a partial entry escape as NaN. */
export function MoneyInput({
  value,
  onChange,
  min = 0,
  max,
  className,
  'aria-label': ariaLabel,
}: {
  value: number;
  onChange: (cents: number) => void;
  min?: number;
  max?: number;
  className?: string;
  'aria-label'?: string;
}) {
  /*
   * The field holds text while it is being typed — "1", "1.", "1.2" are all
   * states a number passes through and none of them round-trip through cents.
   * When the prop changes underneath (a preset was applied, a clamp fired),
   * the text has to follow it. Tracking the previous prop and adjusting during
   * render is React's own answer to that; an effect would render twice and
   * briefly show the stale value.
   */
  const [text, setText] = React.useState(String(value / 100));
  const [lastValue, setLastValue] = React.useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setText(String(value / 100));
  }

  return (
    <div className={cn('flex items-center gap-1 rounded-md border border-white/10 bg-pit-850 px-2', className)}>
      <span className="text-[11px] text-pit-400">$</span>
      <input
        type="number"
        inputMode="decimal"
        aria-label={ariaLabel}
        value={text}
        min={min / 100}
        max={max === undefined ? undefined : max / 100}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const parsed = Number.parseFloat(text);
          if (Number.isNaN(parsed)) {
            setText(String(value / 100));
            return;
          }
          const cents = Math.round(parsed * 100);
          const clamped = Math.max(min, max === undefined ? cents : Math.min(max, cents));
          onChange(clamped);
          setText(String(clamped / 100));
        }}
        className="w-full bg-transparent py-1 font-mono text-xs tabular-nums text-pit-100 outline-none"
      />
    </div>
  );
}
