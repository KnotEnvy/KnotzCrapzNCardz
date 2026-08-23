'use client';

import { AnimatePresence, motion } from 'motion/react';
import * as React from 'react';
import { ActionBar, ChipRack, RollButton, SeatBar } from '@/components/Controls';
import { HopDialog, NewSessionDialog, SettingsDialog } from '@/components/Dialogs';
import { StartScreen } from '@/components/Setup';
import { DiceStage } from '@/components/dice/DiceStage';
import { Hud } from '@/components/hud/Hud';
import { Felt } from '@/components/table/Felt';
import { Button, cn } from '@/components/ui/primitives';
import { payout, puckOn, refuse, setSoundEnabled, sevenOut } from '@/lib/audio';
import { DENOMS } from '@/components/table/Chip';
import { useGame } from '@/lib/store/useGame';

export default function Page() {
  const [hopOpen, setHopOpen] = React.useState(false);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [newOpen, setNewOpen] = React.useState(false);
  const [newSessionKey, setNewSessionKey] = React.useState(0);

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
  const throwDice = useGame((s) => s.throwDice);
  const setChip = useGame((s) => s.setChip);
  const setActiveSeat = useGame((s) => s.setActiveSeat);
  const maxOdds = useGame((s) => s.maxOdds);
  const rolling = useGame((s) => s.rolling);
  // Kept in the store rather than local state so the choice survives a reload.
  const hudOpen = useGame((s) => s.showHud);
  const toggleHud = useGame((s) => s.toggleHud);

  React.useEffect(() => void initPhysics(), [initPhysics]);
  React.useEffect(() => setSoundEnabled(soundOn), [soundOn]);

  /* Table talk, tied to the roll rather than to any render. */
  const lastAnnounced = React.useRef(-1);
  React.useEffect(() => {
    const rec = table.history[table.history.length - 1];
    if (!rec || rec.index === lastAnnounced.current) return;
    lastAnnounced.current = rec.index;
    if (rec.outcome === 'SEVEN_OUT') sevenOut();
    else if (rec.outcome === 'POINT_ESTABLISHED') puckOn();
    else if (rec.net.A + rec.net.B > 0) payout();
  }, [table.history]);

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
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [throwDice, setChip, setActiveSeat, maxOdds, toggleHud, solo]);

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
          <SeatBar />

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
          <ActionBar onOpenHop={() => setHopOpen(true)} />
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
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      {/* Keyed on each opening so its fields start from the current table
          without an effect having to reset them. */}
      <NewSessionDialog key={newSessionKey} open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Top bar
 * ------------------------------------------------------------------ */

function TopBar({
  onSettings,
  onNew,
  hudOpen,
  onToggleHud,
}: {
  onSettings: () => void;
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
