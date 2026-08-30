/**
 * Reading a board.
 *
 * This is the only place that decides what a grid is worth, and it is pure:
 * hand it a window, the cells a feature has turned wild, and a stake, and it
 * hands back the wins. No randomness, no state, no clock. Everything else in
 * the engine -- the base spin, a free spin under a 10x trail, a bought
 * feature's forced board -- routes through this one function, which is what
 * makes "the maths" a single auditable thing rather than a property of
 * whichever code path produced the board.
 *
 * Three rules do all the work, and they are the ones every line-pay slot has
 * used since the first video reel:
 *
 *   Left to right from reel 1. A run that starts on reel 2 is not a win, no
 *   matter how long it is. This is why a wild on reel 1 is worth so much more
 *   than a wild anywhere else, and why the base band does not carry one.
 *
 *   Highest win per line only. A line is worth its single best reading, not
 *   the sum of every reading. It matters exactly once -- when the leading
 *   cells are wild and the line could be read as several different symbols --
 *   and getting it wrong there is worth a percent of return.
 *
 *   Wilds substitute for everything except the scatter and the orb. A feature
 *   symbol that a wild could stand in for would let Dragon Rage trigger the
 *   free spins, which is a different and much more expensive machine.
 *
 * Money: a line pay multiplies `betPerLine`, a scatter pay multiplies
 * `totalBet`, and both of those are whole cents, so every amount this file
 * produces is a whole number of cents without any rounding being needed. The
 * `Math.round` calls are there anyway, at the two multiplications, because a
 * fractional multiplier is exactly the kind of thing a future paytable tweak
 * introduces and a silent half-cent is exactly the kind of bug that survives
 * to production.
 */

import { LINE_CELLS } from './lines';
import { PAYS, SCATTER_PAYS } from './paytable';
import {
  PAYING_SYMBOLS,
  REELS,
  ROWS,
  type Cell,
  type Grid,
  type LineWin,
  type PayingSymbol,
  type ScatterWin,
  type Stake,
  type SymbolId,
} from './types';

/**
 * Which cells count as wild, as a flat lookup.
 *
 * A cell is wild if the band printed a WILD there or if a feature made it one.
 * Both are checked because the two callers disagree about which they populate:
 * `spin` writes WILD into the grid so the reels draw a wild, and also lists
 * the cells so the presentation can tell a dragon's wild from a printed one.
 * Trusting only one of those would quietly under-pay a raged board if the
 * other lane ever built a grid the other way.
 */
function wildMask(grid: Grid, wildCells: readonly Cell[]): boolean[][] {
  const mask: boolean[][] = new Array(REELS);
  for (let reel = 0; reel < REELS; reel++) {
    const col = new Array<boolean>(ROWS);
    for (let row = 0; row < ROWS; row++) col[row] = grid[reel][row] === 'WILD';
    mask[reel] = col;
  }
  for (const cell of wildCells) {
    const col = mask[cell.reel];
    if (col !== undefined && cell.row >= 0 && cell.row < ROWS) col[cell.row] = true;
  }
  return mask;
}

/** True when `symbol` is one the paytable has a row for. */
function isPaying(symbol: SymbolId): symbol is PayingSymbol {
  return (PAYING_SYMBOLS as readonly SymbolId[]).includes(symbol);
}

/**
 * Every cell holding `symbol`, in reel-major order.
 *
 * Exported because `spin` needs the pearls and the orbs whether or not they
 * paid: three pearls both pay and trigger, six orbs trigger and do not pay,
 * and two pearls do neither but still decide which reels tease.
 */
export function findSymbolCells(grid: Grid, symbol: SymbolId): Cell[] {
  const cells: Cell[] = [];
  for (let reel = 0; reel < REELS; reel++) {
    for (let row = 0; row < ROWS; row++) {
      if (grid[reel][row] === symbol) cells.push({ reel, row });
    }
  }
  return cells;
}

