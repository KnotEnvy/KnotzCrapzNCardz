/**
 * Hand mathematics.
 *
 * Everything about what a set of cards is worth and what it may legally do.
 * Pure functions over card arrays: no state, no rules lookup beyond what is
 * passed in. This is the file the resolver, the basic-strategy chart, the
 * dealer's own play and the button bar all read from, which is what stops the
 * felt from offering a double the engine would then refuse.
 */

import type { Card, Hand, Rank, TableRules } from './types';
import { isAce, isTen, rankValue } from './types';

/* ------------------------------------------------------------------ *
 * Totals
 * ------------------------------------------------------------------ */

export interface HandValue {
  /** The best total at or under 21, or the hard total if the hand is bust. */
  total: number;
  /** True when an ace is still counted as eleven — i.e. the total can retreat. */
  soft: boolean;
  /** The total with every ace counted as one. Never above the soft total. */
  hard: number;
  busted: boolean;
}

/**
 * Score a hand.
 *
 * A hand has at most one ace worth eleven — two would be 22 — so the whole of
 * soft-hand logic is "add them all as eleven, then demote until you fit".
 */
export function handValue(cards: readonly Card[]): HandValue {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    total += rankValue(card.rank);
    if (isAce(card)) aces++;
  }
  const hard = total - aces * 10;
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return { total, soft: aces > 0, hard, busted: total > 21 };
}

/** Just the number, for the places that only want it. */
export function total(cards: readonly Card[]): number {
  return handValue(cards).total;
}

export function isBusted(cards: readonly Card[]): boolean {
  return handValue(cards).busted;
}

/**
 * A natural: exactly two cards, an ace and a ten-value, on a hand that was
 * dealt rather than split into existence.
 *
 * The split test is not decoration. Ace-ten on a split hand is twenty-one and
 * pays even money everywhere on earth, and getting that wrong is worth about
 * a tenth of a percent to whoever it favours.
 */
export function isBlackjack(cards: readonly Card[], splitDepth = 0): boolean {
  if (cards.length !== 2 || splitDepth > 0) return false;
  return (isAce(cards[0]) && isTen(cards[1])) || (isTen(cards[0]) && isAce(cards[1]));
}

export function handIsBlackjack(hand: Hand): boolean {
  return isBlackjack(hand.cards, hand.splitDepth);
}

/**
 * Are these two cards a splittable pair?
 *
 * By rank *value*, not by rank: a king and a jack are both tens and split at
 * every casino in the world, however bad an idea it is. The strategy chart
 * cares about the distinction only for the display, and handles that itself.
 */
export function isPair(cards: readonly Card[]): boolean {
  return cards.length === 2 && rankValue(cards[0].rank) === rankValue(cards[1].rank);
}

/** The rank a pair should be charted as: 10 for any ten-value, 11 for aces. */
export function pairRank(cards: readonly Card[]): number | null {
  if (!isPair(cards)) return null;
  return rankValue(cards[0].rank);
}

/* ------------------------------------------------------------------ *
 * Legality
 * ------------------------------------------------------------------ */

/**
 * Why an action is unavailable, in the words the tooltip uses.
 *
 * Returning a reason rather than a boolean is what lets the button bar grey a
 * control *and* say why — "the house does not allow doubling after a split"
 * reads as a rule, while a dead button reads as a bug.
 */
export interface Legality {
  allowed: boolean;
  reason?: string;
}

const OK: Legality = { allowed: true };

function no(reason: string): Legality {
  return { allowed: false, reason };
}

/** Hitting is legal on any live hand that is not a one-card split ace. */
export function canHit(hand: Hand, rules: TableRules): Legality {
  if (hand.done) return no('This hand has finished.');
  if (hand.doubled) return no('A doubled hand takes exactly one card.');
  if (hand.fromSplitAces && rules.oneCardOnSplitAces) {
    return no('Split aces take one card each.');
  }
  if (handValue(hand.cards).total >= 21) return no('Twenty-one takes no more cards.');
  return OK;
}

export function canStand(hand: Hand): Legality {
  if (hand.done) return no('This hand has finished.');
  return OK;
}

/**
 * Doubling.
 *
 * Three gates, in the order a dealer would apply them: two cards only, the
 * house's total restriction, and whether this hand came from a split.
 */
