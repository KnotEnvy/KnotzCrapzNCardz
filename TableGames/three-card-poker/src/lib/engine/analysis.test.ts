/**
 * The exact figures, re-derived from nothing.
 *
 * `analysis.ts` carries its counts and totals as constants, because summing
 * 407 million pairings on page load is not something a player should wait for.
 * Constants can go stale; so this file recomputes them from the evaluators the
 * settlement itself uses and asserts it gets the same numbers back. A change to
 * a hand ranking, the qualifier or a strategy line that moves any figure the
 * felt prints fails here first.
 *
 * One constant is not recomputed here: the six-card counts take ten seconds to
 * enumerate, which is too long for the suite that runs on every change. That
 * enumeration lives in `analysis.sim.test.ts`. What stands in for it here is a
 * check of `bestFive` itself against a deliberately naive evaluator written
 * separately below — the counts can only be wrong if that function is.
 *
 * The computed edges are also held against the figures the Wizard of Odds
 * publishes for the same tables, which are rounded to two places — hence a
 * tolerance of half a hundredth. They agreed on every table the first time
 * this ran, which is worth recording: it is the evidence that the counts, the
 * paytables and the settlement rules all describe the same game the published
 * figures do.
 */

import { describe, expect, it } from 'vitest';
import {
  ANTE_PLAY_TOTALS,
  DEALER_HANDS,
  PAIRINGS,
  SIX_CARD_COUNTS,
  SIX_CARD_SETS,
  STRATEGY_IDS,
  THREE_CARD_COUNTS,
  THREE_CARD_HANDS,
  antePlayFigures,
  dealerOdds,
  deriveAntePlayTotals,
  deriveThreeCardCounts,
  pairPlusFigures,
  playReturn,
  qualifyingHands,
  sixCardFigures,
} from './analysis';
import { shuffle } from './deck';
import { ANTE_BONUS_TABLES, PAIR_PLUS_TABLES, SIX_CARD_TABLES } from './paytables';
import { bestFive } from './poker';
import { createRng } from './rng';
import type { Card, SixCardCategory } from './types';
import { cardFromIndex, SIX_CARD_CATEGORIES } from './types';

const near = (a: number, b: number, tolerance = 0.006) => Math.abs(a - b) < tolerance;

describe('the counts', () => {
  it('sizes the game', () => {
    expect(THREE_CARD_HANDS * DEALER_HANDS).toBe(PAIRINGS);
    expect(PAIRINGS).toBe(407_170_400);
    expect(Object.values(SIX_CARD_COUNTS).reduce((n, x) => n + x, 0)).toBe(SIX_CARD_SETS);
  });

  it('counts three-card hands by enumeration', () => {
    const derived = deriveThreeCardCounts();
    expect(derived).toEqual(THREE_CARD_COUNTS);
    expect(Object.values(derived).reduce((n, x) => n + x, 0)).toBe(THREE_CARD_HANDS);
  });

  it('agrees with the published six-card counts for every paying hand', () => {
    // Wizard of Odds, 6 Card Bonus: the combinations column of every paytable.
    expect(SIX_CARD_COUNTS).toMatchObject({
      ROYAL_FLUSH: 188,
      STRAIGHT_FLUSH: 1_656,
      FOUR_OF_A_KIND: 14_664,
      FULL_HOUSE: 165_984,
      FLUSH: 205_792,
      STRAIGHT: 361_620,
      THREE_OF_A_KIND: 732_160,
    });
  });
});

describe('the Ante and Play', () => {
  const derived = deriveAntePlayTotals();

  it('sums every pairing to the constants', () => {
    expect(derived.totals).toEqual(ANTE_PLAY_TOTALS);
  });

  it('plays every hand the Ante Bonus pays, under every strategy', () => {
    // The premise that lets one constant serve every Ante Bonus table.
    expect(derived.bonusHandsAlwaysPlayed).toBe(true);
  });

  /*
   * The finding the whole trainer rests on. If the exact decision and the
   * printed line ever disagreed on a hand, the line would be an approximation
   * and the trainer would have to say which one it grades against. They do
   * not disagree on any of the 22,100 hands.
   */
  it('finds no hand on which the exact decision and Q-6-4 part ways', () => {
    expect(derived.disagreements).toEqual([]);
  });

  it('prices the four strategies in the order they should be', () => {
    const edges = STRATEGY_IDS.map((id) => antePlayFigures('5-4-1', id).houseEdge);
    expect(edges[0]).toBeCloseTo(edges[1], 12);
    expect(edges[2]).toBeGreaterThan(edges[1]);
    expect(edges[3]).toBeGreaterThan(edges[2]);
  });
});

