/**
 * The vocabulary of a blackjack table.
 *
 * Plain data only — no React, no clock, no randomness. Every type here is
 * serialisable, which is what lets a whole session persist to localStorage,
 * replay from a seed, and be asserted against in a test without a browser.
 *
 * One convention runs through the whole engine: **money is integer cents**.
 * A three-to-two blackjack on a five dollar bet pays seven fifty, and a
 * half-chip is a real amount at a real table; floating point dollars would
 * accumulate a rounding error over the hundred thousand hands the simulation
 * suite deals. Cents make every payout exact. `fmt()` in `money.ts` is the
 * only thing that turns them back into a dollar sign.
 */

/* ------------------------------------------------------------------ *
 * Cards
 * ------------------------------------------------------------------ */

/**
 * Ranks are numbered rather than named because the card art is:
 * `cardArt/14_of_spades.png` is the ace. 11/12/13 are the jack, queen and
 * king, and 14 is the ace — which is also the only rank whose *value* is not
 * derivable by clamping, hence {@link RANK_VALUE}.
 */
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export const RANKS: readonly Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

export type Suit = 'clubs' | 'diamonds' | 'hearts' | 'spades';

export const SUITS: readonly Suit[] = ['clubs', 'diamonds', 'hearts', 'spades'];

export interface Card {
  rank: Rank;
  suit: Suit;
  /**
   * Position in the shoe as dealt, unique for the life of a shoe. React keys
   * off it, the count reads it to know what it has already seen, and two
   * identical cards from different decks stay distinguishable.
   */
  id: number;
}

/** The hard value of a rank. An ace is eleven here and softened later. */
export function rankValue(rank: Rank): number {
  if (rank >= 10 && rank <= 13) return 10;
  if (rank === 14) return 11;
  return rank;
}

export function isAce(card: Card): boolean {
  return card.rank === 14;
}

export function isTen(card: Card): boolean {
  return card.rank >= 10 && card.rank <= 13;
}

export function isRed(card: Card): boolean {
  return card.suit === 'hearts' || card.suit === 'diamonds';
}

