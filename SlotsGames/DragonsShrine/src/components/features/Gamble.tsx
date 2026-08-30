'use client';

/**
 * The lantern gamble.
 *
 * Red or black, double or nothing, five times at most. The screen has exactly
 * three things to say and they all have to be readable in the second before
 * the player commits: what is on the line, what it becomes if the lantern
 * comes up their colour, and where the collect button is. Collect is a
 * first-class control here rather than a small link, because a gamble screen
 * that makes walking away harder than pressing again is a dark pattern
 * wearing a slot machine costume.
 *
 * The run's own history sits underneath, which is the honest way to show a
 * streak: four reds in a row do not make black due, and seeing the four does
 * more to make that obvious than any amount of copy.
 */

import { AnimatePresence, motion } from 'motion/react';
import * as React from 'react';
import { OverlayShell } from './shell';
import { Button, cn } from '@/components/ui/primitives';
import { GAMBLE_MAX_STEPS } from '@/lib/engine/paytable';
import type { GambleChoice, GambleResult } from '@/lib/engine/types';
import { money } from '@/lib/format';

const CHOICE_LOOK: Record<GambleChoice, { label: string; color: string; face: string }> = {
  RED: { label: 'RED', color: 'var(--color-cinnabar-500)', face: 'var(--color-cinnabar-700)' },
  BLACK: { label: 'BLACK', color: 'var(--color-ink-300)', face: 'var(--color-ink-800)' },
};

/** The paper lantern that carries the verdict. */
function Lantern({ side, size = 96 }: { side: GambleChoice; size?: number }) {
  const look = CHOICE_LOOK[side];
  return (
    <svg viewBox="0 0 60 80" width={size} height={size * (80 / 60)} aria-hidden>
      <rect x="22" y="4" width="16" height="5" rx="1.5" fill="var(--color-gold-700)" />
      <ellipse cx="30" cy="42" rx="24" ry="30" fill={look.face} />
      <ellipse cx="30" cy="42" rx="24" ry="30" fill="none" stroke={look.color} strokeWidth="2.5" />
      {[26, 34, 42, 50, 58].map((y) => (
        <line key={y} x1="7" y1={y} x2="53" y2={y} stroke={look.color} strokeWidth="1" opacity="0.45" />
      ))}
      <rect x="22" y="70" width="16" height="5" rx="1.5" fill="var(--color-gold-700)" />
      <path d="M30 75v5" stroke="var(--color-gold-600)" strokeWidth="2" />
      <ellipse cx="30" cy="42" rx="12" ry="16" fill={look.color} opacity="0.35" />
    </svg>
  );
}

