/**
 * Settlement.
 *
 * The only function in the codebase that pays anybody. Everything before it —
 * the deal, the Play — has taken chips *out* of bankrolls and put them on the
 * felt. This puts back whatever is owed, seat by seat from the dealer's left,
 * and within a seat in the order the rule sheet settles them: the Ante, then
 * the Play, then Pair Plus, then the 6 Card Bonus.
 *
 * `settle` returns the new table, a list of {@link Settlement} records for the
 * UI to show, and the {@link RoundRecord} that goes into the history. It never
 * animates anything and never reads a clock.
 *
 * The distinction that keeps a settlement function honest is the same one the
 * blackjack resolver draws: every stake has already left the bankroll, so what
 * goes *back* (`returned`: the stake plus any winnings) and what the ledger
 * records (`net`: the signed change) are different numbers, and they are named
 * apart everywhere.
 */

import { anteBonusLine, anteBonusTable, pairPlusLine, pairPlusTable, payOn, ratioWords, sixCardLine, sixCardTable, PAY_HAND_LABEL } from './paytables';
import { bestFive, evaluate3, handName, qualifies, type ThreeCardHand } from './poker';
import type {
  Card,
  Outcome,
  RoundRecord,
  Seat,
  SeatRecord,
  SeatResult,
  Settlement,
  TableRules,
  TableState,
} from './types';
import { cardLabel } from './types';

export interface SettleResult {
  table: TableState;
  settlements: Settlement[];
  record: RoundRecord;
}

/** Kept short enough that the charts stay responsive on a phone. */
const HISTORY_LIMIT = 300;

/**
 * Work out one seat against the dealer.
 *
 * Split out because it is the piece worth reading on its own, and the piece
 * the tests pin branch by branch. It reads the seat and returns what it won;
 * `settle` does the bookkeeping.
 */
