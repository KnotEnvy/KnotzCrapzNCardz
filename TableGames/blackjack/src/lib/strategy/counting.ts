/**
 * Counting.
 *
 * Four balanced counts and the arithmetic that turns a running total into a
 * betting decision. This is a trainer, not an oracle: everything here is
 * computed from cards that have already been face up on the felt, which is
 * exactly the information a player at the table has. Nothing reads the shoe.
 *
 * That constraint is the whole point, and it is enforced by the interface —
 * {@link countCards} takes the discard tray, and the discard tray is the only
 * thing it takes. The engine's `composition()` could answer far more accurately
 * and is deliberately not wired to any of this.
 */

import type { Card, ShoeState } from '@/lib/engine/types';
import { rankValue } from '@/lib/engine/types';

export type CountSystem = 'HI_LO' | 'KO' | 'OMEGA_II' | 'HI_OPT_II';

export interface CountSpec {
  id: CountSystem;
  name: string;
  /** What it is good at, in a line. */
  note: string;
  /** Tag by rank value: index 1 is the ace, 2..10 are themselves. */
  tags: Record<number, number>;
  /** Balanced counts sum to zero over a deck and need a true-count conversion. */
  balanced: boolean;
  /** Level — the largest absolute tag. Higher is more accurate and harder. */
  level: number;
  /** Betting correlation: how well it predicts the advantage. */
  bc: number;
}

/**
 * Ace-neutral counts (Omega II, Hi-Opt II) track aces separately because an
 * ace is worth a great deal for *blackjacks* and nothing for the dealer's
 * draw. `sideCountAces` marks the ones where the HUD should show the ace
 * count next to the running total.
 */
export const COUNT_SYSTEMS: Record<CountSystem, CountSpec & { sideCountAces: boolean }> = {
  HI_LO: {
    id: 'HI_LO',
    name: 'Hi-Lo',
    note: 'The one everybody learns. Level one, balanced, and good enough to beat most shoes.',
    tags: { 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 0, 8: 0, 9: 0, 10: -1, 11: -1 },
    balanced: true,
    level: 1,
    bc: 0.97,
    sideCountAces: false,
  },
  KO: {
    id: 'KO',
    name: 'Knock-Out',
    note: 'Unbalanced, so there is no true count to divide. Easier at the table, slightly weaker.',
    tags: { 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 0, 9: 0, 10: -1, 11: -1 },
    balanced: false,
    level: 1,
    bc: 0.98,
    sideCountAces: false,
  },
  OMEGA_II: {
    id: 'OMEGA_II',
    name: 'Omega II',
    note: 'Level two, ace-neutral. Stronger for playing decisions than for betting.',
    tags: { 2: 1, 3: 1, 4: 2, 5: 2, 6: 2, 7: 1, 8: 0, 9: -1, 10: -2, 11: 0 },
    balanced: true,
    level: 2,
    bc: 0.92,
    sideCountAces: true,
  },
  HI_OPT_II: {
    id: 'HI_OPT_II',
    name: 'Hi-Opt II',
    note: 'Level two, ace-neutral, the strongest of these for playing efficiency.',
    tags: { 2: 1, 3: 1, 4: 2, 5: 2, 6: 1, 7: 1, 8: 0, 9: 0, 10: -2, 11: 0 },
    balanced: true,
    level: 2,
    bc: 0.91,
    sideCountAces: true,
  },
};

export const COUNT_ORDER: readonly CountSystem[] = ['HI_LO', 'KO', 'OMEGA_II', 'HI_OPT_II'];

/** The tag a single card carries under a system. */
export function tagOf(card: Card, system: CountSystem): number {
  return COUNT_SYSTEMS[system].tags[rankValue(card.rank)] ?? 0;
}

export interface CountState {
  /** The sum of the tags of every card seen since the shuffle. */
  running: number;
  /**
   * The running count divided by the decks still to be dealt.
   *
   * This is the number that means something. A running count of +8 with six
   * decks left is nothing; the same +8 with one deck left is a large edge, and
   * the division is what tells them apart. Unbalanced systems have no true
   * count and report the running count here unchanged.
   */
  true: number;
  /** Decks estimated remaining, to the quarter — as a player would eyeball it. */
  decksLeft: number;
  /** Aces seen, for the side-counting systems. */
  acesSeen: number;
  /** Aces still in the shoe relative to expectation. Positive is good. */
  aceSurplus: number;
  cardsSeen: number;
}

/**
 * The starting count.
 *
 * An unbalanced count starts below zero so that its pivot lands at the right
 * place: Knock-Out's initial running count is `-4 * (decks - 1)`, which is
 * what makes "zero or better means you have the edge" true for any shoe size.
 * A balanced count starts at zero, always.
 */
