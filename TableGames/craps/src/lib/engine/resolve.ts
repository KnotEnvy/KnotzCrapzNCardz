/**
 * Roll resolution.
 *
 * `applyRoll` is the only function that moves money. It is pure: give it a
 * table and a roll and it hands back a new table, the list of settlements the
 * UI should animate, and a ledger record. No randomness, no clock, no I/O,
 * which is what makes the whole game replayable from a seed.
 *
 * Order of operations within a single roll, which matters more than it looks:
 *
 *   1. Every bet is judged against the roll using the phase *as it was* when
 *      the dice left the shooter's hand.
 *   2. Come and don't-come bets sitting in the box are judged as their own
 *      come-out, independently of the table point. This is why a come bet in
 *      the box wins on the same seven that takes out the pass line.
 *   3. The table phase then advances, side-bet trackers update, and the Fire
 *      and All/Tall/Small bets settle last.
 */

import { produce } from 'immer';
import {
  ATS_NUMBERS,
  atsOdds,
  betLabel,
  fieldOdds,
  fireOdds,
  hardwayOdds,
  hopOdds,
  layOdds,
  placeOdds,
  propPayout,
  ratioValue,
  trueOdds,
} from './odds';
import type {
  Bet,
  BetLocation,
  PointNumber,
  Roll,
  RollOutcome,
  RollRecord,
  SeatId,
  Settlement,
  TableRules,
  TableState,
} from './types';
import { POINT_NUMBERS } from './types';

export interface RollResult {
  state: TableState;
  settlements: Settlement[];
  record: RollRecord;
}

/* ------------------------------------------------------------------ *
 * Per-bet verdicts
 * ------------------------------------------------------------------ */

type Verdict =
  /** Stays on the felt, untouched. */
  | { t: 'STAND' }
  /** Paid. `win` is net profit; `stakeReturns` says whether the stake comes back. */
  | { t: 'WIN'; win: number; vig: number; stakeReturns: boolean }
  | { t: 'LOSE' }
  | { t: 'PUSH' }
  /** A come/don't-come bet moving from the box onto a number. */
  | { t: 'TRAVEL'; to: PointNumber };

const EMPTY_HISTORY = Object.freeze([]) as unknown as RollRecord[];

/** Hoisted so the per-roll bookkeeping loop does not allocate its own each time. */
const SEAT_IDS: readonly SeatId[] = ['A', 'B'];

const STAND: Verdict = { t: 'STAND' };
const LOSE: Verdict = { t: 'LOSE' };

/** A snapshot of where a bet lives, for the settlement record. */
function locate(bet: Bet): BetLocation {
  return { kind: bet.kind, number: bet.number, prop: bet.prop, hop: bet.hop, ats: bet.ats };
}

function isPointNumber(n: number): n is PointNumber {
  return (POINT_NUMBERS as readonly number[]).includes(n);
}

/** Five percent of the buy stake, rounded the way a boxman rounds it. */
function buyVig(amount: number): number {
  return Math.max(1, Math.floor(amount * 0.05));
}

/** Five percent of what a lay actually wins. */
function layVig(win: number): number {
  return Math.max(1, Math.floor(win * 0.05));
}

/**
 * Whether a multi-roll bet can win or lose on this roll. `bet.working` is the
 * ON/OFF puck; the engine resets it to the house default at every phase change,
 * so the player has to re-declare a bet working each come-out, exactly as they
 * would have to tell a live dealer.
 */
function isWorking(bet: Bet): boolean {
  switch (bet.kind) {
    case 'PLACE':
    case 'BUY':
    case 'HARDWAY':
      return bet.working;
    // Lay bets, the line, and come bets are always live.
    default:
      return true;
  }
}

