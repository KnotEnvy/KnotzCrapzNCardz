/**
 * Core domain types for the craps engine.
 *
 * Everything here is plain data: the engine is a pure function over these
 * structures so it can be unit-tested, replayed from a seed, and (later)
 * synchronised across a wire without touching the React layer.
 */

export type DieFace = 1 | 2 | 3 | 4 | 5 | 6;

export interface Roll {
  d1: DieFace;
  d2: DieFace;
  /** 2..12 */
  total: number;
}

/** The six box numbers that can become a point. */
export type PointNumber = 4 | 5 | 6 | 8 | 9 | 10;

export const POINT_NUMBERS: readonly PointNumber[] = [4, 5, 6, 8, 9, 10];

export type Phase = 'COME_OUT' | 'POINT_SET';

export type SeatId = 'A' | 'B';

/* ------------------------------------------------------------------ *
 * Bets
 * ------------------------------------------------------------------ */

export type BetKind =
  // Line bets. `point` is undefined while the bet is still "in the box".
  | 'PASS'
  | 'DONT_PASS'
  | 'COME'
  | 'DONT_COME'
  // Box-number bets
  | 'PLACE'
  | 'BUY'
  | 'LAY'
  | 'BIG'
  // Multi-roll
  | 'HARDWAY'
  // Single-roll
  | 'FIELD'
  | 'PROP'
  | 'HOP'
  // Bonus / side bets
  | 'FIRE'
  | 'ATS';

/** Single-roll proposition bets. */
export type PropKind =
  | 'ANY_7'
  | 'ANY_CRAPS'
  | 'TWO'
  | 'THREE'
  | 'YO'
  | 'TWELVE'
  | 'HORN'
  | 'HORN_HIGH_2'
  | 'HORN_HIGH_3'
  | 'HORN_HIGH_YO'
  | 'HORN_HIGH_12'
  | 'WORLD'
  | 'C_AND_E';

/** All/Tall/Small variants. */
export type AtsKind = 'ALL' | 'TALL' | 'SMALL';

export interface Bet {
  id: string;
  seat: SeatId;
  kind: BetKind;
  /** Base wager in dollars. Odds are tracked separately on `odds`. */
  amount: number;
  /**
   * Box number for PLACE / BUY / LAY / BIG / HARDWAY, or the established
   * point for COME / DONT_COME. Undefined for a COME bet still in the box.
   */
  number?: PointNumber | 6 | 8;
  /** Which proposition, for kind === 'PROP'. */
  prop?: PropKind;
  /** The exact two faces for kind === 'HOP'. */
  hop?: [DieFace, DieFace];
  /** Which All/Tall/Small bet, for kind === 'ATS'. */
  ats?: AtsKind;
  /** Odds wagered behind a line bet (PASS / DONT_PASS / COME / DONT_COME). */
  odds: number;
  /**
   * Whether the bet can win or lose on the next roll. Place/Buy/Hardway bets
   * are conventionally OFF during a come-out roll; the player may override.
   */
  working: boolean;
  /** Whether the odds portion is working. Don't-side odds are always on. */
  oddsWorking: boolean;
  /** Vig already paid up front (buy/lay when the table charges on placement). */
  vigPaid: number;
  /** Roll index the bet was created on, for the ledger. */
  placedOnRoll: number;
}

/* ------------------------------------------------------------------ *
 * Table configuration
 * ------------------------------------------------------------------ */

/** Max-odds schemes. '3-4-5' is the modern standard. */
export type OddsScheme = '1x' | '2x' | '3-4-5' | '5x' | '10x' | '20x' | '100x';

export interface TableRules {
  minBet: number;
  maxBet: number;
  oddsScheme: OddsScheme;
  /** Field pays 3:1 on 12 (true) or 2:1 (false). Some tables pay 3:1 on 2. */
  fieldPays3OnTwelve: boolean;
  fieldPays3OnTwo: boolean;
  /** Charge the 5% buy/lay commission only when the bet wins (modern) vs up front. */
  vigOnWin: boolean;
  /** Place/Buy bets default to OFF on the come-out roll. */
  placeOffOnComeOut: boolean;
  /** Hardways default to OFF on the come-out roll. */
  hardwaysOffOnComeOut: boolean;
  /**
   * Field and proposition bets stay on the felt after a win, with only the
   * winnings paid out. This is what a real table does; turn it off if you would
   * rather every single-roll bet come down automatically.
   */
  propsRideAfterWin: boolean;
  /** Enable the Fire Bet side wager. */
  fireBetEnabled: boolean;
  /** Enable All/Tall/Small side wagers. */
  atsEnabled: boolean;
  /** Chips added to a rack by the BUY IN button when a seat busts out. */
  rebuyAmount: number;
  /**
   * How many rolls of detail to keep. Each roll copies this window once, so
   * simulations that only want the aggregate figures set it to zero and run
   * several times faster.
   */
  historyLimit: number;
}

/** Default rolls of detail to keep. Roughly four hours of live play. */
export const HISTORY_LIMIT = 600;

