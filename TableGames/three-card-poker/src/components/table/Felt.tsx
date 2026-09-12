'use client';

/**
 * The layout.
 *
 * An SVG print of a Three Card Poker felt, laid out the way the real one is:
 * the dealer's hand at the top, the qualifier arced across the middle of the
 * cloth, the paytables printed in the corners, and at every seat a column of
 * three spots — Pair Plus in a circle, the Ante in a diamond, the Play in a
 * box — with the 6 Card Bonus beside them. The shapes follow the regulator's
 * own layout drawing; the lettering is this table's.
 *
 * It is one SVG at a fixed viewBox scaled to the container, so every
 * proportion on the table is fixed and nothing reflows. The cards and chips
 * are HTML positioned on top in the same coordinate space — SVG for the print,
 * DOM for the things that move, because a card flip is a CSS transform and an
 * SVG one is not. The blackjack felt next door established that split, and
 * everything that was hard about it there has already been paid for.
 *
 * The paytables are printed from the rules in force, not drawn as art. Change
 * the Pair Plus table in the setup screen and the felt reprints — which is the
 * honest version of a casino's rack card, where the pays live in small print
 * nobody reads.
 */

import * as React from 'react';
import { cn } from '@/components/ui/primitives';
import { anteBonusTable, pairPlusTable, sixCardTable, PAY_HAND_LABEL, type PayLine } from '@/lib/engine/paytables';
import type { TableRules } from '@/lib/engine/types';

/* ------------------------------------------------------------------ *
 * Geometry
 * ------------------------------------------------------------------ */

/** The four printed spots at a seat. PLAY is where a decision puts its chips. */
export type SpotName = 'SIX_CARD' | 'PAIR_PLUS' | 'ANTE' | 'PLAY';

export const SPOT_NAMES: readonly SpotName[] = ['SIX_CARD', 'PAIR_PLUS', 'ANTE', 'PLAY'];

type LineText = 'QUALIFIER' | 'PLAY_EQUALS_ANTE' | 'NO_QUALIFIER';

interface PrintedLine {
  text: LineText;
  /** Radius and half-angle of the arc, about the centre far below the table. */
  radius: number;
  spread: number;
  size: number;
  tone: 'gold' | 'muted';
}

/**
 * The felt comes in two geometries, for the same reason the blackjack felt
 * does: a phone in landscape has about 290 pixels of height for the table, and
 * scaling a deep layout to fit leaves most of the width empty. The shallow
 * table puts each seat's spots in a row instead of a column, drops the printed
 * paytables and two of the three lines, and gives the depth back to the cards.
 *
 * Both are described by the same fields, so nothing downstream branches on
 * which is in use.
 */
export interface FeltGeometry {
  w: number;
  h: number;
  /** The elliptical bulge the players sit around. */
  arcTop: number;
  arcRx: number;
  arcRy: number;
  /** Centre of the concentric printed arcs, well below the table. */
  arcCy: number;
  lines: readonly PrintedLine[];
  /** The dealer's hand: its top edge, and how wide a card is drawn. */
  dealerY: number;
  dealerCard: number;
  /** Where the paytables are printed, or null where there is no room for them. */
  paytables: { left: { x: number; y: number }; right: { x: number; y: number }; width: number; row: number } | null;
  /** The shuffling machine: its centre, and how large it is drawn. */
  machine: { x: number; y: number; scale: number };
  /** Each seat's anchor, which every offset below is measured from. */
  seats: ReadonlyArray<{ x: number; y: number }>;
  /** Where each spot's centre sits relative to its seat's anchor. */
  spots: Record<SpotName, { dx: number; dy: number }>;
  /** The size of a spot, in felt units. */
  spotSize: number;
  /** A seat's cards: how wide each is drawn, and where the hand's bottom edge sits. */
  seatCard: number;
  handBottom: number;
  /** The seat's name and bankroll, or null where the header has to carry them. */
  namePlate: { dx: number; dy: number } | null;
  chip: number;
  /**
   * Which side of each spot its settlement figures appear on.
   *
   * Not above, which is where the blackjack felt puts them: here the spots are
   * stacked, so a figure rising off the Ante lands on the Pair Plus spot and
   * one rising off Pair Plus lands on the hand's label. The first draft did
   * exactly that and a winning round was unreadable.
   */
  floats: Record<SpotName, 'left' | 'right' | 'below'>;
}

/**
 * The full table.
 *
 * The vertical budget, dealer outward: the dealer's cards end at about 110 and
 * their label at 135; the three printed lines have apexes at 210, 238 and 264;
 * the centre seat's cards begin at 279 and the outside seats' at 243, which is
 * why the arcs' spreads are chosen to end before x ≈ 280 — each line's *text*
 * has to stay clear of the outside seats' cards, not just its arc.
 */