function judge(bet: Bet, roll: Roll, state: TableState): Verdict {
  const t = roll.total;
  const rules = state.rules;
  const hard = roll.d1 === roll.d2;

  switch (bet.kind) {
    /* ---------------- Line bets ---------------- */

    case 'PASS': {
      if (bet.number === undefined) {
        // Still on the come-out.
        if (t === 7 || t === 11) return { t: 'WIN', win: bet.amount, vig: 0, stakeReturns: true };
        if (t === 2 || t === 3 || t === 12) return LOSE;
        return { t: 'TRAVEL', to: t as PointNumber };
      }
      if (t === bet.number) {
        const odds = bet.oddsWorking ? bet.odds * ratioValue(trueOdds(bet.number as PointNumber)) : 0;
        return { t: 'WIN', win: bet.amount + odds, vig: 0, stakeReturns: true };
      }
      if (t === 7) return LOSE;
      return STAND;
    }

    case 'DONT_PASS': {
      if (bet.number === undefined) {
        if (t === 2 || t === 3) return { t: 'WIN', win: bet.amount, vig: 0, stakeReturns: true };
        if (t === 12) return { t: 'PUSH' }; // bar the twelve
        if (t === 7 || t === 11) return LOSE;
        return { t: 'TRAVEL', to: t as PointNumber };
      }
      if (t === 7) {
        const odds = bet.oddsWorking
          ? bet.odds * ratioValue(layOdds(bet.number as PointNumber))
          : 0;
        return { t: 'WIN', win: bet.amount + odds, vig: 0, stakeReturns: true };
      }
      if (t === bet.number) return LOSE;
      return STAND;
    }

    case 'COME': {
      if (bet.number === undefined) {
        if (t === 7 || t === 11) return { t: 'WIN', win: bet.amount, vig: 0, stakeReturns: true };
        if (t === 2 || t === 3 || t === 12) return LOSE;
        return { t: 'TRAVEL', to: t as PointNumber };
      }
      if (t === bet.number) {
        const odds = bet.oddsWorking ? bet.odds * ratioValue(trueOdds(bet.number as PointNumber)) : 0;
        return { t: 'WIN', win: bet.amount + odds, vig: 0, stakeReturns: true };
      }
      if (t === 7) return LOSE;
      return STAND;
    }

    case 'DONT_COME': {
      if (bet.number === undefined) {
        if (t === 2 || t === 3) return { t: 'WIN', win: bet.amount, vig: 0, stakeReturns: true };
        if (t === 12) return { t: 'PUSH' };
        if (t === 7 || t === 11) return LOSE;
        return { t: 'TRAVEL', to: t as PointNumber };
      }
      if (t === 7) {
        const odds = bet.oddsWorking
          ? bet.odds * ratioValue(layOdds(bet.number as PointNumber))
          : 0;
        return { t: 'WIN', win: bet.amount + odds, vig: 0, stakeReturns: true };
      }
      if (t === bet.number) return LOSE;
      return STAND;
    }

    /* ---------------- Box numbers ---------------- */

    case 'PLACE': {
      if (!isWorking(bet)) return STAND;
      if (t === bet.number) {
        return {
          t: 'WIN',
          win: bet.amount * ratioValue(placeOdds(bet.number as PointNumber)),
          vig: 0,
          stakeReturns: false, // the bet stays up and only the winnings are paid
        };
      }
      if (t === 7) return LOSE;
      return STAND;
    }

    case 'BUY': {
      if (!isWorking(bet)) return STAND;
      if (t === bet.number) {
        const win = bet.amount * ratioValue(trueOdds(bet.number as PointNumber));
        return {
          t: 'WIN',
          win,
          vig: rules.vigOnWin ? buyVig(bet.amount) : 0,
          stakeReturns: false,
        };
      }
      if (t === 7) return LOSE;
      return STAND;
    }

    case 'LAY': {
      if (t === 7) {
        const win = bet.amount * ratioValue(layOdds(bet.number as PointNumber));
        return { t: 'WIN', win, vig: rules.vigOnWin ? layVig(win) : 0, stakeReturns: false };
      }
      if (t === bet.number) return LOSE;
      return STAND;
    }

    case 'BIG': {
      if (t === bet.number) {
        return { t: 'WIN', win: bet.amount, vig: 0, stakeReturns: false };
      }
      if (t === 7) return LOSE;
      return STAND;
    }

    /* ---------------- Hardways ---------------- */

    case 'HARDWAY': {
      if (!isWorking(bet)) return STAND;
      if (t === bet.number) {
        if (hard) {
          return {
            t: 'WIN',
            win: bet.amount * ratioValue(hardwayOdds(bet.number as 4 | 6 | 8 | 10)),
            vig: 0,
            stakeReturns: false,
          };
        }
        return LOSE; // made the easy way
      }
      if (t === 7) return LOSE;
      return STAND;
    }

    /* ---------------- Single roll ---------------- */

    case 'FIELD': {
      const ratio = fieldOdds(t, rules);
      if (!ratio) return LOSE;
      return {
        t: 'WIN',
        win: bet.amount * ratioValue(ratio),
        vig: 0,
        stakeReturns: !rules.propsRideAfterWin,
      };
    }

    case 'PROP': {
      const p = propPayout(bet.prop!, bet.amount, roll);
      if (p.win === 0 && p.pushed === 0) return LOSE;
      if (p.win === 0 && p.pushed === bet.amount) return { t: 'PUSH' };
      return { t: 'WIN', win: p.win, vig: 0, stakeReturns: !rules.propsRideAfterWin };
    }

    case 'HOP': {
      const [a, b] = bet.hop!;
      const hit =
        (roll.d1 === a && roll.d2 === b) || (roll.d1 === b && roll.d2 === a);
      if (!hit) return LOSE;
      return {
        t: 'WIN',
        win: bet.amount * ratioValue(hopOdds(a, b)),
        vig: 0,
        stakeReturns: !rules.propsRideAfterWin,
      };
    }

    /* ---------------- Side bets settle after the phase advances ---------------- */

    case 'FIRE':
    case 'ATS':
      return STAND;
  }
}

