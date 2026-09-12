/**
 * The table, and every legal move on it.
 *
 * This is the state machine. Each exported action takes the table and returns
 * either a new one or a refusal carrying a reason the UI shows as a toast —
 * never a thrown error, never a mutation, never a partially applied move. That
 * shape is what lets the same functions drive the felt, the autoplay bot and
 * the measurement suite: a bot physically cannot make a bet a player could
 * not, because there is no second path into the state.
 *
 * The round runs the way the rule sheet runs it:
 *
 *   BETTING    Ante, Pair Plus and 6 Card Bonus go down
 *   DECIDING   the machine's stacks of three are out; each seat with an Ante,
 *              left to right, looks at its cards and plays or folds
 *   SHOWDOWN   every decision is in and the dealer's hand is still face down
 *   SETTLE     the dealer's hand is up and resolve.ts pays the table
 *
 * Nothing in this file pays anybody. Every chip leaves a bankroll here — at
 * the deal, and for the Play at the decision — and comes back, if it comes
 * back, in `settle`.
 *
 * Written as plain structural updates throughout. The blackjack table next
 * door uses immer on its cold paths; a Three Card Poker table is three seats
 * of three cards and four numbers, and a spread is as readable as a draft.
 */

import { shuffledDeck } from './deck';
import { evaluate3 } from './poker';
import type { Rng } from './rng';
import type { Card, Decision, Seat, SeatId, SeatStats, SpotKind, TableRules, TableState, Wagers } from './types';
import { SEAT_IDS } from './types';

/* ------------------------------------------------------------------ *
 * Results
 * ------------------------------------------------------------------ */

/**
 * The return shape of every legal move.
 *
 * A refusal is a first-class outcome with a sentence in it, not an exception
 * and not a silent no-op. The felt turns `reason` straight into a toast, which
 * is why every one of them below is written as something a dealer would say.
 */
export type ActionResult = { ok: true; table: TableState; note?: string } | { ok: false; reason: string };

export function ok(table: TableState, note?: string): ActionResult {
  return { ok: true, table, note };
}

export function refuse(reason: string): ActionResult {
  return { ok: false, reason };
}

export interface Legality {
  allowed: boolean;
  reason?: string;
}

/* ------------------------------------------------------------------ *
 * Construction
 * ------------------------------------------------------------------ */

export const DEFAULT_BANKROLL = 100_000; // $1,000 in cents.

export const NO_WAGERS: Readonly<Wagers> = { ante: 0, pairPlus: 0, sixCard: 0 };

const NOTHING_RIDING: Readonly<Wagers & { play: number }> = { ante: 0, pairPlus: 0, sixCard: 0, play: 0 };

export function emptyStats(bankroll: number): SeatStats {
  return {
    rounds: 0,
    hands: 0,
    plays: 0,
    folds: 0,
    wins: 0,
    noQualify: 0,
    pushes: 0,
    losses: 0,
    anteStaked: 0,
    playWagered: 0,
    mainNet: 0,
    anteBonusNet: 0,
    pairPlusWagered: 0,
    pairPlusNet: 0,
    sixCardWagered: 0,
    sixCardNet: 0,
    net: 0,
    peakBankroll: bankroll,
    categories: { STRAIGHT_FLUSH: 0, TRIPS: 0, STRAIGHT: 0, FLUSH: 0, PAIR: 0, HIGH_CARD: 0 },
    decisions: 0,
    correctDecisions: 0,
    evGivenUp: 0,
  };
}

export function createSeat(id: SeatId, occupied: boolean, bankroll = DEFAULT_BANKROLL): Seat {
  return {
    id,
    occupied,
    name: `Seat ${id}`,
    bankroll,
    bets: { ...NO_WAGERS },
    cards: [],
    wagers: { ...NOTHING_RIDING },
    decision: null,
    result: null,
    stats: emptyStats(bankroll),
  };
}

