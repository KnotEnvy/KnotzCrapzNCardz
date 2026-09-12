/**
 * The measurements.
 *
 * `analysis.ts` says exactly what the game is worth. This deals it — a million
 * rounds through the same exported actions the buttons call, shuffle, deal,
 * decide, reveal, settle — and checks that what comes out is that game.
 *
 * It catches the class of bug the unit tests cannot: rules that are each right
 * and together wrong. A qualifier that fires on the player's hand, an Ante
 * Bonus that pays a folded straight, a deal that hands two seats the same card,
 * a shuffle that is not quite uniform — none of those breaks a single-hand
 * assertion, and every one of them moves a number here.
 *
 *     pnpm run test:stats
 *
 * ## On tolerances
 *
 * Every band below is computed from the run, not chosen. A house edge is a
 * mean, and its standard error is the per-round standard deviation over the
 * square root of the rounds — which this suite measures as it goes, rather
 * than asserting a tolerance that happened to pass on the seeds it was
 * written against. The blackjack suite learned that from its Bust It test,
 * which passed twice by luck at a band a third of its real width.
 *
 * The frequencies are binomial and their bands are exact. There are sixteen of
 * them, so they are held at four standard errors rather than three: at three,
 * one of sixteen honest measurements would fall outside its band about one run
 * in twenty-five, and a seeded suite that fails by chance fails every time.
 */

import { describe, expect, it } from 'vitest';
import {
  ANTE_PLAY_TOTALS,
  SIX_CARD_COUNTS,
  SIX_CARD_SETS,
  STRATEGY_LABEL,
  THREE_CARD_COUNTS,
  THREE_CARD_HANDS,
  antePlayFigures,
  pairPlusFigures,
  qualifyingHands,
  sixCardFigures,
  type StrategyId,
} from './analysis';
import { dollars } from './money';
import { createRng } from './rng';
import { defaultRules } from './rules';
import { createTable } from './table';
import type { HandCategory, SeatId, SixCardCategory, TableState, Wagers } from './types';
import { HAND_CATEGORIES, SIX_CARD_CATEGORIES } from './types';
import { playRound } from '@/lib/strategy/autoplay';

const STAKE = dollars(10);

/** A running mean and variance, for bands computed from the run. */
class Tally {
  n = 0;
  sum = 0;
  sumSq = 0;
  add(x: number): void {
    this.n++;
    this.sum += x;
    this.sumSq += x * x;
  }
  get mean(): number {
    return this.n === 0 ? 0 : this.sum / this.n;
  }
  get stderr(): number {
    if (this.n < 2) return 0;
    const variance = Math.max(0, this.sumSq / this.n - this.mean * this.mean);
    return Math.sqrt(variance / this.n);
  }
}

interface Measurement {
  strategy: StrategyId;
  rounds: number;
  /** Per round, in units of the Ante: Ante, Play and Ante Bonus together. */
  main: Tally;
  /** Per round, in units of Ante plus Play: the element of risk's denominator. */
  action: number;
  pairPlus: Tally;
  sixCard: Tally;
  plays: number;
  qualified: number;
  hands: Record<HandCategory, number>;
  sixCardHands: Record<SixCardCategory, number>;
}

/**
 * Deal `rounds` rounds at one seat and measure.
 *
 * The bankroll is topped up rather than allowed to run out, because a run that
 * stops when the bot goes broke is biased toward losing streaks.
 */
function measure(strategy: StrategyId, rounds: number, seed: string, sideBets: boolean): Measurement {
  const rng = createRng(seed);
  let table: TableState = createTable(defaultRules(), { seats: 1, bankroll: dollars(10_000_000) });
  const bets = new Map<SeatId, Wagers>([
    ['A', { ante: STAKE, pairPlus: sideBets ? STAKE : 0, sixCard: sideBets ? STAKE : 0 }],
  ]);

  const m: Measurement = {
    strategy,
    rounds,
    main: new Tally(),
    action: 0,
    pairPlus: new Tally(),
    sixCard: new Tally(),
    plays: 0,
    qualified: 0,
    hands: Object.fromEntries(HAND_CATEGORIES.map((c) => [c, 0])) as Record<HandCategory, number>,
    sixCardHands: Object.fromEntries(SIX_CARD_CATEGORIES.map((c) => [c, 0])) as Record<SixCardCategory, number>,
  };

  for (let i = 0; i < rounds; i++) {
    if (table.seats[0].bankroll < dollars(1_000_000)) {
      table = { ...table, seats: table.seats.map((s) => ({ ...s, bankroll: dollars(10_000_000) })) };
    }
    const out = playRound(table, { strategy }, rng, bets);
    if (!out.dealt) throw new Error(`Round ${i} was not dealt.`);
    table = out.table;

    m.main.add(out.mainNet / STAKE);
    m.action += (out.anteStaked + out.playWagered) / STAKE;
    if (sideBets) {
      m.pairPlus.add(out.pairPlusNet / STAKE);
      m.sixCard.add(out.sixCardNet / STAKE);
    }
    m.plays += out.plays;
    if (out.dealerQualified) m.qualified++;

    const record = table.history[0].seats[0];
    m.hands[record.hand]++;
    if (record.sixCardHand) m.sixCardHands[record.sixCardHand]++;
  }
  return m;
}