/* ------------------------------------------------------------------ *
 * The main entry point
 * ------------------------------------------------------------------ */

export function applyRoll(state: TableState, roll: Roll): RollResult {
  const settlements: Settlement[] = [];
  const net: Record<SeatId, number> = { A: 0, B: 0 };
  const t = roll.total;
  const phaseBefore = state.phase;
  const pointBefore = state.point;

  const outcome: RollOutcome =
    phaseBefore === 'COME_OUT'
      ? isPointNumber(t)
        ? 'POINT_ESTABLISHED'
        : t === 7 || t === 11
          ? 'NATURAL'
          : 'CRAPS'
      : t === state.point
        ? 'POINT_MADE'
        : t === 7
          ? 'SEVEN_OUT'
          : 'NEUTRAL';

  const next = produce(state, (draft) => {
    // One draft lookup for the seats record, reused by every settlement below
    // instead of one per paid bet. Immer caches the child drafts underneath it,
    // so each seat is proxied once per roll however many bets it has working.
    const seats = draft.seats;
    const surviving: Bet[] = [];
    /* Fire and All/Tall/Small settle in a second pass, which is worth skipping
     * outright on the overwhelming majority of rolls where nobody has one up. */
    let sideBets = false;

    /* ---- 1. Judge every bet against the roll ---- *
     *
     * The judging reads `state.bets`, not `draft.bets`. Immer has to build a
     * proxy for every element of a draft array it is asked to walk, and that
     * is the same cliff the roll history used to fall off: measured at 24x the
     * cost of reading the plain frozen bets. Nothing here needs a draft to
     * decide a verdict, so a bet only becomes a new object when it actually
     * changes — a travelling come bet — and everything else is carried across
     * by reference exactly as immer would have carried it. */

    for (const bet of state.bets) {
      const verdict = judge(bet, roll, state);

      switch (verdict.t) {
        case 'STAND':
          if (bet.kind === 'FIRE' || bet.kind === 'ATS') sideBets = true;
          surviving.push(bet);
          break;

        case 'TRAVEL': {
          // The label is the bet's name *before* it moved ("Come"), while the
          // location is where it landed. Both matched the old draft ordering.
          const label = betLabel(bet);
          // Come odds are conventionally off for the come-out that follows.
          const moved: Bet = { ...bet, number: verdict.to };
          surviving.push(moved);
          settlements.push({
            type: 'MOVE',
            seat: bet.seat,
            betId: bet.id,
            at: locate(moved),
            label: `${label} to ${verdict.to}`,
            credit: 0,
            debit: 0,
            net: 0,
          });
          break;
        }

        case 'PUSH': {
          seats[bet.seat].bankroll += bet.amount + bet.odds;
          settlements.push({
            type: 'PUSH',
            seat: bet.seat,
            betId: bet.id,
            at: locate(bet),
            label: betLabel(bet),
            credit: bet.amount + bet.odds,
            debit: 0,
            net: 0,
          });
          break;
        }

        case 'LOSE': {
          const label = betLabel(bet);
          const where = locate(bet);
          // Odds behind a line bet only lose when they are working.
          const oddsLost = bet.oddsWorking ? bet.odds : 0;
          if (!bet.oddsWorking && bet.odds > 0) {
            seats[bet.seat].bankroll += bet.odds;
            settlements.push({
              type: 'RETURN',
              seat: bet.seat,
              betId: bet.id,
              at: where,
              label: `${label} Odds (off)`,
              credit: bet.odds,
              debit: 0,
              net: 0,
            });
          }
          net[bet.seat] -= bet.amount + oddsLost;
          settlements.push({
            type: 'LOSE',
            seat: bet.seat,
            betId: bet.id,
            at: where,
            label,
            credit: 0,
            debit: bet.amount + oddsLost,
            net: -(bet.amount + oddsLost),
          });
          break;
        }

        case 'WIN': {
          const label = betLabel(bet);
          const where = locate(bet);
          const profit = verdict.win - verdict.vig;
          const returned = verdict.stakeReturns ? bet.amount + bet.odds : 0;
          seats[bet.seat].bankroll += profit + returned;
          net[bet.seat] += profit;
          settlements.push({
            type: 'WIN',
            seat: bet.seat,
            betId: bet.id,
            at: where,
            label,
            credit: profit + returned,
            debit: 0,
            net: profit,
          });
          if (verdict.vig > 0) {
            settlements.push({
              type: 'VIG',
              seat: bet.seat,
              betId: bet.id,
              at: where,
              label: `${label} commission`,
              credit: 0,
              debit: verdict.vig,
              net: 0,
            });
          }
          if (!verdict.stakeReturns) {
            // Place, buy, lay, hardway and riding props all stay on the felt.
            // Odds behind a winning line bet always come down with it, so this
            // branch never carries odds.
            surviving.push(bet);
          }
          break;
        }
      }
    }

    /* ---- 2. Advance the table ---- *
     *
     * The two tracker arrays are rebuilt as plain values and assigned in one
     * go rather than pushed into through the draft. Immer copies the array
     * either way; going through the draft only adds a proxy that the Fire and
     * All/Tall/Small settlement below would then have to read back through. */

    draft.rollCount += 1;
    draft.shooterRollCount += 1;

    let phase = phaseBefore;
    let firePoints = state.firePoints;

    if (outcome === 'POINT_ESTABLISHED') {
      phase = 'POINT_SET';
      draft.phase = 'POINT_SET';
      draft.point = t as PointNumber;
    } else if (outcome === 'POINT_MADE') {
      const made = state.point!;
      if (!firePoints.includes(made)) {
        firePoints = [...firePoints, made];
        draft.firePoints = firePoints;
      }
      phase = 'COME_OUT';
      draft.phase = 'COME_OUT';
      draft.point = null;
    } else if (outcome === 'SEVEN_OUT') {
      phase = 'COME_OUT';
      draft.phase = 'COME_OUT';
      draft.point = null;
    }

    /* ---- 3. Side-bet trackers ---- */

    let atsHits = state.atsHits;
    if (t === 7) {
      atsHits = [];
      draft.atsHits = atsHits;
    } else if (!atsHits.includes(t)) {
      atsHits = [...atsHits, t];
      draft.atsHits = atsHits;
    }

    /* ---- 4. Side bets settle ---- */

    let bets = surviving;
    if (sideBets) {
      const stillStanding: Bet[] = [];
      for (const bet of surviving) {
        if (bet.kind === 'ATS') {
          const seat = seats[bet.seat];
          const needed = ATS_NUMBERS[bet.ats!];
          const complete = needed.every((n) => atsHits.includes(n));
          if (complete) {
            const win = bet.amount * ratioValue(atsOdds(bet.ats!));
            seat.bankroll += bet.amount + win;
            net[bet.seat] += win;
            settlements.push({
              type: 'WIN',
              seat: bet.seat,
              betId: bet.id,
              at: locate(bet),
              label: betLabel(bet),
              credit: bet.amount + win,
              debit: 0,
              net: win,
            });
          } else if (t === 7) {
            net[bet.seat] -= bet.amount;
            settlements.push({
              type: 'LOSE',
              seat: bet.seat,
              betId: bet.id,
              at: locate(bet),
              label: betLabel(bet),
              credit: 0,
              debit: bet.amount,
              net: -bet.amount,
            });
          } else {
            stillStanding.push(bet);
          }
          continue;
        }

        if (bet.kind === 'FIRE') {
          if (outcome === 'SEVEN_OUT') {
            const seat = seats[bet.seat];
            const points = firePoints.length;
            const payRatio = fireOdds(points);
            if (payRatio) {
              const win = bet.amount * ratioValue(payRatio);
              seat.bankroll += bet.amount + win;
              net[bet.seat] += win;
              settlements.push({
                type: 'WIN',
                seat: bet.seat,
                betId: bet.id,
                at: locate(bet),
                label: `Fire Bet (${points} points)`,
                credit: bet.amount + win,
                debit: 0,
                net: win,
              });
            } else {
              net[bet.seat] -= bet.amount;
              settlements.push({
                type: 'LOSE',
                seat: bet.seat,
                betId: bet.id,
                at: locate(bet),
                label: `Fire Bet (${points} points)`,
                credit: 0,
                debit: bet.amount,
                net: -bet.amount,
              });
            }
          } else {
            stillStanding.push(bet);
          }
          continue;
        }

        stillStanding.push(bet);
      }
      bets = stillStanding;
    }

    /* ---- 5. Seven-out hands the dice on ---- */

    if (outcome === 'SEVEN_OUT') {
      draft.firePoints = [];
      draft.shooterRollCount = 0;
      // A solo player keeps the dice: there is nobody to pass them to.
      if (!state.solo) draft.shooter = state.shooter === 'A' ? 'B' : 'A';
    }

    /* ---- 6. Reset the ON/OFF pucks for the new phase ---- */

    if (phaseBefore !== phase) {
      bets = withPhaseDefaults(bets, phase === 'COME_OUT', state.rules);
    }

    draft.bets = bets;

    /* ---- 7. Bookkeeping ---- */

    for (const id of SEAT_IDS) {
      const s = seats[id];
      if (s.bankroll > s.peak) s.peak = s.bankroll;
    }

    const stats = draft.stats;
    stats.rolls += 1;
    stats.totals[t] += 1;
    if (roll.d1 === roll.d2 && (t === 4 || t === 6 || t === 8 || t === 10)) {
      stats.hardCounts[t] += 1;
    }
    if (outcome === 'POINT_MADE') stats.pointsMade += 1;
    if (outcome === 'NATURAL') stats.naturals += 1;
    if (outcome === 'CRAPS') stats.crapsRolls += 1;
    if (outcome === 'SEVEN_OUT') {
      stats.sevenOuts += 1;
      if (stats.currentHand > stats.longestHand) stats.longestHand = stats.currentHand;
      stats.currentHand = 0;
    } else {
      stats.currentHand += 1;
    }

  });

  // The roll history is deliberately kept outside the draft. Immer has to
  // proxy every element of an array it sees mutated, and shifting a windowed
  // history on each roll costs roughly forty times the rest of the resolver
  // put together. A plain copy of a few hundred frozen records is free by
  // comparison.
  const record: RollRecord = {
    index: next.rollCount,
    roll,
    phaseBefore,
    pointBefore,
    phaseAfter: next.phase,
    pointAfter: next.point,
    shooter: state.shooter,
    net,
    outcome,
  };
  const limit = next.rules.historyLimit;
  let history: RollRecord[];
  if (limit <= 0) {
    history = EMPTY_HISTORY;
  } else {
    // Spread rather than slice, and slice only the unfrozen copy. `history` is
    // frozen at the end of every roll, and a frozen array drops out of V8's
    // fast path for `slice` — measured at 21us per copy against 0.2us for the
    // same slice on a plain array. The spread form goes through the iterator
    // and stays fast, so the window is copied once and trimmed afterwards.
    const window = [...next.history];
    window.push(record);
    history = window.length > limit ? window.slice(window.length - limit) : window;
  }

  // Freezing here is not just hygiene. Immer deep-freezes whatever it produces,
  // and it stops the moment it meets something already frozen — so sealing the
  // array ourselves keeps the next produce from re-walking the whole window.
  Object.freeze(record.net);
  Object.freeze(record);
  Object.freeze(history);

  return {
    state: { ...next, history },
    settlements,
    record,
  };
}

