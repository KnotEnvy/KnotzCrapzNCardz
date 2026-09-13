'use client';

/**
 * Knotz Blackjack 21, on the casino floor.
 *
 * The only file at this table that knows a casino exists. It reads the store,
 * writes the store, and replaces the two actions that would otherwise create
 * money. Nothing in `engine/`, nothing in the shoe and nothing on the felt
 * changes, and outside the casino this returns a no-op.
 *
 * ------------------------------------------------------------------------
 * One stack, three boxes
 * ------------------------------------------------------------------------
 *
 * This table was built as a three-seat table: three players, three bankrolls,
 * one shoe. The casino has one player and one wallet, and the three boxes are
 * that player's — which is how a real table works too. You buy in once, the
 * chips sit in front of you, and you spread them over as many circles as you
 * want to play.
 *
 * So the buy-in is spread evenly across the boxes that are open, and it is
 * re-spread when the player opens or closes one. That re-levelling happens only
 * between rounds, with no chips in any circle, because it is the only moment
 * when moving money between boxes is not changing a live wager — and it is
 * triggered only by the player explicitly opening or closing a box, never on
 * its own.
 *
 * The engine never learns about any of this. It sees three seats with
 * bankrolls, exactly as it always has.
 *
 * ------------------------------------------------------------------------
 * Why the position is only reported between rounds
 * ------------------------------------------------------------------------
 *
 * A blackjack round has money in five places at once — the circle, the hand,
 * the split hand, insurance, and six side bets that resolve at different
 * moments — and reconstructing "what does the cage owe right now" from the
 * middle of one means re-deriving the engine's own settlement rules out here,
 * where they would be a second implementation waiting to disagree with the
 * first.
 *
 * The betting phase has none of that: everything the player owns is in a
 * bankroll. So that is when the floor is told, which is once per round. The
 * cost is that a tab which dies mid-hand leaves the floor holding the position
 * from before the deal, so the wager comes back — the same as a table called
 * off mid-hand, where the bets are returned. That is the right way to be wrong.
 */

import { createCasinoClient, type CasinoClient } from './client';
import { onCasinoFloor } from './mode';
import { fmt } from '@/lib/engine/money';
import type { SeatId, TableState } from '@/lib/engine/types';
import { useGame } from '@/lib/store/useGame';

/** The slug this table is registered under in the floor's catalog. */
export const GAME_SLUG = 'blackjack';

/** A win worth putting on the ticker, in cents. */
const SHOUT_FROM = 50_000;

/** Everything the player has at this table, across every box. */
function held(table: TableState): number {
  let total = 0;
  for (const seat of table.seats) {
    total += seat.bankroll;
    // In the betting phase a wager sits in the circle without having left the
    // bankroll yet, so it must not be added twice. `atRisk` below is what the
    // floor displays; this is what the cage owes.
    total += seat.insurance;
    for (const hand of seat.hands) total += hand.bet;
  }
  return total;
}

/** What is committed but not yet settled, for the floor's own HUD. */
function exposure(table: TableState): number {
  let total = 0;
  for (const seat of table.seats) {
    total += seat.pendingBet + seat.insurance;
    for (const side of seat.pendingSideBets) total += side.amount;
    for (const hand of seat.hands) total += hand.bet;
  }
  return total;
}

function occupiedSeats(table: TableState): SeatId[] {
  return table.seats.filter((s) => s.occupied).map((s) => s.id);
}

/** True when nothing is committed anywhere: the only safe moment to re-level. */
function quiet(table: TableState): boolean {
  if (table.phase !== 'BETTING') return false;
  return table.seats.every(
    (s) => s.pendingBet === 0 && s.pendingSideBets.length === 0 && s.hands.length === 0,
  );
}

/**
 * Spread `total` cents across the open boxes.
 *
 * The remainder goes to the first box rather than being dropped, because a
 * three-way split of an odd number of cents has to land somewhere and silently
 * losing two cents per re-level is exactly the kind of leak an integer money
 * system exists to prevent.
 */
function spread(table: TableState, total: number): TableState {
  const open = occupiedSeats(table);
  const boxes = open.length > 0 ? open : (['A'] as SeatId[]);
  const each = Math.floor(total / boxes.length);
  const remainder = total - each * boxes.length;

  return {
    ...table,
    seats: table.seats.map((seat) => {
      if (!boxes.includes(seat.id)) return { ...seat, bankroll: 0 };
      const share = each + (seat.id === boxes[0] ? remainder : 0);
      return {
        ...seat,
        bankroll: share,
        // A buy-in is new money, not a win: it lifts the peak so the drawdown
        // chart measures from the stack the player actually held.
        stats: { ...seat.stats, peakBankroll: Math.max(seat.stats.peakBankroll, share) },
      };
    }),
  };
}

