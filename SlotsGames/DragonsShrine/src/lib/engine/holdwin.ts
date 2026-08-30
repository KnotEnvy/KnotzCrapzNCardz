/**
 * Hold and Win -- the Shrine Link.
 *
 * Six orbs on one spin clear the board, lock those six where they fell, and
 * hand the player three respins. Every respin, each still-empty cell rolls
 * independently for an orb; any orb at all puts the counter back to three. The
 * feature ends when three respins pass without a single orb, or when the
 * twentieth cell fills.
 *
 * Two things make this the most-loved feature shape in the modern slot floor
 * and both are worth stating, because they are what the numbers below are
 * protecting.
 *
 * The first is that the reset makes the tension monotone. A player never has
 * to work out whether a thing that just happened was good; every orb is good,
 * and the only bad outcome is nothing happening. Compare a free spins run,
 * where a dead spin off the trail is genuinely ambiguous.
 *
 * The second is that the distribution is bimodal on purpose. Most sessions
 * land two or three extra orbs and pay a few dozen times the stake. A rare one
 * catches a cascade, and once a board is two thirds full the remaining empty
 * cells are few enough that filling them is a real possibility rather than a
 * fantasy -- which is why MAJOR sits at eighteen cells and GRAND at twenty
 * rather than both at the top. The MAJOR is the prize that makes the last
 * stretch worth watching; without it, an eighteen-orb board is just a
 * disappointing twenty-orb board.
 *
 * Money: an orb carries a multiple of `totalBet` and so does a jackpot, so
 * everything here is an integer number of cents by construction. The
 * `Math.round` at the one multiplication is the guard against a future
 * fractional orb value, not a live correction.
 */

import { chance, weighted, type Rng } from './rng';
import {
  HOLD_LAND_CHANCE,
  HOLD_RESPINS,
  JACKPOTS,
  MAJOR_AT_CELLS,
  ORB_JACKPOT_CHANCE,
  ORB_VALUES,
  ORB_WEIGHTS,
} from './paytable';
import {
  CELLS,
  REELS,
  ROWS,
  type Cell,
  type HoldSpinResult,
  type HoldState,
  type JackpotId,
  type Orb,
  type OrbAward,
} from './types';

/**
 * What one orb is worth.
 *
 * Draw order is fixed and matters: one uniform decides whether the orb carries
 * a jackpot at all, and only if it does not is a second draw spent on the
 * credit table. Rolling the credit first and overwriting it would consume a
 * different number of words on jackpot orbs and desynchronise every seeded
 * replay downstream.
 *
 * MAJOR and GRAND are absent from {@link ORB_JACKPOT_CHANCE} deliberately.
 * They are board awards -- won by filling eighteen or twenty cells -- so that
 * the top prize cannot arrive unannounced on the first respin of a six-orb
 * board. A jackpot that can land at any moment is a lottery ticket; a jackpot
 * you can watch yourself approach is a feature.
 */
export function drawOrbAward(rng: Rng): OrbAward {
  const roll = rng.next();
  let floor = 0;
  for (const jackpot of ['MINI', 'MINOR'] as const) {
    const p = ORB_JACKPOT_CHANCE[jackpot];
    if (p === undefined) continue;
    floor += p;
    if (roll < floor) return { kind: 'JACKPOT', jackpot, multiplier: JACKPOTS[jackpot] };
  }
  return { kind: 'CREDIT', multiplier: weighted(rng, ORB_VALUES, ORB_WEIGHTS) };
}

/** An orb at `cell`, with its award rolled and settled against the stake. */
export function drawOrb(rng: Rng, cell: Cell, totalBet: number): Orb {
  const award = drawOrbAward(rng);
  return { reel: cell.reel, row: cell.row, award, amount: Math.round(award.multiplier * totalBet) };
}

/** Cents sitting on the grid: the orbs, and only the orbs. */
function orbTotal(orbs: readonly Orb[]): number {
  let total = 0;
  for (const orb of orbs) total += orb.amount;
  return total;
}

/**
 * Which board awards a grid of this size has just lit.
 *
 * Called with the jackpots already banked so that a board that grows from
 * eighteen to nineteen cells does not award the MAJOR twice. Both thresholds
 * are checked on every landing rather than only on the landing that crossed
 * them, because a single respin can add several orbs and jump straight from
 * seventeen cells to twenty.
 */
