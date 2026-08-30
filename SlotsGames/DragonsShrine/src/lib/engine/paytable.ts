/**
 * What the machine pays.
 *
 * Every number in this file is tuned against `rtp.sim.test.ts`, which plays
 * tens of millions of spins and reports the return each part of the game
 * contributes. Nothing here should be nudged by feel: change a number, run the
 * simulation, and check that the total still lands inside the target band and
 * that the split between base game and features is still the one the design
 * wants. A game that returns the right amount entirely through its base game
 * is a different -- and much duller -- machine than one that returns it
 * through a bonus, even though the two measure identically.
 *
 * Units, restated because it is the only real trap here: line pays multiply
 * `betPerLine`, everything scattered multiplies `totalBet`.
 */

import type { JackpotId, PayingSymbol } from './types';

/** The target return band. The simulation fails outside it. */
export const RTP_TARGET = { min: 0.955, max: 0.968 } as const;

/* ------------------------------------------------------------------ *
 * Line pays
 * ------------------------------------------------------------------ */

/**
 * Pays for 3, 4 and 5 of a kind, in units of `betPerLine`.
 *
 * The ladder is steep at the top on purpose: DRAGON five-of-a-kind at 750x a
 * line is the hit the base game is really about, and the gap between it and
 * PHOENIX is what makes the last reel worth watching.
 */
export const PAYS: Record<PayingSymbol, readonly [number, number, number]> = {
  COIN: [5, 20, 60],
  LOTUS: [6, 25, 80],
  FAN: [8, 30, 100],
  LANTERN: [10, 40, 130],
  KOI: [15, 60, 200],
  TURTLE: [20, 80, 250],
  TIGER: [25, 110, 330],
  PHOENIX: [40, 160, 500],
  DRAGON: [60, 275, 900],
  WILD: [100, 450, 1500],
};

/** Anywhere-pays for the golden pearl, in units of `totalBet`, indexed by count. */
export const SCATTER_PAYS: Record<number, number> = { 3: 2, 4: 10, 5: 50 };

/* ------------------------------------------------------------------ *
 * Free spins -- the Shrine of Flames
 * ------------------------------------------------------------------ */

/** Pearls needed to light the shrine. */
export const SCATTER_TRIGGER = 3;

/** Spins awarded, by the number of pearls that triggered it. */
export const FREE_SPIN_AWARD: Record<number, number> = { 3: 10, 4: 15, 5: 20 };

/** Extra spins for landing {@link SCATTER_TRIGGER} pearls again inside the feature. */
export const RETRIGGER_SPINS = 5;

/**
 * The multiplier trail.
 *
 * Free spins start at 1x and step up the trail every time the dragon takes a
 * reel or another pearl lands. It never steps back inside a session, which is
 * what makes a long free spins run feel like it is building rather than just
 * continuing.
 */
export const MULTIPLIER_TRAIL = [1, 2, 3, 5, 10] as const;

/** Chance per free spin that the dragon turns a reel wild, by how many reels. */
export const DRAGON_REEL_CHANCE = { one: 0.074, two: 0.0071, three: 0.00098 } as const;

/** The reels the dragon is allowed to take. Never reel 1 -- that is the anchor. */
export const DRAGON_REEL_CANDIDATES = [1, 2, 3] as const;

/* ------------------------------------------------------------------ *
 * Anticipation
 *
 * Where a reel starts teasing. Presentational, but it belongs with the maths
 * rather than with the timings, because the thresholds are statements about
 * the trigger: two pearls is one short of the shrine, and four orbs is within
 * one block of the link. Move a trigger and these move with it.
 * ------------------------------------------------------------------ */

/** Pearls already showing before a later reel starts to tease. */
export const SCATTER_TEASE_AT = 2;

/** Orbs already showing before a later reel starts to tease. */
export const ORB_TEASE_AT = 4;

