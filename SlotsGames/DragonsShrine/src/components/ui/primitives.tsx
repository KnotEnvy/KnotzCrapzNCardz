'use client';

/**
 * The cabinet's vocabulary.
 *
 * Everything the chrome is built from lives here: the buttons, the switches,
 * the dialog shell, the little carved plates that hold a number. The rule is
 * the same one a real cabinet follows -- there are about eight physical
 * affordances on the whole machine, and every one of them is recognisably the
 * same object wherever it appears. A settings toggle and a turbo toggle are
 * the same switch; the paytable dialog and the buy-feature dialog are the same
 * pane of glass in the same frame.
 *
 * Nothing in this file knows the game exists. It takes props and draws.
 */

import { cva, type VariantProps } from 'class-variance-authority';
import { clsx, type ClassValue } from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import * as React from 'react';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/* ------------------------------------------------------------------ *
 * Keyframes
 *
 * A handful of effects -- a gilt sweep across a jackpot plate, the slow
 * breath under an idle ladder -- are gradient animations that no amount of
 * spring physics reproduces, and the stylesheets belong to other people's
 * lanes. So they ship as a <style> element that every top-level piece of
 * chrome renders. Duplicated identical rules cost nothing; a component that
 * silently loses its animation because someone forgot an import costs a lot.
 *
 * Everything in here is decorative and carries `fx-decorative`, which
 * globals.css switches off wholesale under `prefers-reduced-motion`.
 * ------------------------------------------------------------------ */

const FX_CSS = `
@keyframes ds-sweep { 0% { background-position: -160% 0; } 100% { background-position: 260% 0; } }
@keyframes ds-breathe { 0%,100% { opacity: .55; } 50% { opacity: 1; } }
@keyframes ds-emberfloat { 0% { transform: translateY(0) scale(1); opacity: 0; }
  15% { opacity: .9; } 100% { transform: translateY(-120px) scale(.4); opacity: 0; } }
@keyframes ds-flicker { 0%,100% { opacity: 1; } 42% { opacity: .82; } 61% { opacity: .96; } 74% { opacity: .78; } }
@keyframes ds-ringpulse { 0% { transform: scale(.92); opacity: .8; } 100% { transform: scale(1.5); opacity: 0; } }
.ds-sweep { background-size: 220% 100%; animation: ds-sweep 3.4s linear infinite; }
.ds-breathe { animation: ds-breathe 2.6s ease-in-out infinite; }
.ds-flicker { animation: ds-flicker 4.2s ease-in-out infinite; }
.ds-ringpulse { animation: ds-ringpulse 1.5s ease-out infinite; }
`;

/** Renders the decorative keyframes. Safe to render more than once. */
export function FxStyles() {
  return <style>{FX_CSS}</style>;
}

/* ------------------------------------------------------------------ *
 * Button
 *
 * `gilt` is the cabinet's own button -- gold leaf over lacquer, with a lit
 * top edge and a shadow that reads as depth rather than as a drop shadow.
 * `deck` is the smaller sibling that runs along the control rail.
 * ------------------------------------------------------------------ */

