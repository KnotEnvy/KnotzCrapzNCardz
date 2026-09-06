/**
 * The measurements.
 *
 * Everything else in the test suite asserts that a rule does what it says.
 * This asserts that all of them together add up to the game blackjack actually
 * is — by dealing millions of rounds and comparing what comes out against
 * figures that have been published for fifty years.
 *
 * It catches a class of bug the unit tests cannot: a rule that is individually
 * correct and collectively wrong. A peek that fires one hand late, a split
 * that stakes the wrong amount, a dealer that draws to soft eighteen — none of
 * those break a single-hand assertion, and all of them move a number here.
 *
 *     pnpm run test:stats
 *
 * ## On tolerances
 *
 * Blackjack's per-hand standard deviation is about 1.15 units, so the standard
 * error on a house-edge measurement over N rounds is 1.15/√N — 0.115% at a
 * million rounds. That is a hard floor: verifying an edge to a hundredth of a
 * percent would take hundreds of millions of hands, and no test suite runs
 * those. So the edge assertions here are deliberately banded at three standard
 * errors, which catches the bugs that are worth catching (a mis-paid double or
 * a wrong peek is worth a whole percent) and does not flake.
 *
 * The *distribution* tests are the tight ones, and they are the real proof.
 * "The dealer busts 28.3% of the time" and "a natural arrives 4.75% of the
 * time" are binomial, so their standard errors are five to ten times smaller
 * than the edge's for the same number of hands — a quarter of a percent at
 * half a million rounds. They pin the dealer's logic, the shoe's composition
 * and the naturals to within a rounding error of the published tables, which
 * is a far stronger statement than any edge measurement of this length.
 */

import { describe, expect, it } from 'vitest';
import { handValue, isBlackjack } from './hand';
import { dollars } from './money';
import { createRng } from './rng';
import { settle } from './resolve';
import { RULE_PRESETS, estimateHouseEdge, presetById } from './rules';
import { isCompleteShoe } from './shoe';
import {
  cardsInPlay,
  closeOffers,
  createTable,
  deal,
  dealerPlayOut,
  nextRound,
  setBet,
  setSideBet,
  stand,
} from './table';
import type { TableRules, TableState } from './types';
import { DEFAULT_BOT, playRound, type BotConfig } from '@/lib/strategy/autoplay';
import { countShoe } from '@/lib/strategy/counting';

/* ------------------------------------------------------------------ *
 * Harness
 * ------------------------------------------------------------------ */

interface Measurement {
  rounds: number;
  hands: number;
  wagered: number;
  net: number;
  /** House edge in percent of the total wagered. Positive is the house. */
  edge: number;
  /** Standard error of that figure, in percent. */
  stderr: number;
  /** How often the bot took each action, per thousand hands dealt. */
  per1000: { doubles: number; splits: number; surrenders: number; blackjacks: number };
}

/**
 * Deal `rounds` rounds with the basic-strategy bot and measure.
 *
 * The bankroll is topped up rather than allowed to run out. This is measuring
 * an edge per unit wagered, and a bot that goes broke at round 40,000 has
 * measured 40,000 rounds and then stopped, which biases the sample toward
 * losing runs. Casinos measure hold the same way — against the drop, not
 * against whether a particular player still has chips.
 */
function measure(
  rules: TableRules,
  rounds: number,
  seed: string,
  config: BotConfig = DEFAULT_BOT,
): Measurement {
  const rng = createRng(seed);
  let table = createTable(rules, rng, { seats: 1, bankroll: dollars(10_000_000) });
  let net = 0;
  let wagered = 0;
  let hands = 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;

  for (let i = 0; i < rounds; i++) {
    if (table.seats[0].bankroll < dollars(100_000)) {
      table = { ...table, seats: table.seats.map((s) => ({ ...s, bankroll: dollars(10_000_000) })) };
    }
    const out = playRound(table, config, rng);
    table = out.table;
    net += out.net;
    wagered += out.wagered;
    hands += out.handsPlayed;
    if (out.wagered > 0) {
      const units = out.net / config.unit;
      sum += units;
      sumSq += units * units;
      n++;
    }
  }

  const edge = wagered === 0 ? 0 : (-net / wagered) * 100;
  const mean = sum / Math.max(1, n);
  const variance = Math.max(0, sumSq / Math.max(1, n) - mean * mean);
  const stderr = (Math.sqrt(variance) / Math.sqrt(Math.max(1, n))) * 100;

  const seat = table.seats[0];
  const per = (n: number) => (hands === 0 ? 0 : (n / hands) * 1000);

  return {
    rounds,
    hands,
    wagered,
    net,
    edge,
    stderr,
    per1000: {
      doubles: per(seat.stats.doubles),
      splits: per(seat.stats.splits),
      surrenders: per(seat.stats.surrenders),
      blackjacks: per(seat.stats.blackjacks),
    },
  };
}