export function canDouble(hand: Hand, rules: TableRules, bankroll: number): Legality {
  if (hand.done) return no('This hand has finished.');
  if (hand.cards.length !== 2) return no('Doubling is a first-two-cards move.');
  if (hand.doubled) return no('Already doubled.');
  if (hand.splitDepth > 0 && !rules.das) return no('This table does not allow doubling after a split.');
  if (hand.fromSplitAces && rules.oneCardOnSplitAces) return no('Split aces take one card each.');
  if (bankroll < hand.bet) return no('Not enough bankroll to match the bet.');

  const v = handValue(hand.cards);
  if (v.soft) {
    if (!rules.doubleSoft) return no('This table does not allow doubling a soft total.');
    // A soft total that the house restricts by total is judged on the soft
    // total — soft 19 is a "19", not a "9". Tables that restrict to 9-11 are
    // therefore refusing every soft double except soft 21, which cannot
    // happen on two cards; doubleSoft is the honest control and this is the
    // consistent consequence of the two rules being independent.
    if (rules.double !== 'ANY2' && !inDoubleRange(v.total, rules)) {
      return no(`This table only doubles on ${rules.double}.`);
    }
    return OK;
  }
  if (!inDoubleRange(v.hard, rules)) return no(`This table only doubles on ${rules.double}.`);
  return OK;
}

function inDoubleRange(t: number, rules: TableRules): boolean {
  switch (rules.double) {
    case 'ANY2':
      return true;
    case '9-11':
      return t >= 9 && t <= 11;
    case '10-11':
      return t >= 10 && t <= 11;
  }
}

/**
 * Splitting.
 *
 * `resplitTo` counts extra hands, so a seat already holding `resplitTo + 1`
 * hands is finished splitting. Aces get their own gate on top of that.
 */
export function canSplit(
  hand: Hand,
  handsInSeat: number,
  rules: TableRules,
  bankroll: number,
): Legality {
  if (hand.done) return no('This hand has finished.');
  if (hand.cards.length !== 2) return no('Splitting is a first-two-cards move.');
  if (!isPair(hand.cards)) return no('Only a pair can be split.');
  if (handsInSeat > rules.resplitTo) {
    // "splits to 1 hands" is what this said when `resplitTo` was zero — a
    // table that books no splits at all. The setup screen cannot build one,
    // but a persisted or hand-edited rules object can, and a refusal is the
    // one sentence a player reads when the table says no.
    return no(rules.resplitTo === 0 ? 'This table does not split.' : `This table splits to ${rules.resplitTo + 1} hands.`);
  }
  if (isAce(hand.cards[0]) && hand.splitDepth > 0 && !rules.resplitAces) {
    return no('This table does not re-split aces.');
  }
  if (bankroll < hand.baseBet) return no('Not enough bankroll to match the bet.');
  return OK;
}

/**
 * Surrender.
 *
 * The two-card test is the whole rule: you may fold the hand you were dealt,
 * never one you have drawn to or split. Whether the offer survives a dealer
 * ten or ace showing is a phase question, decided in table.ts — early
 * surrender is taken before the peek, late surrender after it.
 */
export function canSurrender(hand: Hand, rules: TableRules): Legality {
  if (rules.surrender === 'NONE') return no('This table does not offer surrender.');
  if (hand.done) return no('This hand has finished.');
  if (hand.cards.length !== 2) return no('Surrender is a first-two-cards move.');
  if (hand.splitDepth > 0) return no('A split hand cannot be surrendered.');
  return OK;
}

/* ------------------------------------------------------------------ *
 * Dealer play
 * ------------------------------------------------------------------ */

/**
 * Does the dealer draw?
 *
 * The dealer has no choices, only this predicate. Stand on 17 or more, except
 * that an H17 table draws to a soft seventeen — ace-six is seventeen that
 * cannot be broken by one card, and drawing it is worth 0.22% to the house.
 */
export function dealerShouldHit(cards: readonly Card[], rules: TableRules): boolean {
  const v = handValue(cards);
  if (v.total < 17) return true;
  if (v.total === 17 && v.soft && rules.hitsSoft17) return true;
  return false;
}

/* ------------------------------------------------------------------ *
 * Display
 * ------------------------------------------------------------------ */

/**
 * `12` / `A,6 = 7 or 17` — what sits under a hand on the felt.
 *
 * A soft hand shows both readings because that is the information the player
 * is actually using; a hard hand shows one number because a second would be
 * noise.
 */
export function displayTotal(cards: readonly Card[]): string {
  if (cards.length === 0) return '—';
  const v = handValue(cards);
  if (v.busted) return `${v.hard}`;
  if (v.soft && v.hard !== v.total) return `${v.hard}/${v.total}`;
  return `${v.total}`;
}

/** The rank the dealer is showing, which is all basic strategy needs. */
export function upcardRank(cards: readonly Card[]): Rank | null {
  return cards.length > 0 ? cards[0].rank : null;
}
