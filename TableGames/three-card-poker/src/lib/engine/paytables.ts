/**
 * Paytables.
 *
 * Three Card Poker has one set of playing rules and a menu of prices. The
 * rules — queen high to qualify, Play equal to the Ante, a fold forfeits the
 * Ante and the Pair Plus together — are the same on every rule sheet this game
 * was checked against. What differs from one table to the next is what the
 * three bonus wagers pay, and that is not a detail: the same three cards on
 * the Pair Plus spot cost a player two percent at one table and seven at
 * another, and nothing about the felt, the dealer or the cards tells them
 * which table they are sitting at except the small print.
 *
 * So every table here is a real one — each appears on a published list of
 * Three Card Poker paytables, or on a casino's own rack card — and none of them
 * carries an edge written in by hand. `analysis.ts` computes every figure the
 * game prints from the exact number of hands that make each line, and the
 * test suite holds those computations against the published figures. Adding a
 * table here prices it; there is nothing else to update.
 *
 * Sources for the tables themselves are in the README.
 */

import { winnings } from './money';
import type { ThreeCardHand } from './poker';
import type { SixCardCategory } from './types';

/* ------------------------------------------------------------------ *
 * Shapes
 * ------------------------------------------------------------------ */

/** The hands Pair Plus can pay. A mini royal is paid as a straight flush unless a table says otherwise. */
export type PairPlusHand = 'MINI_ROYAL' | 'STRAIGHT_FLUSH' | 'TRIPS' | 'STRAIGHT' | 'FLUSH' | 'PAIR';

/** The hands the Ante Bonus pays: a straight or better, played. */
export type AnteBonusHand = 'STRAIGHT_FLUSH' | 'TRIPS' | 'STRAIGHT';

/** The seven five-card hands the 6 Card Bonus pays. */
export type SixCardHand = Extract<
  SixCardCategory,
  'ROYAL_FLUSH' | 'STRAIGHT_FLUSH' | 'FOUR_OF_A_KIND' | 'FULL_HOUSE' | 'FLUSH' | 'STRAIGHT' | 'THREE_OF_A_KIND'
>;

export interface PayLine<H extends string> {
  hand: H;
  /** Winnings as `[numerator, denominator]`: `[40, 1]` is 40 to 1. */
  ratio: readonly [number, number];
}

export interface Paytable<H extends string> {
  /** The pays themselves, top line first. Stable, readable, and cannot drift from the lines. */
  id: string;
  lines: readonly PayLine<H>[];
  /** What sets this table apart, in words. Never a figure: those are computed. */
  note: string;
}

const line = <H extends string>(hand: H, num: number, den = 1): PayLine<H> => ({ hand, ratio: [num, den] });

/* ------------------------------------------------------------------ *
 * Pair Plus
 * ------------------------------------------------------------------ */

function pairPlus(
  [straightFlush, trips, straight, flush, pair]: readonly [number, number, number, number, number],
  note: string,
  miniRoyal?: number,
): Paytable<PairPlusHand> {
  const lines: PayLine<PairPlusHand>[] = [
    line('STRAIGHT_FLUSH', straightFlush),
    line('TRIPS', trips),
    line('STRAIGHT', straight),
    line('FLUSH', flush),
    line('PAIR', pair),
  ];
  if (miniRoyal !== undefined) lines.unshift(line('MINI_ROYAL', miniRoyal));
  return { id: lines.map((l) => l.ratio[0]).join('-'), lines, note };
}

/**
 * Pair Plus, paid on the player's three cards alone.
 *
 * Listed best for the player first. The order is the computed one, and the
 * test suite checks it stays that way, so a table added out of place fails
 * rather than quietly reshuffling the setup screen.
 */