export function settleSeat(
  seat: Seat,
  dealerCards: readonly Card[],
  rules: TableRules,
): { result: SeatResult; returned: number; settlements: Array<Omit<Settlement, 'seat'>> } {
  const hand = evaluate3(seat.cards);
  const dealer = evaluate3(dealerCards);
  const w = seat.wagers;
  const settlements: Array<Omit<Settlement, 'seat'>> = [];
  let returned = 0;

  /*
   * A seat with an Ante and no decision cannot reach here through the table —
   * SHOWDOWN opens only once every Ante has been decided — but a damaged
   * saved round could. Treating it as a fold is the answer that can never
   * pay out money nobody chose to risk.
   */
  const folded = w.ante > 0 && seat.decision !== 'PLAY';

  /* --- the Ante, the Play and the Ante Bonus --- */
  let outcome: Outcome | null = null;
  let ante = 0;
  let play = 0;
  let anteBonus = 0;

  if (w.ante > 0) {
    if (folded) {
      outcome = 'FOLD';
      ante = -w.ante;
      settlements.push({ kind: 'ANTE', net: ante, label: 'Folded' });
    } else {
      ({ outcome, ante, play } = showdown(hand, dealer, w.ante, w.play));
      returned += w.ante + ante + w.play + play;
      settlements.push({ kind: 'ANTE', net: ante, label: anteLabel(outcome) });
      settlements.push({ kind: 'PLAY', net: play, label: playLabel(outcome) });

      /*
       * The Ante Bonus is paid on the hand, not on the showdown: a straight or
       * better collects it whether the dealer qualified, lost, or beat it. It
       * is the one part of the main game a losing hand can still be paid on,
       * and the reason it exists is to make playing a straight worth more than
       * the dealer can take away.
       */
      const bonusLine = anteBonusLine(anteBonusTable(rules.anteBonusTable), hand);
      if (bonusLine) {
        anteBonus = payOn(bonusLine, w.ante);
        returned += anteBonus;
        settlements.push({
          kind: 'ANTE_BONUS',
          net: anteBonus,
          label: `Ante Bonus: ${PAY_HAND_LABEL[bonusLine.hand].toLowerCase()} ${ratioWords(bonusLine.ratio)}`,
        });
      }
    }
  }

  /* --- Pair Plus --- */
  let pairPlus = 0;
  if (w.pairPlus > 0) {
    if (folded) {
      // "If a player has placed a Pair Plus wager, but does not make a Play
      // wager, the player shall forfeit the wager, as well as, the Ante wager."
      pairPlus = -w.pairPlus;
      settlements.push({ kind: 'PAIR_PLUS', net: pairPlus, label: 'Pair Plus forfeited' });
    } else {
      const ppLine = pairPlusLine(pairPlusTable(rules.pairPlusTable), hand);
      if (ppLine) {
        pairPlus = payOn(ppLine, w.pairPlus);
        returned += w.pairPlus + pairPlus;
        settlements.push({
          kind: 'PAIR_PLUS',
          net: pairPlus,
          label: `Pair Plus: ${PAY_HAND_LABEL[ppLine.hand].toLowerCase()} ${ratioWords(ppLine.ratio)}`,
        });
      } else {
        pairPlus = -w.pairPlus;
        settlements.push({ kind: 'PAIR_PLUS', net: pairPlus, label: 'Pair Plus loses' });
      }
    }
  }

  /* --- the 6 Card Bonus, which a fold does not touch --- */
  let sixCard = 0;
  let sixCardHand: SeatResult['sixCardHand'] = null;
  if (w.sixCard > 0) {
    sixCardHand = bestFive([...seat.cards, ...dealerCards]);
    const scLine = sixCardLine(sixCardTable(rules.sixCardTable), sixCardHand);
    if (scLine) {
      sixCard = payOn(scLine, w.sixCard);
      returned += w.sixCard + sixCard;
      settlements.push({
        kind: 'SIX_CARD',
        net: sixCard,
        label: `6 Card Bonus: ${PAY_HAND_LABEL[scLine.hand].toLowerCase()} ${ratioWords(scLine.ratio)}`,
      });
    } else {
      sixCard = -w.sixCard;
      settlements.push({ kind: 'SIX_CARD', net: sixCard, label: '6 Card Bonus loses' });
    }
  }

  return {
    result: {
      hand: hand.category,
      handName: handName(hand),
      outcome,
      ante,
      play,
      anteBonus,
      pairPlus,
      sixCard,
      sixCardHand,
      net: ante + play + anteBonus + pairPlus + sixCard,
    },
    returned,
    settlements,
  };
}

/**
 * The Ante and the Play against the dealer, in the order the rule sheet
 * decides them.
 *
 * The qualifier comes first and it is the part people get backwards: a dealer
 * who fails to qualify *pays* the Ante and pushes the Play, whatever the
 * player holds — a player's Q-6-4 is paid against a dealer's J-10-8 even
 * though it would lose to a qualifying one. Only a qualifying dealer compares
 * hands at all.
 */
export function showdown(
  hand: ThreeCardHand,
  dealer: ThreeCardHand,
  anteStake: number,
  playStake: number,
): { outcome: Outcome; ante: number; play: number } {
  if (!qualifies(dealer)) return { outcome: 'NO_QUALIFY', ante: anteStake, play: 0 };
  if (hand.score > dealer.score) return { outcome: 'WIN', ante: anteStake, play: playStake };
  if (hand.score === dealer.score) return { outcome: 'PUSH', ante: 0, play: 0 };
  return { outcome: 'LOSE', ante: -anteStake, play: -playStake };
}

/**
 * Settle the whole table.
 *
 * Refuses any table that is not at SETTLE, or has already been settled, by
 * returning it untouched with an empty settlement list rather than by
 * throwing: the UI drives this off a phase transition and a double-fire is a
 * scheduling accident, not a bug worth crashing a session over.
 */