/**
 * The best reading of one payline, or null.
 *
 * The candidate set is where the highest-win-per-line rule lives. When reel 1
 * is not wild there is exactly one symbol the line can possibly be -- whatever
 * sits on reel 1 -- and the loop runs once. When reel 1 *is* wild, which only
 * happens under Dragon Rage, the line has to be read as every paying symbol in
 * turn and the best reading kept: three wilds followed by two dragons is worth
 * more as five dragons than as three wilds, and three wilds followed by two
 * coins is worth more as three wilds than as five coins.
 */
function evaluateLine(
  grid: Grid,
  wild: boolean[][],
  line: number,
  betPerLine: number,
): LineWin | null {
  const cells = LINE_CELLS[line];
  const firstRow = cells[0].row;
  const firstSymbol = grid[0][firstRow];
  const firstWild = wild[0][firstRow];
  if (!firstWild && !isPaying(firstSymbol)) return null;

  const candidates: readonly PayingSymbol[] = firstWild ? PAYING_SYMBOLS : [firstSymbol];

  let bestSymbol: PayingSymbol | null = null;
  let bestCount = 0;
  let bestMultiplier = 0;

  for (const symbol of candidates) {
    let count = 0;
    for (let reel = 0; reel < REELS; reel++) {
      const row = cells[reel].row;
      const isWild = wild[reel][row];
      // A WILD line is a run of actual wilds; every other symbol accepts a
      // wild as a stand-in. That asymmetry is the whole substitution rule.
      const matches = symbol === 'WILD' ? isWild : isWild || grid[reel][row] === symbol;
      if (!matches) break;
      count++;
    }
    if (count < 3) continue;
    const multiplier = PAYS[symbol][count - 3];
    if (multiplier > bestMultiplier) {
      bestSymbol = symbol;
      bestCount = count;
      bestMultiplier = multiplier;
    }
  }

  if (bestSymbol === null) return null;

  const winning: Cell[] = new Array(bestCount);
  let wildAssisted = false;
  for (let reel = 0; reel < bestCount; reel++) {
    const cell = cells[reel];
    winning[reel] = { reel: cell.reel, row: cell.row };
    // A wild-only line is not "wild assisted" -- nothing stood in for anything.
    if (bestSymbol !== 'WILD' && wild[reel][cell.row]) wildAssisted = true;
  }

  return {
    line,
    symbol: bestSymbol,
    count: bestCount,
    cells: winning,
    multiplier: bestMultiplier,
    amount: Math.round(bestMultiplier * betPerLine),
    wildAssisted,
  };
}

/**
 * The pearl pay.
 *
 * Scatters pay from anywhere and against the whole stake, and wilds never
 * substitute for them, so this is a plain count. Fewer than three is not a
 * win even though it may well be a trigger's near miss, and the caller reads
 * the near miss off {@link findSymbolCells} instead.
 */
function evaluateScatter(grid: Grid, totalBet: number): ScatterWin | null {
  const cells = findSymbolCells(grid, 'SCATTER');
  const multiplier = SCATTER_PAYS[cells.length];
  if (multiplier === undefined) return null;
  return { count: cells.length, cells, multiplier, amount: Math.round(multiplier * totalBet) };
}

/**
 * Everything a board pays, before any feature multiplier.
 *
 * The total deliberately does *not* include the free spins trail: `spin` owns
 * that, because the trail is a property of the session rather than of the
 * board, and a board evaluated twice under two different trails must give the
 * same answer both times.
 */
export function evaluateGrid(
  grid: Grid,
  wildCells: Cell[],
  stake: Stake,
): { lineWins: LineWin[]; scatter: ScatterWin | null; total: number } {
  const wild = wildMask(grid, wildCells);
  const lineWins: LineWin[] = [];
  let total = 0;

  for (let line = 0; line < LINE_CELLS.length; line++) {
    const win = evaluateLine(grid, wild, line, stake.betPerLine);
    if (win !== null) {
      lineWins.push(win);
      total += win.amount;
    }
  }

  const scatter = evaluateScatter(grid, stake.totalBet);
  if (scatter !== null) total += scatter.amount;

  return { lineWins, scatter, total };
}
