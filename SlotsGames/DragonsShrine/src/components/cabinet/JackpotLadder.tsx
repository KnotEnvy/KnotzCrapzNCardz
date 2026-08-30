'use client';

/**
 * The four fixed jackpots.
 *
 * Every value here is a multiple of the stake, so the ladder is recomputed
 * from `totalBet` on every render rather than cached. That is not an
 * optimisation note, it is the point of the component: a player who raises the
 * bet looks straight at the GRAND to see what the raise bought them, and a
 * ladder that sits still while the stake moves is the single most-noticed
 * wrong detail on a slot. Raise the bet from $1 to $100 and the GRAND has to
 * go from $5,000 to $500,000 in the same frame.
 *
 * Each rung keeps its colour everywhere else it appears -- the orb that
 * carries it, the banner that announces it, the history line that records it
 * -- so the four CSS variables are the single source for all of them.
 */

import { motion } from 'motion/react';
import * as React from 'react';
import { FxStyles, cn } from '@/components/ui/primitives';
import { JACKPOTS } from '@/lib/engine/paytable';
import { JACKPOT_IDS, type JackpotId } from '@/lib/engine/types';
import { moneyShort } from '@/lib/format';
import { useSlots } from '@/lib/store/useSlots';

/** The colour each ladder owns, and how loudly its rung is drawn. */
const JACKPOT_STYLE: Record<JackpotId, { color: string; weight: string }> = {
  MINI: { color: 'var(--jackpot-mini)', weight: 'text-[clamp(0.7rem,2.6vw,1rem)]' },
  MINOR: { color: 'var(--jackpot-minor)', weight: 'text-[clamp(0.7rem,2.6vw,1rem)]' },
  MAJOR: { color: 'var(--jackpot-major)', weight: 'text-[clamp(0.78rem,3vw,1.2rem)]' },
  GRAND: { color: 'var(--jackpot-grand)', weight: 'text-[clamp(0.85rem,3.4vw,1.45rem)]' },
};

export function JackpotLadder(): React.JSX.Element {
  const totalBet = useSlots((s) => s.totalBet);
  const jackpotWon = useSlots((s) => s.jackpotWon);
  const reduced = useSlots((s) => s.prefs.reducedMotion);

  return (
    <div className="w-full max-w-5xl shrink-0">
      <FxStyles />
      <ul
        className="grid grid-cols-4 gap-1 sm:gap-2"
        aria-label={`Jackpots at the current stake of ${moneyShort(totalBet)}`}
      >
        {JACKPOT_IDS.map((id) => {
          const { color, weight } = JACKPOT_STYLE[id];
          const value = JACKPOTS[id] * totalBet;
          const won = jackpotWon === id;
          const dimmed = jackpotWon !== null && !won;

          return (
            <li key={id} className="min-w-0">
              <motion.div
                animate={
                  won && !reduced
                    ? { scale: [1, 1.06, 1] }
                    : { scale: 1 }
                }
                transition={
                  won && !reduced
                    ? { duration: 0.9, repeat: Infinity, ease: 'easeInOut' }
                    : { duration: 0.2 }
                }
                className={cn(
                  'relative flex min-w-0 flex-col items-center overflow-hidden rounded-md border px-1 py-1 text-center transition-opacity sm:px-2 sm:py-1.5',
                  dimmed && 'opacity-30',
                )}
                style={{
                  borderColor: won ? color : 'color-mix(in srgb, var(--color-gold-800) 55%, transparent)',
                  background: won
                    ? `linear-gradient(180deg, color-mix(in srgb, ${color} 42%, transparent), rgba(5,6,10,0.9))`
                    : `linear-gradient(180deg, color-mix(in srgb, ${color} 11%, transparent), rgba(5,6,10,0.85))`,
                  boxShadow: won
                    ? `0 0 46px -6px ${color}, 0 1px 0 rgba(255,255,255,0.12) inset`
                    : `0 1px 0 rgba(255,255,255,0.06) inset`,
                }}
              >
                {/* The idle shimmer: a slow gilt sweep across the plate. */}
                {!reduced ? (
                  <span
                    aria-hidden
                    className="ds-sweep fx-decorative pointer-events-none absolute inset-0 opacity-40"
                    style={{
                      backgroundImage: `linear-gradient(100deg, transparent 40%, color-mix(in srgb, ${color} 45%, transparent) 50%, transparent 60%)`,
                    }}
                  />
                ) : null}

                <span
                  className="relative block text-[8px] leading-none font-black tracking-[0.18em] uppercase sm:text-[10px]"
                  style={{ color }}
                >
                  {id}
                </span>
                <span
                  className={cn('numeric relative mt-0.5 block truncate leading-none font-black', weight)}
                  style={{ color, textShadow: `0 0 16px color-mix(in srgb, ${color} 60%, transparent)` }}
                >
                  {moneyShort(value)}
                </span>

                {won ? (
                  <span
                    aria-hidden
                    className={cn(
                      'pointer-events-none absolute inset-0 rounded-md border-2',
                      !reduced && 'ds-ringpulse fx-decorative',
                    )}
                    style={{ borderColor: color }}
                  />
                ) : null}
              </motion.div>
            </li>
          );
        })}
      </ul>

      {/* The announcement lives outside the rungs so a screen reader gets one
          clean sentence rather than four plates re-reading themselves. */}
      <div role="status" aria-live="polite" className="sr-only">
        {jackpotWon ? `${jackpotWon} jackpot won: ${moneyShort(JACKPOTS[jackpotWon] * totalBet)}` : ''}
      </div>
    </div>
  );
}
