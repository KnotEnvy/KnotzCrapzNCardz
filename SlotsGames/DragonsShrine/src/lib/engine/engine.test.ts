/**
 * The engine, checked for correctness rather than for return.
 *
 * This suite and `rtp.sim.test.ts` divide the work along a clean line. The
 * simulation answers "does this machine pay 96%", which is a statistical
 * question needing tens of millions of spins and several minutes. Everything
 * here answers "does this machine do what it says", which is a question about
 * individual boards and needs to run in under a second, because it runs on
 * every change.
 *
 * So nothing in this file is random unless the randomness is the thing under
 * test. Boards are built by hand, handed to the evaluator, and checked against
 * a payout worked out on paper. Where a seeded generator is unavoidable the
 * seed is fixed and the assertion is about a property -- "the draw order does
 * not change", "the flip is fair to within four standard errors" -- rather
 * than about a magic number that a future retune would falsify.
 *
 * The one thing worth knowing before adding to it: `spin` documents a fixed
 * order in which it takes random words, and that order is load-bearing for
 * every seeded replay in the repository. There is a test at the bottom that
 * pins it. If it fails, either the draw order changed deliberately -- in which
 * case update it and know that every seeded expectation elsewhere has moved --
 * or something inserted a draw by accident, which is the bug it exists to
 * catch.
 */

import { describe, expect, it } from 'vitest';
import { buyCost, buyForce } from './buy';
import { evaluateGrid } from './evaluate';
import { applyFreeSpin, freeSpinsRemaining, startFreeSpins, trailMultiplier } from './features';
import { canGamble, gamble } from './gamble';
import { finishHold, holdRespin, startHold } from './holdwin';
import { LINE_CELLS, PAYLINES } from './lines';
import {
  BUY_COSTS,
  GAMBLE_MAX_RATIO,
  GAMBLE_MAX_STEPS,
  HOLD_TRIGGER_ORBS,
  JACKPOTS,
  MAJOR_AT_CELLS,
  MULTIPLIER_TRAIL,
  ORB_VALUES,
  PAYS,
  RETRIGGER_SPINS,
  SCATTER_PAYS,
  SCATTER_TRIGGER,
} from './paytable';
import { createRng } from './rng';
import { spin } from './spin';
import { STRIPS, buildStrip } from './strips';
import {
  CELLS,
  LINES,
  REELS,
  ROWS,
  type Cell,
  type Grid,
  type Orb,
  type Stake,
  type SymbolId,
} from './types';

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

/** $1 a spin: 2c on each of the fifty lines. The ladder's second rung. */
const STAKE: Stake = { betPerLine: 2, totalBet: 100 };

/** A board of a single symbol, which no payline can accidentally miss. */
function fill(symbol: SymbolId): Grid {
  return Array.from({ length: REELS }, () => Array.from({ length: ROWS }, () => symbol));
}

/**
 * A board that pays nothing.
 *
 * Built by alternating two low symbols per reel so that no run of three can
 * form on any line, which lets a test place exactly the symbols it cares about
 * and know that everything else contributes zero.
 */
function blank(): Grid {
  const a: SymbolId = 'COIN';
  const b: SymbolId = 'LOTUS';
  return Array.from({ length: REELS }, (_, reel) =>
    Array.from({ length: ROWS }, (_, row) => ((reel + row) % 2 === 0 ? a : b)),
  );
}

/** Put `symbol` on line 0 for its first `count` reels. Line 0 is the top row. */
function runOnLine(grid: Grid, line: number, symbol: SymbolId, count: number): Grid {
  const cells = LINE_CELLS[line];
  for (let reel = 0; reel < count; reel++) grid[cells[reel].reel][cells[reel].row] = symbol;
  return grid;
}

/** Scatter the given symbol across `n` cells, one per reel from the left. */
function scatterAcross(grid: Grid, symbol: SymbolId, n: number): Grid {
  for (let i = 0; i < n; i++) grid[i % REELS][Math.floor(i / REELS)] = symbol;
  return grid;
}

/* ------------------------------------------------------------------ *
 * The window and the lines
 * ------------------------------------------------------------------ */

describe('geometry', () => {
  it('is five reels of four, and fifty lines', () => {
    expect(REELS).toBe(5);
    expect(ROWS).toBe(4);
    expect(LINES).toBe(50);
    expect(CELLS).toBe(20);
    expect(PAYLINES).toHaveLength(LINES);
  });

  it('gives every line one row on every reel, all in range', () => {
    for (const rows of PAYLINES) {
      expect(rows).toHaveLength(REELS);
      for (const row of rows) expect(row).toBeGreaterThanOrEqual(0);
      for (const row of rows) expect(row).toBeLessThan(ROWS);
    }
  });

  it('has no duplicate lines', () => {
    const seen = new Set(PAYLINES.map((rows) => rows.join('')));
    expect(seen.size).toBe(LINES);
  });

  it('never jumps more than one row between reels', () => {
    // Not a maths rule -- a legibility one. A line that leaps the window reads
    // as a bug even while it is paying.
    for (const rows of PAYLINES) {
      for (let reel = 1; reel < REELS; reel++) {
        expect(Math.abs(rows[reel] - rows[reel - 1])).toBeLessThanOrEqual(1);
      }
    }
  });
});

