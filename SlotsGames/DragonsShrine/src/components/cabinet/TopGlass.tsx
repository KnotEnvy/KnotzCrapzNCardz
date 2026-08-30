'use client';

/**
 * The marquee.
 *
 * On a real cabinet this is a separate lit panel above the reel glass, and it
 * has exactly two jobs: it says what machine you are sitting at, and it is
 * where the machine shouts. Everything shouted here is transient -- DRAGON
 * RAGE, a retrigger, the dragon taking a reel -- so the banner sits in a live
 * region and the title dims behind it rather than being replaced, which is
 * what stops the top of the screen from jumping every time something happens.
 *
 * During free spins the panel grows a rail: spins left, and the multiplier
 * trail as a lit ladder. The trail is the whole reason a free spins run feels
 * like it is building, so it is drawn as rungs that stay lit once passed, with
 * the current one burning.
 */

import { AnimatePresence, motion } from 'motion/react';
import * as React from 'react';
import { Badge, FxStyles, cn } from '@/components/ui/primitives';
import { MULTIPLIER_TRAIL } from '@/lib/engine/paytable';
import { count, money } from '@/lib/format';
import { useSlots } from '@/lib/store/useSlots';

/* ------------------------------------------------------------------ *
 * Ornament
 * ------------------------------------------------------------------ */