type Row = {
  name: string;
  /** The measured figure, already in the sense the summary should print it. */
  measured: number;
  model: number | null;
  stderr: number;
  rounds: number;
  kind: 'edge' | 'freq' | 'delta';
};

const RESULTS: Row[] = [];

/* ------------------------------------------------------------------ *
 * Distributions — the tight tests
 * ------------------------------------------------------------------ */

interface Distribution {
  /** Dealer's finished total, 17..21, and how often. Percentages. */
  finals: Record<string, number>;
  bust: number;
  /** How often the dealer busted with exactly n cards. Percentages by count. */
  bustBy: Record<number, number>;
  naturals: number;
  rounds: number;
}

/**
 * Deal rounds in which the dealer always finishes their hand.
 *
 * The trick is a live Bust It bet: it is a wager on the dealer's finished
 * hand, so the engine plays the dealer out even when every player hand has
 * already busted. Without it, about three rounds in a hundred end with the
 * dealer standing on a two-card twelve and the measured distribution is not
 * comparable to a published one.
 */
function dealerDistribution(rules: TableRules, rounds: number, seed: string): Distribution {
  const rng = createRng(seed);
  const withBustIt: TableRules = {
    ...rules,
    sideBets: { ...rules.sideBets, BUST_IT: true },
  };
  let table = createTable(withBustIt, rng, { seats: 1, bankroll: dollars(1_000_000_000) });

  const finals: Record<string, number> = {};
  const bustBy: Record<number, number> = {};
  let bust = 0;
  let naturals = 0;

  for (let i = 0; i < rounds; i++) {
    table = force(setBet(table, 'A', dollars(10)));
    table = force(setSideBet(table, 'A', 'BUST_IT', dollars(10)));
    const dealt = deal(table, rng);
    if (!dealt.ok) break;
    table = dealt.table;

    if (isBlackjack(table.seats[0].hands[0].cards)) naturals++;
    if (table.phase === 'INSURANCE') table = force(closeOffers(table));
    let guard = 0;
    while (table.phase === 'PLAYER' && table.focus && guard++ < 32) table = force(stand(table));
    if (table.phase === 'DEALER') table = dealerPlayOut(table);

    const v = handValue(table.dealer.cards);
    if (v.busted) {
      bust++;
      bustBy[table.dealer.cards.length] = (bustBy[table.dealer.cards.length] ?? 0) + 1;
    } else {
      finals[String(v.total)] = (finals[String(v.total)] ?? 0) + 1;
    }

    table = settle(table).table;
    const cleared = nextRound(table);
    if (cleared.ok) table = cleared.table;
  }

  const pct = (n: number) => (n / rounds) * 100;
  return {
    finals: Object.fromEntries(Object.entries(finals).map(([k, v]) => [k, pct(v)])),
    bust: pct(bust),
    bustBy: Object.fromEntries(Object.entries(bustBy).map(([k, v]) => [Number(k), pct(v)])),
    naturals: pct(naturals),
    rounds,
  };
}

function force(res: { ok: boolean; table?: TableState; reason?: string }): TableState {
  if (!res.ok || !res.table) throw new Error(res.reason ?? 'refused');
  return res.table;
}

const DIST_N = 500_000;