const button = cva(
  'no-select inline-flex items-center justify-center gap-1.5 rounded-md font-semibold tracking-wide transition-all duration-100 disabled:pointer-events-none disabled:opacity-30 active:translate-y-px',
  {
    variants: {
      variant: {
        gilt: 'bg-gradient-to-b from-gold-300 to-gold-600 text-ink-950 shadow-[0_1px_0_rgba(255,255,255,0.55)_inset,0_-2px_6px_rgba(0,0,0,0.35)_inset,0_8px_20px_-10px_rgba(224,179,58,0.9)] hover:from-gold-200 hover:to-gold-500',
        deck: 'border border-gold-700/30 bg-gradient-to-b from-ink-700 to-ink-850 text-ink-100 shadow-[0_1px_0_rgba(255,255,255,0.07)_inset] hover:border-gold-600/50 hover:from-ink-600 hover:to-ink-800',
        ghost: 'text-ink-300 hover:bg-white/5 hover:text-ink-100',
        jade: 'bg-gradient-to-b from-jade-500 to-jade-700 text-ink-950 shadow-[0_1px_0_rgba(255,255,255,0.35)_inset] hover:from-jade-400 hover:to-jade-600',
        cinnabar:
          'bg-gradient-to-b from-cinnabar-500 to-cinnabar-800 text-ink-100 shadow-[0_1px_0_rgba(255,255,255,0.25)_inset] hover:from-cinnabar-400 hover:to-cinnabar-700',
        violet:
          'bg-gradient-to-b from-violet-500 to-violet-800 text-ink-100 shadow-[0_1px_0_rgba(255,255,255,0.25)_inset] hover:from-violet-400 hover:to-violet-700',
      },
      size: {
        xs: 'h-6 px-2 text-[10px]',
        sm: 'h-8 px-2.5 text-[11px]',
        md: 'h-10 px-3.5 text-xs',
        lg: 'h-12 px-5 text-sm',
      },
    },
    defaultVariants: { variant: 'deck', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {}

export function Button({ className, variant, size, type, ...props }: ButtonProps) {
  return (
    <button type={type ?? 'button'} className={cn(button({ variant, size }), className)} {...props} />
  );
}

/**
 * A button whose whole content is a glyph.
 *
 * `label` is mandatory rather than optional, which is the only reliable way to
 * keep a rail of eight icons from shipping with three of them unnamed.
 */
export function IconButton({
  label,
  active,
  className,
  children,
  ...props
}: Omit<ButtonProps, 'aria-label'> & { label: string; active?: boolean }) {
  return (
    <Button
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={cn(
        'aspect-square px-0',
        active && 'border-gold-500/70 text-gold-300 shadow-[0_0_14px_-4px_var(--color-gold-500)]',
        className,
      )}
      {...props}
    >
      {children}
    </Button>
  );
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
    <div className={cn('flex items-start justify-between gap-3 py-1.5', disabled && 'opacity-40')}>
      <span className="min-w-0">
        <span className="block text-xs text-ink-100">{label}</span>
        {hint ? <span className="block text-[10px] leading-tight text-ink-400">{hint}</span> : null}
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
          checked ? 'border-gold-500/60 bg-gold-500/80' : 'border-white/10 bg-ink-700',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-[18px]' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
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
  ariaLabel,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: React.ReactNode; title?: string }>;
  onChange: (v: T) => void;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    /* `group` with pressed buttons rather than a tablist: these switch a
       section in place and nothing here implements a tablist's arrow-key
       contract, so promising one would be a lie a screen reader acts on. */
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn('inline-flex rounded-md border border-white/10 bg-ink-900 p-0.5', className)}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          aria-pressed={value === opt.value}
          title={opt.title}
          onClick={() => onChange(opt.value)}
          className={cn(
            'rounded px-2.5 py-1 text-[11px] font-semibold tracking-wide transition-colors',
            value === opt.value
              ? 'bg-gold-500 text-ink-950'
              : 'text-ink-300 hover:bg-white/5 hover:text-ink-100',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Slider
 *
 * Used for the stake rail, where the ladder is eight discrete rungs rather
 * than a continuum -- so the input steps by index and the caller does the
 * lookup. Native range, because a hand-rolled one loses arrow keys, Home and
 * End, and the platform's own touch target.
 * ------------------------------------------------------------------ */

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  label,
  valueLabel,
  disabled,
  className,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (n: number) => void;
  label: string;
  valueLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1 flex items-baseline justify-between">
        <span className="text-[10px] font-semibold tracking-[0.18em] text-ink-400 uppercase">
          {label}
        </span>
        {valueLabel ? <span className="numeric text-[11px] text-gold-300">{valueLabel}</span> : null}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={label}
        aria-valuetext={valueLabel}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-ink-700 accent-[var(--color-gold-500)] disabled:opacity-40"
      />
    </label>
  );
}

/* ------------------------------------------------------------------ *
 * Tooltip
 *
 * Hover and focus both, because half the cabinet is reachable only by
 * keyboard and a tip that appears for the mouse alone is decoration.
 * ------------------------------------------------------------------ */

export function Tooltip({
  text,
  children,
  side = 'top',
  className,
}: {
  text: string;
  children: React.ReactNode;
  side?: 'top' | 'bottom';
  className?: string;
}) {
  return (
    <span className={cn('group relative inline-flex', className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none absolute left-1/2 z-50 w-max max-w-[14rem] -translate-x-1/2 rounded-md border border-gold-700/40 bg-ink-950/95 px-2 py-1 text-[10px] leading-snug text-ink-200 opacity-0 shadow-lg transition-opacity duration-100',
          'group-hover:opacity-100 group-focus-within:opacity-100',
          side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
        )}
      >
        {text}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Plates
 *
 * The carved surfaces the chrome is mounted on: a Panel for anything with a
 * header, a Plate for a single labelled figure -- the CREDIT window, a
 * jackpot rung, the per-line readout.
 * ------------------------------------------------------------------ */

export function Panel({
  title,
  action,
  className,
  bodyClassName,
  children,
}: {
  title?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        'flex min-h-0 flex-col overflow-hidden rounded-lg border border-gold-800/40 bg-ink-900/90 shadow-[0_1px_0_rgba(255,255,255,0.05)_inset,0_18px_40px_-24px_rgba(0,0,0,0.9)] backdrop-blur-sm',
        className,
      )}
    >
      {title ? (
        <header className="flex items-center justify-between gap-2 border-b border-gold-800/30 bg-gradient-to-b from-white/[0.05] to-transparent px-3 py-2">
          <h2 className="display text-xs font-bold tracking-[0.2em] text-gold-300 uppercase">
            {title}
          </h2>
          {action}
        </header>
      ) : null}
      <div className={cn('min-h-0 flex-1 p-3', bodyClassName)}>{children}</div>
    </section>
  );
}

/** The small caps label above every figure on the machine. */
export function PlateLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'block text-[9px] leading-none font-bold tracking-[0.22em] text-ink-400 uppercase',
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A cabinet meter window: recessed, dark, one number behind glass. */
export function Plate({
  label,
  value,
  tone = 'neutral',
  live,
  className,
  valueClassName,
  sub,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  tone?: 'neutral' | 'gold' | 'jade' | 'ember';
  /** `polite` puts the figure in a live region -- use it where a change matters. */
  live?: 'off' | 'polite';
  className?: string;
  valueClassName?: string;
  sub?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'min-w-0 rounded-md border border-gold-800/40 bg-ink-950/80 px-2.5 py-1.5 shadow-[0_2px_10px_rgba(0,0,0,0.6)_inset]',
        className,
      )}
    >
      <PlateLabel>{label}</PlateLabel>
      <div
        aria-live={live ?? 'off'}
        className={cn(
          'numeric mt-1 truncate leading-none font-bold',
          tone === 'gold' && 'text-gold-300',
          tone === 'jade' && 'text-jade-300',
          tone === 'ember' && 'text-ember-300',
          tone === 'neutral' && 'text-ink-100',
          valueClassName ?? 'text-base sm:text-lg',
        )}
      >
        {value}
      </div>
      {sub ? <div className="numeric mt-0.5 truncate text-[9px] text-ink-500">{sub}</div> : null}
    </div>
  );
}

