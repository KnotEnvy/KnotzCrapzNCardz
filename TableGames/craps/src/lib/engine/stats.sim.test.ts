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
 * a missing commission or an inverted ratio fails them outright. The standard
 * error comes from the per-decision variance the run itself measured rather
 * than from a percentage picked by eye, so a bet that swings wildly gets the
 * wide band it deserves and a quiet one gets a tight band it has to earn.
 *
 * DENOMINATOR. Every figure here is the house edge **per bet resolved**: net
 * divided by the money put up for that resolution, which is the convention
 * every published craps figure uses. For a multi-roll bet that means one stake
 * per trip to the felt, not one stake per roll — the two differ by a factor of
 * three or four, and mixing them is the classic way these measurements go
 * wrong. `wagered` below is incremented once per settled decision and never
 * once per roll.
 *
 * A summary table of every bet is printed at the end of the run.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyRoll } from './resolve';
import { atRisk, canBet, createTable, maxOddsAll, placeBet, seatBetOn } from './table';
import type { BetSpec } from './table';
import { createRng, rollDice } from './rng';
import type { Bet, BetKind, DieFace, PointNumber, TableRules, TableState } from './types';

/* ------------------------------------------------------------------ *
 * Sample sizes
 *
 * Turned up or down together. Every band in the file is derived from the
 * variance actually observed at these sizes, so changing one of these never
 * silently loosens an assertion — it widens or narrows the band the
 * measurement has to sit inside.
 * ------------------------------------------------------------------ */

/** Decisions per flat line bet (pass, don't pass, come, don't come). */
const LINE_DECISIONS = 60_000;
/** Decisions per line bet when the odds behind it are what is being measured. */
const ODDS_DECISIONS = 150_000;
/** Rolls across the shared box-number table (place, buy, lay, hardway, big). */
const BOX_ROLLS = 200_000;
/** Rolls across the single-roll table (field, props, hops). */
const SINGLE_ROLLS = 160_000;
/** Rolls across the side-bet table (Fire, All/Tall/Small). */
const SIDE_ROLLS = 500_000;

/* ------------------------------------------------------------------ *
 * Measurement
 * ------------------------------------------------------------------ */

interface Series {
  label: string;
  /** Decisions settled. */
  n: number;
  /** Money put up, summed over decisions: stake plus any up-front commission. */
  wagered: number;
  /** Net dollar result, summed over decisions. */
  net: number;
  /** Sum of squared per-decision nets, for the variance. */
  sumSq: number;
}

function series(label: string): Series {
  return { label, n: 0, wagered: 0, net: 0, sumSq: 0 };
}

function settle(s: Series, net: number, wagered: number): void {
  s.n += 1;
  s.wagered += wagered;
  s.net += net;
  s.sumSq += net * net;
}

/** Pools series that share a theoretical edge, for a tighter band on the pair. */
function pool(label: string, parts: Series[]): Series {
  const out = series(label);
  for (const p of parts) {
    out.n += p.n;
    out.wagered += p.wagered;
    out.net += p.net;
    out.sumSq += p.sumSq;
  }
  return out;
}

/** House edge as a positive fraction: what the house keeps per dollar put up. */
function houseEdge(s: Series): number {
  return -s.net / s.wagered;
}

/**
 * One standard error on that edge.
 *
 * The estimator is `-sum(net) / sum(wagered)` and the wager per decision is
 * constant within a series, so the error on the edge is the error on the mean
 * net — sd over root n — divided by that wager.
 */
function standardError(s: Series): number {
  const mean = s.net / s.n;
  const variance = Math.max(0, s.sumSq / s.n - mean * mean);
  return Math.sqrt(variance / s.n) / (s.wagered / s.n);
}

interface Row {
  label: string;
  theory: number;
  measured: number;
  band: number;
  n: number;
  ok: boolean;
  note?: string;
}

const rows: Row[] = [];

function pct(x: number): string {
  return `${(x * 100).toFixed(3)}%`;
}

/**
 * Asserts a measured edge sits inside theory plus or minus three standard
 * errors, and records the row for the summary table.
 *
 * A failure here is a bug report, not a band to widen: the whole point of the
 * suite is that a wrong ratio, an inverted payout or a missing commission
 * cannot hide inside sampling noise.
 */
