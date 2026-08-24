/**
 * Turning a rule back into the sentence a player would have said.
 *
 * There is exactly one describer, and everything that shows a rule reads from
 * it: the collapsed rows in the workshop, the summary under each strategy in
 * the library, and the running log of what a seat actually did. Keeping it in
 * one place is what stops the builder from claiming one thing while the log
 * reports another.
 */

import { PROP_LABELS } from '@/lib/engine/odds';
import type { BetKind } from '@/lib/engine/types';
import type {
  Action,
  Amount,
  BetTarget,
  Comparison,
  Condition,
  NumberRef,
  OddsTarget,
  OnceScope,
  Strategy,
  StrategyRule,
  TakeDownTarget,
  Trigger,
} from './types';

/* ------------------------------------------------------------------ *
 * Vocabulary
 * ------------------------------------------------------------------ */

export const TRIGGER_LABELS: Record<Trigger, string> = {
  COME_OUT: 'On the come-out',
  POINT_ON: 'With the point on',
  HAND_START: 'When a new shooter takes the dice',
  EVERY_ROLL: 'Every roll',
  POINT_SET: 'When the point is set',
  POINT_MADE: 'When the point is made',
  SEVEN_OUT: 'On a seven out',
  NUMBER_HIT: 'When a box number hits',
  CRAPS: 'On a craps roll',
  NATURAL: 'On a come-out seven or eleven',
};

export const TRIGGER_HINTS: Record<Trigger, string> = {
  COME_OUT: 'Before the dice fly, with no point established',
  POINT_ON: 'Before the dice fly, with a point established',
  HAND_START: 'Once the dice pass, before the new shooter throws',
  EVERY_ROLL: 'At every chance to bet, whatever the table is doing',
  POINT_SET: 'The roll that just established the point',
  POINT_MADE: 'The roll that just made the point',
  SEVEN_OUT: 'The roll that just ended the hand',
  NUMBER_HIT: 'The roll that just landed on 4, 5, 6, 8, 9 or 10',
  CRAPS: 'The roll that just showed 2, 3 or 12',
  NATURAL: 'A 7 or 11 thrown on a come-out',
};

export const ONCE_LABELS: Record<OnceScope, string> = {
  ALWAYS: 'every time it applies',
  ROLL: 'once per roll',
  POINT: 'once per point',
  HAND: 'once per shooter',
  SESSION: 'once per session',
};

const COMPARISON_WORDS: Record<Comparison, string> = {
  EQ: 'is',
  NE: 'is not',
  GT: 'is more than',
  GTE: 'is at least',
  LT: 'is under',
  LTE: 'is at most',
};

export const BET_KIND_LABELS: Record<BetKind, string> = {
  PASS: 'Pass Line',
  DONT_PASS: "Don't Pass",
  COME: 'Come',
  DONT_COME: "Don't Come",
  PLACE: 'Place',
  BUY: 'Buy',
  LAY: 'Lay',
  BIG: 'Big',
  HARDWAY: 'Hard',
  FIELD: 'Field',
  PROP: 'Proposition',
  HOP: 'Hop',
  FIRE: 'Fire Bet',
  ATS: 'All / Tall / Small',
};

/** Bet kinds that take a box number. */
export const NUMBERED_KINDS: readonly BetKind[] = ['PLACE', 'BUY', 'LAY', 'HARDWAY', 'BIG'];

export function numberRefLabel(ref: NumberRef): string {
  switch (ref) {
    case 'POINT':
      return 'the point';
    case 'HIT':
      return 'the number that hit';
    case 'INSIDE':
      return 'the inside numbers';
    case 'OUTSIDE':
      return 'the outside numbers';
    case 'ACROSS':
      return 'all six numbers';
    default:
      return `the ${ref}`;
  }
}

/** The same reference where a bare number reads better: "Place 6". */
function numberRefShort(ref: NumberRef): string {
  switch (ref) {
    case 'POINT':
      return 'the point';
    case 'HIT':
      return 'the number that hit';
    case 'INSIDE':
      return 'inside';
    case 'OUTSIDE':
      return 'outside';
    case 'ACROSS':
      return 'across';
    default:
      return String(ref);
  }
}

/* ------------------------------------------------------------------ *
 * Targets and amounts
 * ------------------------------------------------------------------ */