/* ------------------------------------------------------------------ *
 * Line evaluation
 * ------------------------------------------------------------------ */

describe('line evaluation', () => {
  it('pays a three of a kind at the paytable price', () => {
    const grid = runOnLine(blank(), 0, 'TIGER', 3);
    const { lineWins, total } = evaluateGrid(grid, [], STAKE);
    const win = lineWins.find((w) => w.symbol === 'TIGER');
    expect(win).toBeDefined();
    expect(win?.count).toBe(3);
    expect(win?.multiplier).toBe(PAYS.TIGER[0]);
    expect(win?.amount).toBe(PAYS.TIGER[0] * STAKE.betPerLine);
    expect(total).toBeGreaterThan(0);
  });

  it('pays four and five at their own prices, not multiples of three', () => {
    for (const [count, index] of [
      [4, 1],
      [5, 2],
    ] as const) {
      const grid = runOnLine(blank(), 0, 'KOI', count);
      const win = evaluateGrid(grid, [], STAKE).lineWins.find((w) => w.symbol === 'KOI');
      expect(win?.count).toBe(count);
      expect(win?.multiplier).toBe(PAYS.KOI[index]);
    }
  });

  it('pays nothing for two of a kind', () => {
    const grid = runOnLine(blank(), 0, 'DRAGON', 2);
    const wins = evaluateGrid(grid, [], STAKE).lineWins.filter((w) => w.symbol === 'DRAGON');
    expect(wins).toHaveLength(0);
  });

  it('requires the run to start on reel 1', () => {
    // Reels 2, 3 and 4 all holding dragons is not a win, however it looks.
    const grid = blank();
    const cells = LINE_CELLS[0];
    for (const reel of [1, 2, 3]) grid[cells[reel].reel][cells[reel].row] = 'DRAGON';
    const wins = evaluateGrid(grid, [], STAKE).lineWins.filter((w) => w.symbol === 'DRAGON');
    expect(wins).toHaveLength(0);
  });

  it('counts only the leftmost unbroken run', () => {
    // Three tigers, a gap, then two more tigers pays three, not five.
    const grid = blank();
    const cells = LINE_CELLS[0];
    for (const reel of [0, 1, 2]) grid[cells[reel].reel][cells[reel].row] = 'TIGER';
    grid[cells[3].reel][cells[3].row] = 'FAN';
    grid[cells[4].reel][cells[4].row] = 'TIGER';
    const win = evaluateGrid(grid, [], STAKE).lineWins.find(
      (w) => w.line === 0 && w.symbol === 'TIGER',
    );
    expect(win?.count).toBe(3);
  });
});

/* ------------------------------------------------------------------ *
 * Wilds
 * ------------------------------------------------------------------ */

