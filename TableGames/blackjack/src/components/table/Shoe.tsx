'use client';

/**
 * The shoe, and the discard tray beside it.
 *
 * Both are drawn as what they are — a wedge of cards on their side — and both
 * are honest: the shoe's stack shrinks as it is dealt and the tray's grows,
 * because that is the one piece of counting information a real table gives you
 * for free. A player estimating decks remaining is looking at exactly this.
 *
 * The cut card shows through the stack at the depth it was placed, so its
 * appearance is not a surprise announcement but something you can watch coming.
 */

import * as React from 'react';
import { cn } from '@/components/ui/primitives';
import { decksRemaining, penetrationSoFar, remaining as cardsLeft } from '@/lib/engine/shoe';
import type { ShoeState } from '@/lib/engine/types';

export function Shoe({
  shoe,
  x,
  y,
  compact = false,
}: {
  shoe: ShoeState;
  x: number;
  y: number;
  /** The shallow table has no room for a full-height shoe. */
  compact?: boolean;
}) {
  const left = cardsLeft(shoe) / Math.max(1, shoe.size);
  const pen = penetrationSoFar(shoe);
  const cutFraction = shoe.cutAt / Math.max(1, shoe.size);
  const decks = decksRemaining(shoe);

  const H = compact ? 54 : 74;
  const W = compact ? 36 : 46;

  return (
    <div className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: x, top: y }}>
      <div className="flex items-end gap-3">
        {/* The shoe. */}
        <div className="flex flex-col items-center gap-1">
          <div
            className="relative overflow-hidden rounded-sm border border-black/50 bg-pit-950"
            style={{ width: W, height: H }}
            title={`${cardsLeft(shoe)} cards left, about ${decks.toFixed(1)} decks`}
          >
            {/* The stack, filling from the bottom. */}
            <div
              className="absolute right-0 bottom-0 left-0 transition-[height] duration-500"
              style={{
                height: `${Math.max(2, left * 100)}%`,
                background:
                  'repeating-linear-gradient(0deg, #f2efe6 0 1.5px, #cfc9b8 1.5px 3px)',
              }}
            />
            {/* The cut card, showing through at its depth. */}
            {!shoe.cutReached ? (
              <div
                className="absolute right-0 left-0 h-[3px] bg-[#d9483f] shadow-[0_0_4px_rgba(217,72,63,0.8)]"
                style={{ bottom: `${Math.max(0, (1 - cutFraction) * 100)}%` }}
              />
            ) : null}
            {/* The housing: an angled lid over the top of the wedge. */}
            <div className="absolute inset-x-0 top-0 h-3 bg-gradient-to-b from-wood-700 to-wood-900" />
          </div>
          <span
            className={cn(
              'font-mono text-[9px] tabular-nums',
              shoe.cutReached ? 'text-print-red' : 'text-white/45',
            )}
          >
            {shoe.cutReached ? 'CUT' : `${decks.toFixed(1)}d`}
          </span>
        </div>

        {/* The discard tray. */}
        <div className="flex flex-col items-center gap-1">
          <div
            className="relative overflow-hidden rounded-sm border border-black/40 bg-black/30"
            style={{ width: W * 0.72, height: H * 0.8 }}
            title={`${shoe.pos} cards discarded`}
          >
            <div
              className="absolute right-0 bottom-0 left-0 transition-[height] duration-500"
              style={{
                height: `${Math.min(100, pen * 100)}%`,
                background:
                  'repeating-linear-gradient(0deg, #8d1f2c 0 1.5px, #5e1420 1.5px 3px)',
              }}
            />
          </div>
          <span className="font-mono text-[9px] tabular-nums text-white/35">
            {Math.round(pen * 100)}%
          </span>
        </div>
      </div>
    </div>
  );
}