/** 'A', 'K', 'Q', 'J', '10', '9'… — what goes on a chart, a log, a label. */
export function rankLabel(rank: Rank): string {
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
 * House rules
 * ------------------------------------------------------------------ */

/**
 * Which pairs of cards may be doubled.
 *
 * `ANY2` is the liberal rule; `9-11` and `10-11` are how a house claws back
 * a tenth of a percent without anybody at the table noticing. The distinction
 * is on the *hard total* — soft doubling is governed by {@link TableRules.doubleSoft}.
 */
export type DoubleRule = 'ANY2' | '9-11' | '10-11';

/**
 * Surrender.
 *
 * `LATE` is the ordinary one: you may fold half your bet after the dealer has
 * checked for blackjack, so a dealer natural takes the whole bet first.
 * `EARLY` lets you fold *before* the check, which is worth about 0.6% and is
 * why almost no casino offers it any more.
 */
export type SurrenderRule = 'NONE' | 'LATE' | 'EARLY';

/**
 * What happens to the dealer's second card.
 *
 * `PEEK` is the American game: the dealer takes a hole card face down and
 * checks it against a ten or an ace immediately, so a player never loses a
 * double or a split to a blackjack that was already there.
 *
 * `ENHC` — European no hole card — deals the dealer exactly one card and draws
 * the second after the players are finished. A dealer blackjack then takes
 * every doubled and split chip on the table, which costs the player about
 * 0.11%. It is not a cosmetic difference and the resolver treats it as its own
 * path.
 */
export type HoleCardRule = 'PEEK' | 'ENHC';

/** 3:2 is the real game. 6:5 is the one that tripled the house edge. */
export type BlackjackPayout = '3:2' | '6:5' | '2:1' | '1:1';

export interface TableRules {
  /** Decks in the shoe. 1, 2, 4, 6 or 8 in practice. */
  decks: number;
  /**
   * Fraction of the shoe dealt before the cut card ends the round — 0.75 means
   * three quarters. Deep penetration is what makes counting worth anything,
   * which is exactly why a modern shoe game cuts off a third.
   */
  penetration: number;
  /** Does the dealer draw to a soft seventeen? Worth about 0.22% to the house. */
  hitsSoft17: boolean;
  blackjackPays: BlackjackPayout;
  double: DoubleRule;
  /** May a soft total be doubled at all? */
  doubleSoft: boolean;
  /** Double after split. Worth about 0.14% to the player. */
  das: boolean;
  /**
   * How many times a pair may be split, counted as *extra* hands.
   * 3 is the usual "split to four hands".
   */
  resplitTo: number;
  /** May split aces be split again? Almost never allowed. */
  resplitAces: boolean;
  /**
   * Split aces normally receive exactly one card each and cannot be hit.
   * Turning this off is a rare and very generous rule.
   */
  oneCardOnSplitAces: boolean;
  /**
   * Does 21 on a split hand count as a natural? It does not, anywhere, and the
   * flag exists so the engine states that rather than assuming it.
   */
  splitAcesBlackjack: boolean;
  surrender: SurrenderRule;
  holeCard: HoleCardRule;
  /** Insurance offered on a dealer ace, at 2:1. */
  insurance: boolean;
  /** Table minimum and maximum for the main wager, in cents. */
  minBet: number;
  maxBet: number;
  /** Which optional side bets this table books. */
  sideBets: Record<SideBetKind, boolean>;
}

/* ------------------------------------------------------------------ *
 * Side bets
 * ------------------------------------------------------------------ */

export type SideBetKind =
  | 'PERFECT_PAIRS'
  | 'TWENTY_ONE_PLUS_THREE'
  | 'LUCKY_LADIES'
  | 'ROYAL_MATCH'
  | 'BUST_IT'
  | 'SUPER_SEVENS';

export const SIDE_BET_KINDS: readonly SideBetKind[] = [
  'PERFECT_PAIRS',
  'TWENTY_ONE_PLUS_THREE',
  'LUCKY_LADIES',
  'ROYAL_MATCH',
  'BUST_IT',
  'SUPER_SEVENS',
];

/* ------------------------------------------------------------------ *
 * Hands
 * ------------------------------------------------------------------ */

/**
 * What a hand is allowed to do next, and why not when it cannot.
 *
 * The UI reads this rather than re-deriving legality, which is the only way
 * the buttons and the engine cannot disagree.
 */
export type Action = 'HIT' | 'STAND' | 'DOUBLE' | 'SPLIT' | 'SURRENDER';

export const ACTIONS: readonly Action[] = ['HIT', 'STAND', 'DOUBLE', 'SPLIT', 'SURRENDER'];

/** How a hand stopped playing. `null` while it is still live. */
export type HandOutcome = 'BLACKJACK' | 'WIN' | 'PUSH' | 'LOSE' | 'BUST' | 'SURRENDER';

export interface Hand {
  id: string;
  cards: Card[];
  /** The chips on this hand, in cents. A double moves this to twice the base. */
  bet: number;
  /** The base wager before any double, kept so a surrender can refund half of it. */
  baseBet: number;
  /** How many splits deep this hand is. The first hand of a round is 0. */
  splitDepth: number;
  /** True for a hand created by splitting aces — it plays one card and stops. */
  fromSplitAces: boolean;
  /** True once the hand may take no further action. */
  done: boolean;
  doubled: boolean;
  surrendered: boolean;
  outcome: HandOutcome | null;
  /** Signed cents this hand returned, net of its stake. Filled at settlement. */
  net: number;
}

/* ------------------------------------------------------------------ *
 * Seats
 * ------------------------------------------------------------------ */

export type SeatId = 'A' | 'B' | 'C';

export const SEAT_IDS: readonly SeatId[] = ['A', 'B', 'C'];

export interface SideBetWager {
  kind: SideBetKind;
  amount: number;
  /** Signed cents returned. Filled the moment the side bet resolves, before play. */
  net: number | null;
  /** The winning combination's name, for the log and the felt. */
  label: string | null;
  /**
   * Cents this bet still stands to win if the dealer turns a natural.
   *
   * Only Lucky Ladies uses it, and only for its top line: two queens of hearts
   * pays 200:1 on its own and 1000:1 against a dealer blackjack, and at the
   * moment the bet is graded the dealer's hand is face down (or, under ENHC,
   * not dealt). The difference is recorded here and paid at settlement.
   *
   * It is recorded rather than recomputed because by settlement the cards it
   * was graded on may no longer be in the hand — a split moves the second
   * queen to a new hand, and re-reading `hands[0]` then finds a queen and
   * whatever was drawn to it. That is exactly the bug this field exists to
   * make impossible.
   */
  jackpot: number | null;
  /**
   * The bonus card Super Sevens draws when the first two cards are both
   * sevens.
   *
   * It is a real card off the real shoe and it decides the difference between
   * 50:1 and 5000:1, so the felt shows it. It is kept here rather than
   * discarded because a card that leaves the shoe and is never seen is a card
   * the counting trainer would be counting behind the player's back.
   */
  bonus: Card | null;
}

export interface Seat {
  id: SeatId;
  /** Seated players only. An empty box takes no cards. */
  occupied: boolean;
  name: string;
  bankroll: number;
  /** The wager in the betting circle before the deal. */
  pendingBet: number;
  pendingSideBets: SideBetWager[];
  /** One hand normally, more after a split. Played left to right. */
  hands: Hand[];
  /** Cents wagered on insurance this round, or 0. */
  insurance: number;
  insuranceNet: number | null;
  /** Set when the player took even money on a natural against an ace. */
  tookEvenMoney: boolean;
  /** Cumulative, across the session. */
  stats: SeatStats;
}

export interface SeatStats {
  handsPlayed: number;
  wins: number;
  losses: number;
  pushes: number;
  blackjacks: number;
  busts: number;
  surrenders: number;
  doubles: number;
  splits: number;
  /** Total main-bet cents wagered, the denominator of the measured edge. */
  wagered: number;
  /** Total side-bet cents wagered, kept separate — its edge is a different animal. */
  sideWagered: number;
  /**
   * Signed cents, split by which bet they came from.
   *
   * `net` is the whole session and is what the bankroll reflects. The other
   * two are subsets of it, and they exist because a panel showing only the
   * total cannot answer the question a player actually has after a hand that
   * lost the wager and hit a side bet: where did the money go. They are also
   * the honest way to show that the side bets are the losing half of a
   * winning night, which is usually what they are.
   */
  sideNet: number;
  insuranceNet: number;
  net: number;
  peakBankroll: number;
  /** Basic-strategy decisions made, and how many matched the chart. */
  decisions: number;
  correctDecisions: number;
}

/* ------------------------------------------------------------------ *
 * Table
 * ------------------------------------------------------------------ */

/**
 * The round's phase. The whole UI is a function of this, and every legal-move
 * function in `table.ts` refuses outright in the wrong one.
 *
 *   BETTING     chips go in the circles
 *   DEALING     cards are coming out; nothing is legal
 *   INSURANCE   dealer shows an ace and the offer is open
 *   PLAYER      one hand at a time, in seat then split order
 *   DEALER      the dealer plays out their hand
 *   SETTLE      money has moved; the felt is showing what happened
 */
export type Phase = 'BETTING' | 'DEALING' | 'INSURANCE' | 'PLAYER' | 'DEALER' | 'SETTLE';

/** Which hand is live, as a pair of indices into `seats` and that seat's `hands`. */
export interface Focus {
  seat: SeatId;
  hand: number;
}

export interface DealerHand {
  cards: Card[];
  /** The hole card stays face down until the dealer's turn — or a peek reveals it. */
  holeDown: boolean;
  outcome: 'BLACKJACK' | 'BUST' | 'STAND' | null;
}

/**
 * The shoe.
 *
 * A fixed array of cards plus a pointer to the next one, rather than a queue
 * that is shifted. That is not a micro-optimisation: the engine is immutable,
 * so a shifted queue means copying the tail of a 416-card array on every card
 * dealt, and the simulation deals several million. With a pointer, dealing a
 * card is `pos + 1` and the array is never touched after the shuffle.
 *
 * Everything before `pos` is the discard tray. Nothing may read past it — the
 * counting trainer takes the tray and only the tray, and that boundary is the
 * whole reason it is honest.
 */
export interface ShoeState {
  /** Every card in the shoe, in the order they will come out. Never mutated. */
  cards: Card[];
  /** How many have been dealt. `cards[pos]` is next; `cards[0..pos)` is the tray. */
  pos: number;
  /** How many were in the shoe when it was shuffled. */
  size: number;
  /**
   * Index at which the cut card sits. Once `pos` reaches it, the shoe is
   * reshuffled after the current round finishes.
   */
  cutAt: number;
  /** Set when the cut card comes out mid-round. */
  cutReached: boolean;
  /** Increments on every shuffle, so React can key a whole new shoe. */
  shuffleId: number;
}

export interface TableState {
  rules: TableRules;
  shoe: ShoeState;
  seats: Seat[];
  dealer: DealerHand;
  phase: Phase;
  focus: Focus | null;
  /** Rounds dealt since the session began. */
  round: number;
  /**
   * True once {@link settle} has paid this round.
   *
   * The UI drives settlement off a phase transition, and a transition can fire
   * twice — a re-render, a fast-forward landing on the same frame, a replayed
   * animation. Paying twice would be silent and would look like a lucky night.
   * The flag makes the second call a no-op.
   */
  settled: boolean;
  /** Newest first, capped. What the felt's log shows. */
  history: RoundRecord[];
}

/* ------------------------------------------------------------------ *
 * Records
 * ------------------------------------------------------------------ */

/** One settled hand, for the log and the charts. */
export interface HandRecord {
  seat: SeatId;
  handIndex: number;
  cards: string;
  total: number;
  bet: number;
  outcome: HandOutcome;
  net: number;
}

export interface RoundRecord {
  round: number;
  dealerCards: string;
  dealerTotal: number;
  dealerOutcome: 'BLACKJACK' | 'BUST' | 'STAND';
  hands: HandRecord[];
  sideBets: Array<{ seat: SeatId; kind: SideBetKind; amount: number; net: number; label: string | null }>;
  insurance: Array<{ seat: SeatId; amount: number; net: number }>;
  /** Signed cents across the whole table. */
  net: number;
  /** The Hi-Lo true count as the round was dealt, for the counting trainer. */
  trueCount: number;
}

/**
 * A single money movement, handed to the UI so it can animate the right chips
 * to and from the right place. The engine never animates; it says what moved.
 */
export interface Settlement {
  seat: SeatId;
  handIndex: number | null;
  kind: 'MAIN' | 'INSURANCE' | 'SIDE';
  sideKind?: SideBetKind;
  /** Signed cents. */
  net: number;
  label: string;
}
