/**
 * What the seventeen house systems actually cost.
 *
 * Every strategy in the library is a way of arranging bets whose prices are
 * measured, one at a time, in `stats.sim.test.ts`. This file drives each of
 * them over a long seeded session and reports three numbers:
 *
 *   net per roll        — what it loses while you stand there
 *   edge                — loss per dollar of action, its realised house edge
 *   action per roll     — how much money it puts in motion each throw
 *
 * The third is the one people miss. A system that grinds enormous action at a
 * small edge bleeds faster than a system that risks very little at a terrible
 * one, and the only way to see that is to print them side by side.
 *
 * The invariant that makes this a test rather than a report: a strategy is
 * built out of the bets priced next door, and a weighted average can never sit
 * below the smallest thing averaged. So a system cannot come out cheaper than
 * the cheapest bet it makes. If one does, either the runner is not paying what
 * it should or the measurement is wrong — a house system with positive expected
 * value is a bug, not a discovery.
 *
 *   npm run test:stats
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HOUSE_STRATEGIES } from '@/lib/strategy/library';
import { runStrategy } from '@/lib/strategy/run';
import { emptyMemory } from '@/lib/strategy/types';
import type { Action, BetTarget, Strategy, StrategyMemory } from '@/lib/strategy/types';
import { applyRoll } from './resolve';
import { atRisk, createTable } from './table';
import { createRng, rollDice } from './rng';
import type { PointNumber, PropKind, TableState } from './types';

/** Rolls per strategy. Around three hundred hours at a live table, each. */
const ROLLS = 200_000;
/** Chips behind every system, so none of them is ever refused for want of a rack. */
const BANKROLL = 5_000_000;

/* ------------------------------------------------------------------ *
 * The price of every bet a strategy can reach for
 *
 * House edge per bet resolved, on the default house rules — commission on the
 * win, triple on the twelve. These are the figures `stats.sim.test.ts` measures
 * against the engine; they are repeated here as the bound each system has to
 * clear rather than re-derived.
 * ------------------------------------------------------------------ */

const PLACE_EDGE: Record<PointNumber, number> = {
  4: 1 / 15, 10: 1 / 15, 5: 0.04, 9: 0.04, 6: 1 / 66, 8: 1 / 66,
};
/** Buy and lay both cost this much once the vig only comes out of a win. */
const BOUGHT_EDGE: Record<PointNumber, number> = {
  4: 1 / 60, 10: 1 / 60, 5: 0.02, 9: 0.02, 6: 1 / 44, 8: 1 / 44,
};
const HARDWAY_EDGE: Record<number, number> = { 4: 1 / 9, 10: 1 / 9, 6: 1 / 11, 8: 1 / 11 };
const PROP_EDGE: Record<PropKind, number> = {
  ANY_7: 1 / 6,
  ANY_CRAPS: 1 / 9,
  TWO: 5 / 36,
  TWELVE: 5 / 36,
  THREE: 1 / 9,
  YO: 1 / 9,
  HORN: 0.125,
  WORLD: 2 / 15,
  C_AND_E: 1 / 9,
  HORN_HIGH_2: 23 / 180,
  HORN_HIGH_12: 23 / 180,
  HORN_HIGH_3: 11 / 90,
  HORN_HIGH_YO: 11 / 90,
};

const ALL_BOX: PointNumber[] = [4, 5, 6, 8, 9, 10];

/** Which box numbers a target can reach, for the dynamic refs. */
function numbersFor(target: BetTarget): PointNumber[] {
  const n = target.number;
  if (n === undefined) return [];
  if (typeof n === 'number') return [n];
  if (n === 'INSIDE') return [5, 6, 8, 9];
  if (n === 'OUTSIDE') return [4, 5, 9, 10];
  return ALL_BOX; // ACROSS, POINT and HIT can all land anywhere
}

