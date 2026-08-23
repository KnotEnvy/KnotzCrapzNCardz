/**
 * Statistical validation of the engine.
 *
 * The only way to prove a payout table end to end is to play a great many
 * decisions and check the house edge lands where the mathematics says it
 * should. Kept out of the main suite so the fast correctness tests stay a
 * four-second feedback loop.
 *
 *   npm run test:stats
 *
 * Every run is seeded, so these are deterministic rather than flaky. The bands
 * are theory plus or minus three standard errors at the sample sizes used: wide
 * enough to be honest about sampling noise, narrow enough that a wrong payout,
 * a missing commission or an inverted ratio fails them outright.
 */

import { describe, expect, it } from 'vitest';
import { applyRoll } from './resolve';
import { atRisk, createTable, maxOddsAll, placeBet } from './table';
import { createRng, rollDice } from './rng';
import type { TableState } from './types';

/* ------------------------------------------------------------------ *
 * The numbers have to come out right in the long run
 * ------------------------------------------------------------------ */

describe('house edge over a long session', () => {
  /** Runs `n` decisions of a flat strategy and returns the edge as a fraction. */
  function edgeOf(
    seed: string,
    n: number,
    play: (s: TableState) => TableState,
    done: (s: TableState) => boolean,
  ): number {
    const rng = createRng(seed);
    let s = createTable({ buyIn: 100_000_000, rules: { minBet: 1, historyLimit: 0 } });
    let wagered = 0;
    for (let i = 0; i < n; i++) {
      const before = s.seats.A.totalWagered;
      s = play(s);
      wagered += s.seats.A.totalWagered - before;
      do {
        s = applyRoll(s, rollDice(rng)).state;
      } while (!done(s));
    }
    const net = s.seats.A.bankroll + atRisk(s, 'A') - 100_000_000;
    return -net / wagered;
  }

  it('gives the pass line its 1.41 percent', () => {
    const edge = edgeOf(
      'pass-edge',
      50_000,
      (s) => (placeBet(s, 'A', { kind: 'PASS' }, 10) as { state: TableState }).state,
      (s) => s.bets.length === 0,
    );
    // 1.414% +/- 3 standard errors at 50k decisions.
    expect(edge).toBeGreaterThan(0.0);
    expect(edge).toBeLessThan(0.028);
  }, 600_000);

  it("gives don't pass its 1.36 percent", () => {
    const edge = edgeOf(
      'dp-edge',
      50_000,
      (s) => (placeBet(s, 'A', { kind: 'DONT_PASS' }, 10) as { state: TableState }).state,
      (s) => s.bets.length === 0,
    );
    // 1.364% +/- 3 standard errors at 50k decisions.
    expect(edge).toBeGreaterThan(0.0);
    expect(edge).toBeLessThan(0.027);
  }, 600_000);

  it('gives the field its 2.78 percent', () => {
    const rng = createRng('field-edge');
    let s = createTable({ buyIn: 100_000_000, rules: { minBet: 1, propsRideAfterWin: false, historyLimit: 0 } });
    const n = 120_000;
    for (let i = 0; i < n; i++) {
      const res = placeBet(s, 'A', { kind: 'FIELD' }, 10);
      if (res.ok) s = res.state;
      s = applyRoll(s, rollDice(rng)).state;
    }
    const edge = -(s.seats.A.bankroll - 100_000_000) / s.seats.A.totalWagered;
    // 2.78% +/- 3 standard errors at 120k rolls.
    expect(edge).toBeGreaterThan(0.018);
    expect(edge).toBeLessThan(0.038);
  }, 600_000);

  it('gives any seven its brutal 16.67 percent', () => {
    const rng = createRng('any7-edge');
    let s = createTable({ buyIn: 100_000_000, rules: { minBet: 1, propsRideAfterWin: false, historyLimit: 0 } });
    const n = 100_000;
    for (let i = 0; i < n; i++) {
      const res = placeBet(s, 'A', { kind: 'PROP', prop: 'ANY_7' }, 10);
      if (res.ok) s = res.state;
      s = applyRoll(s, rollDice(rng)).state;
    }
    const edge = -(s.seats.A.bankroll - 100_000_000) / s.seats.A.totalWagered;
    // 16.67% +/- 3 standard errors at 100k rolls.
    expect(edge).toBeGreaterThan(0.145);
    expect(edge).toBeLessThan(0.190);
  }, 600_000);

  it('shows free odds really do dilute the edge', () => {
    // Pass with full 3-4-5x odds should sit near 0.374 percent of total action.
    const rng = createRng('odds-edge');
    let s = createTable({ buyIn: 1_000_000_000, rules: { minBet: 1, historyLimit: 0 } });
    for (let i = 0; i < 30_000; i++) {
      s = (placeBet(s, 'A', { kind: 'PASS' }, 10) as { state: TableState }).state;
      do {
        if (s.point !== null && s.bets[0]?.odds === 0) {
          const r = maxOddsAll(s, 'A');
          if (r.ok) s = r.state;
        }
        s = applyRoll(s, rollDice(rng)).state;
      } while (s.bets.length > 0);
    }
    const flat = 30_000 * 10;
    const action = s.seats.A.totalWagered;
    // Odds should be carrying several times the flat action; if they were not
    // going up at all this test would say nothing.
    expect(action).toBeGreaterThan(flat * 3);

    const edge = -(s.seats.A.bankroll - 1_000_000_000) / action;
    // Spreading the same 1.41% loss over four to five times the action lands
    // near 0.37%. Three standard errors at this size is about 0.6%.
    expect(edge).toBeGreaterThan(-0.006);
    expect(edge).toBeLessThan(0.010);
  }, 600_000);
});

/* ------------------------------------------------------------------ *
 * Dice fairness
 * ------------------------------------------------------------------ */

describe('dice', () => {
  it('produces a flat distribution across all 36 pairs', () => {
    const rng = createRng('fairness');
    const counts = new Map<string, number>();
    const n = 600_000;
    for (let i = 0; i < n; i++) {
      const r = rollDice(rng);
      const k = `${r.d1}${r.d2}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    expect(counts.size).toBe(36);
    const expected = n / 36;
    for (const [pair, count] of counts) {
      // Five sigma either way; a biased die would blow straight through this.
      const sigma = Math.sqrt(expected * (35 / 36));
      expect(Math.abs(count - expected), `pair ${pair}`).toBeLessThan(5 * sigma);
    }
  }, 600_000);
});
