/**
 * The strategy language.
 *
 * A strategy is a list of rules, and a rule is one sentence: *when* a moment
 * arrives, *if* everything about the table holds, *then* do these things. That
 * is the whole model. It is deliberately small — every real craps system a
 * player would describe out loud ("place the inside numbers, press the one
 * that hits, come down after two hits") is a handful of those sentences.
 *
 * Everything here is plain serialisable data. A strategy is JSON: it survives
 * localStorage, it can be exported and pasted between players, and the runner
 * that executes it is a pure function, exactly like the rest of `lib/engine`.
 */

import type {
  AtsKind,
  BetKind,
  DieFace,
  PointNumber,
  PropKind,
} from '@/lib/engine/types';

/* ------------------------------------------------------------------ *
 * When — the moment a rule wakes up
 * ------------------------------------------------------------------ */

/**
 * Triggers come in two flavours, and the difference matters.
 *
 * *State* triggers describe how the table is sitting right now, so they are
 * safe to evaluate again on an unchanged table — running the strategy twice
 * cannot double a bet that is guarded by "if I have nothing there".
 *
 * *Event* triggers describe something the last roll did. Those fire once, on
 * the roll that caused them, and never again — otherwise pressing "run" twice
 * after an eight would press the eight twice.
 */
export type Trigger =
  /* State */
  | 'COME_OUT' // the table is on a come-out, dice not yet thrown
  | 'POINT_ON' // a point is established, dice not yet thrown
  | 'HAND_START' // a new shooter has the dice and has not thrown yet
  | 'EVERY_ROLL' // every decision point, whatever the table is doing
  /* Event */
  | 'POINT_SET' // the roll that just happened established the point
  | 'POINT_MADE' // the roll that just happened made the point
  | 'SEVEN_OUT' // the roll that just happened ended the hand
  | 'NUMBER_HIT' // the roll that just happened was a box number
  | 'CRAPS' // the roll that just happened was 2, 3 or 12
  | 'NATURAL'; // the roll that just happened was 7 or 11 on a come-out

/** Triggers that describe the table rather than the last roll. */
export const STATE_TRIGGERS: readonly Trigger[] = [
  'COME_OUT',
  'POINT_ON',
  'HAND_START',
  'EVERY_ROLL',
];

export function isStateTrigger(t: Trigger): boolean {
  return STATE_TRIGGERS.includes(t);
}

/** How often a rule is allowed to fire before it has to wait for a reset. */
export type OnceScope =
  | 'ALWAYS' // every time its conditions hold
  | 'ROLL' // at most once per roll
  | 'POINT' // once per point cycle
  | 'HAND' // once per shooter
  | 'SESSION'; // once, ever

/* ------------------------------------------------------------------ *
 * Referring to a number
 * ------------------------------------------------------------------ */

/**
 * Which box number an action is about.
 *
 * The two dynamic refs are what make a strategy readable rather than a
 * six-way copy-paste: `POINT` is whatever the point is right now, and `HIT`
 * is the number the dice just landed on. "Press HIT by one unit" is the whole
 * of a place-and-press system.
 */
export type NumberRef =
  | PointNumber
  | 'POINT'
  | 'HIT'
  | 'INSIDE' // 5, 6, 8, 9
  | 'OUTSIDE' // 4, 5, 9, 10
  | 'ACROSS'; // all six

export const NUMBER_REFS: readonly NumberRef[] = [
  4,
  5,
  6,
  8,
  9,
  10,
  'POINT',
  'HIT',
  'INSIDE',
  'OUTSIDE',
  'ACROSS',
];

/** Where a bet goes. A `BetSpec` with the dynamic number refs allowed. */
export interface BetTarget {
  kind: BetKind;
  /** For PLACE / BUY / LAY / HARDWAY / BIG. */
  number?: NumberRef;
  prop?: PropKind;
  hop?: [DieFace, DieFace];
  ats?: AtsKind;
  /**
   * Skip the current point when the ref expands to a set. "Place the inside
   * numbers except my point" is a common call, and without this it would take
   * four near-identical rules to say.
   */
  exceptPoint?: boolean;
}

/* ------------------------------------------------------------------ *
 * How much
 * ------------------------------------------------------------------ */

