/**
 * House rules, and what they cost.
 *
 * Blackjack is not one game. The same table shape runs at anywhere between
 * 0.05% and 1.85% against the player across the presets here — and further in
 * both directions once the switches are moved by hand — depending on six or
 * seven of them, and
 * the whole point of putting them in the setup screen is that a player can see
 * the number move. So every rule here carries its measured cost as well as its
 * value, and the setup screen reads both from this file.
 *
 * The edge figures are the standard published deltas for a basic-strategy
 * player. They are an *estimate the UI displays*, not something the engine
 * relies on: `stats.sim.test.ts` measures the real edge of each preset by
 * dealing hundreds of thousands of hands, and the two are asserted against
 * each other. If a rule is ever added here without a simulation to back it,
 * that test is the one that should fail.
 */

import { dollars } from './money';
import type { BlackjackPayout, DoubleRule, SideBetKind, SurrenderRule, TableRules } from './types';

/* ------------------------------------------------------------------ *
 * Presets
 * ------------------------------------------------------------------ */

const NO_SIDE_BETS: Record<SideBetKind, boolean> = {
  PERFECT_PAIRS: false,
  TWENTY_ONE_PLUS_THREE: false,
  LUCKY_LADIES: false,
  ROYAL_MATCH: false,
  BUST_IT: false,
  SUPER_SEVENS: false,
};

const COMMON = {
  penetration: 0.75,
  doubleSoft: true,
  resplitAces: false,
  oneCardOnSplitAces: true,
  splitAcesBlackjack: false,
  insurance: true,
  minBet: dollars(5),
  maxBet: dollars(2000),
} as const;

export interface RulePreset {
  id: string;
  name: string;
  /** Where you would actually find this game. */
  where: string;
  /** One line on what makes it what it is. */
  note: string;
  rules: TableRules;
}

/**
 * The five games worth having on a dial.
 *
 * They are ordered by how good they are for the player, because that ordering
 * is the lesson: the difference between the first and the last is larger than
 * the difference between playing perfectly and playing badly.
 */
export const RULE_PRESETS: readonly RulePreset[] = [
  {
    id: 'single-deck',
    name: 'Single Deck',
    where: 'Downtown Las Vegas',
    note: 'The best odds on the floor, paid at 6:5 so that they are not.',
    rules: {
      ...COMMON,
      decks: 1,
      penetration: 0.65,
      hitsSoft17: true,
      blackjackPays: '6:5',
      double: '10-11',
      das: false,
      resplitTo: 3,
      surrender: 'NONE',
      holeCard: 'PEEK',
      sideBets: { ...NO_SIDE_BETS },
    },
  },
  {
    id: 'vegas-strip',
    name: 'Vegas Strip',
    where: 'A six-deck shoe on the Strip',
    note: 'The default American game: dealer stands on soft 17, split to four.',
    rules: {
      ...COMMON,
      decks: 6,
      hitsSoft17: false,
      blackjackPays: '3:2',
      double: 'ANY2',
      das: true,
      resplitTo: 3,
      surrender: 'NONE',
      holeCard: 'PEEK',
      sideBets: { ...NO_SIDE_BETS, PERFECT_PAIRS: true, TWENTY_ONE_PLUS_THREE: true },
    },
  },
  {
    id: 'atlantic-city',
    name: 'Atlantic City',
    where: 'Eight decks, boardwalk',
    note: 'Late surrender and double after split, against two more decks.',
    rules: {
      ...COMMON,
      decks: 8,
      hitsSoft17: false,
      blackjackPays: '3:2',
      double: 'ANY2',
      das: true,
      // Four hands, like the real boardwalk game. The eight decks are what
      // this preset costs the player, not a tighter split limit.
      resplitTo: 3,
      surrender: 'LATE',
      holeCard: 'PEEK',
      sideBets: { ...NO_SIDE_BETS, PERFECT_PAIRS: true, TWENTY_ONE_PLUS_THREE: true, LUCKY_LADIES: true },
    },
  },
  {
    id: 'european',
    name: 'European',
    where: 'London, Monte Carlo',
    note: 'No hole card: a dealer blackjack takes your doubles and splits too.',
    rules: {
      ...COMMON,
      decks: 6,
      hitsSoft17: false,
      blackjackPays: '3:2',
      double: '9-11',
      doubleSoft: false,
      das: true,
      resplitTo: 3,
      surrender: 'NONE',
      holeCard: 'ENHC',
      sideBets: { ...NO_SIDE_BETS, PERFECT_PAIRS: true, ROYAL_MATCH: true },
    },
  },
  {
    id: 'liberal',
    name: 'Liberal Shoe',
    where: 'The game they used to spread',
    note: 'Everything the player wants at once, for comparison. The best game here.',
    rules: {
      ...COMMON,
      decks: 2,
      penetration: 0.8,
      hitsSoft17: false,
      blackjackPays: '3:2',
      double: 'ANY2',
      das: true,
      resplitTo: 3,
      resplitAces: true,
      surrender: 'LATE',
      holeCard: 'PEEK',
      sideBets: { ...NO_SIDE_BETS, PERFECT_PAIRS: true, TWENTY_ONE_PLUS_THREE: true, LUCKY_LADIES: true, ROYAL_MATCH: true, BUST_IT: true, SUPER_SEVENS: true },
    },
  },
];