export function createTable(rules: TableRules, options: { seats?: number; bankroll?: number } = {}): TableState {
  const count = Math.min(SEAT_IDS.length, Math.max(1, options.seats ?? 1));
  return {
    rules,
    seats: SEAT_IDS.map((id, i) => createSeat(id, i < count, options.bankroll ?? DEFAULT_BANKROLL)),
    dealer: { cards: [], revealed: false },
    phase: 'BETTING',
    focus: null,
    round: 0,
    settled: false,
    history: [],
  };
}

/* ------------------------------------------------------------------ *
 * Lookups
 * ------------------------------------------------------------------ */

export function seatOf(table: TableState, id: SeatId): Seat {
  const seat = table.seats.find((s) => s.id === id);
  if (!seat) throw new Error(`No seat ${id}`);
  return seat;
}

/** Replace one seat, sharing every other seat by reference. */
function updateSeat(table: TableState, id: SeatId, fn: (seat: Seat) => Seat): TableState {
  return { ...table, seats: table.seats.map((s) => (s.id === id ? fn(s) : s)) };
}

/** Every seat that will be dealt in: an Ante, or Pair Plus on its own. */
export function playingSeats(table: TableState): Seat[] {
  return table.seats.filter((s) => s.occupied && (s.bets.ante > 0 || s.bets.pairPlus > 0));
}

function centsLabel(cents: number): string {
  return cents % 100 === 0 ? `$${(cents / 100).toLocaleString('en-US')}` : `$${(cents / 100).toFixed(2)}`;
}

/* ------------------------------------------------------------------ *
 * Betting
 * ------------------------------------------------------------------ */

/**
 * What a seat has to be able to cover before it can be dealt.
 *
 * The Ante twice — once for itself and once for the Play it may be asked to
 * match — plus the side bets. Casinos leave that to the player, and a player
 * who Antes their last chips and is dealt a straight flush can only fold it.
 * This table refuses to put anyone in that spot: the reserve is checked when
 * the chips go down, so the question "can I afford to play this hand" never
 * comes up while the hand is in front of them.
 */
export function coverNeeded(bets: Wagers): number {
  return bets.ante * 2 + bets.pairPlus + bets.sixCard;
}

/**
 * Put a wager on a spot.
 *
 * `amount` is the whole new wager, not an increment — the chip rack adds to
 * the current value and calls this with the sum, so a mis-click is undone by
 * setting it back rather than by a separate "remove chip" path. Zero clears
 * the spot.
 */
export function setWager(table: TableState, seatId: SeatId, spot: SpotKind, amount: number): ActionResult {
  if (table.phase !== 'BETTING') return refuse('Bets are closed.');
  const seat = table.seats.find((s) => s.id === seatId);
  if (!seat) return refuse('There is no such seat.');
  if (!seat.occupied) return refuse('That seat is empty.');
  if (!Number.isFinite(amount) || amount < 0) return refuse('A bet cannot be negative.');

  const rules = table.rules;
  const next: Wagers = { ...seat.bets };
  const belowMinimum = amount > 0 && amount < rules.minBet;

  switch (spot) {
    case 'ANTE':
      if (belowMinimum) return refuse(`The table minimum is ${centsLabel(rules.minBet)}.`);
      if (amount > rules.maxBet) return refuse(`The Ante maximum is ${centsLabel(rules.maxBet)}.`);
      next.ante = amount;
      /*
       * The 6 Card Bonus may only be placed over an Ante, so taking the Ante
       * down takes it with it — rather than leaving chips on a spot the deal
       * would then refuse, with a reason about a bet the player thought was
       * already gone.
       */
      if (amount === 0) next.sixCard = 0;
      break;

    case 'PAIR_PLUS':
      if (amount > 0 && !rules.pairPlus) return refuse('This table does not book Pair Plus.');
      if (belowMinimum) return refuse(`The table minimum is ${centsLabel(rules.minBet)}.`);
      if (amount > rules.maxPairPlus) return refuse(`Pair Plus is capped at ${centsLabel(rules.maxPairPlus)}.`);
      next.pairPlus = amount;
      break;

    case 'SIX_CARD':
      if (amount > 0 && !rules.sixCard) return refuse('This table does not book the 6 Card Bonus.');
      // The rule sheet: "only … if he/she has also placed an Ante wager."
      if (amount > 0 && next.ante === 0) return refuse('The 6 Card Bonus needs an Ante under it.');
      if (belowMinimum) return refuse(`The table minimum is ${centsLabel(rules.minBet)}.`);
      if (amount > rules.maxSixCard) return refuse(`The 6 Card Bonus is capped at ${centsLabel(rules.maxSixCard)}.`);
      next.sixCard = amount;
      break;
  }

  if (next.ante + next.pairPlus + next.sixCard > seat.bankroll) return refuse('That is more than the bankroll.');
  if (coverNeeded(next) > seat.bankroll) return refuse('Keep enough back for the Play — it has to match the Ante.');

  return ok(updateSeat(table, seatId, (s) => ({ ...s, bets: next })));
}

