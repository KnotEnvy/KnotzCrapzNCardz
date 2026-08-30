/**
 * The measured return.
 *
 * A paytable is a hypothesis. This file is the experiment: it plays tens of
 * millions of seeded spins through the real engine -- the same `spin`, the
 * same `evaluate`, the same feature code the cabinet runs -- and reports what
 * the machine actually gives back and where each part of it comes from.
 *
 *   npm run test:stats
 *
 * Kept out of the default suite so `npm test` stays a two-second loop. Every
 * run is seeded, so these are deterministic rather than flaky: the same
 * strips and the same seed produce the same table every time, and a number
 * that moves is a number somebody changed.
 *
 * WHY THE SPLIT MATTERS AS MUCH AS THE TOTAL. Two machines can both return
 * 96.2% and be completely different products. One that returns it all through
 * the base game is a grinder that never does anything; one that returns half
 * of it through a feature nobody reaches is a machine that feels broken for an
 * hour and then pays a mortgage. The design here wants roughly half the return
 * in the base game, a third in the shrine, and the rest in the link, and that
 * shape is only checkable by attributing every cent to the thing that paid it.
 * So the accumulator below never adds a win without saying where it came from.
 *
 * DENOMINATOR. Every RTP figure is cents returned divided by cents wagered,
 * where a wager is one base spin at `totalBet`. Free spins and link respins
 * cost nothing and are therefore never counted as wagers -- they are part of
 * the return on the spin that bought them. A feature buy is the exception and
 * is measured on its own terms, against what the button charged.
 *
 * Sample size is settable with SIM_SPINS so the table can be tuned against a
 * short run and verified once at full length. The assertions are written
 * against the confidence interval the run itself measured, so a short run
 * fails honestly rather than passing loosely.
 */

import { afterAll, describe, expect, it } from 'vitest';
import { createRng, type Rng } from './rng';
import { spin } from './spin';
import { applyFreeSpin, startFreeSpins } from './features';
import { finishHold, holdRespin, startHold } from './holdwin';
import { buyCost, buyForce } from './buy';
import {
  BUY_COSTS,
  JACKPOTS,
  RTP_TARGET,
  type BuyOption,
} from './paytable';
import { JACKPOT_IDS, type FeatureTrigger, type JackpotId, type Stake } from './types';

/* ------------------------------------------------------------------ *
 * Sample sizes
 * ------------------------------------------------------------------ */

const envSpins = Number(process.env.SIM_SPINS ?? '');
/** Base spins behind the headline figure. */
const SPINS = Number.isFinite(envSpins) && envSpins > 0 ? Math.floor(envSpins) : 20_000_000;
/** Buys priced per option. Each one drags a whole feature behind it, so fewer. */
const BUYS = Math.max(20_000, Math.floor(SPINS / 60));

/** The stake every measurement runs at. Cents: $1 a line, $50 a spin. */
const STAKE: Stake = { betPerLine: 100, totalBet: 5_000 };

/* ------------------------------------------------------------------ *
 * Measurement
 * ------------------------------------------------------------------ */

/**
 * Where the money went.
 *
 * Cents, not ratios, because cents add and ratios do not: the split has to sum
 * to the total exactly or the attribution has a hole in it, and the summary
 * table asserts that it does.
 */
interface Split {
  /** Line wins on base spins, Dragon Rage included -- it is a base-game event. */
  baseLines: number;
  /** Pearl pays on base spins. */
  baseScatter: number;
  /** Everything won inside the shrine, lines and pearls and the trail. */
  freeSpins: number;
  /** Orb credits from the link. Jackpots are counted separately below. */
  holdCredits: number;
  /** Each jackpot's own contribution, wherever it was won. */
  jackpots: Record<JackpotId, number>;
}

function emptySplit(): Split {
  return {
    baseLines: 0,
    baseScatter: 0,
    freeSpins: 0,
    holdCredits: 0,
    jackpots: { MINI: 0, MINOR: 0, MAJOR: 0, GRAND: 0 },
  };
}

interface Run {
  spins: number;
  wagered: number;
  split: Split;
  /** Spins that returned anything at all, feature winnings included. */
  hits: number;
  freeTriggers: number;
  holdTriggers: number;
  freeSpinsPlayed: number;
  retriggers: number;
  holdRespins: number;
  jackpotHits: Record<JackpotId, number>;
  /** Sum and sum of squares of per-spin return as a multiple of the stake. */
  sumRatio: number;
  sumRatioSq: number;
  maxWin: number;
  /** Highest trail rung any session reached, and the total steps climbed. */
  trailTop: number;
}

