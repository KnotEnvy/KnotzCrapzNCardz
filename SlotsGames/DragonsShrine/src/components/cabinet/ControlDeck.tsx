'use client';

/**
 * The button deck.
 *
 * A cabinet's controls are a physical object with a fixed geometry: the stake
 * on one side, the spin button under the dominant hand, the utilities along a
 * rail where they cannot be hit by accident. That geometry is the whole design
 * here, and `prefs.leftHanded` mirrors it rather than rearranging it.
 *
 * The spin button is one button with four jobs, because on a real machine it
 * is one button with four jobs: it starts the spin, it slams the reels, it
 * skips a celebration, and it stops autoplay. Splitting them into separate
 * controls sounds tidier and is wrong -- a player reaching for the big round
 * thing mid-spin means "stop", every time.
 *
 * Nothing here is enabled by wishful thinking. The stake cannot move during a
 * spin or inside a feature, the buy cannot fire while a feature is running,
 * and the keyboard shortcuts stand down entirely while a dialog has the
 * screen or the player is typing.
 */

import { AnimatePresence, motion } from 'motion/react';
import * as React from 'react';
import {
  BoltIcon,
  CardsIcon,
  ChartIcon,
  CoinsIcon,
  GearIcon,
  InfoIcon,
  LoopIcon,
  MinusIcon,
  MusicIcon,
  PlusIcon,
  SoundOffIcon,
  SoundOnIcon,
} from './icons';
import { useCabinetUi } from './uiState';
import { Badge, Button, IconButton, PlateLabel, cn } from '@/components/ui/primitives';
import { playSound } from '@/lib/audio';
import { AUTOPLAY_COUNTS, BET_LADDER, KEYS, LINES, totalBetAt } from '@/lib/engine/config';
import { count, money } from '@/lib/format';
import { useSlots } from '@/lib/store/useSlots';

/* ------------------------------------------------------------------ *
 * The spin button
 * ------------------------------------------------------------------ */

type SpinMode = 'SPIN' | 'STOP' | 'STOP_AUTO' | 'SKIP' | 'BUSY';

const SPIN_LABEL: Record<SpinMode, string> = {
  SPIN: 'SPIN',
  STOP: 'STOP',
  STOP_AUTO: 'STOP AUTO',
  SKIP: 'SKIP',
  BUSY: 'IN PLAY',
};

