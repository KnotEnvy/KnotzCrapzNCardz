'use client';

/**
 * Attract mode.
 *
 * What a cabinet does when nobody is playing it: says its name, shows what it
 * pays, and waits. The idle board sits behind the glass at low contrast so the
 * machine reads as a machine rather than a menu, and the jackpots are quoted at
 * the stake the deck is actually set to, because a top prize in the abstract is
 * not information.
 *
 * Three things earn this screen its place beyond decoration.
 *
 * It is the audio gesture. Browsers refuse to open an AudioContext until the
 * page has been touched, and before this existed the first touch might have
 * been the spin button -- so the opening cue, the one sound most worth hearing,
 * was the one most likely to be swallowed. PLAY is now always first.
 *
 * It is where the machine says what it returns, along with the hit frequency,
 * the volatility and the largest spin the committed simulation ever saw. A game
 * that has measured itself this precisely and then keeps quiet about it is
 * being coy about the only figure a player is owed.
 *
 * And it is the way in to the paytable before any money moves, which is the
 * order a player would choose if anyone asked them.
 */

import * as React from 'react';
import { motion } from 'motion/react';
import { JACKPOT_COLOR, useCabinetUi } from './uiState';
import { Button, FxStyles, cn } from '@/components/ui/primitives';
import { LINES } from '@/lib/engine/config';
import { GAME_INFO, JACKPOTS } from '@/lib/engine/paytable';
import { JACKPOT_IDS } from '@/lib/engine/types';
import { money, moneyShort } from '@/lib/format';
import { playSound, unlockAudio } from '@/lib/audio';
import { useSlots } from '@/lib/store/useSlots';

/** What the machine is, in the few words a marquee has room for. */
const BILLING = [`${LINES} lines`, 'Free spins', 'Shrine Link', 'Four jackpots'];

const TITLE_SIZE =
  'text-[clamp(1.9rem,7vw,3.6rem)] leading-[1.05] font-black tight:text-[clamp(1.4rem,4.2vw,2.2rem)]';

