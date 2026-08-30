'use client';

/**
 * The twelve emblems, drawn.
 *
 * No image assets anywhere in this game, so every symbol is geometry. That is
 * not a constraint to work around -- it is the reason a dragon stays sharp on a
 * 4K cabinet and on a paytable card at 3x, and the reason twenty of them can
 * be on screen without a single network request.
 *
 * Four ideas run through all of them, and they are what separate a carved
 * lacquer emblem from clip art.
 *
 *   **Light has one direction.** It comes from the top left, always. Every
 *   rim light sits on a top-left edge, every contact shadow falls bottom
 *   right, and every gradient runs along that axis. Break it on one symbol and
 *   the whole reel looks like a collage.
 *
 *   **Value carries rank before colour does.** A low symbol is drawn with
 *   fewer, flatter tones on a cold tile; a high symbol gets deep blacks, a hot
 *   specular and a heavy gilt frame. Squint at a reel and the dragons should
 *   still be the ones that pop.
 *
 *   **Silhouette first.** Each emblem was designed as a black shape: a disc, a
 *   flower, a wedge, a hanging barrel, a comma, a dome, a mask, a plume, a
 *   horned head, a gate, a sphere, a flame. Detail is layered on top and is
 *   allowed to disappear -- see `ghost` below -- because the shape alone has
 *   to be readable at 96px through motion blur.
 *
 *   **Nothing is perfectly still.** Every symbol carries a slow idle motion
 *   whose amplitude is small enough to read as life rather than animation.
 *   They are CSS animations on transforms, declared in `symbols.css`, because
 *   twenty simultaneous keyframe animations on the compositor cost nothing and
 *   twenty React springs cost a phone its frame budget.
 *
 * `ghost` is the low-cost render used by the spinning reel band. It drops the
 * fine detail and every animation class, leaving the silhouette, the tile and
 * the main colour blocking -- which is all that survives a motion blur anyway.
 * The band clones these through `<use>`, so what is skipped here is skipped
 * thirty-five times over.
 */

import * as React from 'react';
import type { SymbolId } from '@/lib/engine/types';
import { P, SYMBOL_META, darken, glint, lighten, murk, type SymbolTier } from './palette';

/* ------------------------------------------------------------------ *
 * Shared plumbing
 * ------------------------------------------------------------------ */

export interface ArtProps {
  /** Unique prefix for this instance's paint server ids. */
  u: string;
  /** Draw the cheap version: no fine detail, no animation. */
  ghost: boolean;
}

/**
 * A gradient stop.
 *
 * Exists only because `stop-color` is a presentation attribute and cannot take
 * a `var()`. Routing every stop through a style object is the difference
 * between a gilt frame and a black one.
 */
function S({ o, c, a }: { o: number; c: string; a?: number }): React.JSX.Element {
  return <stop offset={`${o * 100}%`} style={{ stopColor: c, stopOpacity: a }} />;
}

/** `undefined` when ghosting, so an animation class never reaches the band. */
function anim(ghost: boolean, cls: string): string | undefined {
  return ghost ? undefined : cls;
}

/* ------------------------------------------------------------------ *
 * The tile
 *
 * Every emblem sits on one, and the tile is where the tier ranking is
 * actually enforced. It is built the way a lacquer panel is: a ground colour,
 * a sheen that follows the light, a bevel cut into the edge, a gilt line
 * around the outside, and shadow pooling along the bottom where the frame
 * stands proud of the surface.
 * ------------------------------------------------------------------ */

interface TileSpec {
  /** The lacquer ground, dark to light along the light axis. */
  ground: [string, string];
  /** Warm undertone bled through the middle. */
  wash: string;
  /** Gilt line: light and dark ends of the metal. */
  gilt: [string, string];
  /** How heavy the gilt line is, in viewBox units. */
  giltWidth: number;
  /** Corner rosettes -- the mark of a high symbol. */
  rosettes: boolean;
  /** A lit-from-within halo, for the three specials. */
  halo: string | null;
}

const TILE: Record<SymbolTier, TileSpec> = {
  // Cold, flat, thin bronze. A low symbol should look like painted tin.
  low: {
    ground: [P.ink800, P.ink900],
    wash: P.ink700,
    gilt: [P.gold700, P.gold900],
    giltWidth: 1.6,
    rosettes: false,
    halo: null,
  },
  // Warmer ground and a real gold line: the animals are worth stopping for.
  mid: {
    ground: [P.ink700, P.ink900],
    wash: P.cinnabar900,
    gilt: [P.gold500, P.gold800],
    giltWidth: 2.2,
    rosettes: false,
    halo: null,
  },
  // Black lacquer, heavy gold, corner rosettes. Reads as a different object.
  high: {
    ground: [P.ink850, P.ink950],
    wash: P.cinnabar800,
    gilt: [P.gold300, P.gold700],
    giltWidth: 3,
    rosettes: true,
    halo: null,
  },
  // Lit from behind. The specials do not sit on the tile, they glow through it.
  special: {
    ground: [P.ink900, P.ink950],
    wash: P.violet900,
    gilt: [P.gold200, P.gold600],
    giltWidth: 3.2,
    rosettes: true,
    halo: P.gold400,
  },
};

