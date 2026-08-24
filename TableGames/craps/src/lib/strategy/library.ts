/**
 * The house library: seventeen systems you will hear called at a real table.
 *
 * These are written in exactly the same rule language the workshop hands the
 * player — there is no privileged built-in path. Open any one of them, hit
 * Duplicate, and every rule is there to be edited. That is deliberate: the
 * fastest way to learn the builder is to take apart something that works.
 *
 * Each carries a base `unit`, and the classic dollar names fall out of the
 * engine's own increment rules rather than being hard-coded. One $5 unit on
 * the six goes up as six dollars, so "one unit inside" at a $5 unit is $22
 * inside, and two units is $44 — the same arithmetic a dealer does.
 */

import type { BetKind } from '@/lib/engine/types';
import { describeRule } from './describe';
import {
  MAX_ODDS,
  fixed,
  units,
  type Action,
  type Condition,
  type OnceScope,
  type Strategy,
  type StrategyRule,
  type Trigger,
} from './types';

/* ------------------------------------------------------------------ *
 * Builders
 * ------------------------------------------------------------------ */

interface RuleSpec {
  note?: string;
  when: Trigger;
  once?: OnceScope;
  all?: Condition[];
  then: Action[];
}

interface StrategySpec {
  id: string;
  name: string;
  summary: string;
  unit: number;
  winGoal?: number;
  lossLimit?: number;
  rules: RuleSpec[];
}

/*
 * A note on triggers: these systems key their opening bets off POINT_ON — the
 * state — rather than POINT_SET, the event. Both fire on the roll that
 * establishes a point, but only the state trigger also fires when a player
 * drops a system onto a seat halfway through a hand. Paired with `once: POINT`
 * it still places exactly once per point cycle. POINT_SET is still there in the
 * builder for rules that genuinely mean "the moment it happened".
 */

/**
 * Rule ids are derived from the strategy id and the rule's position, so they
 * are stable across reloads. `once` bookkeeping and React keys both hang off
 * them, and a counter that resets on page load would quietly re-arm every
 * once-per-session rule a restored table had already spent.
 */
function build(spec: StrategySpec): Strategy {
  return {
    id: spec.id,
    name: spec.name,
    summary: spec.summary,
    origin: 'HOUSE',
    unit: spec.unit,
    winGoal: spec.winGoal ?? 0,
    lossLimit: spec.lossLimit ?? 0,
    rules: spec.rules.map(
      (r, i): StrategyRule => ({
        id: `${spec.id}#${i}`,
        note: r.note,
        enabled: true,
        when: r.when,
        once: r.once ?? 'ALWAYS',
        all: r.all ?? [],
        then: r.then,
      }),
    ),
  };
}

/* Condition shorthands, so the rules below read like the calls they are. */

const noBet = (kind: BetKind): Condition => ({ t: 'HAS_BET', target: { kind }, has: false });

const noBetOn = (kind: BetKind, number: 4 | 5 | 6 | 8 | 9 | 10): Condition => ({
  t: 'HAS_BET',
  target: { kind, number },
  has: false,
});

const fewerThan = (kind: BetKind, value: number): Condition => ({
  t: 'BET_COUNT',
  kind,
  op: 'LT',
  value,
});

/* ------------------------------------------------------------------ *
 * The systems
 * ------------------------------------------------------------------ */

