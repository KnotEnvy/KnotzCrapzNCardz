import { describe, expect, it } from 'vitest';
import { allStrategies } from '@/lib/store/useGame';
import { applyRoll } from '@/lib/engine/resolve';
import { createRng, rollDice } from '@/lib/engine/rng';
import { atRisk, createTable, placeBet, setBetAmount, takeDown } from '@/lib/engine/table';
import type { DieFace, Roll, SeatId, TableState } from '@/lib/engine/types';
import { describeRule, ruleTitle } from './describe';
import {
  HOUSE_BY_ID,
  HOUSE_STRATEGIES,
  duplicateStrategy,
  emptyStrategy,
  isStrategy,
  strategyWarnings,
} from './library';
import { runStrategy } from './run';
import {
  LOG_LIMIT,
  emptyMemory,
  units,
  type Strategy,
  type StrategyMemory,
  type StrategyRule,
} from './types';

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function roll(d1: DieFace, d2: DieFace): Roll {
  return { d1, d2, total: d1 + d2 };
}

/** A pair of dice summing to `total`, the easy way where there is one. */
function soft(total: number): Roll {
  const pairs: Record<number, [DieFace, DieFace]> = {
    2: [1, 1],
    3: [1, 2],
    4: [1, 3],
    5: [1, 4],
    6: [2, 4],
    7: [3, 4],
    8: [2, 6],
    9: [3, 6],
    10: [4, 6],
    11: [5, 6],
    12: [6, 6],
  };
  const [a, b] = pairs[total];
  return roll(a, b);
}

function table(overrides = {}): TableState {
  return createTable({ buyIn: 10_000, rules: { minBet: 5, ...overrides } });
}

function house(id: string): Strategy {
  const s = HOUSE_BY_ID.get(id);
  if (!s) throw new Error(`No house strategy "${id}"`);
  return s;
}

/** Chips in the rack plus chips on the felt. */
function equity(state: TableState, seat: SeatId = 'A'): number {
  return state.seats[seat].bankroll + atRisk(state, seat);
}

/** Every place/buy bet a seat holds, as number to amount. */
function numbers(state: TableState, seat: SeatId = 'A'): Record<number, number> {
  const out: Record<number, number> = {};
  for (const bet of state.bets) {
    if (bet.seat !== seat) continue;
    if (bet.kind !== 'PLACE' && bet.kind !== 'BUY') continue;
    out[bet.number as number] = bet.amount;
  }
  return out;
}

interface Session {
  table: TableState;
  memory: StrategyMemory;
}

/** One decision point: run the strategy against a table nothing has rolled on. */
function open(strategy: Strategy, start = table(), seat: SeatId = 'A'): Session {
  const res = runStrategy({
    table: start,
    seat,
    strategy,
    memory: emptyMemory(strategy.id, equity(start, seat)),
    record: null,
    force: true,
  });
  return { table: res.table, memory: res.memory };
}

/** Throw one roll, then give the strategy its turn — the live game's loop. */
function step(session: Session, strategy: Strategy, r: Roll, seat: SeatId = 'A'): Session {
  const applied = applyRoll(session.table, r);
  const res = runStrategy({
    table: applied.state,
    seat,
    strategy,
    memory: session.memory,
    record: applied.record,
    settlements: applied.settlements,
  });
  return { table: res.table, memory: res.memory };
}

function play(strategy: Strategy, totals: number[], start = table()): Session {
  let session = open(strategy, start);
  for (const t of totals) session = step(session, strategy, soft(t));
  return session;
}

/* ------------------------------------------------------------------ *
 * What a unit is worth on the felt
 * ------------------------------------------------------------------ */

describe('unit arithmetic reproduces the classic dollar names', () => {
  it('places one unit inside as $22 at a five dollar unit', () => {
    const s = play(house('inside-22'), [4]);
    expect(numbers(s.table)).toEqual({ 5: 5, 6: 6, 8: 6, 9: 5 });
    expect(atRisk(s.table, 'A')).toBe(22);
  });

  it('places two units inside as $44', () => {
    const s = play(house('regression-44'), [4]);
    expect(numbers(s.table)).toEqual({ 5: 10, 6: 12, 8: 12, 9: 10 });
    expect(atRisk(s.table, 'A')).toBe(44);
  });

  it('places one unit across as $32', () => {
    const s = play(house('across'), [4]);
    expect(numbers(s.table)).toEqual({ 4: 5, 5: 5, 6: 6, 8: 6, 9: 5, 10: 5 });
    expect(atRisk(s.table, 'A')).toBe(32);
  });

  it('scales with the strategy unit rather than the chip rack', () => {
    const doubled: Strategy = { ...house('inside-22'), unit: 10 };
    const s = play(doubled, [4]);
    expect(atRisk(s.table, 'A')).toBe(44);
  });
});