function Tile({ u, ghost, tier, halo }: ArtProps & { tier: SymbolTier; halo?: string }): React.JSX.Element {
  const t = TILE[tier];
  const glow = halo ?? t.halo;
  return (
    <g>
      <defs>
        {/* The lacquer, running along the light axis rather than straight down:
            a panel lit from a lamp above and to the left. */}
        <linearGradient id={`${u}T`} x1="0.05" y1="0" x2="0.9" y2="1">
          <S o={0} c={t.ground[0]} />
          <S o={0.52} c={t.wash} a={0.55} />
          <S o={1} c={t.ground[1]} />
        </linearGradient>
        {/* Gold is not one colour. Real gilding is a bright edge, a dead band
            where it turns away from the light, and a warm bounce underneath --
            three stops minimum or it reads as yellow plastic. */}
        <linearGradient id={`${u}G`} x1="0.1" y1="0" x2="0.75" y2="1">
          <S o={0} c={lighten(t.gilt[0], 0.35)} />
          <S o={0.28} c={t.gilt[0]} />
          <S o={0.55} c={darken(t.gilt[1], 0.25)} />
          <S o={0.8} c={t.gilt[0]} />
          <S o={1} c={t.gilt[1]} />
        </linearGradient>
        {glow ? (
          <radialGradient id={`${u}H`} cx="0.5" cy="0.48" r="0.55">
            <S o={0} c={glow} a={0.5} />
            <S o={0.55} c={glow} a={0.14} />
            <S o={1} c={glow} a={0} />
          </radialGradient>
        ) : null}
      </defs>

      <rect x="2.5" y="2.5" width="95" height="95" rx="13" style={{ fill: `url(#${u}T)` }} />

      {/* The bevel. Two arcs rather than a stroked rect: the light only catches
          the top-left run of the chamfer, and a full outline round the tile is
          the single most common way to make SVG look like a wireframe. */}
      <path
        d="M6 78V22a10 10 0 0 1 10-10h68"
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        style={{ stroke: glint(0.1) }}
      />
      <path
        d="M94 22v56a10 10 0 0 1-10 10H16"
        fill="none"
        strokeWidth="2.4"
        strokeLinecap="round"
        style={{ stroke: murk(0.45) }}
      />

      {glow ? (
        <circle
          cx="50"
          cy="49"
          r="44"
          className={anim(ghost, 'ds-halo')}
          style={{ fill: `url(#${u}H)` }}
        />
      ) : null}

      {/* The gilt line, drawn last so it sits proud of everything. */}
      <rect
        x="2.5"
        y="2.5"
        width="95"
        height="95"
        rx="13"
        fill="none"
        strokeWidth={t.giltWidth}
        style={{ stroke: `url(#${u}G)` }}
      />

      {!ghost && t.rosettes ? (
        <path
          d="M14 8l4 4-4 4-4-4zM86 8l4 4-4 4-4-4zM14 84l4 4-4 4-4-4zM86 84l4 4-4 4-4-4z"
          className="ds-fine"
          style={{ fill: t.gilt[0], opacity: 0.85 }}
        />
      ) : null}
    </g>
  );
}

/* ------------------------------------------------------------------ *
 * Low symbols
 *
 * Four objects from the shrine's furniture. Flatter shading, cooler tiles, and
 * one idle motion each -- enough to breathe, not enough to compete with a
 * dragon two cells over.
 * ------------------------------------------------------------------ */

/** A cash coin: disc, square hole, four seal characters. */
function Coin({ u, ghost }: ArtProps): React.JSX.Element {
  return (
    <g>
      <defs>
        <radialGradient id={`${u}1`} cx="0.34" cy="0.3" r="0.82">
          <S o={0} c={lighten(P.gold300, 0.3)} />
          <S o={0.4} c={P.gold500} />
          <S o={0.78} c={P.gold700} />
          <S o={1} c={P.gold900} />
        </radialGradient>
      </defs>
      {/* The coin sits on the tile, so it casts. */}
      <ellipse cx="52" cy="82" rx="26" ry="5" style={{ fill: murk(0.35) }} />
      <circle cx="50" cy="50" r="31" style={{ fill: darken(P.gold900, 0.4) }} />
      <circle cx="50" cy="49" r="30" style={{ fill: `url(#${u}1)` }} />
      {/* Rim: struck metal has a raised lip that catches light on one side. */}
      <circle cx="50" cy="49" r="27" fill="none" strokeWidth="2" style={{ stroke: P.gold800, opacity: 0.7 }} />
      <path d="M27 36a28 28 0 0 1 34-11" fill="none" strokeWidth="2.4" strokeLinecap="round" style={{ stroke: glint(0.5) }} />
      {/* The square hole, cut through: dark inside with a lit inner edge. */}
      <rect x="40" y="39" width="20" height="20" rx="2.5" style={{ fill: P.ink950 }} />
      <path d="M40 59V39h20" fill="none" strokeWidth="1.8" style={{ stroke: murk(0.55) }} />
      <path d="M60 39v20H40" fill="none" strokeWidth="1.6" style={{ stroke: P.gold400, opacity: 0.55 }} />
      {!ghost ? (
        <path
          className="ds-fine"
          d="M45 28h10M50 25v9M46 34h8M45 68h10M50 65v9M46 74h8M26 44h9M30.5 41v10M27 51h8M65 44h9M69.5 41v10M66 51h8"
          fill="none"
          strokeWidth="1.7"
          strokeLinecap="round"
          style={{ stroke: darken(P.gold900, 0.3), opacity: 0.85 }}
        />
      ) : null}
      {/* Idle: a highlight travelling across the face, as if the coin turned. */}
      {!ghost ? (
        <g className="ds-fine" clipPath={`url(#${u}C)`}>
          <defs>
            <clipPath id={`${u}C`}>
              <circle cx="50" cy="49" r="30" />
            </clipPath>
          </defs>
          <rect className="ds-shimmer" x="-40" y="10" width="18" height="80" style={{ fill: glint(0.3) }} transform="skewX(-18)" />
        </g>
      ) : null}
    </g>
  );
}

/** Lotus: five petals, a gold seed pod, two jade leaves. */
function Lotus({ u, ghost }: ArtProps): React.JSX.Element {
  return (
    <g>
      <defs>
        <linearGradient id={`${u}1`} x1="0.3" y1="0" x2="0.7" y2="1">
          <S o={0} c={lighten(P.cinnabar300, 0.55)} />
          <S o={0.45} c={P.cinnabar300} />
          <S o={1} c={P.cinnabar600} />
        </linearGradient>
        <linearGradient id={`${u}2`} x1="0.2" y1="0" x2="0.8" y2="1">
          <S o={0} c={P.jade400} />
          <S o={1} c={P.jade800} />
        </linearGradient>
      </defs>
      {/* Leaves first: they sit behind and read as the waterline. */}
      <path d="M16 68c10 9 24 12 34 10-8-8-22-13-34-10Z" style={{ fill: `url(#${u}2)` }} />
      <path d="M84 68c-10 9-24 12-34 10 8-8 22-13 34-10Z" style={{ fill: `url(#${u}2)`, opacity: 0.85 }} />
      {/* Outer petals, then inner, then the centre one: a flower opens outward
          and the overlap order has to say so. */}
      <g className={anim(ghost, 'ds-petals')}>
        <path d="M50 72C34 72 20 62 15 47c14-3 29 8 35 25Z" style={{ fill: `url(#${u}1)`, opacity: 0.75 }} />
        <path d="M50 72c16 0 30-10 35-25-14-3-29 8-35 25Z" style={{ fill: `url(#${u}1)`, opacity: 0.75 }} />
        <path d="M50 70C40 66 29 52 31 36c11 3 19 18 19 34Z" style={{ fill: `url(#${u}1)`, opacity: 0.9 }} />
        <path d="M50 70c10-4 21-18 19-34-11 3-19 18-19 34Z" style={{ fill: `url(#${u}1)`, opacity: 0.9 }} />
        <path d="M50 20c8 12 8 28 0 40-8-12-8-28 0-40Z" style={{ fill: `url(#${u}1)` }} />
      </g>
      {!ghost ? (
        <path
          className="ds-fine"
          d="M50 26v32M38 42c4 6 8 14 9 22M62 42c-4 6-8 14-9 22"
          fill="none"
          strokeWidth="1.2"
          strokeLinecap="round"
          style={{ stroke: lighten(P.cinnabar300, 0.5), opacity: 0.5 }}
        />
      ) : null}
      <ellipse cx="50" cy="66" rx="10" ry="6" style={{ fill: P.gold500 }} />
      <ellipse cx="50" cy="64.6" rx="8.4" ry="4.6" style={{ fill: P.gold300 }} />
      {!ghost ? (
        <path className="ds-fine" d="M45 64h1.6M49.2 63h1.6M53.4 64h1.6" strokeWidth="2.4" strokeLinecap="round" style={{ stroke: P.gold800 }} />
      ) : null}
    </g>
  );
}

