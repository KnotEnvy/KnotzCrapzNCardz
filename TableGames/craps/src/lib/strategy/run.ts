/**
 * Running a strategy.
 *
 * `runStrategy` is to a strategy what `applyRoll` is to a roll: a pure function
 * from a table to a new table, plus a record of what it did. It holds no clock,
 * no randomness and no React, so a strategy can be simulated over ten thousand
 * seeded rolls in a test without a browser anywhere in sight.
 *
 * It moves money only by calling the same legal-move functions the felt calls.
 * There is no path in here that reaches into a bankroll directly, which is what
 * guarantees a bot cannot make a bet a player could not have made by hand.
 */

import {
  atRisk,
  betSpec,
  maxOddsFor,
  numberBet,
  placeBet,
  seatBetOn,
  setBetAmount,
  setWorking,
  takeDown,
  takeDownAll,
  setOdds,
  type ActionResult,
  type BetSpec,
} from '@/lib/engine/table';
import { betLabel } from '@/lib/engine/odds';
import type {
  Bet,
  BetKind,
  PointNumber,
  RollRecord,
  SeatId,
  Settlement,
  TableState,
} from '@/lib/engine/types';
import { POINT_NUMBERS } from '@/lib/engine/types';
import { ruleTitle } from './describe';
import {
  LOG_LIMIT,
  emptyMemory,
  isStateTrigger,
  type Action,
  type Amount,
  type BetTarget,
  type Comparison,
  type Condition,
  type NumberRef,
  type OddsTarget,
  type Strategy,
  type StrategyLogEntry,
  type StrategyMemory,
  type StrategyRule,
  type Trigger,
} from './types';

/* ------------------------------------------------------------------ *
 * Input and output
 * ------------------------------------------------------------------ */

export interface StrategyRunInput {
  table: TableState;
  seat: SeatId;
  strategy: Strategy;
  memory: StrategyMemory;
  /**
   * The roll that just resolved. Passed in rather than read off `table.history`
   * because a simulation runs with `historyLimit: 0` and would otherwise see
   * nothing at all.
   */
  record: RollRecord | null;
  /** That roll's settlements, so a press can be sized by what the bet just won. */
  settlements?: Settlement[];
  /**
   * The player asked for this run by hand rather than it following a roll.
   * Lets the state triggers fire again on a table that has not moved; the
   * event triggers still refuse, because you cannot make the same point twice.
   */
  force?: boolean;
}

export interface StrategyRunResult {
  table: TableState;
  memory: StrategyMemory;
  /** Just this run's entries. `memory.log` holds the running window. */
  entries: StrategyLogEntry[];
}

/*
 * Frozen because `resolveNumbers` hands these straight back rather than
 * copying them — a group reference is read, never written, and the copy was
 * one allocation per reference per rule per roll.
 */
const INSIDE: readonly PointNumber[] = Object.freeze<PointNumber[]>([5, 6, 8, 9]);
const OUTSIDE: readonly PointNumber[] = Object.freeze<PointNumber[]>([4, 5, 9, 10]);
const ACROSS: readonly PointNumber[] = Object.freeze<PointNumber[]>([4, 5, 6, 8, 9, 10]);
const HARD_NUMBERS: readonly PointNumber[] = Object.freeze<PointNumber[]>([4, 6, 8, 10]);
const NO_NUMBERS: readonly PointNumber[] = Object.freeze<PointNumber[]>([]);

/** Amount modes that name what a spot should hold rather than what to add. */
const LEVEL_MODES: ReadonlySet<string> = new Set(['UNITS', 'FIXED', 'TABLE_MIN', 'PCT_BANKROLL']);

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

function isBoxNumber(n: number): n is PointNumber {
  return (POINT_NUMBERS as readonly number[]).includes(n);
}

function compare(left: number, op: Comparison, right: number): boolean {
  switch (op) {
    case 'EQ':
      return left === right;
    case 'NE':
      return left !== right;
    case 'GT':
      return left > right;
    case 'GTE':
      return left >= right;
    case 'LT':
      return left < right;
    case 'LTE':
      return left <= right;
  }
}

/*
 * The bet scans below walk `table.bets` with a plain indexed loop. The array
 * is frozen, and V8 drops frozen arrays out of the fast path for `filter` and
 * `find` — measured at roughly 8x for a 24-bet array. These run per seat per
 * roll, so they are written out longhand.
 */

