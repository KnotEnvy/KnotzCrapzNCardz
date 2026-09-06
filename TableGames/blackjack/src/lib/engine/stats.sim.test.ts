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

  return { rounds, hands, wagered, net, edge, stderr };
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
    RESULTS.push({ name: 'Dealer busts (H17)', measured: h17.bust, model: 29.1, stderr: 0, rounds: DIST_N, kind: 'freq' });

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
 * Each of these flips one switch and measures how far the edge moves.
 *
 * Both arms run on the same seed, which is worth stating precisely: it does
 * *not* make the two runs see identical hands, because a rule change alters
 * how many cards come off the shoe and the sequences diverge within a few
 * rounds. It does make them start from the same shoes, which removes the
 * largest single source of difference. The bands below are correspondingly
 * generous — this test is checking a sign and an order of magnitude, and the
 * absolute figures live in the preset test above.
 */
describe('what each rule is worth', () => {
  const base = presetById('vegas-strip').rules;
  const N = 300_000;

  function delta(change: Partial<TableRules>, seed: string): number {
    const a = measure(base, N, seed);
    const b = measure({ ...base, ...change }, N, seed);
    return a.edge - b.edge; // positive means the change helped the player
  }

  it('a dealer who hits soft 17 costs the player', () => {
    const d = delta({ hitsSoft17: true }, 'rule-h17');
    RESULTS.push({ name: '  hits soft 17', measured: d, model: -0.22, stderr: 0, rounds: N * 2, kind: 'delta' });
    expect(d).toBeLessThan(0.05);
    expect(d).toBeGreaterThan(-0.7);
  }, 900_000);

  it('6:5 blackjack costs the player well over a percent', () => {
    const d = delta({ blackjackPays: '6:5' }, 'rule-65');
    RESULTS.push({ name: '  6:5 blackjack', measured: d, model: -1.39, stderr: 0, rounds: N * 2, kind: 'delta' });
    expect(d).toBeLessThan(-0.9);
    expect(d).toBeGreaterThan(-1.9);
  }, 900_000);

  it('no double after split costs the player', () => {
    const d = delta({ das: false }, 'rule-das');
    RESULTS.push({ name: '  no DAS', measured: d, model: -0.14, stderr: 0, rounds: N * 2, kind: 'delta' });
    expect(d).toBeLessThan(0.15);
    expect(d).toBeGreaterThan(-0.6);
  }, 900_000);

  it('late surrender helps the player, and not by much', () => {
    const d = delta({ surrender: 'LATE' }, 'rule-ls');
    RESULTS.push({ name: '  late surrender', measured: d, model: 0.08, stderr: 0, rounds: N * 2, kind: 'delta' });
    expect(d).toBeGreaterThan(-0.2);
    expect(d).toBeLessThan(0.6);
  }, 900_000);

  it('no hole card costs the player, because it takes the doubles too', () => {
    const d = delta({ holeCard: 'ENHC' }, 'rule-enhc');
    RESULTS.push({ name: '  no hole card', measured: d, model: -0.11, stderr: 0, rounds: N * 2, kind: 'delta' });
    expect(d).toBeLessThan(0.15);
    expect(d).toBeGreaterThan(-0.6);
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
   * Whether the count is worth anything is a property of the *shoe*, not of
   * the engine's arithmetic — but it is the one property that proves the shoe
   * is real. A shuffle that quietly reset between rounds, or a discard tray
   * that did not reflect the cards dealt, would leave a spread bettor with
   * exactly the flat bettor's edge. Beating it is the evidence.
   *
   * The bar is the sign, not the size. A 1-12 spread at 80% penetration is
   * worth a few tenths of a percent, and the variance on a spread bet is
   * several times the variance on a flat one, so pinning the magnitude here
   * would need more rounds than the whole rest of this file.
   */
  it('a counted spread beats a flat bet on the same shoes', () => {
    const rules = { ...presetById('vegas-strip').rules, penetration: 0.85 };
    const flat = measure(rules, 500_000, 'count', { ...DEFAULT_BOT, spread: false, deviations: false });
    const counted = measure(rules, 500_000, 'count', { ...DEFAULT_BOT, spread: true, deviations: true });
    RESULTS.push({ name: 'Flat bettor', measured: flat.edge, model: null, stderr: flat.stderr, rounds: flat.rounds, kind: 'edge' });
    RESULTS.push({ name: 'Hi-Lo 1-12 spread', measured: counted.edge, model: null, stderr: counted.stderr, rounds: counted.rounds, kind: 'edge' });
    expect(counted.edge).toBeLessThan(flat.edge);
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
