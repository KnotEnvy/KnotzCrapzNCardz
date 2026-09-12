/**
 * The vocabulary of a Three Card Poker table.
 *
 * Plain data only — no React, no clock, no randomness. Every type here is
 * serialisable, which is what lets a whole session persist to localStorage,
 * replay from a seed, and be asserted against in a test without a browser.
 *
 * One convention runs through the whole engine: **money is integer cents**.
 * See `money.ts` for why, and `fmt()` there for the only thing that turns
 * cents back into a dollar sign.
 */

/* ------------------------------------------------------------------ *
 * Cards
 * ------------------------------------------------------------------ */

/**
 * Ranks are numbered rather than named because the card art is:
 * `cardArt/14_of_spades.png` is the ace. 11/12/13 are the jack, queen and
 * king. Numbering them also makes every poker comparison an integer
 * comparison, which is what `poker.ts` is built on.
 */
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export const RANKS: readonly Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

export type Suit = 'clubs' | 'diamonds' | 'hearts' | 'spades';

export const SUITS: readonly Suit[] = ['clubs', 'diamonds', 'hearts', 'spades'];

export interface Card {
  rank: Rank;
  suit: Suit;
  /**
   * The card's identity in the deck, 0..51 — see {@link cardIndex}.
   *
   * Three Card Poker deals from a single deck, so no two cards on the felt can
   * ever share an id. The exact enumerations in `analysis.ts` lean on that:
   * "which cards are left for the dealer" is a 52-bit mask built from these.
   */
  id: number;
}

/** A card's position in a fresh deck: clubs 2..A, then diamonds, hearts, spades. */
export function cardIndex(rank: Rank, suit: Suit): number {
  return SUITS.indexOf(suit) * 13 + (rank - 2);
}

export function cardFromIndex(index: number): Card {
  const suit = SUITS[Math.floor(index / 13)];
  const rank = ((index % 13) + 2) as Rank;
  return { rank, suit, id: index };
}

export function isRed(card: Card): boolean {
  return card.suit === 'hearts' || card.suit === 'diamonds';
}

/** 'A', 'K', 'Q', 'J', '10', '9'… — what goes on a log or a label. */
export function rankLabel(rank: number): string {
  switch (rank) {
    case 11:
      return 'J';
    case 12:
      return 'Q';
    case 13:
      return 'K';
    case 14:
      return 'A';
    default:
      return String(rank);
  }
}

const RANK_NAMES: Record<number, [string, string]> = {
  2: ['two', 'twos'],
  3: ['three', 'threes'],
  4: ['four', 'fours'],
  5: ['five', 'fives'],
  6: ['six', 'sixes'],
  7: ['seven', 'sevens'],
  8: ['eight', 'eights'],
  9: ['nine', 'nines'],
  10: ['ten', 'tens'],
  11: ['jack', 'jacks'],
  12: ['queen', 'queens'],
  13: ['king', 'kings'],
  14: ['ace', 'aces'],
};

/** 'queen', or 'queens' — what a dealer says when naming a hand. */
export function rankName(rank: number, plural = false): string {
  return RANK_NAMES[rank]?.[plural ? 1 : 0] ?? String(rank);
}

export const SUIT_GLYPH: Record<Suit, string> = {
  clubs: '♣',
  diamonds: '♦',
  hearts: '♥',
  spades: '♠',
};

export function cardLabel(card: Card): string {
  return `${rankLabel(card.rank)}${SUIT_GLYPH[card.suit]}`;
}

/* ------------------------------------------------------------------ *
 * Hands
 * ------------------------------------------------------------------ */

/**
 * The six three-card hands, best first.
 *
 * The order is not the five-card order and it is not a typo: with three cards
 * a straight is *rarer* than a flush (720 hands against 1,096 out of 22,100),
 * so it ranks above it, and three of a kind — 52 hands — ranks above both.
 */
export type HandCategory = 'STRAIGHT_FLUSH' | 'TRIPS' | 'STRAIGHT' | 'FLUSH' | 'PAIR' | 'HIGH_CARD';

export const HAND_CATEGORIES: readonly HandCategory[] = [
  'STRAIGHT_FLUSH',
  'TRIPS',
  'STRAIGHT',
  'FLUSH',
  'PAIR',
  'HIGH_CARD',
];

/**
 * The best five-card poker hand in six cards: the player's three and the
 * dealer's three. Only the 6 Card Bonus reads it, and only the top seven pay;
 * the bottom three are named so the felt can say what the six cards made.
 */
