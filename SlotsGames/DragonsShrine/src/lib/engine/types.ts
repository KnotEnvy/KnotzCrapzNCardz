/**
 * The shape of everything the game is made of.
 *
 * This file is a published contract. Five workstreams compile against it, so
 * the rule is: things may be ADDED here, never renamed and never removed. A
 * type that turns out to be wrong gets a new member and a deprecation note,
 * not a rewrite.
 *
 * Two conventions run through the whole engine and are worth learning once.
 *
 *   Money is integer cents. Never a float. A slot pays fractions of a line bet
 *   hundreds of times an hour and floating point drift in a bankroll is a bug
 *   you find three weeks later in a screenshot. Every amount in here -- bets,
 *   wins, jackpots, bankroll -- is a whole number of cents.
 *
 *   Pays are multipliers, and there are two kinds. A *line* pay multiplies the
 *   bet on one payline (`betPerLine`). A *total* pay -- scatters, orb values,
 *   jackpots -- multiplies the whole stake (`totalBet`). Getting these two
 *   confused is the single easiest way to be off by 50x, so every field that
 *   holds a multiplier says which one it is.
 */

/* ------------------------------------------------------------------ *
 * The reel band
 * ------------------------------------------------------------------ */

/**
 * Every symbol that can land on the reels.
 *
 * Four low symbols carved from the shrine's furniture, three mid animals, two
 * high ones, and the three specials. `DRAGON` is the top-paying regular
 * symbol; `WILD` is the shrine gate itself.
 */
export type SymbolId =
  | 'COIN'
  | 'LOTUS'
  | 'FAN'
  | 'LANTERN'
  | 'KOI'
  | 'TURTLE'
  | 'TIGER'
  | 'PHOENIX'
  | 'DRAGON'
  | 'WILD'
  | 'SCATTER'
  | 'ORB';

/** Symbols that pay along a line, in ascending order of value. */
export const PAYING_SYMBOLS = [
  'COIN',
  'LOTUS',
  'FAN',
  'LANTERN',
  'KOI',
  'TURTLE',
  'TIGER',
  'PHOENIX',
  'DRAGON',
  'WILD',
] as const satisfies readonly SymbolId[];

export type PayingSymbol = (typeof PAYING_SYMBOLS)[number];

/** Symbols that pay (or trigger) from anywhere on the grid, not along a line. */
export const SCATTERED_SYMBOLS = ['SCATTER', 'ORB'] as const satisfies readonly SymbolId[];

/** A position on the visible grid. Reels are 0-indexed left to right, rows top to bottom. */
export interface Cell {
  reel: number;
  row: number;
}

/**
 * The visible window, indexed `[reel][row]`.
 *
 * Always {@link REELS} columns of {@link ROWS} symbols. Column-major because
 * every reel operation -- spinning, stopping, teasing, turning a whole reel
 * wild -- works on one column at a time, and because a reel strip is a column.
 */
export type Grid = SymbolId[][];

/** Which band of reel strips produced a spin. Each game mode has its own. */
export type StripSet = 'BASE' | 'FREE' | 'HOLD';

/* ------------------------------------------------------------------ *
 * Wins
 * ------------------------------------------------------------------ */

/** One payline that paid. */
export interface LineWin {
  /** Index into the payline table, 0..LINES-1. */
  line: number;
  /** The symbol that formed the win. Never WILD unless the line is all wilds. */
  symbol: PayingSymbol;
  /** How many from the left, always >= 3. */
  count: number;
  /** The exact cells that formed it, left to right. */
  cells: Cell[];
  /** Pay multiplier, in units of `betPerLine`. */
  multiplier: number;
  /** What it paid, in cents, before any feature multiplier. */
  amount: number;
  /** True when a wild stood in for the paying symbol anywhere on the line. */
  wildAssisted: boolean;
}

/** The scatter pay, which lands anywhere and multiplies the whole stake. */
export interface ScatterWin {
  count: number;
  cells: Cell[];
  /** Pay multiplier, in units of `totalBet`. */
  multiplier: number;
  amount: number;
}