export function targetLabel(target: BetTarget): string {
  const except = target.exceptPoint ? ' except the point' : '';

  switch (target.kind) {
    case 'PASS':
      return 'the pass line';
    case 'DONT_PASS':
      return "don't pass";
    case 'COME':
      return 'come';
    case 'DONT_COME':
      return "don't come";
    case 'FIELD':
      return 'the field';
    case 'FIRE':
      return 'the Fire Bet';
    case 'ATS':
      return target.ats === 'ALL' ? 'All' : target.ats === 'TALL' ? 'Tall' : 'Small';
    case 'PROP':
      return target.prop ? PROP_LABELS[target.prop] : 'a proposition';
    case 'HOP':
      return target.hop ? `the ${target.hop[0]}-${target.hop[1]} hop` : 'a hop';
    case 'PLACE':
      return `place ${numberRefShort(target.number ?? 'POINT')}${except}`;
    case 'BUY':
      return `buy ${numberRefShort(target.number ?? 'POINT')}${except}`;
    case 'LAY':
      return `lay ${numberRefShort(target.number ?? 'POINT')}${except}`;
    case 'HARDWAY':
      return `hard ${numberRefShort(target.number ?? 'POINT')}${except}`;
    case 'BIG':
      return `big ${numberRefShort(target.number ?? 'POINT')}`;
  }
}

/**
 * The same spot as a bare noun, for sentences that talk *about* a bet rather
 * than telling you to make one.
 *
 * "Bet on the pass line" and "my pass line bet is not up" want different
 * shapes, and stacking one on the other is where generated prose starts
 * reading like a robot — "I have no the pass line".
 */
export function targetNoun(target: BetTarget): string {
  const on = (word: string): string => {
    const ref = target.number ?? 'POINT';
    const except = target.exceptPoint ? ' except the point' : '';
    if (typeof ref === 'number') return `${word} ${ref}`;
    if (ref === 'POINT') return `${word} on the point`;
    if (ref === 'HIT') return `${word} on the number that hit`;
    return `${word} ${ref.toLowerCase()}${except}`;
  };

  switch (target.kind) {
    case 'PASS':
      return 'pass line bet';
    case 'DONT_PASS':
      return "don't pass bet";
    case 'COME':
      return 'come bet';
    case 'DONT_COME':
      return "don't come bet";
    case 'FIELD':
      return 'field bet';
    case 'FIRE':
      return 'Fire Bet';
    case 'ATS':
      return `${target.ats === 'ALL' ? 'All' : target.ats === 'TALL' ? 'Tall' : 'Small'} bet`;
    case 'PROP':
      return target.prop ? PROP_LABELS[target.prop] : 'proposition';
    case 'HOP':
      return target.hop ? `${target.hop[0]}-${target.hop[1]} hop` : 'hop';
    case 'PLACE':
      return on('place');
    case 'BUY':
      return on('buy');
    case 'LAY':
      return on('lay');
    case 'HARDWAY':
      return on('hard');
    case 'BIG':
      return on('big');
  }
}

/** Title case for the head of a sentence. */
function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function amountLabel(amount: Amount, unit?: number): string {
  switch (amount.mode) {
    case 'UNITS': {
      const dollars = unit ? ` ($${Math.round(amount.value * unit)})` : '';
      return `${amount.value} unit${amount.value === 1 ? '' : 's'}${dollars}`;
    }
    case 'FIXED':
      return `$${amount.value}`;
    case 'TABLE_MIN':
      return 'the table minimum';
    case 'PCT_BANKROLL':
      return `${amount.value}% of the rack`;
    case 'DOUBLE':
      return 'double';
    case 'WIN':
      return 'what it just won';
    case 'HALF_WIN':
      return 'half what it just won';
    case 'TO':
      return `$${amount.value}`;
    case 'MAX':
      return 'full odds';
    case 'MULTIPLE':
      return `${amount.value}x the flat bet`;
  }
}

const ODDS_TARGET_LABELS: Record<OddsTarget, string> = {
  PASS: 'the pass line',
  DONT_PASS: "don't pass",
  COME: 'every come bet',
  DONT_COME: "every don't come bet",
  ALL: 'every line bet',
};

function takeDownLabel(target: TakeDownTarget): string {
  if (target.all || !target.target) return 'everything that can come down';
  return targetLabel(target.target);
}

/* ------------------------------------------------------------------ *
 * Conditions
 * ------------------------------------------------------------------ */

function numberList(numbers: number[]): string {
  if (numbers.length === 0) return 'any number';
  if (numbers.length === 1) return String(numbers[0]);
  return `${numbers.slice(0, -1).join(', ')} or ${numbers[numbers.length - 1]}`;
}