/** A folded fan, open. Ribs, a lacquered leaf and a gold rivet. */
function Fan({ u, ghost }: ArtProps): React.JSX.Element {
  return (
    <g className={anim(ghost, 'ds-fan')}>
      <defs>
        <linearGradient id={`${u}1`} x1="0.15" y1="0" x2="0.85" y2="1">
          <S o={0} c={P.cinnabar400} />
          <S o={0.5} c={P.cinnabar600} />
          <S o={1} c={P.cinnabar800} />
        </linearGradient>
      </defs>
      {/* The leaf: an annular sector struck between the guard sticks. */}
      <path
        d="M6.8 70.3A46 46 0 0 1 93.2 70.3L61.3 81.9A12 12 0 0 0 38.7 81.9Z"
        style={{ fill: `url(#${u}1)` }}
      />
      {/* A gold band along the top edge, the way a good fan is bound. */}
      <path d="M6.8 70.3A46 46 0 0 1 93.2 70.3" fill="none" strokeWidth="4" style={{ stroke: P.gold600 }} />
      <path d="M9 66.5A43.5 43.5 0 0 1 91 66.5" fill="none" strokeWidth="1.4" style={{ stroke: glint(0.35) }} />
      {!ghost ? (
        <path
          className="ds-fine"
          d="M36.8 82.6 12.6 71.4M42.2 79.9 27.5 55.3M46.6 78.6 39.5 47.5M53.4 78.6 60.5 47.5M57.8 79.9 72.5 55.3M63.2 82.6 87.4 71.4"
          fill="none"
          strokeWidth="1.5"
          strokeLinecap="round"
          style={{ stroke: P.gold700, opacity: 0.75 }}
        />
      ) : null}
      {/* Guard sticks: heavier, darker, and they run past the leaf. */}
      <path d="M38.7 81.9 4.5 66" fill="none" strokeWidth="4.5" strokeLinecap="round" style={{ stroke: P.ink850 }} />
      <path d="M61.3 81.9 95.5 66" fill="none" strokeWidth="4.5" strokeLinecap="round" style={{ stroke: P.ink850 }} />
      <path d="M38.7 81.9 4.5 66" fill="none" strokeWidth="1.6" strokeLinecap="round" style={{ stroke: P.gold700, opacity: 0.6 }} />
      <circle cx="50" cy="85" r="5" style={{ fill: P.gold600 }} />
      <circle cx="49" cy="84" r="2.4" style={{ fill: P.gold300 }} />
    </g>
  );
}

/** A hanging paper lantern, lit. Sways from the cord. */
function Lantern({ u, ghost }: ArtProps): React.JSX.Element {
  return (
    <g className={anim(ghost, 'ds-sway')} style={{ transformOrigin: '50px 10px' }}>
      <defs>
        <linearGradient id={`${u}1`} x1="0.1" y1="0.1" x2="0.9" y2="0.9">
          <S o={0} c={P.cinnabar400} />
          <S o={0.45} c={P.cinnabar600} />
          <S o={1} c={P.cinnabar900} />
        </linearGradient>
        {/* The candle inside. A paper lantern is translucent, so the light
            lives in the middle of the shell rather than on its surface. */}
        <radialGradient id={`${u}2`} cx="0.42" cy="0.45" r="0.6">
          <S o={0} c={P.ember200} a={0.9} />
          <S o={0.5} c={P.ember400} a={0.35} />
          <S o={1} c={P.ember500} a={0} />
        </radialGradient>
      </defs>
      <path d="M50 4v10" strokeWidth="2" style={{ stroke: P.gold700 }} />
      <rect x="40" y="13" width="20" height="7" rx="2" style={{ fill: P.gold600 }} />
      <path d="M50 20c24 0 34 14 34 30s-10 30-34 30-34-14-34-30 10-30 34-30Z" style={{ fill: `url(#${u}1)` }} />
      <ellipse cx="48" cy="50" rx="26" ry="26" style={{ fill: `url(#${u}2)` }} />
      {!ghost ? (
        <g className="ds-fine">
          <path
            d="M50 21c-13 8-13 50 0 58M50 21c13 8 13 50 0 58M31 25c-6 10-6 40 0 50M69 25c6 10 6 40 0 50"
            fill="none"
            strokeWidth="1.1"
            style={{ stroke: murk(0.3) }}
          />
          <path d="M17 41c16-4 50-4 66 0M17 60c16 4 50 4 66 0" fill="none" strokeWidth="2.6" style={{ stroke: P.gold700, opacity: 0.85 }} />
        </g>
      ) : null}
      {/* Rim light down the left shoulder, where the lamp is. */}
      <path d="M32 26c-9 7-13 17-13 25" fill="none" strokeWidth="2.4" strokeLinecap="round" style={{ stroke: glint(0.3) }} />
      <rect x="41" y="78" width="18" height="6" rx="2" style={{ fill: P.gold600 }} />
      <path d="M50 84v11M44 84l-2.5 10M56 84l2.5 10" fill="none" strokeWidth="2" strokeLinecap="round" className={anim(ghost, 'ds-tassel')} style={{ stroke: P.gold500, transformOrigin: '50px 84px' }} />
    </g>
  );
}

/* ------------------------------------------------------------------ *
 * Mid symbols
 *
 * The three animals. More internal shape, warmer tiles, and idle motions that
 * are anatomical rather than decorative -- a fin, a head, a breath.
 * ------------------------------------------------------------------ */

