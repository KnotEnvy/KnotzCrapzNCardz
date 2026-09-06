/**
 * The store, which had no tests at all until round five of judging.
 *
 * That gap is the reason a real defect lived here: `act()` graded the
 * player's decision, wrote the result onto the seat, and then made the engine
 * call against a *snapshot taken before the grade*, so `apply()` swapped the
 * graded table straight back out. Every decision was counted and every count
 * discarded. The engine's own `recordDecision` test was green throughout,
 * because the engine was never the thing that was broken.
 *
 * So these tests are deliberately about the seam rather than about the
 * engine: what the store does *around* an engine call, and whether anything
 * it computes on the way in survives the swap on the way out. Everything
 * below drives the real store through its real actions.
 *
 * The store is a client module. It reads `window` for the panel default and
 * `localStorage` for persistence at import time, so both are stubbed before
 * the dynamic import below. Audio and timers are stubbed for the same reason:
 * neither exists in node, and neither is what is under test.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { GameStore } from './useGame';
import { dollars } from '@/lib/engine/money';
import { defaultRules } from '@/lib/engine/rules';
import { seatOf } from '@/lib/engine/table';

let useGame: typeof import('./useGame').useGame;

beforeAll(async () => {
  const store = new Map<string, string>();
  const localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  Object.assign(globalThis, {
    localStorage,
    window: { innerWidth: 1440, localStorage },
  });
  /*
   * No audio stub is needed: `initAudio` reads `window.AudioContext`, finds
   * nothing on the stub above and returns, and every voice is behind the
   * sound preference these tests turn off. If that ever stops being true,
   * this is where the mock goes.
   */
  ({ useGame } = await import('./useGame'));
  vi.useFakeTimers();
});

/** A fresh table at the default rules, trainer on, no sound. */
function reset(): void {
  useGame.getState().setRules(defaultRules());
  useGame.getState().newSession('store-test');
  useGame.getState().setPref('sound', false);
  useGame.getState().setPref('trainer', true);
  useGame.setState({ toasts: [], grades: [] });
}

/*
 * Fake timers for the whole file rather than per test. The debounced storage
 * below holds a pending-timer handle across calls, and switching the clock
 * out from under a scheduled flush strands that handle — every later write
 * then sees a timer that will never fire and coalesces into nothing. A real
 * tab never does this; a test that toggles the clock does.
 */
afterAll(() => {
  vi.useRealTimers();
});

function state(): GameStore {
  return useGame.getState();
}

/** Deal, then run the driver's timers out so the table reaches PLAYER. */
function dealAndSettleAnimation(): void {
  state().deal();
  vi.runOnlyPendingTimers();
  // The deal schedules a card at a time, each of which schedules the next.
  for (let i = 0; i < 40 && state().busy; i++) vi.runOnlyPendingTimers();
}

