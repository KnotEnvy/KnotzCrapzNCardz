/**
 * The store, under a fake clock.
 *
 * Two things are being tested here and they are not equally important.
 *
 * The first is the choreography -- that reels land left to right, that a skip
 * unwinds cleanly, that a cancelled timeline is genuinely dead rather than
 * merely quiet. Those are ordinary tests of ordinary code.
 *
 * The second is the money, and that is what most of this file is. A slot store
 * has exactly one job it cannot get wrong: the number in the bankroll. So the
 * assertions here are deliberately about *identities* rather than about
 * particular figures. The strongest one, and the one worth understanding
 * before reading anything else, is this:
 *
 *     bankroll === STARTING_BANKROLL - stats.wagered + stats.won
 *
 * It has to hold after every settled spin, through features, through buys,
 * through a gamble. A double credit breaks it. A missed debit breaks it. A
 * feature that settles twice breaks it. A rounding error breaks it. It is one
 * line and it catches the entire class of bug this store exists to avoid,
 * which is why it is asserted over and over rather than once.
 *
 * Everything runs on a fixed seed. The seeds were chosen by probing the engine
 * for boards worth testing against -- `probe-1` loses its first spin outright
 * and lights the shrine on its twenty-first, `probe-5` lands six orbs on its
 * very first spin, `probe-6` pays a BIG win on its thirty-ninth -- so that
 * tests about features and autoplay pauses can drive the real engine rather
 * than a mock of it. Nothing in this file stubs the maths.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AUTOPLAY_GAP,
  BET_LADDER,
  DEFAULT_BET_INDEX,
  STARTING_BANKROLL,
  TIMING,
  TURBO_SCALE,
  betPerLineAt,
  totalBetAt,
  winTier,
} from '@/lib/engine/config';
import { buyCost } from '@/lib/engine/buy';
import { createRng } from '@/lib/engine/rng';
import { spin as engineSpin } from '@/lib/engine/spin';
import { GAMBLE_MAX_STEPS } from '@/lib/engine/paytable';
import {
  REELS,
  ROWS,
  type Cell,
  type FeatureId,
  type Grid,
  type SpinResult,
  type WinTier,
} from '@/lib/engine/types';

import type { Preferences, SlotsState } from './contract';
import {
  READ_FLOOR_MS,
  REDUCED_MOTION_SCALE,
  REDUCED_TEASE_MS,
  beatMs,
  countUp,
  timeline,
} from './sequence';
import { __runtime, useSlots } from './useSlots';

/* ------------------------------------------------------------------ *
 * Harness
 * ------------------------------------------------------------------ */

/**
 * Scouting.
 *
 * The tests that care about a feature triggering, or about autoplay stopping
 * at the right spin, need to know which spin of which seed does it. The first
 * draft of this file hard-coded those numbers from a one-off probe, and they
 * went stale within the hour: the engine lane retuned a draw and every anchored
 * index moved. So the anchors are computed here instead, by replaying the same
 * pure engine the store is about to drive, on the same seed. The test then
 * asserts that the store agrees with the engine -- which is the thing actually
 * worth asserting, and which stays true through any amount of retuning.
 */
const SCOUT_STAKE = {
  betPerLine: betPerLineAt(DEFAULT_BET_INDEX),
  totalBet: totalBetAt(DEFAULT_BET_INDEX),
};

/** Replay `count` base spins of a seed, exactly as the store would draw them. */
function scout(seed: string, count: number): SpinResult[] {
  const rng = createRng(seed);
  const rows: SpinResult[] = [];
  for (let n = 0; n < count; n++) rows.push(engineSpin({ rng, stake: SCOUT_STAKE, mode: 'BASE' }));
  return rows;
}

/**
 * A seed whose first autoplay-stopping event -- a feature, or a win big enough
 * to be worth looking at -- falls inside a convenient window.
 *
 * The window matters. Too early and there is no room to test that autoplay ran
 * the spins before it; too late and the test spends a minute of fake clock
 * grinding through spins that prove nothing.
 */
function seedStoppingWithin(
  min: number,
  max: number,
  limit = 20_000,
): { seed: string; at: number; result: SpinResult } {
  for (let i = 0; i < limit; i++) {
    const seed = `scout-stop-${i}`;
    const rows = scout(seed, max);
    for (let n = 0; n < rows.length; n++) {
      const tier = winTier(rows[n].totalWin, SCOUT_STAKE.totalBet);
      if (rows[n].trigger || tierIsLoud(tier)) {
        if (n + 1 >= min) return { seed, at: n + 1, result: rows[n] };
        break;
      }
    }
  }
  throw new Error(`no seed stops between spin ${min} and ${max}`);
}

function tierIsLoud(tier: WinTier): boolean {
  return tier === 'BIG' || tier === 'MEGA' || tier === 'EPIC' || tier === 'LEGENDARY';
}

