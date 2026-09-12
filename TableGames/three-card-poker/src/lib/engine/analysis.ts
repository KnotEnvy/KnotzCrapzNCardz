/**
 * The exact figures.
 *
 * Three Card Poker is small enough to be solved outright. One deck, no draws,
 * no shoe: a player holds one of 22,100 hands, the dealer one of the 18,424
 * the remaining 49 cards can make, and every one of those 407,170,400 pairings
 * is equally likely. So no figure this game prints is a simulation, a
 * published number or an estimate. Each is a finite sum.
 *
 * Three things are computed here, and they are what everything else prices
 * itself from:
 *
 *   - **How many hands make each line.** 48 straight flushes in 22,100 three-
 *     card hands, 188 royal flushes in 20,358,520 six-card sets. A paytable's
 *     return is then one weighted sum, so every table in `paytables.ts` is
 *     priced by arithmetic rather than by a hundred-million-hand run.
 *
 *   - **The dealer's hand against any three cards.** For the hand in front of a
 *     player, how many of the dealer's 18,424 possible hands fail to qualify,
 *     lose, tie and win. That is the whole of the play-or-fold decision, and
 *     it is cheap enough — one pass over 22,100 precomputed scores — to run
 *     live for the trainer on every hand dealt.
 *
 *   - **The Ante and Play, played four ways.** The total result of the Ante
 *     and Play across all 407 million pairings under optimal play, under the
 *     Q-6-4 rule, copying the dealer and never folding. Those take a second to
 *     sum, so they are constants here and the test suite re-derives them.
 *
 * The constants are the thing that could go stale, so they are the thing the
 * tests recompute from scratch: `analysis.test.ts` walks every hand and every
 * six-card set and asserts it gets these numbers back. Regenerate by running
 * that test and reading the failure.
 */

import { bestFive, evaluate3, Q64_SCORE, QUALIFYING_SCORE } from './poker';
import {
  anteBonusTable,
  pairPlusTable,
  sixCardTable,
  type AnteBonusHand,
  type PairPlusHand,
  type Paytable,
  type SixCardHand,
} from './paytables';
import type { Card, HandCategory, SixCardCategory } from './types';
import { cardFromIndex, cardIndex, SUITS } from './types';

/* ------------------------------------------------------------------ *
 * Sizes
 * ------------------------------------------------------------------ */

/** Three cards from fifty-two. */
export const THREE_CARD_HANDS = 22_100;
/** Three cards from the forty-nine a player's hand leaves. */
export const DEALER_HANDS = 18_424;
/** Every player hand against every dealer hand it leaves room for. */
export const PAIRINGS = THREE_CARD_HANDS * DEALER_HANDS;
/** Six cards from fifty-two: the player's three and the dealer's three, as one set. */
export const SIX_CARD_SETS = 20_358_520;

/* ------------------------------------------------------------------ *
 * The counts
 * ------------------------------------------------------------------ */

/**
 * How many of the 22,100 three-card hands make each hand.
 *
 * `MINI_ROYAL` is split out of the straight flushes — four of the 48 are
 * ace-king-queen suited — because one Pair Plus table pays it on its own line.
 * `STRAIGHT_FLUSH` here is the other 44.
 */
export const THREE_CARD_COUNTS: Readonly<Record<'MINI_ROYAL' | HandCategory, number>> = {
  MINI_ROYAL: 4,
  STRAIGHT_FLUSH: 44,
  TRIPS: 52,
  STRAIGHT: 720,
  FLUSH: 1_096,
  PAIR: 3_744,
  HIGH_CARD: 16_440,
};

/** How many of the 20,358,520 six-card sets make each best five-card hand. */
export const SIX_CARD_COUNTS: Readonly<Record<SixCardCategory, number>> = {
  ROYAL_FLUSH: 188,
  STRAIGHT_FLUSH: 1_656,
  FOUR_OF_A_KIND: 14_664,
  FULL_HOUSE: 165_984,
  FLUSH: 205_792,
  STRAIGHT: 361_620,
  THREE_OF_A_KIND: 732_160,
  TWO_PAIR: 2_532_816,
  PAIR: 9_730_740,
  HIGH_CARD: 6_612_900,
};

