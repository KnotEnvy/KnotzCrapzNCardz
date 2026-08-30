/**
 * Buying a feature.
 *
 * Three buttons, each of which takes a stack of stake off the player and hands
 * back the trigger they would otherwise have waited for: the shrine, the link,
 * or the shrine at its full five-pearl award.
 *
 * The one rule a buy has to obey is that it must never be the strictly correct
 * play. A buy priced to return more than the base game turns the machine into
 * a single button that a rational player presses for ever, and every honest
 * one is therefore priced a hair *below* base return -- you pay a small
 * premium for skipping the wait, which is exactly what you are buying.
 * `rtp.sim.test.ts` measures all three against the base game and fails if any
 * of them comes out ahead.
 *
 * The costs themselves live in `paytable.ts` next to the numbers they were
 * derived from. They are in units of `totalBet`, so a buy costs the same
 * number of spins whatever rung of the ladder it is bought at, and the price
 * in cents is always a whole number of cents because the stake is.
 */

import { BUY_COSTS, BUY_GRANTS, type BuyOption } from './paytable';

/**
 * What a buy costs, in cents.
 *
 * `Math.round` is a guard, not a correction: every cost in {@link BUY_COSTS}
 * is a whole multiple today, and the moment one of them becomes 87.5x this is
 * the line that decides whether the player is charged the half cent.
 */
export function buyCost(option: BuyOption, totalBet: number): number {
  return Math.round(BUY_COSTS[option] * totalBet);
}

/**
 * What the buy forces onto the next spin.
 *
 * Deliberately a `SpinContext.force`, not a feature state. A bought spin goes
 * through the same `spin` as any other, lands on the same strips, pays its own
 * lines and its own pearl pay, and triggers through the same code path -- so
 * there is exactly one implementation of "what happens when three pearls
 * land", and a buy cannot drift away from the thing it is buying.
 */
export function buyForce(option: BuyOption): { scatters?: number; orbs?: number } {
  return { ...BUY_GRANTS[option] };
}
