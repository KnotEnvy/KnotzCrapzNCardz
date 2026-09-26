'use client';

/**
 * Dragon's Shrine, on the casino floor.
 *
 * This is the only file in the cabinet that knows a casino exists, and it is
 * the only file the casino needs from the cabinet. Everything it does, it does
 * from outside: it reads the store, it writes the store, and it replaces two
 * of the store's own actions with versions that ask the cage instead of
 * minting money. Nothing in `engine/`, `components/` or the spin sequencer
 * changes, and none of them can tell the difference.
 *
 * The four things it is responsible for:
 *
 *   1. **Taking the buy-in.** The floor says what the player bought in for and
 *      that becomes the credit meter, replacing whatever the local save had.
 *   2. **Reporting the meter.** After anything settles, the floor is told what
 *      the machine holds — because that is what the cage owes if the tab dies.
 *   3. **Closing the two taps.** `rebuy` adds free money and `newSession`
 *      resets the bankroll. On the floor, the first opens the cashier and the
 *      second re-racks the cabinet without touching the chips.
 *   4. **Shouting.** A jackpot or a big win goes on the floor ticker.
 *
 * Standalone, `onCasinoFloor()` is false, this returns a no-op, and the
 * cabinet is exactly the machine it was before the casino was built.
 */

import { createCasinoClient, type CasinoClient } from './client';
import { onCasinoFloor } from './mode';
import { REBUY_AMOUNT } from '@/lib/engine/config';
import { moneyShort } from '@/lib/format';
import { useSlots } from '@/lib/store/useSlots';

/** The slug this cabinet is registered under in the floor's catalog. */
export const GAME_SLUG = 'dragons-shrine';

/**
 * What a jackpot is called on the ticker. The store knows the id; the floor
 * wants a sentence.
 */
const JACKPOT_LABEL: Record<string, string> = {
  MINI: 'the Mini',
  MINOR: 'the Minor',
  MAJOR: 'the Major',
  GRAND: 'the GRAND',
};

/** Win tiers worth interrupting the floor for. */
const SHOUT_TIERS = new Set(['MEGA', 'EPIC', 'LEGENDARY']);

export function linkToFloor(): () => void {
  if (!onCasinoFloor()) return () => {};

  let client: CasinoClient | null = null;
  /** The floor's figure, and the one the cabinet was funded with. */
  let credited = 0;
  let settled = false;
  /** The store's own actions, kept so the replacements can fall back on them. */
  const original = {
    rebuy: useSlots.getState().rebuy,
    newSession: useSlots.getState().newSession,
  };

  /**
   * What the machine holds, all in.
   *
   * The gamble is the only place money sits outside the credit meter: taking a
   * win to the cards moves it out of `bankroll` and into `gamble.stake`, which
   * is the honest model — the money is either in the balance or at risk, never
   * both — and means the total has to add them back together. A spin in flight
   * has already had its stake taken, so the figure dips mid-spin and comes
   * back up on settlement. That is correct rather than unfortunate: it is what
   * the cage would owe if the lights went out right then.
   */
  const position = () => {
    const s = useSlots.getState();
    const atRisk = s.gamble?.stake ?? 0;
    return {
      chips: s.bankroll + atRisk,
      atRisk,
      wagered: s.stats.wagered,
      won: s.stats.won,
      rounds: s.stats.spins,
    };
  };

  /** Put `total` cents on the machine, replacing whatever is there. */
  const fund = (total: number) => {
    credited = total;
    useSlots.setState((prev) => ({
      bankroll: total,
      message: null,
      // A buy-in is new money, not a win: it lifts the peak so the session's
      // drawdown is measured from the stack the player actually held.
      stats: { ...prev.stats, peak: Math.max(prev.stats.peak, total) },
    }));
  };

  client = createCasinoClient({
    game: GAME_SLUG,
    title: "Dragon's Shrine",
    capabilities: ['chip-sync', 'cash-out', 'events', 'top-up'],

    onSeat: (table) => {
      fund(table.chips);
      /*
       * Two actions have to go, and they have to go here rather than in the
       * store, because outside the casino they are both correct. `rebuy` hands
       * out REBUY_AMOUNT from nowhere, which on a floor with a wallet behind it
       * is counterfeiting; it now asks the cashier, and real chips arrive as a
       * `credit`. `newSession` re-racks the machine *and* resets the bankroll
       * to the default, which would quietly replace the player's buy-in; it now
       * re-racks and puts the chips back.
       */
      useSlots.setState({
        rebuy: () => client?.needChips(REBUY_AMOUNT),
        newSession: (seed?: string) => {
          const held = position().chips;
          original.newSession(seed);
          fund(held);
        },
      });
    },

    onCredit: ({ total }) => fund(total),

    onCashOutRequest: () => {
      if (settled) return;
      settled = true;
      const held = position().chips;
      /*
       * Zero the meter before replying. The frame is about to go away, but not
       * instantly, and a cabinet still showing chips it has already handed back
       * is a cabinet somebody can get one more spin out of.
       */
      useSlots.setState({ bankroll: 0, win: 0, meter: 0, gamble: null, autoplay: null });
      client?.cashedOut(held);
    },

    onStandalone: () => {
      /*
       * Framed, flagged, and nobody answered — a floor that failed to load its
       * own shell, or a URL somebody kept. There is nothing to fund the machine
       * with, so it plays on whatever the casino-mode save holds, which on a
       * first visit is the cabinet's own opening credit. Better a playable
       * machine than a blank one.
       */
    },
  });

  /*
   * Report on anything that changes the position. zustand hands the previous
   * state too, so this is a diff rather than a poll, and the client coalesces
   * whatever arrives inside its window — a slot in turbo settles several times
   * a second and the floor does not need to hear about each one separately.
   */
  const unsubscribe = useSlots.subscribe((state, previous) => {
    if (settled) return;

    const atRisk = state.gamble?.stake ?? 0;
    const held = state.bankroll + atRisk;
    const wasAtRisk = previous.gamble?.stake ?? 0;
    const wasHeld = previous.bankroll + wasAtRisk;

    if (held !== wasHeld || state.stats.spins !== previous.stats.spins) {
      client?.report(position());
    }

    // Out of credit with nothing pending: the cashier, not a dead machine.
    if (held === 0 && wasHeld > 0) client?.needChips(REBUY_AMOUNT);

    /* --- the ticker --- */

    if (state.jackpotWon && state.jackpotWon !== previous.jackpotWon) {
      client?.announce(
        'jackpot',
        `took ${JACKPOT_LABEL[state.jackpotWon] ?? state.jackpotWon} on Dragon's Shrine`,
        state.win,
      );
    }

    const tier = state.presentation?.tier;
    const changed = state.presentation?.key !== previous.presentation?.key;
    if (changed && tier && SHOUT_TIERS.has(tier)) {
      client?.announce(
        'big-win',
        `hit ${moneyShort(state.presentation!.amount)} on Dragon's Shrine`,
        state.presentation!.amount,
      );
    }

    if (state.free && !previous.free) {
      client?.announce('feature', `woke the shrine — ${state.free.awarded} free spins`);
    }
    if (state.hold && !previous.hold) {
      client?.announce('feature', 'locked in on the Shrine Link');
    }
  });

  // The floor's opening figure may arrive before or after this subscription, so
  // send one position immediately: a machine that has been funded and says
  // nothing looks to the floor like a machine that never loaded.
  if (credited > 0) client.report(position());

  return () => {
    unsubscribe();
    client?.dispose();
    client = null;
  };
}