function boardJackpots(filled: number, already: readonly JackpotId[]): JackpotId[] {
  const won: JackpotId[] = [];
  if (filled >= MAJOR_AT_CELLS && !already.includes('MAJOR')) won.push('MAJOR');
  if (filled >= CELLS && !already.includes('GRAND')) won.push('GRAND');
  return won;
}

/**
 * Open the link on the orbs that triggered it.
 *
 * `rng` is taken but not used. It stays in the signature because the two
 * halves of the feature read as a pair at the call site, and because the one
 * plausible future variant -- a link that rolls a starting jackpot level, the
 * way the four-level cabinets do -- would need a generator here and should not
 * get to change a published signature to have one.
 */
export function startHold(rng: Rng, seedOrbs: Orb[], totalBet: number, bought: boolean): HoldState {
  void rng;
  const orbs = seedOrbs.map((orb) => ({ ...orb }));
  return {
    orbs,
    respinsLeft: HOLD_RESPINS,
    respinsPlayed: 0,
    collected: orbTotal(orbs),
    awardedJackpots: boardJackpots(orbs.length, []),
    totalBet,
    bought,
  };
}

/**
 * One respin.
 *
 * Draw order is every empty cell in reel-major order, and for each one a
 * landing roll immediately followed -- only on a hit -- by that orb's award.
 * Interleaving the two rather than rolling all the landings and then all the
 * awards costs nothing and means the sequence a seed produces can be read
 * straight off the board, orb by orb, when a replay is being argued about.
 *
 * Returns a fresh state; nothing here mutates what it was given, because the
 * store keeps the previous state to animate away from.
 */
export function holdRespin(
  rng: Rng,
  state: HoldState,
): { state: HoldState; result: HoldSpinResult } {
  const occupied: boolean[][] = new Array(REELS);
  for (let reel = 0; reel < REELS; reel++) occupied[reel] = new Array<boolean>(ROWS).fill(false);
  for (const orb of state.orbs) occupied[orb.reel][orb.row] = true;

  const landed: Orb[] = [];
  for (let reel = 0; reel < REELS; reel++) {
    for (let row = 0; row < ROWS; row++) {
      if (occupied[reel][row]) continue;
      if (!chance(rng, HOLD_LAND_CHANCE)) continue;
      landed.push(drawOrb(rng, { reel, row }, state.totalBet));
    }
  }

  const orbs = state.orbs.concat(landed);
  const jackpots = boardJackpots(orbs.length, state.awardedJackpots);
  const collected = state.collected + orbTotal(landed);
  const full = orbs.length >= CELLS;

  // Any orb at all restores the full count. That single rule is the feature:
  // it is why a one-orb respin is celebrated as hard as a four-orb one, and
  // why the session length has no ceiling short of a full board.
  let respinsLeft = landed.length > 0 ? HOLD_RESPINS : state.respinsLeft - 1;
  if (full) respinsLeft = 0;

  let boardCents = 0;
  const awardedJackpots = state.awardedJackpots.concat(jackpots);
  for (const jackpot of awardedJackpots) boardCents += Math.round(JACKPOTS[jackpot] * state.totalBet);

  const next: HoldState = {
    orbs,
    respinsLeft,
    respinsPlayed: state.respinsPlayed + 1,
    collected,
    awardedJackpots,
    totalBet: state.totalBet,
    bought: state.bought,
  };

  return {
    state: next,
    result: {
      landed,
      orbs,
      full,
      respinsLeft,
      jackpots,
      collected,
      total: collected + boardCents,
    },
  };
}

/**
 * Settle the link.
 *
 * The total is every orb on the board plus every board jackpot. The jackpot
 * list is what the celebration announces, so it names the MINI and MINOR that
 * arrived *inside* orbs as well as the MAJOR and GRAND the board itself won --
 * from the player's side those are the same event, and a MINI that pays but is
 * never named reads as a bug.
 */
export function finishHold(state: HoldState): { total: number; jackpots: JackpotId[] } {
  const jackpots: JackpotId[] = [];
  for (const orb of state.orbs) {
    if (orb.award.kind === 'JACKPOT') jackpots.push(orb.award.jackpot);
  }
  let total = state.collected;
  for (const jackpot of state.awardedJackpots) {
    total += Math.round(JACKPOTS[jackpot] * state.totalBet);
    jackpots.push(jackpot);
  }
  return { total, jackpots };
}