function compare(subject: string, op: Comparison, value: string): string {
  return `${subject} ${COMPARISON_WORDS[op]} ${value}`;
}

export function describeCondition(cond: Condition): string {
  switch (cond.t) {
    case 'POINT_IS':
      return `the point is ${numberList(cond.numbers)}`;
    case 'HIT_IS':
      return `the number that hit is ${numberList(cond.numbers)}`;
    case 'LAST_TOTAL':
      return compare('the last roll', cond.op, String(cond.value));
    case 'HAS_BET':
      return `my ${targetNoun(cond.target)} is ${cond.has ? 'up' : 'not up'}`;
    case 'BET_AMOUNT':
      return compare(`my ${targetNoun(cond.target)}`, cond.op, `$${cond.value}`);
    case 'BET_COUNT':
      return compare(
        `my number of ${BET_KIND_LABELS[cond.kind].toLowerCase()} bets`,
        cond.op,
        String(cond.value),
      );
    case 'BANKROLL':
      return compare('my rack', cond.op, `$${cond.value}`);
    case 'AT_RISK':
      return compare('what I have on the felt', cond.op, `$${cond.value}`);
    case 'SESSION_NET':
      return compare('my session', cond.op, `$${cond.value}`);
    case 'HAND_NET':
      return compare('this hand', cond.op, `$${cond.value}`);
    case 'ROLLS_THIS_HAND':
      return compare('this hand', cond.op, `${cond.value} roll${cond.value === 1 ? '' : 's'}`);
    case 'HITS_ON':
      return compare(
        `${numberRefLabel(cond.number)} this hand`,
        cond.op,
        `${cond.value} hit${cond.value === 1 ? '' : 's'}`,
      );
    case 'POINTS_THIS_HAND':
      return compare('points made this hand', cond.op, String(cond.value));
    case 'IM_SHOOTING':
      return cond.value ? 'I am shooting' : 'someone else is shooting';
  }
}

/* ------------------------------------------------------------------ *
 * Actions
 * ------------------------------------------------------------------ */

export function describeAction(action: Action, unit?: number): string {
  switch (action.t) {
    case 'BET':
      return action.topUp
        ? `add ${amountLabel(action.amount, unit)} to ${targetLabel(action.target)}`
        : `bring ${targetLabel(action.target)} up to ${amountLabel(action.amount, unit)}`;
    case 'ODDS':
      return action.amount.mode === 'MAX'
        ? `take full odds behind ${ODDS_TARGET_LABELS[action.on]}`
        : `put ${amountLabel(action.amount, unit)} in odds behind ${ODDS_TARGET_LABELS[action.on]}`;
    case 'PRESS':
      if (action.amount.mode === 'DOUBLE') return `double ${numberRefLabel(action.number)}`;
      if (action.amount.mode === 'TO') return `press ${numberRefLabel(action.number)} to $${action.amount.value}`;
      return `press ${numberRefLabel(action.number)} by ${amountLabel(action.amount, unit)}`;
    case 'REGRESS':
      return `bring ${numberRefLabel(action.number)} down to ${amountLabel(action.amount, unit)}`;
    case 'TAKE_DOWN':
      return `take down ${takeDownLabel(action.target)}`;
    case 'WORKING':
      return `turn ${numberRefLabel(action.number)} ${action.on ? 'ON' : 'OFF'}`;
    case 'STOP':
      return `stop betting — ${action.reason}`;
  }
}

/* ------------------------------------------------------------------ *
 * Whole rules
 * ------------------------------------------------------------------ */

/** The one-line sentence shown on a collapsed rule row. */
export function describeRule(rule: StrategyRule, unit?: number): string {
  const when = TRIGGER_LABELS[rule.when];
  const ifs =
    rule.all.length > 0 ? `, if ${rule.all.map(describeCondition).join(' and ')}` : '';
  const thens =
    rule.then.length > 0
      ? rule.then.map((a) => describeAction(a, unit)).join(', then ')
      : 'do nothing';
  return `${when}${ifs}: ${thens}.`;
}

/** The label a rule shows in the log — its note, or the sentence itself. */
export function ruleTitle(rule: StrategyRule, unit?: number): string {
  return rule.note?.trim() || capitalise(describeRule(rule, unit));
}

/** A few lines of prose describing the whole strategy, for the library card. */
export function describeStrategy(strategy: Strategy): string[] {
  return strategy.rules
    .filter((r) => r.enabled)
    .map((r) => ruleTitle(r, strategy.unit));
}