export function StartScreen(): React.JSX.Element | null {
  const started = useCabinetUi((s) => s.started);
  const start = useCabinetUi((s) => s.start);
  const dialog = useCabinetUi((s) => s.dialog);
  const openDialog = useCabinetUi((s) => s.open);
  const totalBet = useSlots((s) => s.totalBet);
  const bankroll = useSlots((s) => s.bankroll);
  const reduced = useSlots((s) => s.prefs.reducedMotion);

  const begin = React.useCallback(() => {
    // Order matters: the context has to be open before anything is asked to
    // play into it, and this press is the gesture allowed to open it.
    unlockAudio();
    playSound('featureTrigger');
    start();
  }, [start]);

  /*
   * Enter and space start the machine. The deck's own shortcuts stay asleep
   * until it does, so without this a keyboard player would be stranded at a
   * screen whose only control was a mouse target. Suppressed while a dialog is
   * open, because there the same keys belong to whatever has focus.
   */
  React.useEffect(() => {
    if (started || dialog !== null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const el = document.activeElement;
      if (el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'BUTTON')) return;
      e.preventDefault();
      begin();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [started, dialog, begin]);

  if (started) return null;

  const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

  const facts: Array<[string, string]> = [
    ['Return to player', pct(GAME_INFO.rtp)],
    ['Hit frequency', pct(GAME_INFO.hitFrequency)],
    ['Volatility', `High · ${GAME_INFO.volatility.toFixed(1)}`],
    ['Largest spin seen', `${GAME_INFO.maxWin.toLocaleString('en-US')}x`],
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Dragon's Shrine. Press play to begin."
      /* z-40 ties with the particle canvas and is beaten by the dialogs at
         z-50, which is the ordering this screen needs: it covers the cabinet,
         and the paytable and settings open over it. */
      className="absolute inset-0 z-40 flex items-center justify-center overflow-hidden px-3 py-3"
    >
      <FxStyles />

      {/* The board stays visible underneath: a cabinet in attract mode is still
          visibly a cabinet, not a menu with a game somewhere behind it. */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_35%,rgba(5,6,10,0.84),rgba(5,6,10,0.97))] backdrop-blur-[2px]" />

      <motion.div
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14 }}
        animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
        transition={{ duration: reduced ? 0.14 : 0.42, ease: [0.16, 1, 0.3, 1] }}
        className="relative flex max-h-full w-full max-w-2xl flex-col items-center gap-2.5 overflow-y-auto sm:gap-3 tight:max-w-3xl tight:gap-1.5"
      >
        <div className="relative text-center">
          <h1
            className={cn('display text-transparent', TITLE_SIZE)}
            style={{
              backgroundImage:
                'linear-gradient(180deg, var(--color-gold-200) 0%, var(--color-gold-400) 42%, var(--color-gold-700) 72%, var(--color-gold-500) 100%)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              filter:
                'drop-shadow(0 2px 0 rgba(0,0,0,0.9)) drop-shadow(0 0 34px rgba(224,179,58,0.34))',
            }}
          >
            DRAGON&rsquo;S SHRINE
          </h1>
          {!reduced ? (
            <span
              aria-hidden
              className={cn(
                'ds-sweep fx-decorative display pointer-events-none absolute inset-0 text-transparent',
                TITLE_SIZE,
              )}
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

        <ul className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
          {BILLING.map((b) => (
            <li
              key={b}
              className="rounded-full border border-gold-800/50 bg-ink-950/70 px-2.5 py-1 text-[10px] font-bold tracking-[0.16em] text-ink-300 uppercase"
            >
              {b}
            </li>
          ))}
        </ul>

        {/* Quoted at the stake on the deck, not in the abstract. */}
        <ul className="grid w-full grid-cols-4 gap-1.5 sm:gap-2">
          {JACKPOT_IDS.map((id) => (
            <li
              key={id}
              className="rounded-md border px-1.5 py-1.5 text-center"
              style={{
                borderColor: JACKPOT_COLOR[id],
                background: `linear-gradient(180deg, color-mix(in srgb, ${JACKPOT_COLOR[id]} 14%, transparent), rgba(5,6,10,0.85))`,
              }}
            >
              <span
                className="block text-[9px] font-black tracking-[0.18em] uppercase"
                style={{ color: JACKPOT_COLOR[id] }}
              >
                {id}
              </span>
              <span
                className="numeric block text-[clamp(0.8rem,2.8vw,1.25rem)] font-black"
                style={{ color: JACKPOT_COLOR[id] }}
              >
                {moneyShort(JACKPOTS[id] * totalBet)}
              </span>
            </li>
          ))}
        </ul>

        <Button
          size="lg"
          variant="gilt"
          onClick={begin}
          autoFocus
          className="mt-0.5 w-full max-w-xs text-sm tracking-[0.3em]"
        >
          PLAY
        </Button>

        <div className="flex items-center gap-2">
          <Button size="sm" variant="deck" onClick={() => openDialog('paytable')}>
            PAYTABLE
          </Button>
          <Button size="sm" variant="deck" onClick={() => openDialog('settings')}>
            SETTINGS
          </Button>
        </div>

        <dl className="grid w-full grid-cols-2 gap-x-4 gap-y-1 border-t border-white/[0.07] pt-2 sm:grid-cols-4">
          {facts.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-[8px] font-bold tracking-[0.16em] text-ink-500 uppercase">{k}</dt>
              <dd className="numeric truncate text-[11px] text-gold-300">{v}</dd>
            </div>
          ))}
        </dl>

        <p className="max-w-lg text-center text-[9px] leading-relaxed text-ink-500 tight:hidden">
          Measured over twenty million simulated spins, not estimated. Play money only &mdash; this
          machine takes no deposits and pays out no cash. You start with {money(bankroll)}.
        </p>
      </motion.div>
    </div>
  );
}
