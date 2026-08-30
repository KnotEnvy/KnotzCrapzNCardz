import { it } from 'vitest';
import { createRng } from './rng';
import { finishHold, holdRespin, startHold, drawOrb } from './holdwin';
import { CELLS, REELS, ROWS, type Cell, type JackpotId } from './types';
import { JACKPOTS, HOLD_TRIGGER_ORBS } from './paytable';
import { STRIPS } from './strips';
import { shuffle, chance } from './rng';
import { HOLD_RESPINS, MAJOR_AT_CELLS } from './paytable';
import type { HoldState } from './types';

/** A local copy of holdRespin with the landing chance as a parameter, so the
 *  sweep can price several without editing the paytable between runs. */
function respinAt(rng: ReturnType<typeof createRng>, state: HoldState, land: number): HoldState {
  const occ: boolean[][] = Array.from({ length: REELS }, () => new Array<boolean>(ROWS).fill(false));
  for (const o of state.orbs) occ[o.reel][o.row] = true;
  const landed = [];
  for (let r = 0; r < REELS; r++) for (let row = 0; row < ROWS; row++) {
    if (occ[r][row]) continue;
    if (!chance(rng, land)) continue;
    landed.push(drawOrb(rng, { reel: r, row }, state.totalBet));
  }
  const orbs = state.orbs.concat(landed);
  const already = state.awardedJackpots;
  const won: JackpotId[] = [];
  if (orbs.length >= MAJOR_AT_CELLS && !already.includes('MAJOR')) won.push('MAJOR');
  if (orbs.length >= CELLS && !already.includes('GRAND')) won.push('GRAND');
  let left = landed.length > 0 ? HOLD_RESPINS : state.respinsLeft - 1;
  if (orbs.length >= CELLS) left = 0;
  return { ...state, orbs, respinsLeft: left, respinsPlayed: state.respinsPlayed + 1,
    collected: state.collected + landed.reduce((a, o) => a + o.amount, 0),
    awardedJackpots: already.concat(won) };
}

for (const HOLD_LAND_CHANCE of [0.035, 0.042, 0.05, 0.058, 0.066]) it(`tunes hold ${HOLD_LAND_CHANCE}`, () => {
  const rng = createRng('tune-hold');
  const N = 200_000;
  const totalBet = 5000;
  let sum = 0, orbsEnd = 0, respins = 0, maxT = 0;
  const jp: Record<string, number> = { MINI: 0, MINOR: 0, MAJOR: 0, GRAND: 0 };
  const sizes: number[] = new Array(21).fill(0);
  for (let i = 0; i < N; i++) {
    const cells: Cell[] = [];
    for (let r = 0; r < REELS; r++) for (let row = 0; row < ROWS; row++) cells.push({ reel: r, row });
    shuffle(rng, cells);
    const seed = cells.slice(0, HOLD_TRIGGER_ORBS).map((c) => drawOrb(rng, c, totalBet));
    let st = startHold(rng, seed, totalBet, false);
    while (st.respinsLeft > 0) { st = respinAt(rng, st, HOLD_LAND_CHANCE); respins++; }
    const f = finishHold(st);
    sum += f.total; orbsEnd += st.orbs.length; sizes[st.orbs.length]++;
    for (const j of f.jackpots) jp[j]++;
    if (f.total > maxT) maxT = f.total;
  }
  console.log(`land=${HOLD_LAND_CHANCE} sessions=${N}`);
  console.log('  mean return', (sum / N / totalBet).toFixed(2), 'x totalBet');
  console.log('  mean orbs at end', (orbsEnd / N).toFixed(2), ' mean respins', (respins / N).toFixed(2));
  console.log('  max session', (maxT / totalBet).toFixed(0), 'x');
  for (const k of Object.keys(jp)) console.log('  ', k.padEnd(6), '1 in', (N / Math.max(1, jp[k])).toFixed(0), 'sessions');
  console.log('  fill dist', sizes.map((c, i) => c ? `${i}:${(c / N * 100).toFixed(2)}%` : null).filter(Boolean).join(' '));
});
