/**
 * Free spins -- the Shrine of Flames.
 *
 * The session itself is three numbers: how many spins are owed, how many have
 * been played, and where the multiplier trail has got to. Everything
 * interesting is in the third one.
 *
 * The trail is why ten free spins are worth several times ten base spins, and
 * why they are worth it in a shape players like. It starts at 1x and steps up
 * -- 2x, 3x, 5x, 10x -- on every reel the dragon takes and every pearl that
 * lands, and it never steps back inside a session. That "never steps back" is
 * the entire design. A trail that resets makes each spin a fresh gamble and
 * the session a sequence of unrelated events; a trail that only climbs makes
 * the session one event, and turns a dead spin at 5x from a disappointment
 * into the price of the 5x. It is also why a retrigger is worth more than the
 * five spins it names: those five spins are played at whatever the trail has
 * reached, not at 1x.
 *
 * These functions are pure and take the state they are given. The store owns
 * the session; this file owns the arithmetic.
 */

import { FREE_SPIN_AWARD, MULTIPLIER_TRAIL, RETRIGGER_SPINS, SCATTER_TRIGGER } from './paytable';
import type { FeatureTrigger, FreeSpinsState, SpinResult, Stake } from './types';

/** The trail rung a session is standing on. */
export function trailMultiplier(state: FreeSpinsState): number {
  const index = Math.min(Math.max(state.trailIndex, 0), MULTIPLIER_TRAIL.length - 1);
  return MULTIPLIER_TRAIL[index];
}

/**
 * Open a session.
 *
 * The stake is frozen here and never moves again. A player cannot change bet
 * inside free spins -- not as a UI restriction but as a property of the state,
 * because the spins were awarded against this stake and letting them be played
 * at a higher one is the oldest way there is to break a slot's return.
 *
 * `bought` is carried through rather than inferred. A bought session and a
 * triggered one are mathematically identical and the presentation needs to
 * tell them apart anyway, so it is recorded rather than reconstructed.
 */
export function startFreeSpins(
  trigger: FeatureTrigger,
  stake: Stake,
  bought: boolean,
): FreeSpinsState {
  return {
    awarded: trigger.spins ?? FREE_SPIN_AWARD[SCATTER_TRIGGER],
    played: 0,
    won: 0,
    trailIndex: 0,
    retriggers: 0,
    totalBet: stake.totalBet,
    betPerLine: stake.betPerLine,
    bought,
  };
}

/**
 * Fold one played spin back into the session.
 *
 * The trail moves by what the spin reported rather than by what its multiplier
 * came out as, because the trail saturates: a spin that earns two steps while
 * already on the top rung looks exactly like a spin that earned none if all
 * you have is the 10x. Reading `trailAdvances` keeps the two apart, which
 * costs nothing now and matters the moment the trail grows a sixth rung.
 *
 * A retrigger adds its spins to `awarded` rather than to some separate pool,
 * so `awarded - played` is always the honest count of spins still to come and
 * the counter on the glass never needs to know a retrigger happened.
 */
export function applyFreeSpin(state: FreeSpinsState, result: SpinResult): FreeSpinsState {
  const next: FreeSpinsState = {
    ...state,
    played: state.played + 1,
    won: state.won + result.totalWin,
    trailIndex: Math.min(
      state.trailIndex + (result.trailAdvances ?? 0),
      MULTIPLIER_TRAIL.length - 1,
    ),
  };

  if (result.trigger?.feature === 'FREE_SPINS') {
    next.awarded = state.awarded + (result.trigger.spins ?? RETRIGGER_SPINS);
    next.retriggers = state.retriggers + 1;
  }

  return next;
}

/** True while the session still owes spins. */
export function freeSpinsRemaining(state: FreeSpinsState): number {
  return Math.max(0, state.awarded - state.played);
}
