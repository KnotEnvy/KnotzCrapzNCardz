'use client';

/**
 * The reel window.
 *
 * Everything the player is actually here to look at: five bands of the real
 * strips, a cabinet to hold them, glass over the front, and the overlays that
 * say what just happened. It is the only component in the game that is allowed
 * to be expensive, and it earns that by being cheap in the one place that
 * matters -- while the reels are moving, this component does not render.
 *
 * How a spin runs through here:
 *
 *   1. The store flips `reels[i]` to `SPINNING`. Each {@link ReelController}
 *      winds up and runs; a single rAF loop writes five transforms a frame.
 *   2. A reel the engine flagged goes to `TEASE`. That reel decays to a crawl
 *      over `TIMING.anticipation` and hangs a third of a symbol short of its
 *      stop; the rest of the window dims behind it.
 *   3. `LANDED` glides it in, past the stop and back. At the moment of arrival
 *      the band hides and the *face* -- the real `grid` column, wilds and all
 *      -- takes over and plays the bounce.
 *   4. The presentation lights lines through `highlight` and `dimmed`, and the
 *      live region says out loud what a sighted player can see.
 *
 * Sizing is one ResizeObserver and a little arithmetic. There are no
 * breakpoints: the window takes whatever box it is given, works out the
 * largest whole-pixel cell that fits five across and four down, and lays
 * everything else out from that. Portrait, landscape, a phone in a split view
 * -- all the same code path.
 */

import * as React from 'react';
import { useSlots } from '@/lib/store/useSlots';
import { STRIPS } from '@/lib/engine/strips';
import { REELS, ROWS, type SymbolId } from '@/lib/engine/types';
import { TIMING, TURBO_SCALE } from '@/lib/engine/config';
import { money } from '@/lib/format';
import { ALL_SYMBOLS, SYMBOL_META } from '@/components/symbols/palette';
import { SymbolBody } from '@/components/symbols/art';
import { DragonReelArt } from '@/components/symbols/DragonReel';
import type { SymbolState } from '@/components/symbols/Symbol';
import { Frame } from './Frame';
import { OrbLayer, PaylineOverlay, gridHeight, gridWidth, type Geometry } from './Overlays';
import { Reel } from './Reel';
import { BLUR_LEVELS, ReelController, ReelDriver, type ReelTempo } from './motion';
import './reels.css';

/* ------------------------------------------------------------------ *
 * Layout
 * ------------------------------------------------------------------ */

/** The gap between reels, as a fraction of a cell. */
const GAP_RATIO = 0.055;
/** The frame's thickness, as a fraction of the shorter side of the box. */
const FRAME_RATIO = 0.042;
/** Below this a symbol stops being readable; above it, a cabinet looks coarse. */
const CELL_MIN = 34;
const CELL_MAX = 200;

interface Layout {
  cell: number;
  gap: number;
  inset: number;
  width: number;
  height: number;
}

const EMPTY_LAYOUT: Layout = { cell: 0, gap: 0, inset: 0, width: 0, height: 0 };

/**
 * The largest window that fits in `w` x `h`.
 *
 * Cells are whole pixels. That is not fussiness: a fractional cell puts the
 * band's recycled rows on sub-pixel boundaries, and a sub-pixel seam between
 * two symbols on a moving strip is a flickering grey line that is impossible
 * to un-see once noticed.
 */
function fit(w: number, h: number): Layout {
  if (w < 40 || h < 40) return EMPTY_LAYOUT;
  const inset = Math.round(Math.min(Math.max(Math.min(w, h) * FRAME_RATIO, 9), 24));
  const usableW = w - inset * 2;
  const usableH = h - inset * 2;
  const raw = Math.min(usableW / (REELS + (REELS - 1) * GAP_RATIO), usableH / ROWS);
  const cell = Math.max(CELL_MIN, Math.min(CELL_MAX, Math.floor(raw)));
  const gap = Math.max(2, Math.round(cell * GAP_RATIO));
  return {
    cell,
    gap,
    inset,
    width: inset * 2 + REELS * cell + (REELS - 1) * gap,
    height: inset * 2 + ROWS * cell,
  };
}