export function settle(table: TableState): SettleResult {
  if (table.phase !== 'SETTLE' || table.settled) {
    return { table, settlements: [], record: emptyRecord(table) };
  }

  const dealerCards = table.dealer.cards;
  const dealer = evaluate3(dealerCards);
  const settlements: Settlement[] = [];
  const seatRecords: SeatRecord[] = [];

  const seats = table.seats.map((seat): Seat => {
    if (seat.cards.length === 0) return seat;

    const { result, returned, settlements: own } = settleSeat(seat, dealerCards, table.rules);
    for (const s of own) settlements.push({ ...s, seat: seat.id });

    const bankroll = seat.bankroll + returned;
    const main = result.ante + result.play + result.anteBonus;
    const s = seat.stats;
    const stats = {
      ...s,
      wins: s.wins + (result.outcome === 'WIN' ? 1 : 0),
      noQualify: s.noQualify + (result.outcome === 'NO_QUALIFY' ? 1 : 0),
      pushes: s.pushes + (result.outcome === 'PUSH' ? 1 : 0),
      losses: s.losses + (result.outcome === 'LOSE' ? 1 : 0),
      mainNet: s.mainNet + main,
      anteBonusNet: s.anteBonusNet + result.anteBonus,
      pairPlusNet: s.pairPlusNet + result.pairPlus,
      sixCardNet: s.sixCardNet + result.sixCard,
      net: s.net + result.net,
      peakBankroll: Math.max(s.peakBankroll, bankroll),
    };

    const w = seat.wagers;
    seatRecords.push({
      seat: seat.id,
      cards: seat.cards.map(cardLabel).join(' '),
      hand: result.hand,
      decision: seat.decision,
      outcome: result.outcome,
      wagered: w.ante + w.play + w.pairPlus + w.sixCard,
      mainNet: main,
      pairPlusNet: result.pairPlus,
      sixCardNet: result.sixCard,
      sixCardHand: result.sixCardHand,
      net: result.net,
    });

    return { ...seat, bankroll, result, stats };
  });

  const record: RoundRecord = {
    round: table.round,
    dealerCards: dealerCards.map(cardLabel).join(' '),
    dealerHand: dealer.category,
    dealerQualified: qualifies(dealer),
    seats: seatRecords,
    net: seatRecords.reduce((n, r) => n + r.net, 0),
  };

  return {
    table: {
      ...table,
      seats,
      settled: true,
      dealer: { ...table.dealer, revealed: true },
      history: [record, ...table.history].slice(0, HISTORY_LIMIT),
    },
    settlements,
    record,
  };
}

function anteLabel(outcome: Outcome): string {
  switch (outcome) {
    case 'WIN':
      return 'Ante wins';
    case 'NO_QUALIFY':
      return 'Ante wins — dealer does not qualify';
    case 'PUSH':
      return 'Ante pushes';
    case 'LOSE':
      return 'Ante loses';
    case 'FOLD':
      return 'Folded';
  }
}

function playLabel(outcome: Outcome): string {
  switch (outcome) {
    case 'WIN':
      return 'Play wins';
    case 'NO_QUALIFY':
      return 'Play pushes';
    case 'PUSH':
      return 'Play pushes';
    case 'LOSE':
      return 'Play loses';
    case 'FOLD':
      return 'Folded';
  }
}

export function outcomeLabel(outcome: Outcome): string {
  switch (outcome) {
    case 'WIN':
      return 'Win';
    case 'NO_QUALIFY':
      return 'Dealer does not qualify';
    case 'PUSH':
      return 'Push';
    case 'LOSE':
      return 'Lose';
    case 'FOLD':
      return 'Fold';
  }
}

function emptyRecord(table: TableState): RoundRecord {
  return {
    round: table.round,
    dealerCards: '',
    dealerHand: 'HIGH_CARD',
    dealerQualified: false,
    seats: [],
    net: 0,
  };
}