/** A seed whose very first spin lights the given feature. */
function seedTriggering(feature: FeatureId, limit = 20_000): string {
  for (let i = 0; i < limit; i++) {
    const seed = `scout-${feature}-${i}`;
    if (scout(seed, 1)[0].trigger?.feature === feature) return seed;
  }
  throw new Error(`no seed found whose first spin triggers ${feature}`);
}

/** A seed whose first spin pays loudly enough to take the screen. */
function seedPayingLoud(limit = 40_000): string {
  for (let i = 0; i < limit; i++) {
    const seed = `scout-loud-${i}`;
    const first = scout(seed, 1)[0];
    if (first.trigger) continue;
    if (tierIsLoud(winTier(first.totalWin, SCOUT_STAKE.totalBet))) return seed;
  }
  throw new Error('no seed found paying a takeover-sized win on its first spin');
}

/** A quiet seed: its first spin pays nothing and triggers nothing. */
function seedQuiet(limit = 5000): string {
  for (let i = 0; i < limit; i++) {
    const seed = `scout-quiet-${i}`;
    const first = scout(seed, 1)[0];
    if (first.totalWin === 0 && !first.trigger) return seed;
  }
  throw new Error('no quiet seed found');
}

const SEED_QUIET = seedQuiet();
const SEED_LINK = seedTriggering('HOLD_AND_WIN');
const SEED_SHRINE = seedTriggering('FREE_SPINS');
/** A run that plays quietly for a handful of spins and then has to stop. */
const STOP = seedStoppingWithin(4, 14);
/** A first spin loud enough to demand the screen. */
const SEED_LOUD = seedPayingLoud();

function state(): SlotsState {
  return useSlots.getState();
}

/**
 * A brand-new session on a known seed.
 *
 * Preferences are reset too. `newSession` deliberately keeps them -- a player
 * starting over has not asked for their sound settings back -- which makes the
 * store a singleton that carries a preference from one test into the next, and
 * a turbo flag left on by an earlier test silently halves every duration the
 * next one measures.
 */
function reset(seed: string): void {
  useSlots.setState({
    prefs: {
      sound: true,
      music: true,
      turbo: false,
      quickWins: false,
      reducedMotion: false,
      showLines: true,
      leftHanded: false,
    },
  });
  state().newSession(seed);
}

/** Whether anything at all is still owed by the clock. */
function busy(): boolean {
  return (
    state().phase !== 'IDLE' || __runtime.hasTimeline || __runtime.hasAutoTimer || __runtime.hasMeter
  );
}

/**
 * Run the fake clock until the machine has nothing left to do.
 *
 * Deliberately not `vi.runAllTimers()`. The store schedules from inside its own
 * callbacks -- a landing step starts a presentation, a presentation starts the
 * next free spin -- and `runAllTimers` on a self-rescheduling machine either
 * throws or runs forever. Advancing in slices lets the machine unfold exactly
 * as it would in a browser, and gives the loop somewhere to notice that it has
 * stopped.
 */
function settle(limitMs = 600_000): number {
  let elapsed = 0;
  while (elapsed < limitMs) {
    if (!busy()) return elapsed;
    vi.advanceTimersByTime(25);
    elapsed += 25;
  }
  throw new Error(`machine never settled; stuck in ${state().phase}`);
}

/** Advance until `predicate` holds, or give up. */
function until(predicate: () => boolean, limitMs = 600_000): void {
  let elapsed = 0;
  while (elapsed < limitMs) {
    if (predicate()) return;
    vi.advanceTimersByTime(10);
    elapsed += 10;
  }
  throw new Error(`condition never met; phase is ${state().phase}`);
}

/** The identity that has to survive everything. */
function expectBooksBalance(): void {
  const s = state();
  expect(s.bankroll).toBe(STARTING_BANKROLL - s.stats.wagered + s.stats.won);
  expect(Number.isInteger(s.bankroll)).toBe(true);
}

/** Spin until one of them pays, leaving the machine mid-celebration. */
function spinUntilPaying(limit = 60): void {
  for (let i = 0; i < limit; i++) {
    state().spin();
    until(() => state().phase !== 'SPINNING');
    if (state().win > 0) return;
    settle();
  }
  throw new Error('no paying spin found');
}

/** Spin, settling each one, until a win qualifies for the gamble. */
function spinUntilGambleOffered(limit = 120): void {
  for (let i = 0; i < limit; i++) {
    state().spin();
    settle();
    if (state().canGamble) return;
  }
  throw new Error('no gambleable win found');
}

const cellKey = (c: Cell): string => `${c.reel}:${c.row}`;

beforeEach(() => {
  vi.useFakeTimers();
  reset(SEED_QUIET);
});

afterEach(() => {
  // Tear the machine down before the clock, so a test that left a feature
  // running cannot leak its timers into the next one.
  reset('teardown');
  vi.clearAllTimers();
  vi.useRealTimers();
});

/* ================================================================== *
 * The sequencer
 * ================================================================== */

