'use client';

/**
 * Table juice: the layers that fire when a roll resolves.
 *
 * Everything here is read-only decoration drawn inside the felt's own SVG, so
 * it scales with the table and can never be out of register with the layout it
 * is lighting up. Nothing in this file touches the store or the engine — it is
 * handed a settlement list and a roll record and draws what just happened.
 *
 * Each layer is keyed on the roll number rather than wrapped in AnimatePresence:
 * a settled roll's effects are supposed to play exactly once and end at zero
 * opacity, so mounting them fresh per roll is both simpler and cheaper than
 * asking for an exit animation on something that is already invisible.
 *
 * All of it degrades under prefers-reduced-motion: the travel and the shake
 * drop out entirely and the flashes become plain cross-fades, which carry the
 * same information without moving anything across the screen.
 */

import { motion, useReducedMotion } from 'motion/react';
import * as React from 'react';
import { ChipStack } from './Chip';
import { BANK, RAIL, VIEW, anchorFor, cellFor, rectFor, seatOffset, type Rect } from './layout';
import type { RollRecord, SeatId, Settlement } from '@/lib/engine/types';

/*
 * Each layer's root carries a `data-fx` hook. Nothing in the app reads it; it
 * exists so that "the win flash fired" can be asserted from outside the React
 * tree rather than inferred from a screenshot taken at the right millisecond.
 * A blank effect layer is exactly the class of bug that a green build hides.
 */

/** Beyond this many chips in the air at once it reads as confetti, not money. */
const MAX_FLIGHTS = 12;

const WIN_INK = '#4ade80';
const LOSE_INK = '#f87171';

const SEAT_RING: Record<SeatId, string> = { A: '#f0b429', B: '#38bdf8' };

/* ------------------------------------------------------------------ *
 * Shared paint
 * ------------------------------------------------------------------ */