/** The bet with this id as it stands on a table, or undefined if it is gone. */
function liveBet(table: TableState, betId: string): Bet | undefined {
  for (let i = 0; i < table.bets.length; i++) {
    if (table.bets[i].id === betId) return table.bets[i];
  }
  return undefined;
}

/** Everything a seat is worth: chips in the rack plus chips on the felt. */
function equity(table: TableState, seat: SeatId): number {
  return table.seats[seat].bankroll + atRisk(table, seat);
}

/* ------------------------------------------------------------------ *
 * Resolving the dynamic parts of a rule
 * ------------------------------------------------------------------ */

/** The box number the dice last landed on, or null if it was not one. */
function hitNumber(record: RollRecord | null): PointNumber | null {
  if (!record) return null;
  return isBoxNumber(record.roll.total) ? record.roll.total : null;
}

/**
 * Turns a number reference into the actual numbers it means right now.
 *
 * A reference can come out empty and that is not an error — "press the number
 * that hit" on a roll that was not a box number simply has nothing to do.
 */
function resolveNumbers(
  ref: NumberRef,
  table: TableState,
  record: RollRecord | null,
  kind?: BetKind,
  exceptPoint?: boolean,
): readonly PointNumber[] {
  let out: readonly PointNumber[];

  switch (ref) {
    case 'POINT':
      out = table.point !== null ? [table.point] : NO_NUMBERS;
      break;
    case 'HIT': {
      const n = hitNumber(record);
      out = n !== null ? [n] : NO_NUMBERS;
      break;
    }
    case 'INSIDE':
      out = INSIDE;
      break;
    case 'OUTSIDE':
      out = OUTSIDE;
      break;
    case 'ACROSS':
      out = ACROSS;
      break;
    default:
      out = [ref];
  }

  // A hardway only exists on the four even numbers, so a group reference has
  // to narrow rather than refuse.
  if (kind === 'HARDWAY') out = out.filter((n) => HARD_NUMBERS.includes(n));
  if (exceptPoint && table.point !== null) out = out.filter((n) => n !== table.point);
  return out;
}

/** Every concrete betting spot a target names right now. */
function resolveSpecs(
  target: BetTarget,
  table: TableState,
  record: RollRecord | null,
): BetSpec[] {
  switch (target.kind) {
    case 'PLACE':
    case 'BUY':
    case 'LAY':
    case 'HARDWAY':
    case 'BIG':
      return resolveNumbers(
        target.number ?? 'POINT',
        table,
        record,
        target.kind,
        target.exceptPoint,
      ).map((number) => ({ kind: target.kind, number }));
    case 'PROP':
      return target.prop ? [{ kind: 'PROP', prop: target.prop }] : [];
    case 'HOP':
      return target.hop ? [{ kind: 'HOP', hop: target.hop }] : [];
    case 'ATS':
      return target.ats ? [{ kind: 'ATS', ats: target.ats }] : [];
    default:
      return [{ kind: target.kind }];
  }
}

/** The bets a seat currently holds that match a target. */
function matchingBets(
  target: BetTarget,
  table: TableState,
  seat: SeatId,
  record: RollRecord | null,
): Bet[] {
  const specs = resolveSpecs(target, table, record);
  const out: Bet[] = [];
  if (specs.length === 0) return out;
  for (let i = 0; i < table.bets.length; i++) {
    const bet = table.bets[i];
    if (bet.seat !== seat) continue;
    for (let j = 0; j < specs.length; j++) {
      const spec = specs[j];
      if (
        spec.kind === bet.kind &&
        (spec.number === undefined || spec.number === bet.number) &&
        (spec.prop === undefined || spec.prop === bet.prop) &&
        (spec.ats === undefined || spec.ats === bet.ats) &&
        (spec.hop === undefined ||
          (bet.hop !== undefined && spec.hop[0] === bet.hop[0] && spec.hop[1] === bet.hop[1]))
      ) {
        out.push(bet);
        break;
      }
    }
  }
  return out;
}

/**
 * What a bet on a number just won, for the press modes that are sized by the
 * payout rather than by a unit. "Press it by the win" is how a player turns a
 * hit into a bigger bet without reaching into their rack.
 */
function winOn(settlements: Settlement[], seat: SeatId, number: PointNumber): number {
  let total = 0;
  for (let i = 0; i < settlements.length; i++) {
    const s = settlements[i];
    if (
      s.seat === seat &&
      s.type === 'WIN' &&
      s.at.number === number &&
      (s.at.kind === 'PLACE' || s.at.kind === 'BUY')
    ) {
      total += s.net;
    }
  }
  return total;
}