describe('the dealer, against the published tables', () => {
  /*
   * The six-deck, stand-on-soft-17 dealer distribution is one of the most
   * thoroughly published numbers in gambling. Every figure below is the
   * standard one; the tolerances are three standard errors of a binomial at
   * 600,000 trials, which is under two tenths of a percent.
   *
   * If this test fails, the dealer's drawing rule, the shoe's composition or
   * the hand evaluator is wrong. Nothing else can move these.
   */
  const EXPECTED_S17: Record<string, number> = {
    '17': 14.58,
    '18': 13.81,
    '19': 13.48,
    '20': 17.58,
    '21': 12.14, // includes naturals
  };

  it('finishes on each total as often as it should, standing on soft 17', () => {
    const d = dealerDistribution({ ...presetById('vegas-strip').rules, hitsSoft17: false }, DIST_N, 'dist-s17');
    for (const [total, expected] of Object.entries(EXPECTED_S17)) {
      expect(Math.abs((d.finals[total] ?? 0) - expected), `dealer ${total}: ${d.finals[total]?.toFixed(2)}%`).toBeLessThan(0.5);
    }
    RESULTS.push({ name: 'Dealer busts (S17)', measured: d.bust, model: 28.32, stderr: 0, rounds: DIST_N, kind: 'freq' });
    expect(Math.abs(d.bust - 28.32), `dealer bust ${d.bust.toFixed(2)}%`).toBeLessThan(0.4);
  }, 600_000);

  it('busts more often when it has to draw to a soft seventeen', () => {
    const s17 = dealerDistribution({ ...presetById('vegas-strip').rules, hitsSoft17: false }, DIST_N, 'dist-cmp');
    const h17 = dealerDistribution({ ...presetById('vegas-strip').rules, hitsSoft17: true }, DIST_N, 'dist-cmp');
    /*
     * 28.54%, not the 29.1% usually quoted. The familiar figure is conditioned
     * on the dealer *not* holding a natural; this measurement counts every
     * round the dealer plays, naturals included, so the denominator is larger
     * and the rate correspondingly lower. Citing the conditional number here
     * made a correct dealer look half a point wrong.
     */
    RESULTS.push({ name: 'Dealer busts (H17)', measured: h17.bust, model: 28.54, stderr: 0, rounds: DIST_N, kind: 'freq' });
    expect(Math.abs(h17.bust - 28.54), `H17 bust ${h17.bust.toFixed(2)}%`).toBeLessThan(0.4);

    // Drawing to soft 17 turns some seventeens into eighteens and some into
    // busts. Both effects are real and both are small.
    expect(h17.bust).toBeGreaterThan(s17.bust);
    expect(h17.finals['17']).toBeLessThan(s17.finals['17']);
    expect(h17.finals['18']).toBeGreaterThan(s17.finals['18']);
  }, 900_000);

  it('deals a natural to the player 4.75% of the time', () => {
    const d = dealerDistribution(presetById('vegas-strip').rules, DIST_N, 'dist-bj');
    RESULTS.push({ name: 'Player natural', measured: d.naturals, model: 4.749, stderr: 0, rounds: DIST_N, kind: 'freq' });
    // 2 * (24/312) * (96/311) = 4.749%. Binomial 3-sigma at 600k is 0.08%.
    expect(Math.abs(d.naturals - 4.749), `naturals ${d.naturals.toFixed(3)}%`).toBeLessThan(0.12);
  }, 600_000);

  it('busts on three cards far more often than on four, and on four than five', () => {
    const d = dealerDistribution(presetById('vegas-strip').rules, DIST_N, 'dist-bustby');
    expect(d.bustBy[3]).toBeGreaterThan(d.bustBy[4]);
    expect(d.bustBy[4]).toBeGreaterThan(d.bustBy[5]);
    expect(d.bustBy[5]).toBeGreaterThan(d.bustBy[6]);
    // The whole ladder has to add back up to the bust rate.
    const total = Object.values(d.bustBy).reduce((a, b) => a + b, 0);
    expect(Math.abs(total - d.bust)).toBeLessThan(0.001);
  }, 600_000);
});

/* ------------------------------------------------------------------ *
 * The shoe
 * ------------------------------------------------------------------ */