function check(s: Series, theory: number, note?: string): void {
  expect(s.n, `${s.label}: no decisions settled`).toBeGreaterThan(0);
  const measured = houseEdge(s);
  const band = 3 * standardError(s);
  rows.push({ label: s.label, theory, measured, band, n: s.n, ok: Math.abs(measured - theory) <= band, note });
  expect(
    Math.abs(measured - theory),
    `${s.label}: measured ${pct(measured)} against theory ${pct(theory)}, band +/-${pct(band)} over ${s.n} decisions`,
  ).toBeLessThanOrEqual(band);
}

afterAll(() => {
  if (rows.length === 0) return;
  const w = Math.max(...rows.map((r) => r.label.length), 22);
  const line = (a: string, b: string, c: string, d: string, e: string, f: string) =>
    `${a.padEnd(w)}  ${b.padStart(8)}  ${c.padStart(8)}  ${d.padStart(11)}  ${e.padStart(9)}  ${f}`;
  const out = [
    '',
    'HOUSE EDGE BY BET — per bet resolved, band is theory +/- 3 standard errors',
    line('bet', 'theory', 'measured', 'band', 'decisions', ''),
    '-'.repeat(w + 55),
  ];
  for (const r of rows) {
    out.push(
      line(
        r.label,
        pct(r.theory),
        pct(r.measured),
        `+/-${pct(r.band)}`,
        String(r.n),
        `${r.ok ? 'pass' : 'FAIL'}${r.note ? `  <- ${r.note}` : ''}`,
      ),
    );
  }
  out.push('');
  console.log(out.join('\n'));
});

/* ------------------------------------------------------------------ *
 * The mathematics the bands are measured against
 * ------------------------------------------------------------------ */

const WAYS: Record<number, number> = {
  2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1,
};

/** Probability a box number repeats before a seven. */
function pMake(n: PointNumber): number {
  return WAYS[n] / (WAYS[n] + 6);
}

/**
 * House edge on a two-outcome bet: `win` dollars with probability p, `loss`
 * dollars otherwise, against `putUp` dollars committed to the decision.
 */
function edgeFrom(p: number, win: number, loss: number, putUp = loss): number {
  return -(p * win - (1 - p) * loss) / putUp;
}

/** House edge on a single-roll bet, from its profit per dollar by dice total. */
function singleRollEdge(profit: Record<number, number>): number {
  let ev = 0;
  for (let t = 2; t <= 12; t++) ev += (WAYS[t] / 36) * (profit[t] ?? -1);
  return -ev;
}

/* ------------------------------------------------------------------ *
 * A table of independent spots, each re-bet as soon as it settles
 * ------------------------------------------------------------------ */

interface Spot {
  spec: BetSpec;
  amount: number;
  /** Whether a winner stays on the felt rather than coming down. */
  ridesOnWin: boolean;
  /**
   * Commission taken at placement. Charged against the FIRST decision of that
   * placement only — it is a one-off payment, not a per-decision fee. A buy's
   * up-front vig then rides with the bet and covers every later win; a lay's
   * later rounds are paid for by the fresh vig the engine takes on each win,
   * which arrives inside the settlement's own net.
   */
  vig: number;
  betId: string | null;
  series: Series;
}

function spot(label: string, spec: BetSpec, amount: number, ridesOnWin: boolean): Spot {
  return { spec, amount, ridesOnWin, vig: 0, betId: null, series: series(label) };
}

/**
 * Plays `rolls` rolls with every spot kept covered, booking one decision
 * against a spot each time the engine settles it.
 *
 * The spots are independent bets on different areas of the felt, so a single
 * pass of the dice measures all of them at once. A seven that sweeps the whole
 * box ends one decision per spot and no more; the spots are correlated with
 * each other, but each individual series is still a run of independent cycles,
 * which is all its standard error depends on.
 *
 * A winner that rides is not taken down and put straight back up. Leaving it
 * exposes the same stake again, which is the same thing economically, so the
 * decision is booked and the stake counted a second time — exactly the
 * per-bet-resolved denominator. An up-front commission is charged against
 * every decision for the same reason: a live table re-vigs a bet each time it
 * is put up.
 */