/**
 * Amounts are expressed the way a player says them, not in raw dollars.
 *
 * `UNITS` is the important one: a strategy carries a base unit, and saying
 * "one unit on the six" lets the same rule run at a $5 table and a $25 one.
 * The engine's own increment rules do the rest — one $5 unit on the six goes
 * up as $6, which is exactly how "$22 inside" arrives at twenty-two dollars.
 */
export type AmountMode =
  | 'UNITS' // value × the strategy's unit
  | 'FIXED' // value dollars
  | 'TABLE_MIN' // whatever the table minimum is
  | 'PCT_BANKROLL' // value percent of the seat's rack
  /* Press and regress modes, relative to what is already on the number */
  | 'DOUBLE' // twice what is there
  | 'WIN' // the amount this bet just won
  | 'HALF_WIN' // half of what it just won
  | 'TO' // bring the bet to exactly value
  /* Odds modes */
  | 'MAX' // the full odds the table allows
  | 'MULTIPLE'; // value times the flat bet

export interface Amount {
  mode: AmountMode;
  value: number;
}

export function units(value: number): Amount {
  return { mode: 'UNITS', value };
}

export function fixed(value: number): Amount {
  return { mode: 'FIXED', value };
}

export const MAX_ODDS: Amount = { mode: 'MAX', value: 0 };

/* ------------------------------------------------------------------ *
 * If — conditions
 * ------------------------------------------------------------------ */

export type Comparison = 'EQ' | 'NE' | 'GT' | 'GTE' | 'LT' | 'LTE';

export const COMPARISONS: ReadonlyArray<{ value: Comparison; label: string }> = [
  { value: 'EQ', label: 'is' },
  { value: 'NE', label: 'is not' },
  { value: 'GTE', label: 'is at least' },
  { value: 'GT', label: 'is more than' },
  { value: 'LTE', label: 'is at most' },
  { value: 'LT', label: 'is under' },
];

/**
 * Everything a rule can ask about the table before it acts.
 *
 * All the conditions on a rule must hold — they are ANDed. An "or" is two
 * rules, which reads better in the workshop than a nested boolean tree and
 * costs nothing to run.
 */
export type Condition =
  /** The point is one of these numbers (empty means "any point"). */
  | { t: 'POINT_IS'; numbers: PointNumber[] }
  /** The box number the dice just landed on is one of these. */
  | { t: 'HIT_IS'; numbers: PointNumber[] }
  /** The total the dice just showed. */
  | { t: 'LAST_TOTAL'; op: Comparison; value: number }
  /** Whether this seat has a bet on a spot. */
  | { t: 'HAS_BET'; target: BetTarget; has: boolean }
  /** What this seat has riding on a spot. */
  | { t: 'BET_AMOUNT'; target: BetTarget; op: Comparison; value: number }
  /** How many bets of a kind this seat holds — "fewer than two come bets". */
  | { t: 'BET_COUNT'; kind: BetKind; op: Comparison; value: number }
  /** Chips in the rack, not counting what is on the felt. */
  | { t: 'BANKROLL'; op: Comparison; value: number }
  /** Total on the felt for this seat. */
  | { t: 'AT_RISK'; op: Comparison; value: number }
  /** Up or down for the session, counting bets still out there. */
  | { t: 'SESSION_NET'; op: Comparison; value: number }
  /** Up or down since this shooter took the dice. */
  | { t: 'HAND_NET'; op: Comparison; value: number }
  /** Rolls this shooter has thrown. */
  | { t: 'ROLLS_THIS_HAND'; op: Comparison; value: number }
  /** Times a number has come up since the last seven. */
  | { t: 'HITS_ON'; number: NumberRef; op: Comparison; value: number }
  /** Points this shooter has made without sevening out. */
  | { t: 'POINTS_THIS_HAND'; op: Comparison; value: number }
  /** Whether this seat is holding the dice. */
  | { t: 'IM_SHOOTING'; value: boolean };

export type ConditionKind = Condition['t'];

/* ------------------------------------------------------------------ *
 * Then — actions
 * ------------------------------------------------------------------ */

/** Which line bets an odds call reaches. */
export type OddsTarget = 'PASS' | 'DONT_PASS' | 'COME' | 'DONT_COME' | 'ALL';

/** What a take-down call sweeps. */
export interface TakeDownTarget {
  /** A specific spot, or every bet of that kind when `number` expands to a set. */
  target?: BetTarget;
  /** Everything this seat legally can take down. */
  all?: boolean;
}