describe('the dealer against a known hand', () => {
  it('always accounts for all 18,424 dealer hands', () => {
    const rng = createRng('odds');
    const deck = Array.from({ length: 52 }, (_, i) => cardFromIndex(i));
    for (let i = 0; i < 50; i++) {
      const hand = shuffle(deck, rng).slice(0, 3);
      const odds = dealerOdds(hand);
      expect(odds.noQualify + odds.win + odds.tie + odds.lose).toBe(DEALER_HANDS);
    }
  });

  it('matches an independent count for one hand', () => {
    // Brute force over the 49 remaining cards, written without the lookup.
    const player = [cardFromIndex(10), cardFromIndex(4), cardFromIndex(15)];
    const odds = dealerOdds(player);
    const rest = Array.from({ length: 52 }, (_, i) => i).filter((i) => !player.some((c) => c.id === i));
    let hands = 0;
    for (let a = 0; a < rest.length; a++) for (let b = a + 1; b < rest.length; b++) for (let c = b + 1; c < rest.length; c++) hands++;
    expect(hands).toBe(odds.hands);
    expect(playReturn(odds)).toBeGreaterThanOrEqual(-2);
    expect(playReturn(odds)).toBeLessThanOrEqual(2);
  });

  /*
   * Two routes to one number. `qualifyingHands` scans the score table; the
   * MIMIC strategy plays exactly the hands that would qualify for the dealer,
   * and its play count came out of the pairing enumeration. They have to agree.
   * (The first draft of this test asserted 15,272 from a count done by hand,
   * and the hand count was the one that was wrong.)
   */
  it('knows the dealer qualifies on 15,380 hands in 22,100', () => {
    expect(qualifyingHands()).toBe(15_380);
    expect(qualifyingHands()).toBe(ANTE_PLAY_TOTALS.MIMIC.plays);
  });
});

describe('against published figures', () => {
  it('Ante Bonus tables', () => {
    const published: Record<string, [number, number]> = {
      '5-4-1': [3.37, 2.01],
      '4-3-1': [3.83, 2.28],
      '3-2-1': [4.28, 2.56],
      '5-3-1': [3.61, 2.16],
    };
    for (const t of ANTE_BONUS_TABLES) {
      const f = antePlayFigures(t.id);
      const [edge, risk] = published[t.id];
      expect(near(f.houseEdge, edge), `${t.id} house edge ${f.houseEdge}`).toBe(true);
      expect(near(f.elementOfRisk, risk), `${t.id} element of risk ${f.elementOfRisk}`).toBe(true);
    }
  });

  it('Pair Plus tables', () => {
    const published: Record<string, number> = {
      '40-30-6-3-1': 7.28,
      '35-33-6-4-1': 2.7,
      '40-25-6-4-1': 3.49,
      '50-30-6-3-1': 5.1,
      '40-30-5-4-1': 5.57,
      '40-32-6-4-1': 1.85,
    };
    for (const t of PAIR_PLUS_TABLES) {
      if (published[t.id] === undefined) continue;
      const f = pairPlusFigures(t.id);
      expect(near(f.houseEdge, published[t.id]), `${t.id} ${f.houseEdge}`).toBe(true);
    }
  });

  it('6 Card Bonus tables', () => {
    const published: Record<string, number> = {
      '1000-200-100-20-15-10-7': 8.56,
      '2000-200-50-25-15-10-5': 14.36,
      '1000-200-50-25-15-10-5': 15.28,
      '1000-200-50-25-20-10-5': 10.22,
    };
    for (const t of SIX_CARD_TABLES) {
      if (published[t.id] === undefined) continue;
      const f = sixCardFigures(t.id);
      expect(near(f.houseEdge, published[t.id]), `${t.id} ${f.houseEdge}`).toBe(true);
    }
  });

  /*
   * The first draft filed the mini royal table last, reasoning that it was the
   * common table with a line added. The line is worth three points: four hands
   * in 22,100 paying 160 units more is 2.9% of every dollar wagered, which
   * takes the table from 7.28% to 4.38%. It was also wrong about the 6 Card
   * Bonus, where cutting the straight to nine to pay trips eight is worth
   * almost two points to the player, not a trade. Both lists are ordered by
   * the computation now, and this is what keeps them that way.
   */
  it('lists every kind of table best first, as their comments say', () => {
    const pp = PAIR_PLUS_TABLES.map((t) => pairPlusFigures(t.id).houseEdge);
    const ab = ANTE_BONUS_TABLES.map((t) => antePlayFigures(t.id).houseEdge);
    const sc = SIX_CARD_TABLES.map((t) => sixCardFigures(t.id).houseEdge);
    for (let i = 1; i < pp.length; i++) expect(pp[i], PAIR_PLUS_TABLES[i].id).toBeGreaterThan(pp[i - 1]);
    for (let i = 1; i < ab.length; i++) expect(ab[i], ANTE_BONUS_TABLES[i].id).toBeGreaterThan(ab[i - 1]);
    for (let i = 1; i < sc.length; i++) expect(sc[i], SIX_CARD_TABLES[i].id).toBeGreaterThan(sc[i - 1]);
  });
});