/** A short pill: a tier name, a jackpot name, an AUTO flag. */
export function Badge({
  children,
  className,
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      style={style}
      className={cn(
        'inline-flex shrink-0 items-center rounded-sm px-1.5 py-px text-[9px] font-bold tracking-[0.16em] uppercase',
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Dialog
 *
 * Hand-rolled, thirty lines, and it does the three things a dialog has to do:
 * it traps Tab, it closes on Escape, and it puts focus back where it found it.
 * ------------------------------------------------------------------ */

export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  width = 'max-w-2xl',
  reducedMotion = false,
  bodyClassName = 'max-h-[68dvh] overflow-y-auto overscroll-contain p-3 sm:p-4',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: string;
  reducedMotion?: boolean;
  bodyClassName?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const restoreTo = React.useRef<HTMLElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    restoreTo.current = document.activeElement as HTMLElement | null;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !ref.current) return;
      const focusable = ref.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey, true);
    ref.current?.querySelector<HTMLElement>('button, input, select, textarea')?.focus();
    const restore = restoreTo.current;
    return () => {
      document.removeEventListener('keydown', onKey, true);
      restore?.focus?.();
    };
  }, [open, onClose]);

  const motionProps = reducedMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { scale: 0.96, y: 14, opacity: 0 },
        animate: { scale: 1, y: 0, opacity: 1 },
        exit: { scale: 0.97, y: 8, opacity: 0 },
        transition: { type: 'spring' as const, stiffness: 380, damping: 30 },
      };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div
            className="absolute inset-0 bg-black/75 backdrop-blur-sm"
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={cn('relative flex max-h-[92dvh] w-full flex-col', width)}
            {...motionProps}
          >
            <Panel
              className="max-h-[92dvh]"
              title={title}
              action={
                <Button size="xs" variant="ghost" onClick={onClose} aria-label="Close">
                  ESC
                </Button>
              }
              bodyClassName={bodyClassName}
            >
              {children}
            </Panel>
            {footer ? (
              <div className="mt-2 flex flex-wrap justify-end gap-2">{footer}</div>
            ) : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
