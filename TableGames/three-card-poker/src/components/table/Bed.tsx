'use client';

/**
 * The table itself: rail, bumper, cloth, and the light hanging over all of it.
 *
 * Read-only decoration. Nothing here knows about seats, bets or the store — it
 * draws the furniture the printed layout sits on, in one place, so `Felt` can
 * stay pure geometry and lettering.
 *
 * The stack, bottom to top, is deliberately the order light actually arrives
 * in: wood, then the padded bumper that casts a shadow onto the cloth, then the
 * cloth's own weave and nap, then — after the print, which is why this file
 * exports the light separately — the cone from the lamp, and finally the dark
 * in the corners the lamp never reaches. Painting them out of that order is
 * what makes a table look like flat vector art instead of a surface, and the
 * felt here was flat vector art: one radial gradient, one hairline weave, and a
 * rail drawn as a stroke centred on the cloth's own edge, so half its width
 * fell outside the viewBox and was clipped away.
 *
 * All of it is drawn in the margin `layout` reserves outside the playing
 * surface, so the rail cost the layout nothing: every coordinate on the cloth
 * is the coordinate it was before there was a rail.
 */

import * as React from 'react';
import { tableShape, type FeltGeometry } from './layout';

/** How much of the rail is the padded lip between the wood and the cloth. */
const BUMPER_SHARE = 0.34;

/* ------------------------------------------------------------------ *
 * Paint
 * ------------------------------------------------------------------ */

/**
 * Every gradient and filter the furniture uses. Rendered inside the felt's own
 * `defs`, so there is exactly one of each no matter how the table is drawn.
 */
