'use client';

/**
 * The table.
 *
 * A header, the felt, the control bar under it, and a stats panel that sits
 * beside the felt on a wide screen and slides over it on a narrow one. That is
 * the whole application shell; everything with an opinion lives in the engine
 * or in the store.
 *
 * The one thing this file owns is the seat interaction: a click on a betting
 * circle means "sit down" on an empty seat and "add a chip" on an occupied
 * one, and deciding which is a question about the UI rather than about the
 * game.
 */

import * as React from 'react';
import { Button, cn } from '@/components/ui/primitives';
import { Controls, useKeyboard } from '@/components/Controls';
import { Dialogs } from '@/components/Dialogs';
import { Hud } from '@/components/hud/Hud';
import { Surface } from '@/components/table/Surface';
import { fmt } from '@/lib/engine/money';
import { handValue } from '@/lib/engine/hand';
import { cardLabel } from '@/lib/engine/types';
import { initAudio } from '@/lib/audio';
import { useGame } from '@/lib/store/useGame';
import type { SideBetKind } from '@/lib/engine/types';

export default function Page() {
  useKeyboard();

  const table = useGame((s) => s.table);
  const settlements = useGame((s) => s.settlements);
  const panelOpen = useGame((s) => s.prefs.panelOpen);
  const hydrated = useHydrated();

  const onSeatClick = React.useCallback((index: number) => {
    const s = useGame.getState();
    const seat = s.table.seats[index];
    if (!seat.occupied) {
      s.setSeatOccupied(seat.id, true);
      return;
    }
    s.addChip(seat.id);
  }, []);

  const onSideBetClick = React.useCallback((index: number, kind: SideBetKind) => {
    const s = useGame.getState();
    s.addSideChip(s.table.seats[index].id, kind);
  }, []);

  /*
   * The store persists to localStorage, so the first client render would
   * otherwise disagree with the server's HTML and React would throw away the
   * tree. Holding the felt back for one frame is cheaper than hydrating twice,
   * and the frame is invisible.
   */
  if (!hydrated) {
    return (
      <main className="flex h-full items-center justify-center">
        <span
          className="text-sm tracking-[0.3em] text-brass-500/60 uppercase"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Knotz Blackjack
        </span>
      </main>
    );
  }

  return (
    <main className="flex h-full flex-col overflow-hidden" onPointerDown={() => initAudio()}>
      <Header />

      <div className="table-shell flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 px-2 pt-1">
            <Surface
              table={table}
              settlements={settlements}
              onSeatClick={onSeatClick}
              onSideBetClick={onSideBetClick}
            />
          </div>
          <Controls />
        </div>

        {/* Beside the felt above 1180px, over it below. Same component. */}
        {/*
          Beside the felt above 1180px. Below it on a tall narrow window, where
          the table cannot use the height anyway — see .stats-rail in
          globals.css. Over it on anything short and narrow, where there is no
          room for either.
        */}
        <Hud
          className={cn(
            'stats-rail border-l border-white/6 bg-pit-950/80 backdrop-blur',
            panelOpen ? 'flex' : 'hidden',
            'max-xl:fixed max-xl:inset-y-0 max-xl:right-0 max-xl:z-40 max-xl:shadow-2xl',
          )}
        />
      </div>

      <Toasts />
      <RoundAnnouncer />
      <Dialogs />
    </main>
  );
}

/* ------------------------------------------------------------------ *
 * Header
 * ------------------------------------------------------------------ */

