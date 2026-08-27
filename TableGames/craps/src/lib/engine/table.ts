/**
 * Table construction and the legal moves a player can make between rolls.
 *
 * Everything here is a pure state transition returning either a new table or a
 * refusal with a reason the UI can show. The rule of thumb: if a live dealer
 * would say "can't do that right now", this layer says it too.
 */

import { produce } from 'immer';
import {
  betIncrement,
  betLabel,
  buyVig,
  chipToWager,
  layVig,
  layWinnings,
  maxLayOdds,
  maxPassOdds,
  snapDownToIncrement,
  snapToIncrement,
} from './odds';
import { applyPhaseDefaults } from './resolve';
import type {
  AtsKind,
  Bet,
  BetKind,
  DieFace,
  PointNumber,
  PropKind,
  SeatId,
  TableRules,
  TableState,
} from './types';
import { DEFAULT_RULES, emptyStats, POINT_NUMBERS } from './types';

/** Identifies a betting area on the felt. */
export interface BetSpec {
  kind: BetKind;
  number?: PointNumber | 6 | 8;
  prop?: PropKind;
  hop?: [DieFace, DieFace];
  ats?: AtsKind;
}

/** A stable key so clicking the same spot twice tops the bet up. */
export function specKey(spec: BetSpec): string {
  return [spec.kind, spec.number ?? '', spec.prop ?? '', spec.hop?.join('') ?? '', spec.ats ?? ''].join(
    '|',
  );
}

export function betSpec(bet: Bet): BetSpec {
  return { kind: bet.kind, number: bet.number, prop: bet.prop, hop: bet.hop, ats: bet.ats };
}

/**
 * Whether a bet is sitting on exactly the spot a spec names.
 *
 * This answers the same question as `specKey(betSpec(bet)) === specKey(spec)`
 * without building two objects and two joined strings for every bet on the
 * felt. Placing a wager asks it once per bet, and the strategy runner asks it
 * again for every spot a rule names, so it is worth having in a form that
 * allocates nothing. If `specKey` ever changes shape, this changes with it.
 */
export function isOnSpot(bet: Bet, spec: BetSpec): boolean {
  if (bet.kind !== spec.kind) return false;
  if (bet.number !== spec.number) return false;
  if (bet.prop !== spec.prop) return false;
  if (bet.ats !== spec.ats) return false;
  const a = bet.hop;
  const b = spec.hop;
  if (a === undefined || b === undefined) return a === b;
  return a[0] === b[0] && a[1] === b[1];
}

/*
 * The lookups below walk `state.bets` with a plain indexed loop rather than
 * `find` / `filter`. The array is frozen — immer deep-freezes everything it
 * produces — and V8 drops frozen arrays out of the fast path for the iterator
 * methods: `find` over a frozen 24-bet array measured 0.72us against 0.17us
 * for the same scan written out. These run on every wager, every strategy
 * action and every condition, so the difference is worth the plainer code.
 */

function indexOfBet(bets: readonly Bet[], betId: string): number {
  for (let i = 0; i < bets.length; i++) if (bets[i].id === betId) return i;
  return -1;
}

function indexOfSeatBetOn(bets: readonly Bet[], seat: SeatId, spec: BetSpec): number {
  for (let i = 0; i < bets.length; i++) {
    const b = bets[i];
    if (b.seat === seat && isOnSpot(b, spec)) return i;
  }
  return -1;
}

/** The bet a seat has sitting on exactly this spot, if any. */
export function seatBetOn(state: TableState, seat: SeatId, spec: BetSpec): Bet | undefined {
  const i = indexOfSeatBetOn(state.bets, seat, spec);
  return i < 0 ? undefined : state.bets[i];
}

/** The bets a player can turn on and off. Everything else is always live. */
const TOGGLEABLE_KINDS: ReadonlySet<BetKind> = new Set<BetKind>(['PLACE', 'BUY', 'HARDWAY']);

/** The four bets that can carry odds behind them. */
const LINE_KINDS: ReadonlySet<BetKind> = new Set<BetKind>([
  'PASS',
  'DONT_PASS',
  'COME',
  'DONT_COME',
]);

export const SEAT_COLORS: Record<SeatId, string> = {
  A: '#f0b429',
  B: '#38bdf8',
};

