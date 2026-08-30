'use client';

/**
 * What is drawn on top of the board: paylines, win frames and locked orbs.
 *
 * All three share one property that decides how they are built -- they must
 * line up with the cells to the pixel, and the cells are sized by a
 * ResizeObserver rather than by a stylesheet. So the geometry is computed in
 * JavaScript from the same `cell` and `gap` the grid uses, and the overlay is
 * an SVG whose viewBox is its own pixel size. Anything else -- percentages, a
 * fixed viewBox stretched to fit, a second grid -- drifts by a pixel or two at
 * some sizes, and a payline that misses the middle of a symbol is worse than
 * no payline at all.
 */

import * as React from 'react';
import type { Cell, JackpotId, Orb } from '@/lib/engine/types';
import type { Highlight } from '@/lib/store/contract';
import { money } from '@/lib/format';
import { P, darken, lighten } from '@/components/symbols/palette';
import { SymbolArt } from '@/components/symbols/Symbol';

export interface Geometry {
  cell: number;
  gap: number;
  reels: number;
  rows: number;
}

/** Where the centre of a cell is, in overlay pixels. */
function centre(g: Geometry, c: Cell): [number, number] {
  return [c.reel * (g.cell + g.gap) + g.cell / 2, c.row * g.cell + g.cell / 2];
}

export function gridWidth(g: Geometry): number {
  return g.reels * g.cell + (g.reels - 1) * g.gap;
}

export function gridHeight(g: Geometry): number {
  return g.rows * g.cell;
}

function S({ o, c, a }: { o: number; c: string; a?: number }): React.JSX.Element {
  return <stop offset={`${o * 100}%`} style={{ stopColor: c, stopOpacity: a }} />;
}

/* ------------------------------------------------------------------ *
 * Paylines and win frames
 * ------------------------------------------------------------------ */

export interface PaylineOverlayProps {
  geometry: Geometry;
  highlight: Highlight | null;
  /** `prefs.showLines`. False draws the frames but not the path. */
  showLines: boolean;
}

/**
 * The lit line.
 *
 * Three strokes on one path, and each one is doing a different job. A wide
 * soft stroke is the light the line throws onto the symbols under it. A thin
 * bright stroke is the line itself. A short dash chasing along the same path
 * gives it direction -- left to right, which is the direction a payline is
 * read in and the thing a new player most needs told.
 *
 * The frames are separate from the path on purpose: a player who has turned
 * the line overlay off still has to be able to see which cells paid.
 */