export function Gamble({
  stake,
  step,
  history,
  reduced,
  onChoose,
  onCollect,
}: {
  stake: number;
  step: number;
  history: GambleResult[];
  reduced: boolean;
  onChoose: (choice: GambleChoice) => void;
  onCollect: () => void;
}) {
  const last = history.length > 0 ? history[history.length - 1] : null;
  const atRisk = stake;
  const ifWon = stake * 2;
  const exhausted = step >= GAMBLE_MAX_STEPS;

  return (
    <OverlayShell
      label="Gamble: red or black"
      reduced={reduced}
      className="max-w-lg gap-3"
      live="off"
      scrimClassName="bg-[radial-gradient(120%_90%_at_50%_40%,rgba(74,13,13,0.8),rgba(5,6,10,0.97))]"
    >
      <h2 className="display text-[clamp(1.1rem,4.6vw,1.8rem)] leading-none font-black tracking-[0.16em] text-cinnabar-300">
        DOUBLE OR NOTHING
      </h2>

      {/* What is on the line. */}
      <div className="flex w-full items-stretch gap-2">
        <div className="flex-1 rounded-lg border border-gold-800/50 bg-ink-950/85 px-3 py-2 text-center">
          <span className="block text-[9px] font-bold tracking-[0.22em] text-ink-400 uppercase">
            At risk
          </span>
          <span className="numeric mt-1 block text-[clamp(1rem,4.6vw,1.7rem)] leading-none font-black text-gold-300">
            {money(atRisk)}
          </span>
        </div>
        <div className="flex-1 rounded-lg border border-jade-700/50 bg-ink-950/85 px-3 py-2 text-center">
          <span className="block text-[9px] font-bold tracking-[0.22em] text-ink-400 uppercase">
            If it wins
          </span>
          <span className="numeric mt-1 block text-[clamp(1rem,4.6vw,1.7rem)] leading-none font-black text-jade-300">
            {money(ifWon)}
          </span>
        </div>
      </div>

      {/* The lantern, flipping to whatever last landed. */}
      <div className="relative flex h-[132px] w-full items-center justify-center sm:h-[150px]">
        <AnimatePresence mode="wait">
          <motion.div
            key={history.length}
            initial={reduced ? { opacity: 0 } : { rotateY: 0, opacity: 0, scale: 0.85 }}
            animate={reduced ? { opacity: 1 } : { rotateY: last ? 360 : 0, opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={reduced ? { duration: 0.12 } : { duration: 0.55, ease: 'easeOut' }}
            className="flex flex-col items-center"
          >
            <Lantern side={last ? last.landed : 'RED'} size={84} />
            {last ? (
              <span
                className={cn(
                  'display mt-1 text-[11px] font-black tracking-[0.24em] uppercase',
                  last.won ? 'text-jade-300' : 'text-cinnabar-400',
                )}
              >
                {last.landed} &middot; {last.won ? 'doubled' : 'lost'}
              </span>
            ) : (
              <span className="display mt-1 text-[11px] font-black tracking-[0.24em] text-ink-400 uppercase">
                Call it
              </span>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* The call. */}
      <div className="flex w-full gap-2">
        {(['RED', 'BLACK'] as const).map((c) => (
          <button
            key={c}
            type="button"
            disabled={exhausted}
            onClick={() => onChoose(c)}
            aria-label={`Gamble on ${CHOICE_LOOK[c].label.toLowerCase()}`}
            className={cn(
              'no-select flex flex-1 items-center justify-center gap-2 rounded-lg border-2 py-3 text-sm font-black tracking-[0.2em] transition-all active:translate-y-px disabled:opacity-30',
              c === 'RED'
                ? 'border-cinnabar-500 bg-gradient-to-b from-cinnabar-600 to-cinnabar-900 text-gold-200 hover:from-cinnabar-500'
                : 'border-ink-500 bg-gradient-to-b from-ink-700 to-ink-950 text-ink-100 hover:from-ink-600',
            )}
          >
            <Lantern side={c} size={22} />
            {CHOICE_LOOK[c].label}
          </button>
        ))}
      </div>

      <Button variant="jade" size="lg" onClick={onCollect} className="w-full tracking-[0.2em]">
        COLLECT {money(atRisk)}
      </Button>

      {/* Where the run has got to, and what it has done. */}
      <div className="flex w-full flex-wrap items-center justify-between gap-2">
        <ol className="flex items-center gap-1" aria-label={`Step ${step} of ${GAMBLE_MAX_STEPS}`}>
          {Array.from({ length: GAMBLE_MAX_STEPS }, (_, i) => (
            <li
              key={i}
              className={cn(
                'h-1.5 w-6 rounded-full',
                i < step ? 'bg-jade-400' : i === step ? 'bg-gold-400' : 'bg-ink-700',
              )}
            />
          ))}
          <li className="numeric ml-1.5 text-[10px] text-ink-400">
            step {Math.min(step + 1, GAMBLE_MAX_STEPS)} / {GAMBLE_MAX_STEPS}
          </li>
        </ol>

        <ol className="flex items-center gap-1" aria-label="This run so far">
          {history.map((h, i) => (
            <li
              key={i}
              title={`Called ${h.choice.toLowerCase()}, landed ${h.landed.toLowerCase()} — ${h.won ? money(h.balance) : 'lost'}`}
              className={cn(
                'grid h-5 w-5 place-items-center rounded-full border text-[8px] font-black',
                h.landed === 'RED'
                  ? 'border-cinnabar-500 bg-cinnabar-800 text-cinnabar-300'
                  : 'border-ink-500 bg-ink-800 text-ink-200',
              )}
            >
              {h.landed === 'RED' ? 'R' : 'B'}
            </li>
          ))}
        </ol>
      </div>

      {exhausted ? (
        <p className="text-[10px] tracking-[0.14em] text-ink-400 uppercase">
          Five doubles is the limit &mdash; collect to finish
        </p>
      ) : null}
    </OverlayShell>
  );
}
