'use client';

/**
 * CREDIT, BET, WIN -- and the last few spins.
 *
 * These three windows are the oldest thing on a slot machine and the shape has
 * not changed since they were mechanical: recessed glass, one figure each,
 * tabular so a count-up does not shuffle sideways. The WIN meter is not
 * animated here. The store owns `meter` and counts it; this component renders
 * whatever number it is holding this frame, which is what keeps the count-up
 * in step with the sound and the takeover instead of racing them.
 *
 * The strip underneath is the machine's short-term memory: the last handful of
 * spins, colour-coded by tier, so a player can see the shape of the last
 * minute without opening anything. It is the cheapest way to make a dry run
 * feel like a run rather than a fault.
 */

import { motion } from 'motion/react';
import * as React from 'react';
import { Plate, PlateLabel, cn } from '@/components/ui/primitives';
import { LINES } from '@/lib/engine/config';
import type { WinTier } from '@/lib/engine/types';
import { money, ratio } from '@/lib/format';
import { useSlots } from '@/lib/store/useSlots';

/** How loudly each tier is drawn on the history strip. */
const TIER_TONE: Record<WinTier, { bar: string; text: string }> = {
  NONE: { bar: 'bg-ink-700', text: 'text-ink-500' },
  SMALL: { bar: 'bg-ink-400', text: 'text-ink-300' },
  MEDIUM: { bar: 'bg-jade-500', text: 'text-jade-300' },
  BIG: { bar: 'bg-gold-500', text: 'text-gold-300' },
  MEGA: { bar: 'bg-ember-500', text: 'text-ember-300' },
  EPIC: { bar: 'bg-violet-500', text: 'text-violet-400' },
  LEGENDARY: { bar: 'bg-cinnabar-500', text: 'text-cinnabar-300' },
};

/** How many spins fit on the strip before it starts forgetting. */
const STRIP_LENGTH = 12;

function HistoryStrip() {
  const history = useSlots((s) => s.history);
  const recent = history.slice(-STRIP_LENGTH);

  return (
    <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
      <PlateLabel className="hidden sm:block">last spins</PlateLabel>
      <ol className="flex items-end gap-[3px]" aria-label="Recent spins">
        {recent.length === 0 ? (
          <li className="text-[10px] text-ink-600">No spins yet</li>
        ) : (
          recent.map((h) => {
            const tone = TIER_TONE[h.tier];
            return (
              <li
                key={h.id}
                title={`${h.win > 0 ? money(h.win) : 'No win'} — ${ratio(h.win, h.totalBet)}${h.free ? ', free spin' : ''}`}
                className="group relative flex min-w-0 flex-1 flex-col items-center gap-0.5"
              >
                <span
                  className={cn(
                    'numeric hidden text-[9px] leading-none sm:block',
                    tone.text,
                    h.win === 0 && 'opacity-40',
                  )}
                >
                  {h.win > 0 ? ratio(h.win, h.totalBet) : '—'}
                </span>
                <span
                  className={cn(
                    'w-full rounded-sm',
                    tone.bar,
                    h.free && 'ring-1 ring-ember-400/70',
                  )}
                  /* Height reads the size at a glance; the label reads the exact
                     figure. Capped so a 500x hit does not need a taller strip. */
                  style={{
                    height: `${Math.min(18, 3 + Math.sqrt(Math.max(0, h.ratio)) * 3.2)}px`,
                  }}
                />
              </li>
            );
          })
        )}
      </ol>
    </div>
  );
}

export function Meters(): React.JSX.Element {
  const bankroll = useSlots((s) => s.bankroll);
  const betPerLine = useSlots((s) => s.betPerLine);
  const totalBet = useSlots((s) => s.totalBet);
  const meter = useSlots((s) => s.meter);
  const free = useSlots((s) => s.free);
  const reduced = useSlots((s) => s.prefs.reducedMotion);

  const winning = meter > 0;

  return (
    <section
      /* Credit carries the longest string on the deck -- five figures and a
         decimal -- while Bet never exceeds "$100.00". An even 1fr/1fr split
         truncated the bankroll at tablet widths, so credit borrows from bet. */
      className="grid w-full max-w-5xl shrink-0 grid-cols-2 items-stretch gap-1.5 sm:grid-cols-[1.2fr_0.9fr_1.4fr_1.6fr] sm:gap-2 tight:grid-cols-2 tight:gap-1"
      aria-label="Meters"
    >
      <Plate
        label="Credit"
        value={money(bankroll)}
        live="polite"
        tone="neutral"
        valueClassName="text-[clamp(0.85rem,3.4vw,1.25rem)] tight:text-[1rem]"
      />

      <Plate
        label="Bet"
        value={money(totalBet)}
        tone="neutral"
        valueClassName="text-[clamp(0.85rem,3.4vw,1.25rem)] tight:text-[1rem]"
        sub={`${money(betPerLine)} x ${LINES} lines`}
      />

      <motion.div
        className="col-span-2 min-w-0 sm:col-span-1 tight:col-span-2"
        animate={winning && !reduced ? { scale: [1, 1.015, 1] } : { scale: 1 }}
        transition={
          winning && !reduced
            ? { duration: 0.6, repeat: Infinity, ease: 'easeInOut' }
            : { duration: 0.15 }
        }
      >
        <Plate
          className={cn(
            'h-full',
            winning && 'border-gold-500/70 shadow-[0_0_30px_-10px_var(--color-gold-500)]',
          )}
          label={free ? 'Win — free spins' : 'Win'}
          value={money(meter)}
          live="polite"
          tone="gold"
          valueClassName="text-[clamp(1.05rem,5vw,1.9rem)] tight:text-[1.35rem]"
          sub={meter > 0 ? `${ratio(meter, totalBet)} the stake` : undefined}
        />
      </motion.div>

      <div className="col-span-2 min-w-0 rounded-md border border-gold-800/40 bg-ink-950/80 px-2.5 py-1.5 shadow-[0_2px_10px_rgba(0,0,0,0.6)_inset] sm:col-span-1 tight:hidden">
        <HistoryStrip />
      </div>
    </section>
  );
}
