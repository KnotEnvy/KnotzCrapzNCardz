/**
 * The chart, and the count.
 *
 * Two things worth testing here that a house-edge simulation would not catch
 * cleanly. First, that the chart says what the printed card says — a wrong
 * cell moves the measured edge by a hundredth of a percent, which is below the
 * simulation's noise floor but is still wrong. Second, that the count is
 * arithmetic a player could do, and in particular that it is computed from the
 * discard tray and never from the shoe.
 */

import { describe, expect, it } from 'vitest';
import { adviseFrom, chartFor, codeFor, upcardValue, UPCARDS, type Code } from './basic';
import {
  COUNT_ORDER,
  COUNT_SYSTEMS,
  betRamp,
  countCards,
  deviationFor,
  edgeAt,
  initialCount,
  insuranceIsGood,
  tagOf,
} from './counting';
import { defaultRules, presetById } from '@/lib/engine/rules';
import { createShoe } from '@/lib/engine/shoe';
import { createRng } from '@/lib/engine/rng';
import { createTable } from '@/lib/engine/table';
import { dollars } from '@/lib/engine/money';
import { DEFAULT_BOT, playRound } from '@/lib/strategy/autoplay';
import type { Card, Rank, Suit } from '@/lib/engine/types';

const S = 'spades' as const;
const H = 'hearts' as const;

let nextId = 1;
function card(rank: Rank, suit: Suit = S): Card {
  return { rank, suit, id: nextId++ };
}

const rules = defaultRules(); // six decks, S17, DAS, no surrender
const h17 = { ...rules, hitsSoft17: true };

const allLegal = {
  HIT: { allowed: true },
  STAND: { allowed: true },
  DOUBLE: { allowed: true },
  SPLIT: { allowed: true },
  SURRENDER: { allowed: true },
};

function chart(cards: Card[], upcard: number, r = rules): Code {
  return codeFor(cards, upcard, r);
}

/* ------------------------------------------------------------------ *
 * Hard totals
 * ------------------------------------------------------------------ */

