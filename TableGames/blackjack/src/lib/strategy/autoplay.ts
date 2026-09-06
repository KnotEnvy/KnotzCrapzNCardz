/**
 * The bot.
 *
 * One function that decides what a seat does next, and one that plays a whole
 * round out. It exists twice over: the app uses it for demo mode and for the
 * "play it for me" button, and the simulation suite uses it to deal several
 * hundred thousand hands and measure what the rules actually cost.
 *
 * The important property is that it has no privileged access. It decides from
 * the cards on the felt and the count of what has already been discarded —
 * the same two things a player has — and it moves money only by calling the
 * same exported actions the buttons call. A bot cannot make a play a player
 * could not, because there is no second path into the engine.
 */

import {
  closeOffers,
  deal,
  dealerPlayOut,
  double,
  hit,
  legalActions,
  nextRound,
  seatOf,
  setBet,
  split,
  stand,
  surrender,
  takeInsurance,
  type ActionResult,
} from '@/lib/engine/table';
import { handValue, isPair } from '@/lib/engine/hand';
import { maxInsurance } from '@/lib/engine/rules';
import { settle } from '@/lib/engine/resolve';
import type { Rng } from '@/lib/engine/rng';
import type { Action, SeatId, TableState } from '@/lib/engine/types';
import { rankValue } from '@/lib/engine/types';
import { advise, codeFor, upcardValue, type Advice } from './basic';
import {
  countShoe,
  deviationFor,
  insuranceIsGood,
  type CountSystem,
} from './counting';

export interface BotConfig {
  /** Play the basic-strategy chart. Off means it hits to 17 like a tourist. */
  basic: boolean;
  /** Apply the Illustrious 18 / Fab 4 index plays at the current true count. */
  deviations: boolean;
  /** Vary the bet with the count. Off means flat betting. */
  spread: boolean;
  /** The counting system used for both of the above. */
  system: CountSystem;
  /** The flat bet, and the unit a spread multiplies. */
  unit: number;
}

export const DEFAULT_BOT: BotConfig = {
  basic: true,
  deviations: false,
  spread: false,
  system: 'HI_LO',
  unit: 1000,
};

/* ------------------------------------------------------------------ *
 * One decision
 * ------------------------------------------------------------------ */

/**
 * What the bot would do with the hand currently in focus.
 *
 * Returns the advice as well as the action so that the trainer can show the
 * reasoning and the deviation, if one applied, next to the play.
 */
export function decide(table: TableState, config: BotConfig): (Advice & { deviation?: string }) | null {
  if (!table.focus) return null;
  const seat = seatOf(table, table.focus.seat);
  const hand = seat.hands[table.focus.hand];
  const upcard = table.dealer.cards[0];
  if (!hand || !upcard) return null;

  const legal = legalActions(table);

  if (!config.basic) {
    // The tourist: draw to seventeen, stand on anything above, never do
    // anything clever. Worth about 2% more to the house than the chart, which
    // is the comparison the stats panel is making when it shows both.
    const v = handValue(hand.cards);
    const action: Action = v.total < 17 ? 'HIT' : 'STAND';
    return { action, code: v.total < 17 ? 'H' : 'S', fellBack: false, why: 'Draw to seventeen.' };
  }

  const base = advise(hand, upcard, legal, table.rules);
  if (!base) return null;
  if (!config.deviations) return base;

  const count = countShoe(table.shoe, config.system, table.rules.decks);
  const v = handValue(hand.cards);
  const tens = isPair(hand.cards) && rankValue(hand.cards[0].rank) === 10;
  const dev = deviationFor(v.total, upcardValue(upcard), count.true, tens);
  if (!dev) return base;

  const action = dev.action === 'INSURE' ? base.action : (dev.action as Action);
  if (action === base.action) return base;
  if (!legal[action]?.allowed) return base;

  return {
    ...base,
    action,
    fellBack: false,
    why: `Index play: at a true count of ${count.true.toFixed(1)}, ${dev.hand} becomes ${action.toLowerCase()}.`,
    deviation: dev.hand,
  };
}

function apply(table: TableState, action: Action): ActionResult {
  switch (action) {
    case 'HIT':
      return hit(table);
    case 'STAND':
      return stand(table);
    case 'DOUBLE':
      return double(table);
    case 'SPLIT':
      return split(table);
    case 'SURRENDER':
      return surrender(table);
  }
}

/* ------------------------------------------------------------------ *
 * A whole round
 * ------------------------------------------------------------------ */

/**
 * How much the bot puts up, in cents.
 *
 * Flat unless spreading, in which case it multiplies by the ramp. Clamped to
 * the table limits and to the bankroll, so a bot on a losing run bets what it
 * has rather than refusing to play.
 */