export const FULL: FeltGeometry = {
  w: 1000,
  h: 560,
  arcTop: 300,
  arcRx: 500,
  arcRy: 250,
  arcCy: 820,
  lines: [
    /*
     * 24 degrees, not 21. Measured in the browser, the qualifier line renders
     * 451 units wide and a 21-degree arc at this radius is 447 — so the felt
     * was losing a sliver of the D and the R at either end, which reads as a
     * rendering fault rather than as a design. 24 degrees gives 511 units of
     * path, and its ends still stop short of the outside seats' cards.
     */
    { text: 'QUALIFIER', radius: 610, spread: 24, size: 21, tone: 'gold' },
    { text: 'PLAY_EQUALS_ANTE', radius: 582, spread: 12, size: 12, tone: 'muted' },
    { text: 'NO_QUALIFIER', radius: 556, spread: 23, size: 11, tone: 'muted' },
  ],
  dealerY: 22,
  dealerCard: 60,
  // The right-hand block ends at 850, clear of the shuffler's left edge at 893.
  // It started at 690, and the machine sat on top of every pay in its column.
  paytables: { left: { x: 44, y: 42 }, right: { x: 650, y: 42 }, width: 200, row: 14 },
  // Low enough that the machine's lid sits on the cloth and not on the rail.
  machine: { x: 928, y: 100, scale: 1 },
  seats: [
    { x: 190, y: 404 },
    { x: 500, y: 440 },
    { x: 810, y: 404 },
  ],
  spots: {
    SIX_CARD: { dx: -58, dy: -52 },
    PAIR_PLUS: { dx: 0, dy: -52 },
    ANTE: { dx: 0, dy: 0 },
    PLAY: { dx: 0, dy: 52 },
  },
  spotSize: 46,
  seatCard: 56,
  handBottom: -80,
  namePlate: { dx: -34, dy: 30 },
  chip: 26,
  // The 6 Card Bonus sits left of Pair Plus, so its figure goes on its own far side.
  floats: { SIX_CARD: 'left', PAIR_PLUS: 'right', ANTE: 'right', PLAY: 'right' },
};

/**
 * The shallow table. One printed line, no paytables, and every seat's spots
 * in a row under its cards. The outside seats are pulled in, because the
 * shallow arc closes on the rail much faster.
 */
export const COMPACT: FeltGeometry = {
  w: 1000,
  h: 400,
  arcTop: 205,
  arcRx: 500,
  arcRy: 185,
  arcCy: 640,
  /*
   * Smaller and wider than it looks like it should be. Text on a `textPath`
   * is clipped where the path runs out, and at 18px over a 20-degree spread
   * this line lost its last four letters — the felt read "DEALER PLAYS WITH
   * QUEEN HIGH OR BETTE". The arc is 500 x 2 x 23 degrees = 401 units and the
   * line needs about 334 at this size.
   */
  lines: [{ text: 'QUALIFIER', radius: 500, spread: 23, size: 16, tone: 'gold' }],
  dealerY: 12,
  dealerCard: 48,
  paytables: null,
  machine: { x: 930, y: 60, scale: 0.72 },
  seats: [
    { x: 205, y: 262 },
    { x: 500, y: 278 },
    { x: 795, y: 262 },
  ],
  spots: {
    SIX_CARD: { dx: -69, dy: 0 },
    PAIR_PLUS: { dx: -23, dy: 0 },
    ANTE: { dx: 23, dy: 0 },
    PLAY: { dx: 69, dy: 0 },
  },
  spotSize: 40,
  seatCard: 44,
  handBottom: -30,
  namePlate: null,
  chip: 22,
  // A row has neighbours on both sides and the cards above, so under it is the only room.
  floats: { SIX_CARD: 'below', PAIR_PLUS: 'below', ANTE: 'below', PLAY: 'below' },
};

/**
 * Which geometry a container of this shape wants: below about 0.44 of height
 * per unit of width, the full table would be scaled down by its depth and
 * leave the width empty.
 */
export function geometryFor(width: number, height: number): FeltGeometry {
  if (width <= 0 || height <= 0) return FULL;
  return height / width < 0.44 ? COMPACT : FULL;
}

export function spotCentre(g: FeltGeometry, seatIndex: number, spot: SpotName): { x: number; y: number } {
  const anchor = g.seats[seatIndex];
  const offset = g.spots[spot];
  return { x: anchor.x + offset.dx, y: anchor.y + offset.dy };
}

function tablePath(g: FeltGeometry): string {
  return `M 0 0 H ${g.w} V ${g.arcTop} A ${g.arcRx} ${g.arcRy} 0 0 1 0 ${g.arcTop} Z`;
}