/** Koi: a kohaku, white with cinnabar patches, tail wagging. */
function Koi({ u, ghost }: ArtProps): React.JSX.Element {
  return (
    <g>
      <defs>
        <linearGradient id={`${u}1`} x1="0.2" y1="0.1" x2="0.8" y2="0.9">
          <S o={0} c={lighten(P.ink100, 0.5)} />
          <S o={0.55} c={P.ink200} />
          <S o={1} c={P.ink400} />
        </linearGradient>
        <linearGradient id={`${u}2`} x1="0" y1="0" x2="1" y2="1">
          <S o={0} c={P.cinnabar400} />
          <S o={1} c={P.cinnabar700} />
        </linearGradient>
      </defs>
      {/* Water: two arcs, low contrast. They place the fish without drawing
          attention, and they are the first thing to go under blur. */}
      {!ghost ? (
        <path className="ds-fine" d="M14 26c10-5 22-5 32 0M56 84c10 5 22 5 30 0" fill="none" strokeWidth="1.6" strokeLinecap="round" style={{ stroke: P.jade600, opacity: 0.4 }} />
      ) : null}
      {/* Tail behind the body, hinged where the caudal peduncle would be. */}
      <g className={anim(ghost, 'ds-wag')} style={{ transformOrigin: '36px 64px' }}>
        <path d="M38 62c-9 6-16 15-20 26 12-2 21-10 27-20Z" style={{ fill: `url(#${u}2)`, opacity: 0.9 }} />
        <path d="M34 58c-12 1-21 6-27 14 12 1 22-2 30-8Z" style={{ fill: `url(#${u}2)`, opacity: 0.72 }} />
      </g>
      <path d="M52 24c15-2 27 8 28 21 1 14-9 25-24 27-11 2-21-3-25-11-4-9-1-19 6-27 4-5 9-9 15-10Z" style={{ fill: `url(#${u}1)` }} />
      {/* The patches: a kohaku is defined by where its red is. */}
      <path d="M56 26c9 1 16 7 19 15-8 2-16 0-22-5-3-4-2-9 3-10Z" style={{ fill: `url(#${u}2)` }} />
      <path d="M44 58c8 4 17 4 24 0-2 8-9 13-17 13-7 0-11-6-7-13Z" style={{ fill: `url(#${u}2)`, opacity: 0.9 }} />
      {/* Dorsal and pectoral, both drawn after the body so they overlap it. */}
      <path d="M58 24c4-9 11-13 18-13-2 7-6 12-11 16Z" className={anim(ghost, 'ds-fin')} style={{ fill: P.cinnabar500, opacity: 0.85, transformOrigin: '60px 26px' }} />
      <path d="M60 56c3 8 9 12 16 13-2-7-7-12-13-15Z" className={anim(ghost, 'ds-fin')} style={{ fill: P.cinnabar500, opacity: 0.8, transformOrigin: '60px 56px' }} />
      {!ghost ? (
        <path className="ds-fine" d="M60 34c6 3 11 9 13 16M52 40c6 3 11 9 13 16M46 48c5 3 9 8 11 14" fill="none" strokeWidth="1" strokeLinecap="round" style={{ stroke: P.ink500, opacity: 0.5 }} />
      ) : null}
      <circle cx="72" cy="37" r="3.6" style={{ fill: P.ink950 }} />
      <circle cx="70.8" cy="35.8" r="1.2" style={{ fill: glint(0.85) }} />
    </g>
  );
}

/** Turtle: a jade shell seen from above, head bobbing. */
function Turtle({ u, ghost }: ArtProps): React.JSX.Element {
  return (
    <g>
      <defs>
        <radialGradient id={`${u}1`} cx="0.36" cy="0.3" r="0.78">
          <S o={0} c={P.jade400} />
          <S o={0.55} c={P.jade600} />
          <S o={1} c={P.jade900} />
        </radialGradient>
      </defs>
      <ellipse cx="50" cy="62" rx="34" ry="26" style={{ fill: murk(0.3) }} transform="translate(2 4)" />
      {/* Flippers, under the shell edge. */}
      <g style={{ fill: P.jade700 }}>
        <path d="M24 44c-9-6-17-5-20 2 3 7 12 10 21 6Z" />
        <path d="M76 44c9-6 17-5 20 2-3 7-12 10-21 6Z" />
        <path d="M26 80c-8 5-12 12-8 17 7 2 14-3 17-11Z" />
        <path d="M74 80c8 5 12 12 8 17-7 2-14-3-17-11Z" />
      </g>
      {/* Head. Hinged at the neck so the bob rotates rather than slides. */}
      <g className={anim(ghost, 'ds-bob')} style={{ transformOrigin: '50px 40px' }}>
        <path d="M50 14c7 0 12 6 12 13s-5 12-12 12-12-5-12-12 5-13 12-13Z" style={{ fill: P.jade600 }} />
        <path d="M44 20c3-3 9-3 12 0-3 2-9 2-12 0Z" style={{ fill: P.jade400, opacity: 0.6 }} />
        <circle cx="44" cy="24" r="2.2" style={{ fill: P.ink950 }} />
        <circle cx="56" cy="24" r="2.2" style={{ fill: P.ink950 }} />
      </g>
      <ellipse cx="50" cy="60" rx="34" ry="26" style={{ fill: `url(#${u}1)` }} />
      <ellipse cx="50" cy="60" rx="34" ry="26" fill="none" strokeWidth="2.4" style={{ stroke: P.jade900 }} />
      {/* Scutes. The centre hexagon and five radials is the whole read; the
          real animal has more and they turn to mush below 60px. */}
      <path d="M50 44 62 53 58 68 42 68 38 53Z" fill="none" strokeWidth="2" style={{ stroke: darken(P.jade900, 0.2), opacity: 0.85 }} />
      {!ghost ? (
        <path
          className="ds-fine"
          d="M50 44V36M62 53l14-6M58 68l10 12M42 68l-10 12M38 53l-14-6"
          fill="none"
          strokeWidth="1.8"
          style={{ stroke: darken(P.jade900, 0.2), opacity: 0.7 }}
        />
      ) : null}
      {/* The dome catching the lamp. Without this the shell is a flat oval. */}
      <path d="M26 50c6-9 16-14 26-14" fill="none" strokeWidth="3" strokeLinecap="round" style={{ stroke: glint(0.24) }} />
    </g>
  );
}

