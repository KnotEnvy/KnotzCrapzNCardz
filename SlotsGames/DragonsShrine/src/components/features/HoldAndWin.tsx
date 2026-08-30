'use client';

/**
 * The Shrine Link.
 *
 * A hold-and-win is a very simple game that lives or dies on one number: the
 * respin counter. Everything on this screen is arranged around making that
 * counter legible and making its reset felt. Three, two, one, and then an orb
 * lands and it is three again -- the whole feature is that beat, repeated, and
 * a board that lets the reset go by quietly has thrown the feature away. So
 * the counter is the largest thing here, it pops on every change, and a
 * landing flashes RESPINS RESET across the board.
 *
 * The other thing this screen owes the player is the last empty niche. When
 * one cell is left the board is one orb away from the GRAND, and it says so,
 * loudly and continuously, until it either fills or the respins run out.
 */

import { AnimatePresence, motion } from 'motion/react';
import * as React from 'react';
import { OverlayShell, Pop } from './shell';
import { SymbolArt } from '@/components/symbols/Symbol';
import { Badge, cn } from '@/components/ui/primitives';
import { HOLD_RESPINS, JACKPOTS, MAJOR_AT_CELLS } from '@/lib/engine/paytable';
import { CELLS, REELS, ROWS, type JackpotId, type Orb } from '@/lib/engine/types';
import { count, money, moneyShort } from '@/lib/format';

const JACKPOT_COLOR: Record<JackpotId, string> = {
  MINI: 'var(--jackpot-mini)',
  MINOR: 'var(--jackpot-minor)',
  MAJOR: 'var(--jackpot-major)',
  GRAND: 'var(--jackpot-grand)',
};

/* ------------------------------------------------------------------ *
 * One niche
 * ------------------------------------------------------------------ */

function Niche({
  orb,
  index,
  reduced,
  lastOne,
}: {
  orb: Orb | undefined;
  index: number;
  reduced: boolean;
  /** True when this is the only empty cell on the board. */
  lastOne: boolean;
}) {
  const jackpot = orb && orb.award.kind === 'JACKPOT' ? orb.award.jackpot : null;
  const color = jackpot ? JACKPOT_COLOR[jackpot] : 'var(--color-ember-400)';

  if (!orb) {
    return (
      <div
        className={cn(
          'relative flex aspect-square items-center justify-center rounded-md border',
          lastOne
            ? 'border-cinnabar-400 bg-cinnabar-900/40'
            : 'border-ink-700/70 bg-ink-950/70',
        )}
      >
        {/* The carved arch of an empty niche. */}
        <svg viewBox="0 0 40 40" aria-hidden className="h-3/5 w-3/5 text-ink-700">
          <path
            d="M10 34V18a10 10 0 0 1 20 0v16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            opacity={lastOne ? 0.9 : 0.5}
          />
        </svg>
        {lastOne && !reduced ? (
          <motion.span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-md border-2 border-cinnabar-400"
            animate={{ opacity: [0.25, 1, 0.25] }}
            transition={{ duration: 0.75, repeat: Infinity, ease: 'easeInOut' }}
          />
        ) : null}
      </div>
    );
  }

  return (
    <motion.div
      initial={reduced ? { opacity: 0 } : { scale: 0.3, opacity: 0, rotate: -12 }}
      animate={{ scale: 1, opacity: 1, rotate: 0 }}
      transition={
        reduced
          ? { duration: 0.12 }
          : { type: 'spring', stiffness: 420, damping: 20, delay: Math.min(index, 6) * 0.02 }
      }
      className="relative flex aspect-square flex-col items-center justify-center overflow-hidden rounded-md border"
      style={{
        borderColor: color,
        background: `radial-gradient(120% 120% at 50% 25%, color-mix(in srgb, ${color} 34%, transparent), rgba(5,6,10,0.92))`,
        boxShadow: `0 0 22px -6px ${color}, 0 1px 0 rgba(255,255,255,0.12) inset`,
      }}
    >
      <SymbolArt id="ORB" fit className="absolute inset-0 opacity-45" />
      {jackpot ? (
        <span
          className="relative text-[8px] leading-none font-black tracking-[0.14em] uppercase sm:text-[10px]"
          style={{ color }}
        >
          {jackpot}
        </span>
      ) : null}
      <span
        className="numeric relative px-0.5 text-center text-[clamp(0.55rem,2.1vw,0.9rem)] leading-none font-black"
        style={{ color: 'var(--color-gold-200)', textShadow: '0 1px 2px rgba(0,0,0,0.9)' }}
      >
        {moneyShort(orb.amount)}
      </span>
    </motion.div>
  );
}

