/**
 * The table, and every legal move on it.
 *
 * This is the state machine. Each exported action takes the table and returns
 * either a new one or a refusal carrying a reason the UI shows as a toast —
 * never a thrown error, never a mutation, never a partially applied move. That
 * shape is what lets the same functions drive the felt, the autoplay bot and
 * the simulation suite: a bot physically cannot make a bet a player could not,
 * because there is no second path into the state.
 *
 * The round runs:
 *
 *   BETTING    chips into the circles
 *   DEALING    two to each seat, two to the dealer (one under ENHC)
 *   INSURANCE  the offers — insurance against an ace, and early surrender
 *   PLAYER     one hand at a time, seats left to right, splits in place
 *   DEALER     the dealer's hand, which has no decisions in it
 *   SETTLE     money has moved and the felt is showing what happened
 *
 * Settlement itself lives in resolve.ts. Nothing in this file pays anybody.
 */

import { produce } from './immer';
import {
  canDouble as mayDouble,
  canHit as mayHit,
  canSplit,
  canSplit as maySplit,
  canSurrender as maySurrender,
  dealerShouldHit,
  handValue,
  isBlackjack,
} from './hand';
import { maxInsurance } from './rules';
import { createShoe, draw, reshuffleKeeping } from './shoe';
import type { Rng } from './rng';
import {
  luckyLadiesJackpotUpgrade,
  resolveLuckyLadies,
  resolvePerfectPairs,
  resolveRoyalMatch,
  resolveSuperSevens,
  resolveTwentyOnePlusThree,
  superSevensNeedsBonus,
} from './sidebets';
import type {
  Action,
  Card,
  DealerHand,
  Focus,
  Hand,
  Seat,
  SeatId,
  ShoeState,
  SeatStats,
  SideBetKind,
  SideBetWager,
  TableRules,
  TableState,
} from './types';
import { SEAT_IDS, isAce, isTen } from './types';

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
export type ActionResult =
  | { ok: true; table: TableState; note?: string }
  | { ok: false; reason: string };

export function ok(table: TableState, note?: string): ActionResult {
  return { ok: true, table, note };
}

export function refuse(reason: string): ActionResult {
  return { ok: false, reason };
}

/**
 * Attach a new shoe to a table, outside of any immer draft.
 *
 * This is a performance seam and it is load-bearing enough to be named. When a
 * shoe is assigned *inside* a `produce`, immer's finaliser treats it as a new
 * plain value and walks it looking for nested drafts — which means walking all
 * four hundred card objects, on every action, for a field whose only change
 * was an integer. That single pattern was 84% of the simulation's runtime.
 *
 * So every action that deals a card does the dealing first, against the plain
 * shoe, and hands the result to `produce` as data. The draft never contains a
 * shoe, and the shoe is spread back on afterwards.
 */
function withShoe(table: TableState, shoe: ShoeState): TableState {
  return table.shoe === shoe ? table : { ...table, shoe };
}

/**
 * Every card currently on the felt.
 *
 * What a dealer would leave alone when gathering the discards to reshuffle:
 * the dealer's own hand, every player hand, and any side-bet bonus card lying
 * beside a circle.
 */
export function cardsInPlay(table: TableState): Card[] {
  const out: Card[] = [...table.dealer.cards];
  for (const seat of table.seats) {
    for (const hand of seat.hands) out.push(...hand.cards);
    for (const sb of seat.pendingSideBets) if (sb.bonus) out.push(sb.bonus);
  }
  return out;
}

/**
 * Make sure the shoe can deal `n` more cards, reshuffling if it cannot.
 *
 * Called before every draw. It almost never does anything — a six-deck shoe
 * cut at 75% has seventy-eight cards behind the cut card — but a single deck
 * cut at 65% leaves eighteen, and three seats splitting to four hands can want
 * more than that inside one round. It used to throw there, out of a React
 * event handler, taking the tree down mid-hand.
 */
function ensureCards(table: TableState, n: number): TableState {
  if (table.shoe.size - table.shoe.pos >= n) return table;
  return {
    ...table,
    shoe: reshuffleKeeping(table.shoe, table.rules.decks, table.rules.penetration, cardsInPlay(table)),
  };
}

/* ------------------------------------------------------------------ *
 * Structural updates
 * ------------------------------------------------------------------ */

/*
 * The moves a player makes during a round — hit, stand, double, split,
 * surrender, and the dealer's own draws — are written as explicit structural
 * updates rather than with immer.
 *
 * That is a deliberate exception to how the rest of this file is written, and
 * it is worth the inconsistency. Immer's ergonomics are excellent and its cost
 * is proportional to what a recipe *reads*: drafting a seat drafts its hands,
 * drafting a hand drafts its card array, and reading a card drafts the card.
 * A hand of blackjack reads all of that on every action, and the simulation
 * suite makes several million of them. Rewriting these six functions took a
 * measured round from 186 microseconds to well under a hundred and made the
 * house-edge suite finish in minutes instead of quarter-hours.
 *
 * The cold paths — placing a bet, sitting down, changing the rules — are still
 * immer, because they run once per round at most and the readability is free
 * there.
 */

/** Replace one seat, sharing every other seat by reference. */
function updateSeat(table: TableState, seatId: SeatId, fn: (seat: Seat) => Seat): TableState {
  return { ...table, seats: table.seats.map((s) => (s.id === seatId ? fn(s) : s)) };
}

/** Replace one hand within a seat, sharing the rest. */
function updateHand(seat: Seat, index: number, fn: (hand: Hand) => Hand): Seat {
  return { ...seat, hands: seat.hands.map((h, i) => (i === index ? fn(h) : h)) };
}

/* ------------------------------------------------------------------ *
 * Construction
 * ------------------------------------------------------------------ */

export const DEFAULT_BANKROLL = 100_000; // $1,000 in cents.

let handSeq = 0;

/** Hand ids only need to be unique within a session; React keys off them. */
function nextHandId(): string {
  return `h${++handSeq}`;
}

/** Exported for the tests, which want deterministic ids across runs. */
export function resetHandIds(): void {
  handSeq = 0;
}

function emptyStats(bankroll: number): SeatStats {
  return {
    handsPlayed: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    blackjacks: 0,
    busts: 0,
    surrenders: 0,
    doubles: 0,
    splits: 0,
    wagered: 0,
    sideWagered: 0,
    sideNet: 0,
    insuranceNet: 0,
    net: 0,
    peakBankroll: bankroll,
    decisions: 0,
    correctDecisions: 0,
  };
}