/** Tiger: a mask, front on. Eyes are the whole symbol. */
function Tiger({ u, ghost }: ArtProps): React.JSX.Element {
  return (
    <g className={anim(ghost, 'ds-breathe')} style={{ transformOrigin: '50px 56px' }}>
      <defs>
        <linearGradient id={`${u}1`} x1="0.25" y1="0.05" x2="0.75" y2="1">
          <S o={0} c={P.ember300} />
          <S o={0.45} c={P.ember400} />
          <S o={1} c={P.ember700} />
        </linearGradient>
      </defs>
      <path d="M28 32c-5-11-2-19 6-18 5 1 9 6 11 12Z" style={{ fill: P.ember600 }} />
      <path d="M72 32c5-11 2-19-6-18-5 1-9 6-11 12Z" style={{ fill: P.ember600 }} />
      <path d="M31 30c-3-6-2-10 2-9 3 1 5 4 6 7Z" style={{ fill: P.cinnabar400, opacity: 0.8 }} />
      <path d="M69 30c3-6 2-10-2-9-3 1-5 4-6 7Z" style={{ fill: P.cinnabar400, opacity: 0.8 }} />
      <path d="M50 20c17 0 30 14 30 32S66 88 50 88 20 70 20 52s13-32 30-32Z" style={{ fill: `url(#${u}1)` }} />
      {/* Muzzle: a pale mass the nose and mouth are cut into. */}
      <path d="M50 54c11 0 19 7 19 16s-8 16-19 16-19-7-19-16 8-16 19-16Z" style={{ fill: lighten(P.ember200, 0.45) }} />
      <path d="M43 62h14l-7 8Z" style={{ fill: P.cinnabar600 }} />
      <path d="M50 70v5M50 75c-3 5-8 5-11 1M50 75c3 5 8 5 11 1" fill="none" strokeWidth="2" strokeLinecap="round" style={{ stroke: P.ink900 }} />
      {/* The eyes. Gold sclera, vertical pupil, and a specular that makes the
          whole mask feel alive at any size. */}
      <g className={anim(ghost, 'ds-blink')} style={{ transformOrigin: '50px 46px' }}>
        <ellipse cx="37" cy="46" rx="7.5" ry="5.6" style={{ fill: P.gold300 }} />
        <ellipse cx="63" cy="46" rx="7.5" ry="5.6" style={{ fill: P.gold300 }} />
        <ellipse cx="37" cy="46" rx="2.6" ry="4.6" style={{ fill: P.ink950 }} />
        <ellipse cx="63" cy="46" rx="2.6" ry="4.6" style={{ fill: P.ink950 }} />
        <circle cx="35" cy="43.6" r="1.4" style={{ fill: glint(0.9) }} />
        <circle cx="61" cy="43.6" r="1.4" style={{ fill: glint(0.9) }} />
      </g>
      {/* Stripes. The forehead mark is the classic 'king' character and is the
          fastest way to say tiger without drawing fur. */}
      <path
        d="M50 24v14M43 29h14M43 36h14"
        fill="none"
        strokeWidth="3"
        strokeLinecap="round"
        style={{ stroke: P.ink950, opacity: 0.9 }}
      />
      {!ghost ? (
        <path
          className="ds-fine"
          d="M24 44c-2-4-3-8-2-12M24 58c-3-2-5-5-6-9M28 70c-3-1-6-4-7-7M76 44c2-4 3-8 2-12M76 58c3-2 5-5 6-9M72 70c3-1 6-4 7-7"
          fill="none"
          strokeWidth="3.4"
          strokeLinecap="round"
          style={{ stroke: P.ink950, opacity: 0.85 }}
        />
      ) : null}
    </g>
  );
}

/* ------------------------------------------------------------------ *
 * High symbols
 *
 * Two of them, and they get everything: black lacquer, gold on gold, a
 * specular hot enough to blow out, and detail that survives being read at 3x
 * on a paytable card.
 * ------------------------------------------------------------------ */

/** Phoenix: crest, swept wings, three trailing plumes with eye-spots. */
function Phoenix({ u, ghost }: ArtProps): React.JSX.Element {
  return (
    <g>
      <defs>
        <linearGradient id={`${u}1`} x1="0.2" y1="0" x2="0.85" y2="1">
          <S o={0} c={P.gold200} />
          <S o={0.3} c={P.gold400} />
          <S o={0.62} c={P.ember400} />
          <S o={1} c={P.ember700} />
        </linearGradient>
        <linearGradient id={`${u}2`} x1="1" y1="0" x2="0" y2="1">
          <S o={0} c={P.ember300} />
          <S o={0.5} c={P.cinnabar500} />
          <S o={1} c={P.cinnabar800} />
        </linearGradient>
      </defs>
      {/* Plumes: behind everything, hinged at the tail base so they drift as
          one fan rather than three independent noodles. */}
      <g className={anim(ghost, 'ds-plumes')} style={{ transformOrigin: '56px 62px' }}>
        <path d="M56 62c-10 8-20 20-24 34 12-4 22-14 28-26Z" style={{ fill: `url(#${u}2)`, opacity: 0.9 }} />
        <path d="M56 64c-14 3-27 10-36 21 13 2 26-2 36-11Z" style={{ fill: `url(#${u}2)`, opacity: 0.72 }} />
        <path d="M58 66c-8 12-12 24-11 36 9-8 15-19 17-31Z" style={{ fill: `url(#${u}2)`, opacity: 0.8 }} />
        {!ghost ? (
          <g className="ds-fine">
            <ellipse cx="35" cy="88" rx="3.2" ry="4.6" style={{ fill: P.gold300 }} transform="rotate(-28 35 88)" />
            <ellipse cx="25" cy="79" rx="3" ry="4.2" style={{ fill: P.gold300 }} transform="rotate(-58 25 79)" />
            <ellipse cx="49" cy="93" rx="2.8" ry="4" style={{ fill: P.gold300 }} transform="rotate(-8 49 93)" />
          </g>
        ) : null}
      </g>
      {/* Wings. The far one is smaller and darker: one bird, two distances. */}
      <path d="M52 48C39 42 25 34 14 22c3 16 13 30 27 38Z" className={anim(ghost, 'ds-wingL')} style={{ fill: `url(#${u}1)`, transformOrigin: '52px 48px' }} />
      <path d="M60 48c11-5 21-11 29-20-1 13-9 24-21 30Z" className={anim(ghost, 'ds-wingR')} style={{ fill: `url(#${u}1)`, opacity: 0.82, transformOrigin: '60px 48px' }} />
      {!ghost ? (
        <path className="ds-fine" d="M48 52 26 34M46 58 22 46M50 46 32 28" fill="none" strokeWidth="1.2" style={{ stroke: darken(P.ember700, 0.2), opacity: 0.7 }} />
      ) : null}
      {/* Body and neck as one sweep, so the bird reads as a single S. */}
      <path d="M56 72c-6-8-8-18-4-27 3-8 9-14 16-17-3 8-6 15-6 22 0 8 1 15-1 22Z" style={{ fill: `url(#${u}1)` }} />
      <path d="M68 20c8-2 14 3 14 10 0 6-5 10-11 10-5 0-9-4-9-9 0-5 2-9 6-11Z" style={{ fill: P.gold300 }} />
      <path d="M80 26 92 29 80 34Z" style={{ fill: P.ember500 }} />
      {/* Crest: three spikes, and the reason the silhouette is not a duck. */}
      <path d="M70 16c1-9 7-14 15-15-4 6-6 11-6 16ZM64 16c-1-8 3-14 10-16-4 6-6 11-5 16Z" style={{ fill: P.cinnabar500 }} />
      <circle cx="76" cy="28" r="2.6" style={{ fill: P.ink950 }} />
      <circle cx="75" cy="27" r="0.9" style={{ fill: glint(0.9) }} />
    </g>
  );
}