/* ------------------------------------------------------------------ *
 * The board
 * ------------------------------------------------------------------ */

export function HoldAndWin({
  orbs,
  respinsLeft,
  collected,
  awardedJackpots,
  totalBet,
  reduced,
  onSkip,
}: {
  orbs: Orb[];
  respinsLeft: number;
  collected: number;
  awardedJackpots: JackpotId[];
  totalBet: number;
  reduced: boolean;
  onSkip: () => void;
}) {
  /* Column-major, matching the grid everywhere else in the game. */
  const byCell = React.useMemo(() => {
    const map = new Map<string, Orb>();
    for (const o of orbs) map.set(`${o.reel}:${o.row}`, o);
    return map;
  }, [orbs]);

  const filled = orbs.length;
  const empty = CELLS - filled;
  const full = empty === 0;
  const oneLeft = empty === 1;

  /*
   * A landing is the only thing on this screen worth interrupting for, and the
   * store does not publish "an orb just landed" -- so it is derived from the
   * board growing, which is the same fact.
   */
  const prevFilled = React.useRef(filled);
  const [flash, setFlash] = React.useState(0);
  React.useEffect(() => {
    if (filled > prevFilled.current) setFlash((n) => n + 1);
    prevFilled.current = filled;
  }, [filled]);
  React.useEffect(() => {
    if (flash === 0) return;
    const t = window.setTimeout(() => setFlash(0), reduced ? 500 : 1000);
    return () => window.clearTimeout(t);
  }, [flash, reduced]);

  return (
    <OverlayShell
      label="Shrine Link hold and win"
      reduced={reduced}
      className="max-w-2xl gap-2"
      scrimClassName="bg-[radial-gradient(120%_90%_at_50%_40%,rgba(42,16,70,0.9),rgba(5,6,10,0.97))]"
    >
      {/* Header: what the feature is, and what it has paid so far. */}
      <div className="flex w-full items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="display text-[clamp(0.95rem,4vw,1.5rem)] leading-none font-black tracking-[0.14em] text-violet-400">
            SHRINE LINK
          </h2>
          <p className="numeric mt-1 text-[10px] text-ink-400">
            {count(filled)} / {CELLS} niches &middot; stake {money(totalBet)}
          </p>
        </div>
        <div className="text-right">
          <span className="block text-[9px] font-bold tracking-[0.24em] text-ink-400 uppercase">
            Collected
          </span>
          <span
            className="numeric block text-[clamp(1.1rem,5.2vw,2rem)] leading-none font-black text-gold-300"
            aria-live="polite"
          >
            {money(collected)}
          </span>
        </div>
      </div>

      {/* The board. */}
      <div
        className={cn(
          'relative w-full rounded-xl border-2 p-2 transition-colors sm:p-3',
          full
            ? 'border-[var(--jackpot-grand)]'
            : oneLeft
              ? 'border-cinnabar-400'
              : 'border-violet-700/60',
        )}
        style={{
          background: 'linear-gradient(180deg, rgba(16,19,28,0.94), rgba(5,6,10,0.96))',
          boxShadow: full
            ? '0 0 90px -14px var(--jackpot-grand)'
            : oneLeft
              ? '0 0 70px -18px var(--color-cinnabar-500)'
              : '0 0 60px -26px var(--color-violet-500)',
        }}
      >
        <div
          className="grid gap-1.5 sm:gap-2"
          style={{ gridTemplateColumns: `repeat(${REELS}, minmax(0, 1fr))` }}
          role="group"
          aria-label={`Link board, ${filled} of ${CELLS} niches filled`}
        >
          {/* Row-major in the DOM so a screen reader reads across, not down. */}
          {Array.from({ length: ROWS }, (_, row) =>
            Array.from({ length: REELS }, (_, reel) => (
              <Niche
                key={`${reel}:${row}`}
                orb={byCell.get(`${reel}:${row}`)}
                index={row * REELS + reel}
                reduced={reduced}
                lastOne={oneLeft && !byCell.has(`${reel}:${row}`)}
              />
            )),
          )}
        </div>

        {/* The reset, said out loud. */}
        <AnimatePresence>
          {flash > 0 && !full ? (
            <motion.div
              key={flash}
              initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.1 }}
              transition={{ duration: reduced ? 0.12 : 0.22 }}
              className="pointer-events-none absolute inset-0 flex items-center justify-center"
            >
              <span className="display rounded-md border border-ember-400 bg-ink-950/85 px-4 py-2 text-[clamp(0.8rem,3.4vw,1.3rem)] font-black tracking-[0.16em] text-ember-300 uppercase shadow-[0_0_50px_-8px_var(--color-ember-500)]">
                Respins reset
              </span>
            </motion.div>
          ) : null}
        </AnimatePresence>

        {/* Board filled: the GRAND. */}
        <AnimatePresence>
          {full ? (
            <motion.div
              initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={reduced ? { duration: 0.14 } : { type: 'spring', stiffness: 240, damping: 18 }}
              className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-xl bg-ink-950/88 text-center"
            >
              <span className="display text-[clamp(1.2rem,5.4vw,2.2rem)] leading-none font-black tracking-[0.14em] text-[var(--jackpot-grand)]">
                BOARD FULL
              </span>
              <span className="display text-[clamp(1.6rem,7.4vw,3rem)] leading-none font-black tracking-[0.1em] text-[var(--jackpot-grand)]">
                GRAND JACKPOT
              </span>
              <span className="numeric mt-1 text-[clamp(1.1rem,5vw,2rem)] leading-none font-black text-gold-200">
                {money(JACKPOTS.GRAND * totalBet)}
              </span>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      {/* Respins, the progress rail, and the exit. */}
      <div className="flex w-full flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="text-center" aria-live="assertive">
            <span className="block text-[9px] font-bold tracking-[0.24em] text-ink-400 uppercase">
              Respins
            </span>
            <Pop
              trigger={`${respinsLeft}-${filled}`}
              reduced={reduced}
              className={cn(
                'numeric text-[clamp(1.8rem,9vw,3.4rem)] leading-none font-black',
                respinsLeft >= HOLD_RESPINS
                  ? 'text-jade-300'
                  : respinsLeft === 1
                    ? 'text-cinnabar-400'
                    : 'text-gold-300',
              )}
            >
              {count(respinsLeft)}
            </Pop>
          </div>

          <div className="flex flex-wrap gap-1">
            {awardedJackpots.map((j, i) => (
              <Badge
                key={`${j}-${i}`}
                className="bg-ink-900"
                style={{ color: JACKPOT_COLOR[j], boxShadow: `0 0 18px -6px ${JACKPOT_COLOR[j]}` }}
              >
                {j}
              </Badge>
            ))}
          </div>
        </div>

        <div className="min-w-[9rem] flex-1">
          <div className="mb-1 flex justify-between text-[9px] font-bold tracking-[0.18em] text-ink-400 uppercase">
            <span>{oneLeft ? 'One niche left' : `${count(empty)} niches left`}</span>
            <span className="numeric">
              {MAJOR_AT_CELLS} = MAJOR &middot; {CELLS} = GRAND
            </span>
          </div>
          <div className="relative h-2 w-full overflow-hidden rounded-full bg-ink-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-violet-500 to-[var(--jackpot-grand)] transition-[width] duration-300"
              style={{ width: `${(filled / CELLS) * 100}%` }}
            />
            <span
              className="absolute top-0 h-full w-px bg-[var(--jackpot-major)]"
              style={{ left: `${(MAJOR_AT_CELLS / CELLS) * 100}%` }}
              aria-hidden
            />
          </div>
        </div>

        <button
          type="button"
          onClick={onSkip}
          className="rounded px-3 py-1 text-[10px] font-semibold tracking-[0.24em] text-ink-400 uppercase transition-colors hover:text-gold-300"
        >
          Skip to result
        </button>
      </div>
    </OverlayShell>
  );
}