describe('tempo', () => {
  it('scales motion and reading by turbo', () => {
    expect(beatMs(1000, 'motion', { turbo: true, reducedMotion: false })).toBe(
      Math.round(1000 * TURBO_SCALE),
    );
    expect(beatMs(1000, 'read', { turbo: true, reducedMotion: false })).toBe(
      Math.round(1000 * TURBO_SCALE),
    );
  });

  it('never lets turbo shorten a tease', () => {
    // The whole point: a tease shorter than its own recognition is worse than
    // no tease, so turbo is not allowed anywhere near it.
    expect(beatMs(TIMING.anticipation, 'tease', { turbo: true, reducedMotion: false })).toBe(
      TIMING.anticipation,
    );
    expect(beatMs(TIMING.anticipation, 'tease', { turbo: false, reducedMotion: false })).toBe(
      TIMING.anticipation,
    );
  });

  it('crushes motion under reduced motion but keeps a tease readable', () => {
    expect(beatMs(1000, 'motion', { turbo: false, reducedMotion: true })).toBe(
      Math.round(1000 * REDUCED_MOTION_SCALE),
    );
    expect(beatMs(TIMING.anticipation, 'tease', { turbo: false, reducedMotion: true })).toBe(
      REDUCED_TEASE_MS,
    );
  });

  it('floors reading time under reduced motion, even with turbo on top', () => {
    // Reduced motion is a request for less animation, not for less information.
    expect(beatMs(TIMING.linePresent, 'read', { turbo: false, reducedMotion: true })).toBeGreaterThanOrEqual(
      READ_FLOOR_MS,
    );
    expect(beatMs(TIMING.linePresent, 'read', { turbo: true, reducedMotion: true })).toBe(
      READ_FLOOR_MS,
    );
  });
});