/* ------------------------------------------------------------------ *
 * Strategies
 * ------------------------------------------------------------------ */

/**
 * Four ways to decide whether to play a hand.
 *
 *   OPTIMAL  play whenever it loses less than folding, hand by hand, against
 *            the exact dealer distribution those three cards leave
 *   Q64      the line on every strategy card: queen-six-four or better
 *   MIMIC    play whatever would qualify for the dealer: queen high or better
 *   ALWAYS   never fold
 */
export type StrategyId = 'OPTIMAL' | 'Q64' | 'MIMIC' | 'ALWAYS';

export const STRATEGY_IDS: readonly StrategyId[] = ['OPTIMAL', 'Q64', 'MIMIC', 'ALWAYS'];

export const STRATEGY_LABEL: Record<StrategyId, string> = {
  OPTIMAL: 'Exact, hand by hand',
  Q64: 'Play Q-6-4 or better',
  MIMIC: 'Play what the dealer would',
  ALWAYS: 'Never fold',
};

/**
 * The Ante and Play under each strategy, summed over all 407,170,400 pairings.
 *
 * `net` is in units of the Ante, *without* the Ante Bonus, and is an exact
 * integer: each pairing is worth −1 (fold), −2, 0, +1 or +2. Leaving the
 * bonus out is what makes one constant serve every Ante Bonus table. The
 * bonus is paid only on a straight or better, every strategy here plays every
 * one of those hands, so the bonus adds the same closed-form amount on top of
 * any of them — see {@link antePlayFigures}. The test checks that premise
 * rather than trusting it.
 *
 * `plays` is how many of the 22,100 player hands the strategy plays, which is
 * what the element of risk needs.
 *
 * OPTIMAL and Q64 are the same row, and that is a finding rather than a copy.
 * The strategy card's line was never an approximation: walked hand by hand,
 * with every suit pattern and every card each hand takes out of the deck
 * accounted for, the exact decision and "Q-6-4 or better" agree on all 22,100
 * hands. The test asserts that there are no hands on which they part.
 */
export const ANTE_PLAY_TOTALS: Readonly<Record<StrategyId, { net: number; plays: number }>> = {
  OPTIMAL: { net: -35_253_012, plays: 14_900 },
  Q64: { net: -35_253_012, plays: 14_900 },
  MIMIC: { net: -35_563_032, plays: 15_380 },
  ALWAYS: { net: -52_683_216, plays: 22_100 },
};

/* ------------------------------------------------------------------ *
 * The lookup
 * ------------------------------------------------------------------ */

const choose2 = (n: number) => (n * (n - 1)) / 2;
const choose3 = (n: number) => (n * (n - 1) * (n - 2)) / 6;

/**
 * The position of a three-card set among all 22,100, for cards `a < b < c`.
 *
 * The colex rank: sets ordered by their highest card, then their middle, then
 * their lowest. It is the order the nested loops in {@link lookup} produce, so
 * a set's index is also where its score sits in the table.
 */
export function comboIndex(a: number, b: number, c: number): number {
  return choose3(c) + choose2(b) + a;
}

interface Lookup {
  /** The three-card score of every set, by {@link comboIndex}. */
  score: Int32Array;
  /** Which cards each set holds, as two 26-bit halves of a 52-bit mask. */
  low: Int32Array;
  high: Int32Array;
}

let built: Lookup | null = null;

/**
 * Every three-card set, scored once.
 *
 * Built on first use rather than at import: about ten milliseconds, which is
 * nothing to a test and not nothing to a page that has not needed it yet.
 */
