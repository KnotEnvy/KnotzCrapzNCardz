/**
 * Basic strategy.
 *
 * The chart. Not an approximation of it, not a heuristic that gets most hands
 * right — the actual computed-optimal play for every hand against every
 * upcard, with the rule-dependent cells switching on the rules in play.
 *
 * It is written as three tables, in the same shape they are printed on the
 * card you can buy in a gift shop: hard totals, soft totals, and pairs. Each
 * cell is a code rather than an action, because a cell has to be able to say
 * "double, or hit if you cannot" — the difference between `D` and `H` on 11
 * against an ace is worth real money at a table that only doubles 10-11, and a
 * chart that could only name one action would have to lie about it.
 *
 * Codes:
 *   H   hit
 *   S   stand
 *   D   double, else hit
 *   Ds  double, else stand      (the soft 18s and 19s)
 *   P   split
 *   Ph  split if double-after-split is allowed, else hit
 *   Pd  split if double-after-split is allowed, else double, else hit
 *   R   surrender, else hit
 *   Rs  surrender, else stand
 *   Rp  surrender, else split   (the 8,8 against an ace at H17)
 *
 * The two variants are the six-deck S17 chart and its H17 deltas. Single and
 * double deck differ in about a dozen more cells; those are applied as a
 * patch in {@link fewDeckPatch} rather than as a second full table, because
 * three near-identical 10x17 grids in one file is how a chart gets edited in
 * one place and not the others.
 *
 * Sources are the standard computed charts (Wizard of Odds / Griffin). The
 * simulation suite is the check: `strategy.sim.test.ts` plays several hundred
 * thousand hands on each preset with these decisions and asserts the resulting
 * house edge lands where the rule model says it should. A wrong cell moves
 * that number.
 */

import { handValue, isPair } from '@/lib/engine/hand';
import type { Card, Hand, Rank, TableRules } from '@/lib/engine/types';
import { rankValue } from '@/lib/engine/types';
import type { Action } from '@/lib/engine/types';

export type Code = 'H' | 'S' | 'D' | 'Ds' | 'P' | 'Ph' | 'Pd' | 'R' | 'Rs' | 'Rp';