export function clearBets(table: TableState, seatId?: SeatId): ActionResult {
  if (table.phase !== 'BETTING') return refuse('Bets are closed.');
  return ok({
    ...table,
    seats: table.seats.map((s) => (seatId && s.id !== seatId ? s : { ...s, bets: { ...NO_WAGERS } })),
  });
}

/**
 * The largest part of a set of wagers a bankroll can still cover.
 *
 * In the order a player would want them kept: the Ante with its Play reserve
 * first, then Pair Plus, then the 6 Card Bonus — which only survives with an
 * Ante under it. Used wherever chips have to come down because the money
 * behind them has gone, so that "what stays up" is decided in one place.
 */
export function affordable(bets: Wagers, bankroll: number): Wagers {
  let left = bankroll;
  const ante = bets.ante * 2 <= left ? bets.ante : 0;
  left -= ante * 2;
  const pairPlus = bets.pairPlus <= left ? bets.pairPlus : 0;
  left -= pairPlus;
  const sixCard = ante > 0 && bets.sixCard <= left ? bets.sixCard : 0;
  return { ante, pairPlus, sixCard };
}

/**
 * Put last round's wagers back up.
 *
 * Through the same gates `setWager` applies, because this is the other way
 * chips reach a spot: anything outside the limits, not booked, or beyond the
 * bankroll is skipped rather than refusing the whole call, because a player
 * who has just lost most of a stack still wants the Ante back on the felt.
 */
export function rebet(table: TableState, previous: ReadonlyMap<SeatId, Wagers>): ActionResult {
  if (table.phase !== 'BETTING') return refuse('Bets are closed.');
  const rules = table.rules;
  let placed = false;

  const seats = table.seats.map((seat) => {
    const prev = previous.get(seat.id);
    if (!prev || !seat.occupied) return seat;
    const within = (amount: number, max: number, offered = true) =>
      offered && amount >= rules.minBet && amount <= max ? amount : 0;
    const wanted: Wagers = {
      ante: within(prev.ante, rules.maxBet),
      pairPlus: within(prev.pairPlus, rules.maxPairPlus, rules.pairPlus),
      sixCard: within(prev.sixCard, rules.maxSixCard, rules.sixCard),
    };
    const bets = affordable(wanted, seat.bankroll);
    if (bets.ante === 0 && bets.pairPlus === 0) return seat;
    placed = true;
    return { ...seat, bets };
  });

  return placed ? ok({ ...table, seats }) : refuse('Nothing to re-bet.');
}

/* ------------------------------------------------------------------ *
 * Seats
 * ------------------------------------------------------------------ */

export function setSeatOccupied(table: TableState, seatId: SeatId, occupied: boolean): ActionResult {
  if (table.phase !== 'BETTING') return refuse('Wait for the round to finish.');
  if (!occupied && table.seats.filter((s) => s.occupied).length === 1) {
    return refuse('Somebody has to be at the table.');
  }
  return ok(
    updateSeat(table, seatId, (s) => ({ ...s, occupied, bets: occupied ? s.bets : { ...NO_WAGERS } })),
  );
}

export function renameSeat(table: TableState, seatId: SeatId, name: string): ActionResult {
  const trimmed = name.trim().slice(0, 16);
  return ok(updateSeat(table, seatId, (s) => ({ ...s, name: trimmed || `Seat ${seatId}` })));
}