/* ------------------------------------------------------------------ *
 * Orbs and jackpots
 * ------------------------------------------------------------------ */

/** The four fixed jackpots, smallest first. */
export type JackpotId = 'MINI' | 'MINOR' | 'MAJOR' | 'GRAND';

export const JACKPOT_IDS = ['MINI', 'MINOR', 'MAJOR', 'GRAND'] as const;

/**
 * What a single fire orb is worth.
 *
 * A `CREDIT` orb carries a plain multiple of the stake. A `JACKPOT` orb carries
 * one of the four fixed jackpots -- which are also stake multiples, so the two
 * settle through exactly the same arithmetic and only differ in how they are
 * announced.
 */
export type OrbAward =
  | { kind: 'CREDIT'; /** in units of `totalBet` */ multiplier: number }
  | { kind: 'JACKPOT'; jackpot: JackpotId; /** in units of `totalBet` */ multiplier: number };

/** An orb sitting on the grid, with the award it carries. */
export interface Orb extends Cell {
  award: OrbAward;
  /** Cents, resolved against the stake the feature was triggered at. */
  amount: number;
}

/* ------------------------------------------------------------------ *
 * Features
 * ------------------------------------------------------------------ */

export type FeatureId = 'FREE_SPINS' | 'HOLD_AND_WIN';

/** What a spin lit up, if anything. */
export interface FeatureTrigger {
  feature: FeatureId;
  /** Scatters or orbs that did it. */
  cells: Cell[];
  /** Free spins awarded, or orbs collected. */
  count: number;
  /** Free spins only: how many spins the trigger is worth. */
  spins?: number;
}

/**
 * A free spins session in flight.
 *
 * The multiplier trail is the reason free spins here are worth more than the
 * same number of base spins: every extra scatter or dragon reel advances it,
 * and it never resets inside a session.
 */
export interface FreeSpinsState {
  /** Spins awarded in total, including retriggers. */
  awarded: number;
  /** Spins already played. */
  played: number;
  /** Cents won across the session so far. */
  won: number;
  /** Index into {@link MULTIPLIER_TRAIL}. */
  trailIndex: number;
  /** How many retriggers have happened, for the presentation to announce. */
  retriggers: number;
  /** The stake the session was bought or triggered at; free spins never change it. */
  totalBet: number;
  betPerLine: number;
  /** True when the session came from a feature buy rather than a natural trigger. */
  bought: boolean;
}

/**
 * A hold-and-win session in flight.
 *
 * Only orbs land during the respins. Every new orb resets the respin counter,
 * every orb holds where it fell, and filling the grid awards the GRAND.
 */
export interface HoldState {
  /** Orbs locked to the grid, in the order they landed. */
  orbs: Orb[];
  /** Respins left before the feature ends. */
  respinsLeft: number;
  /** Respins already played, for the presentation. */
  respinsPlayed: number;
  /** Cents accumulated on the grid so far. */
  collected: number;
  /** Jackpots awarded by filling the grid or a full column, beyond the orbs themselves. */
  awardedJackpots: JackpotId[];
  totalBet: number;
  bought: boolean;
}

/* ------------------------------------------------------------------ *
 * A spin, start to finish
 * ------------------------------------------------------------------ */

/** Everything one spin of the reels produced. Pure output of the engine. */
export interface SpinResult {
  /** The window as it landed, after wild features have been applied. */
  grid: Grid;
  /** The window as the strips produced it, before Dragon Rage or dragon reels. */
  rawGrid: Grid;
  /** Where each reel stopped on its strip. The reel renderer needs this to land honestly. */
  stops: number[];
  strips: StripSet;

  lineWins: LineWin[];
  scatter: ScatterWin | null;

  /** Cells that are wild for evaluation, including feature-added ones. */
  wildCells: Cell[];
  /** Reels turned wild top to bottom by the dragon (free spins only). */
  dragonReels: number[];
  /** True when the base game's random Dragon Rage fired on this spin. */
  rage: boolean;