/** Cheapest bet a single action can put on the felt, as a house edge. */
function edgeOfAction(action: Action): number[] {
  switch (action.t) {
    case 'ODDS':
      // Free odds are a fair bet and count as zero against the bound.
      return [0];
    case 'TAKE_DOWN':
    case 'REGRESS':
      // Money that comes back off the felt undecided was action at no edge at
      // all, and it can only drag the weighted average towards zero.
      return [0];
    case 'BET': {
      const t = action.target;
      switch (t.kind) {
        case 'PASS':
        case 'COME':
          return [7 / 495];
        case 'DONT_PASS':
        case 'DONT_COME':
          return [27 / 1980];
        case 'PLACE':
          return numbersFor(t).map((n) => PLACE_EDGE[n]);
        case 'BUY':
        case 'LAY':
          return numbersFor(t).map((n) => BOUGHT_EDGE[n]);
        case 'HARDWAY':
          return numbersFor(t).map((n) => HARDWAY_EDGE[n] ?? 1 / 11);
        case 'BIG':
          return [1 / 11];
        case 'FIELD':
          return [1 / 36];
        case 'PROP':
          return [PROP_EDGE[t.prop!]];
        case 'HOP':
          return [t.hop![0] === t.hop![1] ? 5 / 36 : 1 / 9];
        case 'FIRE':
          return [0.20763];
        case 'ATS':
          return [t.ats === 'ALL' ? 0.20609 : 0.18303];
      }
      return [];
    }
    default:
      return [];
  }
}

/** The cheapest bet this system can make: the floor its own edge cannot beat. */
function bestBetEdge(strategy: Strategy): number {
  let best = Number.POSITIVE_INFINITY;
  for (const rule of strategy.rules) {
    if (!rule.enabled) continue;
    for (const action of rule.then) {
      for (const e of edgeOfAction(action)) best = Math.min(best, e);
    }
  }
  return Number.isFinite(best) ? best : 0;
}

/* ------------------------------------------------------------------ *
 * Driving a system
 * ------------------------------------------------------------------ */

interface Result {
  name: string;
  unit: number;
  rolls: number;
  hands: number;
  net: number;
  action: number;
  /** Standard error on the edge, from the hand-to-hand variation. */
  se: number;
  bound: number;
}

function equity(t: TableState): number {
  return t.seats.A.bankroll + atRisk(t, 'A');
}

/**
 * Plays one system for `ROLLS` rolls and measures what it cost.
 *
 * Walk-away limits are switched off for the measurement. A win goal or a loss
 * limit changes when you stop, never the price of the bets you made on the way
 * — and leaving them on would just end two of the seventeen runs early and
 * measure nothing after that.
 *
 * Results are batched by hand. Rolls inside a hand are anything but
 * independent, so the standard error is taken across whole hands, which are:
 * the seven-out clears the felt and the strategy's memory resets with it.
 */
function measure(strategy: Strategy, seed: string): Result {
  const playable: Strategy = { ...strategy, winGoal: 0, lossLimit: 0 };
  const rng = createRng(seed);
  let table = createTable({
    buyIn: BANKROLL,
    solo: true,
    rules: { minBet: 5, historyLimit: 0 },
  });

  let memory: StrategyMemory = emptyMemory(playable.id, equity(table));
  const opened = runStrategy({ table, seat: 'A', strategy: playable, memory, record: null, force: true });
  table = opened.table;
  memory = opened.memory;

  let handEquity = equity(table);
  let handAction = table.seats.A.totalWagered;
  let hands = 0;
  let sumHand = 0;
  let sumHandSq = 0;

  for (let i = 0; i < ROLLS; i++) {
    const applied = applyRoll(table, rollDice(rng));
    const res = runStrategy({
      table: applied.state,
      seat: 'A',
      strategy: playable,
      memory,
      record: applied.record,
      settlements: applied.settlements,
    });
    table = res.table;
    memory = res.memory;

    if (applied.record.outcome === 'SEVEN_OUT') {
      const after = equity(table);
      const handNet = after - handEquity;
      handEquity = after;
      handAction = table.seats.A.totalWagered;
      hands += 1;
      sumHand += handNet;
      sumHandSq += handNet * handNet;
    }
  }

  const net = equity(table) - BANKROLL;
  const action = table.seats.A.totalWagered;
  // Ratio estimator: the error on the total net, scaled by the action it was
  // spread over. Whole hands are independent, partial ones are dropped.
  const mean = hands > 0 ? sumHand / hands : 0;
  const variance = hands > 0 ? Math.max(0, sumHandSq / hands - mean * mean) : 0;
  const se = handAction > 0 ? (Math.sqrt(variance * hands) / handAction) : Infinity;

  return {
    name: strategy.name,
    unit: strategy.unit,
    rolls: ROLLS,
    hands,
    net,
    action,
    se,
    bound: bestBetEdge(strategy),
  };
}