export function BedDefs() {
  return (
    <>
      {/* ---- Wood ---- */}
      <linearGradient id="bedWood" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#6d4a33" />
        <stop offset="16%" stopColor="#4a3021" />
        <stop offset="58%" stopColor="#2e1c11" />
        <stop offset="100%" stopColor="#180d08" />
      </linearGradient>
      {/* Long grain: stretched hard along the rail so it reads as one board
          bent round the table, rather than as noise sprinkled on brown. */}
      <filter id="bedGrain" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.005 0.85" numOctaves="3" seed="7" />
        <feColorMatrix type="saturate" values="0" />
        <feComponentTransfer>
          <feFuncA type="linear" slope="0.55" intercept="0" />
        </feComponentTransfer>
      </filter>

      {/* ---- Bumper ---- */}
      <linearGradient id="bedBumper" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#2b1a12" />
        <stop offset="42%" stopColor="#190f0a" />
        <stop offset="100%" stopColor="#0b0605" />
      </linearGradient>

      {/* ---- Cloth ---- */}
      {/*
        Deep sapphire, lit from the dealer's end, falling away to almost black
        at the players' rail.

        Five stops rather than three, and every one of them darker than it
        looks like it should be. A casino is a dark room with a light over each
        table, so the cloth's job is to be the *darkest* bright thing in the
        frame — the print, the cards and the chips all have to come off it. The
        first pass here was a couple of stops lighter and the table read as a
        flat blue field with lettering floating on it; blue also reads lighter
        than green at the same luminance, so this had to go further down than
        the green felt on the craps table next door to arrive in the same place.
      */}
      <radialGradient id="cloth" cx="50%" cy="6%" r="96%">
        <stop offset="0%" stopColor="#17558f" />
        <stop offset="24%" stopColor="#103f6d" />
        <stop offset="52%" stopColor="#0a2b4c" />
        <stop offset="78%" stopColor="#051830" />
        <stop offset="100%" stopColor="#020b18" />
      </radialGradient>

      {/* The weave, at the scale the threads actually are. */}
      <pattern id="weave" width="4" height="4" patternUnits="userSpaceOnUse">
        <rect width="4" height="4" fill="none" />
        <path d="M0 0h4M0 2h4" stroke="rgba(255,255,255,0.030)" strokeWidth="1" />
        <path d="M0 0v4M2 0v4" stroke="rgba(0,0,0,0.060)" strokeWidth="1" />
      </pattern>

      {/* The nap: fine, isotropic, and barely there. It is a texture you feel
          rather than see, and turning it up reads instantly as video noise. */}
      <filter id="clothNap" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="4" stitchTiles="stitch" seed="3" />
        <feColorMatrix type="saturate" values="0" />
      </filter>
      {/* A coarser, slower blotch underneath it, which is what keeps a large
          field of cloth from looking laminated. */}
      <filter id="clothMottle" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.013" numOctaves="3" seed="11" />
        <feColorMatrix type="saturate" values="0" />
        <feComponentTransfer>
          <feFuncA type="linear" slope="0.7" intercept="0" />
        </feComponentTransfer>
      </filter>

      {/* ---- Light ---- */}
      {/*
        The lamp over the table.

        Centred on the middle of the cloth rather than on the dealer, because
        that is where the lamp actually hangs, and tight enough that there is a
        visible pool of it. A wide, weak cone is indistinguishable from raising
        the cloth's own brightness, which is what the first pass did — the
        table came out evenly lit, and an evenly lit table is a diagram.
      */}
      <radialGradient id="lampCone" cx="50%" cy="34%" r="58%">
        <stop offset="0%" stopColor="#fff6d8" stopOpacity="0.15" />
        <stop offset="30%" stopColor="#fff2cc" stopOpacity="0.075" />
        <stop offset="66%" stopColor="#ffeec2" stopOpacity="0.02" />
        <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
      </radialGradient>
      {/* What the lamp cannot reach. Multiplied, so it darkens the print as
          well as the cloth — otherwise the lettering floats above the table
          instead of being screened onto it. */}
      <radialGradient id="cornerFall" cx="50%" cy="32%" r="64%">
        <stop offset="22%" stopColor="#000000" stopOpacity="0" />
        <stop offset="52%" stopColor="#000814" stopOpacity="0.28" />
        <stop offset="76%" stopColor="#000510" stopOpacity="0.58" />
        <stop offset="100%" stopColor="#00030b" stopOpacity="0.86" />
      </radialGradient>

      {/* The shadow the padded lip throws inward across the playing surface.
          Drawn as a fat blurred stroke clipped to the cloth, which is far
          cheaper than a real inset shadow over a surface this size. */}
      <filter id="bumperCast" x="-14%" y="-14%" width="128%" height="128%">
        <feGaussianBlur stdDeviation="10" />
      </filter>

      {/* ---- Brass ---- */}
      <linearGradient id="brass" x1="0" y1="0" x2="0.35" y2="1">
        <stop offset="0%" stopColor="#f7e9a8" />
        <stop offset="28%" stopColor="#d4af37" />
        <stop offset="52%" stopColor="#8a6f1c" />
        <stop offset="74%" stopColor="#e0bd47" />
        <stop offset="100%" stopColor="#6d5615" />
      </linearGradient>

      {/* Screen-printed ink sits *in* the nap, so it carries a little shadow of
          its own. This is the single cheapest thing on the table and about a
          third of why the lettering now looks printed rather than pasted. */}
      <filter id="printInk" x="-8%" y="-8%" width="116%" height="116%">
        <feDropShadow dx="0" dy="1.1" stdDeviation="1" floodColor="#020c18" floodOpacity="0.6" />
      </filter>
    </>
  );
}