/** Top a seat back up. A rebuy is new money, not a win, so it lifts the peak with it. */
export function rebuy(table: TableState, seatId: SeatId, amount: number): ActionResult {
  if (table.phase !== 'BETTING') return refuse('Wait for the round to finish.');
  if (amount <= 0) return refuse('A rebuy has to be positive.');
  return ok(
    updateSeat(table, seatId, (s) => {
      const bankroll = s.bankroll + amount;
      return { ...s, bankroll, stats: { ...s.stats, peakBankroll: Math.max(s.stats.peakBankroll, bankroll) } };
    }),
  );
}

/**
 * Record that a seat made a decision, whether it was the better one, and what
 * the worse one cost in expected value.
 *
 * An engine action rather than a store mutation for the ordinary reason: the
 * store does not reach into table state on its own.
 */
export function recordDecision(table: TableState, seatId: SeatId, correct: boolean, evGivenUp: number): TableState {
  return updateSeat(table, seatId, (seat) => ({
    ...seat,
    stats: {
      ...seat.stats,
      decisions: seat.stats.decisions + 1,
      correctDecisions: seat.stats.correctDecisions + (correct ? 1 : 0),
      evGivenUp: seat.stats.evGivenUp + Math.max(0, Math.round(evGivenUp)),
    },
  }));
}

/* ------------------------------------------------------------------ *
 * The deal
 * ------------------------------------------------------------------ */

/**
 * Shuffle a fresh deck and deal the round.
 *
 * The machine dispenses stacks of three, and the dealer hands them out the way
 * the rule sheet describes: the first to the seat on their left, then around
 * the table, and their own last. Every chip on the felt leaves its bankroll
 * here.
 */
export function deal(table: TableState, rng: Rng): ActionResult {
  if (table.phase !== 'BETTING') return refuse('The cards are already out.');
  return dealFrom(table, shuffledDeck(rng));
}

/**
 * The deal, from a deck already in order.
 *
 * Everything `deal` does after the shuffle. It is its own export so a test can
 * say "seat A gets Q-6-4 and the dealer gets a pair of kings" by stacking the
 * deck, rather than by searching for a seed that happens to deal it — which is
 * how every settlement branch below is pinned. The game itself only ever
 * reaches it through `deal`.
 */
export function dealFrom(table: TableState, deck: readonly Card[]): ActionResult {
  if (table.phase !== 'BETTING') return refuse('The cards are already out.');
  const playing = playingSeats(table);
  if (playing.length === 0) return refuse('No wagers on the felt.');

  /*
   * The last gate before money moves. `setWager` refuses everything below, and
   * `setRules` reconciles the chips it disturbs — but this is the function that
   * subtracts, and one door left open upstream, or one hand-edited saved
   * session, would otherwise deal a seat on money it does not have.
   */
  for (const seat of playing) {
    const b = seat.bets;
    if (b.sixCard > 0 && b.ante === 0) return refuse(`${seat.name}: the 6 Card Bonus needs an Ante under it.`);
    if (b.pairPlus > 0 && !table.rules.pairPlus) return refuse('This table does not book Pair Plus.');
    if (b.sixCard > 0 && !table.rules.sixCard) return refuse('This table does not book the 6 Card Bonus.');
    if (coverNeeded(b) > seat.bankroll) {
      return refuse(`${seat.name} has ${centsLabel(seat.bankroll)} and needs ${centsLabel(coverNeeded(b))} to cover the bets and the Play.`);
    }
  }

  if (deck.length < (playing.length + 1) * 3) return refuse('The machine is short of cards.');
  let next = 0;
  const stack = () => {
    const cards = deck.slice(next, next + 3);
    next += 3;
    return cards;
  };
  const hands = new Map(playing.map((seat) => [seat.id, stack()]));
  const dealerCards = stack();

  const seats = table.seats.map((seat): Seat => {
    const cards = hands.get(seat.id);
    if (!cards) {
      return { ...seat, cards: [], wagers: { ...NOTHING_RIDING }, decision: null, result: null };
    }
    const b = seat.bets;
    const category = evaluate3(cards).category;
    return {
      ...seat,
      bankroll: seat.bankroll - b.ante - b.pairPlus - b.sixCard,
      cards,
      wagers: { ...b, play: 0 },
      decision: null,
      result: null,
      stats: {
        ...seat.stats,
        rounds: seat.stats.rounds + 1,
        hands: seat.stats.hands + (b.ante > 0 ? 1 : 0),
        anteStaked: seat.stats.anteStaked + b.ante,
        pairPlusWagered: seat.stats.pairPlusWagered + b.pairPlus,
        sixCardWagered: seat.stats.sixCardWagered + b.sixCard,
        categories: { ...seat.stats.categories, [category]: seat.stats.categories[category] + 1 },
      },
    };
  });

  return ok(
    openDecisions({
      ...table,
      seats,
      dealer: { cards: dealerCards, revealed: false },
      round: table.round + 1,
      settled: false,
      phase: 'DECIDING',
      focus: null,
    }),
  );
}