export const PaylineOverlay = React.memo(function PaylineOverlay({
  geometry,
  highlight,
  showLines,
}: PaylineOverlayProps): React.JSX.Element | null {
  const raw = React.useId();
  const u = React.useMemo(() => `p${raw.replace(/[^a-zA-Z0-9]/g, '')}`, [raw]);

  const w = gridWidth(geometry);
  const h = gridHeight(geometry);

  const { d, length } = React.useMemo(() => {
    if (!highlight || highlight.cells.length < 2) return { d: '', length: 0 };
    const pts = [...highlight.cells]
      .sort((a, b) => a.reel - b.reel || a.row - b.row)
      .map((c) => centre(geometry, c));
    let len = 0;
    for (let i = 1; i < pts.length; i++) {
      len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    }
    // Extend a little past the first and last cell, so the line reads as
    // arriving from off-glass rather than starting inside a symbol.
    const first = pts[0];
    const last = pts[pts.length - 1];
    const lead = geometry.cell * 0.34;
    const path = [
      `M${(first[0] - lead).toFixed(1)} ${first[1].toFixed(1)}`,
      ...pts.map(([x, y]) => `L${x.toFixed(1)} ${y.toFixed(1)}`),
      `L${(last[0] + lead).toFixed(1)} ${last[1].toFixed(1)}`,
    ].join(' ');
    return { d: path, length: len + lead * 2 };
  }, [highlight, geometry]);

  if (!highlight) return null;

  const inset = Math.max(2, geometry.cell * 0.045);
  const frameR = Math.max(3, geometry.cell * 0.09);
  const dash = Math.max(18, length * 0.22);

  return (
    <svg
      className="ds-overlay"
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={`${u}L`} x1="0" y1="0" x2="1" y2="0">
          <S o={0} c={P.gold300} />
          <S o={0.5} c={lighten(P.gold200, 0.4)} />
          <S o={1} c={P.gold400} />
        </linearGradient>
        <filter id={`${u}B`} x="-20%" y="-40%" width="140%" height="180%">
          <feGaussianBlur stdDeviation={Math.max(2, geometry.cell * 0.05)} />
        </filter>
      </defs>

      {showLines && d ? (
        <g>
          <path
            className="ds-line-glow"
            d={d}
            fill="none"
            strokeWidth={Math.max(6, geometry.cell * 0.16)}
            strokeLinecap="round"
            strokeLinejoin="round"
            filter={`url(#${u}B)`}
            style={{ stroke: P.gold400 }}
          />
          <path
            d={d}
            fill="none"
            strokeWidth={Math.max(2, geometry.cell * 0.045)}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ stroke: darken(P.gold800, 0.3), opacity: 0.9 }}
          />
          <path
            d={d}
            fill="none"
            strokeWidth={Math.max(1.4, geometry.cell * 0.028)}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ stroke: `url(#${u}L)` }}
          />
          <path
            className="ds-line-run"
            d={d}
            fill="none"
            strokeWidth={Math.max(3, geometry.cell * 0.06)}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={`${dash.toFixed(1)} ${(length + dash).toFixed(1)}`}
            style={
              {
                stroke: lighten(P.gold200, 0.5),
                '--ds-dash': `${(length + dash * 2).toFixed(1)}`,
              } as React.CSSProperties
            }
          />
        </g>
      ) : null}

      {highlight.cells.map((c) => {
        const x = c.reel * (geometry.cell + geometry.gap) + inset;
        const y = c.row * geometry.cell + inset;
        const size = geometry.cell - inset * 2;
        return (
          <g key={`${c.reel}-${c.row}`}>
            <rect
              x={x}
              y={y}
              width={size}
              height={size}
              rx={frameR}
              fill="none"
              strokeWidth={Math.max(2, geometry.cell * 0.035)}
              style={{ stroke: P.gold500, opacity: 0.45 }}
            />
            <rect
              className="ds-win-frame"
              x={x}
              y={y}
              width={size}
              height={size}
              rx={frameR}
              fill="none"
              strokeWidth={Math.max(1.6, geometry.cell * 0.028)}
              strokeDasharray="10 6"
              strokeLinecap="round"
              style={{ stroke: P.gold200 }}
            />
          </g>
        );
      })}
    </svg>
  );
});

/* ------------------------------------------------------------------ *
 * Locked orbs
 * ------------------------------------------------------------------ */

const JACKPOT_VAR: Record<JackpotId, string> = {
  MINI: 'var(--jackpot-mini)',
  MINOR: 'var(--jackpot-minor)',
  MAJOR: 'var(--jackpot-major)',
  GRAND: 'var(--jackpot-grand)',
};

export interface OrbLayerProps {
  geometry: Geometry;
  orbs: readonly Orb[];
  /** Orbs that arrived on the most recent respin get the lock animation. */
  freshKey: number;
}

/**
 * The orbs held on the grid during the link.
 *
 * They are a layer above the reels rather than symbols inside them, because
 * that is exactly what they are: a held orb does not spin, and the moment it
 * would be re-rendered as part of a reel is the moment the promise of a
 * hold-and-win is broken. Each one carries its award on its face, which is the
 * other half of the feature -- a board of orbs the player cannot read the
 * value of is just decoration.
 */
export const OrbLayer = React.memo(function OrbLayer({
  geometry,
  orbs,
  freshKey,
}: OrbLayerProps): React.JSX.Element | null {
  const seen = React.useRef<Set<string>>(new Set());
  const lastKey = React.useRef(freshKey);
  if (lastKey.current !== freshKey) {
    lastKey.current = freshKey;
  }

  if (orbs.length === 0) {
    seen.current = new Set();
    return null;
  }

  return (
    <>
      {orbs.map((orb) => {
        const key = `${orb.reel}-${orb.row}`;
        const fresh = !seen.current.has(key);
        seen.current.add(key);
        const jackpot = orb.award.kind === 'JACKPOT' ? orb.award.jackpot : null;
        return (
          <div
            key={key}
            className="ds-orb"
            data-fresh={fresh ? '1' : '0'}
            data-jackpot={jackpot ?? undefined}
            style={
              {
                left: orb.reel * (geometry.cell + geometry.gap),
                top: orb.row * geometry.cell,
                width: geometry.cell,
                height: geometry.cell,
                '--ds-jackpot': jackpot ? JACKPOT_VAR[jackpot] : undefined,
              } as React.CSSProperties
            }
          >
            <SymbolArt id="ORB" state="idle" />
            <span className="ds-orb-value numeric">
              {jackpot ? jackpot : money(orb.amount)}
            </span>
          </div>
        );
      })}
    </>
  );
});
