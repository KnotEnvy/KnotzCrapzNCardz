/**
 * One pull of the handle.
 *
 * `spin` is the whole machine in one function: it stops five reels, lets the
 * dragon do whatever the dragon is going to do, asks `evaluate` what the board
 * is worth, and reports what it triggered. It is pure apart from the generator
 * it is handed, which is the point -- a seed plus a spin count reproduces a
 * board exactly, and that is how the RTP simulation is able to be a
 * measurement rather than an estimate.
 *
 * DRAW ORDER. Every random word this function takes comes out in this order,
 * always, on every spin in every mode:
 *
 *   1. Five reel stops, reel 1 through reel 5.
 *   2. A feature buy's forced symbols, pearls before orbs, each placement
 *      choosing a cell that does not already hold that symbol.
 *   3. The dragon. In the base game that is one roll for Dragon Rage, then --
 *      only if it fired -- the number of cells and a shuffle to choose them.
 *      In free spins it is one roll for how many reels the dragon takes and a
 *      shuffle to choose which.
 *   4. Orb awards, reel-major, and only on a spin that actually lights the
 *      link. A board with five orbs on it spends no randomness on them at all.
 *
 * Inserting a draw anywhere in that list re-rolls the entire future of every
 * seeded test in the repository. That is a legitimate thing to do and never an
 * accidental one, so the order is written down here and asserted in
 * `engine.test.ts`.
 *
 * `rawGrid` is the board as it landed -- what the reels physically show, a
 * feature buy's forced pearls included, since those arrive on the reels like
 * anything else. `grid` is that board after the dragon has been through it,
 * which is what gets evaluated and what the win overlay highlights.
 */

import { chance, shuffle, weighted, type Rng } from './rng';
import { evaluateGrid, findSymbolCells } from './evaluate';
import { drawOrb } from './holdwin';
import {
  DRAGON_REEL_CANDIDATES,
  DRAGON_REEL_CHANCE,
  FREE_SPIN_AWARD,
  HOLD_TRIGGER_ORBS,
  MULTIPLIER_TRAIL,
  ORB_TEASE_AT,
  RAGE_CHANCE,
  RAGE_WEIGHTS,
  RAGE_WILDS,
  RETRIGGER_SPINS,
  SCATTER_TEASE_AT,
  SCATTER_TRIGGER,
} from './paytable';
import { STRIPS } from './strips';
import {
  REELS,
  ROWS,
  type Cell,
  type FeatureTrigger,
  type FreeSpinsState,
  type Grid,
  type Orb,
  type SpinResult,
  type Stake,
  type StripSet,
  type SymbolId,
} from './types';

export interface SpinContext {
  rng: Rng;
  stake: Stake;
  mode: 'BASE' | 'FREE';
  free?: FreeSpinsState | null;
  /** A feature buy forcing a trigger. */
  force?: { scatters?: number; orbs?: number };
}

/** The four symbols visible on one reel, wrapping round the end of the band. */
function readReel(band: SymbolId[], stop: number): SymbolId[] {
  const column = new Array<SymbolId>(ROWS);
  for (let row = 0; row < ROWS; row++) column[row] = band[(stop + row) % band.length];
  return column;
}

/**
 * Put `count` copies of `symbol` on the board, for a feature buy.
 *
 * Guarantees *at least* `count`, never exactly: if the strips already dropped
 * a pearl of their own it is left where it is and only the shortfall is
 * placed. Forcing an exact number would mean deleting a symbol the reels
 * genuinely landed, which is both harder to justify to a regulator and
 * measurably worse for the player, and the simulation prices the buy against
 * what this actually does rather than against what it was meant to do.
 *
 * Cells are drawn one at a time from the list of cells that do not already
 * hold the symbol, so a buy can never place two pearls on top of each other.
 */
function forceSymbol(rng: Rng, grid: Grid, symbol: SymbolId, count: number): void {
  const free: Cell[] = [];
  let have = 0;
  for (let reel = 0; reel < REELS; reel++) {
    for (let row = 0; row < ROWS; row++) {
      if (grid[reel][row] === symbol) have++;
      else free.push({ reel, row });
    }
  }
  shuffle(rng, free);
  for (let i = 0; have < count && i < free.length; i++, have++) {
    const cell = free[i];
    grid[cell.reel][cell.row] = symbol;
  }
}

