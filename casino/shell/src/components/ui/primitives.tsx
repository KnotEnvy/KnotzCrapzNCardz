'use client';

/**
 * The concourse's parts.
 *
 * Small, unopinionated, and shared by every screen in the shell. Each game has
 * its own set of these in its own room's colours; these are the corridor's, and
 * the one thing they all agree on is that the accent is a CSS variable rather
 * than a prop threaded through the tree — which is what lets a game's tile, its
 * frame chrome and its cashier all light up in that game's colour by setting
 * `--accent` once on a wrapper.
 */

import * as React from 'react';
import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...parts: Array<string | false | null | undefined>): string {
  return twMerge(clsx(parts));
}

/**
 * Sets the accent for a subtree.
 *
 * Both variables, always, even when a caller only has one colour: a panel's
 * gradient edge reads `--accent-alt`, and inheriting the previous subtree's
 * would tint a tile with the colour of whichever one happened to render above
 * it.
 */
export function Accent({
  color,
  alt,
  className,
  children,
  as: Tag = 'div',
}: {
  color: string;
  alt?: string;
  className?: string;
  children: React.ReactNode;
  as?: 'div' | 'span' | 'section' | 'article' | 'header' | 'aside';
}): React.JSX.Element {
  return (
    <Tag
      className={className}
      style={{ ['--accent' as string]: color, ['--accent-alt' as string]: alt ?? color }}
    >
      {children}
    </Tag>
  );
}

/* ------------------------------------------------------------------ *
 * Buttons
 * ------------------------------------------------------------------ */

type ButtonTone = 'primary' | 'ghost' | 'danger' | 'quiet';

const TONE: Record<ButtonTone, string> = {
  /*
   * The one button per screen that is the point of the screen. The fill is the
   * accent at low alpha with a lit edge, rather than a solid accent, because a
   * solid neon fill on black is unreadable at any weight below bold and this
   * has to hold a sentence.
   */
  primary:
    'text-void-100 bg-[color-mix(in_oklab,var(--accent)_22%,transparent)] ' +
    'ring-1 ring-[color-mix(in_oklab,var(--accent)_60%,transparent)] ' +
    'hover:bg-[color-mix(in_oklab,var(--accent)_34%,transparent)] ' +
    'shadow-[0_0_1.5rem_-0.4rem_color-mix(in_oklab,var(--accent)_60%,transparent)]',
  ghost:
    'text-void-200 bg-white/[0.03] ring-1 ring-white/10 hover:bg-white/[0.07] hover:text-void-100',
  danger:
    'text-neon-red bg-neon-red/10 ring-1 ring-neon-red/40 hover:bg-neon-red/20',
  quiet: 'text-void-300 hover:text-void-100',
};

export function Button({
  tone = 'ghost',
  size = 'md',
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: ButtonTone;
  size?: 'sm' | 'md' | 'lg';
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-semibold',
        'transition-[background-color,color,box-shadow,transform] duration-150',
        'active:translate-y-px disabled:pointer-events-none disabled:opacity-40',
        'focus-visible:ring-2 focus-visible:ring-neon-cyan focus-visible:ring-offset-2 focus-visible:ring-offset-void-950 focus-visible:outline-none',
        size === 'sm' && 'px-3 py-1.5 text-xs',
        size === 'md' && 'px-4 py-2 text-sm',
        size === 'lg' && 'display px-6 py-3 text-sm tracking-[0.12em]',
        TONE[tone],
        className,
      )}
      {...rest}
    />
  );
}

/* ------------------------------------------------------------------ *
 * Panels and labels
 * ------------------------------------------------------------------ */