const rows: string[] = [];

/** A mean held against its exact value, within a band computed from the run. */
function edgeWithin(label: string, measuredPct: number, exactPct: number, stderrPct: number, sigmas = 3): void {
  const band = sigmas * stderrPct;
  rows.push(
    `  ${label.padEnd(34)} measured ${measuredPct.toFixed(3).padStart(7)}%   exact ${exactPct.toFixed(3).padStart(7)}%   ±${band.toFixed(3)} (${sigmas}σ)`,
  );
  expect(Math.abs(measuredPct - exactPct), `${label}: measured ${measuredPct}, exact ${exactPct}, band ${band}`).toBeLessThanOrEqual(band);
}

/** A frequency held against its exact probability, within a binomial band. */
function frequencyWithin(label: string, count: number, n: number, p: number, sigmas = 4): void {
  const measured = count / n;
  const band = sigmas * Math.sqrt((p * (1 - p)) / n);
  rows.push(
    `  ${label.padEnd(34)} measured ${(measured * 100).toFixed(4).padStart(8)}%  exact ${(p * 100).toFixed(4).padStart(8)}%   ±${(band * 100).toFixed(4)} (${sigmas}σ)`,
  );
  expect(Math.abs(measured - p), `${label}: ${count} in ${n} against p = ${p}`).toBeLessThanOrEqual(band);
}

describe('the game, dealt a million times', () => {
  const ROUNDS = 1_000_000;
  const m = measure('OPTIMAL', ROUNDS, 'three-card-poker', true);
  const rules = defaultRules();

  it('loses the exact house edge on the Ante and Play', () => {
    const exact = antePlayFigures(rules.anteBonusTable);
    edgeWithin('Ante and Play, per Ante', -m.main.mean * 100, exact.houseEdge, m.main.stderr * 100);
    // Same numerator over the total action. Its band scales the same way.
    const risk = (-m.main.sum / m.action) * 100;
    edgeWithin('Ante and Play, per unit of action', risk, exact.elementOfRisk, (m.main.stderr * 100 * m.rounds) / m.action);
  });

  it('loses the exact house edge on Pair Plus', () => {
    edgeWithin('Pair Plus', -m.pairPlus.mean * 100, pairPlusFigures(rules.pairPlusTable).houseEdge, m.pairPlus.stderr * 100);
  });

  it('loses the exact house edge on the 6 Card Bonus', () => {
    edgeWithin('6 Card Bonus', -m.sixCard.mean * 100, sixCardFigures(rules.sixCardTable).houseEdge, m.sixCard.stderr * 100);
  });

  it('plays exactly as often as the strategy should', () => {
    frequencyWithin('Hands played', m.plays, ROUNDS, ANTE_PLAY_TOTALS.OPTIMAL.plays / THREE_CARD_HANDS);
  });

  it('qualifies the dealer exactly as often as the deck allows', () => {
    frequencyWithin('Dealer qualifies', m.qualified, ROUNDS, qualifyingHands() / THREE_CARD_HANDS);
  });

  it('deals every three-card hand at its exact frequency', () => {
    for (const c of HAND_CATEGORIES) {
      const combos = c === 'STRAIGHT_FLUSH' ? THREE_CARD_COUNTS.STRAIGHT_FLUSH + THREE_CARD_COUNTS.MINI_ROYAL : THREE_CARD_COUNTS[c];
      frequencyWithin(`Dealt: ${c.toLowerCase()}`, m.hands[c], ROUNDS, combos / THREE_CARD_HANDS);
    }
  });

  /*
   * The 6 Card Bonus's cards are the player's three and the dealer's three
   * from one shuffle, so these frequencies check the deal as well as the
   * evaluator: a dealer hand drawn from anything but the cards the player
   * does not hold would show up here as a skewed flush or quads rate.
   */
  it('makes every six-card hand at its exact frequency', () => {
    for (const c of SIX_CARD_CATEGORIES) {
      frequencyWithin(`Six cards: ${c.toLowerCase()}`, m.sixCardHands[c], ROUNDS, SIX_CARD_COUNTS[c] / SIX_CARD_SETS);
    }
  });
});

describe('the other strategies', () => {
  for (const strategy of ['MIMIC', 'ALWAYS'] as const) {
    it(`costs exactly what "${STRATEGY_LABEL[strategy]}" should`, () => {
      const m = measure(strategy, 300_000, `strategy-${strategy}`, false);
      edgeWithin(STRATEGY_LABEL[strategy], -m.main.mean * 100, antePlayFigures(defaultRules().anteBonusTable, strategy).houseEdge, m.main.stderr * 100);
    });
  }
});

describe('summary', () => {
  it('prints every measurement against its exact figure', () => {
    console.log(['', '  Knotz Three Card Poker — measured against exact:', '', ...rows, ''].join('\n'));
    expect(rows.length).toBeGreaterThan(0);
  });
});