/** A carved bracket under the eaves. Mirrored on the right. */
function Finial({ flip }: { flip?: boolean }) {
  return (
    <svg
      viewBox="0 0 48 40"
      aria-hidden
      className={cn('h-full w-8 shrink-0 text-gold-700 sm:w-10', flip && 'scale-x-[-1]')}
    >
      <path
        d="M2 6 H30 Q46 6 46 20 Q46 34 30 34 H2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        opacity="0.65"
      />
      <path
        d="M6 12 H28 Q38 12 38 20 Q38 28 28 28 H6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        opacity="0.4"
      />
      <circle cx="30" cy="20" r="2.4" fill="currentColor" opacity="0.7" />
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * Multiplier trail
 * ------------------------------------------------------------------ */

function Trail({ index, reduced }: { index: number; reduced: boolean }) {
  return (
    <ol
      className="flex items-center gap-1 sm:gap-1.5"
      aria-label={`Multiplier trail, currently ${MULTIPLIER_TRAIL[index] ?? 1} times`}
    >
      {MULTIPLIER_TRAIL.map((mult, i) => {
        const lit = i < index;
        const now = i === index;
        return (
          <li key={mult}>
            <span
              aria-current={now ? 'step' : undefined}
              className={cn(
                'numeric flex h-6 min-w-8 items-center justify-center rounded-sm border px-1.5 text-[11px] font-bold transition-colors sm:h-7 sm:min-w-9 sm:text-xs',
                now
                  ? 'border-ember-400 bg-gradient-to-b from-ember-400 to-ember-600 text-ink-950 shadow-[0_0_18px_-2px_var(--color-ember-500)]'
                  : lit
                    ? 'border-gold-600/60 bg-gold-800/40 text-gold-300'
                    : 'border-ink-700 bg-ink-900/70 text-ink-500',
                now && !reduced && 'ds-flicker fx-decorative',
              )}
            >
              {mult}x
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------ *
 * The panel
 * ------------------------------------------------------------------ */

export function TopGlass(): React.JSX.Element {
  const banner = useSlots((s) => s.banner);
  const free = useSlots((s) => s.free);
  const reduced = useSlots((s) => s.prefs.reducedMotion);

  const spinsLeft = free ? Math.max(0, free.awarded - free.played) : 0;

  return (
    <header className="w-full max-w-5xl shrink-0">
      <FxStyles />
      <div
        className={cn(
          'relative flex items-stretch gap-2 rounded-lg border border-gold-800/40 px-2 py-1.5 sm:px-3',
          'bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(0,0,0,0.35))]',
          'shadow-[0_1px_0_rgba(255,255,255,0.06)_inset,0_20px_50px_-30px_rgba(224,179,58,0.5)]',
        )}
      >
        <Finial />

        <div className="flex min-w-0 flex-1 flex-col items-center justify-center">
          {/* The title. It never leaves; a banner sits over it. */}
          <div className="relative">
            <h1
              className="display text-center text-[clamp(1.05rem,4.4vw,2.15rem)] leading-none font-black text-transparent"
              style={{
                backgroundImage:
                  'linear-gradient(180deg, var(--color-gold-200) 0%, var(--color-gold-400) 42%, var(--color-gold-700) 72%, var(--color-gold-500) 100%)',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                filter: 'drop-shadow(0 1px 0 rgba(0,0,0,0.85)) drop-shadow(0 0 18px rgba(224,179,58,0.28))',
              }}
            >
              DRAGON&rsquo;S SHRINE
            </h1>
            {!reduced ? (
              <span
                aria-hidden
                className="ds-sweep fx-decorative display pointer-events-none absolute inset-0 text-center text-[clamp(1.05rem,4.4vw,2.15rem)] leading-none font-black text-transparent"
                style={{
                  backgroundImage:
                    'linear-gradient(100deg, transparent 38%, rgba(255,255,255,0.85) 50%, transparent 62%)',
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                }}
              >
                DRAGON&rsquo;S SHRINE
              </span>
            ) : null}
          </div>

          {/* Free spins rail. */}
          <AnimatePresence initial={false}>
            {free ? (
              <motion.div
                key="free-rail"
                initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
                animate={reduced ? { opacity: 1 } : { opacity: 1, height: 'auto' }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
                transition={{ duration: reduced ? 0.12 : 0.24 }}
                className="mt-1 flex w-full flex-wrap items-center justify-center gap-x-3 gap-y-1 overflow-hidden"
              >
                <span className="flex items-baseline gap-1.5">
                  <span className="numeric text-lg leading-none font-black text-ember-300 sm:text-xl">
                    {count(spinsLeft)}
                  </span>
                  <span className="text-[9px] font-bold tracking-[0.2em] text-ink-400 uppercase">
                    free {spinsLeft === 1 ? 'spin' : 'spins'} left
                  </span>
                </span>

                <Trail index={free.trailIndex} reduced={reduced} />

                <span className="flex items-baseline gap-1.5">
                  <span className="text-[9px] font-bold tracking-[0.2em] text-ink-400 uppercase">
                    feature total
                  </span>
                  <span className="numeric text-sm leading-none font-bold text-gold-300">
                    {money(free.won)}
                  </span>
                </span>

                {free.retriggers > 0 ? (
                  <Badge className="bg-jade-700/50 text-jade-300">
                    {free.retriggers} retrigger{free.retriggers === 1 ? '' : 's'}
                  </Badge>
                ) : null}
                {free.bought ? (
                  <Badge className="bg-violet-700/40 text-violet-400">bought</Badge>
                ) : null}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>

        <Finial flip />

        {/* The shout. Absolutely placed so its arrival never reflows the bar. */}
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
          aria-live="assertive"
          aria-atomic="true"
        >
          <AnimatePresence>
            {banner ? (
              <motion.div
                key={banner}
                initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.86, y: 6 }}
                animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 1.06 }}
                transition={
                  reduced ? { duration: 0.12 } : { type: 'spring', stiffness: 420, damping: 22 }
                }
                className="display rounded-md border border-ember-400/60 bg-[linear-gradient(180deg,rgba(217,91,22,0.96),rgba(122,36,8,0.96))] px-4 py-1.5 text-center text-[clamp(0.95rem,3.6vw,1.6rem)] leading-none font-black tracking-[0.14em] text-gold-200 uppercase shadow-[0_0_40px_-6px_var(--color-ember-500)]"
              >
                {banner}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </div>
    </header>
  );
}
