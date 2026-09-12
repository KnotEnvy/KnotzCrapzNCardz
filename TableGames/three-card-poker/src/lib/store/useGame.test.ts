/**
 * The store, tested at the seam.
 *
 * The blackjack store had no tests until round five of judging, and that gap
 * is where a real defect lived: it graded a decision, wrote it onto the seat,
 * and then made the engine call against a snapshot from before the grade, so
 * every count was thrown away while the engine's own tests stayed green. So
 * these tests are about what the store does *around* an engine call — whether
 * a grade survives the swap, whether a round driven by timers ends where the
 * money says it should, whether storage is written once rather than twenty
 * times, and whether a reload in the middle of a round gives the money back.
 *
 * The store is a client module that reads `window` and `localStorage` at
 * import, so both are stubbed before the dynamic import below.
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
  Object.assign(globalThis, { localStorage, window: { innerWidth: 1440, localStorage } });
  ({ useGame } = await import('./useGame'));
  // For the whole file: the debounced storage holds a timer handle across
  // calls, and swapping the clock out from under it strands that handle.
  vi.useFakeTimers();
});

afterAll(() => {
  vi.useRealTimers();
});

function state(): GameStore {
  return useGame.getState();
}

/** A fresh session at the default rules, trainer on, no sound. */
function reset(): void {
  state().newSession('store-test');
  state().setRules(defaultRules());
  state().setPref('sound', false);
  state().setPref('trainer', true);
  useGame.setState({ toasts: [], grades: [], autoplay: false });
}

/** Run the driver's timers until it hands the table back. */
function runDriver(): void {
  for (let i = 0; i < 80; i++) {
    const { busy, table } = state();
    if (!busy && table.phase !== 'SHOWDOWN' && table.phase !== 'SETTLE') return;
    vi.runOnlyPendingTimers();
  }
}

describe('the store', () => {
  it('keeps a graded decision on the seat it graded', () => {
    reset();
    state().setWager('A', 'ANTE', dollars(10));
    state().deal();
    runDriver();
    expect(state().table.phase).toBe('DECIDING');

    state().decide('FOLD');

    expect(state().grades).toHaveLength(1);
    const grade = state().grades[0];
    const stats = seatOf(state().table, 'A').stats;
    expect(stats.decisions, 'the decision the store graded reached the seat').toBe(1);
    expect(stats.correctDecisions).toBe(grade.correct ? 1 : 0);
    expect(stats.evGivenUp).toBe(grade.evGivenUp);
  });

  it('grades nothing when the trainer is off', () => {
    reset();
    state().setPref('trainer', false);
    state().setWager('A', 'ANTE', dollars(10));
    state().deal();
    runDriver();
    state().decide('PLAY');
    expect(state().grades).toHaveLength(0);
    expect(seatOf(state().table, 'A').stats.decisions).toBe(0);
  });

  it('turns an engine refusal into a toast rather than a state change', () => {
    reset();
    const before = state().table;
    state().deal();
    expect(state().table).toBe(before);
    expect(state().toasts.length).toBeGreaterThan(0);
  });

  it('refuses a decision while the machine is still dealing', () => {
    reset();
    state().setWager('A', 'ANTE', dollars(10));
    state().deal();
    expect(state().busy).toBe(true);
    const before = state().table;
    state().decide('PLAY');
    expect(state().table).toBe(before);
  });

  it('drives a whole round to settlement and back, and the money adds up', () => {
    reset();
    state().setWager('A', 'ANTE', dollars(10));
    state().setWager('A', 'PAIR_PLUS', dollars(5));
    state().setWager('A', 'SIX_CARD', dollars(5));
    const start = seatOf(state().table, 'A').bankroll;

    state().deal();
    runDriver();
    state().decide('PLAY');
    runDriver();

    const seat = seatOf(state().table, 'A');
    expect(state().table.phase).toBe('BETTING');
    expect(state().busy).toBe(false);
    expect(state().table.history).toHaveLength(1);
    expect(seat.bankroll).toBe(start + seat.stats.net);
    expect(seat.stats.net).toBe(state().table.history[0].net);
  });

  it('stops autoplay, and says so, when there is nothing to deal', () => {
    reset();
    useGame.setState({ autoplay: true });
    state().deal();
    expect(state().autoplay).toBe(false);
    expect(state().toasts.length).toBeGreaterThan(0);
  });

  it('writes storage once a round, not once a change', () => {
    reset();
    vi.advanceTimersByTime(2000);

    let sets = 0;
    let writes = 0;
    const unsubscribe = useGame.subscribe(() => void sets++);
    const realSet = localStorage.setItem.bind(localStorage);
    localStorage.setItem = (k: string, v: string) => {
      writes++;
      realSet(k, v);
    };

    state().setWager('A', 'ANTE', dollars(10));
    state().deal();
    runDriver();
    state().decide('PLAY');
    runDriver();
    vi.advanceTimersByTime(2000);

    unsubscribe();
    localStorage.setItem = realSet;

    expect(sets, 'a round is many state changes').toBeGreaterThan(6);
    expect(writes, 'and one write').toBe(1);
  });

  it('persists the table, the preferences and the bot, and nothing about the moment', () => {
    reset();
    state().setWager('A', 'ANTE', dollars(10));
    vi.advanceTimersByTime(2000);
    const persisted = JSON.parse(localStorage.getItem('knotz-three-card-poker')!) as {
      state: Record<string, unknown>;
      version: number;
    };
    expect(persisted.version).toBe(1);
    expect(Object.keys(persisted.state).sort()).toEqual(['bot', 'prefs', 'table']);
  });

  /*
   * A round cannot be resumed from a reload — the driver's timers are gone —
   * so whatever was riding comes back. And a round already paid, parked on the
   * felt for its settlement hold, must not be paid back a second time.
   */
  it('gives back the chips of a round interrupted by a reload, and only those', async () => {
    reset();
    state().setWager('A', 'ANTE', dollars(10));
    state().deal();
    runDriver();
    expect(seatOf(state().table, 'A').bankroll).toBe(dollars(990));

    localStorage.setItem(
      'knotz-three-card-poker',
      JSON.stringify({ state: { table: state().table, prefs: state().prefs, bot: state().bot }, version: 1 }),
    );
    await useGame.persist.rehydrate();

    expect(state().table.phase).toBe('BETTING');
    expect(seatOf(state().table, 'A').bankroll).toBe(dollars(1000));
    expect(state().busy).toBe(false);
  });
});
