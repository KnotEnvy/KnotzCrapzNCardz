/**
 * House rules, and what they cost.
 *
 * The playing rules of Three Card Poker do not vary — see `paytables.ts` — so
 * a rule set here is three paytables, which bets the table books, and its
 * limits. The presets are combinations of real tables, ordered best for the
 * player first, because the ordering is the lesson: the same game, dealt the
 * same way, costs very different amounts depending on what is printed in the
 * corner of the felt.
 *
 * Every figure the setup screen shows is read from `analysis.ts`, which
 * computes it exactly. Nothing here carries a number of its own.
 */

import { antePlayFigures, pairPlusFigures, sixCardFigures, type AntePlayFigures, type Figures } from './analysis';
import { dollars } from './money';
import { DEFAULT_ANTE_BONUS, DEFAULT_PAIR_PLUS, DEFAULT_SIX_CARD, anteBonusTable, pairPlusTable, sixCardTable } from './paytables';
import type { TableRules } from './types';

/* ------------------------------------------------------------------ *
 * Presets
 * ------------------------------------------------------------------ */

/**
 * Limits every preset shares. A five-dollar table, with the side bets capped
 * below the Ante maximum the way most tables cap them.
 */
const LIMITS = {
  minBet: dollars(5),
  maxBet: dollars(1000),
  maxPairPlus: dollars(500),
  maxSixCard: dollars(100),
} as const;

export interface RulePreset {
  id: string;
  name: string;
  /** One line on what makes it what it is. */
  note: string;
  rules: TableRules;
}

export const RULE_PRESETS: readonly RulePreset[] = [
  {
    id: 'best',
    name: 'Best posted',
    note: 'The kindest real table for each bet, all at once. You will rarely find this.',
    rules: {
      ...LIMITS,
      pairPlusTable: '40-32-6-4-1',
      anteBonusTable: '5-4-1',
      sixCardTable: '1000-200-100-20-15-9-8',
      pairPlus: true,
      sixCard: true,
    },
  },
  {
    id: 'flush-four',
    name: 'Flush pays four',
    note: 'The usual Ante Bonus, with a flush on Pair Plus paying four rather than three.',
    rules: {
      ...LIMITS,
      pairPlusTable: '40-30-6-4-1',
      anteBonusTable: '5-4-1',
      sixCardTable: '1000-200-100-20-15-10-7',
      pairPlus: true,
      sixCard: true,
    },
  },
  {
    /*
     * Above the common table, which surprised the first draft of this list:
     * the mini royal line and the trips-pay-eight bonus table each look like a
     * small tweak and each is worth about two to three points to the player.
     */
    id: 'mini-royal',
    name: 'Mini royal',
    note: 'A 200 to 1 mini royal on Pair Plus, and a 6 Card Bonus paying trips eight — as one card room posts it.',
    rules: {
      ...LIMITS,
      pairPlusTable: '200-40-30-6-3-1',
      anteBonusTable: '5-4-1',
      sixCardTable: '1000-200-100-20-15-9-8',
      pairPlus: true,
      sixCard: true,
    },
  },
  {
    id: 'common',
    name: 'The common table',
    note: 'What you are most likely to sit down at: flush pays three, Ante Bonus 5-4-1.',
    rules: {
      ...LIMITS,
      pairPlusTable: DEFAULT_PAIR_PLUS,
      anteBonusTable: DEFAULT_ANTE_BONUS,
      sixCardTable: DEFAULT_SIX_CARD,
      pairPlus: true,
      sixCard: true,
    },
  },
  {
    id: 'tight',
    name: 'Walk past it',
    note: 'Every bet on the stingiest table in this game. Each one is posted somewhere.',
    rules: {
      ...LIMITS,
      pairPlusTable: '40-30-6-3-1',
      anteBonusTable: '3-2-1',
      sixCardTable: '1000-200-50-25-15-10-5',
      pairPlus: true,
      sixCard: true,
    },
  },
];

export const DEFAULT_PRESET = 'common';

export function presetById(id: string): RulePreset {
  return RULE_PRESETS.find((p) => p.id === id) ?? RULE_PRESETS.find((p) => p.id === DEFAULT_PRESET)!;
}

export function defaultRules(): TableRules {
  return { ...presetById(DEFAULT_PRESET).rules };
}

/** Which preset a rule set matches, if any. Limits are not part of the match. */
export function matchingPreset(rules: TableRules): RulePreset | null {
  return (
    RULE_PRESETS.find(
      (p) =>
        p.rules.pairPlusTable === pairPlusTable(rules.pairPlusTable).id &&
        p.rules.anteBonusTable === anteBonusTable(rules.anteBonusTable).id &&
        p.rules.sixCardTable === sixCardTable(rules.sixCardTable).id &&
        p.rules.pairPlus === rules.pairPlus &&
        p.rules.sixCard === rules.sixCard,
    ) ?? null
  );
}

/* ------------------------------------------------------------------ *
 * What a table costs
 * ------------------------------------------------------------------ */

export interface TableFigures {
  antePlay: AntePlayFigures;
  /** Null where the table does not book the bet. */
  pairPlus: Figures | null;
  sixCard: Figures | null;
}

/**
 * Every figure for a rule set, exactly, and cheaply.
 *
 * All closed form over the constants in `analysis.ts` — a handful of
 * multiplications — so it is safe to call during render, and the setup screen
 * does, on every click.
 */
export function tableFigures(rules: TableRules): TableFigures {
  return {
    antePlay: antePlayFigures(rules.anteBonusTable),
    pairPlus: rules.pairPlus ? pairPlusFigures(rules.pairPlusTable) : null,
    sixCard: rules.sixCard ? sixCardFigures(rules.sixCardTable) : null,
  };
}

/** `PP 40-30-6-3-1 · AB 5-4-1 · 6CB 1000-200-100-20-15-10-7` — the rack card in one line. */
export function rulesShorthand(rules: TableRules): string {
  const parts = [];
  if (rules.pairPlus) parts.push(`PP ${pairPlusTable(rules.pairPlusTable).id}`);
  parts.push(`AB ${anteBonusTable(rules.anteBonusTable).id}`);
  if (rules.sixCard) parts.push(`6CB ${sixCardTable(rules.sixCardTable).id}`);
  return parts.join(' · ');
}