export type SixCardCategory =
  | 'ROYAL_FLUSH'
  | 'STRAIGHT_FLUSH'
  | 'FOUR_OF_A_KIND'
  | 'FULL_HOUSE'
  | 'FLUSH'
  | 'STRAIGHT'
  | 'THREE_OF_A_KIND'
  | 'TWO_PAIR'
  | 'PAIR'
  | 'HIGH_CARD';

export const SIX_CARD_CATEGORIES: readonly SixCardCategory[] = [
  'ROYAL_FLUSH',
  'STRAIGHT_FLUSH',
  'FOUR_OF_A_KIND',
  'FULL_HOUSE',
  'FLUSH',
  'STRAIGHT',
  'THREE_OF_A_KIND',
  'TWO_PAIR',
  'PAIR',
  'HIGH_CARD',
];

/* ------------------------------------------------------------------ *
 * House rules
 * ------------------------------------------------------------------ */

/**
 * What a table posts.
 *
 * Three Card Poker has one set of playing rules — the regulator's rule sheet
 * and every casino's rack card agree on all of them — and a *choice of
 * paytables*. That choice is where the price of the game is decided: the same
 * three cards cost 2.3% on one Pair Plus table and 7.3% on the next one down
 * the aisle. So the paytables are the rules here, the way decks and soft 17
 * are at the blackjack table.
 *
 * The ids are the pays themselves (`'40-30-6-3-1'`), which makes a persisted
 * rule set readable and means an id cannot quietly describe a different table
 * after an edit. `paytables.ts` resolves them, and falls back to the default
 * for an id it does not know rather than crashing a restored session.
 */
export interface TableRules {
  pairPlusTable: string;
  anteBonusTable: string;
  sixCardTable: string;
  /** Does the table book Pair Plus at all? */
  pairPlus: boolean;
  /** Does the table book the 6 Card Bonus at all? */
  sixCard: boolean;
  /** Ante limits, in cents. The Play wager always equals the Ante. */
  minBet: number;
  maxBet: number;
  /** Side-bet maximums. Their minimum is the table minimum. */
  maxPairPlus: number;
  maxSixCard: number;
}

/* ------------------------------------------------------------------ *
 * Seats
 * ------------------------------------------------------------------ */

export type SeatId = 'A' | 'B' | 'C';

export const SEAT_IDS: readonly SeatId[] = ['A', 'B', 'C'];

/** The three spots a player can put chips on before the deal. */
export type SpotKind = 'ANTE' | 'PAIR_PLUS' | 'SIX_CARD';

export const SPOT_KINDS: readonly SpotKind[] = ['PAIR_PLUS', 'ANTE', 'SIX_CARD'];

export interface Wagers {
  ante: number;
  pairPlus: number;
  sixCard: number;
}

/** Which field of {@link Wagers} a spot's chips live in. */
export const SPOT_KEY: Record<SpotKind, keyof Wagers> = {
  ANTE: 'ante',
  PAIR_PLUS: 'pairPlus',
  SIX_CARD: 'sixCard',
};

/** What a seat with an Ante does once it has looked at its cards. */
export type Decision = 'PLAY' | 'FOLD';

/**
 * How the Ante and Play came out.
 *
 *   WIN         the dealer qualified and the player's hand was higher
 *   NO_QUALIFY  the dealer did not qualify: the Ante wins, the Play pushes
 *   PUSH        the dealer qualified and the hands were identical in rank
 *   LOSE        the dealer qualified and was higher
 *   FOLD        the player gave up the Ante (and any Pair Plus with it)
 */
export type Outcome = 'WIN' | 'NO_QUALIFY' | 'PUSH' | 'LOSE' | 'FOLD';

/** Every figure is signed cents: winnings, zero for a push, minus the stake for a loss. */
export interface SeatResult {
  hand: HandCategory;
  handName: string;
  /** Null when the seat had no Ante, so there was nothing to compare. */
  outcome: Outcome | null;
  ante: number;
  play: number;
  anteBonus: number;
  pairPlus: number;
  sixCard: number;
  /** What the six cards made, when a 6 Card Bonus was riding on them. */
  sixCardHand: SixCardCategory | null;
  net: number;
}

export interface Seat {
  id: SeatId;
  /** Seated players only. An empty seat takes no cards. */
  occupied: boolean;
  name: string;
  bankroll: number;
  /**
   * The chips in the spots before the deal. They stay up after a round, so
   * "same bet" is the default rather than a rebuild.
   */
  bets: Wagers;
  /** This round's three cards, or none when the seat sat the round out. */
  cards: Card[];
  /**
   * What is actually riding this round. Copied from `bets` at the deal, when
   * the chips leave the bankroll; `play` is added by the decision.
   */
  wagers: Wagers & { play: number };
  decision: Decision | null;
  /** Filled at settlement. */
  result: SeatResult | null;
  /** Cumulative, across the session. */
  stats: SeatStats;
}

