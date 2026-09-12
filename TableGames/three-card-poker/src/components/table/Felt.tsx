'use client';

/**
 * The print.
 *
 * An SVG print of a Three Card Poker felt, laid out the way the real one is:
 * the dealer's hand at the top, the qualifier arced across the middle of the
 * cloth, the paytables printed in the corners, and at every seat a column of
 * three spots — Pair Plus in a circle, the Ante in a diamond, the Play in a
 * box — with the 6 Card Bonus beside them. The shapes follow the regulator's
 * own layout drawing; the lettering is this table's.
 *
 * This file is only the ink. The table it is printed on is `Bed`, the numbers
 * that decide where any of it goes are in `layout`, and what the felt does when
 * a round settles is `Fx`. All four share one coordinate space and one SVG, so
 * a spot lighting up lands exactly on the spot that was printed.
 *
 * The cards and chips are HTML positioned on top in the same coordinate space —
 * SVG for the print, DOM for the things that move, because a card flip is a CSS
 * transform and an SVG one is not. The blackjack felt next door established
 * that split, and everything that was hard about it there has already been paid
 * for.
 *
 * The paytables are printed from the rules in force, not drawn as art. Change
 * the Pair Plus table in the setup screen and the felt reprints — which is the
 * honest version of a casino's rack card, where the pays live in small print
 * nobody reads.
 */

import * as React from 'react';
import { cn } from '@/components/ui/primitives';
import { BedClips, BedDefs, HandShadows, TableBed, TableLight } from './Bed';
import { FxDefs, FxUnder, type TableFx } from './Fx';
import { lineArc, LINE_TEXT, spotCentre, tableShape, type FeltGeometry, type SpotName } from './layout';
import { anteBonusTable, pairPlusTable, sixCardTable, PAY_HAND_LABEL, type PayLine } from '@/lib/engine/paytables';
import type { TableRules } from '@/lib/engine/types';

export function Felt({
  rules,
  g,
  fx,
  dealtSeats,
  dealerDealt,
  className,
}: {
  rules: TableRules;
  g: FeltGeometry;
  fx: TableFx;
  /** Indices of the seats holding cards, so the cloth can carry their shadow. */
  dealtSeats: readonly number[];
  dealerDealt: boolean;
  className?: string;
}) {
  const m = g.rail;

  return (
    <svg
      // The playing surface keeps the coordinate space it always had; the
      // viewBox is simply opened up by the rail's width on every side so the
      // furniture has somewhere to be. Everything printed below is at the
      // coordinate it was at before the table had a rail.
      viewBox={`${-m} ${-m} ${g.w + m * 2} ${g.h + m * 2}`}
      className={cn('absolute inset-0 h-full w-full', className)}
      aria-hidden
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <BedDefs />
        <BedClips g={g} />
        <FxDefs />
        {g.lines.map((line) => (
          <path key={line.text} id={`arc-${line.text}`} d={lineArc(g, line.radius, line.spread)} fill="none" />
        ))}
      </defs>

      <TableBed g={g} />

      {/* The print, screened into the nap. */}
      <g filter="url(#printInk)">
        {/*
          The boundary of the layout, printed a finger's width inside the
          cloth's edge the way a real felt has it. It costs one path and it is
          doing two jobs: it tells the eye where the playing surface ends
          independently of where the wood happens to be, and it gives the wide
          empty curve below the seats something to be. Without it the bottom
          third of this table was a plain field of blue.
        */}
        <path d={tableShape(g, -g.rail * 0.52)} fill="none" stroke="rgba(243,236,216,0.14)" strokeWidth={1.3} />
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
      </g>

      {/* The pool the cards lie in, over the print and under the light. */}
      <HandShadows g={g} seats={dealtSeats} dealer={dealerDealt} />

      <TableLight g={g} />

      {/* Last, so the lamp's corner falloff cannot grey out a win. */}
      <FxUnder fx={fx} g={g} />
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
          {/* A hairline rule under the heading, the way a printed rack card
              sets one. It is what makes three stacked blocks read as three
              tables rather than as one long column of pays. */}
          <text x={b.x} y={b.y} fill="var(--color-print-gold)" style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: '0.12em' }}>
            {b.title}
          </text>
          <line
            x1={b.x}
            y1={b.y + 4.5}
            x2={b.x + p.width}
            y2={b.y + 4.5}
            stroke="var(--color-print-gold)"
            strokeWidth={0.7}
            opacity={0.35}
          />
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
 *
 * Each spot is cut into the cloth rather than drawn on it — a dark wash inside
 * the shape, then the printed line over it, then a thin bright arc along the
 * top edge. That last one is the whole trick: the spots used to be outlines on
 * a flat field, and one hairline of light where the lamp catches the paint is
 * what puts them *in* the surface.
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
          <circle cx={six.x} cy={six.y} r={s * 0.36} fill="rgba(0,0,0,0.26)" stroke="var(--color-spot-sixcard)" strokeWidth="1.8" opacity="0.85" />
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
          <circle cx={pp.x} cy={pp.y} r={s / 2} fill="rgba(0,0,0,0.26)" stroke="var(--color-print-gold)" strokeWidth="2.2" opacity="0.9" />
          <path
            d={`M ${pp.x - s * 0.42} ${pp.y - s * 0.27} A ${s / 2} ${s / 2} 0 0 1 ${pp.x + s * 0.42} ${pp.y - s * 0.27}`}
            fill="none"
            stroke="#fff"
            strokeWidth="1"
            opacity="0.16"
          />
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
        fill="rgba(0,0,0,0.26)"
        stroke="var(--color-print-red)"
        strokeWidth="2.4"
        opacity="0.92"
      />
      <path
        d={`M ${ante.x - s * 0.44} ${ante.y - s * 0.06} L ${ante.x} ${ante.y - s * 0.5} L ${ante.x + s * 0.44} ${ante.y - s * 0.06}`}
        fill="none"
        stroke="#fff"
        strokeWidth="1"
        opacity="0.16"
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
        fill="rgba(0,0,0,0.26)"
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

/* Re-exported so the felt stays the one import a caller needs. */
export { geometryFor, spotCentre, tableShape, type FeltGeometry, type SpotName } from './layout';