/* ------------------------------------------------------------------ *
 * A bet names a level, not a helping
 * ------------------------------------------------------------------ */

describe('betting a spot that already has money on it', () => {
  it('leaves $22 inside at $22 through a second point in the same hand', () => {
    // Point four, four made, point six. The place bets survive a point being
    // made, so calling for them again must re-state the level, not double it.
    const s = play(house('inside-22'), [4, 4, 6]);
    expect(numbers(s.table)).toEqual({ 5: 5, 6: 6, 8: 6, 9: 5 });
    expect(atRisk(s.table, 'A')).toBe(22);
  });

  it('tops a regressed level back up to full for the next point', () => {
    // $44 inside, regressed to $22 on the first hit, then the point is made:
    // the next point should start from $44 again, not $66.
    const s = play(house('regression-44'), [4, 9, 4, 6]);
    expect(numbers(s.table)).toEqual({ 5: 10, 6: 12, 8: 12, 9: 10 });
  });

  it('gets its bets down when it is switched on mid-hand', () => {
    // A point is already established before the system arrives. Keying the
    // opening bets off "a point is on" rather than "a point was just set" is
    // what stops a seat sitting the whole hand out doing nothing.
    const strategy = house('inside-22');
    let start = table();
    start = applyRoll(start, soft(4)).state;
    expect(start.point).toBe(4);

    const res = runStrategy({
      table: start,
      seat: 'A',
      strategy,
      memory: emptyMemory(strategy.id, equity(start)),
      record: null,
      force: true,
    });
    expect(numbers(res.table)).toEqual({ 5: 5, 6: 6, 8: 6, 9: 5 });
  });

  it('does not stack the line bet over repeated come-outs', () => {
    const s = play(house('iron-cross'), [7, 7, 7]);
    expect(s.table.bets.filter((b) => b.kind === 'PASS')).toHaveLength(1);
    expect(s.table.bets.find((b) => b.kind === 'PASS')!.amount).toBe(5);
  });

  it('adds on top when the rule explicitly asks it to', () => {
    const stacking: Strategy = {
      ...emptyStrategy('stack', 'Stacker'),
      unit: 5,
      rules: [
        {
          id: 'stack#0',
          enabled: true,
          when: 'EVERY_ROLL',
          once: 'ALWAYS',
          all: [],
          then: [
            { t: 'BET', target: { kind: 'PLACE', number: 6 }, amount: units(1), topUp: true },
          ],
        },
      ],
    };
    const s = play(stacking, [4, 9]);
    // Three decision points — the opening one and one after each roll.
    expect(numbers(s.table)[6]).toBe(18);
  });
});

/* ------------------------------------------------------------------ *
 * The line and its odds
 * ------------------------------------------------------------------ */

describe('pass line and full odds', () => {
  it('puts one flat bet up on the come-out, then backs it with full odds', () => {
    // The come-out: one $10 unit on the line and nothing else on the felt.
    const opened = open(house('pass-odds'));
    expect(opened.table.bets.map((b) => [b.kind, b.amount, b.odds])).toEqual([['PASS', 10, 0]]);

    // Point four: the same bet travels and takes the full 3x behind it. Still
    // one bet — the odds ride on the line bet rather than becoming another.
    const s = play(house('pass-odds'), [4]);
    expect(s.table.bets.map((b) => [b.kind, b.number, b.amount, b.odds])).toEqual([
      ['PASS', 4, 10, 30],
    ]);
  });

  it('lays the full odds on the dark side', () => {
    const s = play(house('dont-pass-odds'), [10]);
    const dp = s.table.bets.find((b) => b.kind === 'DONT_PASS')!;
    expect(dp.number).toBe(10);
    // The don't side is capped by what it can win, not by what it puts up. The
    // right side could win $60 behind a $10 flat on the ten, and a lay pays
    // 1:2, so winning that same $60 means laying $120.
    expect(dp.odds).toBe(120);
  });
});

describe('three point molly', () => {
  it('works up to a line bet and two come bets, each backed with full odds', () => {
    // Point five, come points six and eight, then two more numbers that must
    // not buy a third come bet. The flat bets are one $10 unit each and the
    // odds are the full 3-4-5x behind every travelled number: $40 on the five,
    // $50 each on the six and eight.
    const s = play(house('three-point-molly'), [5, 6, 8, 9, 10]);
    expect(s.table.bets.map((b) => [b.kind, b.number, b.amount, b.odds])).toEqual([
      ['PASS', 5, 10, 40],
      ['COME', 6, 10, 50],
      ['COME', 8, 10, 50],
    ]);
  });
});