/**
 * Dragon Rage: the base game's random wilds.
 *
 * The dragon only ever burns a *regular* symbol. Turning a pearl or an orb
 * wild would let a random event trigger -- or worse, un-trigger -- a feature,
 * and a player who watches six orbs land and then watches one of them become a
 * wild has been robbed by a rule they were never told about.
 */
function rageCells(rng: Rng, grid: Grid): Cell[] {
  const burnable: Cell[] = [];
  for (let reel = 0; reel < REELS; reel++) {
    for (let row = 0; row < ROWS; row++) {
      const symbol = grid[reel][row];
      if (symbol === 'SCATTER' || symbol === 'ORB' || symbol === 'WILD') continue;
      burnable.push({ reel, row });
    }
  }
  const wanted = weighted(rng, RAGE_WILDS, RAGE_WEIGHTS);
  shuffle(rng, burnable);
  return burnable.slice(0, Math.min(wanted, burnable.length));
}

/**
 * How many reels the dragon takes on a free spin, and which.
 *
 * One roll decides the count so that the three probabilities in
 * {@link DRAGON_REEL_CHANCE} are the real, mutually exclusive chances of one,
 * two and three reels rather than three independent coins that happen to be
 * named that way. Reel 1 is never a candidate: with it wild, a
 * three-dragon-reel spin would be fifty lines of five wilds and a single spin
 * would be worth more than the rest of the feature put together.
 */
function dragonReels(rng: Rng): number[] {
  const roll = rng.next();
  const { one, two, three } = DRAGON_REEL_CHANCE;
  let wanted = 0;
  if (roll < three) wanted = 3;
  else if (roll < three + two) wanted = 2;
  else if (roll < three + two + one) wanted = 1;
  if (wanted === 0) return [];

  const candidates = DRAGON_REEL_CANDIDATES.slice();
  shuffle(rng, candidates);
  return candidates.slice(0, wanted).sort((a, b) => a - b);
}

/**
 * Which reels should slow down and tease.
 *
 * The rule is the one every cabinet uses and it is stated in terms of what has
 * *already* landed, because that is all the reel in front of you knows: from
 * the moment two pearls are showing, every later reel that could still make
 * three teases, and likewise from four orbs onward for the link. The
 * reachability half of that matters on the last reel -- two pearls with one
 * reel to go can still make three, four orbs with one reel to go can still
 * make six because a reel can drop a block of three, but four orbs with no
 * reels left cannot.
 *
 * Teasing continues past the trigger on purpose. Once three pearls are down
 * the feature is already won and the fourth is worth five times the third, so
 * the fifth reel deserves the long stop just as much.
 *
 * Read off the landed board rather than the evaluated one: the dragon arrives
 * after every reel has stopped, so it cannot be part of what a stopping reel
 * knows.
 */
function anticipationReels(landed: Grid): number[] {
  const teasing: number[] = [];
  let scatters = 0;
  let orbs = 0;
  for (let reel = 0; reel < REELS; reel++) {
    if (reel > 0) {
      const remaining = REELS - reel;
      const pearlsReachable = scatters >= SCATTER_TEASE_AT && scatters + remaining >= SCATTER_TRIGGER;
      const orbsReachable = orbs >= ORB_TEASE_AT && orbs + remaining * ROWS >= HOLD_TRIGGER_ORBS;
      if (pearlsReachable || orbsReachable) teasing.push(reel);
    }
    for (let row = 0; row < ROWS; row++) {
      const symbol = landed[reel][row];
      if (symbol === 'SCATTER') scatters++;
      else if (symbol === 'ORB') orbs++;
    }
  }
  return teasing;
}

/**
 * What this board triggered, if anything.
 *
 * The link outranks the shrine on the vanishingly rare board that lights both.
 * It is worth more, and a player who watches six orbs land and is given free
 * spins instead has watched the machine take something away from them.
 * Inside free spins the base band's orbs are not on the reels at all, so the
 * only trigger available is the retrigger.
 */