/* ------------------------------------------------------------------ *
 * Amounts
 * ------------------------------------------------------------------ */

interface AmountContext {
  table: TableState;
  seat: SeatId;
  unit: number;
  /** What is already on the spot, for DOUBLE and TO. */
  current: number;
  /** What the spot just won, for WIN and HALF_WIN. */
  won: number;
}

/**
 * How many dollars an amount comes to, as a *delta* — the money about to leave
 * the rack. `TO` is the one that reads as a total, so it subtracts what is
 * already there.
 */
function resolveAmount(amount: Amount, ctx: AmountContext): number {
  switch (amount.mode) {
    case 'UNITS':
      return Math.max(0, Math.round(amount.value * ctx.unit));
    case 'FIXED':
      return Math.max(0, Math.round(amount.value));
    case 'TABLE_MIN':
      return ctx.table.rules.minBet;
    case 'PCT_BANKROLL':
      return Math.max(0, Math.floor((ctx.table.seats[ctx.seat].bankroll * amount.value) / 100));
    case 'DOUBLE':
      return ctx.current;
    case 'WIN':
      return Math.max(0, Math.round(ctx.won));
    case 'HALF_WIN':
      return Math.max(0, Math.round(ctx.won / 2));
    case 'TO':
      return Math.max(0, Math.round(amount.value) - ctx.current);
    case 'MAX':
    case 'MULTIPLE':
      // Odds-only modes. Sized against the flat bet by the odds action itself.
      return 0;
  }
}

/* ------------------------------------------------------------------ *
 * Conditions
 * ------------------------------------------------------------------ */

function evaluate(
  cond: Condition,
  table: TableState,
  seat: SeatId,
  memory: StrategyMemory,
  record: RollRecord | null,
): boolean {
  switch (cond.t) {
    case 'POINT_IS':
      if (table.point === null) return false;
      return cond.numbers.length === 0 || cond.numbers.includes(table.point);

    case 'HIT_IS': {
      const n = hitNumber(record);
      if (n === null) return false;
      return cond.numbers.length === 0 || cond.numbers.includes(n);
    }

    case 'LAST_TOTAL':
      return record !== null && compare(record.roll.total, cond.op, cond.value);

    case 'HAS_BET':
      return matchingBets(cond.target, table, seat, record).length > 0 === cond.has;

    case 'BET_AMOUNT': {
      const bets = matchingBets(cond.target, table, seat, record);
      let total = 0;
      for (let i = 0; i < bets.length; i++) total += bets[i].amount;
      return compare(total, cond.op, cond.value);
    }

    case 'BET_COUNT': {
      let n = 0;
      for (let i = 0; i < table.bets.length; i++) {
        const b = table.bets[i];
        if (b.seat === seat && b.kind === cond.kind) n += 1;
      }
      return compare(n, cond.op, cond.value);
    }

    case 'BANKROLL':
      return compare(table.seats[seat].bankroll, cond.op, cond.value);

    case 'AT_RISK':
      return compare(atRisk(table, seat), cond.op, cond.value);

    case 'SESSION_NET':
      return compare(equity(table, seat) - table.seats[seat].buyIn, cond.op, cond.value);

    case 'HAND_NET':
      return compare(equity(table, seat) - memory.handStartEquity, cond.op, cond.value);

    case 'ROLLS_THIS_HAND':
      return compare(table.shooterRollCount, cond.op, cond.value);

    case 'HITS_ON': {
      const numbers = resolveNumbers(cond.number, table, record);
      if (numbers.length === 0) return false;
      // A group reference asks about the busiest of them, which is what "the
      // inside numbers have hit twice" means when you say it out loud.
      let most = 0;
      for (let i = 0; i < numbers.length; i++) {
        const h = memory.hits[numbers[i]] ?? 0;
        if (h > most) most = h;
      }
      return compare(most, cond.op, cond.value);
    }

    case 'POINTS_THIS_HAND':
      return compare(memory.pointsThisHand, cond.op, cond.value);

    case 'IM_SHOOTING':
      return (table.shooter === seat) === cond.value;
  }
}

/* ------------------------------------------------------------------ *
 * Actions
 * ------------------------------------------------------------------ */