export const DEFAULT_RULES: TableRules = {
  minBet: 5,
  maxBet: 5000,
  oddsScheme: '3-4-5',
  fieldPays3OnTwelve: true,
  fieldPays3OnTwo: false,
  vigOnWin: true,
  placeOffOnComeOut: true,
  hardwaysOffOnComeOut: true,
  propsRideAfterWin: true,
  fireBetEnabled: true,
  atsEnabled: true,
  rebuyAmount: 500,
  historyLimit: HISTORY_LIMIT,
};

/* ------------------------------------------------------------------ *
 * Seats & table state
 * ------------------------------------------------------------------ */

export interface Seat {
  id: SeatId;
  name: string;
  bankroll: number;
  /** Colour used for this seat's chips and outlines. */
  color: string;
  /** Bankroll at the start of the session, for net-yield reporting. */
  buyIn: number;
  /** Total wagered across the session, for the hold percentage. */
  totalWagered: number;
  /** Largest bankroll reached, for the drawdown figure. */
  peak: number;
}

export interface TableState {
  phase: Phase;
  point: PointNumber | null;
  /**
   * One player at the table rather than two. Seat B still exists so nothing
   * downstream has to special-case a missing seat; it simply never bets, and
   * the dice never pass to it.
   */
  solo: boolean;
  /** Seat currently holding the dice. */
  shooter: SeatId;
  /** Seat whose chip rack the UI is currently driving. */
  activeSeat: SeatId;
  seats: Record<SeatId, Seat>;
  bets: Bet[];
  rules: TableRules;
  /** Monotonic counter used for the ledger. */
  rollCount: number;
  /**
   * Source of bet ids. It lives on the table rather than in a module counter so
   * that a session restored from storage keeps issuing ids that cannot collide
   * with the ones its existing bets already hold.
   */
  betSeq: number;
  /** Rolls since the current shooter took the dice. */
  shooterRollCount: number;
  /**
   * Distinct points the current shooter has made. Resets on a seven-out, which
   * is also when the Fire Bet pays.
   */
  firePoints: PointNumber[];
  /** Box numbers hit since the last seven, for All/Tall/Small. */
  atsHits: number[];
  /**
   * The most recent rolls, newest last. Capped at {@link HISTORY_LIMIT} so a
   * marathon session cannot turn every roll into an ever-larger array copy.
   * Anything that needs all-time figures reads {@link SessionStats} instead.
   */
  history: RollRecord[];
  stats: SessionStats;
}

/** Running totals that survive beyond the history window. */
export interface SessionStats {
  rolls: number;
  /** Counts indexed by dice total; slots 0 and 1 are unused. */
  totals: number[];
  /** How often each hardway number came up the hard way. */
  hardCounts: Record<4 | 6 | 8 | 10, number>;
  pointsMade: number;
  sevenOuts: number;
  naturals: number;
  crapsRolls: number;
  /** Rolls in the current shooter's hand, and the best hand of the session. */
  currentHand: number;
  longestHand: number;
}

export function emptyStats(): SessionStats {
  return {
    rolls: 0,
    totals: new Array(13).fill(0),
    hardCounts: { 4: 0, 6: 0, 8: 0, 10: 0 },
    pointsMade: 0,
    sevenOuts: 0,
    naturals: 0,
    crapsRolls: 0,
    currentHand: 0,
    longestHand: 0,
  };
}

export interface RollRecord {
  index: number;
  roll: Roll;
  phaseBefore: Phase;
  pointBefore: PointNumber | null;
  phaseAfter: Phase;
  pointAfter: PointNumber | null;
  shooter: SeatId;
  /** Net dollar swing per seat for this roll. */
  net: Record<SeatId, number>;
  outcome: RollOutcome;
}

export type RollOutcome =
  | 'NATURAL'
  | 'CRAPS'
  | 'POINT_ESTABLISHED'
  | 'POINT_MADE'
  | 'SEVEN_OUT'
  | 'NEUTRAL';

/* ------------------------------------------------------------------ *
 * Settlement events — what the UI animates
 * ------------------------------------------------------------------ */

export type SettlementType =
  | 'WIN'
  | 'LOSE'
  | 'PUSH'
  | 'RETURN'
  | 'MOVE'
  | 'VIG';

/** Enough of a bet to find its spot on the felt after the bet itself is gone. */
export interface BetLocation {
  kind: BetKind;
  number?: PointNumber | 6 | 8;
  prop?: PropKind;
  hop?: [DieFace, DieFace];
  ats?: AtsKind;
}

export interface Settlement {
  type: SettlementType;
  seat: SeatId;
  betId: string;
  /**
   * Where the bet was sitting. Carried on the settlement because by the time
   * the UI animates a loss the bet has already been swept off the table.
   */
  at: BetLocation;
  /** Human label, e.g. "Place 8" or "Pass Line Odds". */
  label: string;
  /** Amount returned to the bankroll (stake + winnings for a WIN). */
  credit: number;
  /** Amount removed from the table (the losing stake). */
  debit: number;
  /** Net swing for the ledger: credit - originalStakeAtRisk. */
  net: number;
}