/* ------------------------------------------------------------------ *
 * The run
 * ------------------------------------------------------------------ */

const results: Result[] = [];

function pct(x: number): string {
  return `${(x * 100).toFixed(3)}%`;
}

describe('what every house system costs', () => {
  beforeAll(() => {
    for (const strategy of HOUSE_STRATEGIES) {
      results.push(measure(strategy, `ev-${strategy.id}`));
    }
  }, 900_000);

  it('drives all seventeen systems without one of them sitting out', () => {
    expect(results).toHaveLength(HOUSE_STRATEGIES.length);
    for (const r of results) {
      // A system that never got a bet down would report a flawless zero edge,
      // which is exactly the failure this catches.
      expect(r.action, `${r.name} put nothing at risk`).toBeGreaterThan(r.rolls);
      expect(r.hands, `${r.name} saw no complete hands`).toBeGreaterThan(100);
    }
  });

  it('never lets a house system come out measurably ahead of the house', () => {
    /*
     * The systems that back the line with full odds run at an edge of about a
     * third of one percent, and a third of one percent does not separate
     * itself from the noise inside any number of rolls a person will wait for.
     * So the per-system assertion is the honest one — no system is *measurably*
     * player-favourable, three standard errors either way — and the strict
     * "the house always wins" claim is made below, where the seventeen runs
     * pooled together have the sample size to carry it.
     */
    for (const r of results) {
      const edge = -r.net / r.action;
      expect(
        edge,
        `${r.name} measured ${pct(edge)} +/-${pct(3 * r.se)} — a winning house system is a bug`,
      ).toBeGreaterThan(-3 * r.se);
    }
  });

  it('loses, across the seventeen systems together', () => {
    // Seventeen independent runs pooled: millions of dollars of action, and an
    // expected loss far outside anything sampling noise can reach.
    const net = results.reduce((sum, r) => sum + r.net, 0);
    const action = results.reduce((sum, r) => sum + r.action, 0);
    const se = Math.sqrt(results.reduce((sum, r) => sum + (r.se * r.action) ** 2, 0)) / action;
    const edge = -net / action;
    expect(edge, `the library as a whole measured ${pct(edge)} +/-${pct(3 * se)}`).toBeGreaterThan(3 * se);
  });

  it('never lets a system beat the cheapest bet it makes', () => {
    for (const r of results) {
      const edge = -r.net / r.action;
      // Three standard errors of slack, the same convention as every band in
      // the bet suite. The bound itself is exact: a weighted average of edges
      // cannot fall below the smallest edge in the average.
      expect(
        edge,
        `${r.name} measured ${pct(edge)} +/-${pct(3 * r.se)} against a floor of ${pct(r.bound)}`,
      ).toBeGreaterThan(r.bound - 3 * r.se);
    }
  });
});

afterAll(() => {
  if (results.length === 0) return;
  const money = (x: number) => (x < 0 ? `-$${(-x).toFixed(4)}` : `$${x.toFixed(4)}`);
  const w = Math.max(...results.map((r) => r.name.length), 24);
  const line = (a: string, b: string, c: string, d: string, e: string, f: string, g: string) =>
    `${a.padEnd(w)}  ${b.padStart(5)}  ${c.padStart(10)}  ${d.padStart(8)}  ${e.padStart(9)}  ${f.padStart(11)}  ${g.padStart(7)}`;
  const out = [
    '',
    `WHAT EACH HOUSE SYSTEM COSTS — ${ROLLS.toLocaleString('en-US')} seeded rolls each`,
    line('system', 'unit', 'net/roll', 'edge', '+/-3 s.e.', 'action/roll', 'floor'),
    '-'.repeat(w + 64),
  ];
  const sorted = [...results].sort((a, b) => a.net / a.rolls - b.net / b.rolls);
  for (const r of sorted) {
    out.push(
      line(
        r.name,
        `$${r.unit}`,
        money(r.net / r.rolls),
        pct(-r.net / r.action),
        pct(3 * r.se),
        `$${(r.action / r.rolls).toFixed(2)}`,
        pct(r.bound),
      ),
    );
  }
  out.push(
    '',
    'net/roll is what the system loses per throw of the dice; edge is that loss per',
    'dollar of action; floor is the cheapest bet the system makes, which its edge',
    'cannot beat. Sorted worst first.',
    '',
  );
  console.log(out.join('\n'));
});
