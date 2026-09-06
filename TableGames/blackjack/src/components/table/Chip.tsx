'use client';

/**
 * Chips.
 *
 * A denomination is a colour before it is a number — that is the whole design
 * of a casino chip, and it is why the rack works at a glance. The set here is
 * the standard American one: white dollar, red five, green twenty-five, black
 * hundred, purple five hundred, gold thousand.
 *
 * A stack is drawn as overlapping discs rather than one disc with a count on
 * it, because the height of a stack is information a player reads without
 * looking. Above five chips it stops growing and the total takes over, since
 * nobody counts a stack of forty either.
 */

import * as React from 'react';
import { cn } from '@/components/ui/primitives';
import { fmt } from '@/lib/engine/money';

export interface Denomination {
  cents: number;
  label: string;
  face: string;
  edge: string;
}

/** In cents, smallest first. The rack renders them in this order. */
export const DENOMINATIONS: readonly Denomination[] = [
  { cents: 100, label: '1', face: 'var(--chip-1)', edge: 'var(--chip-1-edge)' },
  { cents: 500, label: '5', face: 'var(--chip-5)', edge: 'var(--chip-5-edge)' },
  { cents: 2500, label: '25', face: 'var(--chip-25)', edge: 'var(--chip-25-edge)' },
  { cents: 10_000, label: '100', face: 'var(--chip-100)', edge: 'var(--chip-100-edge)' },
  { cents: 50_000, label: '500', face: 'var(--chip-500)', edge: 'var(--chip-500-edge)' },
  { cents: 100_000, label: '1K', face: 'var(--chip-1000)', edge: 'var(--chip-1000-edge)' },
];

export function denominationFor(cents: number): Denomination {
  // The largest chip that does not exceed the amount, so $60 shows as a
  // twenty-five and not as sixty dollar chips.
  let best = DENOMINATIONS[0];
  for (const d of DENOMINATIONS) if (d.cents <= cents) best = d;
  return best;
}

/**
 * Break an amount into the chips a dealer would actually stack it as: largest
 * first, capped so a big bet is a short stack of big chips rather than a tower.
 */
export function chipBreakdown(cents: number, maxChips = 5): Denomination[] {
  const out: Denomination[] = [];
  let left = cents;
  for (let i = DENOMINATIONS.length - 1; i >= 0 && out.length < maxChips; i--) {
    const d = DENOMINATIONS[i];
    while (left >= d.cents && out.length < maxChips) {
      out.push(d);
      left -= d.cents;
    }
  }
  return out;
}

export function Chip({
  denom,
  size = 34,
  selected,
  className,
  onClick,
  disabled,
  title,
}: {
  denom: Denomination;
  size?: number;
  selected?: boolean;
  className?: string;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  const body = (
    <span
      className={cn(
        'chip flex items-center justify-center font-bold',
        selected && 'ring-2 ring-brass-300 ring-offset-2 ring-offset-pit-900',
      )}
      style={
        {
          width: size,
          height: size,
          '--chip-face': denom.face,
          '--chip-edge': denom.edge,
          fontSize: size * 0.3,
          color: denom.cents === 10_000 ? '#e7eaf0' : denom.cents === 100 ? '#16181d' : '#fff',
          fontFamily: 'var(--font-display)',
        } as React.CSSProperties
      }
    >
      {denom.label}
    </span>
  );

  if (!onClick) return <span className={className}>{body}</span>;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ?? fmt(denom.cents)}
      aria-label={`${fmt(denom.cents)} chip`}
      aria-pressed={selected}
      className={cn(
        'transition-transform hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-30 disabled:hover:translate-y-0',
        className,
      )}
    >
      {body}
    </button>
  );
}

/** A wager, drawn as the stack it would be. */
export function ChipStack({
  cents,
  size = 28,
  className,
}: {
  cents: number;
  size?: number;
  className?: string;
}) {
  const chips = React.useMemo(() => chipBreakdown(cents), [cents]);
  if (cents <= 0) return null;
  const lift = size * 0.16;

  return (
    <div
      className={cn('relative', className)}
      style={{ width: size, height: size + lift * (chips.length - 1) }}
      aria-label={`${fmt(cents)} wagered`}
    >
      {chips.map((d, i) => (
        <span
          key={i}
          className="absolute left-0"
          style={{ bottom: i * lift, zIndex: i }}
        >
          <Chip denom={d} size={size} />
        </span>
      ))}
    </div>
  );
}