export const DEFAULT_PRESET = 'vegas-strip';

export function presetById(id: string): RulePreset {
  return RULE_PRESETS.find((p) => p.id === id) ?? RULE_PRESETS[1];
}

export function defaultRules(): TableRules {
  return { ...presetById(DEFAULT_PRESET).rules, sideBets: { ...presetById(DEFAULT_PRESET).rules.sideBets } };
}

/** Which preset, if any, a rule set currently matches. Setup shows "Custom" otherwise. */
export function matchingPreset(rules: TableRules): RulePreset | null {
  return (
    RULE_PRESETS.find((p) => {
      const a = p.rules;
      return (
        a.decks === rules.decks &&
        a.hitsSoft17 === rules.hitsSoft17 &&
        a.blackjackPays === rules.blackjackPays &&
        a.double === rules.double &&
        a.doubleSoft === rules.doubleSoft &&
        a.das === rules.das &&
        a.resplitTo === rules.resplitTo &&
        a.resplitAces === rules.resplitAces &&
        a.surrender === rules.surrender &&
        a.holeCard === rules.holeCard
      );
    }) ?? null
  );
}

/* ------------------------------------------------------------------ *
 * Payouts
 * ------------------------------------------------------------------ */

export function blackjackRatio(pays: BlackjackPayout): readonly [number, number] {
  switch (pays) {
    case '3:2':
      return [3, 2];
    case '6:5':
      return [6, 5];
    case '2:1':
      return [2, 1];
    case '1:1':
      return [1, 1];
  }
}

/** Insurance is 2:1 everywhere. It is here so no call site hard-codes it. */
export const INSURANCE_RATIO = [2, 1] as const;

/** Insurance is capped at half the main wager. */
export function maxInsurance(mainBet: number): number {
  return Math.floor(mainBet / 2);
}

/* ------------------------------------------------------------------ *
 * What each rule costs
 * ------------------------------------------------------------------ */

/**
 * The published basic-strategy edge deltas, in percent of the initial wager.
 *
 * Positive is good for the player. These are the standard figures for a
 * six-deck game. The deck-count entry is an absolute position rather than a
 * delta, so {@link ruleEffects} subtracts the baseline's own six-deck value
 * from it before reporting; everything else is already a delta.
 */
export const RULE_EFFECTS = {
  decks: { 1: 0.48, 2: 0.19, 4: 0.06, 6: 0.0, 8: -0.02 } as Record<number, number>,
  hitsSoft17: -0.22,
  blackjackPays: { '3:2': 0.0, '6:5': -1.39, '2:1': 2.27, '1:1': -2.27 } as Record<BlackjackPayout, number>,
  double: { ANY2: 0.0, '9-11': -0.09, '10-11': -0.18 } as Record<DoubleRule, number>,
  noDoubleSoft: -0.13,
  das: 0.14,
  resplitTo: { 1: -0.1, 2: -0.01, 3: 0.0 } as Record<number, number>,
  resplitAces: 0.08,
  hitSplitAces: 0.19,
  surrender: { NONE: 0.0, LATE: 0.08, EARLY: 0.63 } as Record<SurrenderRule, number>,
  enhc: -0.11,
} as const;

/**
 * The reference game the baseline describes.
 *
 * Six decks, dealer stands on all seventeens, blackjack pays three to two,
 * double on any two cards including soft totals, double after split allowed,
 * split to four hands, no re-split of aces, one card to split aces, no
 * surrender, dealer peeks. That game runs at 0.40% against a basic-strategy
 * player, and it is the number every published per-rule effect is quoted as a
 * delta from.
 *
 * Naming it matters. The baseline used to be a bare constant, and because
 * nothing said what it included, double-after-split was credited a second time
 * on top of a figure that already had it — which made every displayed edge
 * 0.14 points too generous and told a player at the Liberal Shoe table that
 * they held a 0.09% advantage over the house. A rule that is part of the
 * baseline is priced as a *penalty when absent*, never as a bonus when
 * present, and that is the invariant this block exists to keep.
 */
const BASELINE = {
  edge: 0.4,
  decks: 6,
  hitsSoft17: false,
  blackjackPays: '3:2' as BlackjackPayout,
  double: 'ANY2' as DoubleRule,
  doubleSoft: true,
  das: true,
  resplitTo: 3,
  resplitAces: false,
  oneCardOnSplitAces: true,
  surrender: 'NONE' as SurrenderRule,
  holeCard: 'PEEK' as const,
} as const;