function lookup(): Lookup {
  if (built) return built;
  const score = new Int32Array(THREE_CARD_HANDS);
  const low = new Int32Array(THREE_CARD_HANDS);
  const high = new Int32Array(THREE_CARD_HANDS);
  const deck = Array.from({ length: 52 }, (_, i) => cardFromIndex(i));

  let i = 0;
  for (let c = 2; c < 52; c++) {
    for (let b = 1; b < c; b++) {
      for (let a = 0; a < b; a++) {
        score[i] = evaluate3([deck[a], deck[b], deck[c]]).score;
        const [lo, hi] = maskOf([a, b, c]);
        low[i] = lo;
        high[i] = hi;
        i++;
      }
    }
  }
  built = { score, low, high };
  return built;
}

/** A set of card indices as a 52-bit mask, split across two 32-bit integers. */
function maskOf(indices: readonly number[]): [number, number] {
  let lo = 0;
  let hi = 0;
  for (const i of indices) {
    if (i < 26) lo |= 1 << i;
    else hi |= 1 << (i - 26);
  }
  return [lo, hi];
}

/* ------------------------------------------------------------------ *
 * The dealer against three known cards
 * ------------------------------------------------------------------ */

/**
 * The dealer's possible hands against a player's, sorted by what they mean.
 *
 * `noQualify + win + tie + lose === hands === 18,424`, and "win" and "lose"
 * are the player's: `win` counts qualifying dealer hands the player beats.
 */
export interface DealerOdds {
  hands: number;
  noQualify: number;
  win: number;
  tie: number;
  lose: number;
}

const NO_ODDS: DealerOdds = { hands: 0, noQualify: 0, win: 0, tie: 0, lose: 0 };

/** Answers already worked out, by the player hand's {@link comboIndex}. At most 22,100 of them. */
const oddsCache = new Map<number, DealerOdds>();

/**
 * Walk every hand the dealer could hold, given three cards they cannot.
 *
 * Only the player's own cards are removed. At a real table the other players'
 * hands are out of the deck too, but a player is not entitled to know what
 * they are — sharing them is collusion, and the trainer is not a cheat — so
 * the dealer's hand is drawn from the 49 cards that are unknown *to this
 * player*. That is exactly what the decision is made against.
 *
 * Remembered per hand, because the measurement suite asks the same question
 * about the same few thousand hands a million times over. The cards are read
 * by rank and suit rather than by `id`, so a hand built by hand in a test
 * cannot index the wrong entry.
 */
export function dealerOdds(player: readonly Card[]): DealerOdds {
  const ids = player.map((c) => cardIndex(c.rank, c.suit)).sort((x, y) => x - y);
  if (ids.length !== 3 || ids[0] === ids[1] || ids[1] === ids[2]) return NO_ODDS;
  const key = comboIndex(ids[0], ids[1], ids[2]);
  const cached = oddsCache.get(key);
  if (cached) return cached;

  const { score, low, high } = lookup();
  const [pLo, pHi] = maskOf(ids);
  const mine = score[key];

  let noQualify = 0;
  let win = 0;
  let tie = 0;
  let lose = 0;
  for (let i = 0; i < THREE_CARD_HANDS; i++) {
    if ((low[i] & pLo) !== 0 || (high[i] & pHi) !== 0) continue;
    const s = score[i];
    if (s < QUALIFYING_SCORE) noQualify++;
    else if (s < mine) win++;
    else if (s === mine) tie++;
    else lose++;
  }
  const odds = { hands: noQualify + win + tie + lose, noQualify, win, tie, lose };
  oddsCache.set(key, odds);
  return odds;
}

/**
 * What playing the hand returns on the Ante and Play together, in units of
 * the Ante, not counting the Ante Bonus.
 *
 * A dealer who does not qualify pays the Ante and pushes the Play: +1. A
 * qualifying dealer the player beats pays both: +2. A tie pushes both, and a
 * loss takes both. Folding is −1 whatever the dealer holds, so the hand is
 * worth playing exactly when this is at least −1.
 */