/** The path for a printed line, as a radius and half-angle about `arcCy`. */
function arc(g: FeltGeometry, radius: number, spreadDeg: number): string {
  const rad = (spreadDeg * Math.PI) / 180;
  const dx = radius * Math.sin(rad);
  const dy = radius * Math.cos(rad);
  return `M ${(g.w / 2 - dx).toFixed(1)} ${(g.arcCy - dy).toFixed(1)} A ${radius} ${radius} 0 0 1 ${(g.w / 2 + dx).toFixed(1)} ${(g.arcCy - dy).toFixed(1)}`;
}

const LINE_TEXT: Record<LineText, string> = {
  QUALIFIER: 'DEALER PLAYS WITH QUEEN HIGH OR BETTER',
  PLAY_EQUALS_ANTE: 'PLAY MUST EQUAL ANTE',
  NO_QUALIFIER: 'NO QUALIFIER: ANTE PAYS 1 TO 1 · PLAY PUSHES',
};

/* ------------------------------------------------------------------ *
 * The print
 * ------------------------------------------------------------------ */

export function Felt({ rules, g, className }: { rules: TableRules; g: FeltGeometry; className?: string }) {
  const path = tablePath(g);

  return (
    <svg
      viewBox={`0 0 ${g.w} ${g.h}`}
      className={cn('absolute inset-0 h-full w-full', className)}
      aria-hidden
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        {/* The cloth: a broad lamp highlight over deep sapphire, with a fine
            weave on top so it reads as cloth rather than a gradient. */}
        <radialGradient id="cloth" cx="50%" cy="8%" r="95%">
          <stop offset="0%" stopColor="#1d5c9c" />
          <stop offset="42%" stopColor="#0e3866" />
          <stop offset="100%" stopColor="#051a33" />
        </radialGradient>

        <pattern id="weave" width="4" height="4" patternUnits="userSpaceOnUse">
          <rect width="4" height="4" fill="none" />
          <path d="M0 0h4M0 2h4" stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
          <path d="M0 0v4M2 0v4" stroke="rgba(0,0,0,0.06)" strokeWidth="1" />
        </pattern>

        <linearGradient id="rail" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5b3524" />
          <stop offset="35%" stopColor="#301d14" />
          <stop offset="100%" stopColor="#180d08" />
        </linearGradient>

        <radialGradient id="lamp" cx="50%" cy="0%" r="80%">
          <stop offset="0%" stopColor="rgba(255,246,214,0.15)" />
          <stop offset="55%" stopColor="rgba(255,246,214,0.03)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0.42)" />
        </radialGradient>

        {g.lines.map((line) => (
          <path key={line.text} id={`arc-${line.text}`} d={arc(g, line.radius, line.spread)} fill="none" />
        ))}
      </defs>

      <path d={path} fill="url(#cloth)" />
      <path d={path} fill="url(#weave)" />
      <path d={path} fill="url(#lamp)" />

      {/* The rail, as a thick stroke on the same path so it hugs the curve. */}
      <path d={path} fill="none" stroke="url(#rail)" strokeWidth="26" />
      <path
        d={`M 0 12 H ${g.w} V ${g.arcTop} A ${g.arcRx - 8} ${g.arcRy - 8} 0 0 1 0 ${g.arcTop} Z`}
        fill="none"
        stroke="rgba(255,214,150,0.10)"
        strokeWidth="1.5"
      />

      {g.lines.map((line) => (
        <text
          key={line.text}
          className={cn('felt-text', line.tone === 'gold' ? 'felt-text--gold' : 'felt-text--muted')}
          style={{ fontSize: line.size, letterSpacing: line.tone === 'gold' ? '0.1em' : undefined }}
        >
          <textPath href={`#arc-${line.text}`} startOffset="50%">
            {LINE_TEXT[line.text]}
          </textPath>
        </text>
      ))}

      {g.paytables ? <PrintedPaytables rules={rules} g={g} /> : null}

      {g.seats.map((_, i) => (
        <SeatSpots key={i} g={g} index={i} rules={rules} />
      ))}
    </svg>
  );
}

/**
 * The paytables, printed.
 *
 * Pair Plus and the Ante Bonus down the left, the 6 Card Bonus down the right,
 * each a title in gold and rows of hand and pay in cream. A bet the table does
 * not book is not printed, and the Ante Bonus moves up to take its place.
 */
