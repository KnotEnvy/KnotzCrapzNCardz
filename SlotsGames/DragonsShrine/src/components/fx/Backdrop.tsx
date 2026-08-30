'use client';

/**
 * The shrine behind the glass.
 *
 * A mountain temple after dark, built entirely from one SVG and a handful of
 * keyframes: three ridges of silhouette with parallax between them, a pagoda
 * with lit lanterns on the middle one, mist drifting through the valley, a
 * moon, embers off the fire, and a dragon that passes behind the peaks about
 * once a minute and is gone before you are sure you saw it.
 *
 * Three rules shaped it.
 *
 *   It is behind everything, so it must cost almost nothing. There is no
 *   filter in this file — no feGaussianBlur, no backdrop-filter, no canvas.
 *   Every soft edge is a radial gradient, which the compositor renders once
 *   and never re-rasterises. The only things that move are eleven elements
 *   under CSS transform and opacity animations, which never touch layout and
 *   never invalidate paint. The whole thing is one composited layer that the
 *   main thread stops thinking about the moment it is drawn.
 *
 *   It reacts to the machine rather than to the game. The only thing it reads
 *   is `phase` (plus which feature is open, for the cards that sit between
 *   phases), and it turns that into one of three moods: calm at the base
 *   game, lit and burning through free spins, cold violet inside the link. The
 *   moods are the same drawing with different colours, so the transition
 *   between them is fourteen `fill` and `stop-color` transitions running
 *   together rather than a change of scene.
 *
 *   Parallax follows the pointer, not the scroll. There is nothing to scroll
 *   in a slot cabinet. The listener is passive, coalesced into a single
 *   animation frame, writes two custom properties and nothing else, and is
 *   never attached at all on a touch screen or under reduced motion.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useSlots } from '@/lib/store/useSlots';

/* ------------------------------------------------------------------ *
 * Moods
 * ------------------------------------------------------------------ */

type Mood = 'base' | 'free' | 'hold';

/**
 * One palette per mood, as custom properties.
 *
 * Set on the wrapper rather than switched with a selector so that every layer
 * below can transition its own `fill` independently — a ridge takes 1.4s to
 * warm up, the lantern light takes 0.6s, and the sky takes longer than both,
 * which is what stops the change reading as a cut.
 */
const MOODS: Record<Mood, Record<string, string>> = {
  base: {
    '--bd-sky-0': '#1d1628',
    '--bd-sky-1': '#0b0d15',
    '--bd-sky-2': '#05060a',
    '--bd-horizon': '#2c2140',
    '--bd-far': '#0e1122',
    '--bd-mid': '#080a15',
    '--bd-near': '#03040a',
    '--bd-moon': '#fff0c2',
    '--bd-lantern': '#f2cc5c',
    '--bd-glow': '#e0b33a',
    '--bd-mist': '#3b3652',
    '--bd-mist-a': '0.16',
    '--bd-ember': '#f57f2a',
    '--bd-ember-a': '0.45',
    '--bd-fire-a': '0.1',
    '--bd-star-a': '0.75',
    '--fx-breathe-low': '0.18',
    '--fx-breathe-high': '0.34',
  },
  free: {
    '--bd-sky-0': '#3d1608',
    '--bd-sky-1': '#160b11',
    '--bd-sky-2': '#07050a',
    '--bd-horizon': '#a83a0c',
    '--bd-far': '#1c0e11',
    '--bd-mid': '#100710',
    '--bd-near': '#050208',
    '--bd-moon': '#ffd0a0',
    '--bd-lantern': '#ffd0a0',
    '--bd-glow': '#f57f2a',
    '--bd-mist': '#5e2c18',
    '--bd-mist-a': '0.22',
    '--bd-ember': '#ffab5e',
    '--bd-ember-a': '1',
    '--bd-fire-a': '0.42',
    '--bd-star-a': '0.3',
    '--fx-breathe-low': '0.4',
    '--fx-breathe-high': '0.85',
  },
  hold: {
    '--bd-sky-0': '#2a1046',
    '--bd-sky-1': '#0c0a1d',
    '--bd-sky-2': '#04040c',
    '--bd-horizon': '#57228f',
    '--bd-far': '#160d29',
    '--bd-mid': '#0b0719',
    '--bd-near': '#03030c',
    '--bd-moon': '#e8ecf4',
    '--bd-lantern': '#b47cee',
    '--bd-glow': '#9450d9',
    '--bd-mist': '#2f2452',
    '--bd-mist-a': '0.24',
    '--bd-ember': '#9450d9',
    '--bd-ember-a': '0.22',
    '--bd-fire-a': '0.06',
    '--bd-star-a': '0.9',
    '--fx-breathe-low': '0.12',
    '--fx-breathe-high': '0.3',
  },
};