export function Panel({
  className,
  children,
  live,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { live?: boolean }): React.JSX.Element {
  return (
    <div className={cn('glass', live && 'glass-live', className)} {...rest}>
      {children}
    </div>
  );
}

/** A section heading with the lit rule under it. */
export function Heading({
  children,
  right,
  className,
}: {
  children: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <div className={cn('mb-3', className)}>
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="display text-xs tracking-[0.24em] text-void-300">{children}</h2>
        {right}
      </div>
      <div className="rule mt-2" />
    </div>
  );
}

/** A small capsule of metadata. Reads as printed on the glass. */
export function Tag({
  children,
  className,
  tone = 'plain',
}: {
  children: React.ReactNode;
  className?: string;
  tone?: 'plain' | 'accent' | 'gold' | 'win' | 'lose';
}): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[0.65rem] font-semibold tracking-wider uppercase',
        tone === 'plain' && 'bg-white/5 text-void-300 ring-1 ring-white/10',
        tone === 'accent' &&
          'bg-[color-mix(in_oklab,var(--accent)_16%,transparent)] text-[var(--accent)] ring-1 ring-[color-mix(in_oklab,var(--accent)_40%,transparent)]',
        tone === 'gold' && 'bg-neon-gold/12 text-neon-gold ring-1 ring-neon-gold/35',
        tone === 'win' && 'bg-neon-lime/12 text-neon-lime ring-1 ring-neon-lime/35',
        tone === 'lose' && 'bg-neon-red/12 text-neon-red ring-1 ring-neon-red/35',
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Dialogs
 * ------------------------------------------------------------------ */

/**
 * A modal, on the platform's own `<dialog>`.
 *
 * `showModal()` is what gives this focus trapping, the inert backdrop, the
 * Escape key and the top layer for free — all four of which a hand-rolled
 * overlay has to re-implement and usually re-implements wrong. The only thing
 * it does not give us is a click on the backdrop closing it, which is the one
 * listener below.
 *
 * The dialog also has to be *above the game frame*, and the top layer is the
 * only thing that reliably is: an iframe running a game with its own stacking
 * contexts will eventually out-paint any z-index a sibling picks.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}): React.JSX.Element {
  const ref = React.useRef<HTMLDialogElement>(null);

  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      // `cancel` is Escape. Without this the platform closes the element and
      // React still thinks it is open, so it can never be opened again.
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // The backdrop is the dialog element itself; anything inside is a child.
        if (event.target === ref.current) onClose();
      }}
      className={cn(
        'glass m-auto w-[min(94vw,32rem)] p-0 text-void-100 backdrop:bg-void-950/80 backdrop:backdrop-blur-sm',
        wide && 'w-[min(94vw,46rem)]',
      )}
    >
      <div className="flex items-center justify-between gap-4 border-b border-white/8 px-5 py-4">
        <h3 className="display text-sm tracking-[0.18em] text-void-100">{title}</h3>
        <Button tone="quiet" size="sm" onClick={onClose} aria-label="Close">
          ✕
        </Button>
      </div>
      <div className="px-5 py-5">{children}</div>
    </dialog>
  );
}

/* ------------------------------------------------------------------ *
 * Figures
 * ------------------------------------------------------------------ */

/**
 * A number that counts to its new value instead of jumping.
 *
 * This is the single most important animation in the shell, and it is worth
 * saying why: the wallet is the thing the whole casino is about, and a wallet
 * that snaps from one figure to another reads as a page re-rendering, while a
 * wallet that *climbs* reads as winning. The eye follows the movement and the
 * player feels the amount.
 *
 * It is `requestAnimationFrame` over a fixed duration with an ease-out, not a
 * CSS transition, because there is no CSS property whose interpolation you can
 * read back out as text. The frame loop is cancelled on every change, so a
 * rapid series of wins chases the latest figure rather than queueing.
 */
export function Counter({
  value,
  format,
  className,
  durationMs = 620,
}: {
  value: number;
  format: (n: number) => string;
  className?: string;
  durationMs?: number;
}): React.JSX.Element {
  const [shown, setShown] = React.useState(value);
  const from = React.useRef(value);
  const frame = React.useRef<number | null>(null);

  React.useEffect(() => {
    // Respect the system setting: no tween, just the truth.
    const still =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (still || from.current === value) {
      from.current = value;
      setShown(value);
      return;
    }

    const start = performance.now();
    const origin = from.current;
    const span = value - origin;

    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // Cubic ease-out: fast enough to feel immediate, slow enough at the end
      // that the final digits are readable as they land.
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(origin + span * eased));
      if (t < 1) frame.current = requestAnimationFrame(step);
      else from.current = value;
    };

    frame.current = requestAnimationFrame(step);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      // Whatever was on screen is where the next tween starts, so an
      // interrupted count does not jump backwards before climbing again.
      from.current = shown;
    };
    // `shown` is deliberately not a dependency: it changes every frame, and
    // depending on it would restart the animation sixty times a second.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, durationMs]);

  return <span className={cn('figure', className)}>{format(shown)}</span>;
}

