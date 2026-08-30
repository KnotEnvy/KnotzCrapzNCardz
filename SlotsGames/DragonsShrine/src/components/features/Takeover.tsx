'use client';

/**
 * The big win.
 *
 * Four tiers, and the only thing that separates them is how much of the room
 * they take. BIG is a gilt frame and a count-up. LEGENDARY is the same frame
 * with rays behind it, embers in front of it, a heavier word and a number that
 * fills the screen. Escalation by degree rather than by four different
 * designs, because a player who has seen BIG twenty times needs to recognise
 * MEGA as *more of that* in the first quarter second.
 *
 * The number is not animated here. `meter` is counted by the store, so the
 * figure on the takeover, the figure in the WIN window and the sound of the
 * count are the same clock. All this does is draw it larger.
 */

import { motion } from 'motion/react';
import * as React from 'react';
import { Embers, OverlayShell, SkipHint } from './shell';
import { cn } from '@/components/ui/primitives';
import type { WinTier } from '@/lib/engine/types';
import { money, ratio } from '@/lib/format';

type BigTier = 'BIG' | 'MEGA' | 'EPIC' | 'LEGENDARY';

const LOOK: Record<
  BigTier,
  {
    word: string;
    accent: string;
    /** Roughly how much of the screen the word takes. */
    wordSize: string;
    amountSize: string;
    rays: boolean;
    embers: number;
  }
> = {
  BIG: {
    word: 'BIG WIN',
    accent: 'var(--color-gold-400)',
    wordSize: 'text-[clamp(1.6rem,7vw,3rem)]',
    amountSize: 'text-[clamp(2rem,11vw,4.5rem)]',
    rays: false,
    embers: 0,
  },
  MEGA: {
    word: 'MEGA WIN',
    accent: 'var(--color-ember-400)',
    wordSize: 'text-[clamp(1.9rem,8.4vw,3.6rem)]',
    amountSize: 'text-[clamp(2.4rem,13vw,5.5rem)]',
    rays: true,
    embers: 14,
  },
  EPIC: {
    word: 'EPIC WIN',
    accent: 'var(--color-violet-400)',
    wordSize: 'text-[clamp(2.1rem,9.6vw,4.2rem)]',
    amountSize: 'text-[clamp(2.7rem,15vw,6.5rem)]',
    rays: true,
    embers: 22,
  },
  LEGENDARY: {
    word: 'LEGENDARY',
    accent: 'var(--color-cinnabar-400)',
    wordSize: 'text-[clamp(2.3rem,10.5vw,4.8rem)]',
    amountSize: 'text-[clamp(3rem,17vw,7.5rem)]',
    rays: true,
    embers: 30,
  },
};

function bigTier(tier: WinTier): BigTier {
  return tier === 'MEGA' || tier === 'EPIC' || tier === 'LEGENDARY' ? tier : 'BIG';
}

export function Takeover({
  tier,
  amount,
  shown,
  totalBet,
  cumulative,
  reduced,
  onSkip,
}: {
  tier: WinTier;
  /** What the win will settle at, cents. */
  amount: number;
  /** What the meter is holding right now, cents. */
  shown: number;
  totalBet: number;
  cumulative: boolean;
  reduced: boolean;
  onSkip: () => void;
}) {
  const look = LOOK[bigTier(tier)];
  const value = Math.min(Math.max(shown, 0), amount);

  return (
    <OverlayShell label={`${look.word}, ${money(amount)}`} onSkip={onSkip} reduced={reduced}>
      {/* Rays. One slow rotation; the whole thing is off under reduced motion. */}
      {look.rays && !reduced ? (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute h-[150vmax] w-[150vmax] opacity-25"
          style={{
            background: `repeating-conic-gradient(from 0deg, ${look.accent} 0deg 5deg, transparent 5deg 16deg)`,
            maskImage: 'radial-gradient(closest-side, black 10%, transparent 72%)',
            WebkitMaskImage: 'radial-gradient(closest-side, black 10%, transparent 72%)',
          }}
          animate={{ rotate: 360 }}
          transition={{ duration: 42, repeat: Infinity, ease: 'linear' }}
        />
      ) : null}
      {look.embers > 0 && !reduced ? <Embers n={look.embers} color={look.accent} /> : null}

      <motion.div
        initial={reduced ? { opacity: 0 } : { scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={
          reduced ? { duration: 0.14 } : { type: 'spring', stiffness: 260, damping: 18 }
        }
        className="relative flex w-full flex-col items-center rounded-2xl border px-4 py-6 text-center sm:px-10 sm:py-9"
        style={{
          borderColor: look.accent,
          background:
            'linear-gradient(180deg, rgba(16,19,28,0.94), rgba(5,6,10,0.96))',
          boxShadow: `0 0 90px -18px ${look.accent}, 0 1px 0 rgba(255,255,255,0.1) inset`,
        }}
      >
        {cumulative ? (
          <span className="mb-1 text-[10px] font-bold tracking-[0.3em] text-ink-400 uppercase">
            Feature total
          </span>
        ) : null}

        <h2
          className={cn('display leading-none font-black tracking-[0.1em]', look.wordSize)}
          style={{
            color: look.accent,
            textShadow: `0 0 34px ${look.accent}, 0 2px 0 rgba(0,0,0,0.7)`,
          }}
        >
          {look.word}
        </h2>

        <div
          className={cn('numeric mt-3 leading-none font-black text-transparent', look.amountSize)}
          style={{
            backgroundImage:
              'linear-gradient(180deg, var(--color-gold-200) 0%, var(--color-gold-400) 46%, var(--color-gold-700) 100%)',
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            filter: 'drop-shadow(0 2px 0 rgba(0,0,0,0.8)) drop-shadow(0 0 26px rgba(224,179,58,0.5))',
          }}
        >
          {money(value)}
        </div>

        <div className="numeric mt-2 text-xs tracking-[0.16em] text-ink-300 sm:text-sm">
          {ratio(amount, totalBet)} the stake
        </div>

        <SkipHint onSkip={onSkip} />
      </motion.div>
    </OverlayShell>
  );
}