export function linkToFloor(): () => void {
  if (!onCasinoFloor()) return () => {};

  let client: CasinoClient | null = null;
  let settled = false;

  const original = {
    newSession: useGame.getState().newSession,
    setSeatOccupied: useGame.getState().setSeatOccupied,
  };

  const fund = (total: number) => {
    useGame.setState((s) => ({ table: spread(s.table, total) }));
  };

  const position = () => {
    const { table } = useGame.getState();
    const stats = table.seats.reduce(
      (acc, s) => ({
        hands: acc.hands + s.stats.handsPlayed,
        wagered: acc.wagered + s.stats.wagered + s.stats.sideWagered,
        won: acc.won + Math.max(0, s.stats.net),
      }),
      { hands: 0, wagered: 0, won: 0 },
    );
    return {
      chips: held(table),
      atRisk: exposure(table),
      wagered: stats.wagered,
      won: stats.won,
      rounds: stats.hands,
    };
  };

  client = createCasinoClient({
    game: GAME_SLUG,
    title: 'Knotz Blackjack 21',
    capabilities: ['chip-sync', 'cash-out', 'busy-signal', 'events', 'top-up'],

    onSeat: (table) => {
      // The first box is the player. The others keep their house names, which
      // is what they are: boxes this player may or may not choose to open.
      useGame.getState().renameSeat('A', table.player.handle);
      fund(table.chips);

      /*
       * The taps, closed. All three are correct outside the casino.
       *
       * `rebuy` tops a box up from nowhere, which on a floor with a wallet
       * behind it is counterfeiting; it now asks the cage, and real chips come
       * back as a `credit`.
       *
       * `newSession` deals a fresh shoe *and* resets every bankroll to the
       * default, which would quietly replace the player's buy-in; it now deals
       * the shoe and puts the same chips back.
       *
       * `setSeatOccupied` is the one that is interesting rather than dangerous:
       * opening a box has to be paid for out of the stack already on the table,
       * so it re-levels afterwards. Between rounds only — the store's own guard
       * refuses it mid-hand, and `quiet` refuses the re-level too.
       */
      useGame.setState({
        rebuy: (_seat: SeatId, cents: number) => client?.needChips(Math.max(0, cents)),
        newSession: (seed?: string) => {
          const chips = held(useGame.getState().table);
          original.newSession(seed);
          fund(chips);
        },
        setSeatOccupied: (seat: SeatId, occupied: boolean) => {
          const chips = held(useGame.getState().table);
          original.setSeatOccupied(seat, occupied);
          if (quiet(useGame.getState().table)) fund(chips);
        },
      });
    },

    onCredit: ({ total }) => fund(total),

    onCashOutRequest: () => {
      if (settled) return;
      settled = true;
      const owed = held(useGame.getState().table);
      // Empty every box before replying. The frame is about to go away but not
      // instantly, and a table still showing chips it has handed back is a
      // table somebody can get one more hand out of.
      useGame.setState((s) => ({ table: spread(s.table, 0) }));
      client?.cashedOut(owed);
    },

    onStandalone: () => {
      /* Framed and flagged but nobody answered: play on the local save. */
    },
  });

  const unsubscribe = useGame.subscribe((state, previous) => {
    if (settled) return;

    /*
     * Busy is "a round is in flight", which for this table means anything but
     * the betting phase, plus the store's own driver flag while it is dealing
     * or playing the dealer's hand.
     */
    const live = state.busy || state.table.phase !== 'BETTING';
    const wasLive = previous.busy || previous.table.phase !== 'BETTING';
    if (live !== wasLive) client?.setBusy(live);

    // Between rounds, and only then. See the note at the top of the file.
    if (state.table.phase === 'BETTING' && previous.table.phase !== 'BETTING') {
      client?.report(position());
      if (held(state.table) === 0) client?.needChips(state.table.rules.minBet * 20);
    }

    /* --- the ticker --- */

    if (state.settlements !== previous.settlements && state.settlements.length > 0) {
      const net = state.settlements.reduce((sum, s) => sum + s.net, 0);
      if (net >= SHOUT_FROM) {
        client?.announce('big-win', `took ${fmt(net)} off the blackjack table`, net);
      }
      const naturals = state.table.seats.reduce((n, s, i) => {
        const before = previous.table.seats[i];
        return n + Math.max(0, s.stats.blackjacks - (before?.stats.blackjacks ?? 0));
      }, 0);
      if (naturals >= 2) {
        client?.announce('feature', `was dealt ${naturals} naturals in one round`);
      }
    }
  });

  return () => {
    unsubscribe();
    client?.dispose();
    client = null;
  };
}
