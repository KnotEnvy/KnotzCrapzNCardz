'use client';

/**
 * Casino chips, drawn as SVG so they scale with the felt and stay crisp.
 *
 * Colours follow the standard American denominations, which is what makes a
 * stack readable at a glance without reading any numbers: white is a dollar,
 * red is five, green twenty-five, black a hundred, purple five hundred.
 */

import * as React from 'react';

export interface Denom {
  value: number;
  face: string;
  edge: string;
  ink: string;
  label: string;
}

export const DENOMS: Denom[] = [
  { value: 1, face: '#f4f4f2', edge: '#b4b4ae', ink: '#1b1f26', label: '1' },
  { value: 5, face: '#c8102e', edge: '#7d0a1d', ink: '#fff5f5', label: '5' },
  { value: 25, face: '#1f8a4c', edge: '#115c33', ink: '#f0fff6', label: '25' },
  { value: 100, face: '#16181d', edge: '#000000', ink: '#f4f4f2', label: '100' },
  { value: 500, face: '#6d28d9', edge: '#431a94', ink: '#f5f0ff', label: '500' },
  { value: 1000, face: '#d4af37', edge: '#8a6f1c', ink: '#241610', label: '1K' },
  { value: 5000, face: '#f97316', edge: '#9a3412', ink: '#1b1005', label: '5K' },
];

/** The largest denomination that fits inside `amount`. */
export function denomFor(amount: number): Denom {
  let picked = DENOMS[0];
  for (const d of DENOMS) if (amount >= d.value) picked = d;
  return picked;
}

/** Compact amount label: 1250 reads as 1.25K on a chip face. */
export function chipLabel(amount: number): string {
  if (amount >= 10_000) return `${Math.round(amount / 1000)}K`;
  if (amount >= 1000) {
    const k = amount / 1000;
    return `${k % 1 === 0 ? k : k.toFixed(2).replace(/0$/, '')}K`;
  }
  return String(Math.round(amount));
}

/* ------------------------------------------------------------------ *
 * A single chip face
 * ------------------------------------------------------------------ */

function ChipFace({ r, denom, ring }: { r: number; denom: Denom; ring?: string }) {
  const spots = 6;
  return (
    <g>
      <circle r={r} fill={denom.edge} />
      <circle r={r * 0.97} fill={denom.face} />
      {/* Edge spots: the printed dashes around the rim. */}
      {Array.from({ length: spots }, (_, i) => (
        <rect
          key={i}
          x={-r * 0.15}
          y={-r}
          width={r * 0.3}
          height={r * 0.24}
          rx={r * 0.05}
          fill={denom.edge}
          opacity={0.92}
          transform={`rotate(${(360 / spots) * i})`}
        />
      ))}
      <circle r={r * 0.66} fill={denom.face} stroke={denom.edge} strokeWidth={r * 0.06} />
      <circle
        r={r * 0.78}
        fill="none"
        stroke={denom.edge}
        strokeWidth={r * 0.05}
        strokeDasharray={`${r * 0.16} ${r * 0.13}`}
        opacity={0.7}
      />
      {ring ? (
        <circle r={r * 0.9} fill="none" stroke={ring} strokeWidth={r * 0.11} opacity={0.95} />
      ) : null}
      {/* Overhead light catching the top edge. */}
      <ellipse cx={0} cy={-r * 0.42} rx={r * 0.6} ry={r * 0.3} fill="#fff" opacity={0.1} />
    </g>
  );
}

/* ------------------------------------------------------------------ *
 * A stack
 * ------------------------------------------------------------------ */

export interface ChipStackProps {
  x: number;
  y: number;
  amount: number;
  /** Seat colour, drawn as a rim so you can tell whose money it is. */
  ring?: string;
  r?: number;
  /** Dimmed rendering for a bet that is turned OFF. */
  off?: boolean;
  label?: string;
  onClick?: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  title?: string;
}

export function ChipStack({
  x,
  y,
  amount,
  ring,
  r = 17,
  off = false,
  label,
  onClick,
  onContextMenu,
  title,
}: ChipStackProps) {
  const denom = denomFor(amount);
  // More money, taller stack, up to a sensible ceiling.
  const height = Math.min(4, 1 + Math.floor(Math.log10(Math.max(1, amount / denom.value)) * 2) + (amount > denom.value ? 1 : 0));
  const rise = r * 0.17;

  return (
    <g
      transform={`translate(${x} ${y})`}
      onClick={onClick}
      onContextMenu={onContextMenu}
      style={{ cursor: onClick ? 'pointer' : 'default', opacity: off ? 0.45 : 1 }}
    >
      {title ? <title>{title}</title> : null}
      <ellipse cx={0} cy={r * 0.5} rx={r * 1.05} ry={r * 0.36} fill="#000" opacity={0.42} />
      {Array.from({ length: height }, (_, i) => (
        <g key={i} transform={`translate(0 ${-i * rise})`}>
          <ChipFace r={r} denom={denom} ring={i === height - 1 ? ring : undefined} />
        </g>
      ))}
      <text
        y={-(height - 1) * rise + r * 0.13}
        textAnchor="middle"
        fontSize={r * (amount >= 1000 ? 0.52 : 0.6)}
        fontWeight={800}
        fill={denom.ink}
        style={{ fontFamily: 'var(--font-display)', letterSpacing: '0.01em', pointerEvents: 'none' }}
      >
        {chipLabel(amount)}
      </text>
      {label ? (
        <text
          y={r * 1.25}
          textAnchor="middle"
          fontSize={r * 0.5}
          fontWeight={700}
          fill="#f2ead8"
          stroke="#06301f"
          strokeWidth={r * 0.11}
          paintOrder="stroke fill"
          style={{ fontFamily: 'var(--font-display)', letterSpacing: '0.06em', pointerEvents: 'none' }}
        >
          {label}
        </text>
      ) : null}
      {off ? (
        <text
          y={-(height - 1) * rise - r * 0.85}
          textAnchor="middle"
          fontSize={r * 0.46}
          fontWeight={800}
          fill="#fca5a5"
          stroke="#450a0a"
          strokeWidth={r * 0.1}
          paintOrder="stroke fill"
          style={{ fontFamily: 'var(--font-display)', letterSpacing: '0.12em', pointerEvents: 'none' }}
        >
          OFF
        </text>
      ) : null}
    </g>
  );
}

/* ------------------------------------------------------------------ *
 * The rack button version
 * ------------------------------------------------------------------ */

export function RackChip({ denom, size = 56 }: { denom: Denom; size?: number }) {
  const r = size / 2 - 1;
  return (
    <svg width={size} height={size} viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`} aria-hidden>
      <ChipFace r={r} denom={denom} />
      <text
        y={r * 0.2}
        textAnchor="middle"
        fontSize={r * 0.58}
        fontWeight={800}
        fill={denom.ink}
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {denom.label}
      </text>
    </svg>
  );
}