export const PAIR_PLUS_TABLES: readonly Paytable<PairPlusHand>[] = [
  pairPlus([40, 32, 6, 4, 1], 'Three of a kind pays 32.'),
  pairPlus([40, 30, 6, 4, 1], 'A flush pays four rather than three.'),
  pairPlus([35, 33, 6, 4, 1], 'Trips raised to 33, the straight flush cut to 35.'),
  pairPlus([40, 25, 6, 4, 1], 'Trips cut to 25; the flush still pays four.'),
  /*
   * Below four tables that pay a flush four, and above every other table that
   * pays it three — the 200 to 1 line looks like decoration and is worth
   * nearly three points. See the ordering test in `analysis.test.ts`.
   */
  pairPlus(
    [40, 30, 6, 3, 1],
    'The common table with a mini royal line on top: ace, king and queen of one suit.',
    200,
  ),
  pairPlus([50, 30, 6, 3, 1], 'A 50 to 1 straight flush, paid for by the flush.'),
  pairPlus([40, 30, 5, 4, 1], 'The straight cut to five.'),
  pairPlus([40, 30, 6, 3, 1], 'The table you are most likely to find. The flush pays three.'),
];

/* ------------------------------------------------------------------ *
 * Ante Bonus
 * ------------------------------------------------------------------ */

function anteBonus(
  [straightFlush, trips, straight]: readonly [number, number, number],
  note: string,
): Paytable<AnteBonusHand> {
  const lines = [line('STRAIGHT_FLUSH' as const, straightFlush), line('TRIPS' as const, trips), line('STRAIGHT' as const, straight)];
  return { id: lines.map((l) => l.ratio[0]).join('-'), lines, note };
}

/**
 * The Ante Bonus: paid on a straight or better to anyone who played the hand,
 * whatever the dealer holds — including when the dealer beats it.
 *
 * It is the reason Three Card Poker's main game is worth sitting down to. The
 * same Ante and Play without it would run at more than double the house edge,
 * and every table here costs more than the one above it.
 */
export const ANTE_BONUS_TABLES: readonly Paytable<AnteBonusHand>[] = [
  anteBonus([5, 4, 1], 'The usual Ante Bonus.'),
  anteBonus([5, 3, 1], 'Three of a kind cut to three.'),
  anteBonus([4, 3, 1], 'Both top lines cut by one.'),
  anteBonus([3, 2, 1], 'Both top lines cut by two.'),
];

/* ------------------------------------------------------------------ *
 * 6 Card Bonus
 * ------------------------------------------------------------------ */

function sixCard(
  [royal, straightFlush, quads, fullHouse, flush, straight, trips]: readonly [number, number, number, number, number, number, number],
  note: string,
): Paytable<SixCardHand> {
  const lines: PayLine<SixCardHand>[] = [
    line('ROYAL_FLUSH', royal),
    line('STRAIGHT_FLUSH', straightFlush),
    line('FOUR_OF_A_KIND', quads),
    line('FULL_HOUSE', fullHouse),
    line('FLUSH', flush),
    line('STRAIGHT', straight),
    line('THREE_OF_A_KIND', trips),
  ];
  return { id: lines.map((l) => l.ratio[0]).join('-'), lines, note };
}

/**
 * The 6 Card Bonus: the best five-card hand in the player's three cards and
 * the dealer's three.
 *
 * It reads the dealer's cards, so it cannot be decided until the dealer turns
 * them — but it does not care what the player did with the hand. A fold does
 * not forfeit it, which is also why it has no bearing on the play-or-fold
 * decision and the trainer leaves it out.
 *
 * Best for the player first. The top one looks like a trade — a point off the
 * straight for a point on three of a kind — and is not: three of a kind turns
 * up in six cards twice as often as a straight, so the extra unit on trips is
 * worth twice what the lost unit on straights costs.
 */
export const SIX_CARD_TABLES: readonly Paytable<SixCardHand>[] = [
  sixCard([1000, 200, 100, 20, 15, 9, 8], 'The straight cut to nine to pay trips eight.'),
  sixCard([1000, 200, 100, 20, 15, 10, 7], 'Four of a kind pays 100 and trips pay seven.'),
  sixCard([1000, 200, 50, 25, 20, 10, 5], 'A 20 to 1 flush, paid for by quads and trips.'),
  sixCard([2000, 200, 50, 25, 15, 10, 5], 'A 2,000 to 1 royal, paid for by everything below it.'),
  sixCard([1000, 200, 50, 25, 15, 10, 5], 'Quads cut to 50 and trips to five.'),
];