export interface CreateTableOptions {
  seatAName?: string;
  seatBName?: string;
  buyIn?: number;
  solo?: boolean;
  rules?: Partial<TableRules>;
}

/** The place-bet groups a dealer will take as a single call. */
export const INSIDE_NUMBERS: PointNumber[] = [5, 6, 8, 9];
export const OUTSIDE_NUMBERS: PointNumber[] = [4, 5, 9, 10];
export const ACROSS_NUMBERS: PointNumber[] = [4, 5, 6, 8, 9, 10];

export function createTable(opts: CreateTableOptions = {}): TableState {
  const buyIn = opts.buyIn ?? 1000;
  const mkSeat = (id: SeatId, name: string) => ({
    id,
    name,
    bankroll: buyIn,
    color: SEAT_COLORS[id],
    buyIn,
    totalWagered: 0,
    peak: buyIn,
  });

  return {
    phase: 'COME_OUT',
    point: null,
    solo: opts.solo ?? false,
    shooter: 'A',
    activeSeat: 'A',
    seats: {
      A: mkSeat('A', opts.seatAName ?? 'Player 1'),
      B: mkSeat('B', opts.seatBName ?? 'Player 2'),
    },
    bets: [],
    rules: { ...DEFAULT_RULES, ...opts.rules },
    rollCount: 0,
    betSeq: 0,
    shooterRollCount: 0,
    firePoints: [],
    atsHits: [],
    history: [],
    stats: emptyStats(),
  };
}

/* ------------------------------------------------------------------ *
 * Results
 * ------------------------------------------------------------------ */

export type ActionResult =
  | { ok: true; state: TableState; message?: string }
  | { ok: false; reason: string };

function refuse(reason: string): ActionResult {
  return { ok: false, reason };
}

/* ------------------------------------------------------------------ *
 * Legality
 * ------------------------------------------------------------------ */

export interface Availability {
  allowed: boolean;
  reason?: string;
}

/** Whether a betting area accepts a wager right now. */
export function canBet(state: TableState, spec: BetSpec): Availability {
  const comeOut = state.phase === 'COME_OUT';

  switch (spec.kind) {
    case 'PASS':
    case 'DONT_PASS':
      return comeOut
        ? { allowed: true }
        : { allowed: false, reason: 'The line is closed once the point is on' };

    case 'COME':
    case 'DONT_COME':
      return comeOut
        ? { allowed: false, reason: 'Come bets open once a point is established' }
        : { allowed: true };

    case 'PLACE':
    case 'BUY':
    case 'LAY':
      if (!POINT_NUMBERS.includes(spec.number as PointNumber)) {
        return { allowed: false, reason: 'Not a box number' };
      }
      return { allowed: true };

    case 'FIRE':
      if (!state.rules.fireBetEnabled) return { allowed: false, reason: 'Fire Bet is off' };
      return comeOut && state.shooterRollCount === 0
        ? { allowed: true }
        : { allowed: false, reason: 'Fire Bet must be down before the shooter comes out' };

    case 'ATS':
      if (!state.rules.atsEnabled) return { allowed: false, reason: 'All/Tall/Small is off' };
      return state.atsHits.length === 0
        ? { allowed: true }
        : { allowed: false, reason: 'All/Tall/Small must be down before the first number rolls' };

    default:
      return { allowed: true };
  }
}

/* ------------------------------------------------------------------ *
 * Placing and adjusting bets
 * ------------------------------------------------------------------ */

export interface PlaceOptions {
  /**
   * The amount came straight off the chip rack, so it is a denomination rather
   * than a wager already stated in this spot's own units. Presses and power
   * presses are already in the spot's units and must not set this.
   */
  fromChip?: boolean;
}

/**
 * Adds `amount` to the given betting area, creating the bet if it is empty.
 *
 * The wager that ends up on the felt is not always the number handed in. Three
 * things adjust it, in the order a dealer would apply them: a chip is worth
 * what the spot bets in, a bet under the table minimum is taken at the minimum
 * rather than refused, and the total has to divide into a payable bet. Only
 * after all three does the rack get checked.
 */