const SPECS: StrategySpec[] = [
  /* ---------------- The right side ---------------- */

  {
    id: 'pass-odds',
    name: 'Pass Line & Full Odds',
    summary:
      'The cheapest bet in the casino. Flat on the line, then the biggest odds the table allows behind it.',
    unit: 10,
    rules: [
      {
        note: 'Line bet every come-out',
        when: 'COME_OUT',
        all: [noBet('PASS')],
        then: [{ t: 'BET', target: { kind: 'PASS' }, amount: units(1) }],
      },
      {
        note: 'Back it with everything the table allows',
        when: 'POINT_ON',
        then: [{ t: 'ODDS', on: 'PASS', amount: MAX_ODDS }],
      },
    ],
  },

  {
    id: 'three-point-molly',
    name: 'Three Point Molly',
    summary:
      'Pass line plus two come bets, all with full odds. Three numbers working and nothing on the felt that carries a house edge above 1.4 percent.',
    unit: 10,
    rules: [
      {
        note: 'Line bet every come-out',
        when: 'COME_OUT',
        all: [noBet('PASS')],
        then: [{ t: 'BET', target: { kind: 'PASS' }, amount: units(1) }],
      },
      {
        note: 'Keep two come bets travelling',
        when: 'POINT_ON',
        all: [fewerThan('COME', 2)],
        then: [{ t: 'BET', target: { kind: 'COME' }, amount: units(1) }],
      },
      {
        note: 'Full odds behind everything with a number',
        when: 'POINT_ON',
        then: [{ t: 'ODDS', on: 'ALL', amount: MAX_ODDS }],
      },
    ],
  },

  {
    id: 'six-and-eight',
    name: 'Six & Eight Only',
    summary:
      'The two best place bets on the layout and nothing else. A 1.52 percent edge and six ways each to hit.',
    unit: 5,
    rules: [
      {
        note: 'Something on the line to come out with',
        when: 'COME_OUT',
        all: [noBet('PASS')],
        then: [{ t: 'BET', target: { kind: 'PASS' }, amount: units(1) }],
      },
      {
        note: 'Place the six',
        when: 'POINT_ON',
        all: [noBetOn('PLACE', 6)],
        then: [{ t: 'BET', target: { kind: 'PLACE', number: 6 }, amount: units(1) }],
      },
      {
        note: 'Place the eight',
        when: 'POINT_ON',
        all: [noBetOn('PLACE', 8)],
        then: [{ t: 'BET', target: { kind: 'PLACE', number: 8 }, amount: units(1) }],
      },
    ],
  },

  {
    id: 'inside-22',
    name: '$22 Inside',
    summary:
      'Five, six, eight and nine placed the moment the point is set. Eighteen of the thirty-six combinations pay you.',
    unit: 5,
    rules: [
      {
        note: 'Inside numbers as soon as there is a point',
        when: 'POINT_ON',
        once: 'POINT',
        then: [{ t: 'BET', target: { kind: 'PLACE', number: 'INSIDE' }, amount: units(1) }],
      },
    ],
  },

  {
    id: 'across',
    name: 'Across the Board',
    summary:
      'All six box numbers covered. Everything but the seven pays, and the seven takes the lot.',
    unit: 5,
    rules: [
      {
        note: 'All six numbers once the point is set',
        when: 'POINT_ON',
        once: 'POINT',
        then: [{ t: 'BET', target: { kind: 'PLACE', number: 'ACROSS' }, amount: units(1) }],
      },
    ],
  },

  {
    id: 'iron-cross',
    name: 'Iron Cross',
    summary:
      'Five, six, eight and the field. Every number on the dice pays except the seven — which is why the seven is expensive.',
    unit: 5,
    rules: [
      {
        note: 'Line bet every come-out',
        when: 'COME_OUT',
        all: [noBet('PASS')],
        then: [{ t: 'BET', target: { kind: 'PASS' }, amount: units(1) }],
      },
      {
        note: 'Place the five',
        when: 'POINT_ON',
        all: [noBetOn('PLACE', 5)],
        then: [{ t: 'BET', target: { kind: 'PLACE', number: 5 }, amount: units(1) }],
      },
      {
        note: 'Place the six',
        when: 'POINT_ON',
        all: [noBetOn('PLACE', 6)],
        then: [{ t: 'BET', target: { kind: 'PLACE', number: 6 }, amount: units(1) }],
      },
      {
        note: 'Place the eight',
        when: 'POINT_ON',
        all: [noBetOn('PLACE', 8)],
        then: [{ t: 'BET', target: { kind: 'PLACE', number: 8 }, amount: units(1) }],
      },
      {
        note: 'Cover the rest with the field',
        when: 'POINT_ON',
        all: [noBet('FIELD')],
        then: [{ t: 'BET', target: { kind: 'FIELD' }, amount: units(1) }],
      },
    ],
  },

  {
    id: 'place-and-press',
    name: 'Place and Press',
    summary:
      'Six and eight, and every time one of them hits it goes up a unit. Stops pressing at sixty dollars so the profit is not all back on the felt.',
    unit: 5,
    rules: [
      {
        note: 'Line bet every come-out',
        when: 'COME_OUT',
        all: [noBet('PASS')],
        then: [{ t: 'BET', target: { kind: 'PASS' }, amount: units(1) }],
      },
      {
        note: 'Place the six',
        when: 'POINT_ON',
        all: [noBetOn('PLACE', 6)],
        then: [{ t: 'BET', target: { kind: 'PLACE', number: 6 }, amount: units(1) }],
      },
      {
        note: 'Place the eight',
        when: 'POINT_ON',
        all: [noBetOn('PLACE', 8)],
        then: [{ t: 'BET', target: { kind: 'PLACE', number: 8 }, amount: units(1) }],
      },
      {
        note: 'Press whichever one just hit',
        when: 'NUMBER_HIT',
        all: [
          { t: 'HIT_IS', numbers: [6, 8] },
          { t: 'BET_AMOUNT', target: { kind: 'PLACE', number: 'HIT' }, op: 'LT', value: 60 },
        ],
        then: [{ t: 'PRESS', number: 'HIT', amount: units(1) }],
      },
    ],
  },

  {
    id: 'regression-44',
    name: '$44 Inside Regression',
    summary:
      'Start at forty-four inside, come straight back down to twenty-two on the first hit, then press from there. The hit pays for the whole exposure.',
    unit: 5,
    rules: [
      {
        // Sits above the rule that creates the bets on purpose. On the roll
        // that sets the point there is nothing placed yet, so it finds nothing
        // to do and its once-per-point budget stays unspent for the real hit.
        note: 'First hit: regress to twenty-two inside',
        when: 'NUMBER_HIT',
        once: 'POINT',
        then: [{ t: 'REGRESS', number: 'INSIDE', amount: units(1) }],
      },
      {
        note: 'Forty-four inside when the point is set',
        when: 'POINT_ON',
        once: 'POINT',
        then: [{ t: 'BET', target: { kind: 'PLACE', number: 'INSIDE' }, amount: units(2) }],
      },
      {
        note: 'After the regression, press the number that hits',
        when: 'NUMBER_HIT',
        all: [
          { t: 'HITS_ON', number: 'HIT', op: 'GTE', value: 2 },
          { t: 'BET_AMOUNT', target: { kind: 'PLACE', number: 'HIT' }, op: 'LT', value: 60 },
        ],
        then: [{ t: 'PRESS', number: 'HIT', amount: units(1) }],
      },
    ],
  },

  {
    id: 'two-hits-down',
    name: 'Two Hits and Down',
    summary:
      'Inside numbers, and any number that pays twice comes off the felt for good. Takes the money and shrinks the exposure as the hand goes on.',
    unit: 5,
    winGoal: 200,
    rules: [
      {
        note: 'Inside numbers when the point is set',
        when: 'POINT_ON',
        once: 'POINT',
        then: [{ t: 'BET', target: { kind: 'PLACE', number: 'INSIDE' }, amount: units(1) }],
      },
      {
        note: 'Two hits and that number comes down',
        when: 'NUMBER_HIT',
        all: [{ t: 'HITS_ON', number: 'HIT', op: 'GTE', value: 2 }],
        then: [{ t: 'TAKE_DOWN', target: { target: { kind: 'PLACE', number: 'HIT' } } }],
      },
    ],
  },

  {
    id: 'hardway-hedge',
    name: 'Hardway Hedge',
    summary:
      'Pass line with full odds, plus a small bet that the point comes the hard way. A seven-to-one kicker on the number you already want.',
    unit: 10,
    rules: [
      {
        note: 'Line bet every come-out',
        when: 'COME_OUT',
        all: [noBet('PASS')],
        then: [{ t: 'BET', target: { kind: 'PASS' }, amount: units(1) }],
      },
      {
        note: 'Full odds behind the line',
        when: 'POINT_ON',
        then: [{ t: 'ODDS', on: 'PASS', amount: MAX_ODDS }],
      },
      {
        note: 'Hard way on the point, when it has one',
        when: 'POINT_ON',
        once: 'POINT',
        all: [{ t: 'POINT_IS', numbers: [4, 6, 8, 10] }],
        then: [{ t: 'BET', target: { kind: 'HARDWAY', number: 'POINT' }, amount: fixed(5) }],
      },
    ],
  },

  {
    id: 'five-count',
    name: 'The 5-Count',
    summary:
      'Sit out the first five rolls of every hand, then play the line and two comes. A simplified count: five rolls thrown, not five qualifying numbers.',
    unit: 10,
    rules: [
      {
        note: 'Nothing until the shooter has thrown five',
        when: 'COME_OUT',
        all: [{ t: 'ROLLS_THIS_HAND', op: 'GTE', value: 5 }, noBet('PASS')],
        then: [{ t: 'BET', target: { kind: 'PASS' }, amount: units(1) }],
      },
      {
        note: 'Then two come bets behind it',
        when: 'POINT_ON',
        all: [{ t: 'ROLLS_THIS_HAND', op: 'GTE', value: 5 }, fewerThan('COME', 2)],
        then: [{ t: 'BET', target: { kind: 'COME' }, amount: units(1) }],
      },
      {
        note: 'Full odds on whatever qualified',
        when: 'POINT_ON',
        all: [{ t: 'ROLLS_THIS_HAND', op: 'GTE', value: 5 }],
        then: [{ t: 'ODDS', on: 'ALL', amount: MAX_ODDS }],
      },
    ],
  },

  {
    id: 'field-grinder',
    name: 'Field Grinder',
    summary:
      'The field, every single roll. Sixteen of thirty-six combinations win, which sounds better than the 2.8 percent it costs. Carries a loss limit for a reason.',
    unit: 5,
    lossLimit: 150,
    rules: [
      {
        note: 'Field every roll',
        when: 'EVERY_ROLL',
        all: [noBet('FIELD')],
        then: [{ t: 'BET', target: { kind: 'FIELD' }, amount: units(1) }],
      },
    ],
  },

  /* ---------------- The dark side ---------------- */

  {
    id: 'dont-pass-odds',
    name: "Don't Pass & Lay Odds",
    summary:
      'The other side of the line, at a slightly lower edge than the pass. Lay the full odds and the seven works for you.',
    unit: 10,
    rules: [
      {
        note: "Don't pass every come-out",
        when: 'COME_OUT',
        all: [noBet('DONT_PASS')],
        then: [{ t: 'BET', target: { kind: 'DONT_PASS' }, amount: units(1) }],
      },
      {
        note: 'Lay the full odds behind it',
        when: 'POINT_ON',
        then: [{ t: 'ODDS', on: 'DONT_PASS', amount: MAX_ODDS }],
      },
    ],
  },

  {
    id: 'dont-two-dc',
    name: "Don't Pass & Two Don't Comes",
    summary:
      "The dark-side mirror of the Molly. Three numbers laid against, and one seven collects all of them at once.",
    unit: 10,
    rules: [
      {
        note: "Don't pass every come-out",
        when: 'COME_OUT',
        all: [noBet('DONT_PASS')],
        then: [{ t: 'BET', target: { kind: 'DONT_PASS' }, amount: units(1) }],
      },
      {
        note: "Two don't comes behind it",
        when: 'POINT_ON',
        all: [fewerThan('DONT_COME', 2)],
        then: [{ t: 'BET', target: { kind: 'DONT_COME' }, amount: units(1) }],
      },
      {
        note: 'Lay the odds on everything with a number',
        when: 'POINT_ON',
        then: [{ t: 'ODDS', on: 'ALL', amount: MAX_ODDS }],
      },
    ],
  },

  {
    id: 'hedged-dont',
    name: "Hedged Don't Pass",
    summary:
      "Don't pass with a couple of dollars on any craps to cover the come-out eleven's evil twin. The hedge comes off the moment a point is set.",
    unit: 10,
    rules: [
      {
        note: "Don't pass every come-out",
        when: 'COME_OUT',
        all: [noBet('DONT_PASS')],
        then: [{ t: 'BET', target: { kind: 'DONT_PASS' }, amount: units(1) }],
      },
      {
        note: 'Small hedge on any craps for the come-out only',
        when: 'COME_OUT',
        all: [{ t: 'HAS_BET', target: { kind: 'PROP', prop: 'ANY_CRAPS' }, has: false }],
        then: [{ t: 'BET', target: { kind: 'PROP', prop: 'ANY_CRAPS' }, amount: fixed(2) }],
      },
      {
        note: 'Hedge comes off once there is a point',
        when: 'POINT_ON',
        then: [
          { t: 'TAKE_DOWN', target: { target: { kind: 'PROP', prop: 'ANY_CRAPS' } } },
        ],
      },
      {
        note: 'Lay the full odds',
        when: 'POINT_ON',
        then: [{ t: 'ODDS', on: 'DONT_PASS', amount: MAX_ODDS }],
      },
    ],
  },

  {
    id: 'lay-4-10',
    name: 'Lay the Four and Ten',
    summary:
      'Lay against the two hardest numbers on the layout. Each pays one for two, and the seven comes twice as often as either of them.',
    unit: 10,
    rules: [
      {
        note: 'Lay the four',
        when: 'EVERY_ROLL',
        all: [noBetOn('LAY', 4)],
        then: [{ t: 'BET', target: { kind: 'LAY', number: 4 }, amount: units(4) }],
      },
      {
        note: 'Lay the ten',
        when: 'EVERY_ROLL',
        all: [noBetOn('LAY', 10)],
        then: [{ t: 'BET', target: { kind: 'LAY', number: 10 }, amount: units(4) }],
      },
    ],
  },

  /* ---------------- Side bets ---------------- */

  {
    id: 'fire-chaser',
    name: 'Fire Bet Chaser',
    summary:
      'A few dollars on the Fire Bet and All every time the dice change hands, backed by a pass line with odds. Four points pays 24 to 1, six pays 999.',
    unit: 10,
    rules: [
      {
        note: 'Fire Bet before the new shooter comes out',
        when: 'HAND_START',
        once: 'HAND',
        all: [noBet('FIRE')],
        then: [{ t: 'BET', target: { kind: 'FIRE' }, amount: fixed(5) }],
      },
      {
        note: 'And a few dollars on All',
        when: 'HAND_START',
        once: 'HAND',
        all: [{ t: 'HAS_BET', target: { kind: 'ATS', ats: 'ALL' }, has: false }],
        then: [{ t: 'BET', target: { kind: 'ATS', ats: 'ALL' }, amount: fixed(5) }],
      },
      {
        note: 'Line bet every come-out',
        when: 'COME_OUT',
        all: [noBet('PASS')],
        then: [{ t: 'BET', target: { kind: 'PASS' }, amount: units(1) }],
      },
      {
        note: 'Full odds behind the line',
        when: 'POINT_ON',
        then: [{ t: 'ODDS', on: 'PASS', amount: MAX_ODDS }],
      },
    ],
  },
];