/* ------------------------------------------------------------------ *
 * Pressing
 * ------------------------------------------------------------------ */

describe('pressing is scoped to the number that hit', () => {
  it('presses only the number the dice landed on', () => {
    let s = play(house('place-and-press'), [4]); // point is four, six and eight go up
    expect(numbers(s.table)).toEqual({ 6: 6, 8: 6 });

    s = step(s, house('place-and-press'), soft(6));
    expect(numbers(s.table)).toEqual({ 6: 12, 8: 6 });

    s = step(s, house('place-and-press'), soft(8));
    expect(numbers(s.table)).toEqual({ 6: 12, 8: 12 });
  });

  it('stops pressing once the bet reaches its ceiling', () => {
    let s = play(house('place-and-press'), [4]);
    for (let i = 0; i < 20; i++) s = step(s, house('place-and-press'), soft(6));
    // The rule presses while the bet is under $60, so it settles at $60 exactly.
    expect(numbers(s.table)[6]).toBe(60);
  });

  it('does not press a number the seat has nothing on', () => {
    const strategy = house('place-and-press');
    let s = play(strategy, [4]);
    const before = numbers(s.table);
    s = step(s, strategy, soft(9)); // nine hits, nothing is on it
    expect(numbers(s.table)).toEqual(before);
  });
});

/* ------------------------------------------------------------------ *
 * Regression
 * ------------------------------------------------------------------ */

describe('the $44 inside regression', () => {
  it('keeps its once-per-point budget unspent on the roll that set the point', () => {
    // The regression rule sits *above* the rule that creates the bets, so on
    // the point-set roll it finds nothing to regress. `once` counts successes,
    // not attempts, so it must not be stamped as fired — otherwise the real
    // hit arrives with the budget already spent and the system stays flat.
    const s = play(house('regression-44'), [4]);
    expect(atRisk(s.table, 'A')).toBe(44);
    expect(s.memory.fired['regression-44#0']).toBeUndefined();
    expect(s.memory.fired['regression-44#1']).toBe('p1');

    // And on the hit it does fire, in the same point cycle it saved.
    const hit = step(s, house('regression-44'), soft(9));
    expect(hit.memory.fired['regression-44#0']).toBe('p1');
  });

  it('comes down to $22 on the first hit', () => {
    const s = play(house('regression-44'), [4, 9]);
    expect(numbers(s.table)).toEqual({ 5: 5, 6: 6, 8: 6, 9: 5 });
  });

  it('regresses once per point, not once per hit', () => {
    const s = play(house('regression-44'), [4, 9, 5]);
    // The five hitting after the regression must not knock it down again.
    expect(numbers(s.table)[5]).toBe(5);
    expect(numbers(s.table)[9]).toBe(5);
  });

  it('presses a number that hits a second time', () => {
    const s = play(house('regression-44'), [4, 9, 9]);
    expect(numbers(s.table)[9]).toBe(10);
  });

  it('returns the regressed chips to the rack', () => {
    const before = play(house('regression-44'), [4]);
    const after = step(before, house('regression-44'), soft(9));
    // The nine paid $14 and $22 came off the felt, so the rack is up both.
    expect(after.table.seats.A.bankroll).toBe(before.table.seats.A.bankroll + 14 + 22);
  });
});

/* ------------------------------------------------------------------ *
 * Coming down
 * ------------------------------------------------------------------ */

describe('two hits and down', () => {
  it('takes a number off after its second hit and leaves the rest', () => {
    const s = play(house('two-hits-down'), [4, 9, 9]);
    const held = numbers(s.table);
    expect(held[9]).toBeUndefined();
    expect(held[5]).toBe(5);
    expect(held[6]).toBe(6);
    expect(held[8]).toBe(6);
  });

  it('leaves a number alone after only one hit', () => {
    const s = play(house('two-hits-down'), [4, 9]);
    expect(numbers(s.table)[9]).toBe(5);
  });
});

/* ------------------------------------------------------------------ *
 * Hedges, side bets and the rest of the library
 * ------------------------------------------------------------------ */

describe('the iron cross', () => {
  it('covers five, six, eight and the field once the point is on', () => {
    const s = play(house('iron-cross'), [4]);
    expect(numbers(s.table)).toEqual({ 5: 5, 6: 6, 8: 6 });
    expect(s.table.bets.some((b) => b.kind === 'FIELD')).toBe(true);
    // $5 + $6 + $6 + $5 field, plus the $5 line bet riding on the four.
    expect(atRisk(s.table, 'A')).toBe(27);
  });

  it('puts the field back up after it loses', () => {
    const s = play(house('iron-cross'), [4, 5]); // the five pays the place, kills the field
    expect(s.table.bets.some((b) => b.kind === 'FIELD')).toBe(true);
  });
});