/* ------------------------------------------------------------------ *
 * The drawing
 *
 * A 1200x700 frame, sliced rather than fitted, so the temple stays centred and
 * the ridges run off both edges at any aspect ratio.
 * ------------------------------------------------------------------ */

const RIDGE_FAR =
  'M0,424 L88,332 L152,370 L242,266 L332,352 L424,300 L520,374 L612,318 L700,382 ' +
  'L804,298 L900,358 L1002,288 L1104,352 L1200,310 L1200,700 L0,700 Z';

const RIDGE_MID =
  'M0,522 L124,470 L222,506 L322,454 L432,500 L520,470 L560,462 L700,462 L742,486 ' +
  'L852,438 L962,492 L1082,450 L1200,498 L1200,700 L0,700 Z';

const RIDGE_NEAR =
  'M0,642 L162,600 L302,634 L462,596 L622,630 L782,592 L942,628 L1102,598 ' +
  'L1200,626 L1200,700 L0,700 Z';

/** An upturned pagoda eave: two curves out to the tips, then a thin soffit. */
function roof(cx: number, y: number, half: number, h: number): string {
  return (
    `M${cx - half},${y} Q${cx - half * 0.5},${y - h * 0.62} ${cx},${y - h} ` +
    `Q${cx + half * 0.5},${y - h * 0.62} ${cx + half},${y} ` +
    `Q${cx + half * 0.74},${y + 7} ${cx + half * 0.5},${y + 4} ` +
    `L${cx - half * 0.5},${y + 4} Q${cx - half * 0.74},${y + 7} ${cx - half},${y} Z`
  );
}

/** Where the lanterns hang. Two per storey on the temple, three in the valley. */
const LANTERNS: { x: number; y: number; r: number; d: number }[] = [
  { x: 594, y: 438, r: 3.2, d: 0 },
  { x: 666, y: 438, r: 3.2, d: 1.1 },
  { x: 604, y: 406, r: 2.6, d: 2.3 },
  { x: 656, y: 406, r: 2.6, d: 0.7 },
  { x: 630, y: 366, r: 2.2, d: 1.7 },
  { x: 252, y: 612, r: 2.4, d: 3.1 },
  { x: 906, y: 606, r: 2.2, d: 1.4 },
  { x: 1058, y: 598, r: 2, d: 2.6 },
];

/** Fixed so the sky does not reshuffle itself on every render. */
const STARS: { x: number; y: number; r: number; d: number }[] = [
  { x: 90, y: 70, r: 1.5, d: 0 },
  { x: 190, y: 140, r: 1.1, d: 1.4 },
  { x: 300, y: 60, r: 1.7, d: 2.7 },
  { x: 380, y: 168, r: 1, d: 0.6 },
  { x: 470, y: 96, r: 1.3, d: 3.4 },
  { x: 560, y: 190, r: 1.1, d: 1.9 },
  { x: 640, y: 54, r: 1.6, d: 2.2 },
  { x: 726, y: 150, r: 1.1, d: 0.3 },
  { x: 830, y: 88, r: 1.4, d: 3.9 },
  { x: 1010, y: 190, r: 1.2, d: 1.1 },
  { x: 1090, y: 96, r: 1.5, d: 2.9 },
  { x: 1160, y: 210, r: 1, d: 0.9 },
];

