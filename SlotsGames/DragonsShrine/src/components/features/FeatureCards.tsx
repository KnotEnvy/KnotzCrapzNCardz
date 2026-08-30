'use client';

/**
 * The cards either side of a feature.
 *
 * A feature needs a door. Without one the reels simply start behaving
 * differently and the player has to work out why; with one, the machine stops,
 * says what it is about to do, and does it. The intro is two shrine gates
 * swinging apart on the award. The outro is the same frame with the bill: what
 * the whole session paid, and -- the part that makes a free spins run feel
 * like it was worth playing out -- how far up the multiplier trail it got.
 *
 * The card reads from `featureCard` rather than from `free` or `hold`, because
 * an outro has to keep quoting a total for three seconds after the feature
 * state that produced it has been torn down and settled.
 */

import { motion } from 'motion/react';
import * as React from 'react';
import { Embers, OverlayShell, SkipHint } from './shell';
import { Badge, cn } from '@/components/ui/primitives';
import { MULTIPLIER_TRAIL } from '@/lib/engine/paytable';
import { count, money, ratio } from '@/lib/format';
import type { FeatureCard } from '@/lib/store/contract';
import type { FreeSpinsState, HoldState } from '@/lib/engine/types';

const FEATURE_NAME = {
  FREE_SPINS: 'Shrine of Flames',
  HOLD_AND_WIN: 'Shrine Link',
} as const;

const FEATURE_ACCENT = {
  FREE_SPINS: 'var(--color-ember-400)',
  HOLD_AND_WIN: 'var(--color-violet-400)',
} as const;

/** One half of the gate. Mirrored for the other side. */
function Gate({ side, reduced }: { side: 'left' | 'right'; reduced: boolean }) {
  if (reduced) return null;
  return (
    <motion.div
      aria-hidden
      initial={{ x: 0 }}
      animate={{ x: side === 'left' ? '-104%' : '104%' }}
      transition={{ delay: 0.35, duration: 0.85, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        'pointer-events-none absolute inset-y-0 w-1/2 border-gold-700/50',
        side === 'left' ? 'left-0 border-r-2' : 'right-0 border-l-2',
      )}
      style={{
        background:
          'linear-gradient(180deg, #6b1414 0%, #4a0d0d 40%, #2a0808 100%)',
        boxShadow: 'inset 0 0 60px rgba(0,0,0,0.7)',
      }}
    >
      {/* Door studs, the one detail that makes it read as timber and not a wipe. */}
      <div className="grid h-full grid-cols-3 content-center gap-6 px-4 opacity-60">
        {Array.from({ length: 9 }, (_, i) => (
          <span key={i} className="mx-auto h-2 w-2 rounded-full bg-gold-600/70" />
        ))}
      </div>
    </motion.div>
  );
}