  /** Orbs visible on this spin. Only meaningful when they trigger or during HOLD. */
  orbs: Orb[];

  trigger: FeatureTrigger | null;

  /** The feature multiplier in force, in units of 1. 1 outside free spins. */
  multiplier: number;
  /** Line + scatter wins, cents, before {@link multiplier}. */
  baseWin: number;
  /** What the spin actually pays, cents. */
  totalWin: number;

  /**
   * Reels that should slow down and tease before stopping, 0-indexed.
   *
   * Purely presentational, but decided by the engine because only the engine
   * knows whether reel 3 is about to be the third scatter.
   */
  anticipation: number[];
}

/** One respin inside hold-and-win. */
export interface HoldSpinResult {
  /** Orbs that landed on this respin (new ones only). */
  landed: Orb[];
  /** The whole board after landing. */
  orbs: Orb[];
  /** True when the last empty cell was filled. */
  full: boolean;
  respinsLeft: number;
  /** Jackpots awarded by this respin's board state. */
  jackpots: JackpotId[];
  /** Cents on the board after this respin. */
  collected: number;
}

/* ------------------------------------------------------------------ *
 * Gamble
 * ------------------------------------------------------------------ */

export type GambleChoice = 'RED' | 'BLACK';

export interface GambleResult {
  choice: GambleChoice;
  landed: GambleChoice;
  won: boolean;
  /** Cents staked into the gamble. */
  stake: number;
  /** Cents held after it, 0 on a loss. */
  balance: number;
  /** How many successful doubles have happened in this gamble run. */
  step: number;
}

/* ------------------------------------------------------------------ *
 * Bets and session
 * ------------------------------------------------------------------ */

/** The stake for one spin, in both the units the engine needs. */
export interface Stake {
  /** Cents on each of the {@link LINES} paylines. */
  betPerLine: number;
  /** Cents committed to the spin: `betPerLine * LINES`. */
  totalBet: number;
}

/** What a session has done, for the HUD and the history panel. */
export interface SessionStats {
  spins: number;
  freeSpins: number;
  wagered: number;
  won: number;
  /** Biggest single spin, cents. */
  biggestWin: number;
  /** Spins since the last win of any size. */
  dryStreak: number;
  longestDryStreak: number;
  featureTriggers: Record<FeatureId, number>;
  jackpots: Record<JackpotId, number>;
  /** Peak bankroll seen, cents. */
  peak: number;
}

/** One line in the win history strip. */
export interface HistoryEntry {
  id: number;
  /** Cents. */
  win: number;
  totalBet: number;
  /** Win as a multiple of the stake, for tier labelling. */
  ratio: number;
  tier: WinTier;
  free: boolean;
  at: number;
}

/**
 * How loudly a win is celebrated.
 *
 * The thresholds live in config; this is the vocabulary every layer shares --
 * the sequencer to decide how long to hold, the FX layer to decide what to
 * throw, and audio to decide which fanfare to play.
 */
export type WinTier = 'NONE' | 'SMALL' | 'MEDIUM' | 'BIG' | 'MEGA' | 'EPIC' | 'LEGENDARY';

export const WIN_TIERS = [
  'NONE',
  'SMALL',
  'MEDIUM',
  'BIG',
  'MEGA',
  'EPIC',
  'LEGENDARY',
] as const satisfies readonly WinTier[];

/* ------------------------------------------------------------------ *
 * Geometry
 *
 * Repeated here rather than imported from config so that a module needing
 * only the shape of the machine does not pull in the whole paytable.
 * ------------------------------------------------------------------ */

/** Columns. */
export const REELS = 5;
/** Rows in the visible window. */
export const ROWS = 4;
/** Fixed paylines. Not selectable -- every spin plays all of them. */
export const LINES = 50;
/** Cells in the window. Hold-and-win fills all of them for the GRAND. */
export const CELLS = REELS * ROWS;