/**
 * Point the table at the next seat with a decision to make, or move on.
 *
 * Seats are asked in order, and a seat with only Pair Plus on the felt has no
 * decision to make — so a table of Pair Plus bettors goes straight to the
 * showdown, rather than sitting in DECIDING with nobody to wait for.
 */
function openDecisions(table: TableState): TableState {
  const next = table.seats.find((s) => s.cards.length === 3 && s.wagers.ante > 0 && s.decision === null);
  return next ? { ...table, phase: 'DECIDING', focus: next.id } : { ...table, phase: 'SHOWDOWN', focus: null };
}

/* ------------------------------------------------------------------ *
 * Play or fold
 * ------------------------------------------------------------------ */

/**
 * What the seat in focus may do, and what to say when it may not.
 *
 * One call, so the button bar and the advisor read the same answer.
 */
export function legalDecisions(table: TableState): Record<Decision, Legality> {
  const none = { allowed: false, reason: 'It is not your turn.' };
  if (table.phase !== 'DECIDING' || !table.focus) return { PLAY: none, FOLD: none };
  const seat = table.seats.find((s) => s.id === table.focus);
  if (!seat || seat.cards.length !== 3 || seat.wagers.ante === 0 || seat.decision !== null) {
    return { PLAY: none, FOLD: none };
  }
  return {
    // Unreachable with the reserve `setWager` and `deal` enforce, and kept
    // for a restored session that predates them.
    PLAY: seat.bankroll >= seat.wagers.ante ? { allowed: true } : { allowed: false, reason: 'Not enough bankroll to match the Ante.' },
    FOLD: { allowed: true },
  };
}

/**
 * Play or fold the hand in focus.
 *
 * Playing puts a second stake the size of the Ante on the Play spot. Folding
 * moves no money at all — the Ante and any Pair Plus left the bankroll at the
 * deal, and a fold simply means `settle` will not give them back. The 6 Card
 * Bonus stays in action either way: the rule sheet is explicit that a fold
 * does not forfeit it.
 */
export function decide(table: TableState, decision: Decision): ActionResult {
  const legal = legalDecisions(table)[decision];
  if (!legal.allowed) return refuse(legal.reason ?? 'Not allowed.');
  const id = table.focus!;

  const next = updateSeat(table, id, (seat) =>
    decision === 'PLAY'
      ? {
          ...seat,
          decision,
          bankroll: seat.bankroll - seat.wagers.ante,
          wagers: { ...seat.wagers, play: seat.wagers.ante },
          stats: { ...seat.stats, plays: seat.stats.plays + 1, playWagered: seat.stats.playWagered + seat.wagers.ante },
        }
      : { ...seat, decision, stats: { ...seat.stats, folds: seat.stats.folds + 1 } },
  );
  return ok(openDecisions(next));
}

/* ------------------------------------------------------------------ *
 * The showdown
 * ------------------------------------------------------------------ */

