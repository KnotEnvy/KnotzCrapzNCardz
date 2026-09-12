/**
 * The bot.
 *
 * One function that decides what the seat in focus does, and one that plays a
 * whole round out. The app uses the first for autoplay and for "play this hand
 * for me"; the measurement suite uses the second to deal a few million rounds
 * and hold what comes out against the exact figures.
 *
 * The important property is that it has no privileged access. It decides from
 * the seat's own three cards — never another seat's, and never the dealer's —
 * and it moves money only by calling the same exported actions the buttons
 * call. A bot cannot make a play a player could not, because there is no
 * second path into the engine.
 */

import type { StrategyId } from '@/lib/engine/analysis';
import { settle } from '@/lib/engine/resolve';
import type { Rng } from '@/lib/engine/rng';
import { deal, decide, nextRound, revealDealer, seatOf, setWager } from '@/lib/engine/table';
import type { Decision, SeatId, SettlementKind, SpotKind, TableState, Wagers } from '@/lib/engine/types';
import { decisionFor } from './strategy';

export interface BotConfig {
  strategy: StrategyId;
}

export const DEFAULT_BOT: BotConfig = { strategy: 'OPTIMAL' };

/** What the bot would do with the hand in focus, or null when nothing is waiting on a decision. */
export function choose(table: TableState, config: BotConfig): Decision | null {
  if (table.phase !== 'DECIDING' || !table.focus) return null;
  const seat = seatOf(table, table.focus);
  return decisionFor(config.strategy, seat.cards, seat.wagers, table.rules);
}

export interface RoundOutcome {
  table: TableState;
  dealt: boolean;
  /**
   * Cents on the Ante — the denominator of the house edge — and on the Play.
   * Ante plus Play is the denominator of the element of risk.
   */
  anteStaked: number;
  playWagered: number;
  /** Signed cents on the Ante, Play and Ante Bonus together. */
  mainNet: number;
  anteBonusNet: number;
  pairPlusWagered: number;
  pairPlusNet: number;
  sixCardWagered: number;
  sixCardNet: number;
  plays: number;
  folds: number;
  /** Null when nothing was dealt. */
  dealerQualified: boolean | null;
}

function noRound(table: TableState): RoundOutcome {
  return {
    table,
    dealt: false,
    anteStaked: 0,
    playWagered: 0,
    mainNet: 0,
    anteBonusNet: 0,
    pairPlusWagered: 0,
    pairPlusNet: 0,
    sixCardWagered: 0,
    sixCardNet: 0,
    plays: 0,
    folds: 0,
    dealerQualified: null,
  };
}

const SPOTS: ReadonlyArray<[keyof Wagers, SpotKind]> = [
  ['ante', 'ANTE'],
  ['pairPlus', 'PAIR_PLUS'],
  ['sixCard', 'SIX_CARD'],
];

/**
 * Play one complete round, from an empty felt back to an empty felt.
 *
 * `bets` puts chips down first, through `setWager`, so a refused bet is simply
 * not placed. Without it the round is dealt on whatever is already on the
 * felt, which is what autoplay does.
 *
 * The per-bet figures come out of the settlement list rather than out of a
 * before-and-after on the seat's ledger: the list already says which bet each
 * movement belongs to, and separating a summed ledger afterwards is guesswork.
 */
export function playRound(
  table: TableState,
  config: BotConfig,
  rng: Rng,
  bets?: ReadonlyMap<SeatId, Wagers>,
): RoundOutcome {
  let t = table;

  if (bets) {
    for (const [id, wagers] of bets) {
      for (const [key, spot] of SPOTS) {
        const res = setWager(t, id, spot, wagers[key]);
        if (res.ok) t = res.table;
      }
    }
  }

  const dealt = deal(t, rng);
  if (!dealt.ok) return noRound(t);
  t = dealt.table;

  let plays = 0;
  let folds = 0;
  let guard = 0;
  while (t.phase === 'DECIDING') {
    const choice = choose(t, config) ?? 'FOLD';
    const res = decide(t, choice);
    if (!res.ok) {
      // Unreachable while `legalDecisions` allows a fold on every decided
      // seat. A fold is the fallback that can never spend money the seat
      // does not have, and a simulation that throws at round 800,000 has
      // measured nothing.
      const fallback = decide(t, 'FOLD');
      if (!fallback.ok) break;
      t = fallback.table;
      folds++;
    } else {
      t = res.table;
      if (choice === 'PLAY') plays++;
      else folds++;
    }
    if (++guard > 8) throw new Error('The decisions never finished.');
  }

  const revealed = revealDealer(t);
  if (!revealed.ok) return noRound(t);
  t = revealed.table;

  const wagered = (key: keyof Wagers | 'play') => t.seats.reduce((n, s) => n + s.wagers[key], 0);
  const anteStaked = wagered('ante');
  const playWagered = wagered('play');
  const pairPlusWagered = wagered('pairPlus');
  const sixCardWagered = wagered('sixCard');

  const settled = settle(t);
  const sum = (...kinds: SettlementKind[]) =>
    settled.settlements.filter((s) => kinds.includes(s.kind)).reduce((n, s) => n + s.net, 0);

  const outcome: RoundOutcome = {
    table: settled.table,
    dealt: true,
    anteStaked,
    playWagered,
    mainNet: sum('ANTE', 'PLAY', 'ANTE_BONUS'),
    anteBonusNet: sum('ANTE_BONUS'),
    pairPlusWagered,
    pairPlusNet: sum('PAIR_PLUS'),
    sixCardWagered,
    sixCardNet: sum('SIX_CARD'),
    plays,
    folds,
    dealerQualified: settled.record.dealerQualified,
  };

  const cleared = nextRound(settled.table);
  if (cleared.ok) outcome.table = cleared.table;
  return outcome;
}