export function FeatureCards({
  card,
  free,
  hold,
  totalBet,
  reduced,
  onSkip,
}: {
  card: FeatureCard | null;
  free: FreeSpinsState | null;
  hold: HoldState | null;
  totalBet: number;
  reduced: boolean;
  onSkip: () => void;
}) {
  /*
   * The card is authoritative, but the machine has to be able to draw a door
   * before the store has published one -- so whichever feature state is alive
   * stands in for it.
   */
  const feature = card?.feature ?? (hold ? 'HOLD_AND_WIN' : 'FREE_SPINS');
  const intro = (card?.kind ?? 'INTRO') === 'INTRO';
  const accent = FEATURE_ACCENT[feature];

  const spins = card?.spins ?? free?.awarded ?? 0;
  const orbs = card?.orbs ?? hold?.orbs.length ?? 0;
  const total = card?.total ?? (feature === 'FREE_SPINS' ? (free?.won ?? 0) : (hold?.collected ?? 0));
  const trail = MULTIPLIER_TRAIL[free?.trailIndex ?? 0] ?? 1;

  const heading = intro
    ? FEATURE_NAME[feature].toUpperCase()
    : feature === 'FREE_SPINS'
      ? 'FREE SPINS COMPLETE'
      : 'LINK COMPLETE';

  return (
    <OverlayShell
      label={`${FEATURE_NAME[feature]} ${intro ? 'starting' : 'complete'}`}
      onSkip={onSkip}
      reduced={reduced}
    >
      <motion.div
        initial={reduced ? { opacity: 0 } : { scale: 0.85, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={reduced ? { duration: 0.14 } : { type: 'spring', stiffness: 240, damping: 20 }}
        className="relative w-full overflow-hidden rounded-2xl border px-4 py-7 text-center sm:px-10 sm:py-10"
        style={{
          borderColor: accent,
          background: 'linear-gradient(180deg, rgba(16,19,28,0.95), rgba(5,6,10,0.97))',
          boxShadow: `0 0 80px -20px ${accent}, 0 1px 0 rgba(255,255,255,0.08) inset`,
        }}
      >
        {!reduced ? <Embers n={intro ? 16 : 10} color={accent} /> : null}

        <span className="relative text-[10px] font-bold tracking-[0.32em] text-ink-400 uppercase">
          {intro ? 'The gates open' : 'The gates close'}
        </span>

        <h2
          className="display relative mt-2 text-[clamp(1.4rem,6.4vw,2.7rem)] leading-none font-black tracking-[0.08em]"
          style={{ color: accent, textShadow: `0 0 32px ${accent}, 0 2px 0 rgba(0,0,0,0.7)` }}
        >
          {heading}
        </h2>

        {intro ? (
          <div className="relative mt-5 flex flex-col items-center gap-1">
            <span
              className="numeric text-[clamp(2.6rem,15vw,6rem)] leading-none font-black text-gold-300"
              style={{ textShadow: '0 0 34px rgba(224,179,58,0.55), 0 2px 0 rgba(0,0,0,0.8)' }}
            >
              {count(feature === 'FREE_SPINS' ? spins : orbs)}
            </span>
            <span className="display text-xs tracking-[0.3em] text-ink-200 uppercase sm:text-sm">
              {feature === 'FREE_SPINS' ? 'free spins' : 'orbs locked'}
            </span>
            <p className="mt-3 max-w-md text-[11px] leading-relaxed text-ink-400">
              {feature === 'FREE_SPINS'
                ? 'The dragon takes whole reels inside the shrine, and every pearl and every dragon reel steps the multiplier trail up. It never steps back.'
                : 'Only orbs land from here. Every orb holds where it fell and puts the respins back to three. Fill the board for the GRAND.'}
            </p>
          </div>
        ) : (
          <div className="relative mt-5 flex flex-col items-center gap-1">
            <span className="text-[10px] font-bold tracking-[0.28em] text-ink-400 uppercase">
              Total won
            </span>
            <span
              className="numeric text-[clamp(2.2rem,12vw,5rem)] leading-none font-black text-gold-300"
              style={{ textShadow: '0 0 34px rgba(224,179,58,0.55), 0 2px 0 rgba(0,0,0,0.8)' }}
            >
              {money(total)}
            </span>
            <span className="numeric text-xs text-ink-300">{ratio(total, totalBet)} the stake</span>

            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              {feature === 'FREE_SPINS' ? (
                <>
                  <Badge className="bg-ember-700/50 text-ember-300">
                    trail reached {trail}x
                  </Badge>
                  <Badge className="bg-ink-800 text-ink-300">
                    {count(spins)} spins played
                  </Badge>
                  {free && free.retriggers > 0 ? (
                    <Badge className="bg-jade-700/50 text-jade-300">
                      {count(free.retriggers)} retriggers
                    </Badge>
                  ) : null}
                </>
              ) : (
                <>
                  <Badge className="bg-violet-700/50 text-violet-400">
                    {count(orbs)} orbs collected
                  </Badge>
                  {hold?.awardedJackpots.map((j) => (
                    <Badge key={j} className="bg-gold-800/60 text-gold-300">
                      {j} jackpot
                    </Badge>
                  ))}
                </>
              )}
            </div>
          </div>
        )}

        <div className="relative">
          <SkipHint onSkip={onSkip} text={intro ? 'Tap to begin' : 'Tap to collect'} />
        </div>

        {/* The gates themselves, over everything, sliding away on the intro. */}
        {intro ? (
          <>
            <Gate side="left" reduced={reduced} />
            <Gate side="right" reduced={reduced} />
          </>
        ) : null}
      </motion.div>
    </OverlayShell>
  );
}