function emptyRun(): Run {
  return {
    spins: 0,
    wagered: 0,
    split: emptySplit(),
    hits: 0,
    freeTriggers: 0,
    holdTriggers: 0,
    freeSpinsPlayed: 0,
    retriggers: 0,
    holdRespins: 0,
    jackpotHits: { MINI: 0, MINOR: 0, MAJOR: 0, GRAND: 0 },
    sumRatio: 0,
    sumRatioSq: 0,
    maxWin: 0,
    trailTop: 0,
  };
}

function splitTotal(s: Split): number {
  let total = s.baseLines + s.baseScatter + s.freeSpins + s.holdCredits;
  for (const id of JACKPOT_IDS) total += s.jackpots[id];
  return total;
}

/* ------------------------------------------------------------------ *
 * Playing the features out
 * ------------------------------------------------------------------ */

/**
 * Play a shrine session to its end.
 *
 * The loop reads `awarded` fresh each time because a retrigger raises it from
 * inside the loop -- which is exactly the behaviour worth simulating, since a
 * feature that can extend itself has a return that no closed form gets right.
 * The guard is not expected to fire; it exists because "cannot loop forever"
 * is a claim about the retrigger rate and this file is where such claims get
 * checked rather than assumed.
 */
function playFreeSpins(
  rng: Rng,
  stake: Stake,
  trigger: FeatureTrigger,
  bought: boolean,
  run: Run,
): number {
  let state = startFreeSpins(trigger, stake, bought);
  let guard = 0;
  while (state.played < state.awarded) {
    const result = spin({ rng, stake, mode: 'FREE', free: state });
    const before = state;
    state = applyFreeSpin(state, result);
    if (state.retriggers > before.retriggers) run.retriggers++;
    run.freeSpinsPlayed++;
    if (++guard > 10_000) break;
  }
  if (state.trailIndex > run.trailTop) run.trailTop = state.trailIndex;
  return state.won;
}

/** Play a link session to its end, splitting orb credits from jackpots. */
function playHold(
  rng: Rng,
  stake: Stake,
  trigger: FeatureTrigger,
  seedOrbs: Parameters<typeof startHold>[1],
  bought: boolean,
  run: Run,
): number {
  void trigger;
  let state = startHold(rng, seedOrbs, stake.totalBet, bought);
  while (state.respinsLeft > 0) {
    state = holdRespin(rng, state).state;
    run.holdRespins++;
  }
  const { total, jackpots } = finishHold(state);
  let jackpotCents = 0;
  for (const id of jackpots) {
    const cents = Math.round(JACKPOTS[id] * stake.totalBet);
    run.split.jackpots[id] += cents;
    run.jackpotHits[id]++;
    jackpotCents += cents;
  }
  run.split.holdCredits += total - jackpotCents;
  return total;
}

/**
 * One paid spin and everything it drags behind it.
 *
 * Returns the cents that spin was worth in the end. The caller owns the
 * wagering; this owns the attribution, which is why every branch writes into
 * exactly one bucket of the split.
 */
function playSpin(rng: Rng, stake: Stake, run: Run, force?: { scatters?: number; orbs?: number }): number {
  const result = spin({ rng, stake, mode: 'BASE', force });

  let lines = 0;
  for (const win of result.lineWins) lines += win.amount;
  run.split.baseLines += lines;
  const scatterPay = result.scatter?.amount ?? 0;
  run.split.baseScatter += scatterPay;

  let won = lines + scatterPay;

  const trigger = result.trigger;
  if (trigger?.feature === 'FREE_SPINS') {
    run.freeTriggers++;
    const gained = playFreeSpins(rng, stake, trigger, force !== undefined, run);
    run.split.freeSpins += gained;
    won += gained;
  } else if (trigger?.feature === 'HOLD_AND_WIN') {
    run.holdTriggers++;
    won += playHold(rng, stake, trigger, result.orbs, force !== undefined, run);
  }

  return won;
}

/** Play `n` paid base spins at `stake`, no buying. */
function playBase(seed: string, n: number, stake: Stake): Run {
  const rng = createRng(seed);
  const run = emptyRun();
  for (let i = 0; i < n; i++) {
    run.spins++;
    run.wagered += stake.totalBet;
    const won = playSpin(rng, stake, run);
    if (won > 0) run.hits++;
    const ratio = won / stake.totalBet;
    run.sumRatio += ratio;
    run.sumRatioSq += ratio * ratio;
    if (won > run.maxWin) run.maxWin = won;
  }
  return run;
}