describe('the store', () => {
  it('keeps the graded decision on the seat it graded', () => {
    /*
     * The round-five defect, in one assertion. `act()` used to grade against
     * a snapshot and then discard the graded table; the grade list grew and
     * the seat's tally stayed at zero, so the HUD line "N of M correct this
     * session" — gated on the tally being non-zero — could never render.
     */
    reset();
    state().setSeatOccupied('A', true);
    state().setBet('A', dollars(10));
    dealAndSettleAnimation();

    expect(state().table.phase).toBe('PLAYER');
    const focus = state().table.focus;
    expect(focus).not.toBeNull();

    const before = seatOf(state().table, focus!.seat).stats.decisions;
    state().act('STAND');

    expect(state().grades.length).toBe(1);
    const after = seatOf(state().table, focus!.seat).stats;
    expect(after.decisions, 'the decision the store graded reached the seat').toBe(before + 1);
    // The grade and the tally have to agree, or the panel and the HUD will
    // disagree with each other on the same round.
    expect(after.correctDecisions).toBe(state().grades[0].correct ? 1 : 0);
  });

  it('grades nothing when the trainer is off', () => {
    reset();
    state().setPref('trainer', false);
    state().setSeatOccupied('A', true);
    state().setBet('A', dollars(10));
    dealAndSettleAnimation();

    const seat = state().table.focus!.seat;
    state().act('STAND');
    expect(state().grades.length).toBe(0);
    expect(seatOf(state().table, seat).stats.decisions).toBe(0);
  });

  it('turns an engine refusal into a toast rather than a state change', () => {
    reset();
    const before = state().table;
    // Nobody is seated, so there is nothing to deal.
    state().deal();
    expect(state().table).toBe(before);
    expect(state().toasts.length).toBeGreaterThan(0);
  });

  /*
   * `setRules` moves the table minimum, and a bet already in the circle is
   * raised to meet it. The engine now refuses to raise it past what the seat
   * can pay; before round five it did, and `deal` never re-checked, so a $50
   * bankroll could be dealt a $100 hand and go negative.
   */
  it('never leaves a wager the seat cannot cover', () => {
    reset();
    state().setSeatOccupied('A', true);
    useGame.setState((s) => ({
      table: {
        ...s.table,
        seats: s.table.seats.map((seat) =>
          seat.id === 'A' ? { ...seat, bankroll: dollars(50), pendingBet: dollars(5) } : seat,
        ),
      },
    }));

    state().setRules({ ...defaultRules(), minBet: dollars(100), maxBet: dollars(2000) });

    const seat = seatOf(state().table, 'A');
    expect(seat.pendingBet).toBeLessThanOrEqual(seat.bankroll);
  });

  it('does not persist the round in flight, and writes far less often than it sets', () => {
    /*
     * Writes are coalesced. The persist middleware wraps `setState`, and a
     * single round makes fifteen to twenty of those — every dealt card, every
     * toast appearing and dismissing, both `busy` flips — each of which used
     * to serialise and store the whole 150 KB slice synchronously on the main
     * thread. The debounce is what stands between a round and several
     * megabytes of that.
     *
     * The assertion is the ratio rather than an absolute count, because the
     * count depends on how the fake clock is advanced. What has to hold is
     * that writes are a small fraction of state changes.
     */
    reset();

    let sets = 0;
    let writes = 0;
    const unsubscribe = useGame.subscribe(() => void sets++);
    const realSet = localStorage.setItem.bind(localStorage);
    localStorage.setItem = (k: string, v: string) => {
      writes++;
      realSet(k, v);
    };

    state().setSeatOccupied('A', true);
    state().setBet('A', dollars(10));
    dealAndSettleAnimation();
    // Play the hand out and let the dealer and the settlement hold run, so
    // the count is a whole round rather than just the deal.
    for (let i = 0; i < 8 && state().table.phase === 'PLAYER'; i++) state().act('STAND');
    for (let i = 0; i < 60; i++) vi.runOnlyPendingTimers();
    vi.advanceTimersByTime(1000);

    unsubscribe();
    localStorage.setItem = realSet;

    expect(sets, 'a round is many state changes').toBeGreaterThan(8);
    expect(writes, 'but only one write, at the end of it').toBe(1);
  });

  /*
   * Round four found a persisted shape that no longer loaded, because a
   * required field was added without a version bump. Round six added another
   * required field — `SeatStats.staked` — so this is the test that says the
   * lesson took: an old save has to come forward rather than crash or print
   * NaN where the measured edge goes.
   */
  it('brings a version-2 save forward rather than loading it broken', async () => {
    const v2 = JSON.parse(JSON.stringify(useGame.getState().table)) as {
      seats: Array<{ stats: Record<string, number | undefined> }>;
    };
    for (const seat of v2.seats) {
      seat.stats.wagered = 12_345;
      delete seat.stats.staked;
    }
    localStorage.setItem(
      'knotz-blackjack',
      JSON.stringify({ state: { table: v2, prefs: useGame.getState().prefs, bot: useGame.getState().bot }, version: 2 }),
    );

    await useGame.persist.rehydrate();

    for (const seat of state().table.seats) {
      expect(Number.isFinite(seat.stats.staked), 'staked is a number after the migration').toBe(true);
      expect(seat.stats.staked).toBe(12_345);
    }
  });

  it('persists the table and the preferences, and nothing about the moment', () => {
    /*
     * Produces its own write rather than reading whatever an earlier test
     * happened to leave behind. It used to depend on the case above it and
     * threw `Cannot read properties of null` when run alone — a test that
     * only passes in file order is a test that will mislead whoever next runs
     * it with `-t`.
     */
    reset();
    state().setSeatOccupied('A', true);
    vi.advanceTimersByTime(1000);

    // `partialize` keeps the table, the preferences and the bot, and drops
    // everything about a moment that has passed by the time the page is back.
    const persisted = JSON.parse(localStorage.getItem('knotz-blackjack')!) as {
      state: Record<string, unknown>;
      version: number;
    };
    expect(persisted.version).toBe(3);
    expect(Object.keys(persisted.state).sort()).toEqual(['bot', 'prefs', 'table']);
  });
});