describe('wild substitution', () => {
  it('lets a wild stand in for a regular symbol', () => {
    const grid = runOnLine(blank(), 0, 'PHOENIX', 3);
    const cells = LINE_CELLS[0];
    grid[cells[1].reel][cells[1].row] = 'WILD';
    const win = evaluateGrid(grid, [], STAKE).lineWins.find((w) => w.symbol === 'PHOENIX');
    expect(win?.count).toBe(3);
    expect(win?.wildAssisted).toBe(true);
  });

  it('does not mark an all-wild line as wild assisted', () => {
    // Nothing stood in for anything -- the line is genuinely five wilds.
    const grid = runOnLine(blank(), 0, 'WILD', 5);
    const win = evaluateGrid(grid, [], STAKE).lineWins.find((w) => w.line === 0);
    expect(win?.symbol).toBe('WILD');
    expect(win?.wildAssisted).toBe(false);
  });

  it('never substitutes for the pearl or the orb', () => {
    // Two pearls plus three wilds is two pearls: a wild that completed a
    // scatter trigger would let Dragon Rage light the shrine for free.
    const grid = blank();
    grid[0][0] = 'SCATTER';
    grid[1][0] = 'SCATTER';
    for (const reel of [2, 3, 4]) grid[reel][0] = 'WILD';
    expect(evaluateGrid(grid, [], STAKE).scatter).toBeNull();

    const orbs = blank();
    for (const reel of [0, 1, 2, 3, 4]) orbs[reel][0] = 'WILD';
    orbs[0][1] = 'ORB';
    // Still not six orbs, so nothing about the wilds can have helped.
    expect(evaluateGrid(orbs, [], STAKE).scatter).toBeNull();
  });

  it('accepts feature wilds passed as cells, not just printed ones', () => {
    // Dragon Rage reports its cells; the evaluator has to honour them even
    // though the band never printed a WILD there.
    const grid = runOnLine(blank(), 0, 'TURTLE', 2);
    const third = LINE_CELLS[0][2];
    const wilds: Cell[] = [{ reel: third.reel, row: third.row }];
    const before = evaluateGrid(grid, [], STAKE).lineWins.filter((w) => w.symbol === 'TURTLE');
    const after = evaluateGrid(grid, wilds, STAKE).lineWins.find((w) => w.symbol === 'TURTLE');
    expect(before).toHaveLength(0);
    expect(after?.count).toBe(3);
  });

  it('takes the best reading when the leading cells are wild', () => {
    /*
     * The highest-win-per-line rule, which only bites here. Three wilds then
     * two coins can be read as three wilds (100 a line) or five coins (60 a
     * line), and the line is worth the better of the two -- once, not both.
     */
    const grid = blank();
    const cells = LINE_CELLS[0];
    for (const reel of [0, 1, 2]) grid[cells[reel].reel][cells[reel].row] = 'WILD';
    for (const reel of [3, 4]) grid[cells[reel].reel][cells[reel].row] = 'COIN';

    const onLine = evaluateGrid(grid, [], STAKE).lineWins.filter((w) => w.line === 0);
    expect(onLine).toHaveLength(1);
    expect(onLine[0].multiplier).toBe(Math.max(PAYS.WILD[0], PAYS.COIN[2]));
  });

  it('reads three wilds and two dragons as five dragons', () => {
    // The other side of the same rule: here the long read wins.
    const grid = blank();
    const cells = LINE_CELLS[0];
    for (const reel of [0, 1, 2]) grid[cells[reel].reel][cells[reel].row] = 'WILD';
    for (const reel of [3, 4]) grid[cells[reel].reel][cells[reel].row] = 'DRAGON';

    const win = evaluateGrid(grid, [], STAKE).lineWins.find((w) => w.line === 0);
    expect(PAYS.DRAGON[2]).toBeGreaterThan(PAYS.WILD[0]);
    expect(win?.symbol).toBe('DRAGON');
    expect(win?.count).toBe(5);
  });
});

/* ------------------------------------------------------------------ *
 * Scatters
 * ------------------------------------------------------------------ */

describe('the pearl', () => {
  it('pays from anywhere, against the whole stake', () => {
    const grid = scatterAcross(blank(), 'SCATTER', 3);
    const { scatter } = evaluateGrid(grid, [], STAKE);
    expect(scatter?.count).toBe(3);
    expect(scatter?.multiplier).toBe(SCATTER_PAYS[3]);
    expect(scatter?.amount).toBe(SCATTER_PAYS[3] * STAKE.totalBet);
  });

  it('pays nothing below the trigger', () => {
    for (const n of [0, 1, 2]) {
      expect(evaluateGrid(scatterAcross(blank(), 'SCATTER', n), [], STAKE).scatter).toBeNull();
    }
  });

  it('pays more for four and five', () => {
    const at = (n: number) =>
      evaluateGrid(scatterAcross(blank(), 'SCATTER', n), [], STAKE).scatter?.amount ?? 0;
    expect(at(4)).toBeGreaterThan(at(3));
    expect(at(5)).toBeGreaterThan(at(4));
  });

  it('reports every pearl cell it counted', () => {
    const { scatter } = evaluateGrid(scatterAcross(blank(), 'SCATTER', 4), [], STAKE);
    expect(scatter?.cells).toHaveLength(4);
  });
});

/* ------------------------------------------------------------------ *
 * Money
 * ------------------------------------------------------------------ */

describe('money', () => {
  it('produces whole cents on every board the strips can make', () => {
    // Not a hand-built board: five thousand real spins, every amount checked.
    const rng = createRng('cents');
    for (let i = 0; i < 5000; i++) {
      const result = spin({ rng, stake: STAKE, mode: 'BASE' });
      expect(Number.isInteger(result.totalWin)).toBe(true);
      expect(Number.isInteger(result.baseWin)).toBe(true);
      for (const win of result.lineWins) expect(Number.isInteger(win.amount)).toBe(true);
      if (result.scatter) expect(Number.isInteger(result.scatter.amount)).toBe(true);
      for (const orb of result.orbs) expect(Number.isInteger(orb.amount)).toBe(true);
    }
  });

  it('makes the total the sum of its parts, times the trail', () => {
    const rng = createRng('sum');
    for (let i = 0; i < 2000; i++) {
      const result = spin({ rng, stake: STAKE, mode: 'BASE' });
      const parts =
        result.lineWins.reduce((s, w) => s + w.amount, 0) + (result.scatter?.amount ?? 0);
      expect(result.baseWin).toBe(parts);
      expect(result.totalWin).toBe(result.baseWin * result.multiplier);
    }
  });

  it('never pays a negative amount', () => {
    const rng = createRng('sign');
    for (let i = 0; i < 2000; i++) {
      expect(spin({ rng, stake: STAKE, mode: 'BASE' }).totalWin).toBeGreaterThanOrEqual(0);
    }
  });
});

