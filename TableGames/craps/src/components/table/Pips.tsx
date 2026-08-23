'use client';

/**
 * A die face drawn with real pips.
 *
 * Craps layouts print the dice combination next to every hardway and hop,
 * because that is how the game is actually read at the table. Doing the same
 * here costs one small component and buys a lot of authenticity.
 */

import type { DieFace } from '@/lib/engine/types';

const PIP_LAYOUT: Record<DieFace, Array<[number, number]>> = {
  1: [[0.5, 0.5]],
  2: [
    [0.28, 0.28],
    [0.72, 0.72],
  ],
  3: [
    [0.26, 0.26],
    [0.5, 0.5],
    [0.74, 0.74],
  ],
  4: [
    [0.28, 0.28],
    [0.72, 0.28],
    [0.28, 0.72],
    [0.72, 0.72],
  ],
  5: [
    [0.27, 0.27],
    [0.73, 0.27],
    [0.5, 0.5],
    [0.27, 0.73],
    [0.73, 0.73],
  ],
  6: [
    [0.28, 0.24],
    [0.72, 0.24],
    [0.28, 0.5],
    [0.72, 0.5],
    [0.28, 0.76],
    [0.72, 0.76],
  ],
};

export function PipFace({
  x,
  y,
  size,
  value,
  face = '#f2ead8',
  pip = '#0b1a12',
  opacity = 1,
}: {
  x: number;
  y: number;
  size: number;
  value: DieFace;
  face?: string;
  pip?: string;
  opacity?: number;
}) {
  const r = size * 0.085;
  return (
    <g transform={`translate(${x} ${y})`} opacity={opacity}>
      <rect
        width={size}
        height={size}
        rx={size * 0.18}
        fill={face}
        stroke="rgba(0,0,0,0.35)"
        strokeWidth={size * 0.04}
      />
      {PIP_LAYOUT[value].map(([px, py], i) => (
        <circle key={i} cx={px * size} cy={py * size} r={r} fill={pip} />
      ))}
    </g>
  );
}

/** The pair of dice shown beside a hardway or a hop bet. */
export function PipPair({
  x,
  y,
  size,
  a,
  b,
  gap = 0.22,
  ...rest
}: {
  x: number;
  y: number;
  size: number;
  a: DieFace;
  b: DieFace;
  gap?: number;
  face?: string;
  pip?: string;
  opacity?: number;
}) {
  const step = size * (1 + gap);
  return (
    <g transform={`translate(${x - step / 2 - size / 2} ${y - size / 2})`}>
      <PipFace x={0} y={0} size={size} value={a} {...rest} />
      <PipFace x={step} y={0} size={size} value={b} {...rest} />
    </g>
  );
}