/* ------------------------------------------------------------------ *
 * Phase defaults
 *
 * The house ON/OFF rules live in these two functions and nowhere else, so the
 * in-place version below (which runs against an immer draft) and the copying
 * version `applyRoll` uses (which runs against plain frozen bets) cannot drift
 * apart.
 * ------------------------------------------------------------------ */

/** The working flag a bet should carry as the table enters a phase. */
function defaultWorking(bet: Bet, enteringComeOut: boolean, rules: TableRules): boolean {
  switch (bet.kind) {
    case 'PLACE':
    case 'BUY':
      return enteringComeOut ? !rules.placeOffOnComeOut : true;
    case 'HARDWAY':
      return enteringComeOut ? !rules.hardwaysOffOnComeOut : true;
    default:
      return bet.working;
  }
}

/** The odds-working flag likewise. Odds behind a come point sleep through a come-out. */
function defaultOddsWorking(bet: Bet, enteringComeOut: boolean): boolean {
  if (bet.kind === 'COME' && bet.number !== undefined) return !enteringComeOut;
  return bet.oddsWorking;
}

/**
 * Resets each bet's ON/OFF state to the house default for the phase the table
 * is entering. Place, buy and hardway bets go off for a come-out roll (if the
 * rules say so) and come back on once a point is set; come odds do the same.
 *
 * Mutates in place, so it is for drafts and freshly built arrays only.
 */