/* ------------------------------------------------------------------ *
 * Defaults and lookup
 * ------------------------------------------------------------------ */

export const DEFAULT_PAIR_PLUS = '40-30-6-3-1';
export const DEFAULT_ANTE_BONUS = '5-4-1';
export const DEFAULT_SIX_CARD = '1000-200-100-20-15-10-7';

/**
 * Resolve an id, falling back to the default rather than throwing.
 *
 * Ids arrive from localStorage, where a session saved by a later build — or a
 * hand-edited one — can name a table this build does not have. Crashing the
 * felt over it would be worse than dealing the default table and saying so in
 * the setup screen, which shows whatever table is actually in force.
 */
function find<H extends string>(tables: readonly Paytable<H>[], id: string, fallback: string): Paytable<H> {
  return tables.find((t) => t.id === id) ?? tables.find((t) => t.id === fallback)!;
}

export function pairPlusTable(id: string): Paytable<PairPlusHand> {
  return find(PAIR_PLUS_TABLES, id, DEFAULT_PAIR_PLUS);
}

export function anteBonusTable(id: string): Paytable<AnteBonusHand> {
  return find(ANTE_BONUS_TABLES, id, DEFAULT_ANTE_BONUS);
}

export function sixCardTable(id: string): Paytable<SixCardHand> {
  return find(SIX_CARD_TABLES, id, DEFAULT_SIX_CARD);
}

/* ------------------------------------------------------------------ *
 * Paying
 * ------------------------------------------------------------------ */

/**
 * The Pair Plus line a hand hits, or null.
 *
 * A mini royal is a straight flush, and at a table without its own line it is
 * paid as one. That fallback is the whole difference between the two 40-30-6-3-1
 * tables, and getting it wrong in either direction is worth four hands in
 * 22,100 — too few for any simulation to notice, which is why a unit test
 * pins it.
 */
export function pairPlusLine(table: Paytable<PairPlusHand>, hand: ThreeCardHand): PayLine<PairPlusHand> | null {
  if (hand.miniRoyal) {
    const royal = table.lines.find((l) => l.hand === 'MINI_ROYAL');
    if (royal) return royal;
  }
  return table.lines.find((l) => l.hand === hand.category) ?? null;
}

export function anteBonusLine(table: Paytable<AnteBonusHand>, hand: ThreeCardHand): PayLine<AnteBonusHand> | null {
  return table.lines.find((l) => l.hand === hand.category) ?? null;
}

export function sixCardLine(table: Paytable<SixCardHand>, category: SixCardCategory): PayLine<SixCardHand> | null {
  return table.lines.find((l) => l.hand === category) ?? null;
}

/** Winnings on a line, in cents. Zero for no line; the stake is handled by the caller. */
export function payOn<H extends string>(line: PayLine<H> | null, stake: number): number {
  return line ? winnings(stake, line.ratio[0], line.ratio[1]) : 0;
}

/* ------------------------------------------------------------------ *
 * Display
 * ------------------------------------------------------------------ */

export const PAY_HAND_LABEL: Record<PairPlusHand | SixCardHand, string> = {
  MINI_ROYAL: 'Mini royal',
  ROYAL_FLUSH: 'Royal flush',
  STRAIGHT_FLUSH: 'Straight flush',
  FOUR_OF_A_KIND: 'Four of a kind',
  FULL_HOUSE: 'Full house',
  TRIPS: 'Three of a kind',
  THREE_OF_A_KIND: 'Three of a kind',
  STRAIGHT: 'Straight',
  FLUSH: 'Flush',
  PAIR: 'Pair',
};

/** `40 to 1`, as the felt prints it. */
export function ratioWords(r: readonly [number, number]): string {
  return `${r[0].toLocaleString('en-US')} to ${r[1]}`;
}

/** `40:1`, where space is short. */
export function ratioLabel(r: readonly [number, number]): string {
  return `${r[0].toLocaleString('en-US')}:${r[1]}`;
}