/** Dragon: a horned head in three-quarter, whiskers drifting, eye ready to ignite. */
function Dragon({ u, ghost }: ArtProps): React.JSX.Element {
  return (
    <g>
      <defs>
        <linearGradient id={`${u}1`} x1="0.15" y1="0.05" x2="0.8" y2="1">
          <S o={0} c={P.gold200} />
          <S o={0.28} c={P.gold400} />
          <S o={0.58} c={P.gold600} />
          <S o={0.82} c={P.gold800} />
          <S o={1} c={darken(P.gold900, 0.3)} />
        </linearGradient>
        <linearGradient id={`${u}2`} x1="0" y1="0" x2="1" y2="1">
          <S o={0} c={P.cinnabar400} />
          <S o={1} c={P.cinnabar800} />
        </linearGradient>
        <radialGradient id={`${u}3`} cx="0.5" cy="0.5" r="0.5">
          <S o={0} c={P.ember200} />
          <S o={0.5} c={P.ember400} />
          <S o={1} c={P.ember700} />
        </radialGradient>
      </defs>
      {/* Mane behind the skull: four cinnabar flames, the biggest lowest. */}
      <g className={anim(ghost, 'ds-mane')} style={{ transformOrigin: '70px 55px' }}>
        <path d="M70 34c10-8 20-6 24 4-8-2-15 1-20 7Z" style={{ fill: `url(#${u}2)` }} />
        <path d="M74 48c12-4 21 1 22 12-8-6-16-6-23-2Z" style={{ fill: `url(#${u}2)` }} />
        <path d="M70 62c11 1 18 8 17 19-6-7-14-10-21-9Z" style={{ fill: `url(#${u}2)`, opacity: 0.9 }} />
        <path d="M60 74c8 4 12 12 9 21-3-8-9-13-15-14Z" style={{ fill: `url(#${u}2)`, opacity: 0.8 }} />
      </g>
      {/* Horns, swept back over the mane. */}
      <path d="M58 27c2-11 10-19 22-22-6 8-9 16-9 24Z" style={{ fill: `url(#${u}1)` }} />
      <path d="M48 26c0-9 5-16 14-20-4 7-6 13-6 20Z" style={{ fill: `url(#${u}1)`, opacity: 0.85 }} />
      {/* The skull. One path: brow, cheek, jaw hinge, muzzle, snout. */}
      <path d="M14 52c0-8 8-13 16-13 2-9 11-15 21-15 15 0 27 11 29 26 2 15-7 27-21 30-13 3-24-4-28-14-8 0-17-5-17-14Z" style={{ fill: `url(#${u}1)` }} />
      <path d="M20 58c6 9 18 13 29 11-6 7-19 7-27 1Z" style={{ fill: darken(P.gold900, 0.35) }} />
      <path d="M18 54l3 6 3-6M28 58l3 6 3-6" style={{ fill: lighten(P.ink100, 0.4) }} />
      {/* Brow ridge and snout scales: three strokes doing the work of thirty. */}
      <path d="M38 38c6-4 15-4 20 1" fill="none" strokeWidth="3.4" strokeLinecap="round" style={{ stroke: darken(P.gold900, 0.2) }} />
      {!ghost ? (
        <path className="ds-fine" d="M18 45c5-3 11-4 16-2M20 39c4-2 9-3 13-2M30 62c5 3 11 4 16 3" fill="none" strokeWidth="1.4" strokeLinecap="round" style={{ stroke: darken(P.gold900, 0.15), opacity: 0.7 }} />
      ) : null}
      <ellipse cx="21" cy="47" rx="2.6" ry="2" style={{ fill: P.ink950 }} />
      {/* The eye. `ds-eye` is what a win ignites, so it is one addressable node. */}
      <g className="ds-eye">
        <ellipse cx="44" cy="45" rx="7" ry="5.6" style={{ fill: `url(#${u}3)` }} />
        <ellipse cx="44" cy="45" rx="2" ry="4.8" style={{ fill: P.ink950 }} />
        <circle cx="42" cy="43" r="1.4" style={{ fill: glint(0.9) }} />
      </g>
      {/* Whiskers: the one part of the dragon that never stops moving. */}
      {!ghost ? (
        <path
          className="ds-fine ds-whisker"
          d="M16 42C6 34 4 22 8 10M18 62C8 66 3 76 4 88"
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          style={{ stroke: P.gold300, opacity: 0.85 }}
        />
      ) : null}
      <path d="M32 30c6-4 14-5 21-2" fill="none" strokeWidth="2" strokeLinecap="round" style={{ stroke: glint(0.4) }} />
    </g>
  );
}

/* ------------------------------------------------------------------ *
 * Specials
 *
 * These three have to be identifiable in a fifth of a second, from the corner
 * of an eye, on a reel that is still moving. Each one therefore breaks a rule
 * the other nine keep: the gate is lit from behind, the pearl has no dark
 * side, and the orb is not on the tile at all -- it is in front of it.
 * ------------------------------------------------------------------ */