export function initialCount(system: CountSystem, decks: number): number {
  return COUNT_SYSTEMS[system].balanced ? 0 : -4 * (decks - 1);
}

/**
 * Count the discard tray.
 *
 * Recomputed from scratch rather than accumulated, which sounds wasteful and
 * is not: a shoe holds at most 416 cards, this runs once per round, and an
 * accumulated count is a piece of state that can drift out of step with the
 * cards after an undo, a rule change or a reshuffle. Recomputing cannot drift.
 */
export function countCards(
  discard: readonly Card[],
  system: CountSystem,
  decks: number,
  cardsRemaining: number,
): CountState {
  const spec = COUNT_SYSTEMS[system];
  let running = initialCount(system, decks);
  let aces = 0;
  for (const card of discard) {
    running += tagOf(card, system);
    if (card.rank === 14) aces++;
  }

  // A player estimates the discard tray to the nearest half deck and divides.
  // Rounding to the quarter deck is the generous version of that, and it is
  // floored at a quarter so the division cannot run away at the cut card.
  const decksLeft = Math.max(0.25, Math.round((cardsRemaining / 52) * 4) / 4);
  const trueCount = spec.balanced ? running / decksLeft : running;

  const acesExpected = (discard.length / (decks * 52)) * decks * 4;
  return {
    running,
    true: trueCount,
    decksLeft,
    acesSeen: aces,
    aceSurplus: acesExpected - aces,
    cardsSeen: discard.length,
  };
}

/**
 * Count a live shoe's discard tray.
 *
 * Walks `cards[0..pos)` in place rather than materialising the tray, because
 * this runs once a round through a simulation of several hundred thousand and
 * the copy was the single most expensive thing in it. The window is exactly
 * the discard tray — the same cards a player has seen, and not one past it.
 */
export function countShoe(shoe: ShoeState, system: CountSystem, decks: number): CountState {
  const spec = COUNT_SYSTEMS[system];
  const tags = spec.tags;
  let running = initialCount(system, decks);
  let aces = 0;
  for (let i = 0; i < shoe.pos; i++) {
    const rank = shoe.cards[i].rank;
    running += tags[rank >= 10 && rank <= 13 ? 10 : rank === 14 ? 11 : rank] ?? 0;
    if (rank === 14) aces++;
  }

  const remaining = shoe.size - shoe.pos;
  const decksLeft = Math.max(0.25, Math.round((remaining / 52) * 4) / 4);
  const acesExpected = (shoe.pos / (decks * 52)) * decks * 4;
  return {
    running,
    true: spec.balanced ? running / decksLeft : running,
    decksLeft,
    acesSeen: aces,
    aceSurplus: acesExpected - aces,
    cardsSeen: shoe.pos,
  };
}

/* ------------------------------------------------------------------ *
 * What the count is worth
 * ------------------------------------------------------------------ */

/**
 * The player's edge, in percent, at a given true count.
 *
 * The standard approximation: each unit of true count is worth about half a
 * percent, applied against the game's own house edge. It is a straight line
 * and the real curve is not quite one, but it is straight enough over the
 * -5..+10 range anybody plays in, and it is the model every betting ramp in
 * print is built on.
 */
export function edgeAt(trueCount: number, houseEdgePercent: number): number {
  return -houseEdgePercent + trueCount * 0.5;
}

/**
 * A betting ramp: what to bet at this count, in units.
 *
 * A 1-12 spread over a six-deck game, which is aggressive enough to matter and
 * conspicuous enough to get you barred. The trainer shows it because the count
 * is worthless without one — knowing the shoe is rich and betting flat is a
 * strictly worse game than not counting at all, since you have spent the whole
 * shoe concentrating for nothing.
 */
export function betRamp(trueCount: number): number {
  if (trueCount < 1) return 1;
  if (trueCount < 2) return 2;
  if (trueCount < 3) return 4;
  if (trueCount < 4) return 6;
  if (trueCount < 5) return 8;
  return 12;
}

/**
 * The Illustrious 18, abridged to the deviations that are actually worth
 * knowing, plus the Fab 4 surrenders.
 *
 * Each is a basic-strategy cell that flips at a threshold true count. Insurance
 * at +3 is the single most valuable one and is the reason it sits first: it is
 * a 7.4% bad bet at a neutral shoe and a good bet above +3, and no other
 * deviation swings that far.
 */
export interface Deviation {
  /** Human name of the hand. */
  hand: string;
  /** The player's total, or 'INSURANCE' / a pair. */
  playerTotal: number | 'INSURANCE';
  /** Upcard value, 11 for an ace. */
  upcard: number;
  /** True count at or beyond which the deviation applies. */
  index: number;
  /** Which direction the index runs. */
  direction: 'at-or-above' | 'at-or-below';
  /** What to do instead. */
  action: 'STAND' | 'HIT' | 'DOUBLE' | 'SPLIT' | 'SURRENDER' | 'INSURE';
  note: string;
}

