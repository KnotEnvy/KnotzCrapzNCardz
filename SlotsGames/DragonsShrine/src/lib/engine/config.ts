/**
 * The numbers that are not maths.
 *
 * Everything here is a decision about how the machine behaves rather than what
 * it pays: the stake ladder, how long each beat of a spin lasts, where a win
 * stops being "nice" and starts being "stand up". The paytable, the strips and
 * the jackpot values live next door in `paytable.ts`, because those get tuned
 * against a simulation and these get tuned against a stopwatch.
 *
 * Timings are milliseconds and they are shared on purpose. The sequencer, the
 * reel renderer, the FX layer and the audio bus all read the same constants,
 * which is the only way a reel stop, its click and its dust puff can land on
 * the same frame.
 */

import { LINES, type WinTier } from './types';

export { REELS, ROWS, LINES, CELLS } from './types';

/* ------------------------------------------------------------------ *
 * Money
 * ------------------------------------------------------------------ */

/**
 * The stake ladder, in cents per payline.
 *
 * Multiply by {@link LINES} for what a spin actually costs: 50c, $1, $2, $4,
 * $10, $20, $50, $100. The ladder is per-line rather than total because every
 * regular symbol pays a multiple of the line bet, and quoting the ladder in
 * the same unit the paytable uses keeps the arithmetic checkable by eye.
 */
export const BET_LADDER = [1, 2, 4, 8, 20, 40, 100, 200] as const;

/** Where a new session starts on the ladder: $1 a spin. */
export const DEFAULT_BET_INDEX = 1;

/** Opening bankroll, cents. $2,000. */
export const STARTING_BANKROLL = 200_000;

/** What the "add funds" button hands over, cents. */
export const REBUY_AMOUNT = 100_000;

/** Cents on one payline at a given rung. */
export function betPerLineAt(index: number): number {
  return BET_LADDER[Math.min(Math.max(index, 0), BET_LADDER.length - 1)];
}

/** Cents committed to a whole spin at a given rung. */
export function totalBetAt(index: number): number {
  return betPerLineAt(index) * LINES;
}

/* ------------------------------------------------------------------ *
 * Celebration
 * ------------------------------------------------------------------ */

/**
 * Where each tier of win starts, as a multiple of the stake.
 *
 * These are the thresholds a real cabinet uses to decide whether to tick the
 * meter up quietly or lock the reels and roll a two-second fanfare. They are
 * deliberately reachable: at 50 lines a 10x hit happens often enough to be a
 * moment rather than a rarity, and LEGENDARY is where the room turns round.
 */
export const WIN_TIER_THRESHOLDS: { tier: WinTier; from: number }[] = [
  { tier: 'LEGENDARY', from: 500 },
  { tier: 'EPIC', from: 150 },
  { tier: 'MEGA', from: 50 },
  { tier: 'BIG', from: 15 },
  { tier: 'MEDIUM', from: 5 },
  { tier: 'SMALL', from: 0.0001 },
];

/** The tier a win of `amount` cents lands in against a `totalBet` stake. */
export function winTier(amount: number, totalBet: number): WinTier {
  if (amount <= 0 || totalBet <= 0) return 'NONE';
  const ratio = amount / totalBet;
  for (const t of WIN_TIER_THRESHOLDS) if (ratio >= t.from) return t.tier;
  return 'NONE';
}

/** How long the count-up meter runs for each tier, milliseconds. */
export const TIER_COUNT_MS: Record<WinTier, number> = {
  NONE: 0,
  SMALL: 420,
  MEDIUM: 900,
  BIG: 2200,
  MEGA: 3400,
  EPIC: 4600,
  LEGENDARY: 6200,
};

/** Tiers that take over the screen rather than just ticking the meter. */
export const TAKEOVER_FROM: WinTier = 'BIG';

/* ------------------------------------------------------------------ *
 * Timing
 * ------------------------------------------------------------------ */

/**
 * The shape of a spin, in milliseconds.
 *
 * `reelStop` is the gap between one reel landing and the next, which is what
 * makes a spin read left to right instead of arriving all at once. Turbo
 * scales all of it by {@link TURBO_SCALE}; the anticipation beats are the one
 * thing turbo does not shorten, because a tease that is over before it
 * registers is worse than no tease.
 */
export const TIMING = {
  /** Reel 1 spins for this long before it is allowed to land. */
  spinUp: 420,
  /** Gap between consecutive reels landing. */
  reelStop: 165,
  /** The overshoot-and-settle at the end of a reel. */
  reelSettle: 260,
  /** Extra spin time on a reel that is teasing. */
  anticipation: 1400,
  /** Held after the last reel lands before wins start showing. */
  beforeWins: 220,
  /** Each winning line's turn in the cycle. */
  linePresent: 900,
  /** Held after the win presentation before autoplay may spin again. */
  afterWins: 320,
  /** The feature intro card. */
  featureIntro: 2600,
  /** The free spins outro / total card. */
  featureOutro: 3200,
  /** One respin of hold-and-win. */
  holdRespin: 900,
  /** How long a locked orb's landing takes to read. */
  orbLand: 520,
  /** Gamble card flip. */
  gambleFlip: 900,
} as const;

/** Turbo multiplies every duration above by this. */
export const TURBO_SCALE = 0.38;

/** Autoplay's pause between spins, before turbo. */
export const AUTOPLAY_GAP = 520;

/** The autoplay counts offered in the menu. Infinity is deliberate and stoppable. */
export const AUTOPLAY_COUNTS = [10, 25, 50, 100, 250, Infinity] as const;

/* ------------------------------------------------------------------ *
 * Keyboard
 * ------------------------------------------------------------------ */

/**
 * Keys the cabinet listens for.
 *
 * Space is spin, which is universal. The rest exist because a slot played with
 * one hand on a keyboard is a strategy tool, and the stake needs to move
 * without hunting for a button.
 */
export const KEYS = {
  spin: [' ', 'Enter'],
  betUp: ['ArrowUp', '+', '='],
  betDown: ['ArrowDown', '-', '_'],
  maxBet: ['m', 'M'],
  turbo: ['t', 'T'],
  autoplay: ['a', 'A'],
  paytable: ['i', 'I', '?'],
  mute: ['s', 'S'],
  skip: ['Escape'],
} as const;