/** The one control everything else is arranged around. */
function SpinButton({
  mode,
  onPress,
  autoLeft,
}: {
  mode: SpinMode;
  onPress: () => void;
  autoLeft: number | null;
}) {
  const busy = mode === 'BUSY';
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={busy}
      aria-label={SPIN_LABEL[mode]}
      className={cn(
        'no-select relative grid aspect-square shrink-0 place-items-center rounded-full transition-all duration-100',
        'h-[clamp(4.25rem,17vw,6rem)] w-[clamp(4.25rem,17vw,6rem)]',
        'active:translate-y-0.5 active:shadow-[0_2px_0_var(--color-gold-900),0_6px_14px_-8px_rgba(0,0,0,0.9)]',
        busy
          ? 'cursor-default border-4 border-ink-700 bg-ink-850 text-ink-500'
          : mode === 'SPIN'
            ? 'border-4 border-gold-700/70 bg-[radial-gradient(120%_120%_at_50%_18%,var(--color-gold-200),var(--color-gold-400)_42%,var(--color-gold-700)_100%)] text-ink-950 shadow-[0_6px_0_var(--color-gold-900),0_16px_36px_-14px_rgba(224,179,58,0.95),0_2px_0_rgba(255,255,255,0.6)_inset]'
            : 'border-4 border-cinnabar-800 bg-[radial-gradient(120%_120%_at_50%_18%,var(--color-cinnabar-400),var(--color-cinnabar-600)_45%,var(--color-cinnabar-900)_100%)] text-gold-200 shadow-[0_6px_0_var(--color-cinnabar-900),0_16px_36px_-14px_rgba(217,48,48,0.9),0_2px_0_rgba(255,255,255,0.35)_inset]',
      )}
    >
      <span className="display px-1 text-center text-[clamp(0.6rem,2.3vw,0.85rem)] leading-none font-black tracking-[0.1em]">
        {SPIN_LABEL[mode]}
      </span>
      {autoLeft !== null ? (
        <span className="numeric absolute bottom-[14%] text-[9px] leading-none font-bold opacity-80">
          {Number.isFinite(autoLeft) ? count(autoLeft) : '∞'}
        </span>
      ) : null}
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * Autoplay
 * ------------------------------------------------------------------ */

/** A popover rather than a dialog: it is a choice, not a document. */
function AutoplayMenu({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (n: number) => void;
}) {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    ref.current?.querySelector<HTMLElement>('button')?.focus();
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          ref={ref}
          initial={{ opacity: 0, y: 6, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 4, scale: 0.98 }}
          transition={{ duration: 0.12 }}
          role="menu"
          aria-label="Autoplay spins"
          className="absolute right-0 bottom-full z-40 mb-2 w-40 rounded-lg border border-gold-800/50 bg-ink-900/98 p-1.5 shadow-[0_24px_50px_-20px_rgba(0,0,0,0.95)] backdrop-blur"
        >
          <PlateLabel className="px-1.5 pt-0.5 pb-1.5">Autoplay</PlateLabel>
          <div className="grid grid-cols-3 gap-1">
            {AUTOPLAY_COUNTS.map((n) => (
              <button
                key={String(n)}
                type="button"
                role="menuitem"
                onClick={() => {
                  onPick(n);
                  onClose();
                }}
                aria-label={Number.isFinite(n) ? `${n} spins` : 'Unlimited spins'}
                className="numeric rounded border border-white/10 bg-ink-800 py-1.5 text-[11px] font-bold text-ink-100 transition-colors hover:border-gold-600/60 hover:bg-ink-700 hover:text-gold-300"
              >
                {Number.isFinite(n) ? n : '∞'}
              </button>
            ))}
          </div>
          <p className="mt-1.5 px-1 text-[9px] leading-snug text-ink-500">
            Autoplay stops on its own for a feature, and the spin button stops it at any time.
          </p>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ *
 * The stake rail
 * ------------------------------------------------------------------ */

function BetRail({ locked }: { locked: boolean }) {
  const betIndex = useSlots((s) => s.betIndex);
  const betPerLine = useSlots((s) => s.betPerLine);
  const totalBet = useSlots((s) => s.totalBet);
  const betUp = useSlots((s) => s.betUp);
  const betDown = useSlots((s) => s.betDown);
  const setBetIndex = useSlots((s) => s.setBetIndex);
  const maxBet = useSlots((s) => s.maxBet);

  const top = BET_LADDER.length - 1;

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1.5">
      <IconButton
        label="Lower the bet"
        size="md"
        disabled={locked || betIndex === 0}
        onClick={() => {
          betDown();
          playSound('betChange');
        }}
      >
        <MinusIcon />
      </IconButton>

      <div className="min-w-0 flex-1 rounded-md border border-gold-800/40 bg-ink-950/80 px-2 py-1 text-center shadow-[0_2px_10px_rgba(0,0,0,0.6)_inset]">
        <PlateLabel>Total bet</PlateLabel>
        <div className="numeric mt-0.5 truncate text-[clamp(0.85rem,3.6vw,1.15rem)] leading-none font-bold text-gold-300">
          {money(totalBet)}
        </div>
        <div className="numeric mt-0.5 truncate text-[9px] text-ink-500">
          {money(betPerLine)} x {LINES} &middot; rung {betIndex + 1}/{BET_LADDER.length}
        </div>
        {/* The ladder itself, tappable. A player who wants $10 a spin should
            not have to press + five times to find it. */}
        <div className="mt-1 flex gap-px" role="group" aria-label="Stake ladder">
          {BET_LADDER.map((_, i) => (
            <button
              key={i}
              type="button"
              disabled={locked}
              onClick={() => {
                setBetIndex(i);
                playSound('betChange');
              }}
              aria-label={`Bet ${money(totalBetAt(i))} a spin`}
              aria-pressed={i === betIndex}
              className={cn(
                'h-1.5 min-w-0 flex-1 rounded-[1px] transition-colors disabled:cursor-default',
                i <= betIndex ? 'bg-gold-500' : 'bg-ink-700 hover:bg-ink-600',
              )}
            />
          ))}
        </div>
      </div>

      <IconButton
        label="Raise the bet"
        size="md"
        disabled={locked || betIndex === top}
        onClick={() => {
          betUp();
          playSound('betChange');
        }}
      >
        <PlusIcon />
      </IconButton>

      <Button
        variant="deck"
        size="md"
        disabled={locked || betIndex === top}
        onClick={() => {
          maxBet();
          playSound('betChange');
        }}
        className="hidden shrink-0 px-2 text-[10px] tracking-[0.14em] sm:inline-flex"
      >
        MAX BET
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The deck
 * ------------------------------------------------------------------ */

export function ControlDeck(): React.JSX.Element {
  const phase = useSlots((s) => s.phase);
  const autoplay = useSlots((s) => s.autoplay);
  const free = useSlots((s) => s.free);
  const hold = useSlots((s) => s.hold);
  const canGamble = useSlots((s) => s.canGamble);
  const prefs = useSlots((s) => s.prefs);

  const spin = useSlots((s) => s.spin);
  const stopReels = useSlots((s) => s.stopReels);
  const stopAutoplay = useSlots((s) => s.stopAutoplay);
  const startAutoplay = useSlots((s) => s.startAutoplay);
  const startGamble = useSlots((s) => s.startGamble);
  const maxBet = useSlots((s) => s.maxBet);
  const betUp = useSlots((s) => s.betUp);
  const betDown = useSlots((s) => s.betDown);
  const skip = useSlots((s) => s.skip);
  const setPref = useSlots((s) => s.setPref);

  const dialog = useCabinetUi((s) => s.dialog);
  const openDialog = useCabinetUi((s) => s.open);

  const [autoOpen, setAutoOpen] = React.useState(false);

  /* The stake is frozen mid-spin and for the whole of a feature: a machine
     that let the bet move between free spins would be paying the trail at one
     stake and the reels at another. */
  const inFeature = free !== null || hold !== null;
  const betLocked = phase !== 'IDLE' || autoplay !== null || inFeature;

  const mode: SpinMode =
    autoplay !== null
      ? 'STOP_AUTO'
      : phase === 'SPINNING'
        ? 'STOP'
        : phase === 'PRESENTING' ||
            phase === 'TAKEOVER' ||
            phase === 'FEATURE_INTRO' ||
            phase === 'FEATURE_OUTRO'
          ? 'SKIP'
          : phase === 'FREE_SPINS' || phase === 'HOLD' || phase === 'GAMBLE'
            ? 'BUSY'
            : 'SPIN';

  const press = React.useCallback(() => {
    playSound('buttonPress');
    if (autoplay !== null) stopAutoplay();
    else if (phase === 'SPINNING') stopReels();
    else if (
      phase === 'PRESENTING' ||
      phase === 'TAKEOVER' ||
      phase === 'FEATURE_INTRO' ||
      phase === 'FEATURE_OUTRO'
    )
      skip();
    else if (phase === 'IDLE') spin();
  }, [autoplay, phase, spin, stopReels, stopAutoplay, skip]);

  /*
   * Keyboard.
   *
   * Two guards, and both matter. A dialog owns the keyboard while it is up --
   * space in the seed box types a space, it does not spin fifty dollars. And
   * any editable target is left alone regardless, because a shortcut that
   * fires while someone is typing is a bug report about "random spins".
   */
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialog !== null) return;
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT' ||
          el.isContentEditable)
      )
        return;

      const k = e.key;
      const has = (keys: readonly string[]) => keys.includes(k);

      if (autoOpen && has(KEYS.skip)) {
        setAutoOpen(false);
        return;
      }

      if (has(KEYS.spin)) {
        e.preventDefault();
        press();
      } else if (has(KEYS.skip)) {
        skip();
      } else if (has(KEYS.betUp)) {
        if (betLocked) return;
        e.preventDefault();
        betUp();
      } else if (has(KEYS.betDown)) {
        if (betLocked) return;
        e.preventDefault();
        betDown();
      } else if (has(KEYS.maxBet)) {
        if (!betLocked) maxBet();
      } else if (has(KEYS.turbo)) {
        setPref('turbo', !prefs.turbo);
      } else if (has(KEYS.mute)) {
        setPref('sound', !prefs.sound);
      } else if (has(KEYS.autoplay)) {
        if (autoplay !== null) stopAutoplay();
        else setAutoOpen((v) => !v);
      } else if (has(KEYS.paytable)) {
        openDialog('paytable');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    dialog,
    autoOpen,
    betLocked,
    press,
    skip,
    betUp,
    betDown,
    maxBet,
    setPref,
    prefs.turbo,
    prefs.sound,
    autoplay,
    stopAutoplay,
    openDialog,
  ]);

  return (
    <footer className="w-full max-w-5xl shrink-0 pb-0.5">
      {/* The utility rail. Small, out of the way of the thumb. */}
      <div className="mb-1.5 flex items-center justify-between gap-1">
        <div className="flex items-center gap-1">
          <IconButton
            size="sm"
            label="Paytable and rules"
            onClick={() => openDialog('paytable')}
          >
            <InfoIcon />
          </IconButton>
          <IconButton size="sm" label="Session statistics" onClick={() => openDialog('session')}>
            <ChartIcon />
          </IconButton>
          <IconButton size="sm" label="Settings" onClick={() => openDialog('settings')}>
            <GearIcon />
          </IconButton>
          {autoplay !== null ? (
            <Badge className="ml-1 bg-jade-700/50 text-jade-300">
              auto {Number.isFinite(autoplay.left) ? count(autoplay.left) : '∞'}
            </Badge>
          ) : null}
        </div>

        <div className="flex items-center gap-1">
          {canGamble && phase === 'IDLE' ? (
            <Button
              size="sm"
              variant="cinnabar"
              onClick={() => {
                playSound('buttonPress');
                startGamble();
              }}
              className="gap-1 text-[10px] tracking-[0.14em]"
            >
              <CardsIcon />
              GAMBLE
            </Button>
          ) : null}
          <IconButton
            size="sm"
            label="Turbo spin"
            active={prefs.turbo}
            onClick={() => {
              setPref('turbo', !prefs.turbo);
              playSound('buttonToggle');
            }}
          >
            <BoltIcon />
          </IconButton>
          <IconButton
            size="sm"
            label={prefs.music ? 'Music on' : 'Music off'}
            active={prefs.music}
            onClick={() => {
              setPref('music', !prefs.music);
              playSound('buttonToggle');
            }}
          >
            <MusicIcon />
          </IconButton>
          <IconButton
            size="sm"
            label={prefs.sound ? 'Sound on' : 'Sound off'}
            active={prefs.sound}
            onClick={() => {
              setPref('sound', !prefs.sound);
              playSound('buttonToggle');
            }}
          >
            {prefs.sound ? <SoundOnIcon /> : <SoundOffIcon />}
          </IconButton>
        </div>
      </div>

      {/* The deck proper. Mirrored for a left-handed player. */}
      <div
        className={cn(
          'flex items-center gap-2 sm:gap-3',
          prefs.leftHanded && 'flex-row-reverse',
        )}
      >
        <BetRail locked={betLocked} />

        <SpinButton
          mode={mode}
          onPress={press}
          autoLeft={autoplay !== null ? autoplay.left : null}
        />

        <div
          className={cn(
            'relative flex min-w-0 flex-1 flex-col gap-1.5',
            prefs.leftHanded ? 'items-start' : 'items-end',
          )}
        >
          <Button
            size="md"
            variant="violet"
            disabled={phase !== 'IDLE' || autoplay !== null || inFeature}
            onClick={() => openDialog('buy')}
            className="w-full max-w-[10rem] gap-1.5 text-[10px] tracking-[0.12em] sm:text-[11px]"
          >
            <CoinsIcon />
            BUY FEATURE
          </Button>

          <Button
            size="md"
            variant="deck"
            disabled={inFeature || (phase !== 'IDLE' && autoplay === null)}
            aria-haspopup="menu"
            aria-expanded={autoOpen}
            onClick={() => {
              if (autoplay !== null) {
                stopAutoplay();
                return;
              }
              setAutoOpen((v) => !v);
            }}
            className="w-full max-w-[10rem] gap-1.5 text-[10px] tracking-[0.12em] sm:text-[11px]"
          >
            <LoopIcon />
            {autoplay !== null ? 'STOP AUTO' : 'AUTOPLAY'}
          </Button>

          <AutoplayMenu
            open={autoOpen}
            onClose={() => setAutoOpen(false)}
            onPick={(n) => startAutoplay(n)}
          />
        </div>
      </div>
    </footer>
  );
}
