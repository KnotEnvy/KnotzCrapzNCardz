/**
 * Poker hands.
 *
 * Two evaluators, because the game reads cards two different ways. The Ante,
 * the Play, the Pair Plus and the Ante Bonus all read the *three* cards a
 * player is dealt, ranked by Three Card Poker's own order. The 6 Card Bonus
 * reads the best *five*-card hand in the player's three and the dealer's three
 * together, ranked the ordinary way.
 *
 * Both are pure functions over card arrays. The one design decision worth
 * knowing is that a three-card hand evaluates to a single integer `score`
 * that orders every hand in the game: a higher score beats a lower one and an
 * equal score ties. The whole of the showdown is then `>`, the dealer's
 * qualifier is one comparison against a constant, and the Q-6-4 strategy line
 * is another — which is also what lets `analysis.ts` compare hundreds of
 * millions of hands in a few seconds.
 */

import type { Card, HandCategory, SixCardCategory } from './types';
import { rankLabel, rankName } from './types';

/* ------------------------------------------------------------------ *
 * Three cards
 * ------------------------------------------------------------------ */

export interface ThreeCardHand {
  category: HandCategory;
  /**
   * Orders every three-card hand. Higher wins, equal ties.
   *
   * The category is the high part (`category * 4096`) and the ranks that break
   * a tie within it are packed below, four bits each: high card first. Suits
   * never break a tie — the rule sheet says all suits rank equally, and two
   * hands identical in rank push.
   */
  score: number;
  /**
   * The ranks in the order they are compared, for naming the hand. For a pair
   * that is the pair and then the kicker; for a straight, its top card — which
   * for ace-two-three is the three, because that is the lowest straight.
   */
  ranks: readonly number[];
  /** Ace-king-queen of one suit. Some Pair Plus tables pay it on its own line. */
  miniRoyal: boolean;
}

/** Category values, lowest first. The score is built on these. */
const CATEGORY_VALUE: Record<HandCategory, number> = {
  HIGH_CARD: 0,
  PAIR: 1,
  FLUSH: 2,
  STRAIGHT: 3,
  TRIPS: 4,
  STRAIGHT_FLUSH: 5,
};

const pack = (category: HandCategory, a: number, b = 0, c = 0) =>
  CATEGORY_VALUE[category] * 4096 + (a << 8) + (b << 4) + c;

/**
 * Score three cards.
 *
 * The ace plays high everywhere except the one straight it can only make low:
 * ace-two-three. That straight ranks *below* two-three-four — the regulator's
 * rule sheet says so in as many words ("ace, 2, 3 is the lowest ranked
 * straight") — so it is scored with the three as its top card rather than the
 * ace. Scoring it as ace-high would make it the second-best straight in the
 * game, and it would win showdowns it loses at a real table.
 */
export function evaluate3(cards: readonly Card[]): ThreeCardHand {
  if (cards.length !== 3) {
    // Not reachable from the engine, which deals in threes. A restored session
    // with a damaged hand would otherwise throw during render; this keeps the
    // felt up and makes the hand lose to everything.
    return { category: 'HIGH_CARD', score: -1, ranks: [], miniRoyal: false };
  }

  const r = [cards[0].rank, cards[1].rank, cards[2].rank].sort((x, y) => y - x);
  const flush = cards[0].suit === cards[1].suit && cards[1].suit === cards[2].suit;

  if (r[0] === r[2]) {
    return { category: 'TRIPS', score: pack('TRIPS', r[0]), ranks: [r[0]], miniRoyal: false };
  }

  if (r[0] === r[1] || r[1] === r[2]) {
    // Sorted, the middle card is always one of the pair.
    const pair = r[1];
    const kicker = r[0] === r[1] ? r[2] : r[0];
    return { category: 'PAIR', score: pack('PAIR', pair, kicker), ranks: [pair, kicker], miniRoyal: false };
  }

  let straightTop = 0;
  if (r[0] - r[1] === 1 && r[1] - r[2] === 1) straightTop = r[0];
  else if (r[0] === 14 && r[1] === 3 && r[2] === 2) straightTop = 3;

  if (straightTop && flush) {
    return {
      category: 'STRAIGHT_FLUSH',
      score: pack('STRAIGHT_FLUSH', straightTop),
      ranks: [straightTop],
      miniRoyal: straightTop === 14,
    };
  }
  if (straightTop) {
    return { category: 'STRAIGHT', score: pack('STRAIGHT', straightTop), ranks: [straightTop], miniRoyal: false };
  }
  if (flush) {
    return { category: 'FLUSH', score: pack('FLUSH', r[0], r[1], r[2]), ranks: r, miniRoyal: false };
  }
  return { category: 'HIGH_CARD', score: pack('HIGH_CARD', r[0], r[1], r[2]), ranks: r, miniRoyal: false };
}

/**
 * The dealer's qualifier: queen high or better.
 *
 * Every hand above high card qualifies, and a high-card hand qualifies when its
 * top card is a queen or better. The weakest qualifying hand is Q-3-2, whose
 * score is exactly `12 << 8` plus a little — so "at least a queen in the top
 * four bits of a high-card score" is the whole rule.
 */
export const QUALIFYING_SCORE = 12 << 8;

export function qualifies(hand: ThreeCardHand): boolean {
  return hand.score >= QUALIFYING_SCORE;
}

/**
 * The line every strategy card prints: play queen-six-four or better.
 *
 * Kept as a score rather than a rule so it can be compared against the exact
 * answer in `strategy.ts`, which knows which side of it each individual hand
 * actually falls on once its suits and the cards it removes from the deck are
 * taken into account.
 */
export const Q64_SCORE = pack('HIGH_CARD', 12, 6, 4);

