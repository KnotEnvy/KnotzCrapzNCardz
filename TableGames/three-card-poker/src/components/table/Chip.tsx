'use client';

/**
 * Chips.
 *
 * A denomination is a colour before it is a number — that is the whole design
 * of a casino chip, and it is why the rack works at a glance. The set here is
 * the standard American one: white dollar, red five, green twenty-five, black
 * hundred, purple five hundred, gold thousand.
 *
 * Drawn as SVG rather than as a CSS disc, and that is the whole of the change
 * from the first version. A disc with a conic gradient round its rim is a chip
 * seen from directly overhead, which is not where anybody sits: looking down a
 * table you see one inlaid face and, below it, a crescent of each chip's *side
 * wall* — the chip's own colour in shadow, interrupted by the contrasting edge
 * spots moulded through it. Drawing that crescent is most of the difference
 * between a stack of chips and a stack of circles, and it is why a stack now
 * reads as money from across the felt.
 *
 * A stack is drawn as those overlapping walls rather than as one disc with a
 * count on it, because the height of a stack is information a player reads
 * without looking. Above five chips it stops growing and the total takes over,
 * since nobody counts a stack of forty either.
 *
 * `ChipGlyph` is the primitive and is plain SVG, so the same chip is used by
 * the felt (wrapped in its own `<svg>`) and by the effects layer, where chips
 * fly. One renderer, so a chip in the air can never be a different object from
 * the chip that was sitting on the spot.
 */

import * as React from 'react';
import { cn } from '@/components/ui/primitives';
import { fmt } from '@/lib/engine/money';

export interface Denomination {
  cents: number;
  label: string;
  /** Literal colours, not custom properties: the shading below is computed. */
  face: string;
  edge: string;
  ink: string;
}

/** In cents, smallest first. The rack renders them in this order. */
export const DENOMINATIONS: readonly Denomination[] = [
  { cents: 100, label: '1', face: '#f4f4f2', edge: '#8f9aa8', ink: '#1b1f26' },
  { cents: 500, label: '5', face: '#c8102e', edge: '#f4f4f2', ink: '#fff5f5' },
  { cents: 2500, label: '25', face: '#1f8a4c', edge: '#f4f4f2', ink: '#f0fff6' },
  { cents: 10_000, label: '100', face: '#16181d', edge: '#d8d8d4', ink: '#f4f4f2' },
  { cents: 50_000, label: '500', face: '#6d28d9', edge: '#f0e6ff', ink: '#f5f0ff' },
  { cents: 100_000, label: '1K', face: '#c9a227', edge: '#3b2c06', ink: '#241610' },
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

/* ------------------------------------------------------------------ *
 * Shading
 * ------------------------------------------------------------------ */

/**
 * A colour scaled toward black.
 *
 * Derived rather than hand-authored, so a side wall can never drift out of
 * sync with the face it belongs to when someone retunes a denomination.
 */
function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * k);
  const g = Math.round(((n >> 8) & 255) * k);
  const b = Math.round((n & 255) * k);
  return `rgb(${r} ${g} ${b})`;
}

/**
 * A stable pseudo-random turn for the chip at `i` in a stack worth `seed`.
 *
 * Deterministic on purpose: a real stack has its edge spots every which way,
 * but rolling that with `Math.random` would re-shuffle every stack on the table
 * on each React render, and the felt would shimmer whenever anything else
 * changed.
 */
function spin(i: number, seed: number): number {
  const x = Math.sin((i + 1) * 12.9898 + seed * 0.017) * 43758.5453;
  return (x - Math.floor(x)) * 360;
}

/* ------------------------------------------------------------------ *
 * The parts of a chip
 * ------------------------------------------------------------------ */