export function betFor(table: TableState, seatId: SeatId, config: BotConfig): number {
  const seat = seatOf(table, seatId);
  let amount = config.unit;
  if (config.spread) {
    const count = countShoe(table.shoe, config.system, table.rules.decks);
    amount = config.unit * betRampUnits(count.true);
  }
  amount = Math.min(amount, table.rules.maxBet, seat.bankroll);
  if (amount < table.rules.minBet) return Math.min(table.rules.minBet, seat.bankroll);
  return amount;
}

function betRampUnits(trueCount: number): number {
  if (trueCount < 1) return 1;
  if (trueCount < 2) return 2;
  if (trueCount < 3) return 4;
  if (trueCount < 4) return 6;
  if (trueCount < 5) return 8;
  return 12;
}

export interface RoundOutcome {
  table: TableState;
  /** Signed cents across the whole table for this round. */
  net: number;
  /** Main-bet cents wagered, the denominator of a house-edge measurement. */
  wagered: number;
  handsPlayed: number;
}

/**
 * Play one complete round, from an empty felt back to an empty felt.
 *
 * The loop guard is not decoration. Every action here either finishes a hand
 * or moves the focus on, so the round is bounded — but a future change that
 * broke that invariant would hang the simulation rather than fail it, and a
 * hang in a hundred-thousand-round loop is a very slow way to find out.
 */
export function playRound(
  table: TableState,
  config: BotConfig,
  rng: Rng,
  seats: readonly SeatId[] = ['A'],
): RoundOutcome {
  let t = table;

  for (const id of seats) {
    const seat = seatOf(t, id);
    if (!seat.occupied) continue;
    if (seat.bankroll < t.rules.minBet) continue;
    const res = setBet(t, id, betFor(t, id, config));
    if (res.ok) t = res.table;
  }

  const wageredBefore = totalWagered(t);
  const dealt = deal(t, rng);
  if (!dealt.ok) return { table: t, net: 0, wagered: 0, handsPlayed: 0 };
  t = dealt.table;

  const netBefore = totalNet(t);
  const handsBefore = totalHands(t);

  if (t.phase === 'INSURANCE') {
    if (config.basic && config.deviations) {
      const count = countShoe(t.shoe, config.system, t.rules.decks);
      if (insuranceIsGood(count.true)) {
        for (const id of seats) {
          const seat = seatOf(t, id);
          if (seat.hands.length === 0) continue;
          const res = takeInsurance(t, id, maxInsurance(seat.hands[0].bet));
          if (res.ok) t = res.table;
        }
      }
    }
    // Early surrender, where the table offers it, is taken here.
    let guard = 0;
    while (t.phase === 'INSURANCE' && t.focus && ++guard < 64) {
      const choice = decide(t, config);
      if (!choice || choice.action !== 'SURRENDER') break;
      const res = surrender(t);
      if (!res.ok) break;
      t = res.table;
    }
    const closed = closeOffers(t);
    if (closed.ok) t = closed.table;
  }

  let guard = 0;
  while (t.phase === 'PLAYER' && t.focus) {
    const choice = decide(t, config);
    if (!choice) break;
    const res = apply(t, choice.action);
    if (!res.ok) {
      // Should be unreachable: `decide` reconciles against `legalActions`.
      // Standing is the safe fallback rather than a throw, because a
      // simulation that dies at hand 240,000 has measured nothing.
      const fallback = stand(t);
      if (!fallback.ok) break;
      t = fallback.table;
    } else {
      t = res.table;
    }
    if (++guard > 256) throw new Error('The player phase never ended.');
  }

  if (t.phase === 'DEALER') t = dealerPlayOut(t);

  const trueCount = countShoe(t.shoe, config.system, t.rules.decks).true;
  const settled = settle(t, trueCount);
  t = settled.table;

  const outcome: RoundOutcome = {
    table: t,
    net: totalNet(t) - netBefore,
    wagered: totalWagered(t) - wageredBefore,
    handsPlayed: totalHands(t) - handsBefore,
  };

  const cleared = nextRound(t);
  if (cleared.ok) outcome.table = cleared.table;
  return outcome;
}

function totalNet(t: TableState): number {
  return t.seats.reduce((n, s) => n + s.stats.net, 0);
}

function totalWagered(t: TableState): number {
  return t.seats.reduce((n, s) => n + s.stats.wagered, 0);
}

function totalHands(t: TableState): number {
  return t.seats.reduce((n, s) => n + s.stats.handsPlayed, 0);
}

/** The code the chart gives for the focused hand — what the trainer grades against. */
export function chartCodeFor(table: TableState): string | null {
  if (!table.focus) return null;
  const seat = seatOf(table, table.focus.seat);
  const hand = seat.hands[table.focus.hand];
  const up = table.dealer.cards[0];
  if (!hand || !up) return null;
  return codeFor(hand.cards, upcardValue(up), table.rules);
}