export type Action =
  /**
   * Put money on a spot.
   *
   * By default this *brings the spot up to* the amount named, so a rule that
   * says "twenty-two inside" and finds twenty-two inside already there does
   * nothing. That is what a player means when they say it: the bets survive a
   * point being made, and calling for them again on the next come-out is a
   * re-statement, not a second helping. Set `topUp` for the other reading.
   */
  | { t: 'BET'; target: BetTarget; amount: Amount; topUp?: boolean }
  /** Take or lay odds behind line bets that have a number. */
  | { t: 'ODDS'; on: OddsTarget; amount: Amount }
  /** Increase a place or buy bet. */
  | { t: 'PRESS'; number: NumberRef; amount: Amount }
  /** Bring a place or buy bet back down to a smaller number. */
  | { t: 'REGRESS'; number: NumberRef; amount: Amount }
  /** Take bets off the felt and back into the rack. */
  | { t: 'TAKE_DOWN'; target: TakeDownTarget }
  /** Turn place, buy and hardway bets on or off. */
  | { t: 'WORKING'; number: NumberRef; on: boolean }
  /** Stop betting for the rest of the session. */
  | { t: 'STOP'; reason: string };

export type ActionKind = Action['t'];

/* ------------------------------------------------------------------ *
 * A rule, and a strategy
 * ------------------------------------------------------------------ */

export interface StrategyRule {
  id: string;
  /** The player's own label. Falls back to the generated sentence. */
  note?: string;
  enabled: boolean;
  when: Trigger;
  once: OnceScope;
  /** All of these must hold. */
  all: Condition[];
  /** Run in order. A refusal is logged and the rest still run. */
  then: Action[];
}

export interface Strategy {
  id: string;
  name: string;
  /** One line, shown in the library and under the seat. */
  summary: string;
  /** Built into the game, or made by the player. */
  origin: 'HOUSE' | 'CUSTOM';
  /** The base bet. Every `UNITS` amount multiplies this. */
  unit: number;
  /** Stop betting once the session is up this much. Zero means no goal. */
  winGoal: number;
  /** Stop betting once the session is down this much. Zero means no limit. */
  lossLimit: number;
  rules: StrategyRule[];
}

/* ------------------------------------------------------------------ *
 * Memory — what a running strategy remembers between rolls
 * ------------------------------------------------------------------ */

export interface StrategyLogEntry {
  /** The roll this happened on, so the log lines up with the history strip. */
  roll: number;
  /** Which rule spoke. */
  rule: string;
  /** What it did, or why it could not. */
  text: string;
  ok: boolean;
}

/**
 * Per-seat running state. It is separate from the strategy itself because the
 * same strategy can be assigned to both seats, and separate from the table
 * because the engine has no business knowing a bot is playing.
 */
export interface StrategyMemory {
  /** Which strategy this memory belongs to; a change resets it. */
  strategyId: string | null;
  /** Increments on every seven-out. */
  handIndex: number;
  /** Increments every time a point is established. */
  pointCycle: number;
  /** Bankroll plus everything on the felt when this hand began. */
  handStartEquity: number;
  /** Box number to times it has come up since the last seven. */
  hits: Record<number, number>;
  /** Points this shooter has made without sevening out. */
  pointsThisHand: number;
  /** Rule id to the epoch token it last fired in, for `once`. */
  fired: Record<string, string>;
  stopped: boolean;
  stopReason: string;
  /** `table.rollCount` the last time this memory was advanced. */
  lastRollSeen: number;
  /** Most recent entries, newest last. */
  log: StrategyLogEntry[];
}

/** How much of the log to keep. Enough to see a whole hand play out. */
export const LOG_LIMIT = 60;

export function emptyMemory(strategyId: string | null, equity = 0): StrategyMemory {
  return {
    strategyId,
    handIndex: 0,
    pointCycle: 0,
    handStartEquity: equity,
    hits: {},
    pointsThisHand: 0,
    fired: {},
    stopped: false,
    stopReason: '',
    lastRollSeen: -1,
    log: [],
  };
}

/* ------------------------------------------------------------------ *
 * Assignment
 * ------------------------------------------------------------------ */

export interface SeatStrategy {
  /** Which strategy is on this seat, or null for a seat played by hand. */
  strategyId: string | null;
  /** Whether it plays itself after every roll, or waits to be run by hand. */
  auto: boolean;
}

export function emptySeatStrategy(): SeatStrategy {
  return { strategyId: null, auto: false };
}
