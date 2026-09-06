/**
 * Settlement.
 *
 * The only function in the codebase that moves money at the end of a round.
 * Everything before it — the deal, the hits, the doubles, the splits — has
 * taken chips *out* of bankrolls and put them on hands. This puts back
 * whatever is owed, and it does so in the order a dealer settles: the offers
 * first, then each seat's hands left to right against the dealer's total.
 *
 * `settle` returns the new table, a list of {@link Settlement} records for the
 * UI to animate, and the {@link RoundRecord} that goes into the history and
 * the charts. It never animates anything itself and it never reads a clock.
 *
 * The one subtlety worth stating up front: a hand's `bet` field already
 * includes any double, and the stake has already left the bankroll. So a win
 * returns `bet + winnings`, a push returns `bet`, and a loss returns nothing —
 * while `net`, which is what the ledger and the charts read, is the *signed
 * change*: `+winnings`, `0`, `-bet`. Conflating those two is how a settlement
 * function ends up paying doubles twice, so they are named apart everywhere.
 */

import { handIsBlackjack, handValue, isBlackjack } from './hand';
import { winnings } from './money';
import { blackjackRatio, INSURANCE_RATIO } from './rules';
import { resolveBustIt } from './sidebets';
import { cardLabel } from './types';
import type {
  Card,
  Hand,
  HandOutcome,
  HandRecord,
  RoundRecord,
  SeatStats,
  Settlement,
  TableRules,
  TableState,
} from './types';

export interface SettleResult {
  table: TableState;
  settlements: Settlement[];
  record: RoundRecord;
}

/**
 * Work out one hand against the dealer.
 *
 * Split out from the loop because it is the piece worth reading on its own:
 * five branches, in the order they take precedence. Surrender first, because a
 * folded hand never compares totals at all. Then a bust, which loses even to a
 * dealer who busts afterwards — that asymmetry is the house edge, the whole of
 * it, and everything else in blackjack is an attempt to claw it back.
 */
export function settleHand(
  hand: Hand,
  dealerCards: readonly Card[],
  dealerBlackjack: boolean,
  rules: TableRules,
): { outcome: HandOutcome; net: number; returned: number } {
  if (hand.surrendered) {
    // Half back. Floored, so an odd wager surrenders in the house's favour,
    // which is what a dealer holding chips actually does.
    const back = Math.floor(hand.bet / 2);
    return { outcome: 'SURRENDER', net: back - hand.bet, returned: back };
  }

  const player = handValue(hand.cards);
  const playerBJ = isBlackjack(hand.cards, hand.splitDepth);

  if (player.busted) {
    return { outcome: 'BUST', net: -hand.bet, returned: 0 };
  }

  if (playerBJ) {
    if (dealerBlackjack) return { outcome: 'PUSH', net: 0, returned: hand.bet };
    const [num, den] = blackjackRatio(rules.blackjackPays);
    const win = winnings(hand.bet, num, den);
    return { outcome: 'BLACKJACK', net: win, returned: hand.bet + win };
  }

  if (dealerBlackjack) {
    // Under PEEK this is unreachable for anything but a two-card hand, because
    // the round ended before a decision was made. Under ENHC it is reachable
    // for a doubled or split hand, and it takes all of it — that is the whole
    // cost of the rule.
    return { outcome: 'LOSE', net: -hand.bet, returned: 0 };
  }

  const dealer = handValue(dealerCards);
  if (dealer.busted || player.total > dealer.total) {
    return { outcome: 'WIN', net: hand.bet, returned: hand.bet * 2 };
  }
  if (player.total === dealer.total) {
    return { outcome: 'PUSH', net: 0, returned: hand.bet };
  }
  return { outcome: 'LOSE', net: -hand.bet, returned: 0 };
}