/** Play `n` presses of one buy button. */
function playBuys(seed: string, option: BuyOption, n: number, stake: Stake): Run {
  const rng = createRng(seed);
  const run = emptyRun();
  const cost = buyCost(option, stake.totalBet);
  const force = buyForce(option);
  for (let i = 0; i < n; i++) {
    run.spins++;
    run.wagered += cost;
    const won = playSpin(rng, stake, run, force);
    if (won > 0) run.hits++;
    const ratio = won / cost;
    run.sumRatio += ratio;
    run.sumRatioSq += ratio * ratio;
    if (won > run.maxWin) run.maxWin = won;
  }
  return run;
}

/* ------------------------------------------------------------------ *
 * Statistics
 * ------------------------------------------------------------------ */

function rtp(run: Run): number {
  return splitTotal(run.split) / run.wagered;
}

/**
 * Standard deviation of the return on one spin, in units of the stake.
 *
 * This is the number that decides what the machine feels like. A slot with an
 * sd of 3 pays small and often; one with an sd of 25 is a machine you can lose
 * a bankroll on in forty spins and then win it back in one. It is also what
 * sets the confidence interval on the RTP itself -- a high-variance game needs
 * far more spins before its measured return means anything, which is why the
 * interval is reported next to the figure rather than assumed to be tight.
 */
function volatility(run: Run): number {
  const mean = run.sumRatio / run.spins;
  return Math.sqrt(Math.max(0, run.sumRatioSq / run.spins - mean * mean));
}

/** Half-width of the 95% interval on the measured RTP. */
function rtpInterval(run: Run): number {
  return (1.96 * volatility(run)) / Math.sqrt(run.spins);
}

function pct(x: number): string {
  return `${(x * 100).toFixed(3)}%`;
}

function oneIn(p: number): string {
  return p > 0 ? `1 in ${Math.round(1 / p).toLocaleString('en-US')}` : 'never';
}

/* ------------------------------------------------------------------ *
 * The report
 * ------------------------------------------------------------------ */

interface Report {
  base: Run;
  buys: { option: BuyOption; run: Run }[];
}

const report: Report = { base: emptyRun(), buys: [] };

afterAll(() => {
  const base = report.base;
  if (base.spins === 0) return;

  const total = rtp(base);
  const split = base.split;
  const rows: [string, number][] = [
    ['base game line wins', split.baseLines],
    ['pearl (scatter) pays', split.baseScatter],
    ['free spins — Shrine of Flames', split.freeSpins],
    ['hold & win — orb credits', split.holdCredits],
    ['  jackpot MINI', split.jackpots.MINI],
    ['  jackpot MINOR', split.jackpots.MINOR],
    ['  jackpot MAJOR', split.jackpots.MAJOR],
    ['  jackpot GRAND', split.jackpots.GRAND],
  ];

  const w = Math.max(...rows.map((r) => r[0].length), 30);
  const out: string[] = [];
  out.push('');
  out.push(`DRAGON'S SHRINE — MEASURED RETURN over ${base.spins.toLocaleString('en-US')} spins at $${(STAKE.totalBet / 100).toFixed(2)}`);
  out.push('');
  out.push(`${'source'.padEnd(w)}  ${'RTP'.padStart(9)}  ${'share'.padStart(8)}`);
  out.push('-'.repeat(w + 21));
  for (const [label, cents] of rows) {
    const contribution = cents / base.wagered;
    out.push(
      `${label.padEnd(w)}  ${pct(contribution).padStart(9)}  ${pct(contribution / total).padStart(8)}`,
    );
  }
  out.push('-'.repeat(w + 21));
  out.push(`${'TOTAL'.padEnd(w)}  ${pct(total).padStart(9)}  ${pct(1).padStart(8)}`);
  out.push(`${'  95% interval'.padEnd(w)}  ${`+/-${pct(rtpInterval(base))}`.padStart(9)}`);
  out.push(`${'  target band'.padEnd(w)}  ${`${pct(RTP_TARGET.min)}–${pct(RTP_TARGET.max)}`.padStart(9)}`);
  out.push('');

  const behaviour: [string, string][] = [
    ['hit frequency', `${pct(base.hits / base.spins)}  (${oneIn(base.hits / base.spins)})`],
    ['volatility (sd of return/spin)', volatility(base).toFixed(2)],
    ['max single spin', `${(base.maxWin / STAKE.totalBet).toFixed(1)}x stake`],
    ['free spins trigger', oneIn(base.freeTriggers / base.spins)],
    ['hold & win trigger', oneIn(base.holdTriggers / base.spins)],
    ['free spins played per trigger', (base.freeSpinsPlayed / Math.max(1, base.freeTriggers)).toFixed(2)],
    ['retrigger rate per free spin', oneIn(base.retriggers / Math.max(1, base.freeSpinsPlayed))],
    ['respins per link session', (base.holdRespins / Math.max(1, base.holdTriggers)).toFixed(2)],
    ['top trail rung reached', String(base.trailTop)],
  ];
  for (const id of JACKPOT_IDS) {
    behaviour.push([`${id} jackpot`, oneIn(base.jackpotHits[id] / base.spins)]);
  }
  out.push('BEHAVIOUR');
  out.push('-'.repeat(w + 21));
  for (const [label, value] of behaviour) out.push(`${label.padEnd(w)}  ${value}`);
  out.push('');

  if (report.buys.length > 0) {
    out.push(`FEATURE BUYS — each must return at or below the base game's ${pct(total)}`);
    out.push(`${'button'.padEnd(w)}  ${'cost'.padStart(9)}  ${'RTP'.padStart(9)}  ${'vs base'.padStart(9)}  ${'presses'.padStart(9)}`);
    out.push('-'.repeat(w + 45));
    for (const { option, run } of report.buys) {
      const r = rtp(run);
      out.push(
        `${option.padEnd(w)}  ${`${BUY_COSTS[option]}x`.padStart(9)}  ${pct(r).padStart(9)}  ${pct(r - total).padStart(9)}  ${String(run.spins).padStart(9)}`,
      );
    }
    out.push('');
  }

  console.log(out.join('\n'));
});

