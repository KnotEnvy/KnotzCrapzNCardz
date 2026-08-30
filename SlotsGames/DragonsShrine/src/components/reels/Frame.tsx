'use client';

/**
 * The cabinet the reels live in.
 *
 * A slot's window is a piece of joinery, and it is the part players never
 * consciously look at and always notice the absence of. A grid of symbols on a
 * dark background is a prototype; the same grid inside a gilt frame with a
 * lacquer inlay, recessed glass and a bead run along the rails is a machine.
 *
 * It is drawn at 1:1 -- the viewBox is the element's pixel size, recomputed
 * whenever the window resizes -- rather than at a fixed viewBox scaled to fit.
 * That costs one render per resize and buys strokes that are exactly the
 * weight they were designed to be at every size, instead of a hairline on a
 * phone and a rope on a desktop.
 *
 * Nothing here reads the store. It is furniture.
 */

import * as React from 'react';
import { P, darken, glint, lighten, murk } from '@/components/symbols/palette';

function S({ o, c, a }: { o: number; c: string; a?: number }): React.JSX.Element {
  return <stop offset={`${o * 100}%`} style={{ stopColor: c, stopOpacity: a }} />;
}

export interface FrameProps {
  /** Outer size of the cabinet, in CSS pixels. */
  width: number;
  height: number;
  /** How thick the frame is on every side. */
  inset: number;
  /** One reel's width, and the gap between reels. */
  cell: number;
  gap: number;
  reels: number;
}