export function createSeat(id: SeatId, occupied: boolean, bankroll = DEFAULT_BANKROLL): Seat {
  return {
    id,
    occupied,
    name: `Seat ${id}`,
    bankroll,
    pendingBet: 0,
    pendingSideBets: [],
    hands: [],
    insurance: 0,
    insuranceNet: null,
    tookEvenMoney: false,
    stats: emptyStats(bankroll),
  };
}

export function createTable(
  rules: TableRules,
  rng: Rng,
  options: { seats?: number; bankroll?: number } = {},
): TableState {
  const count = Math.min(SEAT_IDS.length, Math.max(1, options.seats ?? 1));
  return {
    rules,
    shoe: createShoe(rules.decks, rules.penetration, rng),
    seats: SEAT_IDS.map((id, i) => createSeat(id, i < count, options.bankroll ?? DEFAULT_BANKROLL)),
    dealer: { cards: [], holeDown: true, outcome: null },
    phase: 'BETTING',
    focus: null,
    round: 0,
    settled: false,
    history: [],
  };
}

function newHand(bet: number, splitDepth = 0, fromSplitAces = false, cards: Card[] = []): Hand {
  return {
    id: nextHandId(),
    cards,
    bet,
    baseBet: bet,
    splitDepth,
    fromSplitAces,
    done: false,
    doubled: false,
    surrendered: false,
    outcome: null,
    net: 0,
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

/** Every seat with a wager in the circle. */
export function bettingSeats(table: TableState): Seat[] {
  return table.seats.filter((s) => s.occupied && s.pendingBet > 0);
}

/* ------------------------------------------------------------------ *
 * Betting
 * ------------------------------------------------------------------ */

/**
 * Put a wager in a betting circle.
 *
 * `amount` is the whole new wager, not an increment — the chip rack adds to
 * the current value and calls this with the sum, so a mis-click can be undone
 * by setting it back rather than by a separate "remove chip" path. Zero clears
 * the circle.
 */
export function setBet(table: TableState, seatId: SeatId, amount: number): ActionResult {
  if (table.phase !== 'BETTING') return refuse('Bets are closed.');
  const seat = seatOf(table, seatId);
  if (!seat.occupied) return refuse('That seat is empty.');
  if (amount < 0) return refuse('A bet cannot be negative.');
  if (amount > 0 && amount < table.rules.minBet) {
    return refuse(`The table minimum is ${centsLabel(table.rules.minBet)}.`);
  }
  if (amount > table.rules.maxBet) {
    return refuse(`The table maximum is ${centsLabel(table.rules.maxBet)}.`);
  }
  const sideTotal = seat.pendingSideBets.reduce((n, sb) => n + sb.amount, 0);
  if (amount + sideTotal > seat.bankroll) return refuse('That is more than the bankroll.');

  return ok(
    produce(table, (d) => {
      const s = d.seats.find((x) => x.id === seatId)!;
      s.pendingBet = amount;
      /*
       * A side bet may not exceed the wager on the hand, and lowering the
       * wager has to enforce that as much as raising the side bet does.
       * Without this, betting $100 with $100 on Lucky Ladies and then dropping
       * the hand to $5 leaves a 17.6% bet twenty times the size of a 0.5% one
       * — which is exactly the shape the cap exists to prevent. Clearing the
       * circle takes the side bets down with it, rather than leaving chips on
       * the felt that the deal would silently ignore.
       */
      if (amount === 0) s.pendingSideBets = [];
      else s.pendingSideBets = s.pendingSideBets.map((sb) => (sb.amount > amount ? { ...sb, amount } : sb));
    }),
  );
}

/**
 * Put a wager on a side bet circle.
 *
 * Capped at the main wager, which is the standard table rule and also the only
 * thing stopping a player from turning a 0.5% game into a 17% one by betting
 * the Lucky Ladies circle and a nickel on the hand.
 */
export function setSideBet(
  table: TableState,
  seatId: SeatId,
  kind: SideBetKind,
  amount: number,
): ActionResult {
  if (table.phase !== 'BETTING') return refuse('Bets are closed.');
  if (!table.rules.sideBets[kind]) return refuse('This table does not book that bet.');
  const seat = seatOf(table, seatId);
  if (!seat.occupied) return refuse('That seat is empty.');
  if (amount < 0) return refuse('A bet cannot be negative.');
  if (amount > 0 && seat.pendingBet === 0) {
    return refuse('A side bet needs a wager on the hand first.');
  }
  if (amount > seat.pendingBet) return refuse('A side bet cannot exceed the main wager.');

  const others = seat.pendingSideBets
    .filter((sb) => sb.kind !== kind)
    .reduce((n, sb) => n + sb.amount, 0);
  if (seat.pendingBet + others + amount > seat.bankroll) {
    return refuse('That is more than the bankroll.');
  }

  return ok(
    produce(table, (d) => {
      const s = d.seats.find((x) => x.id === seatId)!;
      s.pendingSideBets = s.pendingSideBets.filter((sb) => sb.kind !== kind);
      if (amount > 0) s.pendingSideBets.push({ kind, amount, net: null, label: null, jackpot: null, bonus: null });
    }),
  );
}

export function clearBets(table: TableState, seatId?: SeatId): ActionResult {
  if (table.phase !== 'BETTING') return refuse('Bets are closed.');
  return ok(
    produce(table, (d) => {
      for (const s of d.seats) {
        if (seatId && s.id !== seatId) continue;
        s.pendingBet = 0;
        s.pendingSideBets = [];
      }
    }),
  );
}

/**
 * Put the last round's wagers back up.
 *
 * Skips anything the bankroll can no longer cover rather than refusing the
 * whole call, because a player who has just lost most of a stack still wants
 * the main bet back on the felt.
 */
export function rebet(table: TableState, previous: Map<SeatId, { main: number; side: SideBetWager[] }>): ActionResult {
  if (table.phase !== 'BETTING') return refuse('Bets are closed.');
  let placed = false;
  const next = produce(table, (d) => {
    for (const s of d.seats) {
      const prev = previous.get(s.id);
      if (!prev || !s.occupied || prev.main === 0) continue;
      if (prev.main > s.bankroll || prev.main > d.rules.maxBet) continue;
      s.pendingBet = prev.main;
      s.pendingSideBets = [];
      let spent = prev.main;
      for (const sb of prev.side) {
        if (!d.rules.sideBets[sb.kind]) continue;
        if (spent + sb.amount > s.bankroll) continue;
        s.pendingSideBets.push({ kind: sb.kind, amount: sb.amount, net: null, label: null, jackpot: null, bonus: null });
        spent += sb.amount;
      }
      placed = true;
    }
  });
  return placed ? ok(next) : refuse('Nothing to re-bet.');
}

function centsLabel(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
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
    produce(table, (d) => {
      const s = d.seats.find((x) => x.id === seatId)!;
      s.occupied = occupied;
      if (!occupied) {
        s.pendingBet = 0;
        s.pendingSideBets = [];
      }
    }),
  );
}

export function renameSeat(table: TableState, seatId: SeatId, name: string): ActionResult {
  const trimmed = name.trim().slice(0, 16);
  return ok(
    produce(table, (d) => {
      d.seats.find((x) => x.id === seatId)!.name = trimmed || `Seat ${seatId}`;
    }),
  );
}

/**
 * Record that a seat made a decision, and whether it matched the chart.
 *
 * The trainer's rolling list of graded plays lives in the store and is thrown
 * away on reload, which is right for a feed of recent mistakes and wrong for
 * "how well am I playing". This is the lifetime tally, and it lives on the
 * seat because it belongs to the player rather than to the session.
 *
 * It is an engine action rather than a store mutation for the ordinary reason:
 * the store does not reach into table state on its own.
 */
export function recordDecision(table: TableState, seatId: SeatId, correct: boolean): TableState {
  return updateSeat(table, seatId, (seat) => ({
    ...seat,
    stats: {
      ...seat.stats,
      decisions: seat.stats.decisions + 1,
      correctDecisions: seat.stats.correctDecisions + (correct ? 1 : 0),
    },
  }));
}

/** Top a seat back up after it has been busted out. */
export function rebuy(table: TableState, seatId: SeatId, amount: number): ActionResult {
  if (table.phase !== 'BETTING') return refuse('Wait for the round to finish.');
  if (amount <= 0) return refuse('A rebuy has to be positive.');
  return ok(
    produce(table, (d) => {
      const s = d.seats.find((x) => x.id === seatId)!;
      s.bankroll += amount;
      // A rebuy is new money, not a win: it lifts the peak so the drawdown
      // chart measures from the top of the stack the player actually held.
      s.stats.peakBankroll = Math.max(s.stats.peakBankroll, s.bankroll);
    }),
  );
}

/* ------------------------------------------------------------------ *
 * The deal
 * ------------------------------------------------------------------ */

/**
 * Deal the round.
 *
 * The order is the real one and it matters for the seeded tests: one card to
 * each seat left to right, one to the dealer, a second to each seat, then the
 * dealer's second — face down under PEEK, not dealt at all under ENHC.
 *
 * Immediately afterwards the side bets that read only the dealt cards resolve.
 * That is not an optimisation; it is when they resolve at a table. Only Bust
 * It, which is a bet on the dealer's finished hand, stays live.
 */
export function deal(table: TableState, rng: Rng): ActionResult {
  if (table.phase !== 'BETTING') return refuse('The cards are already out.');
  const playing = bettingSeats(table);
  if (playing.length === 0) return refuse('No wagers on the felt.');

  /*
   * The last gate before money moves. `setBet` and `setSideBet` both refuse a
   * wager larger than the bankroll, and `setRules` now reconciles the chips it
   * disturbs — but this is the function that actually subtracts, and it used
   * to subtract whatever it found. One door left open anywhere upstream, or
   * one hand-edited persisted table, and a seat played on money it did not
   * have. A refusal here costs a sentence; not having it cost a negative
   * bankroll.
   */
  for (const seat of playing) {
    const side = seat.pendingSideBets.reduce((n, sb) => n + sb.amount, 0);
    if (seat.pendingBet + side > seat.bankroll) {
      return refuse(`${seat.name} has ${centsLabel(seat.bankroll)} and ${centsLabel(seat.pendingBet + side)} on the felt.`);
    }
  }

  /*
   * Everything that comes off the shoe comes off it here, before the draft
   * opens — see `withShoe`. The order is the real one and it matters for the
   * seeded tests: one card to each seat left to right, one to the dealer, a
   * second to each seat, then the dealer's second — face down under PEEK, not
   * dealt at all under ENHC.
   */

  /*
   * Reshuffle before the deal rather than after the last round: a player
   * should see the new shoe go in before they bet into it.
   *
   * The second condition is the belt to that brace. The cut card guarantees at
   * least fifteen cards behind it, and a full deal for three seats wants two
   * each, two for the dealer and up to one Super Sevens bonus apiece — eleven.
   * That fits, but it fits by four, and nothing else in the file should have
   * to know that. Nothing is in play here, so a plain fresh shoe is right.
   */
  const needed = playing.length * 3 + 2;
  let shoe = table.shoe;
  if (shoe.cutReached || shoe.size - shoe.pos < needed) {
    shoe = createShoe(table.rules.decks, table.rules.penetration, rng, shoe.shuffleId + 1);
  }

  const take = (): Card => {
    const step = draw(shoe);
    shoe = step.shoe;
    return step.card;
  };

  const seatCards: Card[][] = playing.map(() => []);
  for (const cards of seatCards) cards.push(take());
  const dealerCards: Card[] = [take()];
  for (const cards of seatCards) cards.push(take());
  if (table.rules.holeCard === 'PEEK') dealerCards.push(take());

  /*
   * Two sevens buys a bonus card off the shoe, face up beside the circle. It
   * is a real card and it really leaves the shoe, which is why it is drawn
   * here in dealing order rather than conjured during settlement.
   */
  const bonus = new Map<SeatId, Card>();
  playing.forEach((seat, i) => {
    const takesBonus =
      seat.pendingSideBets.some((sb) => sb.kind === 'SUPER_SEVENS') &&
      superSevensNeedsBonus(seatCards[i]);
    if (takesBonus) bonus.set(seat.id, take());
  });

  const dealt = new Map(playing.map((seat, i) => [seat.id, seatCards[i]]));

  /*
   * Assembled as an explicit structural update rather than with immer — see
   * the note above `updateSeat`. The deal touches every seat, every hand and
   * every card, which is exactly the shape immer is most expensive on.
   */
  const seats = table.seats.map((seat) => {
    const cards = dealt.get(seat.id);

    // Seats sitting the round out hold no cards and no stale settlement.
    if (!cards) {
      return {
        ...seat,
        hands: [],
        pendingSideBets: [],
        insurance: 0,
        insuranceNet: null,
        tookEvenMoney: false,
      };
    }

    let bankroll = seat.bankroll - seat.pendingBet;
    let net = seat.stats.net;
    let sideNet = seat.stats.sideNet;
    let sideWagered = seat.stats.sideWagered;

    const pendingSideBets = seat.pendingSideBets.map((sb) => {
      bankroll -= sb.amount;
      sideWagered += sb.amount;

      const result = gradeSideBet(sb.kind, cards, dealerCards[0], bonus.get(seat.id), sb.amount);
      // Bust It is a bet on the dealer's finished hand; it stays live.
      if (result === null) return { ...sb, net: null, label: null, jackpot: null, bonus: null };

      const settled = result.net > 0 ? result.net : -sb.amount;
      if (result.net > 0) bankroll += result.net + sb.amount; // winnings plus the stake
      net += settled;
      sideNet += settled;
      // Recorded now, while the cards it was graded on are still the hand.
      const jackpot =
        sb.kind === 'LUCKY_LADIES' ? luckyLadiesJackpotUpgrade(cards, sb.amount) || null : null;
      return { ...sb, net: settled, label: result.label, jackpot, bonus: bonus.get(seat.id) ?? null };
    });

    return {
      ...seat,
      hands: [newHand(seat.pendingBet, 0, false, cards)],
      pendingSideBets,
      insurance: 0,
      insuranceNet: null,
      tookEvenMoney: false,
      bankroll,
      stats: {
        ...seat.stats,
        wagered: seat.stats.wagered + seat.pendingBet,
        handsPlayed: seat.stats.handsPlayed + 1,
        sideWagered,
        sideNet,
        net,
      },
    };
  });

  const next: TableState = {
    ...table,
    round: table.round + 1,
    settled: false,
    dealer: { cards: dealerCards, holeDown: true, outcome: null },
    seats,
    phase: 'DEALING',
    focus: null,
  };

  // A natural is finished the moment it exists, so it is marked before the
  // round decides where to go. Every turn-order function downstream can then
  // ask only `hand.done`.
  const marked = markNaturals(next);
  const opening = openingPhase(marked);
  const started: TableState =
    opening === 'INSURANCE'
      ? // The focus is set for the offers too: early surrender is a per-hand
        // decision taken here, and the button bar reads the focus.
        { ...marked, phase: 'INSURANCE', focus: firstLiveFocus(marked) }
      : opening === 'DEALER'
        ? { ...marked, phase: 'DEALER', focus: null }
        : openPlayerPhase(marked);

  return ok(withShoe(started, shoe));
}

/**
 * Grade one side bet against the cards just dealt.
 *
 * Returns `null` for a bet that cannot be decided yet — which is Bust It and
 * only Bust It, because it is a bet on a hand the dealer has not played.
 */
function gradeSideBet(
  kind: SideBetKind,
  cards: readonly Card[],
  upcard: Card | undefined,
  bonus: Card | undefined,
  amount: number,
): { net: number; label: string | null } | null {
  switch (kind) {
    case 'PERFECT_PAIRS':
      return resolvePerfectPairs(cards, amount);
    case 'TWENTY_ONE_PLUS_THREE':
      return resolveTwentyOnePlusThree(cards, upcard, amount);
    case 'ROYAL_MATCH':
      return resolveRoyalMatch(cards, amount);
    case 'LUCKY_LADIES':
      // The 1000:1 line needs the dealer's natural, which under ENHC is not
      // known yet and under PEEK is face down. It is settled at the 200:1 line
      // here and upgraded in resolve.ts if it lands.
      return resolveLuckyLadies(cards, amount, false);
    case 'SUPER_SEVENS':
      return resolveSuperSevens(cards, bonus, amount);
    case 'BUST_IT':
      return null;
  }
}

/**
 * Where the round goes after the cards are out.
 *
 * The insurance phase carries two offers, not one. Insurance itself needs a
 * dealer ace. Early surrender — the rule that lets a hand be folded *before*
 * the dealer peeks, which is why it is worth eight times what late surrender
 * is worth — needs a ten or an ace. Either opens the phase.
 */
function openingPhase(table: TableState): TableState['phase'] {
  const up = table.dealer.cards[0];
  if (!up) return 'PLAYER';
  const insuranceOpen = table.rules.insurance && isAce(up);
  const earlyOpen = table.rules.surrender === 'EARLY' && (isAce(up) || isTen(up));
  if (insuranceOpen || earlyOpen) return 'INSURANCE';
  return afterOffers(table);
}

/**
 * The dealer's peek, and where the round lands after it.
 *
 * Under PEEK the hole card is checked against a ten or an ace right now; a
 * natural ends the round before a single decision is made, which is exactly
 * the protection ENHC removes.
 */
function afterOffers(table: TableState): TableState['phase'] {
  if (table.rules.holeCard === 'PEEK' && isBlackjack(table.dealer.cards)) return 'DEALER';
  return 'PLAYER';
}

/* ------------------------------------------------------------------ *
 * Offers
 * ------------------------------------------------------------------ */

/**
 * Take insurance, at up to half the wager.
 *
 * Insurance is a 2:1 bet that the hole card is a ten, and about 30.8% of the
 * cards in a fresh shoe are tens, so it is a 7.4% house edge dressed up as
 * protection. The HUD says so when the counting trainer is on, because the one
 * time it is a *good* bet is a true count above +3 and that is the whole
 * reason anybody learns to count.
 */
export function takeInsurance(table: TableState, seatId: SeatId, amount: number): ActionResult {
  if (table.phase !== 'INSURANCE') return refuse('Insurance is not open.');
  if (!table.rules.insurance) return refuse('This table does not offer insurance.');
  if (!isAce(table.dealer.cards[0])) return refuse('Insurance needs a dealer ace.');
  const seat = seatOf(table, seatId);
  if (seat.hands.length === 0) return refuse('That seat is not in the round.');
  if (seat.insurance > 0) return refuse('Insurance is already down.');

  const cap = maxInsurance(seat.hands[0].bet);
  if (amount <= 0) return refuse('Insurance has to be positive.');
  if (amount > cap) return refuse(`Insurance is capped at half the wager, ${centsLabel(cap)}.`);
  if (amount > seat.bankroll) return refuse('That is more than the bankroll.');

  return ok(
    produce(table, (d) => {
      const s = d.seats.find((x) => x.id === seatId)!;
      s.insurance = amount;
      s.bankroll -= amount;
    }),
  );
}

/**
 * Even money.
 *
 * A natural against a dealer ace, paid 1:1 immediately instead of 3:2 with a
 * push if the dealer also has one. It is arithmetically identical to insuring
 * the natural for the maximum, which is why it is implemented as exactly that
 * and not as a separate payout path.
 */
export function takeEvenMoney(table: TableState, seatId: SeatId): ActionResult {
  if (table.phase !== 'INSURANCE') return refuse('The offer is not open.');
  if (!table.rules.insurance) return refuse('This table does not offer insurance.');
  if (!isAce(table.dealer.cards[0])) return refuse('Even money needs a dealer ace.');

  /*
   * Even money exists only at three to two, and that is arithmetic rather
   * than convention. Insuring a natural for `x` returns `2x` on a dealer
   * natural (the hand pushes) and `p - x` otherwise, where `p` is the
   * blackjack payout. Guaranteeing exactly 1 requires x = 1/2 from the first
   * and x = p - 1 from the second, and those agree only when p = 3/2.
   *
   * At six to five there is no stake that makes the offer even money, so the
   * table does not make it. Insurance itself is still available: it is a
   * different bet and a player with a natural may take it like anyone else.
   */
  if (table.rules.blackjackPays !== '3:2') {
    return refuse('Even money only works at 3:2. Insurance is still open.');
  }

  const seat = seatOf(table, seatId);
  const hand = seat.hands[0];
  if (!hand || !isBlackjack(hand.cards)) return refuse('Even money needs a blackjack.');
  if (seat.insurance > 0) return refuse('Insurance is already down.');
  const cap = maxInsurance(hand.bet);
  if (cap > seat.bankroll) return refuse('Not enough bankroll to cover it.');

  return ok(
    produce(table, (d) => {
      const s = d.seats.find((x) => x.id === seatId)!;
      s.insurance = cap;
      s.tookEvenMoney = true;
      s.bankroll -= cap;
    }),
    'Even money.',
  );
}

/**
 * Close the offers and let the dealer peek.
 *
 * Called once, by whoever is driving the round, after every seat has decided.
 */
export function closeOffers(table: TableState): ActionResult {
  if (table.phase !== 'INSURANCE') return refuse('The offers are not open.');
  if (afterOffers(table) === 'DEALER') {
    return ok({ ...table, phase: 'DEALER', focus: null });
  }
  return ok(openPlayerPhase(table));
}

/* ------------------------------------------------------------------ *
 * Playing a hand
 * ------------------------------------------------------------------ */

/**
 * What the focused hand may do, and what to say when it may not.
 *
 * One call, so the button bar and the strategy advisor read the same answer.
 */
export function legalActions(table: TableState): Record<Action, { allowed: boolean; reason?: string }> {
  const blank = { allowed: false, reason: 'It is not your turn.' };
  const none = { HIT: blank, STAND: blank, DOUBLE: blank, SPLIT: blank, SURRENDER: blank };
  if (!table.focus) return none;
  if (table.phase !== 'PLAYER' && table.phase !== 'INSURANCE') return none;

  const seat = seatOf(table, table.focus.seat);
  const hand = seat.hands[table.focus.hand];
  if (!hand) return none;

  // During the offers only early surrender is live; nothing else is yet.
  if (table.phase === 'INSURANCE') {
    const early =
      table.rules.surrender === 'EARLY'
        ? maySurrender(hand, table.rules)
        : { allowed: false, reason: 'This table does not offer early surrender.' };
    return { HIT: blank, STAND: blank, DOUBLE: blank, SPLIT: blank, SURRENDER: early };
  }

  return {
    HIT: mayHit(hand, table.rules),
    STAND: mayStand(hand),
    DOUBLE: mayDouble(hand, table.rules, seat.bankroll),
    SPLIT: maySplit(hand, seat.hands.length, table.rules, seat.bankroll),
    SURRENDER: maySurrender(hand, table.rules),
  };
}

function mayStand(hand: Hand) {
  return hand.done ? { allowed: false, reason: 'This hand has finished.' } : { allowed: true };
}

/** Take a card. Busting or reaching 21 finishes the hand on the spot. */
export function hit(table: TableState): ActionResult {
  const check = requireFocus(table, 'HIT');
  if (!check.ok) return check;

  const focus = table.focus!;
  const t = ensureCards(table, 1);
  const step = draw(t.shoe);

  let busted = false;
  const next = updateSeat(t, focus.seat, (seat) => {
    const updated = updateHand(seat, focus.hand, (hand) => {
      const cards = [...hand.cards, step.card];
      const v = handValue(cards);
      busted = v.busted;
      return {
        ...hand,
        cards,
        // Twenty-one finishing the hand is not a rule but a courtesy: no card
        // improves it, so the table moves on rather than making the player say
        // stand.
        done: v.busted || v.total >= 21,
        outcome: v.busted ? 'BUST' : hand.outcome,
      };
    });
    return busted
      ? { ...updated, stats: { ...updated.stats, busts: updated.stats.busts + 1 } }
      : updated;
  });

  return ok(settleFocus(withShoe(next, step.shoe)));
}

export function stand(table: TableState): ActionResult {
  const check = requireFocus(table, 'STAND');
  if (!check.ok) return check;

  const focus = table.focus!;
  const next = updateSeat(table, focus.seat, (seat) =>
    updateHand(seat, focus.hand, (hand) => ({ ...hand, done: true })),
  );
  return ok(settleFocus(next));
}

/**
 * Double down: match the wager, take exactly one card, and stop.
 *
 * The extra chips come out of the bankroll here and the hand's `bet` doubles,
 * so the settlement path needs to know nothing about doubling at all — it
 * simply pays the bet that is on the hand.
 */
export function double(table: TableState): ActionResult {
  const check = requireFocus(table, 'DOUBLE');
  if (!check.ok) return check;

  const focus = table.focus!;
  const t = ensureCards(table, 1);
  const step = draw(t.shoe);

  const next = updateSeat(t, focus.seat, (seat) => {
    const hand = seat.hands[focus.hand];
    const cards = [...hand.cards, step.card];
    const busted = handValue(cards).busted;
    const doubled: Hand = {
      ...hand,
      cards,
      bet: hand.bet + hand.baseBet,
      doubled: true,
      done: true,
      outcome: busted ? 'BUST' : hand.outcome,
    };
    return {
      ...seat,
      bankroll: seat.bankroll - hand.baseBet,
      hands: seat.hands.map((h, i) => (i === focus.hand ? doubled : h)),
      stats: {
        ...seat.stats,
        wagered: seat.stats.wagered + hand.baseBet,
        doubles: seat.stats.doubles + 1,
        busts: seat.stats.busts + (busted ? 1 : 0),
      },
    };
  });

  return ok(settleFocus(withShoe(next, step.shoe)));
}

/**
 * Split a pair into two hands.
 *
 * The second card moves to a new hand inserted immediately after this one, so
 * play order stays left to right through however many hands a re-split makes.
 * Each hand then draws one card, which is where split aces stop: one card
 * each and no more, at every table that is not being deliberately generous.
 */
export function split(table: TableState): ActionResult {
  const check = requireFocus(table, 'SPLIT');
  if (!check.ok) return check;

  const focus = table.focus!;
  const t = ensureCards(table, 2);
  const first = draw(t.shoe);
  const second = draw(first.shoe);

  const next = updateSeat(t, focus.seat, (seat) => {
    const hand = seat.hands[focus.hand];
    const splittingAces = isAce(hand.cards[0]);

    /*
     * Split aces take one card each and stop — unless that card is another
     * ace and the table re-splits them, in which case the hand stays live for
     * exactly one more decision. `canHit` still refuses it, so the only thing
     * a player can do with a live pair of split aces is split it again or
     * stand on the soft twelve.
     *
     * Getting this wrong makes `resplitAces` a switch that does nothing: the
     * hand was marked finished the moment it was dealt, so a third ace could
     * never be split, while the setup screen still credited the rule with
     * 0.08% and the README still advertised it.
     */
    const stops = (cards: readonly Card[]): boolean => {
      if (handValue(cards).total === 21) return true;
      if (!splittingAces || !table.rules.oneCardOnSplitAces) return false;
      /*
       * A split ace that draws another ace stays live only if the table
       * re-splits them. Whether there is *room* to split is deliberately not
       * decided here: a later split of a different hand can use the last
       * available slot, and baking the answer in at this moment left earlier
       * hands sitting live with no legal move but stand. `sealSplitAces`
       * answers it whenever the question is actually asked.
       */
      return !(isAce(cards[1]) && table.rules.resplitAces);
    };

    // The pair comes apart: the first card stays, the second starts the new
    // hand, and each takes one card as the dealer would deal them.
    const leftCards = [hand.cards[0], first.card];
    const rightCards = [hand.cards[1], second.card];

    const left: Hand = {
      ...hand,
      cards: leftCards,
      splitDepth: hand.splitDepth + 1,
      fromSplitAces: splittingAces,
      done: stops(leftCards),
    };
    const right = newHand(hand.baseBet, hand.splitDepth + 1, splittingAces, rightCards);
    right.done = stops(rightCards);

    const hands = seat.hands.slice();
    hands.splice(focus.hand, 1, left, right);

    return {
      ...seat,
      bankroll: seat.bankroll - hand.baseBet,
      hands,
      stats: {
        ...seat.stats,
        wagered: seat.stats.wagered + hand.baseBet,
        splits: seat.stats.splits + 1,
      },
    };
  });

  return ok(settleFocus(withShoe(next, second.shoe)));
}

/**
 * Surrender: fold the hand for half the wager.
 *
 * Late surrender happens here, in the player phase, after the dealer has
 * peeked — so a dealer natural has already taken the whole bet and there is
 * nothing left to fold. Early surrender is taken during the offers, before the
 * peek, which is where all of its extra value comes from.
 */
export function surrender(table: TableState): ActionResult {
  const check = requireFocus(table, 'SURRENDER');
  if (!check.ok) return check;

  const focus = table.focus!;
  const next = updateSeat(table, focus.seat, (seat) => ({
    ...updateHand(seat, focus.hand, (hand) => ({
      ...hand,
      done: true,
      surrendered: true,
      outcome: 'SURRENDER' as const,
    })),
    stats: { ...seat.stats, surrenders: seat.stats.surrenders + 1 },
  }));

  return ok(settleFocus(next));
}

function requireFocus(table: TableState, action: Action): ActionResult {
  const legal = legalActions(table)[action];
  if (!legal.allowed) return refuse(legal.reason ?? 'Not allowed.');
  return ok(table);
}

/* ------------------------------------------------------------------ *
 * Turn order
 * ------------------------------------------------------------------ */

function firstLiveFocus(table: TableState): Focus | null {
  return nextFocusFrom(table, null);
}

/**
 * The next hand that still has a decision in it.
 *
 * Walks seats in id order and hands left to right within a seat, which is
 * where a split's new hand lands because `split` inserts it in place. A hand
 * that is already twenty-one, busted, doubled or a natural is skipped, so the
 * focus never sits on something with no legal move.
 */
function nextFocusFrom(table: TableState, from: Focus | null): Focus | null {
  let started = from === null;
  for (const seat of table.seats) {
    if (!seat.occupied || seat.hands.length === 0) continue;
    for (let i = 0; i < seat.hands.length; i++) {
      if (!started) {
        if (seat.id === from!.seat && i === from!.hand) started = true;
        continue;
      }
      // `done` is sufficient: naturals are marked in enterPlayerPhase, and a
      // hand created after that can only come from a split, which is never one.
      if (seat.hands[i].done) continue;
      return { seat: seat.id, hand: i };
    }
  }
  return null;
}

/**
 * Settle the focus after a move.
 *
 * The subtlety is that most moves do *not* pass the turn. A hit that does not
 * bust leaves the same hand live and the player still deciding; a split leaves
 * the first of the two new hands live and the player deciding about that. Only
 * a move that finishes the hand hands the turn on, and only when no hand
 * anywhere is left does the round go to the dealer.
 *
 * So this asks two questions in order: is the hand in front of us still
 * playable, and if not, which is the next one that is.
 */
function settleFocus(input: TableState): TableState {
  const table = sealSplitAces(input);
  const current = table.focus;
  if (current) {
    const seat = table.seats.find((s) => s.id === current.seat);
    const hand = seat?.hands[current.hand];
    if (hand && !hand.done) return table; // still your turn
  }

  const focus = current ? nextFocusFrom(table, current) : firstLiveFocus(table);
  if (focus) return { ...table, focus };

  // The offers phase has its own exit — `closeOffers` — because the dealer has
  // not peeked yet. An early surrender that finishes the last hand must not
  // skip that peek, or a Bust It bet never resolves and, under ENHC, the
  // dealer never draws their second card.
  return { ...table, focus: null, phase: table.phase === 'PLAYER' ? 'DEALER' : table.phase };
}

/**
 * Mark every natural as finished.
 *
 * A dealt twenty-one has no decision in it, and this is the one place that
 * needs saying so — a hand created later can only come from a split, and a
 * split hand is never a natural. Marking here is what lets `settleFocus` and
 * `nextFocusFrom` ask only `hand.done`.
 *
 * Returns the same table when nothing changed, so it is free to call twice.
 */
function markNaturals(table: TableState): TableState {
  let touched = false;
  const seats = table.seats.map((seat) => {
    if (!seat.hands.some((h) => !h.done && isBlackjack(h.cards, h.splitDepth))) return seat;
    touched = true;
    return {
      ...seat,
      hands: seat.hands.map((h) =>
        !h.done && isBlackjack(h.cards, h.splitDepth) ? { ...h, done: true } : h,
      ),
    };
  });
  return touched ? { ...table, seats } : table;
}

/**
 * Finish any split-ace hand that has nothing left to decide.
 *
 * Split aces take one card each and stop. A table that re-splits them leaves a
 * pair of aces live for exactly one more decision — but only while there is
 * room under the hand limit, and another hand's split can take the last slot.
 * When that happens the hand cannot hit (split aces never can) and cannot
 * split, so standing is its only move and asking the player to make it is
 * asking them to click a button with no alternative.
 *
 * Run wherever the focus is chosen, so the answer is always current.
 */
function sealSplitAces(table: TableState): TableState {
  if (!table.rules.oneCardOnSplitAces) return table;

  let touched = false;
  const seats = table.seats.map((seat) => {
    let seatTouched = false;
    const hands = seat.hands.map((hand) => {
      if (hand.done || !hand.fromSplitAces) return hand;
      if (canSplit(hand, seat.hands.length, table.rules, seat.bankroll).allowed) return hand;
      seatTouched = true;
      touched = true;
      return { ...hand, done: true };
    });
    return seatTouched ? { ...seat, hands } : seat;
  });

  return touched ? { ...table, seats } : table;
}

/**
 * Open the player phase, or skip straight past it.
 *
 * A table of naturals has nothing to decide, and leaving the phase at PLAYER
 * with a null focus would hang the round waiting for an action nobody can take.
 */
function openPlayerPhase(table: TableState): TableState {
  const marked = sealSplitAces(markNaturals(table));
  const focus = firstLiveFocus(marked);
  return { ...marked, focus, phase: focus ? 'PLAYER' : 'DEALER' };
}

/* ------------------------------------------------------------------ *
 * The dealer's hand
 * ------------------------------------------------------------------ */

/**
 * Does the dealer have to play this out?
 *
 * Normally no: if every player hand has busted or been surrendered, the money
 * is already decided and the dealer turns the hole card without drawing. Two
 * things override that. A live Bust It bet is a bet on the dealer's finished
 * hand, so the hand has to finish. And under ENHC the dealer has only one card
 * and must at minimum draw the second, because a dealer natural takes the
 * doubles and the splits as well.
 */
export function dealerMustPlay(table: TableState): boolean {
  const live = table.seats.some((s) =>
    s.hands.some((h) => !h.surrendered && !handValue(h.cards).busted && !isBlackjack(h.cards, h.splitDepth)),
  );
  if (live) return true;
  const bustIt = table.seats.some((s) =>
    s.pendingSideBets.some((sb) => sb.kind === 'BUST_IT' && sb.net === null),
  );
  return bustIt;
}

/**
 * Turn the hole card up and take one dealer card, if one is due.
 *
 * Stepped rather than run to completion so the UI can deal the dealer's cards
 * one at a time with the same rhythm a real one has. Returns a table whose
 * phase is SETTLE once the hand is finished.
 */
export function dealerStep(table: TableState): ActionResult {
  if (table.phase !== 'DEALER') return refuse('It is not the dealer’s turn.');

  const revealing = table.dealer.holeDown;
  const needsHoleCard =
    revealing && table.rules.holeCard === 'ENHC' && table.dealer.cards.length === 1;
  const needsDraw = !revealing && dealerShouldHit(table.dealer.cards, table.rules);
  const t = needsHoleCard || needsDraw ? ensureCards(table, 1) : table;
  const step = needsHoleCard || needsDraw ? draw(t.shoe) : null;

  const cards = step ? [...table.dealer.cards, step.card] : table.dealer.cards;
  const v = handValue(cards);

  let outcome: DealerHand['outcome'] = null;
  if (revealing) {
    if (isBlackjack(cards)) outcome = 'BLACKJACK';
    // `dealerMustPlay` reads only the players' hands, which cannot change
    // during the dealer's turn, so it is asked once here rather than per card.
    else if (!dealerMustPlay(table)) outcome = v.busted ? 'BUST' : 'STAND';
  } else if (!dealerShouldHit(cards, table.rules) || v.busted) {
    outcome = v.busted ? 'BUST' : 'STAND';
  }

  const next: TableState = {
    ...t,
    dealer: { cards, holeDown: false, outcome },
    phase: outcome === null ? 'DEALER' : 'SETTLE',
  };

  return ok(step ? withShoe(next, step.shoe) : next);
}

/** Run the dealer to completion. What the simulation and fast mode use. */
export function dealerPlayOut(table: TableState): TableState {
  let t = table;
  let guard = 0;
  while (t.phase === 'DEALER') {
    const res = dealerStep(t);
    if (!res.ok) break;
    t = res.table;
    // A shoe has 52n cards and a dealer hand cannot exceed 21 low cards, so
    // this can only trip if a future change breaks the loop's exit condition.
    if (++guard > 32) throw new Error('The dealer never finished their hand.');
  }
  return t;
}

/* ------------------------------------------------------------------ *
 * Between rounds
 * ------------------------------------------------------------------ */

/**
 * Clear the felt and open betting again.
 *
 * The wagers stay where they were so that "same bet" is the default and
 * re-betting is one button rather than a rebuild — but anything the bankroll
 * can no longer cover is quietly taken down rather than left as a bet that
 * cannot be dealt.
 */
export function nextRound(table: TableState): ActionResult {
  if (table.phase !== 'SETTLE') return refuse('The round is still live.');

  return ok({
    ...table,
    seats: table.seats.map((seat) => {
      const sideTotal = seat.pendingSideBets.reduce((n, sb) => n + sb.amount, 0);
      // Anything the bankroll can no longer cover comes down rather than being
      // left as a bet that cannot be dealt.
      const affordable = seat.pendingBet + sideTotal <= seat.bankroll;
      return {
        ...seat,
        hands: [],
        insurance: 0,
        insuranceNet: null,
        tookEvenMoney: false,
        pendingBet: affordable || seat.pendingBet <= seat.bankroll ? seat.pendingBet : 0,
        pendingSideBets: affordable
          ? seat.pendingSideBets.map((sb) => ({ ...sb, net: null, label: null, jackpot: null, bonus: null }))
          : [],
      };
    }),
    dealer: { cards: [], holeDown: true, outcome: null },
    focus: null,
    phase: 'BETTING',
  });
}

/**
 * Abandon a round in flight and clear the felt.
 *
 * There is no honest way to resume a half-played round from a reload: the
 * driver's timers are gone and the money is half committed. So the chips still
 * at risk go back to the bankrolls and the table returns to betting.
 *
 * `settled` decides whether anything is owed. The UI holds a finished round on
 * the felt for a couple of seconds so the figures can be read, and during that
 * window `hand.bet` and `seat.insurance` are still populated even though
 * `settle` has already returned every stake. Refunding them again is free
 * money, which is exactly what a reload during that window used to produce.
 *
 * Lives here rather than in the store because it moves money, and everything
 * that moves money is testable engine code.
 */
export function abandonRound(table: TableState): TableState {
  if (table.phase === 'BETTING') return table;
  const owed = !table.settled;

  return {
    ...table,
    phase: 'BETTING',
    focus: null,
    settled: false,
    dealer: { cards: [], holeDown: true, outcome: null },
    seats: table.seats.map((seat) => ({
      ...seat,
      bankroll: owed
        ? seat.bankroll +
          seat.hands.reduce((n, h) => n + h.bet, 0) +
          seat.pendingSideBets.reduce((n, sb) => n + (sb.net === null ? sb.amount : 0), 0) +
          seat.insurance
        : seat.bankroll,
      hands: [],
      insurance: 0,
      insuranceNet: null,
      tookEvenMoney: false,
      // A side bet that already paid keeps its result on the felt, which on a
      // resumed session reads as a win about to be given again. The stake
      // stays up for a re-bet; the result does not.
      pendingSideBets: seat.pendingSideBets.map((sb) => ({
        ...sb,
        net: null,
        label: null,
        jackpot: null,
        bonus: null,
      })),
    })),
  };
}

/** Change the rules mid-session. Forces a fresh shoe, because it is one. */
/**
 * Change the table's rules, and reconcile the chips already on the felt.
 *
 * This is the one door into a wager that does not go through `setBet` or
 * `setSideBet`, and for four rounds of review it walked past every invariant
 * those two enforce. Raising the table minimum raised a standing bet to meet
 * it *without asking whether the seat could pay* — a $50 bankroll with $5 in
 * the circle, against a new $100 minimum, came out holding a $100 wager, and
 * `deal` subtracted it and left the bankroll at minus fifty. Lowering the
 * maximum under a standing side bet left a 17.6% bet several times the size
 * of the hand it rides on, which is the exact shape `setBet`'s cap exists to
 * prevent.
 *
 * So the clamping here ends with the same three invariants `setBet`
 * guarantees: a wager is zero or between the minimum and the maximum, the
 * side bets never exceed it, and the total never exceeds the bankroll. A seat
 * that cannot afford the new table has its circle cleared rather than
 * silently over-committed — it is a table it cannot sit at until it rebuys,
 * and saying so with an empty circle is the honest version.
 */
export function setRules(table: TableState, rules: TableRules, rng: Rng): ActionResult {
  if (table.phase !== 'BETTING') return refuse('Wait for the round to finish.');
  let cleared = false;
  const next = produce(table, (d) => {
    d.rules = rules;
    d.shoe = createShoe(rules.decks, rules.penetration, rng, d.shoe.shuffleId + 1);
    for (const s of d.seats) {
      s.pendingSideBets = s.pendingSideBets.filter((sb) => rules.sideBets[sb.kind]);
      if (s.pendingBet > 0 && s.pendingBet < rules.minBet) s.pendingBet = rules.minBet;
      if (s.pendingBet > rules.maxBet) s.pendingBet = rules.maxBet;

      // A side bet may never be larger than the hand it rides on.
      s.pendingSideBets = s.pendingSideBets.map((sb) =>
        sb.amount > s.pendingBet ? { ...sb, amount: s.pendingBet } : sb,
      );

      // And the seat has to be able to pay for all of it.
      const side = s.pendingSideBets.reduce((n, sb) => n + sb.amount, 0);
      if (s.pendingBet + side > s.bankroll) {
        s.pendingBet = 0;
        s.pendingSideBets = [];
        if (s.occupied) cleared = true;
      }
    }
  });
  return ok(next, cleared ? 'Bets cleared — this table is beyond the bankroll.' : undefined);
}

/** Put a fresh shoe in, by hand. */
export function reshuffle(table: TableState, rng: Rng): ActionResult {
  if (table.phase !== 'BETTING') return refuse('Wait for the round to finish.');
  return ok(
    produce(table, (d) => {
      d.shoe = createShoe(d.rules.decks, d.rules.penetration, rng, d.shoe.shuffleId + 1);
    }),
    'New shoe.',
  );
}

export { luckyLadiesJackpotUpgrade };
