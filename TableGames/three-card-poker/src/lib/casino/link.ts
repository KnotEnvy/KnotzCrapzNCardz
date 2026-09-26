'use client';

/**
 * Knotz Three Card Poker, on the casino floor.
 *
 * The only file at this table that knows a casino exists. It reads the store,
 * writes the store, and replaces the actions that would otherwise create money.
 * Nothing in `engine/`, nothing in the shuffler and nothing on the felt changes,
 * and outside the casino this returns a no-op.
 *
 * ------------------------------------------------------------------------
 * One stack, three spots
 * ------------------------------------------------------------------------
 *
 * Same shape as the blackjack table next door, and for the same reason: the
 * table was built for three players with three bankrolls, and the casino has one
 * player with one wallet whose chips sit in front of them and spread over as
 * many boxes as they care to play. So the buy-in is spread across the open
 * seats, and re-spread when the player opens or closes one — between rounds
 * only, with nothing in any spot, because that is the only moment moving chips
 * between boxes is not moving a live wager.
 *
 * ------------------------------------------------------------------------
 * Why the position is only reported between rounds
 * ------------------------------------------------------------------------
 *
 * Mid-round this game has money in four places — the Ante, the Play, Pair Plus
 * and the 6 Card Bonus — with the Play added by a decision and the bonuses
 * resolving independently of it. Working out what the cage owes from the middle
 * of that means re-implementing the engine's settlement out here, where a second
 * implementation would eventually disagree with the first.
 *
 * The betting phase has none of it: every chip the player owns is in a bankroll
 * and the spots hold intentions rather than wagers. So the floor hears once per
 * round. A tab that dies mid-hand leaves the floor with the position from before
 * the deal, which returns the wager — the same as a table called off mid-hand.
 */

import { createCasinoClient, type CasinoClient } from './client';
import { onCasinoFloor } from './mode';
import { fmt } from '@/lib/engine/money';
import type { SeatId, TableState } from '@/lib/engine/types';
import { useGame } from '@/lib/store/useGame';

/** The slug this table is registered under in the floor's catalog. */
export const GAME_SLUG = 'three-card-poker';

/** A win worth putting on the ticker, in cents. */
const SHOUT_FROM = 40_000;

/**
 * Everything the player has at this table.
 *
 * In the betting phase the chips in the spots have not left the bankroll, so
 * the bankrolls alone are the whole story. Mid-round `wagers` holds what
 * actually went out, and adding it back is what makes this figure "what the cage
 * owes" rather than "what is not currently on the felt".
 */
function held(table: TableState): number {
  let total = 0;
  for (const seat of table.seats) {
    total += seat.bankroll;
    if (table.phase !== 'BETTING') {
      total += seat.wagers.ante + seat.wagers.play + seat.wagers.pairPlus + seat.wagers.sixCard;
    }
  }
  return total;
}

/** What is committed but not yet settled, for the floor's own HUD. */
function exposure(table: TableState): number {
  let total = 0;
  for (const seat of table.seats) {
    const w = table.phase === 'BETTING' ? { ...seat.bets, play: 0 } : seat.wagers;
    total += w.ante + w.play + w.pairPlus + w.sixCard;
  }
  return total;
}

function occupiedSeats(table: TableState): SeatId[] {
  return table.seats.filter((s) => s.occupied).map((s) => s.id);
}

/** True when nothing is in any spot: the only safe moment to re-level. */
function quiet(table: TableState): boolean {
  if (table.phase !== 'BETTING') return false;
  return table.seats.every((s) => s.bets.ante + s.bets.pairPlus + s.bets.sixCard === 0);
}

/**
 * Spread `total` cents across the open seats.
 *
 * The remainder lands on the first seat rather than being dropped: a three-way
 * split of an odd number of cents has to go somewhere, and quietly losing two
 * cents per re-level is exactly what an integer money system exists to prevent.
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
        // measures from the stack the player actually held.
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
        rounds: acc.rounds + s.stats.rounds,
        wagered: acc.wagered + s.stats.anteStaked + s.stats.playWagered,
        won: acc.won + Math.max(0, s.stats.net),
      }),
      { rounds: 0, wagered: 0, won: 0 },
    );
    return {
      chips: held(table),
      atRisk: exposure(table),
      wagered: stats.wagered,
      won: stats.won,
      rounds: stats.rounds,
    };
  };

  client = createCasinoClient({
    game: GAME_SLUG,
    title: 'Knotz Three Card Poker',
    capabilities: ['chip-sync', 'cash-out', 'busy-signal', 'events', 'top-up'],

    onSeat: (table) => {
      useGame.getState().renameSeat('A', table.player.handle);
      fund(table.chips);

      /*
       * The taps, closed. All three are correct outside the casino.
       *
       * `rebuy` tops a seat up from nowhere, which on a floor with a wallet
       * behind it is counterfeiting; it now asks the cage, and real chips come
       * back as a `credit`.
       *
       * `newSession` re-shuffles *and* resets every bankroll to the default,
       * which would quietly replace the player's buy-in; it now re-shuffles and
       * puts the same chips back.
       *
       * `setSeatOccupied` is not dangerous, just consequential: opening a seat
       * is paid for out of the stack already on the table, so it re-levels
       * afterwards, and only when nothing is in a spot.
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
      // Empty every seat before replying: the frame is going away but not
      // instantly, and chips already handed back must not still be bettable.
      useGame.setState((s) => ({ table: spread(s.table, 0) }));
      client?.cashedOut(owed);
    },

    onStandalone: () => {
      /* Framed and flagged but nobody answered: play on the local save. */
    },
  });

  const unsubscribe = useGame.subscribe((state, previous) => {
    if (settled) return;

    const live = state.busy || state.table.phase !== 'BETTING';
    const wasLive = previous.busy || previous.table.phase !== 'BETTING';
    if (live !== wasLive) client?.setBusy(live);

    if (state.table.phase === 'BETTING' && previous.table.phase !== 'BETTING') {
      client?.report(position());
      if (held(state.table) === 0) client?.needChips(state.table.rules.minBet * 20);
    }

    /* --- the ticker --- */

    if (state.settlements !== previous.settlements && state.settlements.length > 0) {
      const net = state.settlements.reduce((sum, s) => sum + s.net, 0);
      if (net >= SHOUT_FROM) {
        client?.announce('big-win', `took ${fmt(net)} off three card poker`, net);
      }
      /*
       * A straight flush or better is the hand this game is played for — 0.22%
       * of deals between them — and it is worth the floor hearing about whatever
       * it paid, which is the difference between a ticker and a leaderboard.
       */
      for (const seat of state.table.seats) {
        const category = seat.result?.hand;
        if (category === 'STRAIGHT_FLUSH' || category === 'TRIPS') {
          client?.announce(
            'feature',
            category === 'STRAIGHT_FLUSH'
              ? 'was dealt a straight flush at three card poker'
              : 'was dealt trips at three card poker',
          );
          break;
        }
      }
    }
  });

  return () => {
    unsubscribe();
    client?.dispose();
    client = null;
  };
}