export function placeBet(
  state: TableState,
  seat: SeatId,
  spec: BetSpec,
  amount: number,
  opts: PlaceOptions = {},
): ActionResult {
  const avail = canBet(state, spec);
  if (!avail.allowed) return refuse(avail.reason!);
  if (amount <= 0) return refuse('Pick a chip first');

  const rules = state.rules;
  const existingIndex = indexOfSeatBetOn(state.bets, seat, spec);
  const held = existingIndex < 0 ? 0 : state.bets[existingIndex].amount;
  const inc = betIncrement(spec);
  // Props and hops are sold in single units and have never carried the line
  // minimum; a dollar on the yo is a real bet.
  const exemptFromMinimum = spec.kind === 'PROP' || spec.kind === 'HOP';

  const requested = opts.fromChip && inc > 1 ? chipToWager(spec, amount) : amount;

  let raisedToMinimum = false;
  let total = held + requested;
  if (!exemptFromMinimum && total < rules.minBet) {
    total = rules.minBet;
    raisedToMinimum = true;
  }
  if (inc > 1) total = snapToIncrement(total, inc);

  let wager = total - held;

  // Rounding up must never overdraw a rack. Step back to the largest payable
  // total the seat can actually cover before giving up on the bet.
  const rack = state.seats[seat].bankroll;
  if (wager > rack && inc > 1) {
    const affordable = snapDownToIncrement(held + rack, inc);
    if (
      affordable > held &&
      affordable - held <= rack &&
      (exemptFromMinimum || affordable >= rules.minBet)
    ) {
      total = affordable;
      wager = total - held;
    }
  }

  let message: string | undefined;
  if (wager !== amount) {
    message = raisedToMinimum
      ? `Table minimum is $${rules.minBet} — $${total} up`
      : `Rounded to $${total}, payable in ${inc === 6 ? 'sixes' : `${inc}s`}`;
  }

  if (wager <= 0) return refuse(`Minimum increment here is $${betIncrement(spec)}`);
  if (total > rules.maxBet) return refuse(`Table maximum is $${rules.maxBet}`);
  if (rack < wager) return refuse('Not enough in the rack');

  const nextState = produce(state, (draft) => {
    draft.seats[seat].bankroll -= wager;
    draft.seats[seat].totalWagered += wager;

    // The index came off `state.bets`, which is the same array the draft is
    // still sitting on, so this reaches straight for the one bet that changes
    // instead of proxying every bet ahead of it looking for a match.
    if (existingIndex >= 0) {
      draft.bets[existingIndex].amount += wager;
      return;
    }

    draft.betSeq += 1;
    const bet: Bet = {
      id: `b${draft.betSeq}`,
      seat,
      kind: spec.kind,
      amount: wager,
      number: spec.number,
      prop: spec.prop,
      hop: spec.hop,
      ats: spec.ats,
      odds: 0,
      working: true,
      oddsWorking: true,
      vigPaid: 0,
      placedOnRoll: draft.rollCount,
    };

    // A pass or don't-pass bet made on the come-out has no point yet; a come
    // bet sits in the box until a number rolls. Everything else is live now.
    if (spec.kind === 'PLACE' || spec.kind === 'BUY' || spec.kind === 'HARDWAY') {
      const offNow =
        draft.phase === 'COME_OUT' &&
        (spec.kind === 'HARDWAY' ? draft.rules.hardwaysOffOnComeOut : draft.rules.placeOffOnComeOut);
      bet.working = !offNow;
    }

    // Buy and lay commission taken up front when the table charges that way.
    // A buy is charged on its stake and a lay on what it stands to win; the
    // two rules live in odds.ts so this path and the resolver cannot drift.
    if (!draft.rules.vigOnWin && (spec.kind === 'BUY' || spec.kind === 'LAY')) {
      const vig =
        spec.kind === 'BUY'
          ? buyVig(wager)
          : layVig(layWinnings(wager, spec.number as PointNumber));
      if (draft.seats[seat].bankroll >= vig) {
        draft.seats[seat].bankroll -= vig;
        bet.vigPaid = vig;
      }
    }

    draft.bets.push(bet);
  });

  return { ok: true, state: nextState, message };
}

/* ------------------------------------------------------------------ *
 * Odds behind the line
 * ------------------------------------------------------------------ */

