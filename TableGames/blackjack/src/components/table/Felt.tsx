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
 * The felt's coordinate space.
 *
 * Everything on the table is expressed in these units, including the HTML
 * overlay — `Surface` scales one to the other. 1000 x 560 is close to the
 * proportions of a real seven-seat layout and divides tidily.
 */
export const FELT_W = 1000;
export const FELT_H = 560;

/**
 * The arc the players sit on.
 *
 * A blackjack table is a straight dealer edge with a shallow elliptical bulge
 * toward the room. `ARC_RY` is chosen so the lowest point of that bulge lands
 * exactly on the bottom of the viewBox with a little air under it — get this
 * wrong and the felt is clipped rather than curved.
 */
const ARC_TOP = 300;
const ARC_RX = 500;
const ARC_RY = 250;
const TABLE_PATH = `M 0 0 H 1000 V ${ARC_TOP} A ${ARC_RX} ${ARC_RY} 0 0 1 0 ${ARC_TOP} Z`;

/**
 * The printed arcs are concentric, struck from a single centre well below the
 * table, which is the only way to guarantee they never cross. Ordered from the
 * dealer outward: insurance nearest the dealer, then the payout, then the
 * dealer's own rule nearest the players — exactly how a felt is printed.
 *
 * `arc(r, spread)` returns the path for a radius and a half-angle in degrees.
 */
const ARC_CX = 500;
const ARC_CY = 800;

function arc(radius: number, spreadDeg: number): string {
  const rad = (spreadDeg * Math.PI) / 180;
  const dx = radius * Math.sin(rad);
  const dy = radius * Math.cos(rad);
  const x1 = (ARC_CX - dx).toFixed(1);
  const x2 = (ARC_CX + dx).toFixed(1);
  const y = (ARC_CY - dy).toFixed(1);
  return `M ${x1} ${y} A ${radius} ${radius} 0 0 1 ${x2} ${y}`;
}

/*
 * Apex heights of 180, 215 and 252, which is the whole vertical budget of the
 * printed area: the dealer's cards and total end at about 162 and the players'
 * cards begin at about 270, so three lines of type have ninety units to live
 * in. The spreads are chosen so each line's *text* — not its arc — stays clear
 * of the outside seats' cards, which reach in to x ≈ 328.
 */
const ARC_INSURANCE = arc(620, 20);
const ARC_PAYOUT = arc(585, 25);
const ARC_RULE = arc(548, 25);

/**
 * Where each seat's betting circle sits.
 *
 * Three of them, on an arc centred well below the table so the curve is
 * shallow — a blackjack layout is a wide arc, not a semicircle. The middle
 * seat is the closest to the dealer, which is why it sits highest.
 */
export const SEAT_SPOTS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 270, y: 410 },
  { x: 500, y: 436 },
  { x: 730, y: 410 },
];

/**
 * The baseline a seat's cards sit on — the bottom edge of the hand, far
 * enough above the circle that a five-card hand still clears the chips.
 */
export function handSpot(index: number): { x: number; y: number } {
  const spot = SEAT_SPOTS[index];
  return { x: spot.x, y: spot.y - 54 };
}

/** The dealer's cards, centred at the top. This is their top edge. */
export const DEALER_SPOT = { x: 500, y: 40 };

/** The shoe, at the dealer's left — which is the player's right. */
export const SHOE_SPOT = { x: 868, y: 92 };

export function Felt({ rules, className }: { rules: TableRules; className?: string }) {
  const [num, den] = blackjackRatio(rules.blackjackPays);
  const payout = `BLACKJACK PAYS ${num} TO ${den}`;

  return (
    <svg
      viewBox={`0 0 ${FELT_W} ${FELT_H}`}
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
        <path id="arc-payout" d={ARC_PAYOUT} fill="none" />
        <path id="arc-rule" d={ARC_RULE} fill="none" />
        <path id="arc-insurance" d={ARC_INSURANCE} fill="none" />
      </defs>

      {/* The table body. */}
      <path d={TABLE_PATH} fill="url(#cloth)" />
      <path d={TABLE_PATH} fill="url(#weave)" />
      <path d={TABLE_PATH} fill="url(#lamp)" />

      {/* The rail. Drawn as a thick stroke on the same path so it hugs the
          curve exactly rather than being a second shape that nearly does. */}
      <path d={TABLE_PATH} fill="none" stroke="url(#rail)" strokeWidth="26" />
      <path
        d={`M 0 12 H 1000 V ${ARC_TOP} A ${ARC_RX - 8} ${ARC_RY - 8} 0 0 1 0 ${ARC_TOP} Z`}
        fill="none"
        stroke="rgba(255,214,150,0.10)"
        strokeWidth="1.5"
      />

      <text className="felt-text felt-text--gold" style={{ fontSize: 26, letterSpacing: '0.1em' }}>
        <textPath href="#arc-payout" startOffset="50%">
          {payout}
        </textPath>
      </text>

      <text className="felt-text felt-text--muted" style={{ fontSize: 13.5 }}>
        <textPath href="#arc-rule" startOffset="50%">
          {rules.hitsSoft17 ? 'DEALER MUST DRAW TO 16 AND HIT SOFT 17' : 'DEALER MUST DRAW TO 16 AND STAND ON ALL 17s'}
        </textPath>
      </text>

      {rules.insurance ? (
        <text className="felt-text felt-text--muted" style={{ fontSize: 12.5 }}>
          <textPath href="#arc-insurance" startOffset="50%">
            INSURANCE PAYS 2 TO 1
          </textPath>
        </text>
      ) : null}

      {/* The insurance line itself: the arc a player's insurance chips sit on. */}
      {rules.insurance ? (
        <path d={arc(634, 22)} fill="none" stroke="rgba(241,236,221,0.18)" strokeWidth="1.5" />
      ) : null}

      {/* Betting circles. Two rings, as they are printed. */}
      {SEAT_SPOTS.map((spot, i) => (
        <g key={i}>
          <circle cx={spot.x} cy={spot.y} r="42" fill="none" stroke="url(#arcInk)" strokeWidth="2.5" opacity="0.75" />
          <circle cx={spot.x} cy={spot.y} r="36" fill="none" stroke="url(#arcInk)" strokeWidth="1" opacity="0.4" />
          <circle cx={spot.x} cy={spot.y} r="42" fill="rgba(0,0,0,0.18)" />
        </g>
      ))}

    </svg>
  );
}