describe("the hedged don't", () => {
  it('hedges the come-out with any craps and drops it once a point is set', () => {
    // The hedge only earns its keep on the come-out, where a 2, 3 or 12 is the
    // one thing that beats the don't. Once a point is on it is dead money.
    const opened = open(house('hedged-dont'));
    expect(opened.table.bets.some((b) => b.kind === 'PROP' && b.prop === 'ANY_CRAPS')).toBe(true);
    expect(opened.table.bets.some((b) => b.kind === 'DONT_PASS')).toBe(true);

    const s = play(house('hedged-dont'), [6]);
    expect(s.table.bets.some((b) => b.kind === 'PROP')).toBe(false);
    expect(s.table.bets.find((b) => b.kind === 'DONT_PASS')!.number).toBe(6);
  });
});

describe('the fire bet chaser', () => {
  it('gets the Fire Bet and All down before the shooter comes out', () => {
    const s = open(house('fire-chaser'));
    expect(s.table.bets.some((b) => b.kind === 'FIRE')).toBe(true);
    expect(s.table.bets.some((b) => b.kind === 'ATS' && b.ats === 'ALL')).toBe(true);
  });

  it('does not try to buy a second Fire Bet mid-hand', () => {
    const s = play(house('fire-chaser'), [4, 9, 9]);
    expect(s.table.bets.filter((b) => b.kind === 'FIRE')).toHaveLength(1);
  });
});