export const DEVIATIONS: readonly Deviation[] = [
  { hand: 'Insurance', playerTotal: 'INSURANCE', upcard: 11, index: 3, direction: 'at-or-above', action: 'INSURE', note: 'The most valuable deviation there is. Below +3 it is the worst bet on the table.' },
  { hand: '16 v 10', playerTotal: 16, upcard: 10, index: 0, direction: 'at-or-above', action: 'STAND', note: 'The closest call in the game. A neutral shoe already makes it a coin flip.' },
  { hand: '15 v 10', playerTotal: 15, upcard: 10, index: 4, direction: 'at-or-above', action: 'STAND', note: '' },
  { hand: '10,10 v 5', playerTotal: 20, upcard: 5, index: 5, direction: 'at-or-above', action: 'SPLIT', note: 'Splitting twenty. Correct, conspicuous, and a good way to be watched.' },
  { hand: '10,10 v 6', playerTotal: 20, upcard: 6, index: 4, direction: 'at-or-above', action: 'SPLIT', note: '' },
  { hand: '10 v 10', playerTotal: 10, upcard: 10, index: 4, direction: 'at-or-above', action: 'DOUBLE', note: '' },
  { hand: '12 v 3', playerTotal: 12, upcard: 3, index: 2, direction: 'at-or-above', action: 'STAND', note: '' },
  { hand: '12 v 2', playerTotal: 12, upcard: 2, index: 3, direction: 'at-or-above', action: 'STAND', note: '' },
  { hand: '11 v A', playerTotal: 11, upcard: 11, index: 1, direction: 'at-or-above', action: 'DOUBLE', note: '' },
  { hand: '9 v 2', playerTotal: 9, upcard: 2, index: 1, direction: 'at-or-above', action: 'DOUBLE', note: '' },
  { hand: '10 v A', playerTotal: 10, upcard: 11, index: 4, direction: 'at-or-above', action: 'DOUBLE', note: '' },
  { hand: '9 v 7', playerTotal: 9, upcard: 7, index: 3, direction: 'at-or-above', action: 'DOUBLE', note: '' },
  { hand: '16 v 9', playerTotal: 16, upcard: 9, index: 5, direction: 'at-or-above', action: 'STAND', note: '' },
  { hand: '13 v 2', playerTotal: 13, upcard: 2, index: -1, direction: 'at-or-below', action: 'HIT', note: '' },
  { hand: '12 v 4', playerTotal: 12, upcard: 4, index: 0, direction: 'at-or-below', action: 'HIT', note: '' },
  { hand: '12 v 5', playerTotal: 12, upcard: 5, index: -2, direction: 'at-or-below', action: 'HIT', note: '' },
  { hand: '12 v 6', playerTotal: 12, upcard: 6, index: -1, direction: 'at-or-below', action: 'HIT', note: '' },
  { hand: '13 v 3', playerTotal: 13, upcard: 3, index: -2, direction: 'at-or-below', action: 'HIT', note: '' },
  { hand: '15 v 9', playerTotal: 15, upcard: 9, index: 2, direction: 'at-or-above', action: 'SURRENDER', note: 'One of the Fab 4.' },
  { hand: '15 v A', playerTotal: 15, upcard: 11, index: 1, direction: 'at-or-above', action: 'SURRENDER', note: 'One of the Fab 4.' },
];

/**
 * The deviation that applies to this hand at this count, if any.
 *
 * Only consulted when the trainer's deviation mode is on. Off by default,
 * because a player who has not learned the chart cold has no business learning
 * the exceptions to it.
 */
export function deviationFor(
  playerTotal: number,
  upcard: number,
  trueCount: number,
  isPairOfTens = false,
): Deviation | null {
  for (const dev of DEVIATIONS) {
    if (dev.playerTotal === 'INSURANCE') continue;
    if (dev.upcard !== upcard) continue;
    if (dev.playerTotal !== playerTotal) continue;
    if (dev.action === 'SPLIT' && !isPairOfTens) continue;
    if (dev.action !== 'SPLIT' && isPairOfTens && dev.playerTotal === 20) continue;
    const hit = dev.direction === 'at-or-above' ? trueCount >= dev.index : trueCount <= dev.index;
    if (hit) return dev;
  }
  return null;
}

/** Should insurance be taken at this count? The one deviation worth its own call. */
export function insuranceIsGood(trueCount: number): boolean {
  return trueCount >= 3;
}

/** `+2.4` / `-1.0` / `0.0`, to one decimal, with the sign always shown. */
export function fmtCount(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)}`;
}