/** Clips for anything that must not spill past its surface. */
export function BedClips({ g }: { g: FeltGeometry }) {
  return (
    <>
      <clipPath id="clothClip">
        <path d={tableShape(g, 0)} />
      </clipPath>
      <clipPath id="woodClip">
        <path d={tableShape(g, g.rail)} />
      </clipPath>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * The furniture
 * ------------------------------------------------------------------ */

/**
 * Everything under the printed layout.
 *
 * Memoised on the geometry, which changes only when the window changes shape.
 * The felt above it re-renders on every action at the table, and this subtree
 * is the expensive part of it: two `feTurbulence` filters over the whole
 * surface, which the browser is happy to rasterise once and reuse but would
 * otherwise be asked to reconsider on every chip placed.
 */
function TableBedInner({ g }: { g: FeltGeometry }) {
  const bumper = g.rail * BUMPER_SHARE;
  const wood = tableShape(g, g.rail);
  const lip = tableShape(g, bumper);
  const cloth = tableShape(g, 0);

  return (
    <g pointerEvents="none">
      {/* Wood */}
      <path d={wood} fill="url(#bedWood)" />
      <g clipPath="url(#woodClip)">
        {/* Clipped to the wood's own shape: a turbulence filter fills the
            filter region, which is a rectangle, so on a table with a curved
            bottom an unclipped one paints grain across the floor. */}
        <path d={wood} filter="url(#bedGrain)" opacity={0.28} style={{ mixBlendMode: 'overlay' }} />
      </g>
      {/* The rail's own top light, so its outer edge is rounded over and not cut. */}
      <path d={tableShape(g, g.rail - 1.2)} fill="none" stroke="#8a5f3f" strokeWidth={1.4} opacity={0.38} />

      {/* The padded lip between the wood and the playing surface */}
      <path d={lip} fill="url(#bedBumper)" />

      {/* Cloth */}
      <path d={cloth} fill="url(#cloth)" />
      <g clipPath="url(#clothClip)">
        <path d={cloth} fill="url(#weave)" />
        <path d={cloth} filter="url(#clothMottle)" opacity={0.085} style={{ mixBlendMode: 'overlay' }} />
        <path d={cloth} filter="url(#clothNap)" opacity={0.095} style={{ mixBlendMode: 'overlay' }} />

        {/* The bumper's shadow falling inward onto the cloth. */}
        <path
          d={tableShape(g, 9)}
          fill="none"
          stroke="#000000"
          strokeWidth={20}
          opacity={0.5}
          filter="url(#bumperCast)"
        />
      </g>
    </g>
  );
}

/**
 * Everything over the printed layout but under the cards and chips: the lamp,
 * and the dark the lamp leaves behind.
 *
 * Split from the bed on purpose — light falls on the print, not under it, and
 * the corner falloff has to dim the lettering as well as the cloth.
 *
 * The lamp sways. A few units of drift at a few percent of opacity over twenty
 * seconds is not consciously visible, and it is the difference between a table
 * and a paused screenshot of one. It is a CSS animation on a `<g>` rather than
 * anything driven from React, so it costs one compositor layer and no renders,
 * and it stops dead under `prefers-reduced-motion`.
 */
function TableLightInner({ g }: { g: FeltGeometry }) {
  const bumper = g.rail * BUMPER_SHARE;
  const cloth = tableShape(g, 0);

  return (
    <g pointerEvents="none">
      <g clipPath="url(#clothClip)">
        <g className="lamp-sway">
          <path d={cloth} fill="url(#lampCone)" style={{ mixBlendMode: 'screen' }} />
        </g>
        <path d={cloth} fill="url(#cornerFall)" style={{ mixBlendMode: 'multiply' }} />
      </g>

      {/* Brass trim, last, so nothing dims it. */}
      <path
        d={tableShape(g, bumper * 0.55)}
        fill="none"
        stroke="url(#brass)"
        strokeWidth={Math.max(1.6, g.rail * 0.1)}
        opacity={0.62}
      />
      {/* A dark seam where the cloth is tucked under the lip. */}
      <path d={cloth} fill="none" stroke="#02101f" strokeWidth={1.6} opacity={0.85} />
    </g>
  );
}

/* ------------------------------------------------------------------ *
 * The shadow a card or a chip throws
 * ------------------------------------------------------------------ */

/**
 * A soft contact shadow on the cloth under each seat's hand and the dealer's.
 *
 * The cards are HTML on a layer above this SVG and carry their own box shadow,
 * which is the right shadow for a card lying *on* something and the wrong one
 * for three cards fanned on a soft surface under a single lamp. This is the
 * pool they all sit in.
 */
export function HandShadows({
  g,
  seats,
  dealer,
}: {
  g: FeltGeometry;
  seats: readonly number[];
  /** Whether the dealer is holding cards. A shadow under an empty spot reads
      as a stain on the cloth, which is exactly how the first pass looked. */
  dealer: boolean;
}) {
  const dealerW = g.dealerCard * 2.05;
  const seatW = g.seatCard * 2.05;

  return (
    <g pointerEvents="none" clipPath="url(#clothClip)" opacity={0.5}>
      {dealer ? (
        <ellipse
          cx={g.w / 2}
          cy={g.dealerY + g.dealerCard * 1.3}
          rx={dealerW * 0.62}
          ry={g.dealerCard * 0.42}
          fill="#020b16"
          style={{ filter: 'blur(9px)' }}
        />
      ) : null}
      {seats.map((i) => (
        <ellipse
          key={i}
          cx={g.seats[i].x}
          cy={g.seats[i].y + g.handBottom - g.seatCard * 0.34}
          rx={seatW * 0.6}
          ry={g.seatCard * 0.4}
          fill="#020b16"
          style={{ filter: 'blur(8px)' }}
        />
      ))}
    </g>
  );
}

export const TableBed = React.memo(TableBedInner);
export const TableLight = React.memo(TableLightInner);