/* ------------------------------------------------------------------ *
 * The strips
 * ------------------------------------------------------------------ */

describe('reel strips', () => {
  it('builds a band of exactly the declared length', () => {
    const band = buildStrip({ COIN: 5, LOTUS: 3, DRAGON: 2 });
    expect(band).toHaveLength(10);
    expect(band.filter((s) => s === 'COIN')).toHaveLength(5);
    expect(band.filter((s) => s === 'LOTUS')).toHaveLength(3);
    expect(band.filter((s) => s === 'DRAGON')).toHaveLength(2);
  });

  it('avoids adjacent duplicates when the counts allow it', () => {
    // Four symbols at 25% each has room to alternate; a band that prints
    // COIN COIN COIN reads as a broken reel whatever it does to the return.
    const band = buildStrip({ COIN: 10, LOTUS: 10, FAN: 10, LANTERN: 10 });
    for (let i = 0; i < band.length; i++) {
      expect(band[i]).not.toBe(band[(i + 1) % band.length]);
    }
  });

  it('is deterministic: the same counts always print the same band', () => {
    const counts = { COIN: 7, KOI: 5, DRAGON: 3, WILD: 2 };
    expect(buildStrip(counts)).toEqual(buildStrip(counts));
  });

  it('refuses an empty band rather than producing one', () => {
    expect(() => buildStrip({})).toThrow();
  });

  it('keeps orbs off the free spins band', () => {
    // The link cannot trigger inside the shrine. If an orb ever appears here
    // the feature can nest inside itself, which nothing downstream expects.
    for (const band of STRIPS.FREE) expect(band).not.toContain('ORB');
  });

  it('keeps wilds off reel 1 of the base band', () => {
    // A wild on the leftmost reel turns every three of a kind into a four.
    // That is a large, invisible chunk of return and it is deliberately absent.
    expect(STRIPS.BASE[0]).not.toContain('WILD');
  });
});

/* ------------------------------------------------------------------ *
 * Triggers
 * ------------------------------------------------------------------ */

describe('triggers', () => {
  it('lights the shrine on three pearls and not on two', () => {
    const rng = createRng('trigger');
    const two = spin({ rng, stake: STAKE, mode: 'BASE', force: { scatters: 2 } });
    expect(two.trigger?.feature).not.toBe('FREE_SPINS');

    const three = spin({ rng, stake: STAKE, mode: 'BASE', force: { scatters: 3 } });
    expect(three.trigger?.feature).toBe('FREE_SPINS');
    expect(three.trigger?.count).toBeGreaterThanOrEqual(SCATTER_TRIGGER);
  });

  it('lights the link on six orbs', () => {
    const rng = createRng('orbs');
    const result = spin({ rng, stake: STAKE, mode: 'BASE', force: { orbs: HOLD_TRIGGER_ORBS } });
    expect(result.trigger?.feature).toBe('HOLD_AND_WIN');
    expect(result.orbs.length).toBeGreaterThanOrEqual(HOLD_TRIGGER_ORBS);
  });

  it('gives the link priority over the shrine when a board lights both', () => {
    // Rare, but real. The link is worth more, and a player who watches six
    // orbs land and is handed free spins has had something taken away.
    const rng = createRng('both');
    const result = spin({
      rng,
      stake: STAKE,
      mode: 'BASE',
      force: { scatters: 3, orbs: HOLD_TRIGGER_ORBS },
    });
    expect(result.trigger?.feature).toBe('HOLD_AND_WIN');
  });

  it('awards more spins for more pearls', () => {
    const rng = createRng('award');
    const spinsFor = (scatters: number) => {
      for (let i = 0; i < 40; i++) {
        const r = spin({ rng, stake: STAKE, mode: 'BASE', force: { scatters } });
        if (r.trigger?.feature === 'FREE_SPINS' && r.trigger.count === scatters) {
          return r.trigger.spins ?? 0;
        }
      }
      return 0;
    };
    expect(spinsFor(4)).toBeGreaterThan(spinsFor(3));
  });

  it('only ever retriggers inside free spins', () => {
    const rng = createRng('retrigger');
    const result = spin({
      rng,
      stake: STAKE,
      mode: 'FREE',
      free: startFreeSpins({ feature: 'FREE_SPINS', cells: [], count: 3, spins: 10 }, STAKE, false),
      force: { scatters: 3 },
    });
    expect(result.trigger?.feature).toBe('FREE_SPINS');
    expect(result.trigger?.spins).toBe(RETRIGGER_SPINS);
  });

  it('cannot light the link from inside free spins', () => {
    // There are no orbs on the FREE band at all, so this is really a check
    // that nothing else can put one there.
    const rng = createRng('nolink');
    const free = startFreeSpins(
      { feature: 'FREE_SPINS', cells: [], count: 3, spins: 10 },
      STAKE,
      false,
    );
    for (let i = 0; i < 3000; i++) {
      const result = spin({ rng, stake: STAKE, mode: 'FREE', free });
      expect(result.trigger?.feature).not.toBe('HOLD_AND_WIN');
    }
  });
});

