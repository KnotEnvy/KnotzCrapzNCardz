'use client';

/**
 * One reel: a band that spins and a face that rests.
 *
 * The split is the whole design. While the reel is moving the player is
 * looking at the *band* -- a recycled strip of six cheap `<use>` clones being
 * translated by the rAF loop, blurred, and never touched by React. When it
 * stops, the band is hidden and the *face* takes over: four full-detail
 * symbols read straight out of `grid`, which is the board the engine actually
 * paid, wilds and all.
 *
 * Two layers rather than one because the band and the board are not the same
 * thing and pretending they are is a bug waiting to happen. The band shows the
 * printed strip; the grid can differ from it -- Dragon Rage scatters wilds
 * across a landed board, a dragon reel replaces a whole column. Handing over
 * at the moment of arrival is what lets both be true.
 *
 * React renders this component exactly twice per spin: once when the status
 * changes, once when it comes to rest. Everything in between is DOM writes.
 */

import * as React from 'react';
import type { ReelStatus } from '@/lib/store/contract';
import type { SymbolId } from '@/lib/engine/types';
import { ROWS } from '@/lib/engine/types';
import { SymbolArt, type SymbolState } from '@/components/symbols/Symbol';
import { BAND_CELLS, ReelController, type ReelTempo } from './motion';

export interface ReelProps {
  index: number;
  status: ReelStatus;
  /** The printed band this reel is currently showing. */
  strip: SymbolId[];
  /** Where the band is landing this spin. */
  stop: number;
  /** The landed column, from the store's grid. */
  column: SymbolId[];
  /** Per-row presentation state for the face layer. */
  states: readonly SymbolState[];
  /** One cell, in CSS pixels. */
  cellPx: number;
  tempo: ReelTempo;
  /** How long the settle bounce runs, milliseconds. */
  settleMs: number;
  register: (index: number, controller: ReelController | null) => void;
  onSettle: (index: number) => void;
}

/** The blur filters declared once by the window. Level 0 is no filter at all. */
function blurFilter(level: number): string {
  return level <= 0 ? 'none' : `url(#dsReelBlur${level})`;
}

export const Reel = React.memo(function Reel({
  index,
  status,
  strip,
  stop,
  column,
  states,
  cellPx,
  tempo,
  settleMs,
  register,
  onSettle,
}: ReelProps): React.JSX.Element {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const bandRef = React.useRef<HTMLDivElement>(null);
  const cellRefs = React.useRef<(HTMLDivElement | null)[]>([]);
  const useRefs = React.useRef<(SVGUseElement | null)[]>([]);
  const shownRef = React.useRef<(SymbolId | null)[]>(new Array(BAND_CELLS).fill(null));

  /** The live cell size, read by the hooks without re-creating the controller. */
  const sizeRef = React.useRef(cellPx);
  sizeRef.current = cellPx;

  const settleRef = React.useRef(onSettle);
  settleRef.current = onSettle;

  /** How long the settle bounce runs. Read by the timeout inside the hooks. */
  const settleMsRef = React.useRef(settleMs);
  settleMsRef.current = settleMs;

  const controllerRef = React.useRef<ReelController | null>(null);
  const [landing, setLanding] = React.useState(false);
  const landTimer = React.useRef<number | null>(null);

  /*
   * The controller is built once and lives for the life of the reel.
   *
   * It is created in a layout effect rather than in a `useMemo` because it
   * writes to DOM nodes on construction, and the refs it writes to do not
   * exist until React has committed. The empty dependency list is deliberate
   * and the lint rule is right to be suspicious of it: everything that can
   * change afterwards is fed in through a ref or an explicit setter below.
   */
  React.useLayoutEffect(() => {
    const controller = new ReelController(
      {
        place: (y) => {
          const band = bandRef.current;
          if (band) band.style.transform = `translate3d(0, ${y * sizeRef.current}px, 0)`;
        },
        fill: (slot, row, symbol) => {
          const cell = cellRefs.current[slot];
          if (cell) cell.style.transform = `translate3d(0, ${row * sizeRef.current}px, 0)`;
          if (shownRef.current[slot] !== symbol) {
            shownRef.current[slot] = symbol;
            useRefs.current[slot]?.setAttribute('href', `#dsGhost-${symbol}`);
          }
        },
        blur: (level) => {
          const band = bandRef.current;
          if (band) band.style.filter = blurFilter(level);
        },
        moving: (on) => {
          rootRef.current?.setAttribute('data-moving', on ? '1' : '0');
        },
        settled: () => {
          const root = rootRef.current;
          if (root) {
            // Restart the bounce animation even if the attribute is already
            // set: two spins in a row must both bounce.
            root.removeAttribute('data-land');
            root.getBoundingClientRect();
            root.setAttribute('data-land', '1');
          }
          setLanding(true);
          if (landTimer.current !== null) window.clearTimeout(landTimer.current);
          landTimer.current = window.setTimeout(() => {
            rootRef.current?.removeAttribute('data-land');
            setLanding(false);
          }, settleMsRef.current);
          settleRef.current(index);
        },
      },
      strip,
      tempo,
    );
    controllerRef.current = controller;
    controller.seat(stop);
    register(index, controller);
    return () => {
      register(index, null);
      controllerRef.current = null;
      if (landTimer.current !== null) window.clearTimeout(landTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, register]);

  /* Tempo and band changes are pushed in rather than rebuilding the reel. */
  React.useEffect(() => {
    controllerRef.current?.setTempo(tempo);
  }, [tempo]);

  React.useEffect(() => {
    const controller = controllerRef.current;
    // Only reseat a reel that is standing still: a band change mid-spin is a
    // feature transition, and those never happen with the reels in motion.
    if (controller && controller.atRest) controller.setStrip(strip, stop);
  }, [strip, stop]);

  React.useLayoutEffect(() => {
    controllerRef.current?.refresh();
  }, [cellPx]);

  return (
    <div
      ref={rootRef}
      className="ds-reel"
      data-reel={index}
      data-status={status}
      data-moving="0"
      style={
        {
          '--ds-settle': `${settleMs}ms`,
          // The face layer springs up from exactly where the band left off.
          '--ds-over': `${(cellPx * 0.22).toFixed(2)}px`,
        } as React.CSSProperties
      }
    >
      <div className="ds-band" ref={bandRef} aria-hidden="true">
        {Array.from({ length: BAND_CELLS }, (_, slot) => (
          <div
            key={slot}
            className="ds-band-cell"
            ref={(el) => {
              cellRefs.current[slot] = el;
            }}
          >
            <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
              <use
                ref={(el) => {
                  useRefs.current[slot] = el;
                }}
                href="#dsGhost-COIN"
              />
            </svg>
          </div>
        ))}
      </div>

      {/* The board. `aria-hidden` because twenty symbol labels read out one by
          one is not how a screen reader user wants to hear a spin -- the live
          region on the window says what happened instead. */}
      <div className="ds-face" aria-hidden="true">
        {Array.from({ length: ROWS }, (_, row) => (
          <SymbolArt
            key={row}
            id={column[row] ?? 'COIN'}
            state={landing ? 'land' : (states[row] ?? 'idle')}
          />
        ))}
      </div>

      <div className="ds-impact" aria-hidden="true" />
      <div className="ds-reel-tease" aria-hidden="true" />
    </div>
  );
});