export interface SeatStats {
  /** Rounds this seat was dealt into. */
  rounds: number;
  /** Rounds with an Ante — the ones that asked for a decision. */
  hands: number;
  plays: number;
  folds: number;
  wins: number;
  noQualify: number;
  pushes: number;
  losses: number;
  /**
   * Cents put on the Ante.
   *
   * This is what Three Card Poker's house edge is quoted against — expected
   * loss per unit *Anted* — and it is the only honest denominator for comparing
   * a session with the 3.37% everyone publishes. See `playWagered`.
   */
  anteStaked: number;
  /**
   * Cents put on Play.
   *
   * Ante plus Play is the total action, and the loss divided by *that* is the
   * element of risk: 2.01% on the same game whose house edge is 3.37%. Both
   * numbers are true and they answer different questions — per hand dealt, and
   * per dollar put at risk — and a panel that prints one under the other's name
   * is wrong by forty percent.
   */
  playWagered: number;
  /** Signed cents on Ante, Play and the Ante Bonus together — the game itself. */
  mainNet: number;
  /** The Ante Bonus's share of `mainNet`, broken out because it is paid regardless of the dealer. */
  anteBonusNet: number;
  pairPlusWagered: number;
  pairPlusNet: number;
  sixCardWagered: number;
  sixCardNet: number;
  /** The whole session: `mainNet + pairPlusNet + sixCardNet`. What the bankroll reflects. */
  net: number;
  peakBankroll: number;
  /** Every hand dealt to this seat, by what it made. */
  categories: Record<HandCategory, number>;
  /** Play-or-fold decisions graded by the trainer, and how many were the better choice. */
  decisions: number;
  correctDecisions: number;
  /**
   * Cents of expected value given up by decisions that were not the better
   * choice. Exact, not estimated — see `strategy.ts` — which is what lets the
   * trainer say what a habit costs rather than merely that it is wrong.
   */
  evGivenUp: number;
}

/* ------------------------------------------------------------------ *
 * Table
 * ------------------------------------------------------------------ */

/**
 * The round's phase. The whole UI is a function of this, and every action in
 * `table.ts` refuses outright in the wrong one.
 *
 *   BETTING   chips go on the spots
 *   DECIDING  one seat at a time looks at its cards and plays or folds
 *   SHOWDOWN  every decision is in; the dealer's hand is still face down
 *   SETTLE    the dealer's hand is up, and `settle` pays the table
 */
export type Phase = 'BETTING' | 'DECIDING' | 'SHOWDOWN' | 'SETTLE';

export interface DealerHand {
  cards: Card[];
  /** Face down until every player has decided. */
  revealed: boolean;
}

export interface TableState {
  rules: TableRules;
  seats: Seat[];
  dealer: DealerHand;
  phase: Phase;
  /** The seat whose decision the table is waiting on, during DECIDING. */
  focus: SeatId | null;
  /** Rounds dealt since the session began. Every round is a fresh shuffle. */
  round: number;
  /**
   * True once {@link settle} has paid this round.
   *
   * The UI drives settlement off a phase transition, and a transition can fire
   * twice. Paying twice would be silent and would look like a lucky night; the
   * flag makes the second call a no-op.
   */
  settled: boolean;
  /** Newest first, capped. What the charts read. */
  history: RoundRecord[];
}

/* ------------------------------------------------------------------ *
 * Records
 * ------------------------------------------------------------------ */

export interface SeatRecord {
  seat: SeatId;
  cards: string;
  hand: HandCategory;
  decision: Decision | null;
  outcome: Outcome | null;
  /** Everything staked this round, Play included. */
  wagered: number;
  mainNet: number;
  pairPlusNet: number;
  sixCardNet: number;
  sixCardHand: SixCardCategory | null;
  net: number;
}

export interface RoundRecord {
  round: number;
  dealerCards: string;
  dealerHand: HandCategory;
  dealerQualified: boolean;
  seats: SeatRecord[];
  /** Signed cents across the whole table. */
  net: number;
}

/**
 * A single money movement, handed to the UI so it can show the right figure
 * on the right spot. The engine never animates; it says what moved, in the
 * order the rule sheet settles it: Ante, Play, Pair Plus, 6 Card Bonus.
 */
export type SettlementKind = 'ANTE' | 'PLAY' | 'ANTE_BONUS' | 'PAIR_PLUS' | 'SIX_CARD';

export interface Settlement {
  seat: SeatId;
  kind: SettlementKind;
  /** Signed cents. */
  net: number;
  label: string;
}