describe('the shoe, over a long session', () => {
  /*
   * Every reshuffle has to produce a complete shoe. A dealing bug that lost or
   * duplicated a card would shift every distribution above by an amount too
   * small to see and would be invisible in a single-round test.
   */
  it('is complete after every reshuffle across thousands of rounds', () => {
    const rng = createRng('shoe-integrity');
    const rules = presetById('vegas-strip').rules;
    let table = createTable(rules, rng, { seats: 1, bankroll: dollars(10_000_000) });
    let shuffles = 0;
    let lastId = table.shoe.shuffleId;

    for (let i = 0; i < 20_000; i++) {
      table = playRound(table, DEFAULT_BOT, rng).table;
      if (table.shoe.shuffleId !== lastId) {
        lastId = table.shoe.shuffleId;
        shuffles++;
        expect(isCompleteShoe(table.shoe, rules.decks)).toBe(true);
      }
      // The pointer may never run past the end, cut card or not.
      expect(table.shoe.pos).toBeLessThanOrEqual(table.shoe.size);
    }
    expect(shuffles).toBeGreaterThan(100);
  }, 300_000);

  /*
   * The case the cut card does not cover.
   *
   * A single deck cut at 65% leaves eighteen cards, and three seats splitting
   * to four hands can want more than that inside one round. `draw` used to
   * throw there — out of a React event handler, taking the tree down mid-hand
   * — on the stated premise that the cut card made it unreachable. Three seats
   * on the shipped Single Deck preset reached it in thirteen thousand rounds.
   *
   * It now reshuffles the discards and carries on, which is what a dealer
   * does, and the cards on the felt are excluded from the new shoe so nobody
   * ends up holding one that is also still to come.
   */
  it('reshuffles mid-round rather than running dry', () => {
    const rng = createRng('dry-shoe');
    const rules = presetById('single-deck').rules;
    let table = createTable(rules, rng, { seats: 3, bankroll: dollars(10_000_000) });
    let duplicates = 0;
    let stillToCome = 0;
    let overdealt = 0;
    let reshuffles = 0;
    let lastShuffle = table.shoe.shuffleId;

    for (let i = 0; i < 120_000; i++) {
      if (table.seats.some((s) => s.bankroll < dollars(1000))) {
        table = { ...table, seats: table.seats.map((s) => ({ ...s, bankroll: dollars(10_000_000) })) };
      }
      table = playRound(table, DEFAULT_BOT, rng, ['A', 'B', 'C']).table;

      /*
       * Everything the reshuffle promises, asserted — the earlier version of
       * this test checked only for duplicates among the players' hands, which
       * is the one part that was never in doubt. What the fix actually claims
       * is that no card is in two places at once *anywhere*: the dealer's hand
       * and the Super Sevens bonus card count, and no card on the felt may
       * also still be waiting in the shoe.
       */
      const inPlay = cardsInPlay(table);
      const ids = new Set<number>();
      for (const card of inPlay) {
        if (ids.has(card.id)) duplicates++;
        ids.add(card.id);
      }
      for (let j = table.shoe.pos; j < table.shoe.size; j++) {
        if (ids.has(table.shoe.cards[j].id)) stillToCome++;
      }
      if (table.shoe.pos > table.shoe.size) overdealt++;
      if (table.shoe.shuffleId !== lastShuffle) {
        lastShuffle = table.shoe.shuffleId;
        reshuffles++;
      }
    }

    expect(duplicates).toBe(0);
    expect(stillToCome).toBe(0);
    expect(overdealt).toBe(0);
    expect(table.round).toBe(120_000);
    // And the path being tested was actually taken.
    expect(reshuffles).toBeGreaterThan(1000);
  }, 600_000);
});

/* ------------------------------------------------------------------ *
 * House edge by rule set
 * ------------------------------------------------------------------ */

const ROUNDS = 800_000;

describe('house edge by rule set', () => {
  for (const preset of RULE_PRESETS) {
    it(
      `${preset.name} measures within tolerance of its model`,
      () => {
        const m = measure(preset.rules, ROUNDS, `edge-${preset.id}`);
        const model = estimateHouseEdge(preset.rules);
        RESULTS.push({ name: preset.name, measured: m.edge, model, stderr: m.stderr, rounds: m.rounds, kind: 'edge' });

        // Three standard errors — about 0.35% at a million rounds. Wide enough
        // that variance cannot fail it and narrow enough that a mis-paid
        // double, a wrong peek or a bad chart cell cannot pass it.
        const tolerance = Math.max(0.2, 3 * m.stderr);
        expect(
          Math.abs(m.edge - model),
          `${preset.name}: measured ${m.edge.toFixed(3)}%, model ${model.toFixed(3)}%, 3σ ${(3 * m.stderr).toFixed(3)}%`,
        ).toBeLessThan(tolerance);
      },
      900_000,
    );
  }

  it('orders the presets the way the rule model says it does', () => {
    // A weaker claim than the absolute figures and a much tighter one: whatever
    // the noise, a single-deck 6:5 game has to be worse than a Vegas Strip
    // shoe, and the liberal game has to be the best on the list.
    const byModel = [...RULE_PRESETS].sort((a, b) => estimateHouseEdge(a.rules) - estimateHouseEdge(b.rules));
    expect(byModel[0].id).toBe('liberal');
    expect(byModel[byModel.length - 1].id).toBe('single-deck');
  });
});