describe('the hard chart', () => {
  it('stands on twelve against four, five and six, and hits it otherwise', () => {
    expect(chart([card(10), card(2)], 2)).toBe('H');
    expect(chart([card(10), card(2)], 3)).toBe('H');
    expect(chart([card(10), card(2)], 4)).toBe('S');
    expect(chart([card(10), card(2)], 5)).toBe('S');
    expect(chart([card(10), card(2)], 6)).toBe('S');
    expect(chart([card(10), card(2)], 7)).toBe('H');
  });

  it('stands on the stiffs against a weak dealer and hits against a strong one', () => {
    for (const total of [13, 14, 15, 16]) {
      const cards = [card(10), card((total - 10) as Rank)];
      expect(chart(cards, 6), `${total} v 6`).toBe('S');
      expect(chart(cards, 7), `${total} v 7`).toBe('H');
    }
  });

  it('doubles eleven against everything except an ace at S17', () => {
    for (const up of [2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      expect(chart([card(6), card(5)], up), `11 v ${up}`).toBe('D');
    }
    expect(chart([card(6), card(5)], 11)).toBe('H');
  });

  it('doubles eleven against an ace once the dealer hits soft 17', () => {
    expect(chart([card(6), card(5)], 11, h17)).toBe('D');
  });

  it('doubles ten against everything but a ten and an ace', () => {
    expect(chart([card(6), card(4)], 9)).toBe('D');
    expect(chart([card(6), card(4)], 10)).toBe('H');
    expect(chart([card(6), card(4)], 11)).toBe('H');
  });

  it('doubles nine only against three through six', () => {
    expect(chart([card(5), card(4)], 2)).toBe('H');
    for (const up of [3, 4, 5, 6]) expect(chart([card(5), card(4)], up)).toBe('D');
    expect(chart([card(5), card(4)], 7)).toBe('H');
  });

  it('stands on seventeen and above against everything', () => {
    for (const up of UPCARDS) {
      expect(chart([card(10), card(7)], up)).toBe('S');
      expect(chart([card(10), card(10)], up)).toBe('S');
    }
  });
});

/* ------------------------------------------------------------------ *
 * Soft totals
 * ------------------------------------------------------------------ */

describe('the soft chart', () => {
  it('doubles soft eighteen against weak and stands against seven and eight', () => {
    expect(chart([card(14), card(7)], 3)).toBe('Ds');
    expect(chart([card(14), card(7)], 6)).toBe('Ds');
    expect(chart([card(14), card(7)], 7)).toBe('S');
    expect(chart([card(14), card(7)], 8)).toBe('S');
    // Against nine, ten or an ace, soft eighteen is a hit. This is the cell
    // people get wrong most often, and standing on it is worth real money.
    expect(chart([card(14), card(7)], 9)).toBe('H');
    expect(chart([card(14), card(7)], 10)).toBe('H');
    expect(chart([card(14), card(7)], 11)).toBe('H');
  });

  it('stands on soft nineteen and twenty everywhere at S17', () => {
    for (const up of UPCARDS) {
      expect(chart([card(14), card(8)], up)).toBe('S');
      expect(chart([card(14), card(9)], up)).toBe('S');
    }
  });

  it('doubles soft nineteen against a six once the dealer hits soft 17', () => {
    expect(chart([card(14), card(8)], 6, h17)).toBe('Ds');
  });

  it('doubles the small soft hands only against the dealer’s weakest cards', () => {
    expect(chart([card(14), card(2)], 4)).toBe('H');
    expect(chart([card(14), card(2)], 5)).toBe('D');
    expect(chart([card(14), card(2)], 6)).toBe('D');
    expect(chart([card(14), card(4)], 4)).toBe('D');
  });
});

/* ------------------------------------------------------------------ *
 * Pairs
 * ------------------------------------------------------------------ */

describe('the pair chart', () => {
  it('always splits aces and eights, and never splits tens or fives', () => {
    for (const up of UPCARDS) {
      expect(chart([card(14), card(14)], up), `A,A v ${up}`).toBe('P');
      expect(chart([card(8), card(8)], up), `8,8 v ${up}`).toBe('P');
      expect(chart([card(13), card(12)], up), `K,Q v ${up}`).toBe('S');
      expect(chart([card(5), card(5)], up)).not.toBe('P');
    }
  });

  it('splits nines except against seven, ten and an ace', () => {
    expect(chart([card(9), card(9)], 6)).toBe('P');
    expect(chart([card(9), card(9)], 7)).toBe('S');
    expect(chart([card(9), card(9)], 8)).toBe('P');
    expect(chart([card(9), card(9)], 9)).toBe('P');
    expect(chart([card(9), card(9)], 10)).toBe('S');
    expect(chart([card(9), card(9)], 11)).toBe('S');
  });

  it('splits sevens against two through seven and no further', () => {
    for (const up of [2, 3, 4, 5, 6, 7]) expect(chart([card(7), card(7)], up)).toBe('P');
    expect(chart([card(7), card(7)], 8)).toBe('H');
  });

  it('reads a king and a jack as a pair of tens', () => {
    expect(chart([card(13), card(11)], 6)).toBe('S');
  });
});

/* ------------------------------------------------------------------ *
 * Legality reconciliation
 * ------------------------------------------------------------------ */

describe('advice against what is legal', () => {
  const noDouble = { ...allLegal, DOUBLE: { allowed: false } };
  const noSplit = { ...allLegal, SPLIT: { allowed: false } };
  const noSurrender = { ...allLegal, SURRENDER: { allowed: false } };

  it('falls back from double to hit, and from Ds to stand', () => {
    expect(adviseFrom('D', noDouble, [card(6), card(5)], 6, rules)).toMatchObject({ action: 'HIT', fellBack: true });
    expect(adviseFrom('Ds', noDouble, [card(14), card(7)], 5, rules)).toMatchObject({ action: 'STAND', fellBack: true });
  });

  it('falls back from split to hit when the table will not take it', () => {
    expect(adviseFrom('P', noSplit, [card(8), card(8)], 6, rules)).toMatchObject({ action: 'HIT', fellBack: true });
  });

  it('falls back from surrender to hit, or to stand where the chart says so', () => {
    expect(adviseFrom('R', noSurrender, [card(10), card(6)], 10, rules)).toMatchObject({ action: 'HIT' });
    expect(adviseFrom('Rs', noSurrender, [card(10), card(7)], 11, rules)).toMatchObject({ action: 'STAND' });
  });

  it('only splits a Ph cell where doubling after a split is allowed', () => {
    const das = { ...rules, das: true };
    const noDas = { ...rules, das: false };
    expect(adviseFrom('Ph', allLegal, [card(2), card(2)], 2, das)).toMatchObject({ action: 'SPLIT' });
    expect(adviseFrom('Ph', allLegal, [card(2), card(2)], 2, noDas)).toMatchObject({ action: 'HIT' });
  });

  it('gives every cell a reason a player could act on', () => {
    for (const total of [8, 12, 16, 20]) {
      for (const up of UPCARDS) {
        const cards = [card(10), card((total - 10) as Rank)];
        const advice = adviseFrom(codeFor(cards, up, rules), allLegal, cards, up, rules);
        expect(advice.why.length).toBeGreaterThan(10);
      }
    }
  });
});

/* ------------------------------------------------------------------ *
 * Chart integrity
 * ------------------------------------------------------------------ */

describe('chart integrity', () => {
  it('has a code in every cell of every table, for every preset', () => {
    for (const preset of [presetById('vegas-strip'), presetById('single-deck'), presetById('european')]) {
      const c = chartFor(preset.rules);
      for (const table of [c.hard, c.soft, c.pairs]) {
        for (const [key, row] of Object.entries(table)) {
          expect(row, `${preset.id} row ${key}`).toHaveLength(UPCARDS.length);
          for (const code of row) expect(code).toBeTruthy();
        }
      }
    }
  });

  it('reads an upcard by value, so every ten-value is one column', () => {
    expect(upcardValue(card(11))).toBe(10);
    expect(upcardValue(card(13))).toBe(10);
    expect(upcardValue(card(14))).toBe(11);
    expect(upcardValue(card(7))).toBe(7);
  });

  /*
   * The chart the dialog shows has to be a chart you can actually play. A cell
   * saying "surrender" at a table with no surrender is worse than useless — it
   * is a play the dealer will refuse, printed under a caption claiming the
   * table's restrictions have been applied.
   */
  it('collapses surrender cells at a table that does not offer it', () => {
    const withLS = chartFor({ ...rules, surrender: 'LATE' });
    const without = chartFor({ ...rules, surrender: 'NONE' });
    expect(withLS.hard[16][UPCARDS.indexOf(10)]).toBe('R');
    expect(without.hard[16][UPCARDS.indexOf(10)]).toBe('H');
    expect(without.hard[15][UPCARDS.indexOf(10)]).toBe('H');
  });

  it('collapses doubles the table will not book', () => {
    const any2 = chartFor({ ...rules, double: 'ANY2' });
    const tenEleven = chartFor({ ...rules, double: '10-11' });
    expect(any2.hard[9][UPCARDS.indexOf(4)]).toBe('D');
    expect(tenEleven.hard[9][UPCARDS.indexOf(4)]).toBe('H');
    expect(tenEleven.hard[11][UPCARDS.indexOf(4)]).toBe('D');

    const hard = chartFor({ ...rules, doubleSoft: false });
    expect(hard.soft[17][UPCARDS.indexOf(4)]).toBe('H');
    // Soft eighteen against a five is "double, else stand" — with no soft
    // doubling it has to become the stand, not the hit.
    expect(hard.soft[18][UPCARDS.indexOf(5)]).toBe('S');
  });

  it('collapses double-after-split cells when the table refuses DAS', () => {
    const das = chartFor({ ...rules, das: true });
    const noDas = chartFor({ ...rules, das: false });
    expect(das.pairs[2][UPCARDS.indexOf(2)]).toBe('Ph');
    expect(noDas.pairs[2][UPCARDS.indexOf(2)]).toBe('H');
  });

  it('still splits eights and aces whatever else is restricted', () => {
    const mean = chartFor({
      ...rules,
      surrender: 'NONE',
      das: false,
      doubleSoft: false,
      double: '10-11',
    });
    for (const up of UPCARDS) {
      expect(mean.pairs[8][UPCARDS.indexOf(up)]).toBe('P');
      expect(mean.pairs[11][UPCARDS.indexOf(up)]).toBe('P');
    }
  });

  it('changes cells for a single-deck game', () => {
    const six = chartFor(presetById('vegas-strip').rules);
    const one = chartFor({ ...presetById('vegas-strip').rules, decks: 1 });
    const differences = Object.keys(six.hard).filter(
      (k) => six.hard[Number(k)].join() !== one.hard[Number(k)].join(),
    );
    expect(differences.length).toBeGreaterThan(0);
  });

  it('applies the two-deck deltas at two decks and the rest only at one', () => {
    const base = presetById('vegas-strip').rules;
    const two = chartFor({ ...base, decks: 2 });
    const one = chartFor({ ...base, decks: 1 });
    // Nine against a two doubles from two decks down.
    expect(two.hard[9][UPCARDS.indexOf(2)]).toBe('D');
    // Eight against a five is a single-deck cell only.
    expect(two.hard[8][UPCARDS.indexOf(5)]).toBe('H');
    expect(one.hard[8][UPCARDS.indexOf(5)]).toBe('D');
  });

  /*
   * Under no-hole-card the dealer's second card arrives after the players are
   * finished, so a natural takes the doubled and split chips too. Against the
   * two upcards that can become one, those extra chips stop being worth
   * risking — and the chart has to say so, because the engine will happily
   * book the double.
   */
  it('stops doubling and splitting into a possible natural under ENHC', () => {
    const peek = chartFor({ ...rules, holeCard: 'PEEK' });
    const enhc = chartFor({ ...rules, holeCard: 'ENHC' });

    expect(peek.hard[11][UPCARDS.indexOf(10)]).toBe('D');
    expect(enhc.hard[11][UPCARDS.indexOf(10)]).toBe('H');

    expect(peek.pairs[8][UPCARDS.indexOf(10)]).toBe('P');
    expect(enhc.pairs[8][UPCARDS.indexOf(10)]).toBe('H');
    expect(enhc.pairs[8][UPCARDS.indexOf(11)]).toBe('H');
    expect(enhc.pairs[11][UPCARDS.indexOf(11)]).toBe('H');

    // Against everything else the two charts agree — the rule only bites
    // where the dealer can turn a natural.
    for (const up of [2, 3, 4, 5, 6, 7, 8, 9]) {
      const i = UPCARDS.indexOf(up);
      expect(enhc.pairs[8][i], `8,8 v ${up}`).toBe(peek.pairs[8][i]);
      expect(enhc.hard[11][i], `11 v ${up}`).toBe(peek.hard[11][i]);
    }
  });

  it('caches a peeking chart apart from a no-hole-card one', () => {
    // The cache key omitted holeCard, so whichever was asked for first was
    // served to both.
    const enhc = chartFor({ ...rules, holeCard: 'ENHC' });
    const peek = chartFor({ ...rules, holeCard: 'PEEK' });
    expect(enhc.hard[11][UPCARDS.indexOf(10)]).not.toBe(peek.hard[11][UPCARDS.indexOf(10)]);
  });
});

/* ------------------------------------------------------------------ *
 * The bot's own reporting
 * ------------------------------------------------------------------ */

describe('playRound reports what it did', () => {
  /*
   * Two thousand rounds, checked against arithmetic rather than against a
   * recorded figure. Every one of these was silently zero or wrong at some
   * point: `handsPlayed` compared a value read after the deal against one read
   * after settlement, and the deal is what increments it, so it was always
   * zero — invisible until the measurement suite divided by it.
   */
  const rng = createRng('report');
  let table = createTable(presetById('vegas-strip').rules, rng, {
    seats: 1,
    bankroll: dollars(1_000_000),
  });
  let hands = 0;
  let wagered = 0;
  const ROUNDS = 2000;
  for (let i = 0; i < ROUNDS; i++) {
    const out = playRound(table, DEFAULT_BOT, rng);
    table = out.table;
    hands += out.handsPlayed;
    wagered += out.wagered;
  }
  const stats = table.seats[0].stats;

  it('counts one hand per round', () => {
    expect(hands).toBe(ROUNDS);
  });

  it('wagers at least the unit on every hand, and more where it doubled or split', () => {
    expect(wagered).toBeGreaterThan(ROUNDS * DEFAULT_BOT.unit);
    expect(wagered).toBe(stats.wagered);
  });

  it('doubles and splits at something like the published rates', () => {
    // Basic strategy doubles roughly nine or ten hands in a hundred and splits
    // roughly two. An order of magnitude either side means the chart is not
    // reaching the felt.
    const per1000 = (n: number) => (n / hands) * 1000;
    expect(per1000(stats.doubles)).toBeGreaterThan(50);
    expect(per1000(stats.doubles)).toBeLessThan(160);
    expect(per1000(stats.splits)).toBeGreaterThan(5);
    expect(per1000(stats.splits)).toBeLessThan(60);
  });

  it('never surrenders at a table that does not offer it', () => {
    expect(stats.surrenders).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * Counting
 * ------------------------------------------------------------------ */

describe('counting', () => {
  it('every balanced system sums to zero over a full deck', () => {
    for (const id of COUNT_ORDER) {
      const spec = COUNT_SYSTEMS[id];
      if (!spec.balanced) continue;
      const deck = createShoe(1, 0.75, createRng('count')).cards;
      const sum = deck.reduce((n, c) => n + tagOf(c, id), 0);
      expect(sum, id).toBe(0);
    }
  });

  it('Knock-Out is unbalanced and starts below zero to compensate', () => {
    const deck = createShoe(1, 0.75, createRng('ko')).cards;
    expect(deck.reduce((n, c) => n + tagOf(c, 'KO'), 0)).toBe(4);
    expect(initialCount('KO', 6)).toBe(-20);
    expect(initialCount('HI_LO', 6)).toBe(0);
  });

  it('divides the running count by the decks remaining', () => {
    // Twelve low cards seen, three decks left: running +12, true +4.
    const discard: Card[] = Array.from({ length: 12 }, () => card(5, H));
    const state = countCards(discard, 'HI_LO', 6, 156);
    expect(state.running).toBe(12);
    expect(state.true).toBeCloseTo(4, 5);
  });

  it('never divides by less than a quarter deck', () => {
    const discard: Card[] = Array.from({ length: 10 }, () => card(5, H));
    expect(countCards(discard, 'HI_LO', 6, 0).decksLeft).toBe(0.25);
    expect(Number.isFinite(countCards(discard, 'HI_LO', 6, 0).true)).toBe(true);
  });

  it('reads only what it is given, so an unseen shoe counts as neutral', () => {
    expect(countCards([], 'HI_LO', 6, 312).running).toBe(0);
    expect(countCards([], 'HI_LO', 6, 312).true).toBe(0);
  });

  it('prices the count at half a percent a unit', () => {
    expect(edgeAt(0, 0.5)).toBeCloseTo(-0.5, 5);
    expect(edgeAt(2, 0.5)).toBeCloseTo(0.5, 5);
    expect(edgeAt(-2, 0.5)).toBeCloseTo(-1.5, 5);
  });

  it('ramps the bet with the count and never below one unit', () => {
    expect(betRamp(-5)).toBe(1);
    expect(betRamp(0)).toBe(1);
    expect(betRamp(2.5)).toBe(4);
    expect(betRamp(9)).toBe(12);
  });

  it('takes insurance at plus three and not before', () => {
    expect(insuranceIsGood(2.9)).toBe(false);
    expect(insuranceIsGood(3)).toBe(true);
  });

  it('flips sixteen against a ten at a neutral shoe, and not below it', () => {
    expect(deviationFor(16, 10, 0)?.action).toBe('STAND');
    expect(deviationFor(16, 10, -1)).toBeNull();
  });

  it('flips twelve against a three only above plus two', () => {
    expect(deviationFor(12, 3, 1)).toBeNull();
    expect(deviationFor(12, 3, 2)?.action).toBe('STAND');
  });
});