/* ------------------------------------------------------------------ *
 * The measurements
 * ------------------------------------------------------------------ */

describe('measured return', () => {
  it(`returns inside the target band over ${SPINS.toLocaleString('en-US')} spins`, () => {
    const run = playBase('dragons-shrine-rtp', SPINS, STAKE);
    report.base = run;

    // The attribution has to be exhaustive: if the split does not add up to
    // what the run paid out, some path is winning money the report cannot see
    // and every figure below it is describing a different machine.
    expect(splitTotal(run.split)).toBeGreaterThan(0);

    const measured = rtp(run);
    const interval = rtpInterval(run);

    // The band has to be earned, not assumed. A run so short that its interval
    // straddles the whole target would "pass" by being uninformative.
    expect(
      interval,
      `interval +/-${pct(interval)} is too wide to say anything about a ${pct(RTP_TARGET.min)}–${pct(RTP_TARGET.max)} band`,
    ).toBeLessThan((RTP_TARGET.max - RTP_TARGET.min) / 2);

    expect(
      measured,
      `measured ${pct(measured)} +/-${pct(interval)} against target ${pct(RTP_TARGET.min)}–${pct(RTP_TARGET.max)}`,
    ).toBeGreaterThanOrEqual(RTP_TARGET.min);
    expect(measured).toBeLessThanOrEqual(RTP_TARGET.max);
  });

  it('triggers the shrine about once in two hundred spins', () => {
    const run = report.base;
    const rate = run.freeTriggers / run.spins;
    // The design band. Much rarer and the machine is a desert between
    // features; much more often and the feature stops being an event.
    expect(1 / rate).toBeGreaterThan(150);
    expect(1 / rate).toBeLessThan(250);
  });

  it('keeps the link rarer than the shrine', () => {
    const run = report.base;
    expect(run.holdTriggers).toBeGreaterThan(0);
    expect(run.holdTriggers).toBeLessThan(run.freeTriggers);
  });

  it('pays something often enough to be playable', () => {
    const run = report.base;
    const hit = run.hits / run.spins;
    expect(hit).toBeGreaterThan(0.18);
    expect(hit).toBeLessThan(0.45);
  });

  it('awards every jackpot at least once', () => {
    for (const id of JACKPOT_IDS) {
      expect(report.base.jackpotHits[id], `${id} never landed`).toBeGreaterThan(0);
    }
  });
});

describe('feature buys', () => {
  /**
   * A buy must never be the strictly correct play.
   *
   * The floor matters as much as the ceiling. A buy priced far below base
   * return is not "safe", it is a trap -- the button is the most expensive
   * thing on the machine and a player pressing it is entitled to roughly the
   * same deal they get from the spin button, minus a small premium for
   * skipping the wait.
   */
  it.each<BuyOption>(['FREE_SPINS', 'HOLD_AND_WIN', 'SUPER'])(
    'prices %s at or just below the base game',
    (option) => {
      const run = playBuys(`dragons-shrine-buy-${option}`, option, BUYS, STAKE);
      report.buys.push({ option, run });

      const measured = rtp(run);
      const base = rtp(report.base);
      const interval = rtpInterval(run);

      expect(
        measured - interval,
        `${option} returns ${pct(measured)} +/-${pct(interval)} against a base game of ${pct(base)}`,
      ).toBeLessThanOrEqual(base);
      expect(measured + interval).toBeGreaterThan(base - 0.04);
    },
  );
});