function detectTrigger(
  mode: 'BASE' | 'FREE',
  scatterCells: Cell[],
  orbCells: Cell[],
): FeatureTrigger | null {
  if (mode === 'BASE' && orbCells.length >= HOLD_TRIGGER_ORBS) {
    return { feature: 'HOLD_AND_WIN', cells: orbCells, count: orbCells.length };
  }
  if (scatterCells.length >= SCATTER_TRIGGER) {
    const count = scatterCells.length;
    const spins =
      mode === 'FREE' ? RETRIGGER_SPINS : (FREE_SPIN_AWARD[Math.min(count, REELS)] ?? FREE_SPIN_AWARD[SCATTER_TRIGGER]);
    return { feature: 'FREE_SPINS', cells: scatterCells, count, spins };
  }
  return null;
}

export function spin(ctx: SpinContext): SpinResult {
  const { rng, stake, mode } = ctx;
  const strips: StripSet = mode === 'FREE' ? 'FREE' : 'BASE';
  const bands = STRIPS[strips];

  /* 1. Five stops. */
  const stops = new Array<number>(REELS);
  const rawGrid: Grid = new Array<SymbolId[]>(REELS);
  for (let reel = 0; reel < REELS; reel++) {
    const stop = rng.int(bands[reel].length);
    stops[reel] = stop;
    rawGrid[reel] = readReel(bands[reel], stop);
  }

  /* 2. A buy's forced symbols, onto the landed board. */
  if (ctx.force?.scatters) forceSymbol(rng, rawGrid, 'SCATTER', ctx.force.scatters);
  if (ctx.force?.orbs) forceSymbol(rng, rawGrid, 'ORB', ctx.force.orbs);

  /* 3. The dragon. */
  const grid: Grid = rawGrid.map((column) => column.slice());
  const wildCells: Cell[] = [];
  let dragonReelIndexes: number[] = [];
  let rage = false;

  if (mode === 'BASE') {
    rage = chance(rng, RAGE_CHANCE);
    if (rage) {
      for (const cell of rageCells(rng, grid)) {
        grid[cell.reel][cell.row] = 'WILD';
        wildCells.push(cell);
      }
      // A rage that found nothing to burn is not a rage.
      rage = wildCells.length > 0;
    }
  } else {
    dragonReelIndexes = dragonReels(rng);
    for (const reel of dragonReelIndexes) {
      for (let row = 0; row < ROWS; row++) {
        // The reel goes wild top to bottom, pearls included. A dragon that
        // politely stepped around a scatter would be a second, unstated rule,
        // and the trail advance the pearl would have paid is handed back by
        // the dragon reel that ate it.
        grid[reel][row] = 'WILD';
        wildCells.push({ reel, row });
      }
    }
  }

  /* Evaluation, then what it triggered. */
  const { lineWins, scatter, total } = evaluateGrid(grid, wildCells, stake);
  const scatterCells = findSymbolCells(grid, 'SCATTER');
  const orbCells = findSymbolCells(grid, 'ORB');
  const trigger = detectTrigger(mode, scatterCells, orbCells);

  /* The trail. A dragon reel and a pearl are each worth one step, and the
   * step applies to the spin that earned it rather than the next one -- the
   * dragon that just turned reel 3 wild should be paying for the wins it
   * created, not for the ones after them. */
  let multiplier = 1;
  let trailAdvances = 0;
  if (mode === 'FREE') {
    trailAdvances = dragonReelIndexes.length + scatterCells.length;
    const free = ctx.free;
    const index = Math.min(
      (free?.trailIndex ?? 0) + trailAdvances,
      MULTIPLIER_TRAIL.length - 1,
    );
    multiplier = MULTIPLIER_TRAIL[index];
  }

  /* 4. Orb awards, only when the link lights. */
  const orbs: Orb[] = [];
  if (trigger?.feature === 'HOLD_AND_WIN') {
    for (const cell of orbCells) orbs.push(drawOrb(rng, cell, stake.totalBet));
  }

  return {
    grid,
    rawGrid,
    stops,
    strips,
    lineWins,
    scatter,
    wildCells,
    dragonReels: dragonReelIndexes,
    rage,
    orbs,
    trigger,
    multiplier,
    baseWin: total,
    // Both factors are integers -- the trail is whole steps and every pay is
    // whole cents -- so this is the multiplication that would first go
    // fractional if the trail ever grew a 1.5x rung. Round it here rather
    // than discovering a half-cent in a bankroll later.
    totalWin: Math.round(total * multiplier),
    anticipation: anticipationReels(rawGrid),
    trailAdvances,
  };
}