/**
 * Settle the whole table.
 *
 * Assumes the dealer's hand is finished — `phase` is SETTLE, which only
 * `dealerStep` sets. Calling it twice on the same table would pay twice, so it
 * refuses any other phase by returning the table untouched with an empty
 * settlement list rather than by throwing: the UI drives this off a phase
 * transition and a double-fire is a scheduling accident, not a bug worth
 * crashing a session over.
 */
export function settle(table: TableState, trueCount = 0): SettleResult {
  const settlements: Settlement[] = [];
  const handRecords: HandRecord[] = [];
  const sideRecords: RoundRecord['sideBets'] = [];
  const insuranceRecords: RoundRecord['insurance'] = [];

  if (table.phase !== 'SETTLE' || table.settled) {
    return { table, settlements, record: emptyRecord(table, trueCount) };
  }

  const dealerCards = table.dealer.cards;
  const dealerBJ = isBlackjack(dealerCards);
  const dealerV = handValue(dealerCards);
  const dealerOutcome: RoundRecord['dealerOutcome'] = dealerBJ
    ? 'BLACKJACK'
    : dealerV.busted
      ? 'BUST'
      : 'STAND';

  /*
   * Written as explicit structural updates rather than with immer, for the
   * same reason the player's moves in table.ts are: this reads every card of
   * every hand, and drafting all of them was a third of the simulation's
   * runtime. See the note above `updateSeat` in table.ts.
   */
  const seats = table.seats.map((seat) => {
    if (seat.hands.length === 0 && seat.insurance === 0) return seat;

    let bankroll = seat.bankroll;
    let net = seat.stats.net;
    const stats = { ...seat.stats };

    /* --- insurance, and even money, first --- */
    let insuranceNet = seat.insuranceNet;
    if (seat.insurance > 0) {
      // Insurance pays 2:1 on the hole card being a ten. Even money is the
      // same bet placed for the maximum on a natural, which is why it is
      // stored as insurance and settled here rather than as a payout of its
      // own — the arithmetic comes to exactly 1:1 on the main wager either
      // way, and one code path means the two cannot disagree.
      if (dealerBJ) {
        const win = winnings(seat.insurance, INSURANCE_RATIO[0], INSURANCE_RATIO[1]);
        bankroll += seat.insurance + win;
        insuranceNet = win;
      } else {
        insuranceNet = -seat.insurance;
      }
      net += insuranceNet;
      stats.insuranceNet += insuranceNet;
      insuranceRecords.push({ seat: seat.id, amount: seat.insurance, net: insuranceNet });
      settlements.push({
        seat: seat.id,
        handIndex: null,
        kind: 'INSURANCE',
        net: insuranceNet,
        label: seat.tookEvenMoney
          ? 'Even money'
          : insuranceNet > 0
            ? 'Insurance pays'
            : 'Insurance lost',
      });
    }

    /* --- the hands --- */
    const hands = seat.hands.map((hand, i) => {
      const res = settleHand(hand, dealerCards, dealerBJ, table.rules);
      bankroll += res.returned;
      net += res.net;
      bumpStats(stats, res.outcome, handIsBlackjack(hand));

      settlements.push({
        seat: seat.id,
        handIndex: i,
        kind: 'MAIN',
        net: res.net,
        label: outcomeLabel(res.outcome),
      });
      handRecords.push({
        seat: seat.id,
        handIndex: i,
        cards: hand.cards.map(cardLabel).join(' '),
        total: handValue(hand.cards).total,
        bet: hand.bet,
        outcome: res.outcome,
        net: res.net,
      });

      return { ...hand, outcome: res.outcome, net: res.net };
    });

    /* --- the side bets that were waiting on the dealer --- */
    const pendingSideBets = seat.pendingSideBets.map((sb) => {
      let settled = sb;

      if (sb.kind === 'BUST_IT' && sb.net === null) {
        const r = resolveBustIt(dealerCards, dealerV.busted, sb.amount);
        settled = { ...sb, net: r.net > 0 ? r.net : -sb.amount, label: r.label };
        if (r.net > 0) bankroll += r.net + sb.amount;
        net += settled.net!;
        stats.sideNet += settled.net!;
      } else if (sb.kind === 'LUCKY_LADIES' && dealerBJ && sb.jackpot) {
        // The 200:1 line was paid at the deal; two queens of hearts against a
        // dealer natural is the 1000:1 line, so the difference is paid now.
        // The amount was recorded at grade time — see SideBetWager.jackpot —
        // because a split has since moved the second queen to another hand.
        settled = {
          ...sb,
          net: (sb.net ?? 0) + sb.jackpot,
          label: 'Two queens of hearts + dealer blackjack',
        };
        bankroll += sb.jackpot;
        net += sb.jackpot;
        stats.sideNet += sb.jackpot;
      }

      if (settled.net !== null) {
        sideRecords.push({
          seat: seat.id,
          kind: settled.kind,
          amount: settled.amount,
          net: settled.net,
          label: settled.label,
        });
        settlements.push({
          seat: seat.id,
          handIndex: null,
          kind: 'SIDE',
          sideKind: settled.kind,
          net: settled.net,
          label: settled.label ?? 'No win',
        });
      }
      return settled;
    });

    stats.net = net;
    stats.peakBankroll = Math.max(stats.peakBankroll, bankroll);

    return { ...seat, bankroll, hands, pendingSideBets, insuranceNet, stats };
  });

  const record: RoundRecord = {
    round: table.round,
    dealerCards: dealerCards.map(cardLabel).join(' '),
    dealerTotal: dealerV.total,
    dealerOutcome,
    hands: handRecords,
    sideBets: sideRecords,
    insurance: insuranceRecords,
    net: settlements.reduce((n, s) => n + s.net, 0),
    trueCount,
  };

  return {
    table: {
      ...table,
      settled: true,
      seats,
      dealer: { ...table.dealer, holeDown: false, outcome: dealerOutcome },
      history: [record, ...table.history].slice(0, HISTORY_LIMIT),
    },
    settlements,
    record,
  };
}

