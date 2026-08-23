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
import { BANK, RAIL, VIEW, anchorFor, rectFor, seatOffset, type Rect } from './layout';
import type { RollRecord, SeatId, Settlement } from '@/lib/engine/types';

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
    <g pointerEvents="none">
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
      out.push({
        key: `${s.betId}-${s.type}`,
        from: { x: base.x + nudge.x, y: base.y + nudge.y },
        to: win ? RAIL[s.seat] : BANK,
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
    <g pointerEvents="none">
      {flights.map((f, i) => (
        <motion.g
          key={`${rollId}-${f.key}`}
          initial={{ x: f.from.x, y: f.from.y, opacity: 0, scale: 0.7 }}
          animate={{
            x: f.to.x,
            y: f.to.y,
            opacity: [0, 1, 1, 0],
            scale: f.win ? [0.7, 1.12, 1, 0.85] : [0.7, 1, 0.9, 0.6],
          }}
          transition={{
            // Winners get a beat of hang time before they travel; losses are
            // raked briskly, the way a stick actually clears the layout.
            duration: f.win ? 0.95 : 0.7,
            delay: i * 0.055,
            ease: f.win ? [0.2, 0.7, 0.3, 1] : [0.5, 0, 0.75, 0.4],
            opacity: { times: [0, 0.14, 0.7, 1] },
          }}
        >
          <ChipStack x={0} y={0} amount={f.amount} r={13} ring={f.ring} />
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