export const HOUSE_STRATEGIES: readonly Strategy[] = SPECS.map(build);

export const HOUSE_BY_ID: ReadonlyMap<string, Strategy> = new Map(
  HOUSE_STRATEGIES.map((s) => [s.id, s]),
);

/* ------------------------------------------------------------------ *
 * A blank strategy to start from
 * ------------------------------------------------------------------ */

export function emptyStrategy(id: string, name = 'My strategy'): Strategy {
  return {
    id,
    name,
    summary: 'A system of my own.',
    origin: 'CUSTOM',
    unit: 10,
    winGoal: 0,
    lossLimit: 0,
    rules: [],
  };
}

/** A house strategy copied into the player's own library, ready to edit. */
export function duplicateStrategy(source: Strategy, id: string, name?: string): Strategy {
  return {
    ...source,
    id,
    name: name ?? `${source.name} (mine)`,
    origin: 'CUSTOM',
    rules: source.rules.map((rule, i) => ({
      ...rule,
      id: `${id}#${i}`,
      all: rule.all.map((c) => ({ ...c })),
      then: rule.then.map((a) => ({ ...a })),
    })),
  };
}

/* ------------------------------------------------------------------ *
 * Sanity checks shown in the builder
 * ------------------------------------------------------------------ */

export interface StrategyWarning {
  /** The rule it is about, or null for the strategy as a whole. */
  ruleId: string | null;
  text: string;
}