export function maxOddsFor(state: TableState, bet: Bet): number {
  if (bet.number === undefined) return 0;
  const point = bet.number as PointNumber;
  const scheme = state.rules.oddsScheme;
  if (bet.kind === 'PASS' || bet.kind === 'COME') return maxPassOdds(bet.amount, point, scheme);
  if (bet.kind === 'DONT_PASS' || bet.kind === 'DONT_COME') {
    return maxLayOdds(bet.amount, point, scheme);
  }
  return 0;
}

/** Sets the odds behind a line bet to an exact amount, settling the difference. */
export function setOdds(state: TableState, betId: string, amount: number): ActionResult {
  const index = indexOfBet(state.bets, betId);
  if (index < 0) return refuse('That bet is gone');
  const bet = state.bets[index];
  if (bet.number === undefined) return refuse('Odds go up once the bet has a number');

  const max = maxOddsFor(state, bet);
  const target = Math.max(0, Math.min(Math.floor(amount), max));
  const delta = target - bet.odds;
  if (delta > 0 && state.seats[bet.seat].bankroll < delta) return refuse('Not enough in the rack');

  const nextState = produce(state, (draft) => {
    const b = draft.bets[index];
    draft.seats[bet.seat].bankroll -= delta;
    if (delta > 0) draft.seats[bet.seat].totalWagered += delta;
    b.odds = target;
  });

  const message =
    amount > max ? `Capped at $${max} — table allows ${state.rules.oddsScheme} odds` : undefined;
  return { ok: true, state: nextState, message };
}

/** Lays or takes the full allowed odds behind every eligible line bet. */
export function maxOddsAll(state: TableState, seat: SeatId): ActionResult {
  let working = state;
  let placed = 0;
  for (const bet of state.bets) {
    if (bet.seat !== seat || bet.number === undefined) continue;
    if (!LINE_KINDS.has(bet.kind)) continue;
    const max = maxOddsFor(working, bet);
    if (max <= bet.odds) continue;
    const affordable = Math.min(max, bet.odds + working.seats[seat].bankroll);
    const res = setOdds(working, bet.id, affordable);
    if (res.ok) {
      working = res.state;
      placed += 1;
    }
  }
  if (placed === 0) return refuse('Nothing to back with odds');
  return { ok: true, state: working, message: `Odds up behind ${placed} bet${placed > 1 ? 's' : ''}` };
}

/* ------------------------------------------------------------------ *
 * Taking bets down, pressing, and the ON/OFF puck
 * ------------------------------------------------------------------ */

/** Contract bets cannot be removed once they have a number. */
export function canTakeDown(bet: Bet): Availability {
  if (bet.kind === 'PASS' && bet.number !== undefined) {
    return { allowed: false, reason: 'A pass line bet with a point is a contract bet' };
  }
  if (bet.kind === 'COME' && bet.number !== undefined) {
    return { allowed: false, reason: 'A come bet with a point is a contract bet' };
  }
  if (bet.kind === 'FIRE' || bet.kind === 'ATS') {
    return { allowed: false, reason: 'Side bets ride until they resolve' };
  }
  return { allowed: true };
}

export function takeDown(state: TableState, betId: string): ActionResult {
  const index = indexOfBet(state.bets, betId);
  if (index < 0) return refuse('That bet is gone');
  const bet = state.bets[index];
  const can = canTakeDown(bet);

  // Odds can always come down, even behind a contract bet.
  if (!can.allowed && bet.odds === 0) return refuse(can.reason!);

  const nextState = produce(state, (draft) => {
    if (!can.allowed) {
      draft.seats[bet.seat].bankroll += bet.odds;
      draft.bets[index].odds = 0;
      return;
    }
    draft.seats[bet.seat].bankroll += bet.amount + bet.odds + bet.vigPaid;
    draft.bets.splice(index, 1);
  });

  return {
    ok: true,
    state: nextState,
    message: can.allowed ? undefined : 'Contract bet stays; odds came down',
  };
}

export function setWorking(state: TableState, betId: string, working: boolean): ActionResult {
  const index = indexOfBet(state.bets, betId);
  if (index < 0) return refuse('That bet is gone');
  if (!TOGGLEABLE_KINDS.has(state.bets[index].kind)) {
    return refuse('That bet is always working');
  }
  return {
    ok: true,
    state: produce(state, (draft) => {
      draft.bets[index].working = working;
    }),
  };
}

