'use client';

/**
 * The shuffling machine.
 *
 * Where the blackjack table has a shoe — a stack of cards that shrinks, with
 * a cut card you can watch coming — this table has a box. It takes the deck
 * back after every round, shuffles it, and dispenses it in stacks of three.
 * There is nothing to watch deplete, and that is the point worth showing: no
 * round at this table knows anything about the last one.
 *
 * Two decks run through it, alternately, with different backs — see the card
 * backs in `globals.css` — so the machine says which one is out.
 */

import * as React from 'react';
import { cn } from '@/components/ui/primitives';

export function Shuffler({
  x,
  y,
  scale,
  busy,
  round,
}: {
  x: number;
  y: number;
  scale: number;
  /** Lit and blinking while it is dealing. */
  busy: boolean;
  round: number;
}) {
  const deck = round % 2 === 0 ? 'A' : 'B';

  return (
    <div
      className="absolute -translate-x-1/2 -translate-y-1/2"
      style={{ left: x, top: y, width: 70, height: 96, transform: `translate(-50%, -50%) scale(${scale})` }}
      title={`Shuffling machine. Deck ${deck} is in play; every round is a freshly shuffled deck.`}
    >
      <div className="relative h-full w-full rounded-md border border-black/60 bg-gradient-to-b from-[#2a2f39] via-[#1a1e26] to-[#0c0e12] shadow-[0_6px_18px_-6px_rgba(0,0,0,0.9)]">
        {/* The lid seam and the maker's plate. */}
        <div className="absolute inset-x-2 top-2 h-5 rounded-sm border border-white/8 bg-black/40" />
        <span
          className="absolute inset-x-0 top-[11px] text-center text-[7px] tracking-[0.2em] text-brass-300/70 uppercase"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Shuffler
        </span>

        {/* The status light. */}
        <span
          className={cn(
            'absolute top-[38px] left-1/2 h-2 w-2 -translate-x-1/2 rounded-full',
            busy ? 'machine-busy bg-[#f2b64a] shadow-[0_0_8px_#f2b64a]' : 'bg-[#45d98a] shadow-[0_0_6px_rgba(69,217,138,0.8)]',
          )}
        />

        <span className="absolute inset-x-0 top-[50px] text-center font-mono text-[8px] text-white/45 tabular-nums">
          DECK {deck}
        </span>

        {/* The dispensing slot, with the edge of the next stack in it. */}
        <div className="absolute inset-x-2 bottom-3 h-3 rounded-[2px] bg-black/80">
          <div
            className={cn('absolute inset-x-1 top-[3px] h-[5px] rounded-[1px]', deck === 'A' ? 'bg-[#7a1524]' : 'bg-[#17140c] ring-1 ring-brass-500/40')}
          />
        </div>
      </div>
    </div>
  );
}