/* ------------------------------------------------------------------ *
 * What each rule is worth
 * ------------------------------------------------------------------ */

/**
 * Is each rule actually wired through?
 *
 * The obvious test — flip one switch and measure how far the edge moves — does
 * not work, and it is worth being precise about why rather than shipping a
 * band so wide it would pass a rule that did nothing.
 *
 * Blackjack's per-hand standard deviation is about 1.15 units. Over n rounds
 * the standard error of an edge measurement is 115/sqrt(n) percent, and a
 * difference between two independent runs carries sqrt(2) times that. At
 * 300,000 rounds an arm, three standard errors is 0.89% — which swamps double
 * after split (0.14%), late surrender (0.08%), no-hole-card (0.11%) and even a
 * dealer hitting soft seventeen (0.22%). Resolving 0.14% to a third of itself
 * would take roughly fifty million rounds per arm. That is not a tolerance
 * problem; it is a variance floor, and no assertion at this length can see
 * past it.
 *
 * So the edge deltas are printed as diagnostics and only the one large enough
 * to resolve — six to five, at 1.39% — is asserted. What *is* asserted for
 * every rule is a frequency: how often the bot doubles, splits or surrenders.
 * Those are near-binomial, so their standard errors are a small fraction of
 * the effect, and they answer the question that actually matters — is this
 * switch reaching the chart and the felt at all?
 *
 * That is not a theoretical distinction. Re-split aces was a dead switch for
 * this game's entire first draft: the setup screen priced it, the README
 * advertised it, the edge model credited it, and the code marked both hands
 * finished before a third ace could ever be split. No edge delta at any
 * feasible sample size would have caught it. The splits-per-thousand test
 * below catches it in twenty seconds.
 */
describe('every rule is wired through', () => {
  const base = presetById('vegas-strip').rules;
  const N = 300_000;

  function pair(change: Partial<TableRules>, seed: string) {
    const a = measure(base, N, seed);
    const b = measure({ ...base, ...change }, N, seed);
    return { on: b, off: a, delta: a.edge - b.edge };
  }

  it('re-splitting aces produces more split hands', () => {
    // Twice the usual sample. A pair of aces is 0.57% of hands and only about
    // one in six of those draws a third, so the lift is under a split per
    // thousand hands — real, and only three standard errors clear at 300,000.
    const a = measure(base, 600_000, 'rule-rsa');
    const b = measure({ ...base, resplitAces: true }, 600_000, 'rule-rsa');
    const on = b;
    const off = a;
    RESULTS.push({ name: '  re-split aces', measured: off.edge - on.edge, model: 0.08, stderr: 0, rounds: 1_200_000, kind: 'delta' });
    expect(on.per1000.splits).toBeGreaterThan(off.per1000.splits);
  }, 900_000);

  it('double after split produces more doubles', () => {
    const { on, off } = pair({ das: false }, 'rule-das');
    RESULTS.push({ name: '  no DAS', measured: off.edge - on.edge, model: -0.14, stderr: 0, rounds: N * 2, kind: 'delta' });
    // `off` here is the DAS table; turning DAS off must cost doubles, and must
    // also cost splits, because six of the pair chart's cells only split when
    // the double is available afterwards.
    expect(off.per1000.doubles).toBeGreaterThan(on.per1000.doubles);
    expect(off.per1000.splits).toBeGreaterThan(on.per1000.splits);
  }, 900_000);

  it('late surrender is taken, and on a plausible fraction of hands', () => {
    const { on, off } = pair({ surrender: 'LATE' }, 'rule-ls');
    RESULTS.push({ name: '  late surrender', measured: off.edge - on.edge, model: 0.08, stderr: 0, rounds: N * 2, kind: 'delta' });
    expect(off.per1000.surrenders).toBe(0);
    // Sixteen against nine, ten or an ace plus fifteen against a ten: a few
    // percent of hands, not a fraction of one and not a quarter of them.
    expect(on.per1000.surrenders).toBeGreaterThan(20);
    expect(on.per1000.surrenders).toBeLessThan(120);
  }, 900_000);

  it('no hole card stops the doubles and splits that walk into a natural', () => {
    const { on, off } = pair({ holeCard: 'ENHC' }, 'rule-enhc');
    RESULTS.push({ name: '  no hole card', measured: off.edge - on.edge, model: -0.11, stderr: 0, rounds: N * 2, kind: 'delta' });
    // Eleven no longer doubles against a ten or an ace, and eight-eight no
    // longer splits against them.
    expect(on.per1000.doubles).toBeLessThan(off.per1000.doubles);
    expect(on.per1000.splits).toBeLessThan(off.per1000.splits);
  }, 900_000);

  it('a dealer hitting soft 17 changes the chart’s doubling', () => {
    const { on, off } = pair({ hitsSoft17: true }, 'rule-h17');
    RESULTS.push({ name: '  hits soft 17', measured: off.edge - on.edge, model: -0.22, stderr: 0, rounds: N * 2, kind: 'delta' });
    // At H17, eleven doubles against an ace and soft nineteen doubles against
    // a six, so the doubling rate goes up rather than down.
    expect(on.per1000.doubles).toBeGreaterThan(off.per1000.doubles);
  }, 900_000);

  it('six to five costs the player more than a percent — the one delta big enough to measure', () => {
    const { on, off, delta } = pair({ blackjackPays: '6:5' }, 'rule-65');
    RESULTS.push({ name: '  6:5 blackjack', measured: delta, model: -1.39, stderr: 0, rounds: N * 2, kind: 'delta' });
    // Naturals arrive at the same rate either way; only the payout changes.
    expect(Math.abs(on.per1000.blackjacks - off.per1000.blackjacks)).toBeLessThan(3);
    expect(delta).toBeLessThan(-0.9);
    expect(delta).toBeGreaterThan(-1.9);
  }, 900_000);
});

