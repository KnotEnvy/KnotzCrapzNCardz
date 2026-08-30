/**
 * The gamble -- red or black on a lantern.
 *
 * This is the one honest bet in the building, and that is not a joke about
 * slots: it is the design. Everything else in this machine is priced to return
 * about ninety-six per cent. The gamble returns exactly one hundred. Call it
 * right and the win doubles, call it wrong and it is gone, and the coin is a
 * fair coin with no tilt, no near-miss, and no house rake hidden in a third
 * outcome the way a roulette green does it.
 *
 * That fairness is worth protecting explicitly, because it is invisible on the
 * glass and trivially easy to lose. A `0.499` in place of the `0.5` below
 * would be undetectable to a player over a lifetime of play and would quietly
 * make the feature a two-tenths-of-a-percent tax. `engine.test.ts` asserts the
 * rate and asserts that a win pays exactly twice the stake, which together pin
 * the expectation to zero.
 *
 * The two limits are the only things stopping it being a slot machine with the
 * volatility of a coin-flipping contest. A win above
 * {@link GAMBLE_MAX_RATIO} times the stake cannot be gambled at all, and no
 * run may exceed {@link GAMBLE_MAX_STEPS} doubles, which caps a single gamble
 * at 32 times what went in.
 */

import { chance, type Rng } from './rng';
import { GAMBLE_MAX_RATIO, GAMBLE_MAX_STEPS } from './paytable';
import type { GambleChoice, GambleResult } from './types';

/**
 * Whether a win is small enough to be offered the cards.
 *
 * The cap is on the *win*, not on the bankroll, and it exists so a player
 * cannot take a hundred-times hit and turn it into a coin flip. Zero is not
 * gambleable either -- there is nothing to double -- which saves every caller
 * a separate emptiness check.
 */
export function canGamble(win: number, totalBet: number): boolean {
  return win > 0 && totalBet > 0 && win <= GAMBLE_MAX_RATIO * totalBet;
}

/**
 * One flip.
 *
 * `step` is how many doubles have already succeeded in this run, so the caller
 * passes 0 for the first flip. Being handed a step at or past the cap is a
 * programming error rather than a player action -- `canGamble` and the step
 * counter are the guard, and a silent loss here would be indistinguishable
 * from a real one -- so it throws.
 *
 * Money stays integral: the stake is whole cents and doubling a whole number
 * of cents is a whole number of cents, on every one of the at most five steps.
 */
export function gamble(
  rng: Rng,
  choice: GambleChoice,
  stake: number,
  step: number,
): GambleResult {
  if (step < 0 || step >= GAMBLE_MAX_STEPS) {
    throw new RangeError(`gamble: step ${step} is outside 0..${GAMBLE_MAX_STEPS - 1}`);
  }
  // Exactly one half. `Rng.next` is a 32-bit word over 2^32, so precisely half
  // of its possible values fall below 0.5 -- there is no rounding edge here
  // for the house to live in.
  const landed: GambleChoice = chance(rng, 0.5) ? 'RED' : 'BLACK';
  const won = landed === choice;
  return {
    choice,
    landed,
    won,
    stake,
    balance: won ? stake * 2 : 0,
    step: won ? step + 1 : step,
  };
}