export function playReturn(odds: DealerOdds): number {
  if (odds.hands === 0) return -2;
  return (odds.noQualify + 2 * odds.win - 2 * odds.lose) / odds.hands;
}

/* ------------------------------------------------------------------ *
 * Game figures
 * ------------------------------------------------------------------ */

export interface Figures {
  /** Expected loss per unit staked, in percent. Positive is the house. */
  houseEdge: number;
  /** Expected loss per unit of total action, in percent — for the Ante and Play, the Ante plus the Play. */
  elementOfRisk: number;
}

export interface AntePlayFigures extends Figures {
  /** The share of hands the strategy plays. */
  playRate: number;
}

/**
 * The Ante and Play, with a given Ante Bonus table and strategy.
 *
 * The house edge is per unit *Anted*, which is what every published Three
 * Card Poker figure means, and the element of risk is per unit of Ante plus
 * Play. Under optimal play a hand is played about two times in three, so the
 * total action runs about 1.67 times the Ante and the two figures differ by
 * that factor — 3.37% and 2.01% on the usual table. The game prints both and
 * says which is which.
 */
export function antePlayFigures(anteBonusId: string, strategy: StrategyId = 'OPTIMAL'): AntePlayFigures {
  const totals = ANTE_PLAY_TOTALS[strategy];
  const bonus = anteBonusUnits(anteBonusTable(anteBonusId));
  const perAnte = totals.net / PAIRINGS + bonus / THREE_CARD_HANDS;
  const playRate = totals.plays / THREE_CARD_HANDS;
  return {
    houseEdge: -perAnte * 100,
    elementOfRisk: (-perAnte / (1 + playRate)) * 100,
    playRate,
  };
}

/**
 * The Ante Bonus summed over all 22,100 hands, in units of the Ante.
 *
 * Every hand it pays on is played under every strategy in this file, so this
 * is simply each line's pay times the number of hands that make it.
 */
function anteBonusUnits(table: Paytable<AnteBonusHand>): number {
  let units = 0;
  for (const l of table.lines) {
    const hands =
      l.hand === 'STRAIGHT_FLUSH' ? THREE_CARD_COUNTS.STRAIGHT_FLUSH + THREE_CARD_COUNTS.MINI_ROYAL : THREE_CARD_COUNTS[l.hand];
    units += (hands * l.ratio[0]) / l.ratio[1];
  }
  return units;
}

/**
 * Pair Plus: expected loss per unit wagered, in percent.
 *
 * Pair Plus is its own action, so its house edge and element of risk are the
 * same number, and both are given for a uniform shape.
 */
export function pairPlusFigures(id: string): Figures {
  const table = pairPlusTable(id);
  let returned = 0;
  for (const [hand, count] of Object.entries(THREE_CARD_COUNTS) as Array<[PairPlusHand | 'HIGH_CARD', number]>) {
    const pays = pairPlusRatio(table, hand);
    // A winning bet returns its stake and its winnings; a losing one nothing.
    returned += pays === null ? 0 : count * (1 + pays);
  }
  const edge = (1 - returned / THREE_CARD_HANDS) * 100;
  return { houseEdge: edge, elementOfRisk: edge };
}

function pairPlusRatio(table: Paytable<PairPlusHand>, hand: PairPlusHand | 'HIGH_CARD'): number | null {
  if (hand === 'HIGH_CARD') return null;
  // A mini royal without a line of its own is paid as the straight flush it is.
  const own = table.lines.find((l) => l.hand === hand);
  const found = own ?? (hand === 'MINI_ROYAL' ? table.lines.find((l) => l.hand === 'STRAIGHT_FLUSH') : undefined);
  return found ? found.ratio[0] / found.ratio[1] : null;
}