function Header() {
  const table = useGame((s) => s.table);
  const prefs = useGame((s) => s.prefs);
  const setPref = useGame((s) => s.setPref);
  const openDialog = useGame((s) => s.openDialog);
  const autoplay = useGame((s) => s.autoplay);
  const toggleAutoplay = useGame((s) => s.toggleAutoplay);
  const newSession = useGame((s) => s.newSession);

  const bankroll = table.seats.filter((s) => s.occupied).reduce((n, s) => n + s.bankroll, 0);

  return (
    <header className="app-header flex shrink-0 items-center gap-2 border-b border-white/6 bg-pit-950/70 px-3 py-1.5">
      <h1
        className="mr-1 text-sm tracking-[0.2em] text-brass-400 uppercase"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Blackjack <span className="text-brass-700">21</span>
      </h1>

      <span className="font-mono text-xs tabular-nums text-pit-200" title="Total bankroll across every seat">
        {fmt(bankroll)}
      </span>

      <div className="flex-1" />

      <Button
        size="sm"
        variant={autoplay ? 'primary' : 'ghost'}
        onClick={toggleAutoplay}
        title="Let the chart play. Useful for watching the edge do its work."
      >
        {autoplay ? 'Autoplay ⏸' : 'Autoplay'}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => openDialog('sidebets')}>
        Paytables
      </Button>
      <Button size="sm" variant="ghost" onClick={() => openDialog('help')}>
        Help
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setPref('sound', !prefs.sound)}
        aria-label={prefs.sound ? 'Mute' : 'Unmute'}
        title={prefs.sound ? 'Mute' : 'Unmute'}
      >
        {prefs.sound ? '🔊' : '🔇'}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          const next: Record<string, string> = { RELAXED: 'NORMAL', NORMAL: 'FAST', FAST: 'RELAXED' };
          setPref('speed', next[prefs.speed] as typeof prefs.speed);
        }}
        title="Dealing speed"
      >
        {prefs.speed === 'FAST' ? '⏩' : prefs.speed === 'RELAXED' ? '🐢' : '▶'}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          if (confirm('Start a new session? Bankrolls and statistics reset.')) newSession();
        }}
        title="New session"
      >
        ↺
      </Button>
      <Button
        size="sm"
        variant={prefs.panelOpen ? 'secondary' : 'ghost'}
        onClick={() => setPref('panelOpen', !prefs.panelOpen)}
        aria-expanded={prefs.panelOpen}
      >
        Stats
      </Button>
    </header>
  );
}

/* ------------------------------------------------------------------ *
 * Toasts
 * ------------------------------------------------------------------ */

/**
 * The toast stack, and the table's only live region.
 *
 * Rendered unconditionally even when empty. A `role="status"` element has to
 * exist *before* text lands in it for a screen reader to announce the change;
 * mounting the container along with its first message means the first toast of
 * a session — very often a refusal explaining why a button did nothing — is
 * silently missed.
 */
function Toasts() {
  const toasts = useGame((s) => s.toasts);

  return (
    <div
      className="pointer-events-none fixed bottom-24 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-1.5"
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            'sweep-in rounded-full border px-3 py-1.5 text-xs shadow-lg backdrop-blur',
            t.tone === 'warn' && 'border-lose/40 bg-lose/15 text-lose',
            t.tone === 'win' && 'border-win/40 bg-win/15 text-win',
            t.tone === 'ok' && 'border-white/12 bg-pit-900/90 text-pit-200',
          )}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Announcements
 * ------------------------------------------------------------------ */

/**
 * What just happened, for anyone not looking at the felt.
 *
 * The table says everything visually — a card flips, a chip rises off a hand,
 * a total turns red — and none of that reaches a screen reader. This turns the
 * two moments that matter into sentences: the dealer's hand when it is
 * finished, and what each seat won or lost.
 *
 * It is a separate live region from the toasts because the two interrupt each
 * other otherwise: a refusal and a settlement arriving together in one polite
 * region means one of them is dropped.
 */
function RoundAnnouncer() {
  const table = useGame((s) => s.table);
  const settlements = useGame((s) => s.settlements);

  const message = React.useMemo(() => {
    if (settlements.length === 0) return '';
    const dealer = table.dealer.cards.map(cardLabel).join(', ');
    const total = handValue(table.dealer.cards);
    const head =
      table.dealer.outcome === 'BLACKJACK'
        ? 'Dealer has blackjack.'
        : total.busted
          ? `Dealer busts with ${dealer}.`
          : `Dealer has ${total.total} — ${dealer}.`;

    const results = settlements
      .filter((s) => s.kind === 'MAIN')
      .map((s) => {
        const seat = table.seats.find((x) => x.id === s.seat);
        const who = seat?.name ?? `Seat ${s.seat}`;
        const money = s.net === 0 ? 'pushes' : s.net > 0 ? `wins ${fmt(s.net)}` : `loses ${fmt(-s.net)}`;
        return `${who} ${money}.`;
      });

    const side = settlements
      .filter((s) => s.kind !== 'MAIN' && s.net > 0)
      .map((s) => `${s.label} pays ${fmt(s.net)}.`);

    return [head, ...results, ...side].join(' ');
  }, [settlements, table]);

  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {message}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Hydration
 * ------------------------------------------------------------------ */

/**
 * Has the client taken over yet?
 *
 * `useSyncExternalStore` with a never-firing subscription is the sanctioned
 * way to ask: the server snapshot is false, the client snapshot is true, and
 * React reconciles the difference itself instead of us setting state in an
 * effect and re-rendering the whole table a second time.
 */
const NEVER = () => () => {};

function useHydrated(): boolean {
  return React.useSyncExternalStore(
    NEVER,
    () => true,
    () => false,
  );
}
