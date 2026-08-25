'use client';

import { AnimatePresence, motion } from 'motion/react';
import * as React from 'react';
import { ActionBar, ChipRack, RollButton, SeatBar } from '@/components/Controls';
import { HopDialog, NewSessionDialog, SettingsDialog } from '@/components/Dialogs';
import { StartScreen } from '@/components/Setup';
import { StrategyWorkshop } from '@/components/strategy/Workshop';
import { DiceStage } from '@/components/dice/DiceStage';
import { Hud } from '@/components/hud/Hud';
import { Felt } from '@/components/table/Felt';
import { Button, cn } from '@/components/ui/primitives';
import {
  chipDrop,
  chipSlide,
  comeTravel,
  natural,
  payout,
  pointMade,
  puckOff,
  puckOn,
  rake,
  refuse,
  setSoundEnabled,
  sevenOut,
} from '@/lib/audio';
import { atRisk } from '@/lib/engine/table';
import { DENOMS } from '@/components/table/Chip';
import { useGame } from '@/lib/store/useGame';

/*
 * The beats of a roll, in seconds after it settles.
 *
 * Read against Fx.tsx: the loss flights are the shortest thing on the felt and
 * the rake has to be over before they are, the win flash runs longest and the
 * payout sits inside it, and the puck lands late enough that it is heard as a
 * separate event rather than as part of the sting.
 */
const RAKE_AT = 0.09;
const PAYOUT_AT = 0.17;
const TRAVEL_AT = 0.3;
const PUCK_OFF_AT = 0.55;
/** A bot's chips go down after the roll's own sounds have had the floor. */
const BOT_AT = 0.45;

/**
 * How tall a drop of chips sounds.
 *
 * A dollar figure is not a chip count, but the felt draws a stack the same way:
 * more money, more chips. Doubling the money adds one chip to the sound, which
 * keeps a $5 place bet and a $200 one audibly different without letting the
 * second turn into a landslide.
 */
function stackFor(amount: number, unit: number): number {
  const units = Math.max(1, amount / Math.max(1, unit));
  return Math.max(1, Math.min(5, Math.round(1 + Math.log2(units))));
}

/**
 * How many calls a strategy actually landed on a given roll.
 *
 * Only successful entries count. A rule refused for want of chips has not moved
 * anything and should not sound like it has — the toast already says so.
 */
function countCalls(log: ReadonlyArray<{ roll: number; ok: boolean }>, roll: number): number {
  let n = 0;
  for (const entry of log) if (entry.roll === roll && entry.ok) n += 1;
  return n;
}