function runSpots(seed: string, rolls: number, rules: Partial<TableRules>, spots: Spot[]): void {
  const rng = createRng(seed);
  let s = createTable({
    buyIn: 1_000_000_000,
    rules: {
      minBet: 1,
      historyLimit: 0,
      placeOffOnComeOut: false,
      hardwaysOffOnComeOut: false,
      ...rules,
    },
  });
  const byId = new Map<string, Spot>();

  for (let i = 0; i < rolls; i++) {
    for (const sp of spots) {
      if (sp.betId !== null) continue;
      if (!canBet(s, sp.spec).allowed) continue;
      const res = placeBet(s, 'A', sp.spec, sp.amount);
      if (!res.ok) throw new Error(`${sp.series.label}: ${res.reason}`);
      s = res.state;
      const bet = seatBetOn(s, 'A', sp.spec)!;
      sp.betId = bet.id;
      sp.vig = bet.vigPaid;
      byId.set(bet.id, sp);
    }

    const out = applyRoll(s, rollDice(rng));
    s = out.state;

    for (const st of out.settlements) {
      if (st.type !== 'WIN' && st.type !== 'LOSE' && st.type !== 'PUSH') continue;
      const sp = byId.get(st.betId);
      if (sp === undefined) continue;
      settle(sp.series, st.net - sp.vig, sp.amount + sp.vig);
      // Paid once at placement, not once per decision. A riding bet keeps the
      // stake exposed, so the denominator repeats, but the commission does not.
      sp.vig = 0;
      if (st.type !== 'WIN' || !sp.ridesOnWin) {
        byId.delete(st.betId);
        sp.betId = null;
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 * Line bets, and the odds behind them
 * ------------------------------------------------------------------ */

function betById(s: TableState, id: string): Bet | undefined {
  for (let i = 0; i < s.bets.length; i++) if (s.bets[i].id === id) return s.bets[i];
  return undefined;
}

interface LineRun {
  flat: Series;
  odds: Series;
}

/**
 * Plays one line bet at a time through to a decision, `decisions` times.
 *
 * `flat` books the line bet on its own. `odds` books the odds portion in
 * isolation: a line bet pays even money, so its contribution is known exactly
 * from the settlement type, and subtracting it from the settled net leaves the
 * odds result and nothing else. That is the only way to see the odds edge
 * rather than a pass-plus-odds blend — and odds are paid at true odds, so the
 * answer has to be statistically zero.
 */
function runLine(
  seed: string,
  decisions: number,
  kind: BetKind,
  flat: number,
  takeOdds: boolean,
  label: string,
): LineRun {
  const rng = createRng(seed);
  let s = createTable({ buyIn: 1_000_000_000, rules: { minBet: 1, historyLimit: 0 } });
  const spec: BetSpec = { kind };
  const wantComeOut = kind === 'PASS' || kind === 'DONT_PASS';
  const run: LineRun = { flat: series(label), odds: series(`${label} odds`) };

  for (let i = 0; i < decisions; i++) {
    while ((s.phase === 'COME_OUT') !== wantComeOut) s = applyRoll(s, rollDice(rng)).state;
    const placed = placeBet(s, 'A', spec, flat);
    if (!placed.ok) throw new Error(`${label}: ${placed.reason}`);
    s = placed.state;
    const id = seatBetOn(s, 'A', spec)!.id;

    let oddsUp = 0;
    let flatNet = 0;
    let total = 0;

    for (;;) {
      if (takeOdds && oddsUp === 0) {
        const live = betById(s, id);
        if (live !== undefined && live.number !== undefined) {
          const r = maxOddsAll(s, 'A');
          if (r.ok) {
            s = r.state;
            oddsUp = betById(s, id)!.odds;
          }
        }
      }

      const out = applyRoll(s, rollDice(rng));
      s = out.state;
      let done = false;
      for (const st of out.settlements) {
        if (st.betId !== id) continue;
        if (st.type === 'WIN') {
          flatNet = flat;
          total = st.net;
          done = true;
        } else if (st.type === 'LOSE') {
          flatNet = -flat;
          total = st.net;
          done = true;
        } else if (st.type === 'PUSH') {
          flatNet = 0;
          total = 0;
          done = true;
        }
      }
      if (done) break;
    }

    settle(run.flat, flatNet, flat);
    const oddsNet = total - flatNet;
    // Come odds sleep through a come-out. When they do they are handed back
    // rather than decided, and money that was never in action has no business
    // in the denominator.
    if (oddsUp > 0 && oddsNet !== 0) settle(run.odds, oddsNet, oddsUp);
  }

  return run;
}

/* ------------------------------------------------------------------ *
 * The line
 * ------------------------------------------------------------------ */

describe('the line', () => {
  const runs: Record<string, LineRun> = {};

  beforeAll(() => {
    runs.PASS = runLine('pass-flat', LINE_DECISIONS, 'PASS', 10, false, 'Pass line');
    runs.DONT_PASS = runLine('dp-flat', LINE_DECISIONS, 'DONT_PASS', 10, false, "Don't pass");
    runs.COME = runLine('come-flat', LINE_DECISIONS, 'COME', 10, false, 'Come');
    runs.DONT_COME = runLine('dc-flat', LINE_DECISIONS, 'DONT_COME', 10, false, "Don't come");
  }, 900_000);

  it('pays the pass line its 1.414 percent', () => {
    // 244 of every 495 decisions win and 251 lose: seven dollars kept out of
    // every 495 that cross the line.
    check(runs.PASS.flat, 7 / 495);
  });

  it("pays don't pass its 1.364 percent", () => {
    // 949 win, 976 lose and 55 push on the barred twelve, out of 1980 bets
    // made. The push is money that was still put up, so it stays in the
    // denominator — that is what makes the figure 1.364% rather than the
    // 1.403% you get per bet actually decided.
    check(runs.DONT_PASS.flat, 27 / 1980);
  });

  it('pays a come bet the same 1.414 percent as the pass line', () => {
    // A come bet is a pass line bet that starts whenever you make it — but it
    // travels from the box onto a number, which is a code path the pass line
    // never takes.
    check(runs.COME.flat, 7 / 495);
  });

  it("pays a don't come bet the same 1.364 percent as don't pass", () => {
    check(runs.DONT_COME.flat, 27 / 1980);
  });
});

/* ------------------------------------------------------------------ *
 * Free odds — the sharpest test in the file
 *
 * Odds are paid at true odds, so they carry no edge at all. Measured on their
 * own rather than blended into a pass-plus-odds figure, the answer must be
 * statistically zero, and one wrong ratio in `trueOdds` or `layOdds` drags it
 * straight off zero.
 * ------------------------------------------------------------------ */

describe('free odds', () => {
  const runs: Record<string, LineRun> = {};

  beforeAll(() => {
    runs.PASS = runLine('pass-odds', ODDS_DECISIONS, 'PASS', 10, true, 'Pass');
    runs.COME = runLine('come-odds', ODDS_DECISIONS, 'COME', 10, true, 'Come');
    runs.DONT_PASS = runLine('dp-odds', ODDS_DECISIONS, 'DONT_PASS', 10, true, "Don't pass");
    runs.DONT_COME = runLine('dc-odds', ODDS_DECISIONS, 'DONT_COME', 10, true, "Don't come");
  }, 900_000);

  it('takes no edge behind the pass line', () => {
    // Sanity that the odds really did go up: 3-4-5x should carry several times
    // the flat action, or this measurement would be saying nothing.
    expect(runs.PASS.odds.wagered).toBeGreaterThan(runs.PASS.flat.wagered * 2);
    check(runs.PASS.odds, 0);
  });

  it('takes no edge behind a come bet', () => {
    check(runs.COME.odds, 0);
  });

  it("takes no edge laid behind don't pass", () => {
    check(runs.DONT_PASS.odds, 0);
  });

  it("takes no edge laid behind don't come", () => {
    check(runs.DONT_COME.odds, 0);
  });
});

/* ------------------------------------------------------------------ *
 * The box numbers
 *
 * Place, buy, lay, hardway and big all sit on one table and settle in the same
 * rolls, so one pass of the dice measures twenty-four bets. The commission
 * rule is a table rule rather than a bet, so buy and lay get a second table
 * with the vig taken up front.
 * ------------------------------------------------------------------ */

const BOX: readonly PointNumber[] = [4, 5, 6, 8, 9, 10];
const HARD_NUMBERS = [4, 6, 8, 10] as const;

/** $30 divides by both the fives and the sixes the box wants. */
const PLACE_AMOUNT = 30;
/** A $100 buy makes the five percent commission exactly five dollars. */
const BUY_AMOUNT = 100;
/** A $120 lay makes five percent of the win exact on all six numbers. */
const LAY_AMOUNT = 120;
const HARD_AMOUNT = 10;
const BIG_AMOUNT = 10;

/** 7:6 on the six and eight, 7:5 on the five and nine, 9:5 on the four and ten. */
function placeWin(n: PointNumber): number {
  if (n === 6 || n === 8) return (PLACE_AMOUNT * 7) / 6;
  if (n === 5 || n === 9) return (PLACE_AMOUNT * 7) / 5;
  return (PLACE_AMOUNT * 9) / 5;
}

/** True odds: 2:1 on the four and ten, 3:2 on the five and nine, 6:5 on the six and eight. */
function trueWin(amount: number, n: PointNumber): number {
  if (n === 4 || n === 10) return amount * 2;
  if (n === 5 || n === 9) return amount * 1.5;
  return amount * 1.2;
}

/** What a $120 lay against `n` wins when the seven shows. */
function layWin(n: PointNumber): number {
  if (n === 4 || n === 10) return LAY_AMOUNT / 2;
  if (n === 5 || n === 9) return (LAY_AMOUNT * 2) / 3;
  return (LAY_AMOUNT * 5) / 6;
}

const placeSpots = BOX.map((n) => spot(`Place ${n}`, { kind: 'PLACE', number: n }, PLACE_AMOUNT, true));
const buySpots = BOX.map((n) => spot(`Buy ${n}`, { kind: 'BUY', number: n }, BUY_AMOUNT, true));
const laySpots = BOX.map((n) => spot(`Lay ${n}`, { kind: 'LAY', number: n }, LAY_AMOUNT, true));
const hardSpots = HARD_NUMBERS.map((n) =>
  spot(`Hard ${n}`, { kind: 'HARDWAY', number: n }, HARD_AMOUNT, true),
);
const bigSpots = ([6, 8] as const).map((n) =>
  spot(`Big ${n}`, { kind: 'BIG', number: n }, BIG_AMOUNT, true),
);
const buyUpFront = BOX.map((n) =>
  spot(`Buy ${n} vig up front`, { kind: 'BUY', number: n }, BUY_AMOUNT, true),
);
const layUpFront = BOX.map((n) =>
  spot(`Lay ${n} vig up front`, { kind: 'LAY', number: n }, LAY_AMOUNT, true),
);

/** Index of a box number inside BOX, so pairs can be pooled by name. */
const at = (n: PointNumber) => BOX.indexOf(n);

describe('the box numbers', () => {
  beforeAll(() => {
    runSpots('box-vig-on-win', BOX_ROLLS, { vigOnWin: true }, [
      ...placeSpots,
      ...buySpots,
      ...laySpots,
      ...hardSpots,
      ...bigSpots,
    ]);
    runSpots('box-vig-up-front', BOX_ROLLS, { vigOnWin: false }, [...buyUpFront, ...layUpFront]);
  }, 900_000);

  for (const n of BOX) {
    it(`places the ${n} at its book price`, () => {
      check(placeSpots[at(n)].series, edgeFrom(pMake(n), placeWin(n), PLACE_AMOUNT));
    });
  }

  it('places 6/8, 5/9 and 4/10 at 1.515, 4.000 and 6.667 percent', () => {
    // The same six measurements pooled by pair: one theoretical edge over twice
    // the decisions, and so a band tight enough to be worth quoting.
    for (const n of [6, 5, 4] as const) {
      const mirror = (14 - n) as PointNumber;
      check(
        pool(`Place ${n}/${mirror}`, [placeSpots[at(n)].series, placeSpots[at(mirror)].series]),
        edgeFrom(pMake(n), placeWin(n), PLACE_AMOUNT),
      );
    }
  });

  const buyVig = BUY_AMOUNT * 0.05;

  for (const n of BOX) {
    it(`buys the ${n} at true odds less five percent of the win`, () => {
      check(buySpots[at(n)].series, edgeFrom(pMake(n), trueWin(BUY_AMOUNT, n) - buyVig, BUY_AMOUNT));
    });
  }

  it('buys 4/10, 5/9 and 6/8 at 1.667, 2.000 and 2.273 percent with the vig on the win', () => {
    for (const n of [4, 5, 6] as const) {
      const mirror = (14 - n) as PointNumber;
      check(
        pool(`Buy ${n}/${mirror}`, [buySpots[at(n)].series, buySpots[at(mirror)].series]),
        edgeFrom(pMake(n), trueWin(BUY_AMOUNT, n) - buyVig, BUY_AMOUNT),
      );
    }
  });

  for (const n of BOX) {
    it(`buys the ${n} with a single up-front vig riding with the bet`, () => {
      /*
       * The commission is paid once and rides: a buy that wins and stays up is
       * not re-vigged, and the same payment comes back if the player pulls the
       * bet down. So the cost is one vig spread over however many decisions the
       * bet survives, not one vig per decision.
       *
       * A buy dies to the seven, so it lives (ways + 6) / 6 decisions on
       * average — 1.5 on the four and ten, 1.83 on the six and eight. The flat
       * part is a fair bet at true odds, which leaves the amortised vig as the
       * entire edge.
       */
      const livesFor = (WAYS[n] + 6) / 6;
      const vigPerDecision = buyVig / livesFor;
      check(buyUpFront[at(n)].series, vigPerDecision / (BUY_AMOUNT + buyVig));
    });
  }

  for (const n of BOX) {
    it(`lays the ${n} at true odds less five percent of the win`, () => {
      // Laying is the mirror of buying, and with the commission on the win it
      // costs the same 1.667 / 2.000 / 2.273 percent.
      const win = layWin(n);
      check(laySpots[at(n)].series, edgeFrom(1 - pMake(n), win * 0.95, LAY_AMOUNT));
    });
  }

  it('lays 4/10, 5/9 and 6/8 at 1.667, 2.000 and 2.273 percent with the vig on the win', () => {
    for (const n of [4, 5, 6] as const) {
      const mirror = (14 - n) as PointNumber;
      check(
        pool(`Lay ${n}/${mirror}`, [laySpots[at(n)].series, laySpots[at(mirror)].series]),
        edgeFrom(1 - pMake(n), layWin(n) * 0.95, LAY_AMOUNT),
      );
    }
  });

  for (const n of BOX) {
    it(`lays the ${n} with the vig up front`, () => {
      /*
       * A lay's commission is five percent of what it *wins*, never of what is
       * laid: $120 against the four wins $60 and the boxman takes $3.
       *
       * This measured 4.762% on all six numbers until the up-front path in
       * table.ts was fixed — it had reused the buy formula and charged five
       * percent of the stake, which is double on the four and ten and flattens
       * every number to the buy-bet price. The two commission rules now live in
       * odds.ts so this path and the resolver cannot drift apart again.
       */
      const vig = layWin(n) * 0.05;
      // One commission per decision: the up-front payment covers the round it
      // was placed for, and every win pre-pays the round it rides into. The
      // flat part is fair, so the vig is the whole edge.
      check(layUpFront[at(n)].series, vig / (LAY_AMOUNT + vig));
    });
  }

  for (const n of HARD_NUMBERS) {
    it(`pays the hard ${n} at ${n === 6 || n === 8 ? '9:1' : '7:1'}`, () => {
      // Hard 6 and 8: one way to win against four easy ways and six sevens,
      // paid 9:1, so one dollar in eleven. Hard 4 and 10: one against eight,
      // paid 7:1, so one in nine.
      const ways = n === 6 || n === 8 ? 11 : 9;
      const ratio = n === 6 || n === 8 ? 9 : 7;
      check(
        hardSpots[HARD_NUMBERS.indexOf(n)].series,
        edgeFrom(1 / ways, HARD_AMOUNT * ratio, HARD_AMOUNT),
      );
    });
  }

  for (const [i, n] of ([6, 8] as const).entries()) {
    it(`pays big ${n} even money`, () => {
      // Even money on a bet that wins five times in eleven: 9.091%, and the
      // reason the corner of the felt it sits in is usually empty.
      check(bigSpots[i].series, edgeFrom(pMake(n), BIG_AMOUNT, BIG_AMOUNT));
    });
  }
});

/* ------------------------------------------------------------------ *
 * Single-roll bets
 * ------------------------------------------------------------------ */

/** Divides by four for the horn, five for world and the horn highs, two for C&E. */
const PROP_AMOUNT = 60;
const FIELD_AMOUNT = 60;

const propSpots = {
  ANY_7: spot('Any seven', { kind: 'PROP', prop: 'ANY_7' }, PROP_AMOUNT, false),
  ANY_CRAPS: spot('Any craps', { kind: 'PROP', prop: 'ANY_CRAPS' }, PROP_AMOUNT, false),
  TWO: spot('Aces (2)', { kind: 'PROP', prop: 'TWO' }, PROP_AMOUNT, false),
  THREE: spot('Ace deuce (3)', { kind: 'PROP', prop: 'THREE' }, PROP_AMOUNT, false),
  YO: spot('Yo (11)', { kind: 'PROP', prop: 'YO' }, PROP_AMOUNT, false),
  TWELVE: spot('Boxcars (12)', { kind: 'PROP', prop: 'TWELVE' }, PROP_AMOUNT, false),
  HORN: spot('Horn', { kind: 'PROP', prop: 'HORN' }, PROP_AMOUNT, false),
  WORLD: spot('World', { kind: 'PROP', prop: 'WORLD' }, PROP_AMOUNT, false),
  C_AND_E: spot('C & E', { kind: 'PROP', prop: 'C_AND_E' }, PROP_AMOUNT, false),
  HORN_HIGH_2: spot('Horn high aces', { kind: 'PROP', prop: 'HORN_HIGH_2' }, PROP_AMOUNT, false),
  HORN_HIGH_3: spot('Horn high three', { kind: 'PROP', prop: 'HORN_HIGH_3' }, PROP_AMOUNT, false),
  HORN_HIGH_YO: spot('Horn high yo', { kind: 'PROP', prop: 'HORN_HIGH_YO' }, PROP_AMOUNT, false),
  HORN_HIGH_12: spot('Horn high twelve', { kind: 'PROP', prop: 'HORN_HIGH_12' }, PROP_AMOUNT, false),
};

const hopEasy = spot('Hop 3-4 (easy)', { kind: 'HOP', hop: [3, 4] as [DieFace, DieFace] }, PROP_AMOUNT, false);
const hopHard = spot('Hop 5-5 (hard)', { kind: 'HOP', hop: [5, 5] as [DieFace, DieFace] }, PROP_AMOUNT, false);
const field3 = spot('Field, 3x on the 12', { kind: 'FIELD' }, FIELD_AMOUNT, false);
const field2 = spot('Field, 2x on the 12', { kind: 'FIELD' }, FIELD_AMOUNT, false);

/*
 * The horn, world, C&E and horn-high bets are split wagers: the stake is cut
 * into legs, the legs that miss are lost, and the leg that hits is paid its own
 * single-number price. The profit tables below are per dollar staked on the
 * whole bet, worked out leg by leg.
 */
const hornLeg = (t: number) => (t === 2 || t === 12 ? 30 : 15);
const HORN: Record<number, number> = {};
const WORLD: Record<number, number> = { 7: 0 }; // the seven leg makes it a push
const C_AND_E: Record<number, number> = {};
for (const t of [2, 3, 11, 12]) {
  HORN[t] = hornLeg(t) / 4 - 3 / 4;
  WORLD[t] = hornLeg(t) / 5 - 4 / 5;
  C_AND_E[t] = (t === 11 ? 15 : 7) / 2 - 1 / 2;
}

/** Five units: two on the high number, one on each of the other three. */
function hornHigh(high: number): Record<number, number> {
  const out: Record<number, number> = {};
  for (const t of [2, 3, 11, 12]) {
    const staked = t === high ? 2 / 5 : 1 / 5;
    out[t] = staked * hornLeg(t) - (1 - staked);
  }
  return out;
}

describe('single-roll bets', () => {
  beforeAll(() => {
    runSpots('single-roll', SINGLE_ROLLS, { propsRideAfterWin: false, fieldPays3OnTwelve: true }, [
      ...Object.values(propSpots),
      hopEasy,
      hopHard,
      field3,
    ]);
    runSpots('field-2x', SINGLE_ROLLS, { propsRideAfterWin: false, fieldPays3OnTwelve: false }, [field2]);
  }, 900_000);

  const cases: [Spot, number][] = [
    [propSpots.ANY_7, singleRollEdge({ 7: 4 })],
    [propSpots.ANY_CRAPS, singleRollEdge({ 2: 7, 3: 7, 12: 7 })],
    [propSpots.TWO, singleRollEdge({ 2: 30 })],
    [propSpots.THREE, singleRollEdge({ 3: 15 })],
    [propSpots.YO, singleRollEdge({ 11: 15 })],
    [propSpots.TWELVE, singleRollEdge({ 12: 30 })],
    [propSpots.HORN, singleRollEdge(HORN)],
    [propSpots.WORLD, singleRollEdge(WORLD)],
    [propSpots.C_AND_E, singleRollEdge(C_AND_E)],
    [propSpots.HORN_HIGH_2, singleRollEdge(hornHigh(2))],
    [propSpots.HORN_HIGH_3, singleRollEdge(hornHigh(3))],
    [propSpots.HORN_HIGH_YO, singleRollEdge(hornHigh(11))],
    [propSpots.HORN_HIGH_12, singleRollEdge(hornHigh(12))],
  ];

  for (const [sp, theory] of cases) {
    it(`prices ${sp.series.label.toLowerCase()} off its own paytable`, () => {
      check(sp.series, theory);
    });
  }

  it('pays an easy hop 15:1 and a hard hop 30:1', () => {
    // Two ways in thirty-six against 15:1 is 11.111%; one way against 30:1 is
    // 13.889%. Different ratios, so both are worth a run.
    check(hopEasy.series, edgeFrom(2 / 36, PROP_AMOUNT * 15, PROP_AMOUNT));
    check(hopHard.series, edgeFrom(1 / 36, PROP_AMOUNT * 30, PROP_AMOUNT));
  });

  it('prices the field at 2.778 percent with triple on the twelve', () => {
    check(field3.series, singleRollEdge({ 2: 2, 3: 1, 4: 1, 9: 1, 10: 1, 11: 1, 12: 3 }));
  });

  it('prices the field at 5.556 percent when the twelve only pays double', () => {
    // Exactly twice the edge. One extra unit on a one-in-thirty-six number is
    // the whole difference between a tolerable field and a bad one.
    check(field2.series, singleRollEdge({ 2: 2, 3: 1, 4: 1, 9: 1, 10: 1, 11: 1, 12: 2 }));
  });
});

/* ------------------------------------------------------------------ *
 * Side bets
 *
 * These resolve once a hand rather than once a roll and they pay hundreds to
 * one, so the honest band at any sample size a person will sit through is a
 * wide one. Measured and reported rather than pinned down: the assertion is
 * still theory plus or minus three standard errors, it is simply that three
 * standard errors is a lot of percentage points here.
 * ------------------------------------------------------------------ */

const fireSpot = spot('Fire Bet', { kind: 'FIRE' }, 10, false);
const atsSpots = {
  SMALL: spot('Small (30:1)', { kind: 'ATS', ats: 'SMALL' }, 10, false),
  TALL: spot('Tall (30:1)', { kind: 'ATS', ats: 'TALL' }, 10, false),
  ALL: spot('All (150:1)', { kind: 'ATS', ats: 'ALL' }, 10, false),
};

describe('side bets', () => {
  beforeAll(() => {
    runSpots('side-bets', SIDE_ROLLS, { fireBetEnabled: true, atsEnabled: true }, [
      fireSpot,
      ...Object.values(atsSpots),
    ]);
  }, 900_000);

  it('prices the Fire Bet at 20.76 percent', () => {
    /*
     * Exact distribution of unique points made before the seven-out, from the
     * Markov chain over subsets of the six box numbers:
     *   four points 0.00879818, five 0.00163993, six 0.00016243.
     * Against 24:1, 249:1 and 999:1 that is a 20.763% house edge, the canonical
     * figure for this paytable. The band is wide because a 999:1 payout carries
     * a standard deviation of about sixteen dollars per dollar bet.
     */
    const p4 = 0.008798178440403;
    const p5 = 0.001639933138953;
    const p6 = 0.00016243474927;
    check(fireSpot.series, -(p4 * 24 + p5 * 249 + p6 * 999 - (1 - p4 - p5 - p6)));
  });

  it('prices Small and Tall at 18.30 percent and All at 20.61 percent', () => {
    // P(all five small numbers before a seven) = 0.02635391, and the same for
    // tall by symmetry; P(all ten) = 0.00525770.
    const pSmall = 0.026353909248646;
    const pAll = 0.005257704096196;
    const small = -(pSmall * 30 - (1 - pSmall));
    check(atsSpots.SMALL.series, small);
    check(atsSpots.TALL.series, small);
    check(atsSpots.ALL.series, -(pAll * 150 - (1 - pAll)));
  });
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

/* ------------------------------------------------------------------ *
 * The money never appears from nowhere
 * ------------------------------------------------------------------ */

describe('bookkeeping', () => {
  it('moves exactly what the settlements say it moved', () => {
    // Everything above is measured from settlement records, so it is worth
    // proving over a long run that a seat's equity only ever changes by the
    // net the settlements reported.
    const rng = createRng('balance');
    let s = createTable({ buyIn: 1_000_000, rules: { minBet: 1, historyLimit: 0 } });
    const equity = (t: TableState) => t.seats.A.bankroll + atRisk(t, 'A');
    for (let i = 0; i < 20_000; i++) {
      const res = placeBet(s, 'A', { kind: s.phase === 'COME_OUT' ? 'PASS' : 'COME' }, 5);
      if (res.ok) s = res.state;
      if (s.point !== null) {
        const odds = maxOddsAll(s, 'A');
        if (odds.ok) s = odds.state;
      }
      const before = equity(s);
      const out = applyRoll(s, rollDice(rng));
      s = out.state;
      let moved = 0;
      for (const st of out.settlements) moved += st.net;
      expect(equity(s)).toBeCloseTo(before + moved, 6);
    }
  }, 600_000);
});