/**
 * Things that will not throw but will not do what the player meant either.
 *
 * The engine already refuses an illegal bet with a reason, so this is not
 * about safety — it is about saying so in the builder rather than fifty rolls
 * later in the log.
 */
export function strategyWarnings(strategy: Strategy): StrategyWarning[] {
  const out: StrategyWarning[] = [];

  if (strategy.unit <= 0) {
    out.push({ ruleId: null, text: 'The base unit is zero, so every bet in units comes to nothing.' });
  }
  if (strategy.rules.length === 0) {
    out.push({ ruleId: null, text: 'No rules yet. This strategy will not bet anything.' });
  }
  if (strategy.rules.length > 0 && strategy.rules.every((r) => !r.enabled)) {
    out.push({ ruleId: null, text: 'Every rule is switched off.' });
  }

  for (const rule of strategy.rules) {
    if (!rule.enabled) continue;

    if (rule.then.length === 0) {
      out.push({ ruleId: rule.id, text: 'This rule does nothing — it has no actions.' });
    }

    for (const action of rule.then) {
      if (action.t !== 'BET') continue;
      const kind = action.target.kind;

      if ((kind === 'PASS' || kind === 'DONT_PASS') && rule.when === 'POINT_ON') {
        out.push({
          ruleId: rule.id,
          text: 'The line is closed once the point is on, so this bet will be refused every roll.',
        });
      }
      if ((kind === 'COME' || kind === 'DONT_COME') && rule.when === 'COME_OUT') {
        out.push({
          ruleId: rule.id,
          text: 'Come bets only open once a point is established.',
        });
      }
      if (kind === 'FIRE' && rule.when !== 'HAND_START') {
        out.push({
          ruleId: rule.id,
          text: 'The Fire Bet has to be down before the shooter comes out — trigger it on a new shooter.',
        });
      }

      // A plain bet names a level and is safe to re-state, so only the
      // explicit "on top" needs a word — that one really does grow the bet
      // every roll until the rack is gone.
      const guarded = rule.all.some(
        (c) => (c.t === 'HAS_BET' && !c.has) || c.t === 'BET_AMOUNT' || c.t === 'BET_COUNT',
      );
      const repeats = action.topUp && rule.once === 'ALWAYS' && !guarded;
      if (repeats && (rule.when === 'EVERY_ROLL' || rule.when === 'POINT_ON' || rule.when === 'COME_OUT')) {
        out.push({
          ruleId: rule.id,
          text: 'This adds to the bet again every roll, with nothing to stop it. Add a condition, set it to fire once per point, or turn "on top" off so it just holds a level.',
        });
      }
    }
  }

  return out;
}

/** Used by the workshop's import box to check a pasted strategy is one. */
export function isStrategy(value: unknown): value is Strategy {
  if (typeof value !== 'object' || value === null) return false;
  const s = value as Partial<Strategy>;
  return (
    typeof s.id === 'string' &&
    typeof s.name === 'string' &&
    typeof s.unit === 'number' &&
    Array.isArray(s.rules) &&
    s.rules.every(
      (r) => typeof r?.id === 'string' && Array.isArray(r?.all) && Array.isArray(r?.then),
    )
  );
}

/** Every rule as a sentence, for the tooltip on a library card. */
export function strategyLines(strategy: Strategy): string[] {
  return strategy.rules.filter((r) => r.enabled).map((r) => describeRule(r, strategy.unit));
}
