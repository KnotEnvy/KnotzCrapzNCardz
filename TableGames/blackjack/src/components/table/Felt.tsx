'use client';

/**
 * The layout.
 *
 * An SVG arc with the lettering printed on it, exactly as a blackjack felt is
 * screen printed: the payout across the top of the arc, the dealer's rule
 * under it, the insurance line inside the arc, and a betting circle for each
 * seat along the front edge.
 *
 * It is one SVG at a fixed viewBox scaled to the container, so every
 * proportion on the table is fixed and nothing reflows: a phone in landscape
 * and a 32" monitor get the same layout at different sizes, which is what a
 * felt is. The cards and chips are HTML positioned on top of it in the same
 * coordinate space — SVG for the print, DOM for the things that move, because
 * a card flip is a CSS transform and an SVG one is not.
 */

import * as React from 'react';
import { cn } from '@/components/ui/primitives';
import { blackjackRatio } from '@/lib/engine/rules';
import type { TableRules } from '@/lib/engine/types';

/**
 * The felt comes in two geometries.
 *
 * A blackjack table needs, from the dealer outward: the dealer's cards, three
 * printed lines, the players' cards, the betting circles, a row of side-bet
 * spots and a nameplate. That is about 520 units of depth, and at 1000 wide it
 * makes a shape close to a real seven-seat layout.
 *
 * A phone held sideways has roughly 290 pixels of height once the header and
 * the button bar have taken theirs, so scaling that shape to fit leaves it
 * about 520 pixels wide in an 844-pixel window — two thirds of the screen is
 * black. Scaling is the wrong answer: what a short table needs is to be a
 * *shallower table*, so the second geometry drops to a single printed line and
 * moves the nameplate into the header's territory, which buys back 150 units
 * of depth and most of the width.
 *
 * Both are described by the same fields, so nothing downstream branches on
 * which one is in use — `Surface` measures the container, picks one, and every
 * coordinate follows from it.
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
  /** Radii and half-angles of the printed lines, dealer-outward. */
  insurance: [number, number] | null;
  payout: [number, number];
  rule: [number, number] | null;
  /** Font sizes for those lines. */
  payoutSize: number;
  ruleSize: number;
  insuranceSize: number;
  /** The dealer's cards: their top edge, and how wide a card is drawn. */
  dealerY: number;
  dealerCard: number;
  /** Betting circles, left to right. */
  seats: ReadonlyArray<{ x: number; y: number }>;
  /** Card width for a player's hand, and the baseline its bottom sits on. */
  seatCard: number;
  handOffset: number;
  /** Vertical offsets from a seat's centre. */
  sideBetOffset: number;
  namePlateOffset: number | null;
  /** Where the shoe and discard tray sit. */
  shoe: { x: number; y: number };
}

/**
 * The full table. Apex heights of 180, 215 and 252 are the whole vertical
 * budget of the printed area: the dealer's cards and total end at about 162
 * and the players' cards begin at about 270, so three lines of type have
 * ninety units to live in. The spreads are chosen so each line's *text* — not
 * its arc — stays clear of the outside seats' cards, which reach in to x ≈ 328.
 */
export const FULL: FeltGeometry = {
  w: 1000,
  h: 560,
  arcTop: 300,
  arcRx: 500,
  arcRy: 250,
  arcCy: 800,
  insurance: [620, 20],
  payout: [585, 25],
  rule: [548, 25],
  payoutSize: 26,
  ruleSize: 13.5,
  insuranceSize: 12.5,
  dealerY: 40,
  dealerCard: 68,
  seats: [
    { x: 270, y: 410 },
    { x: 500, y: 436 },
    { x: 730, y: 410 },
  ],
  seatCard: 60,
  handOffset: 54,
  sideBetOffset: 44,
  namePlateOffset: 84,
  shoe: { x: 868, y: 92 },
};

/**
 * The shallow table, for a window with no height to spare. One printed line
 * instead of three, and no nameplate — the header already carries the
 * bankroll, and on a screen this size there is only one seat in play anyway.
 */
export const COMPACT: FeltGeometry = {
  w: 1000,
  h: 400,
  arcTop: 210,
  arcRx: 500,
  arcRy: 185,
  arcCy: 640,
  insurance: null,
  // Apex 150, which is the whole budget: the dealer's total ends at 120 and
  // the players' cards begin at 163, and the 24-degree spread keeps the text
  // inside x 340..660 where no seat's cards reach.
  payout: [490, 24],
  rule: null,
  payoutSize: 24,
  ruleSize: 13,
  insuranceSize: 12,
  dealerY: 20,
  dealerCard: 54,
  // Pulled in from 270/730. The shallow table's arc closes on the rail much
  // faster, and a row of six side-bet spots under an outside seat would hang
  // over the edge of it.
  seats: [
    { x: 300, y: 286 },
    { x: 500, y: 304 },
    { x: 700, y: 286 },
  ],
  seatCard: 52,
  handOffset: 48,
  sideBetOffset: 44,
  namePlateOffset: null,
  shoe: { x: 872, y: 66 },
};

/**
 * Which geometry a container of this shape wants.
 *
 * Purely a question of how much height there is per unit of width: below about
 * 0.44 the full table would be scaled down by its depth and leave the width
 * empty, which is exactly what the shallow one exists to avoid.
 */
export function geometryFor(width: number, height: number): FeltGeometry {
  if (width <= 0 || height <= 0) return FULL;
  return height / width < 0.44 ? COMPACT : FULL;
}

/** Where a seat's cards sit — the bottom edge of the hand. */
export function handSpot(g: FeltGeometry, index: number): { x: number; y: number } {
  const spot = g.seats[index];
  return { x: spot.x, y: spot.y - g.handOffset };
}