/* ------------------------------------------------------------------ *
 * Dragon Rage -- the base game's random wilds
 * ------------------------------------------------------------------ */

/** Chance a base spin wakes the dragon. */
export const RAGE_CHANCE = 0.012;

/** How many cells it turns wild, and how likely each count is. */
export const RAGE_WILDS = [2, 3, 4, 5, 6] as const;
export const RAGE_WEIGHTS = [42, 28, 18, 9, 3] as const;

/* ------------------------------------------------------------------ *
 * Hold and Win -- the Shrine Link
 * ------------------------------------------------------------------ */

/** Orbs on one spin that light the link. */
export const HOLD_TRIGGER_ORBS = 6;

/** Respins granted, and restored to, whenever a new orb lands. */
export const HOLD_RESPINS = 3;

/** Chance an empty cell catches an orb on a respin. */
export const HOLD_LAND_CHANCE = 0.05;

/** Orb credit values, in units of `totalBet`, and how often each appears. */
export const ORB_VALUES = [1, 2, 3, 5, 8, 10, 15, 20, 30, 50] as const;
export const ORB_WEIGHTS = [300, 210, 150, 95, 60, 38, 20, 11, 5, 2] as const;

/** The four fixed jackpots, in units of `totalBet`. */
export const JACKPOTS: Record<JackpotId, number> = {
  MINI: 20,
  MINOR: 50,
  MAJOR: 500,
  GRAND: 5000,
};

/**
 * How often an orb carries a jackpot instead of credits.
 *
 * MAJOR and GRAND are deliberately not reachable this way -- they are board
 * awards, not orb awards, which is what stops the top prize from arriving
 * without ceremony on the first respin.
 */
export const ORB_JACKPOT_CHANCE: Partial<Record<JackpotId, number>> = {
  MINI: 0.022,
  MINOR: 0.006,
};

/** Filling this many cells awards the MAJOR; filling all of them awards the GRAND. */
export const MAJOR_AT_CELLS = 18;

/* ------------------------------------------------------------------ *
 * Buying in
 * ------------------------------------------------------------------ */

export type BuyOption = 'FREE_SPINS' | 'HOLD_AND_WIN' | 'SUPER';

/**
 * What a feature costs, in units of `totalBet`.
 *
 * These three numbers are measurements, not choices. Each one was found by
 * pinning its cost at 1x and letting `rtp.sim.test.ts` report what the feature
 * is raw-worth -- 75.5x for the shrine, 59.8x for the link, 240x for the super
 * buy -- and then dividing by the return the base game was measured at. The
 * cost is set to the middle of the window that leaves the buy's own return at
 * or just below the base game's, which is where the measurement error has the
 * most room on both sides.
 *
 * Both ends of that window matter. Priced too low, the button is the only
 * correct way to play and the base game is decoration. Priced too high it is a
 * trap: the most expensive thing on the machine, sold to the player who is
 * least willing to wait, and they are entitled to roughly the deal the spin
 * button gives them minus a small premium. `rtp.sim.test.ts` asserts both ends.
 *
 * Retune the strips and these move. Re-measure them; do not scale them by eye.
 */
export const BUY_COSTS: Record<BuyOption, number> = {
  FREE_SPINS: 80,
  HOLD_AND_WIN: 64,
  SUPER: 255,
};

/** What each buy actually hands over. */
export const BUY_GRANTS: Record<BuyOption, { scatters?: number; orbs?: number }> = {
  FREE_SPINS: { scatters: 3 },
  HOLD_AND_WIN: { orbs: 6 },
  SUPER: { scatters: 5 },
};

/* ------------------------------------------------------------------ *
 * Gamble
 * ------------------------------------------------------------------ */

/** A win above this multiple of the stake cannot be gambled. */
export const GAMBLE_MAX_RATIO = 50;
/** How many doubles are allowed in one run. */
export const GAMBLE_MAX_STEPS = 5;