/** Turn the dealer's hand over. Settlement is the next step, in resolve.ts. */
export function revealDealer(table: TableState): ActionResult {
  if (table.phase !== 'SHOWDOWN') return refuse('Not everybody has decided.');
  return ok({ ...table, dealer: { ...table.dealer, revealed: true }, phase: 'SETTLE' });
}

/* ------------------------------------------------------------------ *
 * Between rounds
 * ------------------------------------------------------------------ */

/**
 * Clear the felt and open betting again.
 *
 * The wagers stay up so "same bet" is the default — but anything the bankroll
 * can no longer cover comes down, by {@link affordable}'s priorities, rather
 * than being left as a bet the deal would refuse.
 */
export function nextRound(table: TableState): ActionResult {
  if (table.phase !== 'SETTLE') return refuse('The round is still live.');
  if (!table.settled) return refuse('The round has not been paid.');
  return ok({
    ...table,
    seats: table.seats.map((seat) => ({
      ...seat,
      bets: affordable(seat.bets, seat.bankroll),
      cards: [],
      wagers: { ...NOTHING_RIDING },
      decision: null,
      result: null,
    })),
    dealer: { cards: [], revealed: false },
    focus: null,
    phase: 'BETTING',
    settled: false,
  });
}

/**
 * Abandon a round in flight and clear the felt.
 *
 * There is no honest way to resume a half-played round from a reload: the
 * driver's timers are gone and the money is half committed. So whatever is
 * still at risk goes back to the bankrolls and the table returns to betting.
 *
 * `settled` decides whether anything is owed. The UI holds a finished round on
 * the felt for a couple of seconds so the figures can be read, and during that
 * window the wagers are still on the seat even though `settle` has already
 * returned every stake. The blackjack table next door refunded them a second
 * time during that window before its fourth round of review caught it; this
 * one checks from the start.
 */
export function abandonRound(table: TableState): TableState {
  if (table.phase === 'BETTING') return table;
  const owed = !table.settled;
  return {
    ...table,
    phase: 'BETTING',
    focus: null,
    settled: false,
    dealer: { cards: [], revealed: false },
    seats: table.seats.map((seat) => {
      const w = seat.wagers;
      const refund = owed ? w.ante + w.play + w.pairPlus + w.sixCard : 0;
      const bankroll = seat.bankroll + refund;
      return {
        ...seat,
        bankroll,
        bets: affordable(seat.bets, bankroll),
        cards: [],
        wagers: { ...NOTHING_RIDING },
        decision: null,
        result: null,
      };
    }),
  };
}

/**
 * Change the table's rules, and reconcile the chips already on the felt.
 *
 * This is the one door into a wager that does not go through `setWager`, so
 * it ends with the same invariants: a bet the table no longer books comes
 * down, every wager sits inside the new limits, and what is left fits the
 * bankroll with the Play reserve. A seat whose chips will not fit is cleared
 * down to what does, and the note says so.
 */
export function setRules(table: TableState, rules: TableRules): ActionResult {
  if (table.phase !== 'BETTING') return refuse('Wait for the round to finish.');
  let trimmed = false;
  // A spot whose maximum sits below the table minimum can hold no legal bet
  // at all. The setup screen cannot build one; a saved session could.
  const clamp = (amount: number, max: number, offered: boolean) =>
    !offered || amount === 0 || max < rules.minBet ? 0 : Math.min(max, Math.max(rules.minBet, amount));

  const seats = table.seats.map((seat) => {
    const wanted: Wagers = {
      ante: clamp(seat.bets.ante, rules.maxBet, true),
      pairPlus: clamp(seat.bets.pairPlus, rules.maxPairPlus, rules.pairPlus),
      sixCard: clamp(seat.bets.sixCard, rules.maxSixCard, rules.sixCard),
    };
    const bets = affordable(wanted, seat.bankroll);
    if (seat.occupied && (bets.ante !== wanted.ante || bets.pairPlus !== wanted.pairPlus || bets.sixCard !== wanted.sixCard)) {
      trimmed = true;
    }
    return { ...seat, bets };
  });

  return ok({ ...table, rules, seats }, trimmed ? 'Some chips came down — the new limits are beyond the bankroll.' : undefined);
}
