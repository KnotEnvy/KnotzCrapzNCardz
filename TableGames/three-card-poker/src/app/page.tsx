'use client';

/**
 * The table.
 *
 * A header, the felt, the control bar under it, and a stats panel that sits
 * beside the felt on a wide screen and slides over it on a narrow one. That is
 * the whole application shell; everything with an opinion lives in the engine
 * or in the store.
 *
 * The one thing this file owns is what a click on the felt means: "sit down"
 * on an empty seat, and "add the selected chip" on one of a seated player's
 * spots. That is a question about the interface rather than about the game.
 */

import * as React from 'react';
import { Button, cn } from '@/components/ui/primitives';
import { Controls, useKeyboard } from '@/components/Controls';
import { Dialogs } from '@/components/Dialogs';
import { Hud } from '@/components/hud/Hud';
import { Surface } from '@/components/table/Surface';
import { initAudio } from '@/lib/audio';
import { fmt } from '@/lib/engine/money';
import { evaluate3, handName, qualifies } from '@/lib/engine/poker';
import { outcomeLabel } from '@/lib/engine/resolve';
import type { SpotKind } from '@/lib/engine/types';
import { useGame } from '@/lib/store/useGame';

export default function Page() {
  useKeyboard();
  useEscapeClosesDrawer();

  const table = useGame((s) => s.table);
  const settlements = useGame((s) => s.settlements);
  const dealing = useGame((s) => s.dealing);
  const panelOpen = useGame((s) => s.prefs.panelOpen);
  const hydrated = useHydrated();

  const onSeatClick = React.useCallback((index: number) => {
    const s = useGame.getState();
    s.setSeatOccupied(s.table.seats[index].id, true);
  }, []);

  const onSpotClick = React.useCallback((index: number, spot: SpotKind) => {
    const s = useGame.getState();
    s.addChip(s.table.seats[index].id, spot);
  }, []);

  /*
   * The store persists to localStorage, so the first client render would
   * otherwise disagree with the server's HTML and React would throw the tree
   * away. Holding the felt back for one frame is cheaper than hydrating twice.
   */
  if (!hydrated) {
    return (
      <main className="flex h-full items-center justify-center">
        <span className="text-sm tracking-[0.3em] text-brass-500/60 uppercase" style={{ fontFamily: 'var(--font-display)' }}>
          Knotz Three Card Poker
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
              dealing={dealing}
              onSeatClick={onSeatClick}
              onSpotClick={onSpotClick}
            />
          </div>
          <Controls />
        </div>

        {/*
          Beside the felt above 1180px, under it on a tall narrow window, and
          over it on anything short and narrow. Where it covers the table it
          needs a way out that is not the button it covers, so the scrim closes
          it on a tap anywhere else.
        */}
        {panelOpen ? (
          <button
            type="button"
            aria-label="Close the statistics panel"
            onClick={() => useGame.getState().setPref('panelOpen', false)}
            className="rail-scrim fixed inset-0 z-30 cursor-default bg-black/40 xl:hidden"
          />
        ) : null}
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
    /*
     * `z-50` because below 1280px the stats rail is a drawer at z-40 that
     * covers the right end of the header, which is where the button that
     * closes it lives. The header has to sit above the thing it opens.
     */
    <header className="app-header relative z-50 flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-white/6 bg-pit-950/70 px-3 py-1.5">
      <h1 className="mr-1 text-sm tracking-[0.2em] text-brass-400 uppercase" style={{ fontFamily: 'var(--font-display)' }}>
        Three Card <span className="text-brass-700">Poker</span>
      </h1>

      <span className="font-mono text-xs tabular-nums text-pit-200" title="Total bankroll across every seat">
        {fmt(bankroll)}
      </span>

      <div className="flex-1" />

      <Button size="sm" variant={autoplay ? 'primary' : 'ghost'} onClick={toggleAutoplay} title="Let the bot play, with the strategy chosen in the panel.">
        {autoplay ? 'Autoplay ⏸' : 'Autoplay'}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => openDialog('paytables')}>
        Paytables
      </Button>
      <Button size="sm" variant="ghost" onClick={() => openDialog('strategy')}>
        Strategy
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
          const next: Record<string, typeof prefs.speed> = { RELAXED: 'NORMAL', NORMAL: 'FAST', FAST: 'RELAXED' };
          setPref('speed', next[prefs.speed]);
        }}
        aria-label={`Dealing speed: ${prefs.speed.toLowerCase()}. Click to change.`}
        title="Dealing speed"
      >
        {prefs.speed === 'FAST' ? '⏩' : prefs.speed === 'RELAXED' ? '🐢' : '▶'}
        <span className="sr-only">{prefs.speed.toLowerCase()}</span>
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          if (confirm('Start a new session? Bankrolls and statistics reset.')) newSession();
        }}
        aria-label="New session"
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
 * The toast stack, and a live region.
 *
 * Rendered even when empty: a `role="status"` element has to exist before text
 * lands in it for a screen reader to announce the change, and the first toast
 * of a session is very often the refusal explaining why a click did nothing.
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

/** Escape closes the stats drawer where it covers the table, and only there. */
function useEscapeClosesDrawer(): void {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const { prefs, dialog } = useGame.getState();
      if (dialog !== null || !prefs.panelOpen) return;
      if (window.innerWidth >= 1280) return;
      useGame.getState().setPref('panelOpen', false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/* ------------------------------------------------------------------ *
 * Announcements
 * ------------------------------------------------------------------ */

/**
 * What just happened, for anyone not looking at the felt.
 *
 * The table says everything visually — cards turn, figures rise off the spots
 * — and none of that reaches a screen reader. This turns the settlement into
 * sentences: the dealer's hand and whether it qualified, then each seat's hand
 * and what it came to. A separate live region from the toasts, because two
 * messages landing together in one polite region means one is dropped.
 */
function RoundAnnouncer() {
  const table = useGame((s) => s.table);
  const settlements = useGame((s) => s.settlements);

  const message = React.useMemo(() => {
    if (settlements.length === 0 || table.dealer.cards.length !== 3) return '';
    const dealer = evaluate3(table.dealer.cards);
    const head = `Dealer has ${handName(dealer).toLowerCase()}, and ${qualifies(dealer) ? 'qualifies' : 'does not qualify'}.`;
    const seats = table.seats
      .filter((s) => s.result)
      .map((s) => {
        const r = s.result!;
        const money = r.net === 0 ? 'breaks even' : r.net > 0 ? `wins ${fmt(r.net)}` : `loses ${fmt(-r.net)}`;
        return `${s.name}: ${r.handName.toLowerCase()}${r.outcome ? `, ${outcomeLabel(r.outcome).toLowerCase()}` : ''}, ${money}.`;
      });
    return [head, ...seats].join(' ');
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

const NEVER = () => () => {};

/** `useSyncExternalStore` with a subscription that never fires: false on the server, true on the client. */
function useHydrated(): boolean {
  return React.useSyncExternalStore(
    NEVER,
    () => true,
    () => false,
  );
}