function PrintedPaytables({ rules, g }: { rules: TableRules; g: FeltGeometry }) {
  const p = g.paytables!;
  const blocks: Array<{ x: number; y: number; title: string; lines: readonly PayLine<string>[] }> = [];

  let leftY = p.left.y;
  if (rules.pairPlus) {
    const table = pairPlusTable(rules.pairPlusTable);
    blocks.push({ x: p.left.x, y: leftY, title: 'PAIR PLUS PAYS', lines: table.lines });
    leftY += (table.lines.length + 1) * p.row + 10;
  }
  blocks.push({ x: p.left.x, y: leftY, title: 'ANTE BONUS PAYS', lines: anteBonusTable(rules.anteBonusTable).lines });
  if (rules.sixCard) {
    blocks.push({ x: p.right.x, y: p.right.y, title: '6 CARD BONUS PAYS', lines: sixCardTable(rules.sixCardTable).lines });
  }

  return (
    <g className="felt-table">
      {blocks.map((b) => (
        <g key={b.title}>
          <text x={b.x} y={b.y} fill="var(--color-print-gold)" style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: '0.12em' }}>
            {b.title}
          </text>
          {b.lines.map((line, i) => (
            <g key={line.hand} style={{ fontSize: 11.5 }}>
              <text x={b.x + 6} y={b.y + (i + 1) * p.row} fill="rgba(243,236,216,0.72)">
                {PAY_HAND_LABEL[line.hand as keyof typeof PAY_HAND_LABEL].toUpperCase()}
              </text>
              <text x={b.x + p.width} y={b.y + (i + 1) * p.row} fill="rgba(243,236,216,0.88)" textAnchor="end">
                {line.ratio[0].toLocaleString('en-US')} TO {line.ratio[1]}
              </text>
            </g>
          ))}
        </g>
      ))}
    </g>
  );
}

/**
 * One seat's printed spots.
 *
 * The shapes are the ones the regulator's layout drawing uses, and they are
 * doing work: a player learns "circle, diamond, box" long before they learn
 * which word is printed in which, and the Play box being the one shape that
 * is not a chip spot until a decision is made is exactly what it looks like.
 */
function SeatSpots({ g, index, rules }: { g: FeltGeometry; index: number; rules: TableRules }) {
  const s = g.spotSize;
  const label = Math.max(7.5, s * 0.19);

  const at = (spot: SpotName) => spotCentre(g, index, spot);
  const pp = at('PAIR_PLUS');
  const ante = at('ANTE');
  const play = at('PLAY');
  const six = at('SIX_CARD');

  return (
    <g>
      {rules.sixCard ? (
        <g>
          <circle cx={six.x} cy={six.y} r={s * 0.36} fill="rgba(0,0,0,0.16)" stroke="var(--color-spot-sixcard)" strokeWidth="1.8" opacity="0.85" />
          <text x={six.x} y={six.y - label * 0.45} className="felt-text" style={{ fontSize: label * 0.78, fill: 'var(--color-spot-sixcard)', letterSpacing: '0.04em' }}>
            6 CARD
          </text>
          <text x={six.x} y={six.y + label * 0.55} className="felt-text" style={{ fontSize: label * 0.78, fill: 'var(--color-spot-sixcard)', letterSpacing: '0.04em' }}>
            BONUS
          </text>
        </g>
      ) : null}

      {rules.pairPlus ? (
        <g>
          <circle cx={pp.x} cy={pp.y} r={s / 2} fill="rgba(0,0,0,0.16)" stroke="var(--color-print-gold)" strokeWidth="2.2" opacity="0.9" />
          <text x={pp.x} y={pp.y - label * 0.55} className="felt-text felt-text--gold" style={{ fontSize: label, letterSpacing: '0.06em' }}>
            PAIR
          </text>
          <text x={pp.x} y={pp.y + label * 0.6} className="felt-text felt-text--gold" style={{ fontSize: label, letterSpacing: '0.06em' }}>
            PLUS
          </text>
        </g>
      ) : null}

      <polygon
        points={`${ante.x},${ante.y - s / 2} ${ante.x + s / 2},${ante.y} ${ante.x},${ante.y + s / 2} ${ante.x - s / 2},${ante.y}`}
        fill="rgba(0,0,0,0.16)"
        stroke="var(--color-print-red)"
        strokeWidth="2.4"
        opacity="0.92"
      />
      <text x={ante.x} y={ante.y + 1} className="felt-text felt-text--red" style={{ fontSize: label, letterSpacing: '0.06em' }}>
        ANTE
      </text>

      <rect
        x={play.x - s * 0.52}
        y={play.y - s * 0.4}
        width={s * 1.04}
        height={s * 0.8}
        rx={5}
        fill="rgba(0,0,0,0.16)"
        stroke="var(--color-felt-line)"
        strokeWidth="2"
        opacity="0.8"
      />
      <polygon
        points={`${play.x},${play.y - s * 0.3} ${play.x + s * 0.3},${play.y} ${play.x},${play.y + s * 0.3} ${play.x - s * 0.3},${play.y}`}
        fill="none"
        stroke="var(--color-print-red)"
        strokeWidth="1.2"
        opacity="0.55"
      />
      <text x={play.x} y={play.y + 1} className="felt-text" style={{ fontSize: label, letterSpacing: '0.06em' }}>
        PLAY
      </text>
    </g>
  );
}