/* ------------------------------------------------------------------ *
 * Blur
 * ------------------------------------------------------------------ */

/**
 * Motion blur, as a fraction of a cell per level.
 *
 * Vertical only -- `stdDeviation="0 n"` -- because a reel smears along the
 * direction it travels and an isotropic blur bleeds symbols sideways into the
 * separators, which reads as being out of focus rather than being fast.
 * Expressed against the cell size so the smear is the same *fraction of a
 * symbol* on a phone and on a desktop.
 */
const BLUR_FRACTION = [0, 0.02, 0.05, 0.09, 0.135, 0.185];

/* ------------------------------------------------------------------ *
 * The window
 * ------------------------------------------------------------------ */

export function ReelWindow({ className }: { className?: string }): React.JSX.Element {
  /* ---- the store, selected one field at a time ---- */
  const reels = useSlots((s) => s.reels);
  const stops = useSlots((s) => s.stops);
  const stripSet = useSlots((s) => s.strips);
  const grid = useSlots((s) => s.grid);
  const highlight = useSlots((s) => s.highlight);
  const dimmed = useSlots((s) => s.dimmed);
  const orbs = useSlots((s) => s.orbs);
  const result = useSlots((s) => s.result);
  const phase = useSlots((s) => s.phase);
  const spinToken = useSlots((s) => s.spinToken);
  const win = useSlots((s) => s.win);
  const turbo = useSlots((s) => s.prefs.turbo);
  const reducedMotion = useSlots((s) => s.prefs.reducedMotion);
  const showLines = useSlots((s) => s.prefs.showLines);

  /* ---- sizing ---- */
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [layout, setLayout] = React.useState<Layout>(EMPTY_LAYOUT);

  React.useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = (w: number, h: number) => {
      const next = fit(w, h);
      setLayout((prev) =>
        prev.cell === next.cell && prev.gap === next.gap && prev.inset === next.inset ? prev : next,
      );
    };
    const box = el.getBoundingClientRect();
    measure(box.width, box.height);
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const size = entry.contentRect;
      measure(size.width, size.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ---- the motion engine ---- */
  const driverRef = React.useRef<ReelDriver | null>(null);
  if (driverRef.current === null) driverRef.current = new ReelDriver();

  const controllers = React.useRef<(ReelController | null)[]>(new Array(REELS).fill(null));

  const register = React.useCallback((index: number, controller: ReelController | null) => {
    controllers.current[index] = controller;
    driverRef.current?.attach(
      controllers.current.filter((c): c is ReelController => c !== null),
    );
  }, []);

  React.useEffect(() => {
    const driver = driverRef.current;
    return () => driver?.stop();
  }, []);

  const tempo = React.useMemo<ReelTempo>(() => ({ turbo, reducedMotion }), [turbo, reducedMotion]);

  /**
   * Status changes are commands.
   *
   * Diffing against the previous statuses rather than reacting to `phase` is
   * what makes this robust to everything the player can do: a slam stop fires
   * four `LANDED`s in one tick and each reel simply gets told to land, in
   * order, from wherever it happens to be.
   */
  const previous = React.useRef<string[]>(new Array<string>(REELS).fill('IDLE'));
  React.useEffect(() => {
    let woke = false;
    for (let i = 0; i < REELS; i++) {
      const status = reels[i];
      if (status === previous.current[i]) continue;
      const controller = controllers.current[i];
      if (!controller) continue;
      if (status === 'SPINNING') {
        controller.start();
        woke = true;
      } else if (status === 'TEASE') {
        controller.tease(stops[i] ?? 0);
        woke = true;
      } else if (status === 'LANDED') {
        controller.land(stops[i] ?? 0);
        woke = true;
      }
    }
    previous.current = reels.slice();
    if (woke) driverRef.current?.wake();
  }, [reels, stops]);

  /* ---- which reels have physically come to rest ---- */
  /*
   * Reset on a new spin, adjusted during render rather than in an effect.
   *
   * An effect would paint one frame with the previous spin's settled reels
   * still marked as landed -- a visible flash of stale win frames on a fast
   * respin -- and then re-render to correct it. React's documented pattern for
   * "this state derives from a prop that changed" is to compare against the
   * value the state was computed for and set both during render, which throws
   * the in-progress render away before it ever reaches the DOM.
   */
  const [settledMask, setSettledMask] = React.useState(0);
  const [settledFor, setSettledFor] = React.useState(spinToken);
  if (settledFor !== spinToken) {
    setSettledFor(spinToken);
    setSettledMask(0);
  }
  const onSettle = React.useCallback((index: number) => {
    setSettledMask((mask) => mask | (1 << index));
  }, []);

  /* ---- presentation state per cell ---- */
  const cellStates = React.useMemo<SymbolState[][]>(() => {
    const lit = new Set(highlight?.cells.map((c) => c.reel * ROWS + c.row) ?? []);
    const veiled = new Set(dimmed.map((c) => c.reel * ROWS + c.row));
    return Array.from({ length: REELS }, (_, reel) =>
      Array.from({ length: ROWS }, (_, row) => {
        const key = reel * ROWS + row;
        if (lit.has(key)) return 'win';
        if (veiled.has(key)) return 'dim';
        return 'idle';
      }),
    );
  }, [highlight, dimmed]);

  const bands = STRIPS[stripSet];
  const teasing = reels.some((s) => s === 'TEASE');
  const settleMs = Math.round(TIMING.reelSettle * (turbo ? TURBO_SCALE : 1));

  const geometry = React.useMemo<Geometry>(
    () => ({ cell: layout.cell, gap: layout.gap, reels: REELS, rows: ROWS }),
    [layout.cell, layout.gap],
  );

  /**
   * Dragon reels.
   *
   * Only shown on a reel that is standing still: a full-height dragon over a
   * spinning band would be a poster taped to a moving object. `settledMask`
   * rather than the store's status, because the store calls a reel landed the
   * instant it schedules the stop and the reel is still gliding for another
   * fifth of a second after that.
   */
  const dragonReels = React.useMemo(() => {
    const list = result?.dragonReels ?? [];
    return list.filter((reel) => reducedMotion || (settledMask & (1 << reel)) !== 0);
  }, [result, settledMask, reducedMotion]);

  /* ---- what a screen reader is told ---- */
  const allSettled = settledMask === (1 << REELS) - 1;
  const announcement = React.useMemo(() => {
    if (!allSettled || !result) return '';
    return describe(result.grid, win, result.lineWins.length, result.scatter?.count ?? 0, result.trigger?.feature ?? null);
  }, [allSettled, result, win]);

  const boardText = React.useMemo(() => boardSummary(grid), [grid]);

  const ready = layout.cell > 0;

  return (
    <div ref={rootRef} className={className ? `ds-window-root ${className}` : 'ds-window-root'}>
      {/* The atlas. Twelve ghost symbols and six blur filters, defined once
          and cloned by every band cell on the machine -- thirty `<use>`
          elements in place of a few thousand nodes of duplicated art. */}
      <svg className="ds-sr" aria-hidden="true" focusable="false" width={0} height={0}>
        <defs>
          {ALL_SYMBOLS.map((id) => (
            <g id={`dsGhost-${id}`} key={id}>
              <SymbolBody id={id} ghost />
            </g>
          ))}
          {Array.from({ length: BLUR_LEVELS - 1 }, (_, i) => (
            <filter
              key={i}
              id={`dsReelBlur${i + 1}`}
              x="-10%"
              y="-30%"
              width="120%"
              height="160%"
              colorInterpolationFilters="sRGB"
            >
              <feGaussianBlur stdDeviation={`0 ${(layout.cell * BLUR_FRACTION[i + 1]).toFixed(2)}`} />
            </filter>
          ))}
        </defs>
      </svg>

      {ready ? (
        <div
          className="ds-cabinet no-select"
          data-tease={teasing ? '1' : '0'}
          data-reduced-motion={reducedMotion ? '1' : '0'}
          data-phase={phase}
          role="group"
          aria-label="Reel window, five reels of four symbols"
          aria-describedby="ds-board-text"
          style={
            {
              width: layout.width,
              height: layout.height,
              '--cell-size': `${layout.cell}px`,
              '--reel-gap': `${layout.gap}px`,
              '--ds-rows': ROWS,
            } as React.CSSProperties
          }
        >
          <div
            className="ds-grid"
            style={{
              left: layout.inset,
              top: layout.inset,
              width: gridWidth(geometry),
              height: gridHeight(geometry),
            }}
          >
            {Array.from({ length: REELS }, (_, i) => (
              <Reel
                key={i}
                index={i}
                status={reels[i] ?? 'IDLE'}
                strip={bands[i]}
                stop={stops[i] ?? 0}
                column={grid[i] ?? []}
                states={cellStates[i]}
                cellPx={layout.cell}
                tempo={tempo}
                settleMs={settleMs}
                register={register}
                onSettle={onSettle}
              />
            ))}
          </div>

          {/* Overlays share the grid's box, so every coordinate in them is the
              same coordinate the reels use. */}
          <div
            className="ds-overlay"
            style={{
              left: layout.inset,
              top: layout.inset,
              width: gridWidth(geometry),
              height: gridHeight(geometry),
            }}
          >
            {dragonReels.map((reel) => (
              <div
                key={reel}
                className="ds-dragon-reel"
                style={{
                  left: reel * (layout.cell + layout.gap),
                  top: 0,
                  width: layout.cell,
                  height: layout.cell * ROWS,
                }}
              >
                <DragonReelArt />
              </div>
            ))}
            <OrbLayer geometry={geometry} orbs={orbs} />
            <PaylineOverlay geometry={geometry} highlight={highlight} showLines={showLines} />
          </div>

          <div className="ds-glass" aria-hidden="true" />
          <div className="ds-sheen" aria-hidden="true" />
          <Frame
            width={layout.width}
            height={layout.height}
            inset={layout.inset}
            cell={layout.cell}
            gap={layout.gap}
            reels={REELS}
          />
        </div>
      ) : null}

      {/* None of the above is text, so this is the entire game for a screen
          reader. `polite` rather than `assertive`: a spin every few seconds
          interrupting itself would be unusable. */}
      <div className="ds-sr" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
      <div className="ds-sr" id="ds-board-text">
        {boardText}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Words
 * ------------------------------------------------------------------ */

/** The landed board, reel by reel, for the description the window carries. */
function boardSummary(grid: SymbolId[][]): string {
  return grid
    .map((column, i) => `Reel ${i + 1}: ${column.map((s) => SYMBOL_META[s].label).join(', ')}.`)
    .join(' ');
}

/** What the spin did, in one sentence. */
function describe(
  grid: SymbolId[][],
  amount: number,
  lines: number,
  scatters: number,
  feature: string | null,
): string {
  const parts: string[] = [];
  if (amount > 0) {
    parts.push(
      lines > 0
        ? `Win ${money(amount)} on ${lines} ${lines === 1 ? 'line' : 'lines'}.`
        : `Win ${money(amount)}.`,
    );
  } else {
    parts.push('No win.');
  }
  if (scatters >= 3) parts.push(`${scatters} golden pearls.`);
  if (feature === 'FREE_SPINS') parts.push('Free spins triggered.');
  if (feature === 'HOLD_AND_WIN') parts.push('Hold and win triggered.');
  parts.push(boardSummary(grid));
  return parts.join(' ');
}