export default function Page() {
  const [hopOpen, setHopOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [newOpen, setNewOpen] = React.useState(false);
  const [newSessionKey, setNewSessionKey] = React.useState(0);
  const [strategyOpen, setStrategyOpen] = React.useState(false);
  /** Which system the workshop should land on — a seat badge names its own. */
  const [strategyFocus, setStrategyFocus] = React.useState<string | null>(null);
  const [strategyKey, setStrategyKey] = React.useState(0);

  const openStrategy = React.useCallback((id: string | null = null) => {
    setStrategyFocus(id);
    // Bumping the key remounts the workshop, which is how it lands on the
    // strategy the caller named without an effect syncing it afterwards.
    setStrategyKey((k) => k + 1);
    setStrategyOpen(true);
  }, []);

  // The saved session only exists on the client, so the first paint waits for
  // the store to rehydrate rather than flashing a default table and correcting
  // itself. Subscribing to persist's own signal avoids a cascading re-render.
  const hydrated = React.useSyncExternalStore(
    (onChange) => useGame.persist.onFinishHydration(onChange),
    () => useGame.persist.hasHydrated(),
    () => false,
  );

  const initPhysics = useGame((s) => s.initPhysics);
  const sessionStarted = useGame((s) => s.sessionStarted);
  const table = useGame((s) => s.table);
  const solo = table.solo;
  const soundOn = useGame((s) => s.soundOn);
  // The roll score and the chip cues both need what the last roll actually did
  // with the money, and settlements carry their own location and amount.
  const settlements = useGame((s) => s.settlements);
  const strategyMemory = useGame((s) => s.strategyMemory);
  const throwDice = useGame((s) => s.throwDice);
  const setChip = useGame((s) => s.setChip);
  const setActiveSeat = useGame((s) => s.setActiveSeat);
  const maxOdds = useGame((s) => s.maxOdds);
  const runSeatStrategy = useGame((s) => s.runSeatStrategy);
  const rolling = useGame((s) => s.rolling);
  // Kept in the store rather than local state so the choice survives a reload.
  const hudOpen = useGame((s) => s.showHud);
  const toggleHud = useGame((s) => s.toggleHud);

  React.useEffect(() => void initPhysics(), [initPhysics]);
  React.useEffect(() => setSoundEnabled(soundOn), [soundOn]);

  /*
   * The score for a roll.
   *
   * A settled roll is not one sound, it is four beats in the order a real table
   * plays them: the call, the stick clearing the losers, the dealers paying the
   * winners, and the puck coming off. The offsets below are picked against the
   * effect layers in Fx rather than by feel — the rake sits under the loss
   * flights, the payout under the win flash, and the puck lands after both.
   *
   * This is the only place in the app that decides what a roll sounds like.
   * Fx.tsx is read-only decoration by design and stays that way; it is handed a
   * settlement list and draws it, and this is handed the same list and plays it.
   */
  const lastAnnounced = React.useRef<number | null>(null);
  React.useEffect(() => {
    const rec = table.history[table.history.length - 1];
    const index = rec?.index ?? -1;

    /*
     * A restored session arrives with its last roll already in history. Taking
     * the index present at mount as already-announced is the audio half of
     * Felt's `openingRoll`: without it, reopening the tab replays yesterday's
     * seven out into an empty room.
     */
    if (lastAnnounced.current === null) {
      lastAnnounced.current = index;
      return;
    }
    if (!rec || index === lastAnnounced.current) return;
    lastAnnounced.current = index;

    let wins = 0;
    let losses = 0;
    let travelled = false;
    for (const s of settlements) {
      if (s.type === 'WIN' && s.credit > 0) wins += 1;
      else if (s.type === 'LOSE' && s.debit > 0) losses += 1;
      else if (s.type === 'MOVE') travelled = true;
    }

    if (rec.outcome === 'SEVEN_OUT') sevenOut();
    else if (rec.outcome === 'POINT_MADE') pointMade();
    else if (rec.outcome === 'NATURAL') natural();
    else if (rec.outcome === 'POINT_ESTABLISHED') puckOn();

    if (losses > 0) rake(losses, RAKE_AT);
    if (wins > 0) payout(wins, PAYOUT_AT);
    if (travelled) comeTravel(TRAVEL_AT);
    // The point coming down: made, or sevened off. Both end with the puck
    // flipped over, and neither is the same event as the sting that preceded it.
    if (rec.pointBefore !== null && rec.pointAfter === null) puckOff(PUCK_OFF_AT);
  }, [table.history, settlements]);

  /*
   * Chips hitting the felt, and chips coming back off it.
   *
   * Bets are placed from four different places — a click on the layout, the
   * grouped dealer calls, the hop dialog and a strategy — and only one of those
   * is in this file. Rather than sprinkling a call site into each, this watches
   * the one thing they all move: how much money the seats have at risk. A rise
   * between rolls is chips going down whoever put them there, and a fall is
   * chips coming back.
   *
   * The roll itself is excluded, because a roll moves money for reasons the
   * score above has already spoken for. The one thing that leaves uncovered is
   * a bot betting in the same commit as the roll it is reacting to, which is
   * exactly what autoplay does, so that case is read off the strategy log and
   * lands after the sting has cleared.
   */
  const chipsRef = React.useRef<{
    rolls: number;
    risk: number;
    tailA: unknown;
    tailB: unknown;
  } | null>(null);
  React.useEffect(() => {
    const risk = atRisk(table, 'A') + atRisk(table, 'B');
    const rolls = table.stats.rolls;
    const tailA = strategyMemory.A.log.at(-1);
    const tailB = strategyMemory.B.log.at(-1);

    const prev = chipsRef.current;
    chipsRef.current = { rolls, risk, tailA, tailB };
    if (!prev) return;

    const spoke = tailA !== prev.tailA || tailB !== prev.tailB;

    if (rolls !== prev.rolls) {
      if (!spoke) return;
      const calls =
        countCalls(strategyMemory.A.log, table.rollCount) +
        countCalls(strategyMemory.B.log, table.rollCount);
      // One rule that spoke is one chip. chipDrop caps the stack itself.
      if (calls > 0) chipDrop(calls, BOT_AT);
      return;
    }

    const delta = risk - prev.risk;
    if (delta > 0) chipDrop(stackFor(delta, table.rules.minBet));
    else if (delta < 0) chipSlide(stackFor(-delta, table.rules.minBet));
  }, [table, strategyMemory]);

  /* Keyboard: the shortcuts a regular would want. */
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;

      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        throwDice();
      } else if (e.key >= '1' && e.key <= '7') {
        const d = DENOMS[Number(e.key) - 1];
        if (d) setChip(d.value);
      } else if (e.key.toLowerCase() === 'a') setActiveSeat('A');
      else if (e.key.toLowerCase() === 'b' && !solo) setActiveSeat('B');
      else if (e.key.toLowerCase() === 'o') maxOdds();
      else if (e.key.toLowerCase() === 'h') toggleHud();
      // The call a player on a strategy makes most: put my system on the felt.
      else if (e.key.toLowerCase() === 's') runSeatStrategy();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [throwDice, setChip, setActiveSeat, maxOdds, toggleHud, runSeatStrategy, solo]);

  if (!hydrated) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-pit-400">
        Setting the table…
      </div>
    );
  }

  // Nobody has sat down yet: the setup screen is the whole page until they do.
  if (!sessionStarted) return <StartScreen />;

  return (
    <div className="flex h-full flex-col">
      <TopBar
        onSettings={() => setSettingsOpen(true)}
        onStrategies={() => openStrategy(null)}
        onNew={() => {
          setNewSessionKey((k) => k + 1);
          setNewOpen(true);
        }}
        hudOpen={hudOpen}
        onToggleHud={toggleHud}
      />

      <main
        className={cn(
          'grid min-h-0 flex-1 gap-3 p-3 pt-0',
          hudOpen ? 'xl:grid-cols-[minmax(0,1fr)_360px]' : 'grid-cols-1',
        )}
      >
        <div className="flex min-h-0 min-w-0 flex-col gap-3">
          <SeatBar onOpenStrategy={openStrategy} />

          <div className="relative min-h-0 flex-1">
            <div className="absolute inset-0">
              <Felt onOpenHop={() => setHopOpen(true)} />
            </div>
            <DiceStage />
            <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center">
              {rolling ? (
                <span className="rounded-full bg-black/60 px-3 py-1 text-[11px] tracking-widest text-brass-300 uppercase backdrop-blur">
                  Dice are out
                </span>
              ) : (
                <Toasts />
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-end justify-between gap-3">
            <ChipRack />
            <RollButton />
          </div>
          <ActionBar onOpenHop={() => setHopOpen(true)} onOpenStrategy={() => openStrategy(null)} />
        </div>

        {/* Wide: a column beside the felt. Narrower: a drawer over it, so the
            stats stay reachable without shrinking the table to nothing. */}
        {hudOpen ? (
          <aside
            className={cn(
              'thin-scroll min-h-0 overflow-y-auto',
              // Starts below the header so the button that closes it again is
              // never underneath it.
              'max-xl:fixed max-xl:top-14 max-xl:bottom-0 max-xl:right-0 max-xl:z-40 max-xl:w-[368px]',
              'max-xl:border-l max-xl:border-white/10 max-xl:bg-pit-950/95 max-xl:p-3',
              'max-xl:shadow-[0_0_60px_rgba(0,0,0,0.7)] max-xl:backdrop-blur',
            )}
            aria-label="Session statistics"
          >
            <Hud />
          </aside>
        ) : null}
      </main>

      <HopDialog open={hopOpen} onClose={() => setHopOpen(false)} />
      <StrategyWorkshop
        key={`workshop-${strategyKey}`}
        open={strategyOpen}
        initialId={strategyFocus}
        onClose={() => setStrategyOpen(false)}
      />
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      {/* Keyed on each opening so its fields start from the current table
          without an effect having to reset them. The key is prefixed because
          these remount counters are siblings in one children array and both
          start at zero -- two bare counters collide on `0` at first mount. */}
      <NewSessionDialog
        key={`new-session-${newSessionKey}`}
        open={newOpen}
        onClose={() => setNewOpen(false)}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Top bar
 * ------------------------------------------------------------------ */

function TopBar({
  onSettings,
  onStrategies,
  onNew,
  hudOpen,
  onToggleHud,
}: {
  onSettings: () => void;
  onStrategies: () => void;
  onNew: () => void;
  hudOpen: boolean;
  onToggleHud: () => void;
}) {
  const table = useGame((s) => s.table);
  const onPoint = table.point !== null;

  return (
    <header className="flex shrink-0 items-center gap-4 px-3 py-2.5">
      <h1 className="flex items-baseline gap-2">
        <span
          className="text-lg font-bold tracking-[0.22em] text-brass-400 uppercase"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Knotz Craps
        </span>
      </h1>

      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            'rounded-md px-2.5 py-1 text-[11px] font-bold tracking-widest uppercase',
            onPoint ? 'bg-emerald-500/15 text-emerald-300' : 'bg-brass-500/15 text-brass-300',
          )}
        >
          {onPoint ? `Point ${table.point}` : 'Come out'}
        </span>
        <span className="text-[11px] text-pit-400">
          {table.stats.rolls} rolls
          {table.solo ? '' : ` · ${table.seats[table.shooter].name} shooting`}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Button size="sm" variant="ghost" onClick={onToggleHud}>
          {hudOpen ? 'Hide stats' : 'Show stats'}
        </Button>
        <Button size="sm" onClick={onStrategies} title="Assign a system to a seat, or build your own">
          Strategies
        </Button>
        <Button size="sm" onClick={onSettings}>
          House rules
        </Button>
        <Button size="sm" onClick={onNew}>
          New session
        </Button>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ *
 * Toasts
 * ------------------------------------------------------------------ */

function Toasts() {
  const toast = useGame((s) => s.toast);
  const dismiss = useGame((s) => s.dismissToast);

  React.useEffect(() => {
    if (!toast) return;
    if (toast.tone === 'warn') refuse();
    const t = setTimeout(dismiss, toast.tone === 'win' ? 2600 : 2000);
    return () => clearTimeout(t);
  }, [toast, dismiss]);

  return (
    <AnimatePresence>
      {toast ? (
        <motion.div
          key={toast.id}
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: 16, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 420, damping: 30 }}
          className={cn(
            'rounded-full border px-4 py-2 text-sm font-semibold shadow-xl backdrop-blur',
            toast.tone === 'win' && 'border-emerald-400/40 bg-emerald-950/85 text-emerald-200',
            toast.tone === 'warn' && 'border-rose-400/40 bg-rose-950/85 text-rose-200',
            toast.tone === 'ok' && 'border-white/10 bg-pit-900/90 text-pit-100',
          )}
        >
          {toast.text}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
