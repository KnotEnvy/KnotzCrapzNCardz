'use client';

/**
 * Knotz Craps, on the casino floor.
 *
 * The only file at this table that knows a casino exists. It reads the store,
 * writes the store, and replaces the two actions that would otherwise create
 * money. Nothing in `engine/`, nothing in the dice physics and nothing on the
 * felt changes, and outside the casino this returns a no-op.
 *
 * ------------------------------------------------------------------------
 * Dollars, and the cents that do not fit in them
 * ------------------------------------------------------------------------
 *
 * The casino counts in cents because three of its four games do and because a
 * paytable with a half-unit line exists. This table counts in whole dollars,
 * and that is not an oversight: a craps layout is priced in dollars, place bets
 * snap to multiples of five and six, the vig is a dollar minimum, and every
 * payout in `engine/odds.ts` floors to a whole dollar exactly as a stickman
 * would. Changing that to satisfy the casino would change what the game pays.
 *
 * So the unit conversion lives here, at the boundary, and it is lossless in the
 * direction that matters. Chips arrive in cents; the table is funded with
 * `floor(chips / 100)` dollars and the remainder is *carried* — held by this
 * module, never shown, never bet, and added back to the cash-out. A player who
 * tops up an odd $12.34 keeps their thirty-four cents; the table simply never
 * sees them.
 */

import { createCasinoClient, type CasinoClient } from './client';
import { onCasinoFloor } from './mode';
import { atRisk } from '@/lib/engine/table';
import { useGame } from '@/lib/store/useGame';

/** The slug this table is registered under in the floor's catalog. */
export const GAME_SLUG = 'craps';

/** The seat the wallet is behind. Seat B exists but never plays on the floor. */
const PLAYER_SEAT = 'A' as const;

/** A win worth putting on the ticker, in dollars. */
const SHOUT_FROM = 500;

export function linkToFloor(): () => void {
  if (!onCasinoFloor()) return () => {};

  let client: CasinoClient | null = null;
  let settled = false;
  /** Cents the dollar table cannot represent. See the note above. */
  let carried = 0;
  let handle = 'Player';

  const original = {
    addChips: useGame.getState().addChips,
    newSession: useGame.getState().newSession,
  };

  /** Dollars in front of the player, rack plus everything live on the felt. */
  const dollarsHeld = () => {
    const { table } = useGame.getState();
    return table.seats[PLAYER_SEAT].bankroll + atRisk(table, PLAYER_SEAT);
  };

  const position = () => {
    const { table } = useGame.getState();
    const seat = table.seats[PLAYER_SEAT];
    const live = atRisk(table, PLAYER_SEAT);
    return {
      chips: (seat.bankroll + live) * 100 + carried,
      atRisk: live * 100,
      wagered: seat.totalWagered * 100,
      won: Math.max(0, (seat.bankroll + live - seat.buyIn) * 100),
      rounds: table.rollCount,
    };
  };

  /**
   * Open a table with `chips` cents in front of the player.
   *
   * `newSession` is the right door rather than a bankroll poke: it is what the
   * setup screen calls, it deals a fresh layout, and it sets `sessionStarted`,
   * which is what lets the floor drop a player straight onto the felt instead
   * of at a buy-in form they already filled in upstairs.
   */
  const openTable = (chips: number) => {
    carried = chips % 100;
    original.newSession({
      seatAName: handle,
      seatBName: 'Open box',
      buyIn: Math.floor(chips / 100),
      // One player. Seat B stays in the state so nothing downstream has to
      // special-case a missing seat, and never takes the dice.
      solo: true,
    });
  };

  /** Chips arriving at a live table, without disturbing the layout. */
  const topUp = (total: number) => {
    const held = dollarsHeld();
    const wanted = Math.floor(total / 100);
    carried = total % 100;
    if (wanted > held) original.addChips(PLAYER_SEAT, wanted - held);
  };

  client = createCasinoClient({
    game: GAME_SLUG,
    title: 'Knotz Craps',
    capabilities: ['chip-sync', 'cash-out', 'busy-signal', 'events', 'top-up'],

    onSeat: (table) => {
      handle = table.player.handle;
      openTable(table.chips);

      /*
       * The two taps, closed. Both are correct outside the casino and wrong
       * inside it.
       *
       * `addChips` is the rebuy button: it adds `rules.rebuyAmount` from
       * nowhere. On the floor it asks the cage, and real chips come back as a
       * `credit`.
       *
       * `newSession` is the setup screen: it deals a new table at whatever
       * buy-in the form says, which would let a player re-open at any stake
       * they liked. It now re-deals at what they actually hold — so the setup
       * screen still works for changing rules and names, and simply cannot
       * change the size of the stack.
       */
      useGame.setState({
        addChips: (seat, amount) => {
          if (seat !== PLAYER_SEAT) return;
          client?.needChips(Math.max(0, amount) * 100);
        },
        newSession: (opts) => {
          const held = dollarsHeld() * 100 + carried;
          handle = opts.seatAName || handle;
          carried = held % 100;
          original.newSession({ ...opts, buyIn: Math.floor(held / 100), solo: true });
        },
      });
    },

    onCredit: ({ total }) => topUp(total),

    onCashOutRequest: () => {
      if (settled) return;
      settled = true;
      /*
       * Everything at the table comes back, bets included. A real stickman will
       * not let a player take a contract bet down, and this is not that
       * moment — the player is leaving, the layout is being swept, and the cage
       * owes what was in front of them. Taking the bets off the felt first
       * would mean settling them through the engine, which is a decision the
       * engine is right to refuse.
       */
      const owed = dollarsHeld() * 100 + carried;
      carried = 0;
      // Deal a dead table so nothing is bettable while the frame closes.
      original.newSession({ seatAName: handle, seatBName: 'Open box', buyIn: 0, solo: true });
      client?.cashedOut(owed);
    },

    onStandalone: () => {
      /* Framed and flagged but nobody answered: play on the local save. */
    },
  });

  const unsubscribe = useGame.subscribe((state, previous) => {
    if (settled) return;

    // The dice being in the air is the one time a cash-out has to wait: the
    // roll is going to move money and the cage would be counting a stale rack.
    if (state.rolling !== previous.rolling) client?.setBusy(state.rolling);

    if (state.table !== previous.table) {
      client?.report(position());
      if (dollarsHeld() === 0 && !state.rolling) {
        client?.needChips(state.table.rules.rebuyAmount * 100);
      }
    }

    /* --- the ticker --- */

    if (state.settlements !== previous.settlements && state.settlements.length > 0) {
      const net = state.settlements.reduce((sum, s) => sum + s.net, 0);
      if (net >= SHOUT_FROM) {
        client?.announce('big-win', `took $${net.toLocaleString()} off the craps table`, net * 100);
      }
    }

    // A shooter who will not seven out is the thing a craps pit shouts about,
    // and it is the milestone a player actually remembers.
    const rolls = state.table.shooterRollCount;
    if (rolls !== previous.table.shooterRollCount && rolls > 0 && rolls % 20 === 0) {
      client?.announce('milestone', `is ${rolls} rolls into a hand on craps`);
    }

    if (state.table.firePoints.length > previous.table.firePoints.length) {
      const lit = state.table.firePoints.length;
      if (lit >= 4) client?.announce('feature', `has ${lit} points on the fire bet`);
    }
  });

  return () => {
    unsubscribe();
    client?.dispose();
    client = null;
  };
}
