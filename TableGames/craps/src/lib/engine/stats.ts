/**
 * Derived numbers for the heads-up display.
 *
 * The point of these is comparison against theory. Craps players spend a lot of
 * energy convinced a table is "cold", so the HUD shows what the distribution
 * should look like next to what it actually did, along with how far outside
 * normal variance the session really is.
 */

import type { RollRecord, SeatId, TableState } from './types';

/** Ways to make each total with two dice, indexed by total. */
export const WAYS: number[] = [0, 0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1];

export const TOTALS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

export interface TotalRow {
  total: number;
  actual: number;
  expected: number;
  /** How many standard deviations the actual count sits from expectation. */
  z: number;
}

export function distribution(counts: number[], rolls: number): TotalRow[] {
  return TOTALS.map((total) => {
    const p = WAYS[total] / 36;
    const expected = rolls * p;
    const sd = Math.sqrt(rolls * p * (1 - p));
    const actual = counts[total] ?? 0;
    return { total, actual, expected, z: sd > 0 ? (actual - expected) / sd : 0 };
  });
}

/** Cumulative dollar swing per seat across the retained history window. */
export interface EquityPoint {
  index: number;
  A: number;
  B: number;
}

export function equityCurve(history: RollRecord[]): EquityPoint[] {
  let a = 0;
  let b = 0;
  const out: EquityPoint[] = [{ index: 0, A: 0, B: 0 }];
  for (const rec of history) {
    a += rec.net.A;
    b += rec.net.B;
    out.push({ index: rec.index, A: a, B: b });
  }
  return out;
}

export interface SeatSummary {
  seat: SeatId;
  name: string;
  bankroll: number;
  buyIn: number;
  net: number;
  /** Return on the money actually put through the table. */
  yield: number;
  totalWagered: number;
  /** Worst peak-to-trough fall in the bankroll. */
  drawdown: number;
}

export function seatSummary(table: TableState, seat: SeatId): SeatSummary {
  const s = table.seats[seat];
  const atRisk = table.bets
    .filter((b) => b.seat === seat)
    .reduce((sum, b) => sum + b.amount + b.odds, 0);
  const equity = s.bankroll + atRisk;
  const net = equity - s.buyIn;
  return {
    seat,
    name: s.name,
    bankroll: s.bankroll,
    buyIn: s.buyIn,
    net,
    yield: s.totalWagered > 0 ? net / s.totalWagered : 0,
    totalWagered: s.totalWagered,
    drawdown: Math.max(0, s.peak - equity),
  };
}

/** The headline table figures: how the dice have actually been running. */
export interface TableSummary {
  rolls: number;
  pointsMade: number;
  sevenOuts: number;
  /** Rolls per seven-out. Theory says 6 including the seven itself. */
  rollsPerSeven: number;
  longestHand: number;
  currentHand: number;
  /** Share of come-out rolls that turned into a point. */
  pointRate: number;
  hotNumbers: Array<{ total: number; z: number }>;
}

export function tableSummary(table: TableState): TableSummary {
  const { stats } = table;
  const sevens = stats.totals[7] ?? 0;
  const rows = distribution(stats.totals, stats.rolls);
  const hot = [...rows].sort((x, y) => y.z - x.z).slice(0, 3).map((r) => ({ total: r.total, z: r.z }));

  return {
    rolls: stats.rolls,
    pointsMade: stats.pointsMade,
    sevenOuts: stats.sevenOuts,
    rollsPerSeven: sevens > 0 ? stats.rolls / sevens : 0,
    longestHand: stats.longestHand,
    currentHand: stats.currentHand,
    pointRate:
      stats.rolls > 0
        ? stats.pointsMade / Math.max(1, stats.pointsMade + stats.sevenOuts)
        : 0,
    hotNumbers: hot,
  };
}