export function applyPhaseDefaults(bets: Bet[], enteringComeOut: boolean, rules: TableRules): void {
  for (const bet of bets) {
    bet.working = defaultWorking(bet, enteringComeOut, rules);
    bet.oddsWorking = defaultOddsWorking(bet, enteringComeOut);
  }
}

/**
 * The same rules applied without mutating anything.
 *
 * `applyRoll` carries unchanged bets across by reference rather than through
 * an immer draft, so by the time the pucks are reset the bets in hand are the
 * frozen originals. A bet whose flags already read correctly is passed through
 * untouched — which is exactly what immer's own set trap did, since assigning
 * a value equal to the current one never marks a draft as modified.
 */
function withPhaseDefaults(bets: Bet[], enteringComeOut: boolean, rules: TableRules): Bet[] {
  let changed = false;
  const out: Bet[] = new Array(bets.length);
  for (let i = 0; i < bets.length; i++) {
    const bet = bets[i];
    const working = defaultWorking(bet, enteringComeOut, rules);
    const oddsWorking = defaultOddsWorking(bet, enteringComeOut);
    if (working === bet.working && oddsWorking === bet.oddsWorking) {
      out[i] = bet;
    } else {
      out[i] = { ...bet, working, oddsWorking };
      changed = true;
    }
  }
  return changed ? out : bets;
}
