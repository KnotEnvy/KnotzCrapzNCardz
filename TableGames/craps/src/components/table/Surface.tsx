'use client';

/**
 * The table itself: rail, bumper, felt, and the light hanging over all of it.
 *
 * Read-only decoration, like Fx. Nothing here knows about bets, seats or the
 * store — it draws the furniture the rest of the table sits on, in one place,
 * so the printed layout above it can stay pure geometry.
 *
 * The stack, bottom to top, is deliberately the order light actually arrives
 * in: wood, then the padded bumper that casts onto the felt, then the felt's
 * own weave, then the cone from the lamp, then the darkness in the corners the
 * lamp never reaches. Painting them out of that order is what makes a table
 * look like flat vector art instead of a surface.
 */

import { motion, useReducedMotion } from 'motion/react';
import { VIEW } from './layout';

/** The felt's inset from the outer edge of the wood. */
export const RAIL_INSET = 14;
/** The bumper is the padded lip between the wood and the playing surface. */
const BUMPER = 9;

export const FELT = {
  x: RAIL_INSET,
  y: RAIL_INSET,
  w: VIEW.w - RAIL_INSET * 2,
  h: VIEW.h - RAIL_INSET * 2,
  rx: 18,
} as const;

/* ------------------------------------------------------------------ *
 * Paint
 * ------------------------------------------------------------------ */

export function SurfaceDefs() {
  return (
    <>
      {/* ---- Wood ---- */}
      <linearGradient id="wood" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#6b4830" />
        <stop offset="18%" stopColor="#4a3021" />
        <stop offset="55%" stopColor="#33200f" />
        <stop offset="100%" stopColor="#1a0f09" />
      </linearGradient>
      {/* Long grain, stretched along the rail so it reads as a single board. */}
      <filter id="woodGrain" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.006 0.9" numOctaves="3" seed="7" />
        <feColorMatrix type="saturate" values="0" />
        <feComponentTransfer>
          <feFuncA type="linear" slope="0.55" intercept="0" />
        </feComponentTransfer>
      </filter>

      {/* ---- Felt ---- */}
      <radialGradient id="feltFill" cx="50%" cy="34%" r="82%">
        <stop offset="0%" stopColor="#0f6644" />
        <stop offset="40%" stopColor="#0a4e33" />
        <stop offset="74%" stopColor="#063724" />
        <stop offset="100%" stopColor="#02170e" />
      </radialGradient>
      {/* The nap. Fine, isotropic, and barely there — it is a texture you feel
          rather than see, and turning it up reads instantly as noise. */}
      <filter id="feltGrain" x="0" y="0" width="100%" height="100%">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.9"
          numOctaves="4"
          stitchTiles="stitch"
          seed="3"
        />
        <feColorMatrix type="saturate" values="0" />
      </filter>
      {/* A coarser, slower blotch that keeps the felt from looking laminated. */}
      <filter id="feltMottle" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="0.014" numOctaves="3" seed="11" />
        <feColorMatrix type="saturate" values="0" />
        <feComponentTransfer>
          <feFuncA type="linear" slope="0.7" intercept="0" />
        </feComponentTransfer>
      </filter>

      {/* ---- Light ---- */}
      {/* The lamp: hot near the middle, gone well before the rail. */}
      <radialGradient id="lampCone" cx="50%" cy="30%" r="66%">
        <stop offset="0%" stopColor="#ffffff" stopOpacity="0.085" />
        <stop offset="34%" stopColor="#e9ffe9" stopOpacity="0.03" />
        <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
      </radialGradient>
      {/* What the lamp cannot reach. Multiplied, so it darkens the print too. */}
      <radialGradient id="cornerFall" cx="50%" cy="42%" r="74%">
        <stop offset="34%" stopColor="#000000" stopOpacity="0" />
        <stop offset="68%" stopColor="#000a12" stopOpacity="0.3" />
        <stop offset="88%" stopColor="#000610" stopOpacity="0.56" />
        <stop offset="100%" stopColor="#00040c" stopOpacity="0.76" />
      </radialGradient>

      {/* ---- Bumper ---- */}
      <linearGradient id="bumper" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#2a1a12" />
        <stop offset="40%" stopColor="#1a100b" />
        <stop offset="100%" stopColor="#0d0806" />
      </linearGradient>
      {/* The shadow the padded lip throws inward across the playing surface. */}
      <filter id="railCast" x="-12%" y="-12%" width="124%" height="124%">
        <feGaussianBlur stdDeviation="9" />
      </filter>

      {/* ---- Brass ---- */}
      <linearGradient id="brass" x1="0" y1="0" x2="0.35" y2="1">
        <stop offset="0%" stopColor="#f7e9a8" />
        <stop offset="28%" stopColor="#d4af37" />
        <stop offset="52%" stopColor="#8a6f1c" />
        <stop offset="74%" stopColor="#e0bd47" />
        <stop offset="100%" stopColor="#6d5615" />
      </linearGradient>

      {/* Screen-printed ink sits *in* the nap, so it carries a little shadow. */}
      <filter id="printInk" x="-6%" y="-6%" width="112%" height="112%">
        <feDropShadow dx="0" dy="1.2" stdDeviation="1.1" floodColor="#02150d" floodOpacity="0.55" />
      </filter>
    </>
  );
}