interface ActionOutcome {
  table: TableState;
  /** What happened, or null when the action had nothing to do. */
  text: string | null;
  ok: boolean;
}

const ODDS_KINDS: Record<OddsTarget, BetKind[]> = {
  PASS: ['PASS'],
  DONT_PASS: ['DONT_PASS'],
  COME: ['COME'],
  DONT_COME: ['DONT_COME'],
  ALL: ['PASS', 'DONT_PASS', 'COME', 'DONT_COME'],
};

/**
 * Applies a list of engine calls, keeping the successes and remembering the
 * first refusal. A grouped call — four numbers across — reports as one line
 * rather than four, and one number refusing does not sink the other three.
 */
function applyAll(
  start: TableState,
  seat: SeatId,
  calls: Array<(state: TableState) => ActionResult>,
): { table: TableState; done: number; spent: number; refusal: string | null } {
  let table = start;
  let done = 0;
  let refusal: string | null = null;
  const before = table.seats[seat].bankroll;

  for (const call of calls) {
    const res = call(table);
    if (res.ok) {
      table = res.state;
      done += 1;
    } else if (!refusal) {
      refusal = res.reason;
    }
  }

  return { table, done, spent: before - table.seats[seat].bankroll, refusal };
}

function moneyText(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

/**
 * The felt's own name for a spot. `betLabel` reads only the fields a spec
 * already carries, so the cast supplies the ones it never looks at.
 */
function specLabel(spec: BetSpec): string {
  return betLabel(spec as Bet);
}

function numbersText(numbers: PointNumber[]): string {
  return numbers.join(', ');
}

function runAction(
  action: Action,
  table: TableState,
  seat: SeatId,
  strategy: Strategy,
  record: RollRecord | null,
  settlements: Settlement[],
): ActionOutcome {
  const unit = strategy.unit;

  switch (action.t) {
    /* ---------------- Money on a spot ---------------- */

    case 'BET': {
      const specs = resolveSpecs(action.target, table, record);
      if (specs.length === 0) return { table, text: null, ok: true };

      const res = applyAll(
        table,
        seat,
        specs.map((spec) => (state: TableState) => {
          const held = seatBetOn(state, seat, spec)?.amount ?? 0;
          const figure = resolveAmount(action.amount, {
            table: state,
            seat,
            unit,
            current: held,
            won: spec.number ? winOn(settlements, seat, spec.number) : 0,
          });
          // The four everyday modes name a level for the spot to reach; the
          // rest already come back as a delta, so only the levels get the
          // difference taken off what is sitting there.
          const amount =
            action.topUp || !LEVEL_MODES.has(action.amount.mode)
              ? figure
              : Math.max(0, figure - held);
          if (amount <= 0) return { ok: false, reason: 'Nothing to bet' } as ActionResult;
          // Never `fromChip`: a strategy states its amounts in the spot's own
          // units already, and converting them again would inflate the bet.
          return placeBet(state, seat, spec, amount);
        }),
      );

      if (res.done === 0) {
        return { table: res.table, text: res.refusal ?? 'Nothing to bet', ok: false };
      }

      const where = specs.length === 1 ? specLabel(specs[0]) : `${res.done} spots`;
      return { table: res.table, text: `${where} — ${moneyText(res.spent)}`, ok: true };
    }

    /* ---------------- Odds behind the line ---------------- */

    case 'ODDS': {
      const kinds = ODDS_KINDS[action.on];
      const targets: Bet[] = [];
      for (let i = 0; i < table.bets.length; i++) {
        const b = table.bets[i];
        if (b.seat === seat && b.number !== undefined && kinds.includes(b.kind)) targets.push(b);
      }
      if (targets.length === 0) return { table, text: null, ok: true };

      let working = table;
      let done = 0;
      let refusal: string | null = null;
      const before = working.seats[seat].bankroll;

      for (const bet of targets) {
        const live = liveBet(working, bet.id);
        if (!live) continue;
        const max = maxOddsFor(working, live);
        let want: number;
        switch (action.amount.mode) {
          case 'MAX':
            want = max;
            break;
          case 'MULTIPLE':
            want = Math.floor(live.amount * action.amount.value);
            break;
          default:
            want = resolveAmount(action.amount, {
              table: working,
              seat,
              unit,
              current: live.odds,
              won: 0,
            });
        }
        // Never reach for more than the rack can cover; a partial lay is a
        // real bet, and refusing outright would leave the line naked.
        want = Math.min(want, live.odds + working.seats[seat].bankroll, max);
        if (want <= live.odds) continue;

        const res = setOdds(working, live.id, want);
        if (res.ok) {
          working = res.state;
          done += 1;
        } else if (!refusal) {
          refusal = res.reason;
        }
      }

      if (done === 0) {
        return refusal
          ? { table: working, text: refusal, ok: false }
          : { table: working, text: null, ok: true };
      }
      const spent = before - working.seats[seat].bankroll;
      return {
        table: working,
        text: `Odds up behind ${done} bet${done > 1 ? 's' : ''} — ${moneyText(spent)}`,
        ok: true,
      };
    }

    /* ---------------- Pressing and regressing ---------------- */

    case 'PRESS': {
      const numbers = resolveNumbers(action.number, table, record);
      if (numbers.length === 0) return { table, text: null, ok: true };

      let working = table;
      let done = 0;
      const touched: PointNumber[] = [];
      let refusal: string | null = null;
      const before = working.seats[seat].bankroll;

      for (const number of numbers) {
        const bet = numberBet(working, seat, number);
        if (!bet) {
          if (!refusal) refusal = `Nothing on the ${number} to press`;
          continue;
        }
        const delta = resolveAmount(action.amount, {
          table: working,
          seat,
          unit,
          current: bet.amount,
          won: winOn(settlements, seat, number),
        });
        if (delta <= 0) continue;
        // A press is stated in the spot's own units, so it goes in flat.
        const res = placeBet(working, seat, betSpec(bet), delta);
        if (res.ok) {
          working = res.state;
          done += 1;
          touched.push(number);
        } else if (!refusal) {
          refusal = res.reason;
        }
      }

      if (done === 0) {
        return refusal
          ? { table: working, text: refusal, ok: false }
          : { table: working, text: null, ok: true };
      }
      const spent = before - working.seats[seat].bankroll;
      return {
        table: working,
        text: `Pressed ${numbersText(touched)} — ${moneyText(spent)}`,
        ok: true,
      };
    }

    case 'REGRESS': {
      const numbers = resolveNumbers(action.number, table, record);
      if (numbers.length === 0) return { table, text: null, ok: true };

      let working = table;
      const touched: PointNumber[] = [];
      let refusal: string | null = null;
      const before = working.seats[seat].bankroll;

      for (const number of numbers) {
        const bet = numberBet(working, seat, number);
        if (!bet) continue;
        // Regression amounts name the total to come down *to*, not a delta.
        const target =
          action.amount.mode === 'TO' || action.amount.mode === 'FIXED'
            ? Math.round(action.amount.value)
            : action.amount.mode === 'UNITS'
              ? Math.round(action.amount.value * unit)
              : resolveAmount(action.amount, {
                  table: working,
                  seat,
                  unit,
                  current: 0,
                  won: winOn(settlements, seat, number),
                });
        const res = setBetAmount(working, bet.id, target);
        if (res.ok) {
          working = res.state;
          touched.push(number);
        } else if (!refusal) {
          refusal = res.reason;
        }
      }

      if (touched.length === 0) {
        return refusal
          ? { table: working, text: refusal, ok: false }
          : { table: working, text: null, ok: true };
      }
      const returned = working.seats[seat].bankroll - before;
      return {
        table: working,
        text: `Regressed ${numbersText(touched)} — ${moneyText(returned)} back`,
        ok: true,
      };
    }

    /* ---------------- Coming down ---------------- */

    case 'TAKE_DOWN': {
      if (action.target.all || !action.target.target) {
        const res = takeDownAll(table, seat);
        return res.ok
          ? { table: res.state, text: res.message ?? 'Bets down', ok: true }
          : { table, text: null, ok: true }; // nothing there is not a failure
      }

      const bets = matchingBets(action.target.target, table, seat, record);
      if (bets.length === 0) return { table, text: null, ok: true };

      const res = applyAll(
        table,
        seat,
        bets.map((bet) => (state: TableState) => takeDown(state, bet.id)),
      );
      if (res.done === 0) {
        return { table: res.table, text: res.refusal ?? 'Nothing came down', ok: false };
      }
      return {
        table: res.table,
        text: `${res.done} bet${res.done > 1 ? 's' : ''} down — ${moneyText(-res.spent)} back`,
        ok: true,
      };
    }

    /* ---------------- The ON/OFF puck ---------------- */

    case 'WORKING': {
      const numbers = resolveNumbers(action.number, table, record);
      const bets: Bet[] = [];
      for (let i = 0; i < table.bets.length; i++) {
        const b = table.bets[i];
        if (
          b.seat === seat &&
          (b.kind === 'PLACE' || b.kind === 'BUY' || b.kind === 'HARDWAY') &&
          b.number !== undefined &&
          numbers.includes(b.number as PointNumber) &&
          b.working !== action.on
        ) {
          bets.push(b);
        }
      }
      if (bets.length === 0) return { table, text: null, ok: true };

      const res = applyAll(
        table,
        seat,
        bets.map((bet) => (state: TableState) => setWorking(state, bet.id, action.on)),
      );
      if (res.done === 0) {
        return { table: res.table, text: res.refusal ?? 'Nothing to switch', ok: false };
      }
      return {
        table: res.table,
        text: `${res.done} bet${res.done > 1 ? 's' : ''} turned ${action.on ? 'ON' : 'OFF'}`,
        ok: true,
      };
    }

    /* ---------------- Walking away ---------------- */

    case 'STOP':
      return { table, text: `Stopping — ${action.reason}`, ok: true };
  }
}

/* ------------------------------------------------------------------ *
 * Triggers
 * ------------------------------------------------------------------ */

function triggerFires(
  trigger: Trigger,
  table: TableState,
  record: RollRecord | null,
  fresh: boolean,
  force: boolean,
): boolean {
  // Event triggers describe something that happened, so they fire once, on the
  // roll that caused them, and never on a re-run.
  if (!isStateTrigger(trigger)) {
    if (!fresh || !record) return false;
    switch (trigger) {
      case 'POINT_SET':
        return record.outcome === 'POINT_ESTABLISHED';
      case 'POINT_MADE':
        return record.outcome === 'POINT_MADE';
      case 'SEVEN_OUT':
        return record.outcome === 'SEVEN_OUT';
      case 'NUMBER_HIT':
        return isBoxNumber(record.roll.total);
      case 'CRAPS': {
        const total = record.roll.total;
        return total === 2 || total === 3 || total === 12;
      }
      case 'NATURAL':
        return record.outcome === 'NATURAL';
      default:
        return false;
    }
  }

  if (!fresh && !force) return false;
  switch (trigger) {
    case 'COME_OUT':
      return table.phase === 'COME_OUT';
    case 'POINT_ON':
      return table.phase === 'POINT_SET';
    case 'HAND_START':
      return table.shooterRollCount === 0;
    case 'EVERY_ROLL':
      return true;
    default:
      return false;
  }
}

/** The token a `once` scope compares against to decide it has already fired. */
function epochFor(rule: StrategyRule, table: TableState, memory: StrategyMemory): string | null {
  switch (rule.once) {
    case 'ALWAYS':
      return null;
    case 'ROLL':
      return `r${table.rollCount}`;
    case 'POINT':
      return `p${memory.pointCycle}`;
    case 'HAND':
      return `h${memory.handIndex}`;
    case 'SESSION':
      return 's';
  }
}

/* ------------------------------------------------------------------ *
 * Memory
 * ------------------------------------------------------------------ */

/**
 * Folds the roll that just happened into what the strategy remembers, before
 * any rule gets to look at the table. A hand's hit counts and its starting
 * equity have to be right by the time a rule asks "has the eight hit twice".
 */
function advance(memory: StrategyMemory, table: TableState, seat: SeatId, record: RollRecord): StrategyMemory {
  const next: StrategyMemory = {
    ...memory,
    hits: { ...memory.hits },
    fired: { ...memory.fired },
    log: memory.log,
  };

  const total = record.roll.total;
  if (isBoxNumber(total)) next.hits[total] = (next.hits[total] ?? 0) + 1;

  if (record.outcome === 'POINT_ESTABLISHED') next.pointCycle += 1;
  if (record.outcome === 'POINT_MADE') next.pointsThisHand += 1;

  if (record.outcome === 'SEVEN_OUT') {
    next.handIndex += 1;
    next.hits = {};
    next.pointsThisHand = 0;
    // The new hand's baseline is measured after the seven-out has been paid.
    next.handStartEquity = equity(table, seat);
  }

  next.lastRollSeen = table.rollCount;
  return next;
}

/* ------------------------------------------------------------------ *
 * The entry point
 * ------------------------------------------------------------------ */

export function runStrategy(input: StrategyRunInput): StrategyRunResult {
  const { table: startTable, seat, strategy, record, force = false } = input;
  const settlements = input.settlements ?? [];

  // A memory that belongs to a different strategy is not this strategy's
  // memory. Swapping systems mid-session starts the counters over.
  let memory =
    input.memory.strategyId === strategy.id
      ? input.memory
      : emptyMemory(strategy.id, equity(startTable, seat));

  const fresh = record !== null && startTable.rollCount !== memory.lastRollSeen;
  // `advance` builds its own copies. On a re-run over a roll this memory has
  // already folded in there is nothing to fold, and every write below replaces
  // rather than mutates, so the memory can be carried through untouched — which
  // also lets the store hand back the identical object and skip a re-render.
  if (fresh && record) memory = advance(memory, startTable, seat, record);

  const entries: StrategyLogEntry[] = [];
  const note = (rule: string, text: string, ok: boolean) => {
    entries.push({ roll: startTable.rollCount, rule, text, ok });
  };

  let table = startTable;

  /* ---- Walk-away limits, checked before anything is bet ---- */

  if (!memory.stopped) {
    const net = equity(table, seat) - table.seats[seat].buyIn;
    if (strategy.winGoal > 0 && net >= strategy.winGoal) {
      memory = { ...memory, stopped: true, stopReason: `up ${moneyText(net)} — win goal` };
      note('Win goal', `Colouring up ${moneyText(net)} ahead`, true);
    } else if (strategy.lossLimit > 0 && net <= -strategy.lossLimit) {
      memory = { ...memory, stopped: true, stopReason: `down ${moneyText(-net)} — loss limit` };
      note('Loss limit', `Walking away ${moneyText(-net)} down`, true);
    }
  }

  if (memory.stopped) {
    return { table, memory: withLog(memory, entries), entries };
  }

  /* ---- Every rule, in the order the player wrote them ---- */

  for (const rule of strategy.rules) {
    if (!rule.enabled) continue;
    if (!triggerFires(rule.when, table, record, fresh, force)) continue;

    const epoch = epochFor(rule, table, memory);
    if (epoch !== null && memory.fired[rule.id] === epoch) continue;

    // Conditions read the table as it stands *now*, so a rule sees what the
    // rules above it just did. That is what lets one rule place the numbers
    // and the next one decide whether they need pressing.
    const holds = rule.all.every((c) => evaluate(c, table, seat, memory, record));
    if (!holds) continue;

    // Rendering the rule back into English is only needed if something is
    // going to be written to the log, and most firings of most rules find
    // nothing to do. Worked out once, on first use.
    let title: string | null = null;
    const titleOf = () => (title ??= ruleTitle(rule, strategy.unit));
    let acted = false;

    for (const action of rule.then) {
      const outcome = runAction(action, table, seat, strategy, record, settlements);
      table = outcome.table;
      if (outcome.text !== null) {
        note(titleOf(), outcome.text, outcome.ok);
        if (outcome.ok) acted = true;
      }
      if (action.t === 'STOP') {
        memory = { ...memory, stopped: true, stopReason: action.reason };
        acted = true;
        break;
      }
    }

    // `once` counts successes, not attempts. A rule whose bet was refused for
    // want of chips has not had its turn yet, and a rule that found nothing to
    // do must not burn the budget a later roll needs — which is exactly what
    // lets a regression sit above the bet that creates the thing it regresses.
    if (epoch !== null && acted) {
      memory = { ...memory, fired: { ...memory.fired, [rule.id]: epoch } };
    }
    if (memory.stopped) break;
  }

  return { table, memory: withLog(memory, entries), entries };
}

/**
 * Appends this run's entries to the rolling window.
 *
 * A rule that keeps refusing — a broke seat reaching for the same bet every
 * roll — says so once and then stops repeating itself, so a genuine refusal
 * stays visible instead of being scrolled away by forty copies of itself.
 */
function withLog(memory: StrategyMemory, entries: StrategyLogEntry[]): StrategyMemory {
  if (entries.length === 0) return memory;
  const log = [...memory.log];
  for (const entry of entries) {
    const previous = log[log.length - 1];
    if (previous && !entry.ok && !previous.ok && previous.rule === entry.rule && previous.text === entry.text) {
      continue;
    }
    log.push(entry);
  }
  return { ...memory, log: log.length > LOG_LIMIT ? log.slice(log.length - LOG_LIMIT) : log };
}