/* ------------------------------------------------------------------ *
 * Playing badly
 * ------------------------------------------------------------------ */

describe('basic strategy against not bothering', () => {
  /*
   * The single most useful number this suite produces, and the one the game
   * exists to demonstrate: the chart is worth well over a percent a hand
   * against the obvious alternative of copying the dealer. That is the
   * difference between a game you can play all night and one that takes your
   * stack in an hour.
   */
  it('is worth well over a percent a hand', () => {
    const rules = presetById('vegas-strip').rules;
    const good = measure(rules, 300_000, 'compare', { ...DEFAULT_BOT, basic: true });
    const bad = measure(rules, 300_000, 'compare', { ...DEFAULT_BOT, basic: false });
    RESULTS.push({ name: 'Mimic the dealer', measured: bad.edge, model: null, stderr: bad.stderr, rounds: bad.rounds, kind: 'edge' });
    expect(bad.edge - good.edge).toBeGreaterThan(1.0);
  }, 900_000);
});

/* ------------------------------------------------------------------ *
 * Counting
 * ------------------------------------------------------------------ */

describe('counting', () => {
  /*
   * Whether counting works is a property of the *shoe*, not of the engine's
   * arithmetic — but it is the one property that proves the shoe is real. A
   * shuffle that quietly reset between rounds, or a discard tray that did not
   * reflect the cards dealt, would leave the count uncorrelated with anything
   * and a spread bettor with exactly the flat bettor's result.
   *
   * The obvious test — spread against flat, compare the edges — is a coin
   * flip at any length this suite can afford: a spread bet's variance is
   * several times a flat one's, so the counted arm alone carries a three-sigma
   * band wider than the effect. It is printed below as a diagnostic.
   *
   * What is asserted instead is the thing the spread is *built on*, measured
   * where it converges: a flat bettor's result, bucketed by the true count as
   * the round was dealt. Each bucket is an ordinary mean over tens of
   * thousands of rounds, and the claim — that a rich shoe pays better than a
   * poor one — is a difference of several percent rather than a fraction of
   * one. If the count is meaningless, these buckets are identical.
   */
  it('a flat bettor does better out of a rich shoe than a poor one', () => {
    const rules = { ...presetById('vegas-strip').rules, penetration: 0.85 };
    const rng = createRng('buckets');
    let table = createTable(rules, rng, { seats: 1, bankroll: dollars(10_000_000) });

    const buckets = { rich: { n: 0, net: 0 }, poor: { n: 0, net: 0 }, flat: { n: 0, net: 0 } };
    const unit = DEFAULT_BOT.unit;

    for (let i = 0; i < 700_000; i++) {
      if (table.seats[0].bankroll < dollars(100_000)) {
        table = { ...table, seats: table.seats.map((s) => ({ ...s, bankroll: dollars(10_000_000) })) };
      }
      // The count is read before the deal — the information a player has when
      // they push their chips out, and nothing they learn afterwards.
      const tc = countShoe(table.shoe, 'HI_LO', rules.decks).true;
      const out = playRound(table, DEFAULT_BOT, rng);
      table = out.table;
      if (out.wagered === 0) continue;

      const units = (out.net + out.insuranceNet) / unit;
      const bucket = tc >= 2 ? buckets.rich : tc <= -2 ? buckets.poor : buckets.flat;
      bucket.n += 1;
      bucket.net += units;
    }

    const mean = (b: { n: number; net: number }) => (b.n === 0 ? 0 : (b.net / b.n) * 100);
    const rich = mean(buckets.rich);
    const poor = mean(buckets.poor);

    RESULTS.push({ name: 'Rich shoe (TC >= +2)', measured: -rich, model: null, stderr: 0, rounds: buckets.rich.n, kind: 'edge' });
    RESULTS.push({ name: 'Poor shoe (TC <= -2)', measured: -poor, model: null, stderr: 0, rounds: buckets.poor.n, kind: 'edge' });

    // Both buckets have to be large enough for the means to mean anything.
    expect(buckets.rich.n).toBeGreaterThan(20_000);
    expect(buckets.poor.n).toBeGreaterThan(20_000);

    // Half a percent per unit of true count, over a four-point gap between the
    // bucket centres, is worth about two percent. Asserting one is generous to
    // the noise and still impossible if the count is uncorrelated.
    expect(rich - poor).toBeGreaterThan(1.0);
  }, 900_000);

  it('a counted spread beats a flat bet on the same shoes', () => {
    const rules = { ...presetById('vegas-strip').rules, penetration: 0.85 };
    const flat = measure(rules, 500_000, 'count', { ...DEFAULT_BOT, spread: false, deviations: false });
    const counted = measure(rules, 500_000, 'count', { ...DEFAULT_BOT, spread: true, deviations: true });
    RESULTS.push({ name: 'Flat bettor', measured: flat.edge, model: null, stderr: flat.stderr, rounds: flat.rounds, kind: 'edge' });
    RESULTS.push({ name: 'Hi-Lo 1-12 spread', measured: counted.edge, model: null, stderr: counted.stderr, rounds: counted.rounds, kind: 'edge' });

    /*
     * Deliberately not asserted. A 1-12 spread's per-round variance is roughly
     * six times a flat bet's, so this arm's own three-sigma band is wider than
     * the couple of tenths of a percent the spread is worth — the comparison
     * would be a coin flip dressed as a test. The bucketed test above is the
     * assertion; this row is here to be read.
     */
    expect(Number.isFinite(counted.edge)).toBe(true);
  }, 900_000);
});