/** The side wall of a chip that has another chip sitting on it. */
function ChipWall({ r, denom }: { r: number; denom: Denomination }) {
  const spots = 12;
  return (
    <g>
      {/* The wall in shadow. Only its lower crescent is ever visible. */}
      <circle r={r} fill={shade(denom.face, 0.5)} />
      {/* Edge spots moulded through the wall. */}
      {Array.from({ length: spots }, (_, i) => (
        <rect
          key={i}
          x={-r * 0.1}
          y={r * 0.52}
          width={r * 0.2}
          height={r * 0.5}
          fill={denom.edge}
          opacity={0.5}
          transform={`rotate(${(360 / spots) * i + 15})`}
        />
      ))}
      {/* Lifted a touch, so what it does not cover is the lit crescent below —
          which is where the light from over the table actually stops. */}
      <circle r={r} cy={-r * 0.1} fill={shade(denom.face, 0.74)} />
    </g>
  );
}

/** The face of the chip on top. */
function ChipFace({ r, denom, ring }: { r: number; denom: Denomination; ring?: string }) {
  const spots = 6;
  return (
    <g>
      <circle r={r} fill={shade(denom.face, 0.55)} />
      <circle r={r * 0.985} fill={denom.face} />
      {/* Edge spots: the printed dashes around the rim. */}
      {Array.from({ length: spots }, (_, i) => (
        <rect
          key={i}
          x={-r * 0.15}
          y={-r}
          width={r * 0.3}
          height={r * 0.26}
          rx={r * 0.05}
          fill={denom.edge}
          opacity={0.8}
          transform={`rotate(${(360 / spots) * i})`}
        />
      ))}
      {/* The inlay, which sits very slightly proud of the moulding. */}
      <circle r={r * 0.66} fill={denom.face} stroke={shade(denom.face, 0.6)} strokeWidth={r * 0.06} />
      <circle
        r={r * 0.78}
        fill="none"
        stroke={denom.edge}
        strokeWidth={r * 0.05}
        strokeDasharray={`${r * 0.16} ${r * 0.13}`}
        opacity={0.32}
      />
      {ring ? <circle r={r * 0.9} fill="none" stroke={ring} strokeWidth={r * 0.11} opacity={0.95} /> : null}
      {/* Overhead light catching the top edge, and the moulding rolling off
          into shadow at the bottom. */}
      <ellipse cx={0} cy={-r * 0.42} rx={r * 0.62} ry={r * 0.32} fill="#fff" opacity={0.13} />
      <ellipse cx={0} cy={r * 0.66} rx={r * 0.52} ry={r * 0.24} fill="#000" opacity={0.14} />
    </g>
  );
}

/* ------------------------------------------------------------------ *
 * A stack, as SVG
 * ------------------------------------------------------------------ */

/** How many chips deep a stack is drawn. */
export function stackDepth(cents: number): number {
  return Math.max(1, Math.min(5, chipBreakdown(cents).length));
}

/** How far each chip in a stack sits above the one below it, as a share of r. */
const RISE = 0.17;

/**
 * The stack itself, drawn about the centre of its bottom chip and growing
 * upward. Plain SVG with no wrapper, so it can be dropped into the felt's own
 * coordinate space or into an `<svg>` of its own.
 */