/** Upcards, in chart order: 2..10 then ace. */
export const UPCARDS: readonly number[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

/** The upcard's chart column value: any ten-value is 10, an ace is 11. */
export function upcardValue(card: Card): number {
  return rankValue(card.rank);
}

function row(...codes: Code[]): Code[] {
  return codes;
}

/* ------------------------------------------------------------------ *
 * Hard totals, 5 through 21
 * ------------------------------------------------------------------ */

/** Indexed by total, then by upcard column. Six decks, dealer stands soft 17. */
const HARD: Record<number, Code[]> = {
  //         2    3    4    5    6    7    8    9    10   A
  5: row('H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H'),
  6: row('H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H'),
  7: row('H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H'),
  8: row('H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H'),
  9: row('H', 'D', 'D', 'D', 'D', 'H', 'H', 'H', 'H', 'H'),
  10: row('D', 'D', 'D', 'D', 'D', 'D', 'D', 'D', 'H', 'H'),
  11: row('D', 'D', 'D', 'D', 'D', 'D', 'D', 'D', 'D', 'H'),
  12: row('H', 'H', 'S', 'S', 'S', 'H', 'H', 'H', 'H', 'H'),
  13: row('S', 'S', 'S', 'S', 'S', 'H', 'H', 'H', 'H', 'H'),
  14: row('S', 'S', 'S', 'S', 'S', 'H', 'H', 'H', 'H', 'H'),
  15: row('S', 'S', 'S', 'S', 'S', 'H', 'H', 'H', 'R', 'H'),
  16: row('S', 'S', 'S', 'S', 'S', 'H', 'H', 'R', 'R', 'R'),
  17: row('S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S'),
  18: row('S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S'),
  19: row('S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S'),
  20: row('S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S'),
  21: row('S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S'),
};

/**
 * What changes when the dealer draws to a soft seventeen.
 *
 * Five cells on the hard chart, and every one of them is the same idea: an
 * ace or a six in the dealer's hand is more dangerous than it looks, so the
 * player pushes harder on eleven and folds sooner on the stiffs.
 */
const HARD_H17: Array<[number, number, Code]> = [
  [11, 11, 'D'], // eleven doubles against an ace
  [15, 11, 'R'], // fifteen surrenders against an ace
  [17, 11, 'Rs'], // and so, remarkably, does seventeen
];

/* ------------------------------------------------------------------ *
 * Soft totals, A,2 through A,9
 * ------------------------------------------------------------------ */

/** Indexed by the soft total (13..21), then by upcard column. */
const SOFT: Record<number, Code[]> = {
  //          2     3     4     5     6     7     8     9     10    A
  13: row('H', 'H', 'H', 'D', 'D', 'H', 'H', 'H', 'H', 'H'),
  14: row('H', 'H', 'H', 'D', 'D', 'H', 'H', 'H', 'H', 'H'),
  15: row('H', 'H', 'D', 'D', 'D', 'H', 'H', 'H', 'H', 'H'),
  16: row('H', 'H', 'D', 'D', 'D', 'H', 'H', 'H', 'H', 'H'),
  17: row('H', 'D', 'D', 'D', 'D', 'H', 'H', 'H', 'H', 'H'),
  18: row('Ds', 'Ds', 'Ds', 'Ds', 'Ds', 'S', 'S', 'H', 'H', 'H'),
  19: row('S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S'),
  20: row('S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S'),
  21: row('S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S'),
};

const SOFT_H17: Array<[number, number, Code]> = [
  [18, 2, 'Ds'],
  [19, 6, 'Ds'], // soft nineteen doubles against a six at H17. It is correct.
];

/* ------------------------------------------------------------------ *
 * Pairs
 * ------------------------------------------------------------------ */

/** Indexed by the pair's card value (2..10, 11 for aces), then by upcard. */
const PAIRS: Record<number, Code[]> = {
  //         2     3     4     5     6     7     8     9     10   A
  2: row('Ph', 'Ph', 'P', 'P', 'P', 'P', 'H', 'H', 'H', 'H'),
  3: row('Ph', 'Ph', 'P', 'P', 'P', 'P', 'H', 'H', 'H', 'H'),
  4: row('H', 'H', 'H', 'Ph', 'Ph', 'H', 'H', 'H', 'H', 'H'),
  5: row('D', 'D', 'D', 'D', 'D', 'D', 'D', 'D', 'H', 'H'),
  6: row('Ph', 'P', 'P', 'P', 'P', 'H', 'H', 'H', 'H', 'H'),
  7: row('P', 'P', 'P', 'P', 'P', 'P', 'H', 'H', 'H', 'H'),
  8: row('P', 'P', 'P', 'P', 'P', 'P', 'P', 'P', 'P', 'P'),
  9: row('P', 'P', 'P', 'P', 'P', 'S', 'P', 'P', 'S', 'S'),
  10: row('S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S', 'S'),
  11: row('P', 'P', 'P', 'P', 'P', 'P', 'P', 'P', 'P', 'P'),
};

const PAIRS_H17: Array<[number, number, Code]> = [
  [8, 11, 'Rp'], // eight-eight surrenders against an ace at H17, if it can
];

/**
 * Single and double deck deltas.
 *
 * Fewer decks means the two cards in your hand remove a larger fraction of the
 * shoe, which shifts about a dozen marginal cells. These are the ones that
 * matter at one deck; at two, the first four still apply and the rest wash
 * out, so they are applied only below three decks.
 */
const FEW_DECK: Array<[('hard' | 'soft' | 'pair'), number, number, Code]> = [
  ['hard', 8, 5, 'D'],
  ['hard', 8, 6, 'D'],
  ['hard', 9, 2, 'D'],
  ['hard', 11, 11, 'D'],
  ['soft', 13, 4, 'D'],
  ['soft', 14, 4, 'D'],
  ['soft', 17, 2, 'D'],
  ['soft', 19, 6, 'Ds'],
  ['pair', 4, 4, 'Ph'],
  ['pair', 7, 8, 'P'],
];

/* ------------------------------------------------------------------ *
 * Reading the chart
 * ------------------------------------------------------------------ */

function column(upcard: number): number {
  return UPCARDS.indexOf(upcard === 1 ? 11 : upcard);
}

function patch(table: Record<number, Code[]>, deltas: Array<[number, number, Code]>): Record<number, Code[]> {
  const out: Record<number, Code[]> = {};
  for (const [k, v] of Object.entries(table)) out[Number(k)] = v.slice();
  for (const [rowKey, up, code] of deltas) {
    const col = column(up);
    if (out[rowKey] && col >= 0) out[rowKey][col] = code;
  }
  return out;
}

/**
 * The chart for a given rule set, built once and cached.
 *
 * Rules change rarely and a chart is rebuilt from three table copies plus a
 * handful of patches, so this is not an optimisation that matters for speed at
 * the felt — it matters for the simulation, which asks for the chart on every
 * one of several hundred thousand decisions.
 */
export interface Chart {
  hard: Record<number, Code[]>;
  soft: Record<number, Code[]>;
  pairs: Record<number, Code[]>;
}

const chartCache = new Map<string, Chart>();

function chartKey(rules: TableRules): string {
  return `${rules.decks}|${rules.hitsSoft17}|${rules.das}|${rules.surrender}|${rules.double}|${rules.doubleSoft}`;
}

export function chartFor(rules: TableRules): Chart {
  const key = chartKey(rules);
  const cached = chartCache.get(key);
  if (cached) return cached;

  let hard = rules.hitsSoft17 ? patch(HARD, HARD_H17) : patch(HARD, []);
  let soft = rules.hitsSoft17 ? patch(SOFT, SOFT_H17) : patch(SOFT, []);
  let pairs = rules.hitsSoft17 ? patch(PAIRS, PAIRS_H17) : patch(PAIRS, []);

  if (rules.decks <= 2) {
    hard = patch(hard, FEW_DECK.filter(([t]) => t === 'hard').map(([, r, u, c]) => [r, u, c]));
    soft = patch(soft, FEW_DECK.filter(([t]) => t === 'soft').map(([, r, u, c]) => [r, u, c]));
    pairs = patch(pairs, FEW_DECK.filter(([t]) => t === 'pair').map(([, r, u, c]) => [r, u, c]));
  }

  const chart = restrict({ hard, soft, pairs }, rules);
  chartCache.set(key, chart);
  return chart;
}

/**
 * Fold the table's restrictions into the chart itself.
 *
 * A printed strategy card says "double 9 against 3", and at a table that only
 * doubles 10-11 that is a play the dealer will refuse. {@link adviseFrom}
 * already reconciles a cell against what is legal, but the *displayed* chart
 * was still showing the unrestricted card — which made its own caption a lie,
 * and left a player reading a cell they could not play.
 *
 * So the substitution happens once, here, and the chart the dialog shows is
 * the chart the buttons will accept. Each rule collapses a cell to whatever
 * the fallback would have been:
 *
 *   no surrender      R → H,  Rs → S,  Rp → P
 *   no soft doubling  D → H,  Ds → S   (on the soft table only)
 *   double restricted D → H,  Ds → S   for totals outside the range
 *   no DAS            Ph → H
 */
function restrict(chart: Chart, rules: TableRules): Chart {
  const noSurrender = rules.surrender === 'NONE';

  const fix = (code: Code, total: number, soft: boolean): Code => {
    if (noSurrender) {
      if (code === 'R') return 'H';
      if (code === 'Rs') return 'S';
      if (code === 'Rp') return 'P';
    }
    if (code === 'Ph' && !rules.das) return 'H';
    if (code === 'D' || code === 'Ds') {
      const blocked = (soft && !rules.doubleSoft) || !inDoubleRange(total, rules);
      if (blocked) return code === 'Ds' ? 'S' : 'H';
    }
    return code;
  };

  const mapRows = (
    table: Record<number, Code[]>,
    totalOf: (row: number) => number,
    soft: boolean,
  ): Record<number, Code[]> =>
    Object.fromEntries(
      Object.entries(table).map(([row, codes]) => [
        Number(row),
        codes.map((c) => fix(c, totalOf(Number(row)), soft)),
      ]),
    );

  return {
    hard: mapRows(chart.hard, (n) => n, false),
    soft: mapRows(chart.soft, (n) => n, true),
    // A pair's doubling total is the pair's value doubled — five-five doubles
    // as a ten, and it is the only pair cell that ever says D.
    pairs: mapRows(chart.pairs, (n) => n * 2, false),
  };
}

function inDoubleRange(total: number, rules: TableRules): boolean {
  switch (rules.double) {
    case 'ANY2':
      return true;
    case '9-11':
      return total >= 9 && total <= 11;
    case '10-11':
      return total >= 10 && total <= 11;
  }
}

/** The raw code for a hand, before it is reconciled with what is legal. */
export function codeFor(cards: readonly Card[], upcard: number, rules: TableRules): Code {
  const chart = chartFor(rules);
  const v = handValue(cards);
  const col = column(upcard);

  if (cards.length === 2 && isPair(cards)) {
    const pv = rankValue(cards[0].rank);
    const rowCodes = chart.pairs[pv];
    if (rowCodes) return rowCodes[col];
  }
  if (v.soft && v.total >= 13 && v.total <= 21) {
    return chart.soft[v.total][col];
  }
  const total = Math.min(21, Math.max(5, v.total));
  return chart.hard[total][col];
}

/* ------------------------------------------------------------------ *
 * Turning a code into a legal action
 * ------------------------------------------------------------------ */

export interface Advice {
  action: Action;
  /** The chart cell, before legality was applied. Shown in the trainer. */
  code: Code;
  /** True when the rules forced a different action than the chart's first choice. */
  fellBack: boolean;
  /** One line explaining the play, for the trainer's coaching panel. */
  why: string;
}

/**
 * What to do, given what is actually allowed.
 *
 * This is where a chart becomes advice. `D` means "double if you can, hit if
 * you cannot" and the fallback is not a detail — a nine against a three at a
 * table that only doubles 10-11 is a hit, and a player following a printed
 * chart that says D would be making a play the dealer would refuse.
 *
 * The legality map comes from the engine, so the advisor cannot suggest
 * something the buttons would not accept.
 */
export function adviseFrom(
  code: Code,
  legal: Record<Action, { allowed: boolean }>,
  cards: readonly Card[],
  upcard: number,
  rules: TableRules,
): Advice {
  const why = explain(code, cards, upcard, rules);
  const give = (action: Action, fellBack: boolean): Advice => ({ action, code, fellBack, why });

  switch (code) {
    case 'H':
      return give('HIT', false);
    case 'S':
      return give('STAND', false);
    case 'D':
      return legal.DOUBLE.allowed ? give('DOUBLE', false) : give('HIT', true);
    case 'Ds':
      return legal.DOUBLE.allowed ? give('DOUBLE', false) : give('STAND', true);
    case 'P':
      return legal.SPLIT.allowed ? give('SPLIT', false) : give('HIT', true);
    case 'Ph':
      return rules.das && legal.SPLIT.allowed ? give('SPLIT', false) : give('HIT', true);
    case 'Pd':
      if (rules.das && legal.SPLIT.allowed) return give('SPLIT', false);
      return legal.DOUBLE.allowed ? give('DOUBLE', true) : give('HIT', true);
    case 'R':
      return legal.SURRENDER.allowed ? give('SURRENDER', false) : give('HIT', true);
    case 'Rs':
      return legal.SURRENDER.allowed ? give('SURRENDER', false) : give('STAND', true);
    case 'Rp':
      if (legal.SURRENDER.allowed) return give('SURRENDER', false);
      return legal.SPLIT.allowed ? give('SPLIT', true) : give('HIT', true);
  }
}

/** The whole advisor in one call: chart, then legality. */
export function advise(
  hand: Hand,
  upcard: Card | undefined,
  legal: Record<Action, { allowed: boolean }>,
  rules: TableRules,
): Advice | null {
  if (!upcard) return null;
  const code = codeFor(hand.cards, upcardValue(upcard), rules);
  return adviseFrom(code, legal, hand.cards, upcardValue(upcard), rules);
}

/* ------------------------------------------------------------------ *
 * Why
 * ------------------------------------------------------------------ */

/**
 * One sentence on the reasoning.
 *
 * Not generated from the numbers — written, because the numbers do not
 * explain anything on their own. "Sixteen against a ten loses either way; you
 * hit because busting 62% of the time still beats standing into a hand that
 * makes seventeen or better four times in five" is a thing a player can carry
 * to the next hand. "EV(hit) = -0.5375, EV(stand) = -0.5404" is not.
 */
function explain(code: Code, cards: readonly Card[], upcard: number, rules: TableRules): string {
  const v = handValue(cards);
  const up = upcard === 11 ? 'an ace' : `a ${upcard}`;
  const dealerWeak = upcard >= 2 && upcard <= 6;

  if (code === 'P' || code === 'Ph' || code === 'Pd' || code === 'Rp') {
    const pv = rankValue(cards[0]?.rank ?? 2);
    if (pv === 11) return 'Always split aces. Two hands starting with an ace beat one soft twelve, by a distance.';
    if (pv === 8) return 'Always split eights. Sixteen is the worst hand in the game; two eights are two fresh starts.';
    if (pv === 10) return 'Never split tens. Twenty wins nine hands in ten — do not break it up chasing two.';
    if (pv === 9) return `Nine-nine is eighteen, which loses to nineteen and twenty. Against ${up} two nines do better.`;
    if (pv === 5) return 'Five-five is a ten, not a pair. Double it.';
    if (code === 'Ph') return `Only worth splitting if you can double afterwards${rules.das ? ', which you can here.' : ' — and here you cannot.'}`;
    return `${up === 'an ace' ? 'An ace' : `A ${upcard}`} is the dealer's weakest range. Get more money out against it.`;
  }
  if (code === 'R' || code === 'Rs') {
    return `Surrender is a bet you have already lost. Giving up half of it beats losing ${v.total === 16 ? 'about 77%' : 'more than three quarters'} of the whole thing.`;
  }
  if (code === 'D' || code === 'Ds') {
    if (v.soft) return `A soft total cannot bust on one card. Against ${up} that is free money on the table.`;
    if (v.total === 11) return 'Eleven makes twenty-one with any ten, and there are sixteen of them in every deck.';
    return `Doubling is the only way to get more money out when you are ahead, and against ${up} you are.`;
  }
  if (code === 'S') {
    if (v.total >= 17) return 'Seventeen or better stands. The cards that help you are outnumbered by the ones that break you.';
    if (dealerWeak) return `Stand and let ${up} break. The dealer busts more than a third of the time showing that card.`;
    return 'Stand.';
  }
  if (v.total >= 12 && v.total <= 16 && !dealerWeak) {
    return `A stiff hand against ${up} is a loser however you play it. Hitting loses least.`;
  }
  if (v.soft) return 'A soft hand cannot bust. There is no reason not to take a card.';
  return `Too low to stand. Take a card.`;
}

/* ------------------------------------------------------------------ *
 * Display
 * ------------------------------------------------------------------ */

export const CODE_LABEL: Record<Code, string> = {
  H: 'Hit',
  S: 'Stand',
  D: 'Double',
  Ds: 'Double / stand',
  P: 'Split',
  Ph: 'Split (DAS)',
  Pd: 'Split / double',
  R: 'Surrender / hit',
  Rs: 'Surrender / stand',
  Rp: 'Surrender / split',
};

/** The colour family a chart cell paints in, so the grid reads at a glance. */
export const CODE_TONE: Record<Code, 'hit' | 'stand' | 'double' | 'split' | 'surrender'> = {
  H: 'hit',
  S: 'stand',
  D: 'double',
  Ds: 'double',
  P: 'split',
  Ph: 'split',
  Pd: 'split',
  R: 'surrender',
  Rs: 'surrender',
  Rp: 'surrender',
};

export function upcardLabel(value: number): string {
  return value === 11 ? 'A' : String(value);
}

export type { Rank };