/* ------------------------------------------------------------------ *
 * Anticipation
 * ------------------------------------------------------------------ */

describe('anticipation', () => {
  it('never teases reel 1', () => {
    // Nothing has landed yet, so there is nothing to be tense about.
    const rng = createRng('tease');
    for (let i = 0; i < 3000; i++) {
      expect(spin({ rng, stake: STAKE, mode: 'BASE' }).anticipation).not.toContain(0);
    }
  });

  it('teases once two pearls are showing and the trigger is still reachable', () => {
    const rng = createRng('pearl-tease');
    let seen = false;
    for (let i = 0; i < 20000 && !seen; i++) {
      const result = spin({ rng, stake: STAKE, mode: 'BASE' });
      // Count pearls on reels 1 and 2 only; if there are two, reel 3 must tease.
      let early = 0;
      for (let row = 0; row < ROWS; row++) {
        if (result.rawGrid[0][row] === 'SCATTER') early++;
        if (result.rawGrid[1][row] === 'SCATTER') early++;
      }
      if (early >= 2) {
        expect(result.anticipation).toContain(2);
        seen = true;
      }
    }
    expect(seen).toBe(true);
  });

  it('reports teasing reels in ascending order and never out of range', () => {
    const rng = createRng('order');
    for (let i = 0; i < 5000; i++) {
      const { anticipation } = spin({ rng, stake: STAKE, mode: 'BASE' });
      for (let i2 = 1; i2 < anticipation.length; i2++) {
        expect(anticipation[i2]).toBeGreaterThan(anticipation[i2 - 1]);
      }
      for (const reel of anticipation) expect(reel).toBeLessThan(REELS);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Free spins
 * ------------------------------------------------------------------ */

describe('free spins', () => {
  const trigger = { feature: 'FREE_SPINS', cells: [], count: 3, spins: 10 } as const;

  it('opens on the awarded count and freezes the stake', () => {
    const state = startFreeSpins(trigger, STAKE, false);
    expect(state.awarded).toBe(10);
    expect(state.played).toBe(0);
    expect(state.totalBet).toBe(STAKE.totalBet);
    expect(state.betPerLine).toBe(STAKE.betPerLine);
    expect(freeSpinsRemaining(state)).toBe(10);
  });

  it('starts on 1x', () => {
    expect(trailMultiplier(startFreeSpins(trigger, STAKE, false))).toBe(1);
    expect(MULTIPLIER_TRAIL[0]).toBe(1);
  });

  it('walks the trail and saturates at the top rung', () => {
    let state = startFreeSpins(trigger, STAKE, false);
    for (let i = 0; i < 20; i++) {
      state = applyFreeSpin(state, {
        ...emptyResult(),
        trailAdvances: 1,
      });
    }
    expect(trailMultiplier(state)).toBe(MULTIPLIER_TRAIL[MULTIPLIER_TRAIL.length - 1]);
    expect(state.trailIndex).toBe(MULTIPLIER_TRAIL.length - 1);
  });

  it('never walks the trail backwards', () => {
    let state = startFreeSpins(trigger, STAKE, false);
    let last = trailMultiplier(state);
    for (let i = 0; i < 30; i++) {
      state = applyFreeSpin(state, { ...emptyResult(), trailAdvances: i % 3 === 0 ? 1 : 0 });
      const now = trailMultiplier(state);
      expect(now).toBeGreaterThanOrEqual(last);
      last = now;
    }
  });

  it('counts a played spin and banks what it won', () => {
    const state = applyFreeSpin(startFreeSpins(trigger, STAKE, false), {
      ...emptyResult(),
      totalWin: 250,
    });
    expect(state.played).toBe(1);
    expect(state.won).toBe(250);
    expect(freeSpinsRemaining(state)).toBe(9);
  });

  it('adds retrigger spins to the award, so remaining stays honest', () => {
    const state = applyFreeSpin(startFreeSpins(trigger, STAKE, false), {
      ...emptyResult(),
      trigger: { feature: 'FREE_SPINS', cells: [], count: 3, spins: RETRIGGER_SPINS },
    });
    expect(state.awarded).toBe(10 + RETRIGGER_SPINS);
    expect(state.retriggers).toBe(1);
    expect(freeSpinsRemaining(state)).toBe(10 + RETRIGGER_SPINS - 1);
  });

  it('applies the trail to what a spin pays', () => {
    const base = startFreeSpins(trigger, STAKE, false);
    const high = { ...base, trailIndex: MULTIPLIER_TRAIL.length - 1 };
    // Same seed, same board, different rung: the total must scale exactly.
    const a = spin({ rng: createRng('same'), stake: STAKE, mode: 'FREE', free: base });
    const b = spin({ rng: createRng('same'), stake: STAKE, mode: 'FREE', free: high });
    expect(b.multiplier).toBe(MULTIPLIER_TRAIL[MULTIPLIER_TRAIL.length - 1]);
    expect(b.baseWin).toBe(a.baseWin);
    expect(b.totalWin).toBe(a.baseWin * b.multiplier);
  });

  it('never lets the dragon take reel 1', () => {
    const rng = createRng('dragon-reels');
    const free = startFreeSpins(trigger, STAKE, false);
    let sawOne = false;
    for (let i = 0; i < 6000; i++) {
      const { dragonReels } = spin({ rng, stake: STAKE, mode: 'FREE', free });
      if (dragonReels.length > 0) sawOne = true;
      expect(dragonReels).not.toContain(0);
      expect(dragonReels).not.toContain(4);
    }
    expect(sawOne).toBe(true);
  });
});

/** A SpinResult with nothing in it, for exercising the session arithmetic. */
function emptyResult() {
  return {
    grid: blank(),
    rawGrid: blank(),
    stops: [0, 0, 0, 0, 0],
    strips: 'FREE' as const,
    lineWins: [],
    scatter: null,
    wildCells: [],
    dragonReels: [],
    rage: false,
    orbs: [],
    trigger: null,
    multiplier: 1,
    baseWin: 0,
    totalWin: 0,
    anticipation: [],
    trailAdvances: 0,
  };
}

/* ------------------------------------------------------------------ *
 * Hold and win
 * ------------------------------------------------------------------ */

describe('hold and win', () => {
  const orbAt = (reel: number, row: number, multiplier: number): Orb => ({
    reel,
    row,
    award: { kind: 'CREDIT', multiplier },
    amount: multiplier * STAKE.totalBet,
  });

  const seed = () => [
    orbAt(0, 0, 1),
    orbAt(0, 1, 2),
    orbAt(1, 0, 1),
    orbAt(1, 1, 5),
    orbAt(2, 0, 1),
    orbAt(2, 1, 3),
  ];

  it('opens with the triggering orbs and a full set of respins', () => {
    const state = startHold(createRng('open'), seed(), STAKE.totalBet, false);
    expect(state.orbs).toHaveLength(6);
    expect(state.respinsLeft).toBe(3);
    expect(state.collected).toBe(13 * STAKE.totalBet);
  });

  it('copies the orbs it was given rather than aliasing them', () => {
    // The store keeps the previous board to animate away from; sharing the
    // array would let a respin mutate the thing being animated.
    const orbs = seed();
    const state = startHold(createRng('copy'), orbs, STAKE.totalBet, false);
    orbs[0].amount = 999;
    expect(state.orbs[0].amount).not.toBe(999);
  });

  it('spends a respin when nothing lands', () => {
    let state = startHold(createRng('empty'), seed(), STAKE.totalBet, false);
    const before = state.respinsLeft;
    // Find a seed whose first respin lands nothing, then check the counter.
    for (let attempt = 0; attempt < 200; attempt++) {
      const trial = holdRespin(createRng(`miss-${attempt}`), state);
      if (trial.result.landed.length === 0) {
        expect(trial.state.respinsLeft).toBe(before - 1);
        expect(trial.state.respinsPlayed).toBe(1);
        state = trial.state;
        return;
      }
    }
    throw new Error('no empty respin found in 200 attempts');
  });

  it('resets the respins to three whenever an orb lands', () => {
    const state = startHold(createRng('reset'), seed(), STAKE.totalBet, false);
    for (let attempt = 0; attempt < 200; attempt++) {
      const trial = holdRespin(createRng(`hit-${attempt}`), state);
      if (trial.result.landed.length > 0) {
        expect(trial.state.respinsLeft).toBe(3);
        return;
      }
    }
    throw new Error('no landing respin found in 200 attempts');
  });

  it('holds every orb it has ever landed', () => {
    let state = startHold(createRng('hold'), seed(), STAKE.totalBet, false);
    const rng = createRng('hold-run');
    let count = state.orbs.length;
    for (let i = 0; i < 40 && state.respinsLeft > 0; i++) {
      const next = holdRespin(rng, state);
      expect(next.state.orbs.length).toBeGreaterThanOrEqual(count);
      // Every orb that was there is still there, at the same cell.
      for (const orb of state.orbs) {
        expect(
          next.state.orbs.some((o) => o.reel === orb.reel && o.row === orb.row),
        ).toBe(true);
      }
      count = next.state.orbs.length;
      state = next.state;
    }
  });

  it('never puts two orbs in one cell', () => {
    let state = startHold(createRng('cells'), seed(), STAKE.totalBet, false);
    const rng = createRng('cells-run');
    for (let i = 0; i < 60 && state.respinsLeft > 0; i++) {
      state = holdRespin(rng, state).state;
      const keys = new Set(state.orbs.map((o) => `${o.reel}:${o.row}`));
      expect(keys.size).toBe(state.orbs.length);
    }
  });

  it('awards the MAJOR at eighteen cells and the GRAND at twenty, once each', () => {
    const full: Orb[] = [];
    for (let reel = 0; reel < REELS; reel++) {
      for (let row = 0; row < ROWS; row++) full.push(orbAt(reel, row, 1));
    }
    const state = startHold(createRng('grand'), full, STAKE.totalBet, false);
    expect(state.orbs).toHaveLength(CELLS);
    expect(state.awardedJackpots).toContain('MAJOR');
    expect(state.awardedJackpots).toContain('GRAND');
    expect(state.awardedJackpots.filter((j) => j === 'GRAND')).toHaveLength(1);

    const eighteen = startHold(createRng('major'), full.slice(0, MAJOR_AT_CELLS), STAKE.totalBet, false);
    expect(eighteen.awardedJackpots).toContain('MAJOR');
    expect(eighteen.awardedJackpots).not.toContain('GRAND');
  });

  it('settles at the orbs plus the board jackpots', () => {
    const full: Orb[] = [];
    for (let reel = 0; reel < REELS; reel++) {
      for (let row = 0; row < ROWS; row++) full.push(orbAt(reel, row, 1));
    }
    const state = startHold(createRng('settle'), full, STAKE.totalBet, false);
    const { total, jackpots } = finishHold(state);
    const orbValue = CELLS * STAKE.totalBet;
    const boardValue = (JACKPOTS.MAJOR + JACKPOTS.GRAND) * STAKE.totalBet;
    expect(jackpots).toEqual(expect.arrayContaining(['MAJOR', 'GRAND']));
    expect(total).toBe(orbValue + boardValue);
    expect(Number.isInteger(total)).toBe(true);
  });

  it('only ever draws orb credit values from the published table', () => {
    let state = startHold(createRng('values'), seed(), STAKE.totalBet, false);
    const rng = createRng('values-run');
    for (let i = 0; i < 200 && state.respinsLeft > 0; i++) {
      state = holdRespin(rng, state).state;
    }
    for (const orb of state.orbs) {
      if (orb.award.kind === 'CREDIT') {
        expect(ORB_VALUES as readonly number[]).toContain(orb.award.multiplier);
      } else {
        // MAJOR and GRAND are board awards; an orb must never carry one.
        expect(['MINI', 'MINOR']).toContain(orb.award.jackpot);
      }
    }
  });

  it('ends when the respins run out', () => {
    let state = startHold(createRng('end'), seed(), STAKE.totalBet, false);
    const rng = createRng('end-run');
    let guard = 0;
    while (state.respinsLeft > 0 && state.orbs.length < CELLS && guard++ < 5000) {
      state = holdRespin(rng, state).state;
    }
    expect(guard).toBeLessThan(5000);
    expect(state.respinsLeft === 0 || state.orbs.length === CELLS).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * Gamble
 * ------------------------------------------------------------------ */

describe('gamble', () => {
  it('offers a win up to the cap and refuses one above it', () => {
    expect(canGamble(STAKE.totalBet, STAKE.totalBet)).toBe(true);
    expect(canGamble(GAMBLE_MAX_RATIO * STAKE.totalBet, STAKE.totalBet)).toBe(true);
    expect(canGamble(GAMBLE_MAX_RATIO * STAKE.totalBet + 1, STAKE.totalBet)).toBe(false);
  });

  it('refuses a zero win, so no caller needs its own emptiness check', () => {
    expect(canGamble(0, STAKE.totalBet)).toBe(false);
  });

  it('doubles on a win and zeroes on a loss', () => {
    const rng = createRng('flip');
    for (let i = 0; i < 200; i++) {
      const result = gamble(rng, 'RED', 400, 0);
      expect(result.balance).toBe(result.won ? 800 : 0);
      expect(result.stake).toBe(400);
      expect(Number.isInteger(result.balance)).toBe(true);
    }
  });

  it('is exactly fair', () => {
    /*
     * The one honest bet on the machine, so it is worth measuring rather than
     * asserting. 100k flips; four standard errors of a fair coin at that count
     * is about 0.63%, so a tolerance of 1% catches a rigged flip while never
     * failing on variance.
     */
    const rng = createRng('fair');
    let won = 0;
    const n = 100_000;
    for (let i = 0; i < n; i++) if (gamble(rng, 'RED', 100, 0).won) won++;
    expect(Math.abs(won / n - 0.5)).toBeLessThan(0.01);
  });

  it('advances the step on a win and holds it on a loss', () => {
    const rng = createRng('steps');
    for (let i = 0; i < 100; i++) {
      const result = gamble(rng, 'BLACK', 100, 2);
      expect(result.step).toBe(result.won ? 3 : 2);
    }
  });

  it('throws rather than silently losing past the cap', () => {
    // A silent loss at the cap is indistinguishable from a real one, which is
    // exactly the bug a player would never be able to prove.
    expect(() => gamble(createRng('cap'), 'RED', 100, GAMBLE_MAX_STEPS)).toThrow(RangeError);
    expect(() => gamble(createRng('cap'), 'RED', 100, -1)).toThrow(RangeError);
  });
});

/* ------------------------------------------------------------------ *
 * Buying in
 * ------------------------------------------------------------------ */

describe('feature buys', () => {
  it('prices every option against the stake, in whole cents', () => {
    for (const option of ['FREE_SPINS', 'HOLD_AND_WIN', 'SUPER'] as const) {
      const cost = buyCost(option, STAKE.totalBet);
      expect(cost).toBe(BUY_COSTS[option] * STAKE.totalBet);
      expect(Number.isInteger(cost)).toBe(true);
    }
  });

  it('scales with the stake', () => {
    expect(buyCost('FREE_SPINS', 200)).toBe(2 * buyCost('FREE_SPINS', 100));
  });

  it('hands back a copy, so a caller cannot mutate the grant table', () => {
    const force = buyForce('FREE_SPINS');
    force.scatters = 99;
    expect(buyForce('FREE_SPINS').scatters).not.toBe(99);
  });

  it('actually lights the feature it sold', () => {
    const rng = createRng('buy');
    for (const [option, feature] of [
      ['FREE_SPINS', 'FREE_SPINS'],
      ['HOLD_AND_WIN', 'HOLD_AND_WIN'],
      ['SUPER', 'FREE_SPINS'],
    ] as const) {
      const result = spin({ rng, stake: STAKE, mode: 'BASE', force: buyForce(option) });
      expect(result.trigger?.feature).toBe(feature);
    }
  });

  it('gives the SUPER buy more spins than the plain one', () => {
    const rng = createRng('super');
    const plain = spin({ rng, stake: STAKE, mode: 'BASE', force: buyForce('FREE_SPINS') });
    const supr = spin({ rng, stake: STAKE, mode: 'BASE', force: buyForce('SUPER') });
    expect(supr.trigger?.spins ?? 0).toBeGreaterThan(plain.trigger?.spins ?? 0);
  });

  it('never places two forced pearls in one cell', () => {
    const rng = createRng('no-stack');
    for (let i = 0; i < 500; i++) {
      const result = spin({ rng, stake: STAKE, mode: 'BASE', force: { scatters: 5 } });
      const cells = new Set<string>();
      for (let reel = 0; reel < REELS; reel++) {
        for (let row = 0; row < ROWS; row++) {
          if (result.rawGrid[reel][row] === 'SCATTER') cells.add(`${reel}:${row}`);
        }
      }
      expect(cells.size).toBeGreaterThanOrEqual(5);
    }
  });
});

/* ------------------------------------------------------------------ *
 * Determinism
 * ------------------------------------------------------------------ */

describe('determinism', () => {
  it('reproduces a whole session from its seed', () => {
    const run = () => {
      const rng = createRng('replay');
      const out: number[] = [];
      for (let i = 0; i < 500; i++) {
        const result = spin({ rng, stake: STAKE, mode: 'BASE' });
        out.push(result.totalWin, ...result.stops);
      }
      return out;
    };
    expect(run()).toEqual(run());
  });

  it('gives different seeds different sessions', () => {
    const first = spin({ rng: createRng('a'), stake: STAKE, mode: 'BASE' }).stops;
    const second = spin({ rng: createRng('b'), stake: STAKE, mode: 'BASE' }).stops;
    expect(first).not.toEqual(second);
  });

  it('pins the draw order', () => {
    /*
     * `spin` documents the order it takes random words in, and every seeded
     * expectation in this repository and in the store's suite rests on it.
     *
     * The assertion is deliberately about *word count* rather than about a
     * board: a board changes whenever the strips are retuned, which is a
     * routine and expected thing, but the number of words a plain losing spin
     * consumes changes only when a draw is inserted or removed. That is the
     * event worth catching, and it is the one that silently invalidates every
     * other seeded test at once.
     *
     * A spin with no feature takes five stops plus one Dragon Rage roll. The
     * stops use rejection sampling, so a stop can occasionally cost more than
     * one word -- hence a floor and a ceiling rather than an equality.
     */
    const rng = createRng('draws');
    const before = rng.draws;
    const result = spin({ rng, stake: STAKE, mode: 'BASE' });
    const used = rng.draws - before;

    expect(result.rage).toBe(false);
    expect(result.trigger).toBeNull();
    expect(used).toBeGreaterThanOrEqual(REELS + 1);
    expect(used).toBeLessThan(REELS + 1 + 4);
  });

  it('spends no randomness on orbs that did not trigger', () => {
    // A board showing five orbs is not a feature, and must not cost the words
    // that rolling five awards would -- or every seeded replay after the first
    // near miss would diverge.
    const rng = createRng('no-orb-draws');
    for (let i = 0; i < 4000; i++) {
      const before = rng.draws;
      const result = spin({ rng, stake: STAKE, mode: 'BASE' });
      const used = rng.draws - before;
      if (result.trigger === null && !result.rage) {
        expect(used).toBeLessThan(REELS + 1 + 4);
      }
    }
  });
});