/** Two hands at showdown. Positive when `a` wins. */
export function compare(a: ThreeCardHand, b: ThreeCardHand): number {
  return a.score - b.score;
}

export const CATEGORY_LABEL: Record<HandCategory, string> = {
  STRAIGHT_FLUSH: 'Straight flush',
  TRIPS: 'Three of a kind',
  STRAIGHT: 'Straight',
  FLUSH: 'Flush',
  PAIR: 'Pair',
  HIGH_CARD: 'High card',
};

/**
 * What a dealer calls the hand: "Pair of sevens", "Queen-six-four".
 *
 * High-card hands are named by all three ranks because that is how the game
 * is played — Q-6-4 plays and Q-6-3 does not, and a label that said only
 * "queen high" would hide the one fact the decision turns on.
 */
export function handName(hand: ThreeCardHand): string {
  const [a, b, c] = hand.ranks;
  switch (hand.category) {
    case 'STRAIGHT_FLUSH':
      return hand.miniRoyal ? 'Mini royal' : `Straight flush, ${rankName(a)} high`;
    case 'TRIPS':
      return `Three ${rankName(a, true)}`;
    case 'STRAIGHT':
      return `Straight, ${rankName(a)} high`;
    case 'FLUSH':
      return `Flush, ${rankLabel(a)}-${rankLabel(b)}-${rankLabel(c)}`;
    case 'PAIR':
      return `Pair of ${rankName(a, true)}`;
    case 'HIGH_CARD':
      return hand.ranks.length === 3 ? `${rankLabel(a)}-${rankLabel(b)}-${rankLabel(c)} high` : 'No hand';
  }
}

/* ------------------------------------------------------------------ *
 * Six cards
 * ------------------------------------------------------------------ */

/** Bits 10 through 14: ten, jack, queen, king, ace. */
const ROYAL_MASK = 0b111110000000000;

/**
 * Is there a five-card run in this set of ranks?
 *
 * `mask` has bit `r` set for every rank present. The ace is copied down to bit
 * one first, so ace-two-three-four-five is found as the run from one to five.
 */
function hasStraight(mask: number): boolean {
  const m = mask & (1 << 14) ? mask | 0b10 : mask;
  for (let top = 14; top >= 5; top--) {
    if (((m >> (top - 4)) & 0b11111) === 0b11111) return true;
  }
  return false;
}

/**
 * Scratch space for {@link bestFive}.
 *
 * Module-level and reused, because the function is called twenty million times
 * in a row by the enumeration that proves the 6 Card Bonus figures, and three
 * fresh arrays per call was most of its cost. JavaScript runs one call at a
 * time, so sharing them is safe; nothing here yields between filling them and
 * reading them.
 */
const rankCounts = new Uint8Array(15);
const suitMasks = new Int32Array(4);
const suitCounts = new Uint8Array(4);

/**
 * The best five-card hand in five, six or seven cards.
 *
 * Only the category, because the 6 Card Bonus pays on nothing finer. Written
 * without sorting or choosing subsets — rank counts, suit counts and one rank
 * mask per suit answer every question — because the enumeration runs it over
 * all 20,358,520 six-card sets and a subset-picking evaluator is six times the
 * work for the same answer.
 *
 * The precedence is the ordinary poker one. A few of these cannot coexist in
 * six cards from one deck (four of a kind leaves no room for a flush), but the
 * checks are written in rank order anyway so the function stays right for
 * seven.
 */
export function bestFive(cards: readonly Card[]): SixCardCategory {
  rankCounts.fill(0);
  suitMasks.fill(0);
  suitCounts.fill(0);
  let mask = 0;

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    rankCounts[card.rank]++;
    mask |= 1 << card.rank;
    // By name, never by id: a card built by hand in a test can carry any id.
    const s = SUIT_SLOT[card.suit];
    suitMasks[s] |= 1 << card.rank;
    suitCounts[s]++;
  }

  let flushMask = 0;
  for (let s = 0; s < 4; s++) if (suitCounts[s] >= 5) flushMask = suitMasks[s];

  if (flushMask) {
    if ((flushMask & ROYAL_MASK) === ROYAL_MASK) return 'ROYAL_FLUSH';
    if (hasStraight(flushMask)) return 'STRAIGHT_FLUSH';
  }

  let trips = 0;
  let pairs = 0;
  for (let r = 2; r <= 14; r++) {
    if (rankCounts[r] >= 4) return 'FOUR_OF_A_KIND';
    if (rankCounts[r] === 3) trips++;
    else if (rankCounts[r] === 2) pairs++;
  }

  // Two sets of trips in six cards is a full house: three of one, two of the other.
  if (trips >= 2 || (trips >= 1 && pairs >= 1)) return 'FULL_HOUSE';
  if (flushMask) return 'FLUSH';
  if (hasStraight(mask)) return 'STRAIGHT';
  if (trips) return 'THREE_OF_A_KIND';
  if (pairs >= 2) return 'TWO_PAIR';
  if (pairs === 1) return 'PAIR';
  return 'HIGH_CARD';
}

/** Suit slots for the per-suit masks above. */
const SUIT_SLOT: Record<Card['suit'], number> = { clubs: 0, diamonds: 1, hearts: 2, spades: 3 };

export const SIX_CARD_LABEL: Record<SixCardCategory, string> = {
  ROYAL_FLUSH: 'Royal flush',
  STRAIGHT_FLUSH: 'Straight flush',
  FOUR_OF_A_KIND: 'Four of a kind',
  FULL_HOUSE: 'Full house',
  FLUSH: 'Flush',
  STRAIGHT: 'Straight',
  THREE_OF_A_KIND: 'Three of a kind',
  TWO_PAIR: 'Two pair',
  PAIR: 'Pair',
  HIGH_CARD: 'High card',
};
