'use client';

/**
 * A dragon reel: one whole column turned wild.
 *
 * During free spins the dragon takes a reel top to bottom. Drawing that as
 * four stacked WILD tiles would be honest and completely flat -- the point of
 * the feature is that something *big* arrived, and a symbol that is four cells
 * tall is the only chance the game gets to show a creature at scale.
 *
 * So this is one continuous animal in a 1x4 frame: head at the top looking out
 * of the glass, body coiling down through three esses, tail flicking at the
 * bottom. It is drawn in a 100x400 viewBox -- the column's own aspect -- and
 * stretched to whatever the reel is, so it stays a dragon in portrait and in
 * landscape.
 *
 * The gold here is hotter than the DRAGON symbol's, and the whole thing sits
 * on a cinnabar wash rather than a tile: a dragon reel must never be mistaken
 * for four high symbols that happened to line up.
 */

import * as React from 'react';
import { P, darken, glint, lighten, murk } from './palette';

function S({ o, c, a }: { o: number; c: string; a?: number }): React.JSX.Element {
  return <stop offset={`${o * 100}%`} style={{ stopColor: c, stopOpacity: a }} />;
}

export function DragonReelArt({ className }: { className?: string }): React.JSX.Element {
  const raw = React.useId();
  const u = React.useMemo(() => `d${raw.replace(/[^a-zA-Z0-9]/g, '')}`, [raw]);

  return (
    <svg
      viewBox="0 0 100 400"
      preserveAspectRatio="none"
      className={className ? `ds-dragonreel ${className}` : 'ds-dragonreel'}
      role="img"
      aria-label="Dragon reel, fully wild"
      focusable="false"
    >
      <defs>
        <linearGradient id={`${u}W`} x1="0" y1="0" x2="1" y2="1">
          <S o={0} c={P.cinnabar700} a={0.9} />
          <S o={0.45} c={P.cinnabar900} a={0.95} />
          <S o={1} c={P.ink950} a={0.98} />
        </linearGradient>
        <linearGradient id={`${u}G`} x1="0.1" y1="0" x2="0.85" y2="0.6">
          <S o={0} c={lighten(P.gold200, 0.35)} />
          <S o={0.24} c={P.gold300} />
          <S o={0.52} c={P.gold500} />
          <S o={0.78} c={P.gold700} />
          <S o={1} c={darken(P.gold900, 0.25)} />
        </linearGradient>
        <linearGradient id={`${u}M`} x1="0" y1="0" x2="1" y2="1">
          <S o={0} c={P.ember300} />
          <S o={0.55} c={P.cinnabar500} />
          <S o={1} c={P.cinnabar900} />
        </linearGradient>
        <radialGradient id={`${u}E`} cx="0.5" cy="0.5" r="0.5">
          <S o={0} c={P.ember200} />
          <S o={0.55} c={P.ember400} />
          <S o={1} c={P.ember700} />
        </radialGradient>
        <radialGradient id={`${u}H`} cx="0.5" cy="0.3" r="0.7">
          <S o={0} c={P.gold400} a={0.4} />
          <S o={0.6} c={P.gold600} a={0.12} />
          <S o={1} c={P.gold700} a={0} />
        </radialGradient>
      </defs>

      {/* The reel behind the dragon: lacquer, not tile. */}
      <rect x="1" y="1" width="98" height="398" rx="12" style={{ fill: `url(#${u}W)` }} />
      <rect x="1" y="1" width="98" height="398" rx="12" className="ds-dr-glow" style={{ fill: `url(#${u}H)` }} />

      {/* Body: one long ribbon through three esses, drawn as a thick stroke so
          the width is uniform and the coil reads as a single animal. */}
      <path
        d="M52 92C24 118 78 150 60 186 44 218 20 236 34 272c12 30 44 34 40 68"
        fill="none"
        strokeWidth="26"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ stroke: darken(P.gold900, 0.15) }}
      />
      <path
        d="M52 92C24 118 78 150 60 186 44 218 20 236 34 272c12 30 44 34 40 68"
        fill="none"
        strokeWidth="21"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ stroke: `url(#${u}G)` }}
      />
      {/* Belly scutes: the light side of the ribbon, offset inward. */}
      <path
        d="M52 92C24 118 78 150 60 186 44 218 20 236 34 272c12 30 44 34 40 68"
        fill="none"
        strokeWidth="8"
        strokeDasharray="5 9"
        strokeLinecap="round"
        style={{ stroke: glint(0.22) }}
      />
      {/* Dorsal spines, following the same curve. */}
      <path
        d="M52 92C24 118 78 150 60 186 44 218 20 236 34 272c12 30 44 34 40 68"
        fill="none"
        strokeWidth="34"
        strokeDasharray="2 20"
        strokeLinecap="round"
        style={{ stroke: P.cinnabar500, opacity: 0.75 }}
      />

      {/* Tail, flicking. */}
      <g className="ds-dr-tail" style={{ transformOrigin: '74px 340px' }}>
        <path d="M74 340c6 22 0 40-14 52 16-4 28-16 34-32-4 14-14 26-26 32 18 0 34-14 40-34-4-10-20-18-34-18Z" style={{ fill: `url(#${u}M)` }} />
      </g>

      {/* Claws, gripping the frame. */}
      <g style={{ fill: `url(#${u}G)` }}>
        <path d="M22 176c-10-2-16 4-16 12 4-4 9-5 14-3-6 2-10 7-10 13 6-6 12-8 18-6Z" />
        <path d="M82 258c10-2 16 4 16 12-4-4-9-5-14-3 6 2 10 7 10 13-6-6-12-8-18-6Z" />
      </g>

      {/* Head. Everything above y=100 -- the top cell of the column is the
          dragon's face, which is the whole reason to draw it at this size. */}
      <g className="ds-dr-head" style={{ transformOrigin: '50px 60px' }}>
        {/* Mane */}
        <g className="ds-dr-mane" style={{ transformOrigin: '58px 62px', fill: `url(#${u}M)` }}>
          <path d="M62 20c14-8 26-2 30 12-10-4-19-1-26 6Z" />
          <path d="M70 44c16-4 26 4 26 18-9-8-19-9-28-4Z" />
          <path d="M70 70c15 2 23 12 21 26-8-9-18-12-27-9Z" />
          <path d="M58 92c11 5 16 16 12 28-4-11-12-17-21-18Z" />
          <path d="M34 22c-14-6-25 2-26 16 9-6 18-4 25 3Z" />
          <path d="M26 50c-15 0-23 9-21 23 8-8 17-10 26-6Z" />
        </g>
        {/* Horns */}
        <path d="M62 22c2-14 12-24 28-28-8 10-12 20-12 30Z" style={{ fill: `url(#${u}G)` }} />
        <path d="M40 22c-2-12-10-20-24-24 7 9 10 17 10 26Z" style={{ fill: `url(#${u}G)`, opacity: 0.9 }} />
        {/* Skull */}
        <path
          d="M50 24c18 0 32 12 34 30 2 16-6 30-20 36-6 10-18 14-28 10-10-4-14-14-12-24-8-8-10-20-6-30 5-14 17-22 32-22Z"
          style={{ fill: `url(#${u}G)` }}
        />
        {/* Snout and jaw */}
        <path d="M34 78c8 10 24 12 34 4-2 12-14 20-26 18-9-2-12-12-8-22Z" style={{ fill: darken(P.gold900, 0.3) }} />
        <path d="M38 76l4 8 4-8M50 80l4 8 4-8" style={{ fill: lighten(P.ink100, 0.4) }} />
        <path d="M30 52c8-5 18-5 26 1" fill="none" strokeWidth="5" strokeLinecap="round" style={{ stroke: darken(P.gold900, 0.2) }} />
        <ellipse cx="38" cy="66" rx="3" ry="2.4" style={{ fill: P.ink950 }} />
        {/* Eyes: both lit, because a dragon reel is always a win in progress. */}
        <g className="ds-dr-eye">
          <ellipse cx="36" cy="44" rx="8" ry="6.5" style={{ fill: `url(#${u}E)` }} />
          <ellipse cx="62" cy="46" rx="7" ry="5.5" style={{ fill: `url(#${u}E)` }} />
          <ellipse cx="36" cy="44" rx="2.4" ry="5.4" style={{ fill: P.ink950 }} />
          <ellipse cx="62" cy="46" rx="2.2" ry="4.6" style={{ fill: P.ink950 }} />
          <circle cx="34" cy="42" r="1.6" style={{ fill: glint(0.9) }} />
        </g>
        {/* Whiskers, trailing the length of the reel. */}
        <path
          className="ds-dr-whisker"
          d="M28 60C10 66 2 84 6 108M72 62c16 8 22 26 18 48"
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          style={{ stroke: P.gold300, opacity: 0.85, transformOrigin: '50px 62px' }}
        />
      </g>

      {/* Frame last, so the animal is contained by it. */}
      <rect x="1" y="1" width="98" height="398" rx="12" fill="none" strokeWidth="3" style={{ stroke: `url(#${u}G)` }} />
      <rect x="4" y="4" width="92" height="392" rx="10" fill="none" strokeWidth="1" style={{ stroke: murk(0.5) }} />
    </svg>
  );
}