/** Turns every place, buy and hardway bet for a seat on or off at once. */
export function setAllWorking(state: TableState, seat: SeatId, working: boolean): ActionResult {
  // Work out which bets actually move before opening a draft. Writing a value
  // a bet already holds never marked it modified anyway, so this produces the
  // same table while proxying only the bets that change.
  const changing: number[] = [];
  for (let i = 0; i < state.bets.length; i++) {
    const bet = state.bets[i];
    if (bet.seat !== seat) continue;
    if (!TOGGLEABLE_KINDS.has(bet.kind)) continue;
    if (bet.working !== working) changing.push(i);
  }
  const touched = changing.length;
  const nextState = produce(state, (draft) => {
    for (const i of changing) draft.bets[i].working = working;
  });
  if (touched === 0) return refuse(`Nothing to turn ${working ? 'on' : 'off'}`);
  return {
    ok: true,
    state: nextState,
    message: `${touched} bet${touched > 1 ? 's' : ''} turned ${working ? 'ON' : 'OFF'}`,
  };
}

/** Takes down everything a seat legally can, returning the chips to the rack. */
export function takeDownAll(state: TableState, seat: SeatId): ActionResult {
  let working = state;
  let removed = 0;
  for (const bet of state.bets) {
    if (bet.seat !== seat) continue;
    if (!canTakeDown(bet).allowed) continue;
    const res = takeDown(working, bet.id);
    if (res.ok) {
      working = res.state;
      removed += 1;
    }
  }
  if (removed === 0) return refuse('Nothing to take down');
  return { ok: true, state: working, message: `${removed} bet${removed > 1 ? 's' : ''} down` };
}

/**
 * Finds the place or buy bet a seat has working on one number.
 *
 * Pressing is a call about a single number — the one that just hit. Reaching
 * across the whole layout and pressing all six would spend a player's rack on
 * numbers that did nothing, which is not what "press it" means at a table.
 */
export function numberBet(state: TableState, seat: SeatId, number: number): Bet | undefined {
  for (const b of state.bets) {
    if (b.seat === seat && b.number === number && (b.kind === 'PLACE' || b.kind === 'BUY')) {
      return b;
    }
  }
  return undefined;
}

/** Presses the bet on one number up by a payable increment, funded from the rack. */
export function pressNumber(
  state: TableState,
  seat: SeatId,
  number: PointNumber | 6 | 8,
  units = 1,
): ActionResult {
  const bet = numberBet(state, seat, number);
  if (!bet) return refuse(`Nothing to press on the ${number}`);

  const inc = betIncrement(betSpec(bet)) * Math.max(1, Math.floor(units));
  const res = placeBet(state, seat, betSpec(bet), inc);
  if (!res.ok) return res;

  const after = numberBet(res.state, seat, number);
  return { ok: true, state: res.state, message: `Pressed the ${number} to $${after?.amount ?? 0}` };
}

/**
 * Power press: doubles the bet on one number outright rather than nudging it
 * up a unit. The classic move after a hot number hits twice.
 */
export function powerPressNumber(
  state: TableState,
  seat: SeatId,
  number: PointNumber | 6 | 8,
): ActionResult {
  const bet = numberBet(state, seat, number);
  if (!bet) return refuse(`Nothing to power press on the ${number}`);

  const res = placeBet(state, seat, betSpec(bet), bet.amount);
  if (!res.ok) return res;

  const after = numberBet(res.state, seat, number);
  return {
    ok: true,
    state: res.state,
    message: `Power pressed the ${number} to $${after?.amount ?? 0}`,
  };
}

/**
 * Sets a bet to an exact amount, in either direction.
 *
 * Going up is a press, so it hands straight to `placeBet` and inherits the
 * whole ladder of adjustments — minimum, increment, rack check. Coming down is
 * a regression, which the felt had no way to say before: "take my thirty-dollar
 * six down to twelve" returns the difference to the rack and leaves the bet
 * working. A target of zero or less is simply a take-down.
 *
 * Commission already paid on a buy or lay stays paid. The house does not hand
 * back vig on money that was live, and neither does this.
 */