export function Frame({ width, height, inset, cell, gap, reels }: FrameProps): React.JSX.Element {
  const raw = React.useId();
  const u = React.useMemo(() => `f${raw.replace(/[^a-zA-Z0-9]/g, '')}`, [raw]);

  const r = Math.round(inset * 0.9);
  const innerR = Math.max(3, Math.round(cell * 0.06));
  const half = inset / 2;
  // The inlay sits between the outer gilt line and the aperture: the lacquered
  // face of the frame itself.
  const inlay = inset * 0.34;

  return (
    <svg className="ds-frame" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
      <defs>
        {/* Gilding, top-lit. The dead band in the middle is what stops gold
            from reading as flat yellow. */}
        <linearGradient id={`${u}G`} x1="0" y1="0" x2="0.25" y2="1">
          <S o={0} c={lighten(P.gold200, 0.3)} />
          <S o={0.16} c={P.gold300} />
          <S o={0.4} c={P.gold600} />
          <S o={0.56} c={darken(P.gold800, 0.25)} />
          <S o={0.74} c={P.gold500} />
          <S o={1} c={P.gold800} />
        </linearGradient>
        <linearGradient id={`${u}L`} x1="0" y1="0" x2="0.2" y2="1">
          <S o={0} c={P.cinnabar700} />
          <S o={0.45} c={P.cinnabar900} />
          <S o={1} c={darken(P.cinnabar900, 0.45)} />
        </linearGradient>
        {/* The aperture's inner shadow: the glass is recessed, so the frame
            throws onto the top of the reels. */}
        <linearGradient id={`${u}S`} x1="0" y1="0" x2="0" y2="1">
          <S o={0} c={SHADOW_INK} a={0.75} />
          <S o={0.14} c={SHADOW_INK} a={0} />
          <S o={0.86} c={SHADOW_INK} a={0} />
          <S o={1} c={SHADOW_INK} a={0.6} />
        </linearGradient>
      </defs>

      {/* Frame face: lacquer, with the gilt line riding on top of it. */}
      <rect
        x={half}
        y={half}
        width={width - inset}
        height={height - inset}
        rx={r}
        fill="none"
        strokeWidth={inset}
        style={{ stroke: `url(#${u}L)` }}
      />
      {/* Bead run. A dashed stroke is a row of studs for the price of one node,
          and it is the detail that makes the frame read as made rather than
          drawn. */}
      <rect
        x={half}
        y={half}
        width={width - inset}
        height={height - inset}
        rx={r}
        fill="none"
        strokeWidth={Math.max(1.5, inset * 0.16)}
        strokeDasharray={`${Math.max(1.5, inset * 0.16)} ${Math.max(4, inset * 0.5)}`}
        strokeLinecap="round"
        style={{ stroke: P.gold600, opacity: 0.5 }}
      />
      {/* Outer gilt edge and inner gilt edge: the two lines that read as the
          frame's thickness at a glance. */}
      <rect
        x={1}
        y={1}
        width={width - 2}
        height={height - 2}
        rx={r + half}
        fill="none"
        strokeWidth={2}
        style={{ stroke: `url(#${u}G)` }}
      />
      <rect
        x={inset - inlay}
        y={inset - inlay}
        width={width - (inset - inlay) * 2}
        height={height - (inset - inlay) * 2}
        rx={innerR + inlay}
        fill="none"
        strokeWidth={Math.max(2, inlay)}
        style={{ stroke: `url(#${u}G)` }}
      />
      {/* Chamfer highlight along the top and left of the frame face. */}
      <path
        d={`M2 ${height - r} V${r} A${r} ${r} 0 0 1 ${r + 2} 2 H${width - r}`}
        fill="none"
        strokeWidth={1.5}
        style={{ stroke: glint(0.22) }}
      />
      <path
        d={`M${width - 2} ${r} V${height - r} A${r} ${r} 0 0 1 ${width - r - 2} ${height - 2} H${r}`}
        fill="none"
        strokeWidth={1.5}
        style={{ stroke: murk(0.55) }}
      />

      {/* Reel separators. Four uprights standing in the gaps, each one a dark
          core with a lit edge -- a divider, not a line. */}
      {Array.from({ length: Math.max(0, reels - 1) }, (_, i) => {
        const x = inset + cell * (i + 1) + gap * i;
        return (
          <g key={i}>
            <rect x={x} y={inset} width={gap} height={height - inset * 2} style={{ fill: P.ink950 }} />
            <rect x={x} y={inset} width={Math.max(0.75, gap * 0.28)} height={height - inset * 2} style={{ fill: glint(0.13) }} />
            <rect
              x={x + gap - Math.max(0.75, gap * 0.28)}
              y={inset}
              width={Math.max(0.75, gap * 0.28)}
              height={height - inset * 2}
              style={{ fill: murk(0.6) }}
            />
            {/* Gilt caps top and bottom, where the upright meets the rail. */}
            <rect x={x - gap * 0.5} y={inset - inlay * 0.6} width={gap * 2} height={inlay * 0.6} rx={inlay * 0.3} style={{ fill: `url(#${u}G)` }} />
            <rect x={x - gap * 0.5} y={height - inset} width={gap * 2} height={inlay * 0.6} rx={inlay * 0.3} style={{ fill: `url(#${u}G)` }} />
          </g>
        );
      })}

      {/* The recess. Drawn last and over the aperture, because it is light
          behaviour rather than material and belongs on top of everything the
          frame is made of. */}
      <rect
        x={inset}
        y={inset}
        width={width - inset * 2}
        height={height - inset * 2}
        rx={innerR}
        style={{ fill: `url(#${u}S)` }}
      />

      {/* Corner rosettes: the shrine's roof boss, repeated four times. */}
      {[
        [inset, inset, 0],
        [width - inset, inset, 90],
        [width - inset, height - inset, 180],
        [inset, height - inset, 270],
      ].map(([x, y, a], i) => (
        <g key={i} transform={`translate(${x} ${y}) rotate(${a})`}>
          <path
            d={`M0 0 L${inlay * 2.4} 0 A${inlay * 2.4} ${inlay * 2.4} 0 0 0 0 ${inlay * 2.4} Z`}
            style={{ fill: `url(#${u}G)`, opacity: 0.9 }}
          />
          <circle r={inlay * 0.55} cx={inlay * 0.85} cy={inlay * 0.85} style={{ fill: P.cinnabar700 }} />
        </g>
      ))}
    </svg>
  );
}

/** The ink the recess shadow is made of. Not a palette colour: it is darkness. */
const SHADOW_INK = '#000000';