/** One line of the price list: what a rule is called, and what it is worth. */
export interface RuleEffect {
  label: string;
  /** Percent of the initial wager. Positive favours the player. */
  delta: number;
  good: boolean;
}

/**
 * Every way this table differs from the reference game, and what each is worth
 * to the player in percent.
 *
 * One list, used for both the number and the breakdown beside it, so the
 * itemisation cannot fail to sum to the total it sits next to — which it did
 * not before: the panel listed "+0.22 dealer stands on all 17s" as a credit
 * against a baseline that already stood on all seventeens.
 */
export function ruleEffects(rules: TableRules): RuleEffect[] {
  const out: RuleEffect[] = [];
  const push = (label: string, delta: number) => {
    if (Math.abs(delta) >= 0.005) out.push({ label, delta, good: delta > 0 });
  };

  const decks = RULE_EFFECTS.decks[rules.decks] ?? RULE_EFFECTS.decks[8];
  push(`${rules.decks} deck${rules.decks === 1 ? '' : 's'}`, decks - RULE_EFFECTS.decks[BASELINE.decks]);
  if (rules.blackjackPays !== BASELINE.blackjackPays) {
    push(`Blackjack pays ${rules.blackjackPays}`, RULE_EFFECTS.blackjackPays[rules.blackjackPays]);
  }
  if (rules.hitsSoft17 !== BASELINE.hitsSoft17) push('Dealer hits soft 17', RULE_EFFECTS.hitsSoft17);
  if (rules.double !== BASELINE.double) push(`Double on ${rules.double} only`, RULE_EFFECTS.double[rules.double]);
  /*
   * The soft-double switch only costs anything at a table that would otherwise
   * allow it. A total restriction of 9-11 or 10-11 is read against the hand's
   * total, and every soft total is thirteen or more, so those tables refuse
   * every soft double already — and the published figure for "double 9-11
   * only" is quoted against "double any two cards", which includes soft
   * doubling, so it has that loss in it.
   *
   * Charging both double-counted one restriction and made the European preset
   * look 0.13 points worse than it is. It is the same mistake as crediting
   * double-after-split on top of a baseline that already had it, in the same
   * function, found by chasing down which preset kept drifting from its
   * measurement.
   */
  if (rules.doubleSoft !== BASELINE.doubleSoft && rules.double === 'ANY2') {
    push('No soft doubling', RULE_EFFECTS.noDoubleSoft);
  }
  if (rules.das !== BASELINE.das) push('No double after split', -RULE_EFFECTS.das);
  if (rules.resplitTo !== BASELINE.resplitTo) {
    push(`Split to ${rules.resplitTo + 1} hands`, RULE_EFFECTS.resplitTo[Math.min(3, rules.resplitTo)] ?? 0);
  }
  if (rules.resplitAces !== BASELINE.resplitAces) push('Re-split aces', RULE_EFFECTS.resplitAces);
  if (rules.oneCardOnSplitAces !== BASELINE.oneCardOnSplitAces) push('Hit split aces', RULE_EFFECTS.hitSplitAces);
  if (rules.surrender !== BASELINE.surrender) {
    push(`${rules.surrender === 'EARLY' ? 'Early' : 'Late'} surrender`, RULE_EFFECTS.surrender[rules.surrender]);
  }
  if (rules.holeCard !== BASELINE.holeCard) push('No hole card', RULE_EFFECTS.enhc);

  return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

/**
 * The house edge a basic-strategy player faces, in percent.
 *
 * The reference game's 0.40%, less everything {@link ruleEffects} says this
 * table gives the player back. Deriving both from one list is what guarantees
 * the breakdown in the setup screen adds up to the headline above it.
 *
 * The deltas are not perfectly independent — the value of double-after-split
 * depends slightly on how deep you may re-split — but the interaction terms
 * are under a hundredth of a percent, well below what the figure is displayed
 * to. `stats.sim.test.ts` deals each preset out and asserts the measured edge
 * lands within three standard errors of this, about 0.39% at the rounds it
 * runs; blackjack's variance makes a tighter check impossible at any feasible
 * length, which is why the *sign* is asserted separately.
 */
export function estimateHouseEdge(rules: TableRules): number {
  return BASELINE.edge - ruleEffects(rules).reduce((n, e) => n + e.delta, 0);
}

/** `6D · S17 · 3:2 · DAS · RSA` — the shorthand a player would read off a felt. */
export function rulesShorthand(rules: TableRules): string {
  const parts = [
    `${rules.decks}D`,
    rules.hitsSoft17 ? 'H17' : 'S17',
    rules.blackjackPays,
    rules.double === 'ANY2' ? 'D2' : `D${rules.double}`,
  ];
  if (rules.das) parts.push('DAS');
  if (rules.resplitAces) parts.push('RSA');
  if (rules.surrender === 'LATE') parts.push('LS');
  if (rules.surrender === 'EARLY') parts.push('ES');
  if (rules.holeCard === 'ENHC') parts.push('ENHC');
  return parts.join(' · ');
}