describe('timeline', () => {
  it('runs steps in offset order, ties in written order', () => {
    const log: string[] = [];
    timeline()
      .at(100, () => log.push('b'))
      .at(0, () => log.push('a1'))
      .at(0, () => log.push('a2'))
      .at(50, () => log.push('mid'))
      .start();

    vi.advanceTimersByTime(200);
    expect(log).toEqual(['a1', 'a2', 'mid', 'b']);
  });

  it('cancels everything pending in one call', () => {
    const log: string[] = [];
    const tl = timeline({ onDone: () => log.push('done') })
      .then(() => log.push('a'))
      .after(50, () => log.push('b'))
      .after(50, () => log.push('c'))
      .start();

    vi.advanceTimersByTime(60);
    tl.cancel();
    vi.advanceTimersByTime(5000);

    expect(log).toEqual(['a', 'b']);
    expect(tl.cancelled).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('finishes the remainder exactly once, in order, without re-running', () => {
    const log: string[] = [];
    const tl = timeline({ onDone: () => log.push('done') })
      .then(() => log.push('a'))
      .after(50, () => log.push('b'))
      .after(50, () => log.push('c'))
      .after(50, () => log.push('d'))
      .start();

    vi.advanceTimersByTime(60);
    expect(log).toEqual(['a', 'b']);

    tl.finish();
    // c and d are owed and get paid; a and b are not paid twice.
    expect(log).toEqual(['a', 'b', 'c', 'd', 'done']);

    tl.finish();
    vi.advanceTimersByTime(5000);
    expect(log).toEqual(['a', 'b', 'c', 'd', 'done']);
  });

  it('makes every step a no-op once the generation has moved on', () => {
    const log: string[] = [];
    let live = true;
    const tl = timeline({ alive: () => live, onDone: () => log.push('done') })
      .after(50, () => log.push('a'))
      .after(50, () => log.push('b'))
      .start();

    live = false;
    vi.advanceTimersByTime(5000);
    expect(log).toEqual([]);

    // And finishing a stale timeline writes nothing either.
    tl.finish();
    expect(log).toEqual([]);
  });
});

describe('countUp', () => {
  it('climbs monotonically and ends exactly on the target', () => {
    const seen: number[] = [];
    let done = false;
    countUp({
      from: 0,
      to: 4321,
      durationMs: 1000,
      onValue: (v) => seen.push(v),
      onDone: () => {
        done = true;
      },
    });

    vi.advanceTimersByTime(2000);
    expect(done).toBe(true);
    expect(seen[seen.length - 1]).toBe(4321);
    expect(seen.every((v, i) => i === 0 || v >= seen[i - 1])).toBe(true);
    expect(seen.every((v) => Number.isInteger(v))).toBe(true);
  });

  it('jumps to the target on finish', () => {
    let last = -1;
    const climb = countUp({ from: 0, to: 999, durationMs: 5000, onValue: (v) => (last = v) });
    vi.advanceTimersByTime(100);
    expect(last).toBeLessThan(999);
    climb.finish();
    expect(last).toBe(999);
  });

  it('writes nothing once its generation is stale', () => {
    let live = true;
    let writes = 0;
    countUp({
      from: 0,
      to: 999,
      durationMs: 1000,
      alive: () => live,
      onValue: () => {
        writes++;
      },
    });
    vi.advanceTimersByTime(100);
    const before = writes;
    live = false;
    vi.advanceTimersByTime(5000);
    expect(writes).toBe(before);
  });
});

/* ================================================================== *
 * Money
 * ================================================================== */

describe('the money path', () => {
  it('debits exactly the stake, the instant the button is pressed', () => {
    const before = state().bankroll;
    const stake = state().totalBet;

    state().spin();

    expect(state().bankroll).toBe(before - stake);
    expect(state().phase).toBe('SPINNING');
    expect(state().stats.wagered).toBe(stake);
  });

  it('credits exactly what the engine returned, and not a cent more', () => {
    const before = state().bankroll;
    const stake = state().totalBet;

    state().spin();
    const result = state().result;
    expect(result).not.toBeNull();

    settle();
    expect(state().bankroll).toBe(before - stake + result!.totalWin);
    expect(state().stats.won).toBe(result!.totalWin);
  });

  it('keeps the bankroll an integer through every intermediate state', () => {
    const seen: number[] = [];
    const unsubscribe = useSlots.subscribe((s) => seen.push(s.bankroll));

    for (let i = 0; i < 12; i++) {
      state().spin();
      settle();
    }
    unsubscribe();

    expect(seen.length).toBeGreaterThan(50);
    expect(seen.every((b) => Number.isInteger(b))).toBe(true);
    expect(seen.every((b) => b >= 0)).toBe(true);
  });

  it('refuses a spin it cannot pay for, and debits nothing', () => {
    useSlots.setState({ bankroll: 10 });

    state().spin();

    expect(state().bankroll).toBe(10);
    expect(state().phase).toBe('IDLE');
    expect(state().spinToken).toBe(0);
    expect(state().message).toBeTruthy();
    expect(state().stats.wagered).toBe(0);
  });

  it('balances the books across a long run that includes a feature', () => {
    // The run is sized so that it definitely covers a feature: base spins, the
    // trigger, the whole session it opens, and the settle after it.
    reset(SEED_SHRINE);
    const spins = 12;

    for (let i = 0; i < spins; i++) {
      state().spin();
      settle();
      expectBooksBalance();
    }

    const s = state();
    expect(s.stats.spins).toBe(spins);
    expect(s.stats.featureTriggers.FREE_SPINS).toBeGreaterThanOrEqual(1);
    expect(s.stats.freeSpins).toBeGreaterThan(0);
    expectBooksBalance();
  });

  it('agrees with its own history strip', () => {
    for (let i = 0; i < 10; i++) {
      state().spin();
      settle();
    }
    const s = state();
    const fromHistory = s.history.reduce((sum, h) => sum + h.win, 0);
    // Ten spins is well inside the strip's limit, so the two totals are the
    // same money counted two different ways.
    expect(s.history.length).toBe(10);
    expect(fromHistory).toBe(s.stats.won);
    expect(s.history.every((h) => Number.isInteger(h.win))).toBe(true);
  });

  it('hands over a fixed rebuy without disturbing the stats', () => {
    const before = state().bankroll;
    state().rebuy();
    expect(state().bankroll).toBeGreaterThan(before);
    expect(Number.isInteger(state().bankroll)).toBe(true);
    expect(state().stats.won).toBe(0);
    expect(state().stats.wagered).toBe(0);
  });
});

/* ================================================================== *
 * The reels
 * ================================================================== */

describe('the reels', () => {
  it('lands them left to right at the stops the engine chose', () => {
    state().spin();
    const result = state().result!;

    const landedAt = new Array<number>(REELS).fill(-1);
    let elapsed = 0;
    while (elapsed < 60_000 && landedAt.some((t) => t < 0)) {
      vi.advanceTimersByTime(10);
      elapsed += 10;
      state().reels.forEach((status, reel) => {
        if (status === 'LANDED' && landedAt[reel] < 0) landedAt[reel] = elapsed;
      });
    }

    expect(landedAt.every((t) => t > 0)).toBe(true);
    for (let reel = 1; reel < REELS; reel++) {
      expect(landedAt[reel]).toBeGreaterThan(landedAt[reel - 1]);
    }
    expect(state().stops).toEqual(result.stops);
    expect(state().grid).toEqual(result.grid);
  });

  it('slams to the same board a patient player would have got', () => {
    // The whole honesty of a stop button is here: the outcome was decided when
    // the button was pressed, and hurrying it must not re-roll anything.
    reset(SEED_LINK);
    state().spin();
    settle();
    const patient = {
      grid: state().grid as Grid,
      stops: [...state().stops],
      win: state().win,
      bankroll: state().bankroll,
      won: state().stats.won,
    };

    reset(SEED_LINK);
    state().spin();
    vi.advanceTimersByTime(TIMING.spinUp + TIMING.reelStop);
    expect(state().reels.some((r) => r === 'SPINNING')).toBe(true);
    state().stopReels();
    settle();

    expect(state().stops).toEqual(patient.stops);
    expect(state().grid).toEqual(patient.grid);
    expect(state().win).toBe(patient.win);
    expect(state().bankroll).toBe(patient.bankroll);
    expect(state().stats.won).toBe(patient.won);
  });

  it('ignores a slam stop when nothing is turning', () => {
    const token = state().spinToken;
    state().stopReels();
    expect(state().phase).toBe('IDLE');
    expect(state().spinToken).toBe(token);
  });
});

/* ================================================================== *
 * Features
 * ================================================================== */

describe('features', () => {
  it('settles free spins exactly once, paying spin by spin', () => {
    const before = state().bankroll;
    const cost = buyCost('FREE_SPINS', state().totalBet);

    // Every rise in the bankroll is recorded. A feature that settled twice
    // would show one more of them than there are winning lines in the history.
    const credits: number[] = [];
    let last = before;
    const unsubscribe = useSlots.subscribe((s) => {
      if (s.bankroll > last) credits.push(s.bankroll - last);
      last = s.bankroll;
    });

    state().buyFeature('FREE_SPINS');
    expect(state().bankroll).toBe(before - cost);
    expect(state().stats.wagered).toBe(cost);

    settle();
    unsubscribe();

    const s = state();
    expect(s.phase).toBe('IDLE');
    expect(s.free).toBeNull();
    expect(s.featureCard).toBeNull();
    expect(s.stats.featureTriggers.FREE_SPINS).toBe(1);
    expect(s.stats.freeSpins).toBeGreaterThanOrEqual(10);

    const winningRows = s.history.filter((h) => h.win > 0).length;
    expect(credits.length).toBe(winningRows);
    expect(credits.reduce((a, b) => a + b, 0)).toBe(s.stats.won);
    expectBooksBalance();
  });

  it('settles the link exactly once, in one award at the end', () => {
    reset(SEED_LINK);
    const before = state().bankroll;
    const stake = state().totalBet;

    const credits: number[] = [];
    let last = before;
    const unsubscribe = useSlots.subscribe((s) => {
      if (s.bankroll > last) credits.push(s.bankroll - last);
      last = s.bankroll;
    });

    state().spin();
    until(() => state().hold !== null);
    expect(state().phase).toBe('FEATURE_INTRO');
    expect(state().orbs.length).toBeGreaterThanOrEqual(6);

    settle();
    unsubscribe();

    const s = state();
    expect(s.phase).toBe('IDLE');
    expect(s.hold).toBeNull();
    expect(s.orbs).toEqual([]);
    expect(s.stats.featureTriggers.HOLD_AND_WIN).toBe(1);
    // However many respins it took, the link is one award. Every rise in the
    // bankroll has to answer to a row in the history strip; a feature that
    // settled twice would produce a credit that nothing accounts for.
    const winningRows = s.history.filter((h) => h.win > 0).length;
    expect(credits.length).toBe(winningRows);
    expect(credits.reduce((a, b) => a + b, 0)).toBe(s.stats.won);
    expect(s.bankroll).toBe(before - stake + s.stats.won);
    expectBooksBalance();
  });

  it('does not let a second settle find a feature still standing', () => {
    reset(SEED_LINK);
    state().spin();
    until(() => state().hold !== null);

    // Hammer skip through the whole feature. Every one of these finishes a
    // timeline; none of them may pay twice.
    for (let i = 0; i < 60 && state().phase !== 'IDLE'; i++) {
      state().skip();
      vi.advanceTimersByTime(25);
    }
    settle();

    expect(state().hold).toBeNull();
    expectBooksBalance();
  });

  it('refuses a buy it cannot pay for', () => {
    useSlots.setState({ bankroll: 100 });
    state().buyFeature('SUPER');
    expect(state().bankroll).toBe(100);
    expect(state().phase).toBe('IDLE');
    expect(state().message).toBeTruthy();
  });
});

/* ================================================================== *
 * Autoplay
 * ================================================================== */

describe('autoplay', () => {
  it('plays exactly the count it was given and stops', () => {
    // Sized to stop short of anything that would legitimately interrupt it, so
    // that a run ending early would be a real bug rather than the machine
    // doing its job.
    reset(STOP.seed);
    const quiet = STOP.at - 1;

    state().startAutoplay(quiet);
    settle();

    expect(state().autoplay).toBeNull();
    expect(state().stats.spins).toBe(quiet);
    expect(state().stats.featureTriggers.FREE_SPINS).toBe(0);
    expect(state().stats.featureTriggers.HOLD_AND_WIN).toBe(0);
    expectBooksBalance();
  });

  it('stops on the exact spin the engine says is worth stopping on', () => {
    // The engine is replayed first to find the first spin of this seed that
    // lights a feature or pays a BIG win. Autoplay is then given comfortably
    // more spins than that, and must stop on precisely that one.
    reset(STOP.seed);

    state().startAutoplay(STOP.at + 25);
    settle();

    const s = state();
    expect(s.autoplay).toBeNull();
    expect(s.stats.spins).toBe(STOP.at);
    if (STOP.result.trigger) {
      expect(s.stats.featureTriggers[STOP.result.trigger.feature]).toBe(1);
    } else {
      expect(tierIsLoud(winTier(STOP.result.totalWin, s.totalBet))).toBe(true);
    }
    expectBooksBalance();
  });

  it('hands control back the instant a feature lights', () => {
    reset(SEED_LINK);
    state().startAutoplay(50);
    until(() => state().hold !== null);

    // The run is over before the intro card has even finished.
    expect(state().autoplay).toBeNull();
    settle();
    expect(state().stats.spins).toBe(1);
    expect(state().stats.featureTriggers.HOLD_AND_WIN).toBe(1);
    expectBooksBalance();
  });

  it('stops when the money runs out, and never overdraws', () => {
    const stake = state().totalBet;
    useSlots.setState({ bankroll: stake * 3 });

    state().startAutoplay(500);
    settle();

    const s = state();
    expect(s.autoplay).toBeNull();
    expect(s.bankroll).toBeGreaterThanOrEqual(0);
    // Either it ran out of money or something stopped it; what it may not do
    // is spend money it did not have.
    expect(s.stats.wagered).toBeLessThanOrEqual(stake * 3 + s.stats.won);
  });

  it('is stoppable in the middle of a spin', () => {
    state().startAutoplay(100);
    vi.advanceTimersByTime(TIMING.spinUp);
    state().stopAutoplay();

    expect(state().autoplay).toBeNull();
    settle();
    expect(state().stats.spins).toBe(1);
    expect(__runtime.hasAutoTimer).toBe(false);
  });

  it('will not start a run it cannot afford', () => {
    useSlots.setState({ bankroll: 5 });
    state().startAutoplay(10);
    expect(state().autoplay).toBeNull();
    expect(state().message).toBeTruthy();
  });
});

/* ================================================================== *
 * Skip, cancel and cleanup
 * ================================================================== */

describe('skip', () => {
  it('settles a celebration immediately and credits it once', () => {
    spinUntilPaying();
    const owed = state().result!.totalWin;
    const before = state().bankroll;

    state().skip();

    // The books are closed synchronously: the money is in and the meter is on
    // the figure it was climbing towards.
    expect(state().bankroll).toBe(before + owed);
    expect(state().meter).toBe(owed);

    settle();
    expect(state().bankroll).toBe(before + owed);
    expectBooksBalance();
  });

  it('does nothing at rest', () => {
    const before = { ...state() };
    state().skip();
    expect(state().bankroll).toBe(before.bankroll);
    expect(state().phase).toBe('IDLE');
  });

  it('is idempotent under a mashed button', () => {
    spinUntilPaying();
    const before = state().bankroll;
    const owed = state().result!.totalWin;
    for (let i = 0; i < 10; i++) state().skip();
    settle();
    expect(state().bankroll).toBe(before + owed);
  });
});

describe('cancellation', () => {
  it('leaves no timer behind when a session is torn down mid-spin', () => {
    state().spin();
    vi.advanceTimersByTime(TIMING.spinUp + TIMING.reelStop);
    expect(state().phase).toBe('SPINNING');

    reset('a-brand-new-session');

    expect(__runtime.hasTimeline).toBe(false);
    expect(__runtime.hasMeter).toBe(false);
    expect(__runtime.hasAutoTimer).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never lets a stale timeline write state belonging to a previous spin', () => {
    state().spin();
    vi.advanceTimersByTime(TIMING.spinUp + TIMING.reelStop);
    const staleGeneration = __runtime.generation;

    reset('a-brand-new-session');
    expect(__runtime.generation).toBeGreaterThan(staleGeneration);

    const snapshot = {
      phase: state().phase,
      grid: state().grid,
      reels: [...state().reels],
      bankroll: state().bankroll,
      spinToken: state().spinToken,
      win: state().win,
      meter: state().meter,
    };

    vi.advanceTimersByTime(300_000);

    expect(state().phase).toBe(snapshot.phase);
    expect(state().grid).toEqual(snapshot.grid);
    expect(state().reels).toEqual(snapshot.reels);
    expect(state().bankroll).toBe(snapshot.bankroll);
    expect(state().spinToken).toBe(snapshot.spinToken);
    expect(state().win).toBe(snapshot.win);
    expect(state().meter).toBe(snapshot.meter);
  });

  it('does not let a cancelled autoplay run take another turn', () => {
    state().startAutoplay(20);
    until(() => state().phase === 'IDLE' && __runtime.hasAutoTimer);
    const spins = state().stats.spins;

    state().stopAutoplay();
    vi.advanceTimersByTime(AUTOPLAY_GAP * 20);

    expect(state().stats.spins).toBe(spins);
    expect(state().phase).toBe('IDLE');
  });

  it('starts a new session clean', () => {
    for (let i = 0; i < 4; i++) {
      state().spin();
      settle();
    }
    reset('fresh');

    const s = state();
    expect(s.bankroll).toBe(STARTING_BANKROLL);
    expect(s.stats.spins).toBe(0);
    expect(s.stats.won).toBe(0);
    expect(s.history).toEqual([]);
    expect(s.spinToken).toBe(0);
    expect(s.seed).toBe('fresh');
    expect(s.free).toBeNull();
    expect(s.hold).toBeNull();
  });
});

/* ================================================================== *
 * The cabinet
 * ================================================================== */

describe('the stake ladder', () => {
  it('moves up and down and clamps at both ends', () => {
    state().betUp();
    expect(state().betIndex).toBe(DEFAULT_BET_INDEX + 1);
    expect(state().betPerLine).toBe(betPerLineAt(DEFAULT_BET_INDEX + 1));
    expect(state().totalBet).toBe(totalBetAt(DEFAULT_BET_INDEX + 1));

    for (let i = 0; i < 20; i++) state().betDown();
    expect(state().betIndex).toBe(0);

    state().maxBet();
    expect(state().betIndex).toBe(BET_LADDER.length - 1);

    for (let i = 0; i < 5; i++) state().betUp();
    expect(state().betIndex).toBe(BET_LADDER.length - 1);
  });

  it('refuses to move under a live spin', () => {
    const index = state().betIndex;
    state().spin();

    state().betUp();
    state().maxBet();
    state().setBetIndex(0);

    expect(state().betIndex).toBe(index);
    expect(state().totalBet).toBe(totalBetAt(index));
  });

  it('charges the new stake once it has moved', () => {
    state().maxBet();
    const stake = state().totalBet;
    const before = state().bankroll;
    state().spin();
    expect(state().bankroll).toBe(before - stake);
    expect(stake).toBe(totalBetAt(BET_LADDER.length - 1));
  });
});

describe('preferences', () => {
  it('records a change and leaves the rest alone', () => {
    state().setPref('turbo', true);
    expect(state().prefs.turbo).toBe(true);
    expect(state().prefs.sound).toBe(true);

    state().setPref('sound', false);
    expect(state().prefs.sound).toBe(false);
    expect(state().prefs.turbo).toBe(true);
  });

  it('makes the machine materially faster when asked to', () => {
    const run = (prefs: Partial<Preferences>): number => {
      reset(SEED_QUIET);
      useSlots.setState((prev) => ({ prefs: { ...prev.prefs, ...prefs } }));
      state().spin();
      return settle();
    };

    const plain = run({});
    const turbo = run({ turbo: true });
    const reduced = run({ reducedMotion: true });

    expect(turbo).toBeLessThan(plain);
    expect(reduced).toBeLessThan(plain);
    // Reduced motion is not merely quieter; it collapses the spin hard.
    expect(reduced).toBeLessThan(plain / 2);
  });
});

describe('presentation', () => {
  it('takes the screen for a big win, and gives it back for quick wins', () => {
    reset(SEED_LOUD);
    state().spin();
    until(() => state().phase === 'TAKEOVER' || state().phase === 'IDLE');
    expect(state().phase).toBe('TAKEOVER');
    const owed = state().result!.totalWin;

    settle();
    expect(state().bankroll).toBe(STARTING_BANKROLL - state().totalBet + owed);

    // Quick wins removes the ceremony. It does not remove the money, and it
    // does not remove the count that proves the money arrived.
    reset(SEED_LOUD);
    state().setPref('quickWins', true);
    state().spin();
    until(() => state().phase === 'PRESENTING' || state().phase === 'IDLE');
    expect(state().phase).toBe('PRESENTING');
    expect(state().presentation?.amount).toBe(owed);

    settle();
    expect(state().meter).toBe(owed);
    expect(state().win).toBe(owed);
    expectBooksBalance();
  });

  it('dims exactly the cells the lit line does not use', () => {
    spinUntilPaying();
    until(() => state().highlight !== null || state().phase === 'IDLE');

    const highlight = state().highlight;
    expect(highlight).not.toBeNull();
    const dimmed = state().dimmed;

    // Together they cover the window once, with no cell in both.
    expect(highlight!.cells.length + dimmed.length).toBe(REELS * ROWS);
    const lit = new Set(highlight!.cells.map(cellKey));
    expect(dimmed.some((c) => lit.has(cellKey(c)))).toBe(false);
    expect(new Set(dimmed.map(cellKey)).size).toBe(dimmed.length);
  });

  it('clears the celebration once the machine is back at rest', () => {
    spinUntilPaying();
    settle();
    expect(state().highlight).toBeNull();
    expect(state().dimmed).toEqual([]);
    expect(state().banner).toBeNull();
    expect(state().reels.every((r) => r === 'IDLE')).toBe(true);
  });
});

describe('the gamble', () => {
  it('takes the win out of the balance while it is on the cards', () => {
    spinUntilGambleOffered();
    const banked = state().bankroll;
    const pot = state().win;
    expect(pot).toBeGreaterThan(0);

    state().startGamble();

    // The money is either in the balance or at risk, never both.
    expect(state().phase).toBe('GAMBLE');
    expect(state().bankroll).toBe(banked - pot);
    expect(state().gamble).toEqual({ stake: pot, step: 0, history: [] });
  });

  it('hands the pot straight back when it is collected untouched', () => {
    spinUntilGambleOffered();
    const banked = state().bankroll;
    const won = state().stats.won;

    state().startGamble();
    state().collectGamble();

    expect(state().phase).toBe('IDLE');
    expect(state().bankroll).toBe(banked);
    expect(state().stats.won).toBe(won);
    expectBooksBalance();
  });

  it('plays a run to the end without losing track of a cent', () => {
    spinUntilGambleOffered();
    const staked = state().win;
    const floor = state().bankroll - staked;

    state().startGamble();
    for (let i = 0; i < GAMBLE_MAX_STEPS + 2 && state().phase === 'GAMBLE'; i++) {
      state().chooseGamble(i % 2 === 0 ? 'RED' : 'BLACK');
      vi.advanceTimersByTime(TIMING.gambleFlip * 2);
    }
    if (state().phase === 'GAMBLE') state().collectGamble();
    settle();

    const s = state();
    expect(s.phase).toBe('IDLE');
    expect(Number.isInteger(s.bankroll)).toBe(true);
    // The pot came back either doubled some number of times, or not at all.
    const returned = s.bankroll - floor;
    expect(returned === 0 || returned % staked === 0).toBe(true);
    expectBooksBalance();
  });

  it('collects rather than asking the engine for a sixth double', () => {
    // The engine throws when handed a step past the cap, on the grounds that
    // being asked for one is a programming error. Making sure it never is one
    // is this store's job.
    useSlots.setState({
      phase: 'GAMBLE',
      win: 1000,
      gamble: { stake: 1000, step: GAMBLE_MAX_STEPS, history: [] },
    });

    expect(() => state().chooseGamble('RED')).not.toThrow();
    expect(state().phase).toBe('IDLE');
    expect(state().gamble).toBeNull();
  });

  it('is not offered on a win too big to be gambled', () => {
    useSlots.setState({ win: state().totalBet * 5000, canGamble: false });
    state().startGamble();
    expect(state().phase).toBe('IDLE');
    expect(state().gamble).toBeNull();
  });
});

/* ================================================================== *
 * Persistence
 *
 * Testable without a DOM because the store hands persist a memory-backed
 * storage shim when `localStorage` is absent, which is exactly the case in the
 * node test environment. What is being checked is the policy -- what is saved,
 * what an old save does, what a damaged one does -- rather than the round trip
 * through a browser, which is zustand's own concern and not this store's.
 * ================================================================== */

describe('the saved session', () => {
  it('saves five inert values and nothing about a spin in flight', () => {
    state().spin();
    const options = useSlots.persist.getOptions();
    const saved = options.partialize?.(state()) as unknown as Record<string, unknown>;

    expect(Object.keys(saved).sort()).toEqual([
      'bankroll',
      'betIndex',
      'history',
      'prefs',
      'stats',
    ]);
    // The whole reason for the list: a refresh mid-feature must not resume into
    // a machine that thinks it is mid-respin with no timeline running.
    for (const forbidden of ['phase', 'result', 'free', 'hold', 'reels', 'autoplay', 'spinToken']) {
      expect(saved).not.toHaveProperty(forbidden);
    }
  });

  it('discards a save from an older version rather than guessing at it', () => {
    const options = useSlots.persist.getOptions();
    expect(options.version).toBeGreaterThanOrEqual(1);
    expect(options.migrate?.({ bankroll: 999, betIndex: 3 }, 0)).toEqual({});
  });

  it('repairs a damaged save instead of spreading it over a good machine', () => {
    const options = useSlots.persist.getOptions();
    const merged = options.merge?.(
      { bankroll: 12_345.7, betIndex: 99, prefs: { turbo: true }, stats: null, history: 'nope' },
      state(),
    ) as SlotsState;

    expect(Number.isInteger(merged.bankroll)).toBe(true);
    expect(merged.bankroll).toBe(12_346);
    expect(merged.betIndex).toBe(BET_LADDER.length - 1);
    expect(merged.betPerLine).toBe(betPerLineAt(BET_LADDER.length - 1));
    expect(merged.totalBet).toBe(totalBetAt(BET_LADDER.length - 1));
    expect(merged.prefs.turbo).toBe(true);
    expect(merged.prefs.sound).toBe(true);
    expect(merged.stats.spins).toBe(0);
    expect(merged.history).toEqual([]);
    // And a phase never comes back from storage.
    expect(merged.phase).toBe('IDLE');
  });
});
