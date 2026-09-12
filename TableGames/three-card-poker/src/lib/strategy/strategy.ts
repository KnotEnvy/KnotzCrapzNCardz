/**
 * Play or fold.
 *
 * Three Card Poker asks the player one question per hand, and it has an exact
 * answer. Every strategy card prints it as a line — play queen-six-four or
 * better — and this file answers it the long way round instead: for the three
 * cards actually in front of the player, it walks every one of the 18,424
 * hands the dealer could be holding and adds up what playing is worth against
 * each. `analysis.test.ts` has already shown the two methods agree on all
 * 22,100 hands, so the long way is not about getting a different answer.
 *
 * It is about the size of the answer. "Q-6-3 folds" is a rule; "playing Q-6-3
 * costs a hundredth of an Ante more than folding it" is the reason the rule is
 * where it is, and it is the only thing that makes a trainer's verdict mean
 * anything. A player who folds a K-4-2 has not broken a rule, they have given
 * up a measurable amount of money, and this is what measures it.
 *
 * The one wager that can change the numbers is Pair Plus. Folding forfeits it,
 * so a seat that folds a pair gives up a paid bet as well as an Ante. The
 * strategy line never folds a pair, so it changes no decision — but it does
 * change what a bad fold costs, and the grading counts it. The 6 Card Bonus
 * rides whatever the player does, so it is in neither side of the sum.
 */

import { dealerOdds, playReturn, type DealerOdds, type StrategyId } from '@/lib/engine/analysis';
import { anteBonusLine, anteBonusTable, pairPlusLine, pairPlusTable, payOn } from '@/lib/engine/paytables';
import { evaluate3, handName, Q64_SCORE, QUALIFYING_SCORE } from '@/lib/engine/poker';
import type { Card, Decision, Seat, TableRules, Wagers } from '@/lib/engine/types';

export interface Advice {
  /** The better of the two, by expected value. Playing wins a tie. */
  decision: Decision;
  /** Expected cents for each choice, given this seat's actual wagers. */
  ev: Record<Decision, number>;
  /**
   * What playing returns on the Ante and Play, Ante Bonus included, in units
   * of the Ante. Folding is exactly −1, so this is the number the decision
   * turns on, stripped of how much happens to be riding on it.
   */
  playUnits: number;
  /** The dealer's hands against this one, for showing the working. */
  odds: DealerOdds;
  /** What the printed line says: Q-6-4 or better plays. */
  line: Decision;
  handName: string;
  why: string;
}

/**
 * The exact answer for three cards and the wagers riding on them.
 *
 * Null when there is nothing to decide: no Ante, or not a three-card hand.
 */
export function advise(cards: readonly Card[], wagers: Pick<Wagers, 'ante' | 'pairPlus'>, rules: TableRules): Advice | null {
  if (cards.length !== 3 || wagers.ante <= 0) return null;
  const hand = evaluate3(cards);
  const odds = dealerOdds(cards);
  if (odds.hands === 0) return null;

  const bonusLine = anteBonusLine(anteBonusTable(rules.anteBonusTable), hand);
  const bonusUnits = bonusLine ? bonusLine.ratio[0] / bonusLine.ratio[1] : 0;
  const playUnits = playReturn(odds) + bonusUnits;

  // Pair Plus is decided by the cards alone, so it is a certainty on each side
  // of the choice rather than an expectation.
  const ppLine = wagers.pairPlus > 0 ? pairPlusLine(pairPlusTable(rules.pairPlusTable), hand) : null;
  const pairPlusIfPlayed = wagers.pairPlus > 0 ? (ppLine ? payOn(ppLine, wagers.pairPlus) : -wagers.pairPlus) : 0;
  const pairPlusIfFolded = -wagers.pairPlus;

  const ev: Record<Decision, number> = {
    PLAY: wagers.ante * playUnits + pairPlusIfPlayed,
    FOLD: -wagers.ante + pairPlusIfFolded,
  };
  const decision: Decision = ev.PLAY >= ev.FOLD ? 'PLAY' : 'FOLD';
  const line: Decision = hand.score >= Q64_SCORE ? 'PLAY' : 'FOLD';

  return {
    decision,
    ev,
    playUnits,
    odds,
    line,
    handName: handName(hand),
    why: explain(decision, playUnits, hand.category === 'HIGH_CARD' ? handName(hand) : null, ppLine !== null && wagers.pairPlus > 0),
  };
}

export function adviseSeat(seat: Seat, rules: TableRules): Advice | null {
  return advise(seat.cards, seat.wagers, rules);
}

/**
 * The reason, in a sentence.
 *
 * Built from the number rather than written per hand, so it cannot say
 * something the arithmetic beside it does not.
 */
function explain(decision: Decision, playUnits: number, highCard: string | null, paysPairPlus: boolean): string {
  const units = Math.abs(playUnits).toFixed(3);
  const head =
    playUnits >= 0
      ? `Playing wins ${units} of an Ante on average; folding loses a whole one.`
      : decision === 'PLAY'
        ? `Playing loses ${units} of an Ante on average — less than the whole one a fold gives up.`
        : `Playing loses ${units} of an Ante on average — more than the one a fold gives up.`;
  const tail = highCard
    ? ` ${highCard} is ${decision === 'PLAY' ? 'at or above' : 'below'} Q-6-4.`
    : paysPairPlus
      ? ' Folding would also forfeit a Pair Plus that pays.'
      : '';
  return head + tail;
}

/**
 * Mark a decision against the exact answer.
 *
 * `evGivenUp` is what the other choice was worth over the one made, in cents,
 * and zero when the choice was the better one.
 */
export function grade(advice: Advice, chosen: Decision): { correct: boolean; evGivenUp: number } {
  const correct = chosen === advice.decision;
  return { correct, evGivenUp: correct ? 0 : advice.ev[advice.decision] - advice.ev[chosen] };
}

/**
 * What a strategy does with a hand.
 *
 * The bot and the measurement suite both come through here, so the strategies
 * the setup screen prices are the strategies the simulation deals.
 */
export function decisionFor(strategy: StrategyId, cards: readonly Card[], wagers: Wagers, rules: TableRules): Decision {
  switch (strategy) {
    case 'OPTIMAL':
      return advise(cards, wagers, rules)?.decision ?? 'FOLD';
    case 'Q64':
      return evaluate3(cards).score >= Q64_SCORE ? 'PLAY' : 'FOLD';
    case 'MIMIC':
      return evaluate3(cards).score >= QUALIFYING_SCORE ? 'PLAY' : 'FOLD';
    case 'ALWAYS':
      return 'PLAY';
  }
}