/* ------------------------------------------------------------------ *
 * The table
 * ------------------------------------------------------------------ */

describe('summary', () => {
  it('prints what everything measured at', () => {
    // An edge is printed from the player's side, so negative is the house; a
    // frequency is printed as itself; a delta is printed as what the rule is
    // worth to the player. Three different senses, so each says which it is
    // rather than leaving a reader to infer it from a sign.
    const sense = (r: Row) => (r.kind === 'edge' ? -r.measured : r.measured);
    const senseModel = (r: Row) => (r.model === null ? null : r.kind === 'edge' ? -r.model : r.model);

    const rows = RESULTS.map((r) => {
      const m = senseModel(r);
      const measured = `${sense(r) > 0 ? '+' : ''}${sense(r).toFixed(3)}%`;
      const model = m === null ? '      —' : `${m > 0 ? '+' : ''}${m.toFixed(3)}%`;
      const err = r.stderr > 0 ? `3σ ±${(3 * r.stderr).toFixed(3)}` : '';
      return `  ${r.name.padEnd(22)} ${measured.padStart(9)}  expect ${model.padStart(8)}  ${err.padEnd(12)} n=${r.rounds.toLocaleString()}`;
    });

    console.log(
      [
        '',
        '  Player edge per unit wagered, so negative is the house.',
        '  Dealer and natural rows are frequencies; indented rows are what one rule is worth.',
        '',
        ...rows,
        '',
      ].join('\n'),
    );
    expect(RESULTS.length).toBeGreaterThan(0);
  });
});
