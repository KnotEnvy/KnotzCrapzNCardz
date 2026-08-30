/**
 * The fifty paylines.
 *
 * A payline is one row index per reel, left to right. Every line here is
 * *adjacent* -- consecutive reels never jump more than one row -- which is not
 * a maths constraint but a legibility one: a player has to be able to trace a
 * win with a finger, and a line that leaps from the top row to the bottom
 * reads as a mistake even when it is paying.
 *
 * There are 178 such paths on a five-by-four window. These are the first fifty
 * in order of how quiet they are: the four straights, then the single-step
 * shapes, then the Vs, each immediately followed by its vertical mirror so the
 * set stays symmetric on the glass.
 *
 * All fifty are always active. Line count is not a bet option here, which is
 * what lets the paytable be quoted per line and read honestly.
 */

import { LINES, REELS, type Cell } from './types';

/** `PAYLINES[line][reel]` is the row that line occupies on that reel. */
export const PAYLINES: readonly (readonly number[])[] = [
  [0, 0, 0, 0, 0],
  [1, 1, 1, 1, 1],
  [2, 2, 2, 2, 2],
  [3, 3, 3, 3, 3],
  [0, 0, 0, 0, 1],
  [3, 3, 3, 3, 2],
  [0, 0, 0, 1, 1],
  [3, 3, 3, 2, 2],
  [0, 0, 1, 1, 1],
  [3, 3, 2, 2, 2],
  [0, 1, 1, 1, 1],
  [3, 2, 2, 2, 2],
  [1, 0, 0, 0, 0],
  [2, 3, 3, 3, 3],
  [1, 1, 0, 0, 0],
  [2, 2, 3, 3, 3],
  [1, 1, 1, 0, 0],
  [2, 2, 2, 3, 3],
  [1, 1, 1, 1, 0],
  [2, 2, 2, 2, 3],
  [1, 1, 1, 1, 2],
  [2, 2, 2, 2, 1],
  [1, 1, 1, 2, 2],
  [2, 2, 2, 1, 1],
  [1, 1, 2, 2, 2],
  [2, 2, 1, 1, 1],
  [1, 2, 2, 2, 2],
  [2, 1, 1, 1, 1],
  [0, 0, 0, 1, 2],
  [3, 3, 3, 2, 1],
  [0, 0, 1, 1, 0],
  [3, 3, 2, 2, 3],
  [0, 0, 1, 1, 2],
  [3, 3, 2, 2, 1],
  [0, 0, 1, 2, 2],
  [3, 3, 2, 1, 1],
  [0, 1, 1, 0, 0],
  [3, 2, 2, 3, 3],
  [0, 1, 1, 1, 0],
  [3, 2, 2, 2, 3],
  [0, 1, 1, 1, 2],
  [3, 2, 2, 2, 1],
  [0, 1, 1, 2, 2],
  [3, 2, 2, 1, 1],
  [0, 1, 2, 2, 2],
  [3, 2, 1, 1, 1],
  [1, 0, 0, 0, 1],
  [2, 3, 3, 3, 2],
  [1, 0, 0, 1, 1],
  [2, 3, 3, 2, 2],
];

/** The cells a line passes through, left to right. */
export function lineCells(line: number): Cell[] {
  const rows = PAYLINES[line];
  const cells: Cell[] = [];
  for (let reel = 0; reel < REELS; reel++) cells.push({ reel, row: rows[reel] });
  return cells;
}

/**
 * Every line's cells, computed once.
 *
 * Evaluation walks all fifty lines on every spin and an autoplay session runs
 * hundreds of spins a minute, so this is worth not rebuilding each time. The
 * simulation suite, which runs tens of millions of spins, cares rather more.
 */
export const LINE_CELLS: readonly (readonly Cell[])[] = PAYLINES.map((_, i) => lineCells(i));

if (PAYLINES.length !== LINES) {
  throw new Error(`paylines: expected ${LINES}, found ${PAYLINES.length}`);
}