/** WILD: the shrine gate, with the light of the shrine behind it. */
function Wild({ u, ghost }: ArtProps): React.JSX.Element {
  return (
    <g>
      <defs>
        <linearGradient id={`${u}1`} x1="0.1" y1="0" x2="0.9" y2="1">
          <S o={0} c={P.cinnabar400} />
          <S o={0.45} c={P.cinnabar600} />
          <S o={1} c={P.cinnabar900} />
        </linearGradient>
        <linearGradient id={`${u}2`} x1="0" y1="0" x2="0.4" y2="1">
          <S o={0} c={P.gold200} />
          <S o={0.35} c={P.gold400} />
          <S o={0.62} c={P.gold700} />
          <S o={1} c={P.gold500} />
        </linearGradient>
        <radialGradient id={`${u}4`} cx="0.5" cy="0.62" r="0.5">
          <S o={0} c={P.gold200} a={0.55} />
          <S o={0.6} c={P.gold500} a={0.16} />
          <S o={1} c={P.gold600} a={0} />
        </radialGradient>
      </defs>
      {/* The shrine behind the gate. This is the whole idea of the symbol: a
          wild is a way through, so there is light on the far side of it. */}
      <ellipse cx="50" cy="62" rx="34" ry="30" className={anim(ghost, 'ds-gateglow')} style={{ fill: `url(#${u}4)` }} />
      {/* Uprights, splayed the way a real torii's are. */}
      <path d="M25 33h10l3 57H22Z" style={{ fill: `url(#${u}1)` }} />
      <path d="M65 33h10l3 57H62Z" style={{ fill: `url(#${u}1)` }} />
      <path d="M25 33h3l-2 57h-4Z" style={{ fill: glint(0.18) }} />
      <path d="M65 33h3l-2 57h-4Z" style={{ fill: glint(0.18) }} />
      {/* Nuki: the lower beam, which passes through the posts. */}
      <path d="M16 40h68v9H16Z" style={{ fill: `url(#${u}1)` }} />
      <path d="M16 40h68v2.5H16Z" style={{ fill: glint(0.22) }} />
      {/* Kasagi and shimaki: the curved top lintel, upswept at the ends. That
          curve is the entire silhouette of a torii and is worth two paths. */}
      <path d="M8 22c22-7 62-7 84 0v8c-22-6-62-6-84 0Z" style={{ fill: `url(#${u}2)` }} />
      <path d="M6 16c23-8 65-8 88 0v6c-23-7-65-7-88 0Z" style={{ fill: `url(#${u}1)` }} />
      <path d="M6 16c23-8 65-8 88 0v1.8c-23-7-65-7-88 0Z" style={{ fill: glint(0.3) }} />
      <path d="M46 27h8v14h-8Z" style={{ fill: `url(#${u}1)` }} />
      {!ghost ? (
        <g className="ds-fine">
          {/* The plaque. A cabinet wild says WILD; making the player infer it
              from a gate is a purity that costs comprehension. */}
          <rect x="33" y="53" width="34" height="17" rx="3" style={{ fill: P.ink950, opacity: 0.85 }} />
          <rect x="33" y="53" width="34" height="17" rx="3" fill="none" strokeWidth="2" style={{ stroke: `url(#${u}2)` }} />
          <text
            x="50"
            y="65.6"
            textAnchor="middle"
            style={{
              fill: P.gold300,
              fontFamily: 'var(--font-display)',
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '0.08em',
            }}
          >
            WILD
          </text>
        </g>
      ) : null}
    </g>
  );
}

/** SCATTER: the golden pearl, with its flare and its wisps of cloud. */
function Scatter({ u, ghost }: ArtProps): React.JSX.Element {
  return (
    <g>
      <defs>
        <radialGradient id={`${u}1`} cx="0.36" cy="0.3" r="0.75">
          <S o={0} c={lighten(P.gold200, 0.6)} />
          <S o={0.28} c={P.gold200} />
          <S o={0.6} c={P.gold400} />
          <S o={0.86} c={P.gold600} />
          <S o={1} c={P.gold800} />
        </radialGradient>
        <radialGradient id={`${u}2`} cx="0.5" cy="0.5" r="0.5">
          <S o={0} c={P.gold200} a={0.85} />
          <S o={0.35} c={P.gold400} a={0.35} />
          <S o={1} c={P.gold500} a={0} />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="42" className={anim(ghost, 'ds-pearlglow')} style={{ fill: `url(#${u}2)` }} />
      {/* An eight-point flare, turning slowly. A pearl that does not throw
          light is a marble. */}
      <path
        className={anim(ghost, 'ds-flare')}
        d="M50 2 56 44 98 50 56 56 50 98 44 56 2 50 44 44Z"
        style={{ fill: P.gold300, opacity: 0.5, transformOrigin: '50px 50px' }}
      />
      <path
        className={anim(ghost, 'ds-flare2')}
        d="M50 14 54 46 86 50 54 54 50 86 46 54 14 50 46 46Z"
        style={{ fill: P.gold200, opacity: 0.4, transformOrigin: '50px 50px' }}
      />
      <circle cx="50" cy="50" r="25" className={anim(ghost, 'ds-pearl')} style={{ fill: `url(#${u}1)`, transformOrigin: '50px 50px' }} />
      {/* Rim light along the lower right: light bouncing back up off the tile,
          which is what makes a sphere read as a sphere and not a disc. */}
      <path d="M30 62a25 25 0 0 0 40 0" fill="none" strokeWidth="2.4" style={{ stroke: P.gold200, opacity: 0.5 }} />
      <ellipse cx="41" cy="40" rx="8" ry="6" style={{ fill: glint(0.75) }} transform="rotate(-28 41 40)" />
      <circle cx="60" cy="61" r="3.2" style={{ fill: glint(0.28) }} />
      {!ghost ? (
        <g className="ds-fine">
          <path
            d="M22 30c-6-4-7-11-2-15 1 6 5 9 10 10ZM78 30c6-4 7-11 2-15-1 6-5 9-10 10ZM22 70c-6 4-7 11-2 15 1-6 5-9 10-10Z"
            style={{ fill: P.gold400, opacity: 0.55 }}
          />
          <path className="ds-twinkle" d="M20 22l2.4 5.6L28 30l-5.6 2.4L20 38l-2.4-5.6L12 30l5.6-2.4Z" style={{ fill: P.gold200, transformOrigin: '20px 30px' }} />
          <path className="ds-twinkle" d="M80 66l1.8 4.2L86 72l-4.2 1.8L80 78l-1.8-4.2L74 72l4.2-1.8Z" style={{ fill: P.gold200, transformOrigin: '80px 72px', animationDelay: '-1.4s' }} />
          <path className="ds-twinkle" d="M74 20l1.5 3.5L79 25l-3.5 1.5L74 30l-1.5-3.5L69 25l3.5-1.5Z" style={{ fill: P.gold300, transformOrigin: '74px 25px', animationDelay: '-2.6s' }} />
        </g>
      ) : null}
    </g>
  );
}