/** Clip shared by anything that must not spill past the playing surface. */
export function FeltClip() {
  return (
    <clipPath id="feltClip">
      <rect x={FELT.x} y={FELT.y} width={FELT.w} height={FELT.h} rx={FELT.rx} />
    </clipPath>
  );
}

/* ------------------------------------------------------------------ *
 * The furniture
 * ------------------------------------------------------------------ */

/** Everything under the printed layout. */
export function TableBed() {
  return (
    <g pointerEvents="none">
      {/* Wood */}
      <rect x={0} y={0} width={VIEW.w} height={VIEW.h} rx={26} fill="url(#wood)" />
      <rect
        x={0}
        y={0}
        width={VIEW.w}
        height={VIEW.h}
        rx={26}
        filter="url(#woodGrain)"
        opacity={0.16}
        style={{ mixBlendMode: 'overlay' }}
      />
      {/* The wood's own top light, so the rail has a rounded edge. */}
      <rect
        x={1.5}
        y={1.5}
        width={VIEW.w - 3}
        height={VIEW.h - 3}
        rx={25}
        fill="none"
        stroke="#8a5f3f"
        strokeWidth={1.5}
        opacity={0.4}
      />

      {/* Padded bumper between the wood and the playing surface */}
      <rect
        x={FELT.x - BUMPER}
        y={FELT.y - BUMPER}
        width={FELT.w + BUMPER * 2}
        height={FELT.h + BUMPER * 2}
        rx={FELT.rx + BUMPER}
        fill="url(#bumper)"
      />

      {/* Felt */}
      <rect x={FELT.x} y={FELT.y} width={FELT.w} height={FELT.h} rx={FELT.rx} fill="url(#feltFill)" />
      <rect
        x={FELT.x}
        y={FELT.y}
        width={FELT.w}
        height={FELT.h}
        rx={FELT.rx}
        filter="url(#feltMottle)"
        opacity={0.09}
        style={{ mixBlendMode: 'overlay' }}
      />
      <rect
        x={FELT.x}
        y={FELT.y}
        width={FELT.w}
        height={FELT.h}
        rx={FELT.rx}
        filter="url(#feltGrain)"
        opacity={0.1}
        style={{ mixBlendMode: 'overlay' }}
      />

      {/* The bumper's shadow falling inward onto the felt. Drawn as a fat
          blurred stroke clipped to the felt, which is far cheaper than a real
          inset shadow filter over a surface this size. */}
      <g clipPath="url(#feltClip)">
        <rect
          x={FELT.x - 10}
          y={FELT.y - 10}
          width={FELT.w + 20}
          height={FELT.h + 20}
          rx={FELT.rx + 10}
          fill="none"
          stroke="#000000"
          strokeWidth={22}
          opacity={0.55}
          filter="url(#railCast)"
        />
      </g>
    </g>
  );
}

/**
 * Everything over the printed layout but under the chips: the lamp, and the
 * dark the lamp leaves behind.
 *
 * Split from the bed on purpose — light falls on the print, not under it, and
 * the corner falloff has to dim the lettering as well as the cloth, or the
 * layout floats above the table instead of being printed on it.
 */
export function TableLight() {
  const reduced = useReducedMotion() ?? false;

  return (
    <g pointerEvents="none">
      {/* The lamp swaying, very slightly, the way one over a real table does.
          A few pixels of drift at a few percent opacity: not consciously
          visible, but the table stops looking like a paused screenshot. */}
      {reduced ? (
        <rect
          x={FELT.x}
          y={FELT.y}
          width={FELT.w}
          height={FELT.h}
          rx={FELT.rx}
          fill="url(#lampCone)"
          style={{ mixBlendMode: 'screen' }}
        />
      ) : (
        <motion.rect
          x={FELT.x}
          y={FELT.y}
          width={FELT.w}
          height={FELT.h}
          rx={FELT.rx}
          fill="url(#lampCone)"
          style={{ mixBlendMode: 'screen' }}
          animate={{ x: [-9, 9, -9], opacity: [0.86, 1, 0.86] }}
          transition={{ duration: 19, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}

      <rect
        x={FELT.x}
        y={FELT.y}
        width={FELT.w}
        height={FELT.h}
        rx={FELT.rx}
        fill="url(#cornerFall)"
        style={{ mixBlendMode: 'multiply' }}
      />

      {/* Brass trim, last, so nothing dims it. */}
      <rect
        x={FELT.x - BUMPER + 2}
        y={FELT.y - BUMPER + 2}
        width={FELT.w + BUMPER * 2 - 4}
        height={FELT.h + BUMPER * 2 - 4}
        rx={FELT.rx + BUMPER - 2}
        fill="none"
        stroke="url(#brass)"
        strokeWidth={2.5}
        opacity={0.7}
      />
      <rect
        x={FELT.x - 1}
        y={FELT.y - 1}
        width={FELT.w + 2}
        height={FELT.h + 2}
        rx={FELT.rx + 1}
        fill="none"
        stroke="#0a3b27"
        strokeWidth={2}
        opacity={0.8}
      />
    </g>
  );
}