/** Embers off the fire under the temple. Nine, on staggered loops. */
const EMBERS: { x: number; y: number; r: number; t: number; d: number; dx: number }[] = [
  { x: 596, y: 470, r: 2.2, t: 9, d: 0, dx: 26 },
  { x: 622, y: 476, r: 1.6, t: 11, d: 2.4, dx: -18 },
  { x: 648, y: 468, r: 2, t: 8.5, d: 4.1, dx: 34 },
  { x: 668, y: 478, r: 1.4, t: 12, d: 1.2, dx: -28 },
  { x: 578, y: 480, r: 1.8, t: 10.5, d: 5.6, dx: 44 },
  { x: 690, y: 474, r: 1.7, t: 9.5, d: 3.3, dx: -40 },
  { x: 610, y: 486, r: 1.2, t: 13, d: 6.8, dx: 16 },
  { x: 660, y: 488, r: 1.3, t: 11.5, d: 7.9, dx: -12 },
  { x: 634, y: 466, r: 2.4, t: 8, d: 1.8, dx: 8 },
];

/* ------------------------------------------------------------------ *
 * The component
 * ------------------------------------------------------------------ */

export function Backdrop(): React.JSX.Element {
  const phase = useSlots((s) => s.phase);
  const inFree = useSlots((s) => s.free !== null);
  const inHold = useSlots((s) => s.hold !== null);
  const reduced = useSlots((s) => s.prefs.reducedMotion);
  const root = useRef<HTMLDivElement>(null);

  /*
   * The mood follows the feature rather than the phase alone: the card that
   * announces free spins and the card that totals them are both FEATURE_INTRO
   * or FEATURE_OUTRO, and the shrine should already be burning behind the
   * first and still burning behind the second.
   */
  const mood: Mood = inHold ? 'hold' : inFree ? 'free' : phase === 'HOLD' ? 'hold' : 'base';

  /**
   * Stamped on <html> so the stylesheet can honour the in-game preference and
   * not only the OS one. Done here because the backdrop is the first thing
   * mounted, and it is a document-level fact rather than this component's.
   */
  useEffect(() => {
    const el = document.documentElement;
    el.setAttribute('data-reduced-motion', reduced ? 'true' : 'false');
  }, [reduced]);

  /*
   * Pointer parallax. Passive, coalesced into one frame, and only ever writing
   * two custom properties — no React state, so moving the mouse across the
   * cabinet does not re-render a single component.
   */
  useEffect(() => {
    if (reduced) return;
    if (typeof window === 'undefined') return;
    if (!window.matchMedia('(pointer: fine)').matches) return;
    const el = root.current;
    if (!el) return;

    let frame = 0;
    let px = 0;
    let py = 0;
    const apply = () => {
      frame = 0;
      el.style.setProperty('--fx-px', px.toFixed(3));
      el.style.setProperty('--fx-py', py.toFixed(3));
    };
    const onMove = (e: PointerEvent) => {
      px = e.clientX / window.innerWidth - 0.5;
      py = e.clientY / window.innerHeight - 0.5;
      if (frame === 0) frame = window.requestAnimationFrame(apply);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [reduced]);

  const style = useMemo(
    () => ({ ...MOODS[mood], '--fx-px': '0', '--fx-py': '0' }) as React.CSSProperties,
    [mood],
  );

  /** Parallax depth per layer: further away moves less, as it should. */
  const par = (k: number): React.CSSProperties =>
    ({
      transform: `translate3d(calc(var(--fx-px) * ${k}px), calc(var(--fx-py) * ${k * 0.4}px), 0)`,
      willChange: 'transform',
    }) as React.CSSProperties;

  return (
    <div
      ref={root}
      aria-hidden
      data-mood={mood}
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden select-none"
      style={style}
    >
      <svg
        className="h-full w-full"
        viewBox="0 0 1200 700"
        preserveAspectRatio="xMidYMid slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Every soft edge in the file is one of these. No filters. */}
          <linearGradient id="bdSky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--bd-sky-0)" style={{ transition: 'stop-color 1.8s ease' }} />
            <stop offset="55%" stopColor="var(--bd-sky-1)" style={{ transition: 'stop-color 1.8s ease' }} />
            <stop offset="100%" stopColor="var(--bd-sky-2)" style={{ transition: 'stop-color 1.8s ease' }} />
          </linearGradient>

          <radialGradient id="bdMoonGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--bd-moon)" stopOpacity="0.42" />
            <stop offset="45%" stopColor="var(--bd-moon)" stopOpacity="0.1" />
            <stop offset="100%" stopColor="var(--bd-moon)" stopOpacity="0" />
          </radialGradient>

          <radialGradient id="bdLantern" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--bd-glow)" stopOpacity="0.85" />
            <stop offset="40%" stopColor="var(--bd-glow)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--bd-glow)" stopOpacity="0" />
          </radialGradient>

          <radialGradient id="bdFire" cx="50%" cy="70%" r="60%">
            <stop offset="0%" stopColor="var(--bd-horizon)" stopOpacity="0.9" />
            <stop offset="55%" stopColor="var(--bd-horizon)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="var(--bd-horizon)" stopOpacity="0" />
          </radialGradient>

          <radialGradient id="bdMist" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--bd-mist)" stopOpacity="0.55" />
            <stop offset="60%" stopColor="var(--bd-mist)" stopOpacity="0.2" />
            <stop offset="100%" stopColor="var(--bd-mist)" stopOpacity="0" />
          </radialGradient>

          <radialGradient id="bdEmber" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="var(--bd-ember)" stopOpacity="1" />
            <stop offset="55%" stopColor="var(--bd-ember)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--bd-ember)" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* --- sky ------------------------------------------------- */}
        <rect x="0" y="0" width="1200" height="700" fill="url(#bdSky)" />

        <g style={{ opacity: 'var(--bd-star-a)', transition: 'opacity 1.6s ease' }}>
          {STARS.map((s, i) => (
            <circle
              key={i}
              className="fx-flicker fx-decorative"
              cx={s.x}
              cy={s.y}
              r={s.r}
              fill="#e8ecf4"
              style={{ animationDelay: `${s.d}s`, animationDuration: '5.5s' }}
            />
          ))}
        </g>

        {/* The moon, and the light it throws on the haze around it. */}
        <g style={par(-10)}>
          <circle cx="962" cy="126" r="150" fill="url(#bdMoonGlow)" />
          <circle
            cx="962"
            cy="126"
            r="44"
            fill="var(--bd-moon)"
            opacity="0.9"
            style={{ transition: 'fill 1.6s ease' }}
          />
          {/* Two seas, so it is a moon rather than a disc. */}
          <circle cx="948" cy="112" r="9" fill="var(--bd-sky-1)" opacity="0.16" />
          <circle cx="974" cy="140" r="6" fill="var(--bd-sky-1)" opacity="0.13" />
        </g>

        {/* --- the dragon ------------------------------------------ *
            Between the far ridge and the middle one, so the peaks cut across
            it and it is never fully in view. It crosses once every 47 seconds
            and is absent for the last third of that. */}
        <g
          className="fx-cross fx-decorative"
          style={
            {
              '--fx-cross-time': '47s',
              '--fx-cross-opacity': mood === 'free' ? '0.6' : '0.34',
            } as React.CSSProperties
          }
        >
          <g transform="translate(-40 176) scale(1.5)" fill="var(--bd-near)">
            {/* Body: one ribbon, waving. */}
            <path
              d="M2,64 C48,22 98,96 150,52 C188,20 224,58 266,32 L274,50
                 C230,80 194,44 156,74 C104,116 50,40 8,82 Z"
              opacity="0.95"
            />
            {/* Wings, above and below the spine. */}
            <path d="M118,54 L142,10 L168,52 Z" opacity="0.8" />
            <path d="M74,66 L88,30 L112,64 Z" opacity="0.55" />
            {/* Head and horn. */}
            <path d="M264,30 L294,20 L302,36 L276,48 Z" />
            <path d="M282,20 L296,6 L292,22 Z" />
            {/* Tail fin. */}
            <path d="M2,64 L-16,50 L-10,76 Z" opacity="0.7" />
          </g>
        </g>

        {/* --- ridges ---------------------------------------------- */}
        <g style={par(14)}>
          <path d={RIDGE_FAR} fill="var(--bd-far)" style={{ transition: 'fill 1.4s ease' }} />
        </g>

        {/* The fire in the valley, breathing. Free spins turns it up; the link
            all but puts it out. */}
        <ellipse
          className="fx-breathe fx-decorative"
          cx="630"
          cy="486"
          rx="330"
          ry="120"
          fill="url(#bdFire)"
          style={{ '--fx-breathe-time': '7s' } as React.CSSProperties}
        />

        <g style={par(28)}>
          <path d={RIDGE_MID} fill="var(--bd-mid)" style={{ transition: 'fill 1.4s ease' }} />

          {/* The temple: three storeys, each a body and an upturned roof. */}
          <g fill="var(--bd-mid)" style={{ transition: 'fill 1.4s ease' }}>
            <rect x="588" y="430" width="84" height="34" />
            <path d={roof(630, 430, 74, 26)} />
            <rect x="600" y="398" width="60" height="32" />
            <path d={roof(630, 398, 58, 22)} />
            <rect x="612" y="372" width="36" height="26" />
            <path d={roof(630, 372, 44, 18)} />
            <rect x="628" y="350" width="4" height="22" />
            <circle cx="630" cy="348" r="4" />
          </g>

          {/* Lanterns: a soft pool of light and a hard little core. */}
          {LANTERNS.map((l, i) => (
            <g
              key={i}
              className="fx-flicker fx-decorative"
              style={{ animationDelay: `${l.d}s`, animationDuration: '4.2s' }}
            >
              <circle cx={l.x} cy={l.y} r={l.r * 7} fill="url(#bdLantern)" />
              <circle
                cx={l.x}
                cy={l.y}
                r={l.r}
                fill="var(--bd-lantern)"
                style={{ transition: 'fill 0.7s ease' }}
              />
            </g>
          ))}

          {/* Embers off the fire. Nine elements on nine different loops, which
              is enough to read as many and cheap enough to be free. */}
          <g style={{ opacity: 'var(--bd-ember-a)', transition: 'opacity 1.4s ease' }}>
            {EMBERS.map((e, i) => (
              <circle
                key={i}
                className="fx-rise fx-decorative"
                cx={e.x}
                cy={e.y}
                r={e.r}
                fill="url(#bdEmber)"
                style={
                  {
                    '--fx-rise-time': `${e.t}s`,
                    '--fx-rise-y': '-210px',
                    '--fx-rise-x': `${e.dx}px`,
                    '--fx-rise-opacity': '0.9',
                    animationDelay: `${e.d}s`,
                  } as React.CSSProperties
                }
              />
            ))}
          </g>
        </g>

        {/* --- mist ------------------------------------------------ *
            Three bands at three speeds, drifting in alternation so none of
            them ever has to wrap. */}
        <g style={{ opacity: 'var(--bd-mist-a)', transition: 'opacity 1.4s ease' }}>
          <ellipse
            className="fx-drift fx-decorative"
            cx="380"
            cy="540"
            rx="520"
            ry="72"
            fill="url(#bdMist)"
            style={{ '--fx-drift-time': '44s' } as React.CSSProperties}
          />
          <ellipse
            className="fx-drift fx-decorative"
            cx="860"
            cy="576"
            rx="600"
            ry="60"
            fill="url(#bdMist)"
            style={{ '--fx-drift-time': '61s', animationDelay: '-20s' } as React.CSSProperties}
          />
          <ellipse
            className="fx-drift fx-decorative"
            cx="600"
            cy="628"
            rx="700"
            ry="54"
            fill="url(#bdMist)"
            style={{ '--fx-drift-time': '78s', animationDelay: '-45s' } as React.CSSProperties}
          />
        </g>

        <g style={par(46)}>
          <path d={RIDGE_NEAR} fill="var(--bd-near)" style={{ transition: 'fill 1.4s ease' }} />
        </g>

        {/* The cabinet's own vignette, so the reels always sit on darkness
            whatever the shrine behind them is doing. */}
        <rect x="0" y="0" width="1200" height="700" fill="url(#bdVignette)" />
        <defs>
          <radialGradient id="bdVignette" cx="50%" cy="46%" r="72%">
            <stop offset="45%" stopColor="#05060a" stopOpacity="0" />
            <stop offset="100%" stopColor="#05060a" stopOpacity="0.72" />
          </radialGradient>
        </defs>
      </svg>
    </div>
  );
}