/** Kept short enough that the charts stay responsive on a phone. */
const HISTORY_LIMIT = 300;

/**
 * `natural` is passed separately from the outcome, and it has to be.
 *
 * A player's natural against a dealer's natural pushes, so it settles as
 * PUSH and never reaches the BLACKJACK case — which meant the panel's
 * "blackjacks" figure, captioned "naturals dealt", quietly excluded about one
 * natural in twenty-two. Over three million rounds that reads 4.55% against a
 * true 4.749%, and the missing 4.2% is exactly the dealer-natural rate. It is
 * the same shape as the wagered-versus-staked mix-up: a number that is right
 * about something nobody asked it.
 */
function bumpStats(stats: SeatStats, outcome: HandOutcome, natural: boolean): void {
  if (natural) stats.blackjacks += 1;
  switch (outcome) {
    case 'BLACKJACK':
      stats.wins += 1;
      break;
    case 'WIN':
      stats.wins += 1;
      break;
    case 'PUSH':
      stats.pushes += 1;
      break;
    case 'BUST':
    case 'LOSE':
      stats.losses += 1;
      break;
    case 'SURRENDER':
      stats.losses += 1;
      break;
  }
}

export function outcomeLabel(outcome: HandOutcome): string {
  switch (outcome) {
    case 'BLACKJACK':
      return 'Blackjack';
    case 'WIN':
      return 'Win';
    case 'PUSH':
      return 'Push';
    case 'LOSE':
      return 'Lose';
    case 'BUST':
      return 'Bust';
    case 'SURRENDER':
      return 'Surrender';
  }
}

function emptyRecord(table: TableState, trueCount: number): RoundRecord {
  return {
    round: table.round,
    dealerCards: '',
    dealerTotal: 0,
    dealerOutcome: 'STAND',
    hands: [],
    sideBets: [],
    insurance: [],
    net: 0,
    trueCount,
  };
}