/** The 6 Card Bonus: expected loss per unit wagered, in percent. */
export function sixCardFigures(id: string): Figures {
  const table = sixCardTable(id);
  let returned = 0;
  for (const l of table.lines as readonly { hand: SixCardHand; ratio: readonly [number, number] }[]) {
    returned += SIX_CARD_COUNTS[l.hand] * (1 + l.ratio[0] / l.ratio[1]);
  }
  const edge = (1 - returned / SIX_CARD_SETS) * 100;
  return { houseEdge: edge, elementOfRisk: edge };
}

/** How often a hand qualifies for the dealer: queen high or better, out of 22,100. */
export function qualifyingHands(): number {
  const { score } = lookup();
  let n = 0;
  for (let i = 0; i < THREE_CARD_HANDS; i++) if (score[i] >= QUALIFYING_SCORE) n++;
  return n;
}

/* ------------------------------------------------------------------ *
 * Deriving the constants
 * ------------------------------------------------------------------ */

/** Count every three-card hand by what it makes. For the test that pins {@link THREE_CARD_COUNTS}. */
export function deriveThreeCardCounts(): Record<'MINI_ROYAL' | HandCategory, number> {
  const out = { MINI_ROYAL: 0, STRAIGHT_FLUSH: 0, TRIPS: 0, STRAIGHT: 0, FLUSH: 0, PAIR: 0, HIGH_CARD: 0 };
  const deck = Array.from({ length: 52 }, (_, i) => cardFromIndex(i));
  for (let c = 2; c < 52; c++) {
    for (let b = 1; b < c; b++) {
      for (let a = 0; a < b; a++) {
        const hand = evaluate3([deck[a], deck[b], deck[c]]);
        out[hand.miniRoyal ? 'MINI_ROYAL' : hand.category]++;
      }
    }
  }
  return out;
}

/**
 * Count all 20,358,520 six-card sets by their best five-card hand.
 *
 * Six nested loops over one reused array, calling the same `bestFive` the
 * settlement calls. About ten seconds, which is why its test lives in the
 * measurement suite rather than the one that runs on every change; the fast
 * suite checks `bestFive` itself against an independent evaluator instead.
 */
export function deriveSixCardCounts(): Record<SixCardCategory, number> {
  const out: Record<SixCardCategory, number> = {
    ROYAL_FLUSH: 0,
    STRAIGHT_FLUSH: 0,
    FOUR_OF_A_KIND: 0,
    FULL_HOUSE: 0,
    FLUSH: 0,
    STRAIGHT: 0,
    THREE_OF_A_KIND: 0,
    TWO_PAIR: 0,
    PAIR: 0,
    HIGH_CARD: 0,
  };
  const deck = Array.from({ length: 52 }, (_, i) => cardFromIndex(i));
  const six: Card[] = deck.slice(0, 6);
  for (let a = 0; a < 47; a++) {
    six[0] = deck[a];
    for (let b = a + 1; b < 48; b++) {
      six[1] = deck[b];
      for (let c = b + 1; c < 49; c++) {
        six[2] = deck[c];
        for (let d = c + 1; d < 50; d++) {
          six[3] = deck[d];
          for (let e = d + 1; e < 51; e++) {
            six[4] = deck[e];
            for (let f = e + 1; f < 52; f++) {
              six[5] = deck[f];
              out[bestFive(six)]++;
            }
          }
        }
      }
    }
  }
  return out;
}

/**
 * Sum the Ante and Play over every pairing, under every strategy.
 *
 * Done once per *suit pattern* rather than once per hand. Relabelling the
 * suits of a player's hand relabels the dealer's possible hands the same way
 * and changes no outcome, so Q♠6♠4♥ and Q♦6♦4♣ have identical dealer odds.
 * The 22,100 hands fall into 1,755 such patterns; each is walked against the
 * dealer once and weighted by how many hands share it. That is 39 million
 * comparisons instead of 488 million, and the same answer to the unit.
 *
 * Also reports whether every strategy plays every hand the Ante Bonus pays
 * on, which is the premise {@link antePlayFigures} rests on.
 */