export function setBetAmount(state: TableState, betId: string, amount: number): ActionResult {
  const index = indexOfBet(state.bets, betId);
  if (index < 0) return refuse('That bet is gone');
  const bet = state.bets[index];

  const target = Math.floor(amount);
  if (target <= 0) return takeDown(state, betId);
  if (target > bet.amount) return placeBet(state, bet.seat, betSpec(bet), target - bet.amount);

  const can = canTakeDown(bet);
  if (!can.allowed) return refuse(can.reason!);

  const inc = betIncrement(betSpec(bet));
  const exemptFromMinimum = bet.kind === 'PROP' || bet.kind === 'HOP';
  let settled = inc > 1 ? snapToIncrement(target, inc) : target;
  if (!exemptFromMinimum && settled < state.rules.minBet) settled = state.rules.minBet;

  if (settled >= bet.amount) return refuse(`The ${betLabel(bet)} is already at $${bet.amount}`);

  const returned = bet.amount - settled;
  const nextState = produce(state, (draft) => {
    draft.bets[index].amount = settled;
    draft.seats[bet.seat].bankroll += returned;
  });

  return { ok: true, state: nextState, message: `${betLabel(bet)} down to $${settled}` };
}

/**
 * The grouped place calls a dealer takes in one breath: inside, outside, across.
 *
 * Each number is placed independently at the armed chip, so every one of them
 * gets its own minimum and increment treatment — which is how $25 across ends
 * up as $30 on the six and eight and $25 on the rest, exactly as it would in
 * the rack. Numbers that refuse individually are skipped rather than sinking
 * the whole call.
 */
export function placeGroup(
  state: TableState,
  seat: SeatId,
  numbers: readonly PointNumber[],
  chip: number,
  label: string,
  kind: 'PLACE' | 'BUY' = 'PLACE',
): ActionResult {
  let working = state;
  let placed = 0;
  let spent = 0;
  let firstRefusal: string | undefined;

  for (const number of numbers) {
    const before = working.seats[seat].bankroll;
    const res = placeBet(working, seat, { kind, number }, chip, { fromChip: true });
    if (res.ok) {
      spent += before - res.state.seats[seat].bankroll;
      working = res.state;
      placed += 1;
    } else if (!firstRefusal) {
      firstRefusal = res.reason;
    }
  }

  if (placed === 0) return refuse(firstRefusal ?? 'Nothing to place');
  return { ok: true, state: working, message: `$${spent} ${label}` };
}

/** Re-places a set of bets that came down on the previous roll. */
export function sameAction(
  state: TableState,
  seat: SeatId,
  specs: Array<{ spec: BetSpec; amount: number }>,
): ActionResult {
  if (specs.length === 0) return refuse('No action to repeat');
  let working = state;
  let placed = 0;
  for (const { spec, amount } of specs) {
    const res = placeBet(working, seat, spec, amount);
    if (res.ok) {
      working = res.state;
      placed += 1;
    }
  }
  if (placed === 0) return refuse('That action is not available right now');
  return { ok: true, state: working, message: `Same action on ${placed} bet${placed > 1 ? 's' : ''}` };
}

/** Adds chips to a seat's rack, e.g. a re-buy after busting out. */
export function rebuy(state: TableState, seat: SeatId, amount: number): TableState {
  return produce(state, (draft) => {
    draft.seats[seat].bankroll += amount;
    draft.seats[seat].buyIn += amount;
    if (draft.seats[seat].bankroll > draft.seats[seat].peak) {
      draft.seats[seat].peak = draft.seats[seat].bankroll;
    }
  });
}

/** Total a seat currently has at risk on the felt. */
export function atRisk(state: TableState, seat: SeatId): number {
  let total = 0;
  for (let i = 0; i < state.bets.length; i++) {
    const b = state.bets[i];
    if (b.seat === seat) total += b.amount + b.odds;
  }
  return total;
}

/** Re-applies the house ON/OFF defaults, used when the rules change mid-session. */
export function refreshWorkingDefaults(state: TableState): TableState {
  return produce(state, (draft) => {
    applyPhaseDefaults(draft.bets, draft.phase === 'COME_OUT', draft.rules);
  });
}