/* ------------------------------------------------------------------ *
 * A chip
 * ------------------------------------------------------------------ */

const CHIP_VAR: Array<{ at: number; css: string }> = [
  { at: 500_000, css: 'var(--chip-5000)' },
  { at: 100_000, css: 'var(--chip-1000)' },
  { at: 50_000, css: 'var(--chip-500)' },
  { at: 10_000, css: 'var(--chip-100)' },
  { at: 2_500, css: 'var(--chip-25)' },
  { at: 500, css: 'var(--chip-5)' },
  { at: 0, css: 'var(--chip-1)' },
];

/** The colour a casino would give a chip of this size. */
export function chipColor(cents: number): string {
  return (CHIP_VAR.find((c) => cents >= c.at) ?? CHIP_VAR[CHIP_VAR.length - 1]).css;
}

/**
 * A chip, drawn rather than imported.
 *
 * Three CSS layers — the body, the edge spots as a repeating conic gradient,
 * and the inset ring — which is the whole thing in about fifteen lines and
 * scales to any size without an asset. The card tables draw theirs the same
 * way, which is why a $25 chip in the cashier looks like a $25 chip on a felt.
 */
export function Chip({
  cents,
  label,
  size = 44,
  className,
}: {
  cents: number;
  label: string;
  size?: number;
  className?: string;
}): React.JSX.Element {
  const color = chipColor(cents);
  return (
    <span
      className={cn('relative inline-grid shrink-0 place-items-center rounded-full', className)}
      style={{
        width: size,
        height: size,
        background: `
          repeating-conic-gradient(from 0deg, rgba(255,255,255,0.85) 0deg 9deg, transparent 9deg 45deg),
          radial-gradient(circle at 50% 35%, color-mix(in oklab, ${color} 88%, white), ${color} 70%)`,
        boxShadow: `inset 0 0 0 ${Math.max(2, size * 0.1)}px ${color}, 0 0.35rem 0.9rem rgba(0,0,0,0.5)`,
      }}
    >
      <span
        className="absolute inset-[18%] grid place-items-center rounded-full"
        style={{ background: `color-mix(in oklab, ${color} 92%, black)` }}
      >
        <span
          className="figure font-bold text-white/95"
          style={{ fontSize: Math.max(8, size * 0.24) }}
        >
          {label}
        </span>
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Loading
 * ------------------------------------------------------------------ */

/** A placeholder with the right shape, so the layout does not jump. */
export function Skeleton({ className }: { className?: string }): React.JSX.Element {
  return (
    <div
      className={cn('animate-pulse rounded-lg bg-white/[0.05] ring-1 ring-white/[0.04]', className)}
    />
  );
}

/* ------------------------------------------------------------------ *
 * The clock
 * ------------------------------------------------------------------ */

/**
 * The current time, as state rather than as a call during render.
 *
 * `Date.now()` in a render body is impure: two renders of the same props can
 * produce different output, which is exactly what React's compiler refuses and
 * is right to. A countdown is a legitimate need, so the clock becomes state and
 * an interval advances it.
 *
 * The default tick is half a minute because everything on this floor that shows
 * a relative time shows it in minutes. Nothing here is worth a render a second.
 */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}