/* ------------------------------------------------------------------ *
 * bestFive, against a naive evaluator
 * ------------------------------------------------------------------ */

/**
 * Five cards, classified the obvious way: sort, count, look.
 *
 * Deliberately nothing like `bestFive` — no masks, no counts array, no
 * shortcuts — so the two cannot share a mistake.
 */
function naiveFive(cards: readonly Card[]): SixCardCategory {
  const ranks = cards.map((c) => c.rank).sort((a, b) => a - b);
  const flush = cards.every((c) => c.suit === cards[0].suit);
  const distinct = new Set(ranks).size === 5;
  const wheel = ranks.join(',') === '2,3,4,5,14';
  const straight = distinct && (ranks[4] - ranks[0] === 4 || wheel);
  const groups = new Map<number, number>();
  for (const r of ranks) groups.set(r, (groups.get(r) ?? 0) + 1);
  const shape = [...groups.values()].sort((a, b) => b - a);

  if (straight && flush) return ranks[0] === 10 ? 'ROYAL_FLUSH' : 'STRAIGHT_FLUSH';
  if (shape[0] === 4) return 'FOUR_OF_A_KIND';
  if (shape[0] === 3 && shape[1] === 2) return 'FULL_HOUSE';
  if (flush) return 'FLUSH';
  if (straight) return 'STRAIGHT';
  if (shape[0] === 3) return 'THREE_OF_A_KIND';
  if (shape[0] === 2 && shape[1] === 2) return 'TWO_PAIR';
  if (shape[0] === 2) return 'PAIR';
  return 'HIGH_CARD';
}

/** The best of the six five-card hands inside six cards. */
function naiveBestOfSix(six: readonly Card[]): SixCardCategory {
  let best = SIX_CARD_CATEGORIES.length - 1;
  for (let skip = 0; skip < 6; skip++) {
    const five = six.filter((_, i) => i !== skip);
    best = Math.min(best, SIX_CARD_CATEGORIES.indexOf(naiveFive(five)));
  }
  return SIX_CARD_CATEGORIES[best];
}

describe('bestFive', () => {
  const deck = Array.from({ length: 52 }, (_, i) => cardFromIndex(i));

  it('agrees with the naive evaluator on twenty thousand random six-card sets', () => {
    const rng = createRng('best-five');
    for (let i = 0; i < 20_000; i++) {
      const six = shuffle(deck, rng).slice(0, 6);
      expect(bestFive(six), six.map((c) => `${c.rank}${c.suit[0]}`).join(' ')).toBe(naiveBestOfSix(six));
    }
  });

  /*
   * Random sets almost never hold the hands the 6 Card Bonus pays most for — a
   * royal flush is 188 sets in twenty million — so the rare shapes are built
   * on purpose: every straight flush and royal in every suit, with every
   * possible sixth card.
   */
  it('agrees on every straight flush and royal flush with any sixth card', () => {
    for (let suit = 0; suit < 4; suit++) {
      for (let top = 5; top <= 14; top++) {
        const ranks = top === 5 ? [14, 2, 3, 4, 5] : [top - 4, top - 3, top - 2, top - 1, top];
        const five = ranks.map((r) => deck[suit * 13 + (r - 2)]);
        for (const extra of deck) {
          if (five.some((c) => c.id === extra.id)) continue;
          const six = [...five, extra];
          expect(bestFive(six)).toBe(naiveBestOfSix(six));
        }
      }
    }
  });

  it('agrees on every four of a kind with any two other cards', () => {
    for (let rank = 0; rank < 13; rank++) {
      const four = [0, 1, 2, 3].map((s) => deck[s * 13 + rank]);
      const rest = deck.filter((c) => !four.includes(c));
      for (let a = 0; a < rest.length; a += 3) {
        for (let b = a + 1; b < rest.length; b += 5) {
          const six = [...four, rest[a], rest[b]];
          expect(bestFive(six)).toBe(naiveBestOfSix(six));
        }
      }
    }
  });
});
