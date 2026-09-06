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
  countTable,
  deviationFor,
  countShoe,
  edgeAt,
  hiLoEquivalent,
  initialCount,
  insuranceIsGood,
  tagOf,
} from './counting';
import { defaultRules, presetById } from '@/lib/engine/rules';
import { createShoe } from '@/lib/engine/shoe';
import { createRng } from '@/lib/engine/rng';
import { createTable, deal, setBet, setSideBet } from '@/lib/engine/table';
import { dollars } from '@/lib/engine/money';
import { betFor, decide, DEFAULT_BOT, playRound } from '@/lib/strategy/autoplay';
import type { Action, Card, Rank, Suit, TableRules } from '@/lib/engine/types';

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
    /*
     * The deuce column is first because it was the one this test used to
     * skip, and skipping it hid a wrong cell for four rounds: the chart said
     * double against a two at S17, where the play is to stand. A sweep that
     * asserts 3, 6, 7, 8, 9, 10 and A and quietly omits 2 is not a sweep.
     */
    expect(chart([card(14), card(7)], 2)).toBe('S');
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

  it('doubles soft eighteen against a two only once the dealer hits soft 17', () => {
    // The whole reason SOFT_H17 has an entry for this cell. While the S17
    // chart already said 'Ds', the patch changed nothing and the test below
    // could not have told the two charts apart.
    expect(chart([card(14), card(7)], 2)).toBe('S');
    expect(chart([card(14), card(7)], 2, h17)).toBe('Ds');
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

  /*
   * The advisor's fallbacks used to end at HIT, which is not always available:
   * a split ace at a table that gives them one card each cannot hit, so a `P`
   * cell that could not be split recommended a move the dealer would refuse.
   * Every fallback now checks.
   */
  it('never names an action the table would refuse', () => {
    const nothingButStand = {
      HIT: { allowed: false },
      STAND: { allowed: true },
      DOUBLE: { allowed: false },
      SPLIT: { allowed: false },
      SURRENDER: { allowed: false },
    };
    for (const code of ['H', 'S', 'D', 'Ds', 'P', 'Ph', 'Pd', 'R', 'Rs', 'Rp'] as Code[]) {
      const advice = adviseFrom(code, nothingButStand, [card(14), card(14)], 6, rules);
      expect(advice.action, `${code} fell back to an illegal move`).toBe('STAND');
    }
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
  /*
   * Every rule delta has to actually be a delta.
   *
   * `SOFT_H17` carried `[18, 2, 'Ds']` while the S17 chart already said 'Ds'
   * in that cell. The patch was therefore a no-op, the two charts were
   * identical there, and — since the H17 entry was the correct one — the S17
   * chart was wrong at the *default* table, on the most common soft hand in
   * the game. Four rounds of review and forty-odd chart assertions went past
   * it, because every one of them asked about a cell rather than about the
   * relationship between two charts.
   *
   * This asks about the relationship: turn one rule on, and the cells it
   * claims to move must move. A dead entry fails here whether or not anyone
   * thought to assert the cell it lives in.
   */
  it('has no rule delta that changes nothing', () => {
    const cells = (c: ReturnType<typeof chartFor>) =>
      (['hard', 'soft', 'pairs'] as const).flatMap((k) =>
        Object.entries(c[k]).flatMap(([row, codes]) =>
          codes.map((code, i) => [`${k}:${row}:${UPCARDS[i]}`, code] as const),
        ),
      );

    const differences = (a: TableRules, b: TableRules) => {
      const left = new Map(cells(chartFor(a)));
      const right = new Map(cells(chartFor(b)));
      const out: string[] = [];
      for (const [key, code] of left) if (right.get(key) !== code) out.push(key);
      return out;
    };

    /*
     * Hitting soft 17 moves three hard cells, two soft and one pair — but
     * three of the six are surrender cells, and the default table has no
     * surrender, so the comparison is made at a table that can actually
     * book them. A cell suppressed by another rule is not a dead patch;
     * it is `restrict` doing its job, which the tests below cover.
     */
    const surrenderable = { ...rules, surrender: 'LATE' as const };
    const h17Moves = differences(surrenderable, { ...surrenderable, hitsSoft17: true });
    expect(h17Moves.sort()).toEqual(
      [
        'hard:11:11', 'hard:15:11', 'hard:17:11',
        'soft:18:2', 'soft:19:6',
        'pairs:8:11',
      ].sort(),
    );

    /*
     * The five European cells, all of them about not risking a second chip
     * against an upcard that can still turn into a natural. Compared against
     * an H17 table, because eleven versus an ace is a hit at six-deck S17
     * anyway — the ENHC entry for it exists to override the H17 and few-deck
     * patches, which is why ENHC is applied last.
     */
    const h17Base = { ...rules, hitsSoft17: true };
    expect(differences(h17Base, { ...h17Base, holeCard: 'ENHC' }).sort()).toEqual(
      ['hard:11:10', 'hard:11:11', 'pairs:8:10', 'pairs:8:11', 'pairs:11:11'].sort(),
    );

    // And the few-deck sets: four cells at two decks, twelve at one.
    expect(differences(rules, { ...rules, decks: 2 })).toHaveLength(4);
    expect(differences(rules, { ...rules, decks: 1 })).toHaveLength(12);
  });

  /*
   * Early surrender is a different rule, priced at 0.63% against late
   * surrender's 0.08%, and until round six it got the same chart. It buys out
   * of the dealer's natural as well as the dealer's good hand, so it is far
   * more aggressive against exactly the two upcards that can become one — and
   * unchanged everywhere else, because nothing else changes when the peek
   * moves.
   */
  /*
   * The invariant this file's own comment states — "the advisor must never
   * name an action the buttons reject" — held for every case anyone had
   * thought of and not for the one the trainer actually hits. During the
   * offers phase at an early-surrender table the engine allows exactly one
   * action, SURRENDER, and every fallback in `adviseFrom` ended at STAND. So
   * the hint bar named a move the buttons refused, and the trainer then
   * graded a correct early surrender as a mistake.
   *
   * Asserted over every chart code against every legality map the table can
   * produce, rather than over the cases someone remembered.
   */
  it('never names an action the table would refuse, whatever is legal', () => {
    const codes: Code[] = ['H', 'S', 'D', 'Ds', 'P', 'Ph', 'Pd', 'R', 'Rs', 'Rp'];
    const actions: Action[] = ['HIT', 'STAND', 'DOUBLE', 'SPLIT', 'SURRENDER'];

    // Every non-empty subset of the five actions, which is what the engine's
    // legality map is: 31 of them, including the offers phase's lone SURRENDER.
    for (let mask = 1; mask < 32; mask++) {
      const legal = Object.fromEntries(
        actions.map((a, i) => [a, { allowed: (mask & (1 << i)) !== 0 }]),
      ) as Record<Action, { allowed: boolean }>;

      for (const code of codes) {
        const advice = adviseFrom(code, legal, [card(8), card(8)], 10, rules);
        expect(
          legal[advice.action].allowed,
          `code ${code} named ${advice.action} with only ${actions.filter((a) => legal[a].allowed).join('/')} legal`,
        ).toBe(true);
      }
    }
  });

  it('advises early surrender differently from late surrender', () => {
    const late = chartFor({ ...rules, surrender: 'LATE' });
    const early = chartFor({ ...rules, surrender: 'EARLY' });

    const at = (c: ReturnType<typeof chartFor>, total: number, up: number) =>
      c.hard[total][UPCARDS.indexOf(up)];

    // Hard twelve against an ace: a late-surrender table hits it, an
    // early-surrender one folds it before the dealer looks. (Sixteen against
    // an ace is already a late surrender, so it is not the cell that tells
    // the two charts apart.)
    expect(at(late, 12, 11)).toBe('H');
    expect(at(early, 12, 11)).toBe('R');
    // And hard fourteen against a ten, which late surrender plays out.
    expect(at(late, 14, 10)).toBe('H');
    expect(at(early, 14, 10)).toBe('R');
    // And a five, which cannot bust and still is not worth playing into a
    // hand that may already be a natural.
    expect(at(late, 5, 11)).toBe('H');
    expect(at(early, 5, 11)).toBe('R');

    // The two charts have to differ *only* against a ten and an ace: the peek
    // moving changes nothing about a dealer six.
    for (const total of Object.keys(early.hard).map(Number)) {
      for (const up of UPCARDS) {
        if (up === 10 || up === 11) continue;
        expect(at(early, total, up), `hard ${total} v ${up}`).toBe(at(late, total, up));
      }
    }
    for (const row of Object.keys(early.soft).map(Number)) {
      expect(early.soft[row]).toEqual(late.soft[row]);
    }
  });

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

  /*
   * The counter's whole claim is that it reads the cards a player can see.
   * `shoe.pos` is not that: the dealer's hole card leaves the shoe at the top
   * of the round and is turned over at the end of it, so counting up to the
   * pointer counted a card nobody could see — and quietly told the deviation
   * bot what the dealer was holding.
   */
  it('does not count the dealer’s hole card while it is face down', () => {
    let t = createTable(defaultRules(), createRng('hole'), { seats: 1 });
    const stacked: Card[] = ([[9, S], [9, S], [9, S], [13, S]] as Array<[Rank, Suit]>).map(
      ([r, su], i) => ({ rank: r, suit: su, id: 800_000 + i }),
    );
    t = { ...t, shoe: { ...t.shoe, cards: [...stacked, ...t.shoe.cards], pos: 0, size: t.shoe.size + 4 } };
    const withBet = setBet(t, 'A', dollars(10));
    if (!withBet.ok) throw new Error(withBet.reason);
    const dealt = deal(withBet.table, createRng('hole'));
    if (!dealt.ok) throw new Error(dealt.reason);
    t = dealt.table;

    // Four cards have left the shoe; three are face up.
    expect(t.shoe.pos).toBe(4);
    expect(t.dealer.holeDown).toBe(true);
    const hidden = countTable(t, 'HI_LO');
    expect(hidden.cardsSeen).toBe(3);
    // Three nines: Hi-Lo tags them zero, so the king under them would show.
    expect(hidden.running).toBe(0);

    // Turn it over and the king joins the count.
    const revealed = countTable({ ...t, dealer: { ...t.dealer, holeDown: false } }, 'HI_LO');
    expect(revealed.cardsSeen).toBe(4);
    expect(revealed.running).toBe(-1);
  });

  it('counts a Super Sevens bonus card, because the felt shows it', () => {
    // The bonus card is dealt face up beside the circle. A card that left the
    // shoe and is never shown would be one the trainer counts behind the
    // player's back, which is why it is drawn rather than discarded.
    let t = createTable(
      { ...defaultRules(), sideBets: { ...defaultRules().sideBets, SUPER_SEVENS: true } },
      createRng('sevens'),
      { seats: 1 },
    );
    const stacked: Card[] = ([[7, S], [9, S], [7, H], [8, S], [5, S]] as Array<[Rank, Suit]>).map(
      ([r, su], i) => ({ rank: r, suit: su, id: 700_000 + i }),
    );
    t = { ...t, shoe: { ...t.shoe, cards: [...stacked, ...t.shoe.cards], pos: 0, size: t.shoe.size + 5 } };
    let res = setBet(t, 'A', dollars(10));
    if (!res.ok) throw new Error(res.reason);
    res = setSideBet(res.table, 'A', 'SUPER_SEVENS', dollars(10));
    if (!res.ok) throw new Error(res.reason);
    const dealt = deal(res.table, createRng('sevens'));
    if (!dealt.ok) throw new Error(dealt.reason);
    t = dealt.table;

    const wager = t.seats[0].pendingSideBets[0];
    expect(wager.bonus?.rank).toBe(5);
    // Five cards gone, one of them the dealer's hole card: four are visible.
    expect(t.shoe.pos).toBe(5);
    expect(countTable(t, 'HI_LO').cardsSeen).toBe(4);
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

  /*
   * Composing the two facts this file used to assert separately.
   *
   * It asserted that Knock-Out's initial running count is -20 at six decks,
   * and it asserted that `betRamp(0)` is one unit, and it never once put the
   * first number into the second. So nothing noticed that every consumer of
   * the count — the ramp, the edge estimate, the Illustrious 18, the
   * insurance decision — reads a number indexed in *Hi-Lo* true counts and
   * was being handed whatever the selected system produced. An untouched
   * six-deck shoe under Knock-Out reported a 10.4% player disadvantage and
   * fired every at-or-below deviation permanently.
   *
   * The rule that has to hold is the one a player would state: a shoe nobody
   * has dealt from is a neutral shoe, whichever system you are keeping.
   */
  describe('every system agrees about a shoe nobody has played', () => {
    for (const system of COUNT_ORDER) {
      it(`${COUNT_SYSTEMS[system].name} starts neutral`, () => {
        for (const decks of [1, 2, 6, 8]) {
          const shoe = createShoe(decks, 0.75, createRng(`neutral-${system}-${decks}`), 1);
          const count = countShoe(shoe, system, decks);

          expect(count.running, `${system} at ${decks} decks`).toBe(initialCount(system, decks));
          // The one number every published index is quoted in.
          expect(count.hiLo, `${system} at ${decks} decks`).toBeCloseTo(0, 6);
          expect(betRamp(count.hiLo)).toBe(1);
          expect(insuranceIsGood(count.hiLo)).toBe(false);
          expect(edgeAt(count.hiLo, 0.4)).toBeCloseTo(-0.4, 6);
          // And no index play is live at a shoe that has not been dealt from.
          expect(deviationFor(13, 2, count.hiLo)).toBeNull();
          expect(deviationFor(12, 3, count.hiLo)).toBeNull();
        }
      });
    }
  });

  /*
   * And the same thing again through the consumers rather than through the
   * conversion, because the defect lived in the consumers. A bot on an
   * untouched shoe must bet one unit and take no index play, whichever system
   * its counting is set to — if any of them starts reading the raw count
   * again, this is what fails.
   */
  it('plays the chart off a fresh shoe whichever system the bot counts in', () => {
    for (const system of COUNT_ORDER) {
      let t = createTable(defaultRules(), createRng(`bot-${system}`), { seats: 1 });
      // Seven, six against a deuce: hard thirteen, which the chart stands and
      // the Illustrious 18 hits *at or below* a true count of -1. Under the
      // raw Knock-Out count of -20 that index play fires on an untouched
      // shoe; under the Hi-Lo equivalent of zero it does not.
      const stacked: Card[] = ([[7, S], [2, H], [6, S], [10, H]] as Array<[Rank, Suit]>).map(
        ([r, su], i) => ({ rank: r, suit: su, id: 900_000 + i }),
      );
      t = { ...t, shoe: { ...t.shoe, cards: [...stacked, ...t.shoe.cards], pos: 0, size: t.shoe.size + 4 } };
      const withBet = setBet(t, 'A', dollars(10));
      if (!withBet.ok) throw new Error(withBet.reason);
      const dealt = deal(withBet.table, createRng(`bot-${system}`));
      if (!dealt.ok) throw new Error(dealt.reason);
      t = dealt.table;

      const bot = { ...DEFAULT_BOT, system, spread: true, deviations: true };
      expect(betFor(t, 'A', bot), `${system} bets off the top`).toBe(bot.unit);
      const choice = decide(t, bot);
      expect(choice?.action, `${system} plays 13 v 2 off the top`).toBe('STAND');
      expect(choice?.deviation, `${system} calls no index play off the top`).toBeUndefined();
    }
  });

  /*
   * And the conversion is not a no-op dressed up as one: each system reaches
   * the same Hi-Lo equivalent from a different running count, which is the
   * whole point of having one.
   */
  it('converts each system to the Hi-Lo count its indices are written in', () => {
    // Knock-Out's pivot is +4 for every shoe size, and at the pivot its own
    // claim — that you never need to divide — is exactly true.
    expect(hiLoEquivalent(4, 1, 'KO')).toBeCloseTo(4, 6);
    expect(hiLoEquivalent(4, 3, 'KO')).toBeCloseTo(4, 6);
    expect(hiLoEquivalent(-20, 6, 'KO')).toBeCloseTo(0, 6);

    // A balanced level-one count is already the number the indices use.
    expect(hiLoEquivalent(6, 3, 'HI_LO')).toBeCloseTo(2, 6);

    // Level-two tags run to ±2, so their true counts run to about double.
    expect(hiLoEquivalent(12, 3, 'OMEGA_II')).toBeCloseTo(2, 6);
    expect(hiLoEquivalent(12, 3, 'HI_OPT_II')).toBeCloseTo(2, 6);
  });
});