export function deriveAntePlayTotals(): {
  totals: Record<StrategyId, { net: number; plays: number }>;
  bonusHandsAlwaysPlayed: boolean;
  /** Hands where the exact decision and the Q-6-4 line disagree. */
  disagreements: Array<{ cards: string; playReturn: number; q64: 'PLAY' | 'FOLD' }>;
} {
  const totals: Record<StrategyId, { net: number; plays: number }> = {
    OPTIMAL: { net: 0, plays: 0 },
    Q64: { net: 0, plays: 0 },
    MIMIC: { net: 0, plays: 0 },
    ALWAYS: { net: 0, plays: 0 },
  };
  let bonusHandsAlwaysPlayed = true;
  const disagreements: Array<{ cards: string; playReturn: number; q64: 'PLAY' | 'FOLD' }> = [];
  const deck = Array.from({ length: 52 }, (_, i) => cardFromIndex(i));
  const seen = new Map<string, { odds: DealerOdds; weight: number; cards: Card[] }>();

  for (let c = 2; c < 52; c++) {
    for (let b = 1; b < c; b++) {
      for (let a = 0; a < b; a++) {
        const key = suitPattern([deck[a], deck[b], deck[c]]);
        const entry = seen.get(key);
        if (entry) entry.weight++;
        else seen.set(key, { odds: dealerOdds([deck[a], deck[b], deck[c]]), weight: 1, cards: [deck[a], deck[b], deck[c]] });
      }
    }
  }

  for (const { odds, weight, cards } of seen.values()) {
    const hand = evaluate3(cards);
    // Integers throughout: the play total over 18,424 dealer hands, and the fold total.
    const play = odds.noQualify + 2 * odds.win - 2 * odds.lose;
    const fold = -odds.hands;

    const decide = (plays: boolean, id: StrategyId) => {
      totals[id].net += weight * (plays ? play : fold);
      if (plays) totals[id].plays += weight;
      if (!plays && hand.category !== 'HIGH_CARD' && hand.category !== 'PAIR' && hand.category !== 'FLUSH') {
        bonusHandsAlwaysPlayed = false;
      }
    };

    const optimal = play >= fold;
    const q64 = hand.score >= Q64_SCORE;
    decide(optimal, 'OPTIMAL');
    decide(q64, 'Q64');
    decide(hand.score >= QUALIFYING_SCORE, 'MIMIC');
    decide(true, 'ALWAYS');

    if (optimal !== q64) {
      disagreements.push({
        cards: cards.map((x) => `${x.rank}${x.suit[0]}`).join(' '),
        playReturn: play / odds.hands,
        q64: q64 ? 'PLAY' : 'FOLD',
      });
    }
  }

  return { totals, bonusHandsAlwaysPlayed, disagreements };
}

/**
 * A key shared by every hand that differs only by a relabelling of suits.
 *
 * Tries all 24 relabellings and keeps the smallest sorted form. Brute force,
 * and exactly right, which matters more here than being clever: a key that
 * merged two hands with different dealer odds would corrupt every figure in
 * the game by an amount too small to see.
 */
function suitPattern(cards: readonly Card[]): string {
  let best = '';
  for (const perm of SUIT_PERMUTATIONS) {
    const ids = cards.map((c) => perm[SUITS.indexOf(c.suit)] * 13 + (c.rank - 2)).sort((x, y) => x - y);
    const key = ids.join(',');
    if (best === '' || key < best) best = key;
  }
  return best;
}

const SUIT_PERMUTATIONS: number[][] = (() => {
  const out: number[][] = [];
  const walk = (prefix: number[], rest: number[]) => {
    if (rest.length === 0) {
      out.push(prefix);
      return;
    }
    rest.forEach((s, i) => walk([...prefix, s], [...rest.slice(0, i), ...rest.slice(i + 1)]));
  };
  walk([], [0, 1, 2, 3]);
  return out;
})();