export function ChipGlyph({
  cents,
  r,
  ring,
  label,
}: {
  cents: number;
  /** Chip radius, in whatever units the host SVG is using. */
  r: number;
  /** An outline in a seat's colour, when whose money it is needs saying. */
  ring?: string;
  /** Overrides the amount printed on the top chip. */
  label?: string;
}) {
  const chips = React.useMemo(() => chipBreakdown(cents), [cents]);
  if (cents <= 0 || chips.length === 0) return null;

  const rise = r * RISE;
  const top = chips.length - 1;
  const crown = chips[top];
  const text = label ?? chipLabel(cents);

  return (
    <g>
      {/* Contact shadow, tight under the base of the stack. */}
      <ellipse cx={0} cy={r * 0.5} rx={r * 1.06} ry={r * 0.33} fill="#000" opacity={0.45} />
      <ellipse cx={0} cy={r * 0.44} rx={r * 0.8} ry={r * 0.22} fill="#000" opacity={0.28} />

      {/*
        Everything below the top chip is a side wall, turned its own way.
        `chipBreakdown` hands them back largest first, which is also the order
        a dealer stacks them in — big money on the bottom — so index 0 is the
        base and each one after it is drawn higher and paints over the one
        below, which is what makes the crescents overlap correctly.
      */}
      {chips.slice(0, top).map((d, i) => (
        <g key={i} transform={`translate(${(spin(i, cents) % 2) - 1} ${-i * rise}) rotate(${spin(i, cents)})`}>
          <ChipWall r={r} denom={d} />
        </g>
      ))}

      <g transform={`translate(0 ${-top * rise})`}>
        <ChipFace r={r} denom={crown} ring={ring} />
        {/*
          The total, not the top chip's own denomination. Only the top face is
          visible in a stack, so printing its value would say "1" over sixty
          dollars of chips; the colours and the height already say which chips
          they are.
        */}
        <text
          y={r * 0.19}
          textAnchor="middle"
          fontSize={r * (text.length > 3 ? 0.46 : text.length > 2 ? 0.54 : 0.62)}
          fontWeight={800}
          fill={crown.ink}
          style={{ fontFamily: 'var(--font-display)', letterSpacing: '0.01em', pointerEvents: 'none' }}
        >
          {text}
        </text>
      </g>
    </g>
  );
}

/** Compact amount label: $12.50 reads as 12.5 on a chip face, 125000 as 1.25K. */
export function chipLabel(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 10_000) return `${Math.round(dollars / 1000)}K`;
  if (dollars >= 1000) {
    const k = dollars / 1000;
    return `${k % 1 === 0 ? k : k.toFixed(1)}K`;
  }
  return dollars % 1 === 0 ? String(dollars) : dollars.toFixed(2).replace(/0$/, '');
}

/** The box an SVG has to be to hold a stack drawn at this radius. */
export function stackBox(cents: number, r: number) {
  const above = (stackDepth(cents) - 1) * r * RISE + r * 1.05;
  const below = r * 0.9;
  return { w: r * 2.2, h: above + below, minX: -r * 1.1, minY: -above };
}

/* ------------------------------------------------------------------ *
 * On the felt
 * ------------------------------------------------------------------ */

/** A wager sitting on a spot, drawn as the stack it would be. */
export function ChipStack({
  cents,
  size = 28,
  className,
}: {
  cents: number;
  /** Chip diameter, in felt units. */
  size?: number;
  className?: string;
}) {
  const r = size / 2;
  const box = stackBox(cents, r);
  if (cents <= 0) return null;

  return (
    <svg
      width={box.w}
      height={box.h}
      viewBox={`${box.minX} ${box.minY} ${box.w} ${box.h}`}
      className={cn('overflow-visible', className)}
      role="img"
      aria-label={`${fmt(cents)} wagered`}
    >
      <ChipGlyph cents={cents} r={r} />
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * In the rack
 * ------------------------------------------------------------------ */

/** One denomination, as the rack shows it: a single face, no stack. */
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
  const r = size / 2 - 0.5;

  const body = (
    <svg
      width={size}
      height={size}
      viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`}
      aria-hidden
      className={cn('chip-face block', selected && 'chip-face--on')}
    >
      <ChipFace r={r} denom={denom} />
      <text
        y={r * 0.21}
        textAnchor="middle"
        fontSize={r * (denom.label.length > 2 ? 0.5 : 0.6)}
        fontWeight={800}
        fill={denom.ink}
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {denom.label}
      </text>
    </svg>
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
        'rounded-full transition-transform hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-30 disabled:hover:translate-y-0',
        selected && 'ring-2 ring-brass-300 ring-offset-2 ring-offset-pit-900',
        className,
      )}
    >
      {body}
    </button>
  );
}