describe('the 5-count', () => {
  it('sits out the opening rolls of a hand', () => {
    const s = play(house('five-count'), [4, 9, 9]);
    expect(s.table.bets).toHaveLength(0);
  });

  it('starts betting on the fifth roll and not before', () => {
    const rolls = [4, 9, 9, 5, 5, 9];
    expect(play(house('five-count'), rolls.slice(0, 4)).table.bets).toHaveLength(0);

    // Fifth roll: the line is closed (point four is on), so it qualifies with
    // a come bet instead, and backs it with full odds once it travels.
    const fifth = play(house('five-count'), rolls.slice(0, 5));
    expect(fifth.table.bets.map((b) => [b.kind, b.number])).toEqual([['COME', undefined]]);

    const sixth = play(house('five-count'), rolls);
    expect(sixth.table.bets.map((b) => [b.kind, b.number, b.odds])).toEqual([
      ['COME', 9, 40],
      ['COME', undefined, 0],
    ]);
  });

  it('restarts the count for the next shooter', () => {
    const s = play(house('five-count'), [4, 9, 9, 5, 5, 7]);
    // The seven-out cleared the felt and handed the dice on; the new shooter
    // has to earn the count again from zero.
    expect(s.table.shooterRollCount).toBe(0);
    expect(s.table.bets).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ *
 * Triggers and once-scopes
 * ------------------------------------------------------------------ */

describe('triggers', () => {
  const pressOnHit: Strategy = {
    ...emptyStrategy('t-press', 'Press on hit'),
    unit: 5,
    rules: [
      {
        id: 't-press#0',
        enabled: true,
        when: 'NUMBER_HIT',
        once: 'ALWAYS',
        all: [],
        then: [{ t: 'PRESS', number: 'HIT', amount: units(1) }],
      },
    ],
  };

  it('does not re-fire an event trigger when the strategy is run again by hand', () => {
    const start = (
      placeBet(table(), 'A', { kind: 'PLACE', number: 6 }, 6) as { state: TableState }
    ).state;

    const applied = applyRoll(start, soft(6));
    const first = runStrategy({
      table: applied.state,
      seat: 'A',
      strategy: pressOnHit,
      memory: emptyMemory(pressOnHit.id, equity(start)),
      record: applied.record,
      settlements: applied.settlements,
    });
    expect(numbers(first.table)[6]).toBe(12);

    // Same table, asked again — the six has already been pressed for this roll.
    const second = runStrategy({
      table: first.table,
      seat: 'A',
      strategy: pressOnHit,
      memory: first.memory,
      record: applied.record,
      settlements: applied.settlements,
      force: true,
    });
    expect(numbers(second.table)[6]).toBe(12);
  });

  it('lets a state trigger run again on an unchanged table', () => {
    const strategy = house('pass-odds');
    const first = open(strategy);
    expect(first.table.bets).toHaveLength(1);

    // Take the line bet down and ask again: the rule notices and re-bets.
    const stripped = takeDown(first.table, first.table.bets[0].id);
    expect(stripped.ok).toBe(true);
    const again = runStrategy({
      table: (stripped as { state: TableState }).state,
      seat: 'A',
      strategy,
      memory: first.memory,
      record: null,
      force: true,
    });
    expect(again.table.bets.some((b) => b.kind === 'PASS')).toBe(true);
  });

  it('fires a once-per-hand rule again for the next shooter', () => {
    const strategy = house('fire-chaser');
    // Seven out hands the dice on, which starts a new hand and a new Fire Bet.
    const s = play(strategy, [4, 7]);
    expect(s.table.bets.filter((b) => b.kind === 'FIRE')).toHaveLength(1);
    expect(s.memory.handIndex).toBe(1);
  });
});

/* ------------------------------------------------------------------ *
 * Walking away
 * ------------------------------------------------------------------ */

describe('win goals and loss limits', () => {
  const goal: Strategy = { ...house('pass-odds'), id: 'goal-test', winGoal: 1 };
  const limit: Strategy = { ...house('field-grinder'), id: 'limit-test', lossLimit: 20 };

  it('stops betting once the session clears the win goal, and says why', () => {
    // Buy in small so a single winning line bet clears a one dollar goal.
    const start = createTable({ buyIn: 200, rules: { minBet: 5 } });
    let session = open(goal, start);
    session = step(session, goal, soft(7)); // pass line pays, session is up
    expect(session.memory.stopped).toBe(true);
    expect(session.memory.stopReason).toContain('win goal');
    expect(session.memory.log.some((e) => e.rule === 'Win goal')).toBe(true);

    // And it stays stopped: not a chip more leaves the rack on the next roll.
    const before = { bets: session.table.bets.length, rack: session.table.seats.A.bankroll };
    session = step(session, goal, soft(7));
    expect(session.table.bets).toHaveLength(before.bets);
    expect(session.table.seats.A.bankroll).toBe(before.rack);
  });

  it('stops betting once the session hits the loss limit', () => {
    let session = open(limit, createTable({ buyIn: 200, rules: { minBet: 5 } }));
    for (let i = 0; i < 12 && !session.memory.stopped; i++) {
      session = step(session, limit, soft(7)); // seven loses the field every time
    }
    expect(session.memory.stopped).toBe(true);
    expect(session.memory.stopReason).toContain('loss limit');
  });

});

/* ------------------------------------------------------------------ *
 * The engine call the strategies lean on
 * ------------------------------------------------------------------ */

describe('setBetAmount', () => {
  // Both directions from one entry point, and the equity invariant on every
  // row: whatever leaves the felt has to arrive in the rack, to the dollar.
  it.each([
    ['brings a bet down and returns the difference', 30, 12, 12],
    ['rounds a regression up to something the dealer can pay', 30, 10, 12],
    ['goes up as a press when the target is larger', 12, 24, 24],
    ['takes the bet down entirely at zero', 12, 0, null],
  ] as const)('%s', (_name, from, target, expected) => {
    const start = (
      placeBet(table(), 'A', { kind: 'PLACE', number: 6 }, from) as { state: TableState }
    ).state;
    const res = setBetAmount(start, start.bets[0].id, target);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    if (expected === null) {
      expect(res.state.bets).toHaveLength(0);
    } else {
      expect(res.state.bets[0].amount).toBe(expected);
    }
    // The rack absorbs exactly the difference, in either direction.
    expect(res.state.seats.A.bankroll).toBe(start.seats.A.bankroll + from - (expected ?? 0));
    expect(equity(res.state)).toBe(equity(start));
  });

  it('refuses to reduce a contract bet', () => {
    let start = (placeBet(table(), 'A', { kind: 'PASS' }, 50) as { state: TableState }).state;
    start = applyRoll(start, soft(6)).state; // the pass line now has a point
    const res = setBetAmount(start, start.bets[0].id, 10);
    expect(res.ok).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * The amount modes no house system happens to use
 * ------------------------------------------------------------------ */

describe('sizing a bet', () => {
  /** A throwaway strategy of one or two rules, for probing one amount mode. */
  function sizing(rules: Array<Partial<StrategyRule>>): Strategy {
    return {
      ...emptyStrategy('sizing', 'Sizing'),
      unit: 5,
      rules: rules.map((rule, i) => ({
        id: `sizing#${i}`,
        enabled: true,
        when: 'EVERY_ROLL',
        once: 'ALWAYS',
        all: [],
        then: [],
        ...rule,
      })) as StrategyRule[],
    };
  }

  const inside = {
    when: 'POINT_ON',
    once: 'POINT',
    then: [{ t: 'BET', target: { kind: 'PLACE', number: 'INSIDE' }, amount: units(1) }],
  } as const satisfies Partial<StrategyRule>;

  /*
   * Every house system happens to size its bets with UNITS, FIXED or MAX odds,
   * so these four modes ship in the workshop without a single system exercising
   * them. A player building their own rule reaches them from the first dropdown.
   */

  it('TABLE_MIN and PCT_BANKROLL size off the table, not off the unit', () => {
    const min = sizing([
      { when: 'COME_OUT', then: [{ t: 'BET', target: { kind: 'PASS' }, amount: { mode: 'TABLE_MIN', value: 0 } }] },
    ]);
    expect(open(min).table.bets.map((b) => b.amount)).toEqual([5]);
    expect(open(min, createTable({ buyIn: 10_000, rules: { minBet: 25 } })).table.bets[0].amount).toBe(
      25,
    );

    const pct = sizing([
      { when: 'COME_OUT', then: [{ t: 'BET', target: { kind: 'PASS' }, amount: { mode: 'PCT_BANKROLL', value: 1 } }] },
    ]);
    expect(open(pct).table.bets[0].amount).toBe(100); // 1% of a $10,000 rack
  });

  it('TO names the level the spot should reach', () => {
    const s = sizing([
      { ...inside, then: [{ t: 'BET', target: { kind: 'PLACE', number: 6 }, amount: { mode: 'TO', value: 30 } }] },
    ]);
    // And it is a level, not a helping: two point cycles leave it at thirty.
    expect(numbers(play(s, [4]).table)).toEqual({ 6: 30 });
    expect(numbers(play(s, [4, 4, 6]).table)).toEqual({ 6: 30 });
  });

  it('DOUBLE, WIN and HALF_WIN press against what the number did', () => {
    const press = (amount: { mode: 'DOUBLE' | 'WIN' | 'HALF_WIN'; value: number }) =>
      sizing([inside, { when: 'NUMBER_HIT', then: [{ t: 'PRESS', number: 'HIT', amount }] }]);

    // $22 inside, so the nine holds $5 and pays $7 when it lands.
    const doubled = step(play(press({ mode: 'DOUBLE', value: 0 }), [4]), press({ mode: 'DOUBLE', value: 0 }), soft(9));
    expect(numbers(doubled.table)[9]).toBe(10);

    // The whole win goes back up: $5 + $7 is $12, snapped up to a payable $15.
    const won = step(play(press({ mode: 'WIN', value: 0 }), [4]), press({ mode: 'WIN', value: 0 }), soft(9));
    expect(numbers(won.table)[9]).toBe(15);

    // Half of it: $5 + $4 is $9, snapped up to $10.
    const half = step(play(press({ mode: 'HALF_WIN', value: 0 }), [4]), press({ mode: 'HALF_WIN', value: 0 }), soft(9));
    expect(numbers(half.table)[9]).toBe(10);
  });

  it('MULTIPLE lays odds as a multiple of the flat bet', () => {
    const s = sizing([
      { when: 'COME_OUT', then: [{ t: 'BET', target: { kind: 'PASS' }, amount: units(2) }] },
      { when: 'POINT_ON', once: 'POINT', then: [{ t: 'ODDS', on: 'PASS', amount: { mode: 'MULTIPLE', value: 2 } }] },
    ]);
    // $10 flat on the four: 2x is $20, and the 3-4-5x cap of $30 is not reached.
    const pass = play(s, [4]).table.bets.find((b) => b.kind === 'PASS')!;
    expect([pass.amount, pass.odds]).toEqual([10, 20]);
  });
});

/* ------------------------------------------------------------------ *
 * Invariants across the whole library
 * ------------------------------------------------------------------ */

describe('every house strategy, over a seeded session', () => {
  const ROLLS = 400;

  it.each(HOUSE_STRATEGIES.map((s) => [s.name, s] as const))(
    '%s never overdraws the rack and never invents money',
    (_name, strategy) => {
      const rng = createRng(`strategy-${strategy.id}`);
      let session = open(strategy, createTable({ buyIn: 5_000, rules: { minBet: 5 } }));

      for (let i = 0; i < ROLLS; i++) {
        const r = rollDice(rng);
        const applied = applyRoll(session.table, r);

        // Between the roll settling and the strategy acting, the only thing
        // that may change a seat's worth is the settlements the engine
        // reported. Everything the strategy does moves chips between the rack
        // and the felt, so it has to leave the total exactly where it found it.
        const settled = applied.state;
        const before = equity(settled);
        const res = runStrategy({
          table: settled,
          seat: 'A',
          strategy,
          memory: session.memory,
          record: applied.record,
          settlements: applied.settlements,
        });

        expect(equity(res.table)).toBe(before);
        expect(res.table.seats.A.bankroll).toBeGreaterThanOrEqual(0);
        for (const bet of res.table.bets) expect(bet.amount).toBeGreaterThan(0);

        session = { table: res.table, memory: res.memory };
      }
    },
  );

  it('plays two different systems against each other without either cheating', () => {
    const rng = createRng('head-to-head');
    const a = house('three-point-molly');
    const b = house('dont-two-dc');
    let state = createTable({ buyIn: 5_000, rules: { minBet: 5 } });
    let memA = emptyMemory(a.id, equity(state, 'A'));
    let memB = emptyMemory(b.id, equity(state, 'B'));

    for (let i = 0; i < 300; i++) {
      const applied = applyRoll(state, rollDice(rng));
      state = applied.state;

      for (const [seat, strategy, memory] of [
        ['A', a, memA],
        ['B', b, memB],
      ] as const) {
        const before = equity(state, seat);
        const res = runStrategy({
          table: state,
          seat,
          strategy,
          memory,
          record: applied.record,
          settlements: applied.settlements,
        });
        expect(equity(res.table, seat)).toBe(before);
        state = res.table;
        if (seat === 'A') memA = res.memory;
        else memB = res.memory;
      }

      // Neither bot may touch the other's money.
      for (const bet of state.bets) expect(['A', 'B']).toContain(bet.seat);
    }

    expect(state.stats.rolls).toBe(300);
  });
});

/* ------------------------------------------------------------------ *
 * Memory
 * ------------------------------------------------------------------ */

describe('strategy memory', () => {
  it('starts over when the seat is given a different system', () => {
    const first = play(house('inside-22'), [4, 9]);
    expect(first.memory.hits[9]).toBe(1);

    const swapped = runStrategy({
      table: first.table,
      seat: 'A',
      strategy: house('across'),
      memory: first.memory,
      record: null,
      force: true,
    });
    expect(swapped.memory.strategyId).toBe('across');
    expect(swapped.memory.hits).toEqual({});
  });

  it('clears the hit counts on a seven out', () => {
    const s = play(house('inside-22'), [4, 9, 9, 7]);
    expect(s.memory.hits).toEqual({});
    expect(s.memory.handIndex).toBe(1);
  });

  it('keeps the log inside its window, dropping the oldest entries', () => {
    // The Field Grinder ships with a loss limit that would stop it after thirty
    // losses — well short of the window — so this drops the limit to actually
    // fill the log. 121 decision points, one entry each, capped at sixty.
    const forever: Strategy = { ...house('field-grinder'), id: 'forever', lossLimit: 0 };
    const s = play(forever, new Array(120).fill(5), createTable({ buyIn: 10_000, rules: { minBet: 5 } }));
    expect(s.memory.log).toHaveLength(LOG_LIMIT);
    expect(LOG_LIMIT).toBe(60);
    // It is the newest sixty that survive, not the first sixty.
    expect(s.memory.log[s.memory.log.length - 1].roll).toBe(120);
  });

  it('does not repeat the same refusal on every roll', () => {
    // A rack too small for the bet, reached for on every one of thirteen
    // decision points. Without the dedupe the log would carry thirteen copies
    // of the same line and scroll every real entry away.
    const greedy: Strategy = {
      ...emptyStrategy('broke', 'Broke'),
      unit: 5,
      rules: [
        {
          id: 'broke#0',
          enabled: true,
          when: 'EVERY_ROLL',
          once: 'ALWAYS',
          all: [],
          then: [{ t: 'BET', target: { kind: 'PLACE', number: 6 }, amount: units(20) }],
        },
      ],
    };
    const broke = createTable({ buyIn: 4, rules: { minBet: 5 } });
    const s = play(greedy, [4, 9, 9, 5, 5, 6, 6, 4, 9, 10, 11, 3], broke);

    const refusals = s.memory.log.filter((e) => !e.ok);
    expect(refusals).toHaveLength(1);
    expect(refusals[0].text).toBe('Not enough in the rack');
    expect(s.memory.log).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ *
 * The workshop's own helpers
 * ------------------------------------------------------------------ */

describe('describing a rule', () => {
  it('reads as a sentence', () => {
    const rule = house('place-and-press').rules[3];
    expect(describeRule(rule, 5)).toBe(
      'When a box number hits, if the number that hit is 6 or 8 and my place on the number that hit is under $60: press the number that hit by 1 unit ($5).',
    );
  });

  it('prefers the player\'s own note when there is one', () => {
    expect(ruleTitle(house('pass-odds').rules[0], 10)).toBe('Line bet every come-out');
  });

  it('falls back to the sentence when there is not', () => {
    const rule: StrategyRule = {
      ...house('pass-odds').rules[0],
      note: undefined,
    };
    expect(ruleTitle(rule, 10)).toContain('On the come-out');
  });
});

describe('warnings', () => {
  it('catches a line bet that can never be made', () => {
    const bad: Strategy = {
      ...emptyStrategy('bad', 'Bad'),
      rules: [
        {
          id: 'bad#0',
          enabled: true,
          when: 'POINT_ON',
          once: 'ALWAYS',
          all: [],
          then: [{ t: 'BET', target: { kind: 'PASS' }, amount: units(1) }],
        },
      ],
    };
    expect(strategyWarnings(bad).some((w) => w.text.includes('line is closed'))).toBe(true);
  });

  it('catches a bet that will grow itself every roll', () => {
    const greedy: Strategy = {
      ...emptyStrategy('greedy', 'Greedy'),
      rules: [
        {
          id: 'greedy#0',
          enabled: true,
          when: 'EVERY_ROLL',
          once: 'ALWAYS',
          all: [],
          then: [
            { t: 'BET', target: { kind: 'PLACE', number: 6 }, amount: units(1), topUp: true },
          ],
        },
      ],
    };
    expect(strategyWarnings(greedy).some((w) => w.text.includes('every roll'))).toBe(true);
  });

  it('says nothing about an unguarded bet that only holds a level', () => {
    const steady: Strategy = {
      ...emptyStrategy('steady', 'Steady'),
      rules: [
        {
          id: 'steady#0',
          enabled: true,
          when: 'EVERY_ROLL',
          once: 'ALWAYS',
          all: [],
          then: [{ t: 'BET', target: { kind: 'PLACE', number: 6 }, amount: units(1) }],
        },
      ],
    };
    expect(strategyWarnings(steady)).toEqual([]);
  });

  it('is quiet about the strategies that ship with the game', () => {
    for (const strategy of HOUSE_STRATEGIES) {
      expect({ name: strategy.name, warnings: strategyWarnings(strategy) }).toEqual({
        name: strategy.name,
        warnings: [],
      });
    }
  });
});

describe('duplicating and importing', () => {
  it('makes an editable copy that shares nothing with the original', () => {
    const copy = duplicateStrategy(house('iron-cross'), 'mine-1');
    expect(copy.origin).toBe('CUSTOM');
    expect(copy.id).toBe('mine-1');
    expect(copy.rules).toHaveLength(house('iron-cross').rules.length);
    // Rule ids are derived from the strategy id and the position, so they are
    // stable across reloads and cannot collide with the original's.
    expect(copy.rules.every((r) => r.id.startsWith('mine-1#'))).toBe(true);

    // Editing the copy must not reach back into the house system it came from.
    copy.rules[0].enabled = false;
    expect(house('iron-cross').rules[0].enabled).toBe(true);
  });

  it('a duplicate plays exactly like the original', () => {
    const copy = duplicateStrategy(house('inside-22'), 'mine-3');
    expect(numbers(play(copy, [4]).table)).toEqual(numbers(play(house('inside-22'), [4]).table));
  });

  it('recognises a strategy and rejects anything else', () => {
    expect(isStrategy(house('across'))).toBe(true);
    expect(isStrategy({ name: 'nope' })).toBe(false);
    expect(isStrategy(null)).toBe(false);
    expect(isStrategy('{}')).toBe(false);
  });
});

describe('the library a player actually sees', () => {
  /*
   * Saving an edit straight onto a house system used to persist a custom
   * carrying the house id. The library concatenates house first, so `find`
   * returned the house version and the player's edits silently never ran —
   * and every list rendering the library got duplicate React keys for free.
   */
  it('never lets a custom strategy shadow a house one', () => {
    const house = HOUSE_STRATEGIES.find((s) => s.id === 'inside-22')!;
    const impostor: Strategy = { ...house, name: 'Mine, secretly', origin: 'CUSTOM' };

    const list = allStrategies([impostor]);

    expect(list.filter((s) => s.id === 'inside-22')).toHaveLength(1);
    expect(list.find((s) => s.id === 'inside-22')!.name).toBe(house.name);
  });

  it('issues every strategy in the library a unique id', () => {
    const mine = duplicateStrategy(HOUSE_STRATEGIES[0], 'mine-1');
    const ids = allStrategies([mine, mine]).map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps the custom strategies that do not collide', () => {
    const mine = duplicateStrategy(HOUSE_STRATEGIES[0], 'mine-7', 'Something of my own');
    expect(allStrategies([mine]).some((s) => s.id === 'mine-7')).toBe(true);
  });
});