function tablePath(g: FeltGeometry): string {
  return `M 0 0 H ${g.w} V ${g.arcTop} A ${g.arcRx} ${g.arcRy} 0 0 1 0 ${g.arcTop} Z`;
}

/** The path for a printed line, as a radius and half-angle about `arcCy`. */
function arc(g: FeltGeometry, [radius, spreadDeg]: [number, number]): string {
  const rad = (spreadDeg * Math.PI) / 180;
  const dx = radius * Math.sin(rad);
  const dy = radius * Math.cos(rad);
  return `M ${(g.w / 2 - dx).toFixed(1)} ${(g.arcCy - dy).toFixed(1)} A ${radius} ${radius} 0 0 1 ${(g.w / 2 + dx).toFixed(1)} ${(g.arcCy - dy).toFixed(1)}`;
}

export function Felt({
  rules,
  g,
  className,
}: {
  rules: TableRules;
  g: FeltGeometry;
  className?: string;
}) {
  const [num, den] = blackjackRatio(rules.blackjackPays);
  const payout = `BLACKJACK PAYS ${num} TO ${den}`;
  const path = tablePath(g);

  return (
    <svg
      viewBox={`0 0 ${g.w} ${g.h}`}
      className={cn('absolute inset-0 h-full w-full', className)}
      aria-hidden
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        {/* The cloth. A broad lamp highlight over a deep blue-green, with a
            fine woven texture on top — the texture is what stops it reading as
            a gradient rectangle. */}
        <radialGradient id="cloth" cx="50%" cy="8%" r="95%">
          <stop offset="0%" stopColor="#127a66" />
          <stop offset="42%" stopColor="#0a4d41" />
          <stop offset="100%" stopColor="#042019" />
        </radialGradient>

        <pattern id="weave" width="4" height="4" patternUnits="userSpaceOnUse">
          <rect width="4" height="4" fill="none" />
          <path d="M0 0h4M0 2h4" stroke="rgba(255,255,255,0.028)" strokeWidth="1" />
          <path d="M0 0v4M2 0v4" stroke="rgba(0,0,0,0.05)" strokeWidth="1" />
        </pattern>

        {/* The rail: mahogany with a padded highlight along its inner edge. */}
        <linearGradient id="rail" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#5b3524" />
          <stop offset="35%" stopColor="#301d14" />
          <stop offset="100%" stopColor="#180d08" />
        </linearGradient>

        <linearGradient id="arcInk" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f6f1e2" />
          <stop offset="100%" stopColor="#ddd4bd" />
        </linearGradient>

        {/* The overhead lamp, as a soft vignette rather than a light source. */}
        <radialGradient id="lamp" cx="50%" cy="0%" r="80%">
          <stop offset="0%" stopColor="rgba(255,246,214,0.16)" />
          <stop offset="55%" stopColor="rgba(255,246,214,0.03)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0.42)" />
        </radialGradient>

        {/* Text arcs, concentric so they cannot cross. */}
        <path id="arc-payout" d={arc(g, g.payout)} fill="none" />
        {g.rule ? <path id="arc-rule" d={arc(g, g.rule)} fill="none" /> : null}
        {g.insurance ? <path id="arc-insurance" d={arc(g, g.insurance)} fill="none" /> : null}
      </defs>

      {/* The table body. */}
      <path d={path} fill="url(#cloth)" />
      <path d={path} fill="url(#weave)" />
      <path d={path} fill="url(#lamp)" />

      {/* The rail. Drawn as a thick stroke on the same path so it hugs the
          curve exactly rather than being a second shape that nearly does. */}
      <path d={path} fill="none" stroke="url(#rail)" strokeWidth="26" />
      <path
        d={`M 0 12 H ${g.w} V ${g.arcTop} A ${g.arcRx - 8} ${g.arcRy - 8} 0 0 1 0 ${g.arcTop} Z`}
        fill="none"
        stroke="rgba(255,214,150,0.10)"
        strokeWidth="1.5"
      />

      <text
        className="felt-text felt-text--gold"
        style={{ fontSize: g.payoutSize, letterSpacing: '0.1em' }}
      >
        <textPath href="#arc-payout" startOffset="50%">
          {payout}
        </textPath>
      </text>

      {g.rule ? (
        <text className="felt-text felt-text--muted" style={{ fontSize: g.ruleSize }}>
          <textPath href="#arc-rule" startOffset="50%">
            {rules.hitsSoft17
              ? 'DEALER MUST DRAW TO 16 AND HIT SOFT 17'
              : 'DEALER MUST DRAW TO 16 AND STAND ON ALL 17s'}
          </textPath>
        </text>
      ) : null}

      {rules.insurance && g.insurance ? (
        <>
          <text className="felt-text felt-text--muted" style={{ fontSize: g.insuranceSize }}>
            <textPath href="#arc-insurance" startOffset="50%">
              INSURANCE PAYS 2 TO 1
            </textPath>
          </text>
          {/* The insurance line itself: the arc a player's chips sit on. */}
          <path
            d={arc(g, [g.insurance[0] + 14, g.insurance[1] + 2])}
            fill="none"
            stroke="rgba(241,236,221,0.20)"
            strokeWidth="1.5"
          />
        </>
      ) : null}

      {/* Betting circles. Two rings, as they are printed. */}
      {g.seats.map((spot, i) => (
        <g key={i}>
          <circle cx={spot.x} cy={spot.y} r="42" fill="none" stroke="url(#arcInk)" strokeWidth="2.5" opacity="0.75" />
          <circle cx={spot.x} cy={spot.y} r="36" fill="none" stroke="url(#arcInk)" strokeWidth="1" opacity="0.4" />
          <circle cx={spot.x} cy={spot.y} r="42" fill="rgba(0,0,0,0.18)" />
        </g>
      ))}
    </svg>
  );
}