/** ORB: a fire orb, genuinely burning. The link feature's whole identity. */
function Orb({ u, ghost }: ArtProps): React.JSX.Element {
  return (
    <g>
      <defs>
        <radialGradient id={`${u}1`} cx="0.4" cy="0.34" r="0.72">
          <S o={0} c={lighten(P.gold200, 0.5)} />
          <S o={0.22} c={P.gold300} />
          <S o={0.46} c={P.ember400} />
          <S o={0.72} c={P.ember600} />
          <S o={0.9} c={P.cinnabar800} />
          <S o={1} c={P.violet900} />
        </radialGradient>
        <radialGradient id={`${u}2`} cx="0.5" cy="0.55" r="0.5">
          <S o={0} c={P.ember400} a={0.6} />
          <S o={0.45} c={P.ember500} a={0.22} />
          <S o={1} c={P.violet700} a={0} />
        </radialGradient>
        <linearGradient id={`${u}3`} x1="0.5" y1="1" x2="0.5" y2="0">
          <S o={0} c={P.ember600} a={0} />
          <S o={0.35} c={P.ember500} a={0.85} />
          <S o={0.75} c={P.ember300} />
          <S o={1} c={P.gold200} />
        </linearGradient>
      </defs>
      <circle cx="50" cy="54" r="44" className={anim(ghost, 'ds-orbglow')} style={{ fill: `url(#${u}2)`, transformOrigin: '50px 54px' }} />
      {/* Flames behind the sphere. Three licks on staggered delays: one rhythm
          shared by three shapes reads as machinery, three rhythms read as fire. */}
      <g style={{ fill: `url(#${u}3)` }}>
        <path className={anim(ghost, 'ds-lick')} d="M50 34c-7-9-6-19 2-27-1 9 5 13 6 21 1 6-2 9-8 6Z" style={{ transformOrigin: '50px 36px' }} />
        <path className={anim(ghost, 'ds-lick')} d="M34 40c-8-6-10-15-5-23 1 8 6 11 9 18 2 5 0 8-4 5Z" style={{ transformOrigin: '35px 42px', animationDelay: '-0.7s', opacity: 0.85 }} />
        <path className={anim(ghost, 'ds-lick')} d="M66 40c8-6 10-15 5-23-1 8-6 11-9 18-2 5 0 8 4 5Z" style={{ transformOrigin: '65px 42px', animationDelay: '-1.3s', opacity: 0.85 }} />
      </g>
      <circle cx="50" cy="54" r="27" style={{ fill: `url(#${u}1)` }} />
      {/* The swirl inside: a molten core, not a painted ball. */}
      {!ghost ? (
        <g className="ds-fine">
          <path className="ds-swirl" d="M36 58c4-12 16-18 27-14-9 1-16 6-19 15-2 6-9 5-8-1Z" style={{ fill: P.gold200, opacity: 0.35, transformOrigin: '50px 54px' }} />
          <path className="ds-swirl2" d="M64 50c-4 12-16 18-27 14 9-1 16-6 19-15 2-6 9-5 8 1Z" style={{ fill: P.cinnabar300, opacity: 0.28, transformOrigin: '50px 54px' }} />
        </g>
      ) : null}
      <ellipse cx="41" cy="44" rx="7" ry="5" style={{ fill: glint(0.55) }} transform="rotate(-30 41 44)" />
      <circle cx="50" cy="54" r="27" fill="none" strokeWidth="1.6" style={{ stroke: P.gold300, opacity: 0.4 }} />
      {!ghost ? (
        <g className="ds-fine" style={{ fill: P.ember300 }}>
          <circle className="ds-spark" cx="30" cy="70" r="1.8" style={{ transformOrigin: '30px 70px' }} />
          <circle className="ds-spark" cx="70" cy="74" r="1.5" style={{ transformOrigin: '70px 74px', animationDelay: '-1.1s' }} />
          <circle className="ds-spark" cx="58" cy="82" r="1.2" style={{ transformOrigin: '58px 82px', animationDelay: '-2.2s' }} />
        </g>
      ) : null}
    </g>
  );
}

/* ------------------------------------------------------------------ *
 * Assembly
 * ------------------------------------------------------------------ */

const EMBLEM: Record<SymbolId, (p: ArtProps) => React.JSX.Element> = {
  COIN: Coin,
  LOTUS: Lotus,
  FAN: Fan,
  LANTERN: Lantern,
  KOI: Koi,
  TURTLE: Turtle,
  TIGER: Tiger,
  PHOENIX: Phoenix,
  DRAGON: Dragon,
  WILD: Wild,
  SCATTER: Scatter,
  ORB: Orb,
};

/**
 * The win burst.
 *
 * Shared by all twelve rather than drawn per symbol, because a win is a thing
 * that happens *to* a symbol -- the light comes from the machine, not from the
 * koi. Two nodes, invisible until the `win` state turns them on.
 */
function Burst({ u }: { u: string }): React.JSX.Element {
  return (
    <g className="ds-burst" aria-hidden>
      <defs>
        <radialGradient id={`${u}B`} cx="0.5" cy="0.5" r="0.5">
          <S o={0} c={P.gold200} a={0.75} />
          <S o={0.45} c={P.gold400} a={0.3} />
          <S o={1} c={P.gold500} a={0} />
        </radialGradient>
      </defs>
      <circle className="ds-burst-glow" cx="50" cy="50" r="50" style={{ fill: `url(#${u}B)`, transformOrigin: '50px 50px' }} />
      <path
        className="ds-burst-rays"
        d="M50 -6 55 40 106 50 55 60 50 106 45 60 -6 50 45 40Z"
        style={{ fill: P.gold200, transformOrigin: '50px 50px' }}
      />
      <circle className="ds-burst-ring" cx="50" cy="50" r="42" fill="none" strokeWidth="3" style={{ stroke: P.gold300, transformOrigin: '50px 50px' }} />
    </g>
  );
}

/**
 * One symbol's contents, without the `<svg>` around them.
 *
 * Split out from {@link SymbolArt} for one reason: the spinning reel band puts
 * these inside a `<defs>` and clones them with `<use>`, and a `<use>` needs an
 * element to point at, not a component. Everything about a symbol lives here;
 * `SymbolArt` only adds the viewport and the state.
 */
export function SymbolBody({ id, ghost = false }: { id: SymbolId; ghost?: boolean }): React.JSX.Element {
  // useId can contain characters that are not valid in a URL fragment, and a
  // broken `url(#...)` reference fails silently to black. Strip it down.
  const raw = React.useId();
  const u = React.useMemo(() => `s${raw.replace(/[^a-zA-Z0-9]/g, '')}`, [raw]);
  const meta = SYMBOL_META[id];
  const Emblem = EMBLEM[id];

  return (
    <g className="ds-body">
      <Tile u={u} ghost={ghost} tier={meta.tier} />
      <g className="ds-emblem">
        <Emblem u={u} ghost={ghost} />
      </g>
      {!ghost ? <Burst u={u} /> : null}
    </g>
  );
}