/** Rendered inside the felt's own defs block. */
export function FxDefs() {
  return (
    <>
      <filter id="fxGlow" x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="9" />
      </filter>
      {/* Seven out: the light goes out at the edges first. */}
      <radialGradient id="fxSevenOut" cx="50%" cy="52%" r="74%">
        <stop offset="30%" stopColor="#450a0a" stopOpacity="0" />
        <stop offset="100%" stopColor="#b91c1c" stopOpacity="0.8" />
      </radialGradient>
      {/* A winner on the point: warm light from over the table. */}
      <radialGradient id="fxWinnerWash" cx="50%" cy="45%" r="70%">
        <stop offset="0%" stopColor="#fde68a" stopOpacity="0.34" />
        <stop offset="100%" stopColor="#d4af37" stopOpacity="0" />
      </radialGradient>
      {/* The hot core of a burst, at the box the hand was decided on. */}
      <radialGradient id="fxBurstCore" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
        <stop offset="35%" stopColor="#ffe9a3" stopOpacity="0.6" />
        <stop offset="100%" stopColor="#d4af37" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="fxBurstCoreLose" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#ffe4e4" stopOpacity="0.85" />
        <stop offset="35%" stopColor="#f87171" stopOpacity="0.5" />
        <stop offset="100%" stopColor="#7f1d1d" stopOpacity="0" />
      </radialGradient>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Area flashes
 * ------------------------------------------------------------------ */

interface Flash {
  key: string;
  rect: Rect;
  win: boolean;
}

/**
 * Lights the printed box every resolved bet was sitting in.
 *
 * Collapsed by rectangle rather than by bet: four winning place bets on the six
 * are one box lighting up, not four flashes stacked on the same pixels. A spot
 * that both won and lost on the same roll — two seats on opposite sides of the
 * same number — reads as a win, because that is the brighter, rarer event and
 * the losing seat still gets its own raked chip and its own red figure.
 */
export function AreaFlashes({
  settlements,
  rollId,
}: {
  settlements: Settlement[];
  rollId: number;
}) {
  const reduced = useReducedMotion() ?? false;

  const flashes = React.useMemo<Flash[]>(() => {
    const byRect = new Map<string, Flash>();
    for (const s of settlements) {
      if (s.type !== 'WIN' && s.type !== 'LOSE') continue;
      const rect = rectFor(s.at);
      if (!rect) continue;
      const key = `${rect.x}-${rect.y}-${rect.w}-${rect.h}`;
      const win = s.type === 'WIN';
      const prev = byRect.get(key);
      if (!prev || (win && !prev.win)) byRect.set(key, { key, rect, win });
    }
    return [...byRect.values()];
  }, [settlements]);

  if (!flashes.length) return null;

  return (
    <g pointerEvents="none" data-fx="flashes">
      {flashes.map((f) => {
        const ink = f.win ? WIN_INK : LOSE_INK;
        const r = f.rect;
        const rx = (r.rx ?? 5) + 2;
        return (
          <motion.g
            key={`${rollId}-${f.key}`}
            initial={{ opacity: 0 }}
            animate={reduced ? { opacity: [0, 0.9, 0] } : { opacity: [0, 1, 0.72, 0] }}
            transition={
              reduced
                ? { duration: 0.9, times: [0, 0.25, 1], ease: 'easeOut' }
                : { duration: f.win ? 1.2 : 0.8, times: [0, 0.1, 0.38, 1], ease: 'easeOut' }
            }
          >
            <rect
              x={r.x + 3}
              y={r.y + 3}
              width={r.w - 6}
              height={r.h - 6}
              rx={rx}
              fill={ink}
              opacity={0.17}
            />
            {/* The blurred copy is what makes it read as light rather than paint. */}
            <rect
              x={r.x + 3}
              y={r.y + 3}
              width={r.w - 6}
              height={r.h - 6}
              rx={rx}
              fill="none"
              stroke={ink}
              strokeWidth={4}
              filter="url(#fxGlow)"
            />
            <rect
              x={r.x + 3}
              y={r.y + 3}
              width={r.w - 6}
              height={r.h - 6}
              rx={rx}
              fill="none"
              stroke={ink}
              strokeWidth={2.5}
              opacity={0.95}
            />
          </motion.g>
        );
      })}
    </g>
  );
}

/* ------------------------------------------------------------------ *
 * Chips in motion
 * ------------------------------------------------------------------ */

interface Flight {
  key: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** The top of the chip's arc, in view coordinates. */
  apex: number;
  amount: number;
  win: boolean;
  ring?: string;
}

/**
 * Money crossing the felt: winnings out to the rail, losses raked to the bank.
 *
 * The chips are ghosts. The real bets are already gone from the table by the
 * time this renders, which is exactly why the settlement carries its own
 * location — these fly from where the bet was, not from where it is.
 */
export function ChipFlights({
  settlements,
  rollId,
}: {
  settlements: Settlement[];
  rollId: number;
}) {
  const reduced = useReducedMotion() ?? false;

  const flights = React.useMemo<Flight[]>(() => {
    const out: Flight[] = [];
    for (const s of settlements) {
      if (s.type !== 'WIN' && s.type !== 'LOSE') continue;
      const win = s.type === 'WIN';
      const amount = Math.round(win ? s.credit : s.debit);
      if (amount <= 0) continue;
      const base = anchorFor(s.at);
      const nudge = seatOffset(s.seat);
      const from = { x: base.x + nudge.x, y: base.y + nudge.y };
      const to = win ? RAIL[s.seat] : BANK;
      out.push({
        key: `${s.betId}-${s.type}`,
        from,
        to,
        // A payoff is tossed and a loss is raked, and the two read completely
        // differently: one arcs over the layout, the other slides flat across
        // it. Same two endpoints, opposite gesture.
        apex: win
          ? Math.min(from.y, to.y) - 78
          : (from.y + to.y) / 2 - 10,
        amount,
        win,
        ring: win ? SEAT_RING[s.seat] : undefined,
      });
      if (out.length >= MAX_FLIGHTS) break;
    }
    return out;
  }, [settlements]);

  // Chips travelling across the table is the one effect here that is purely
  // movement, so it is the one that goes away entirely rather than degrading.
  if (reduced || !flights.length) return null;

  return (
    <g pointerEvents="none" data-fx="flights">
      {flights.map((f, i) => (
        <motion.g
          key={`${rollId}-${f.key}`}
          initial={{ x: f.from.x, y: f.from.y, opacity: 0, scale: 0.7, rotate: 0 }}
          animate={{
            x: f.to.x,
            y: [f.from.y, f.apex, f.to.y],
            opacity: [0, 1, 1, 0],
            scale: f.win ? [0.7, 1.12, 1, 0.85] : [0.7, 1, 0.9, 0.6],
            rotate: f.win ? (i % 2 ? 26 : -26) : 0,
          }}
          transition={{
            // Winners get a beat of hang time before they travel; losses are
            // raked briskly, the way a stick actually clears the layout.
            duration: f.win ? 0.95 : 0.7,
            delay: i * 0.055,
            ease: f.win ? [0.2, 0.7, 0.3, 1] : [0.5, 0, 0.75, 0.4],
            opacity: { times: [0, 0.14, 0.7, 1] },
            // The horizontal carries straight through while the vertical rises
            // and falls: two eases on one element is what makes it a throw
            // rather than a slide along a diagonal.
            x: { ease: f.win ? 'easeInOut' : [0.5, 0, 0.75, 0.4] },
            y: { times: [0, 0.44, 1], ease: f.win ? ['easeOut', 'easeIn'] : 'easeInOut' },
          }}
        >
          <ChipStack x={0} y={0} amount={f.amount} r={15} ring={f.ring} />
        </motion.g>
      ))}
    </g>
  );
}

/* ------------------------------------------------------------------ *
 * The felt reacting as a whole
 * ------------------------------------------------------------------ */

/**
 * A wash of light over the whole table for the two moments that deserve one:
 * a winner, and a seven out.
 */
export function OutcomeWash({ record, rollId }: { record: RollRecord | null; rollId: number }) {
  const reduced = useReducedMotion() ?? false;

  const outcome = record?.outcome;
  const sevenOut = outcome === 'SEVEN_OUT';
  const winner = outcome === 'POINT_MADE' || outcome === 'NATURAL';
  if (!sevenOut && !winner) return null;

  return (
    <motion.rect
      key={`${rollId}-${outcome}`}
      x={14}
      y={14}
      width={VIEW.w - 28}
      height={VIEW.h - 28}
      rx={18}
      fill={sevenOut ? 'url(#fxSevenOut)' : 'url(#fxWinnerWash)'}
      pointerEvents="none"
      data-fx="wash"
      initial={{ opacity: 0 }}
      animate={{ opacity: sevenOut ? [0, 1, 0.85, 0] : [0, 0.9, 0] }}
      transition={{
        duration: reduced ? 0.9 : sevenOut ? 1.5 : 1.1,
        times: sevenOut ? [0, 0.08, 0.35, 1] : [0, 0.18, 1],
        ease: 'easeOut',
      }}
    />
  );
}

/* ------------------------------------------------------------------ *
 * The moment the hand is decided
 * ------------------------------------------------------------------ */

/** How many sparks fly off a burst. Beyond about twenty it reads as glitter. */
const SPARKS = 16;

/**
 * Spark geometry, derived from the index rather than drawn at random.
 *
 * Deterministic for the same reason the chip stacks are: this component is
 * keyed on the roll and may re-render inside its own animation, and a random
 * spread would jump to a new one every time something else on the table
 * changed. The small per-index skew is what keeps sixteen evenly spaced spokes
 * from reading as a mechanical star.
 */
function sparkAt(i: number) {
  const angle = (Math.PI * 2 * i) / SPARKS + (i % 3) * 0.13;
  return {
    reach: 118 + ((i * 37) % 58),
    deg: (angle * 180) / Math.PI,
    delay: (i % 4) * 0.035,
  };
}

/**
 * A burst at the box that decided the hand: the point when it is made, and the
 * middle of the layout on a seven out.
 *
 * This is the one effect that is allowed to be loud, because it fires at most
 * once per hand and it marks the only two events in craps that end one. It
 * drops out completely under reduced motion — the outcome wash and the
 * settlement figures already carry the same information without it.
 */
export function OutcomeBurst({ record, rollId }: { record: RollRecord | null; rollId: number }) {
  const reduced = useReducedMotion() ?? false;

  const outcome = record?.outcome;
  const made = outcome === 'POINT_MADE';
  const sevenOut = outcome === 'SEVEN_OUT';
  if (reduced || !record || (!made && !sevenOut)) return null;

  // A made point bursts out of its own box; a seven out has no number of its
  // own, so it goes off over the middle of the layout.
  const box = made && record.pointBefore !== null ? cellFor(record.pointBefore) : null;
  const at = box
    ? { x: box.x + box.w / 2, y: box.y + box.h / 2 }
    : { x: VIEW.w * 0.36, y: VIEW.h * 0.45 };

  const ink = made ? '#ffe9a3' : '#fca5a5';
  const core = made ? 'url(#fxBurstCore)' : 'url(#fxBurstCoreLose)';

  return (
    <g pointerEvents="none" data-fx="burst" transform={`translate(${at.x} ${at.y})`}>
      {/* The core going off. */}
      <motion.circle
        key={`${rollId}-core`}
        r={70}
        fill={core}
        initial={{ scale: 0.2, opacity: 0 }}
        animate={{ scale: [0.2, 1.5, 2.1], opacity: [0, 1, 0] }}
        transition={{ duration: made ? 0.85 : 0.7, times: [0, 0.22, 1], ease: 'easeOut' }}
      />

      {/* Two rings, offset in time, so the shock has a leading and a trailing
          edge instead of being one expanding circle. */}
      {[0, 1].map((k) => (
        <motion.circle
          key={`${rollId}-ring-${k}`}
          r={34}
          fill="none"
          stroke={ink}
          strokeWidth={k ? 2 : 3.5}
          initial={{ scale: 0.3, opacity: 0 }}
          animate={{ scale: [0.3, 3.4 + k * 0.9], opacity: [0, 0.85, 0] }}
          transition={{
            duration: 0.9 + k * 0.22,
            delay: k * 0.11,
            times: [0, 0.18, 1],
            ease: 'easeOut',
          }}
        />
      ))}

      {/*
        Sparks.

        The spoke's angle lives on a plain wrapper rather than on the animated
        element: motion drives an SVG transform through `style`, and a CSS
        transform beats the transform *attribute*, so a rotate written next to
        an animated x is silently thrown away. Rotating the parent and
        travelling along the child's own x avoids the collision entirely.
      */}
      {Array.from({ length: SPARKS }, (_, i) => {
        const sp = sparkAt(i);
        return (
          <g key={`${rollId}-spark-${i}`} transform={`rotate(${sp.deg})`}>
            <motion.rect
              x={0}
              y={-1.6}
              width={16}
              height={3.2}
              rx={1.6}
              fill={ink}
              initial={{ x: 12, opacity: 0, scaleX: 0.4 }}
              animate={{
                x: [12, sp.reach],
                opacity: [0, 1, 0],
                scaleX: [0.4, 1.5, 0.2],
              }}
              transition={{
                duration: made ? 0.78 : 0.62,
                delay: sp.delay,
                times: [0, 0.25, 1],
                ease: 'easeOut',
              }}
            />
          </g>
        );
      })}
    </g>
  );
}
