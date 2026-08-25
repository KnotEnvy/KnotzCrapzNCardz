import { describe, expect, it } from 'vitest';
import { applyRoll } from './resolve';
import {
  atRisk,
  createTable,
  maxOddsFor,
  placeBet,
  setOdds,
  setWorking,
  takeDown,
  takeDownAll,
  pressNumber,
  powerPressNumber,
  placeGroup,
  maxOddsAll,
  setAllWorking,
  INSIDE_NUMBERS,
  OUTSIDE_NUMBERS,
  ACROSS_NUMBERS,
  type BetSpec,
} from './table';
import { createRng, rollDice } from './rng';
import { maxLayOdds, maxPassOdds } from './odds';
import type { DieFace, Roll, SeatId, TableState } from './types';

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function roll(d1: DieFace, d2: DieFace): Roll {
  return { d1, d2, total: d1 + d2 };
}

/** A pair of dice that sums to `total`, easy way where possible. */
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

function hardRoll(total: 4 | 6 | 8 | 10): Roll {
  const f = (total / 2) as DieFace;
  return roll(f, f);
}

function table(overrides = {}): TableState {
  return createTable({ buyIn: 10_000, rules: { minBet: 1, ...overrides } });
}

function bet(state: TableState, spec: BetSpec, amount: number, seat: SeatId = 'A'): TableState {
  const res = placeBet(state, seat, spec, amount);
  if (!res.ok) throw new Error(`placeBet refused: ${res.reason}`);
  return res.state;
}

function bank(state: TableState, seat: SeatId = 'A'): number {
  return state.seats[seat].bankroll;
}

/* ------------------------------------------------------------------ *
 * Pass line
 * ------------------------------------------------------------------ */

describe('pass line', () => {
  it.each([7, 11])('wins even money on a come-out %i', (total) => {
    let s = bet(table(), { kind: 'PASS' }, 100);
    expect(bank(s)).toBe(9900);
    s = applyRoll(s, soft(total)).state;
    expect(bank(s)).toBe(10_100);
    expect(s.bets).toHaveLength(0);
  });

  it.each([2, 3, 12])('loses on a come-out %i', (total) => {
    let s = bet(table(), { kind: 'PASS' }, 100);
    s = applyRoll(s, soft(total)).state;
    expect(bank(s)).toBe(9900);
    expect(s.bets).toHaveLength(0);
  });

  it.each([4, 5, 6, 8, 9, 10])('travels to the point on %i', (total) => {
    let s = bet(table(), { kind: 'PASS' }, 100);
    s = applyRoll(s, soft(total)).state;
    expect(s.phase).toBe('POINT_SET');
    expect(s.point).toBe(total);
    expect(s.bets[0].number).toBe(total);
    expect(bank(s)).toBe(9900);
  });

  it('is a contract bet once the point is on', () => {
    let s = bet(table(), { kind: 'PASS' }, 100);
    s = applyRoll(s, soft(6)).state;
    const res = takeDown(s, s.bets[0].id);
    expect(res.ok).toBe(false);
  });

  // Every point in one table: the cap the scheme allows, the state-aware
  // `maxOddsFor` agreeing with the pure `maxPassOdds`, the rack after the odds
  // go up, the payout when the point repeats, and the table returning to a
  // come-out with nothing left on it.
  it.each([
    [4, 300, 600],
    [5, 400, 600],
    [6, 500, 600],
    [8, 500, 600],
    [9, 400, 600],
    [10, 300, 600],
  ])('3-4-5x on point %i allows $%i odds winning $%i', (point, maxOdds, win) => {
    expect(maxPassOdds(100, point as 4, '3-4-5')).toBe(maxOdds);
    let s = bet(table(), { kind: 'PASS' }, 100);
    s = applyRoll(s, soft(point)).state;
    expect(maxOddsFor(s, s.bets[0])).toBe(maxOdds);

    const odds = setOdds(s, s.bets[0].id, maxOdds);
    expect(odds.ok).toBe(true);
    s = (odds as { state: TableState }).state;
    expect(bank(s)).toBe(10_000 - 100 - maxOdds);

    const before = bank(s);
    s = applyRoll(s, soft(point)).state;
    expect(bank(s) - before).toBe(100 + maxOdds + 100 + win);
    expect(s.phase).toBe('COME_OUT');
    expect(s.bets).toHaveLength(0);
  });

  it('loses flat and odds on a seven out', () => {
    let s = bet(table(), { kind: 'PASS' }, 100);
    s = applyRoll(s, soft(9)).state;
    s = (setOdds(s, s.bets[0].id, 400) as { state: TableState }).state;
    s = applyRoll(s, soft(7)).state;
    expect(bank(s)).toBe(9500);
    expect(s.bets).toHaveLength(0);
    expect(s.phase).toBe('COME_OUT');
  });
});

/* ------------------------------------------------------------------ *
 * Don't pass
 * ------------------------------------------------------------------ */

describe("don't pass", () => {
  it.each([2, 3])('wins on a come-out %i', (total) => {
    let s = bet(table(), { kind: 'DONT_PASS' }, 100);
    s = applyRoll(s, soft(total)).state;
    expect(bank(s)).toBe(10_100);
  });

  it('pushes on the barred twelve', () => {
    let s = bet(table(), { kind: 'DONT_PASS' }, 100);
    s = applyRoll(s, soft(12)).state;
    expect(bank(s)).toBe(10_000);
    expect(s.bets).toHaveLength(0);
  });

  it.each([7, 11])('loses on a come-out %i', (total) => {
    let s = bet(table(), { kind: 'DONT_PASS' }, 100);
    s = applyRoll(s, soft(total)).state;
    expect(bank(s)).toBe(9900);
  });

  it('caps the lay so it wins no more than the right side could', () => {
    let s = bet(table(), { kind: 'DONT_PASS' }, 100);
    s = applyRoll(s, soft(4)).state;
    // Laying against the 4 pays 1:2, so winning $600 needs $1200 laid.
    expect(maxLayOdds(100, 4, '3-4-5')).toBe(1200);
    expect(maxOddsFor(s, s.bets[0])).toBe(1200);
    s = (setOdds(s, s.bets[0].id, 1200) as { state: TableState }).state;
    expect(bank(s)).toBe(10_000 - 100 - 1200);
    s = applyRoll(s, soft(7)).state;
    expect(bank(s)).toBe(8700 + 1300 + 100 + 600);
  });

  it('loses when the point repeats', () => {
    let s = bet(table(), { kind: 'DONT_PASS' }, 100);
    s = applyRoll(s, soft(6)).state;
    s = (setOdds(s, s.bets[0].id, 600) as { state: TableState }).state;
    s = applyRoll(s, soft(6)).state;
    expect(bank(s)).toBe(9300);
  });

  it('can be taken down after the point, unlike the pass line', () => {
    let s = bet(table(), { kind: 'DONT_PASS' }, 100);
    s = applyRoll(s, soft(8)).state;
    const res = takeDown(s, s.bets[0].id);
    expect(res.ok).toBe(true);
    expect(bank((res as { state: TableState }).state)).toBe(10_000);
  });
});

/* ------------------------------------------------------------------ *
 * Come and don't come
 * ------------------------------------------------------------------ */

describe('come bets', () => {
  it('is refused on a come-out roll', () => {
    const res = placeBet(table(), 'A', { kind: 'COME' }, 100);
    expect(res.ok).toBe(false);
  });

  it('travels from the box onto its own number and pays there', () => {
    let s = bet(table(), { kind: 'PASS' }, 100);
    s = applyRoll(s, soft(6)).state; // point 6
    s = bet(s, { kind: 'COME' }, 100);
    s = applyRoll(s, soft(9)).state; // come bet travels to 9
    expect(s.bets.find((b) => b.kind === 'COME')!.number).toBe(9);
    s = (setOdds(s, s.bets.find((b) => b.kind === 'COME')!.id, 400) as { state: TableState }).state;
    const before = bank(s);
    s = applyRoll(s, soft(9)).state; // come 9 wins: 100 flat + 400 odds at 3:2
    expect(bank(s) - before).toBe(100 + 400 + 100 + 600);
  });

  it('protects the come bet in the box on the seven that takes the line', () => {
    let s = bet(table(), { kind: 'PASS' }, 100);
    s = applyRoll(s, soft(8)).state;
    s = bet(s, { kind: 'COME' }, 100);
    const before = bank(s);
    const { state, record } = applyRoll(s, soft(7));
    expect(record.outcome).toBe('SEVEN_OUT');
    // Pass line loses its $100; the come bet in the box wins $100.
    expect(bank(state) - before).toBe(200);
    expect(state.bets).toHaveLength(0);
  });

  it('lets an established come point and a fresh come bet share a number', () => {
    let s = bet(table(), { kind: 'PASS' }, 100);
    s = applyRoll(s, soft(6)).state;
    s = bet(s, { kind: 'COME' }, 50);
    s = applyRoll(s, soft(8)).state; // come travels to 8
    s = bet(s, { kind: 'COME' }, 50); // another come bet in the box
    const before = bank(s);
    s = applyRoll(s, soft(8)).state; // come 8 pays, new come bet travels to 8
    expect(bank(s) - before).toBe(100);
    expect(s.bets.filter((b) => b.kind === 'COME' && b.number === 8)).toHaveLength(1);
  });

  it('keeps come points alive through a come-out but sleeps their odds', () => {
    let s = bet(table(), { kind: 'PASS' }, 100);
    s = applyRoll(s, soft(5)).state;
    s = bet(s, { kind: 'COME' }, 100);
    s = applyRoll(s, soft(9)).state;
    const come = s.bets.find((b) => b.kind === 'COME')!;
    s = (setOdds(s, come.id, 400) as { state: TableState }).state;

    s = applyRoll(s, soft(5)).state; // point made, back to come-out
    expect(s.phase).toBe('COME_OUT');
    const stillThere = s.bets.find((b) => b.kind === 'COME')!;
    expect(stillThere.number).toBe(9);
    expect(stillThere.oddsWorking).toBe(false);

    const before = bank(s);
    s = applyRoll(s, soft(7)).state; // come-out seven: flat come loses, odds returned
    expect(bank(s) - before).toBe(400);
  });

  it("don't come pushes the twelve and wins the seven", () => {
    let s = bet(table(), { kind: 'DONT_PASS' }, 100);
    s = applyRoll(s, soft(4)).state;
    s = bet(s, { kind: 'DONT_COME' }, 100);
    s = applyRoll(s, soft(12)).state;
    expect(s.bets.filter((b) => b.kind === 'DONT_COME')).toHaveLength(0);

    s = bet(s, { kind: 'DONT_COME' }, 100);
    s = applyRoll(s, soft(9)).state; // travels to 9
    const before = bank(s);
    s = applyRoll(s, soft(7)).state; // both don'ts win
    expect(bank(s) - before).toBe(400);
  });
});

/* ------------------------------------------------------------------ *
 * Place, buy and lay
 * ------------------------------------------------------------------ */

describe('place bets', () => {
  it.each([
    [6, 6, 7],
    [8, 6, 7],
    [5, 5, 7],
    [9, 5, 7],
    [4, 5, 9],
    [10, 5, 9],
  ])('place %i for $%i pays $%i and stays up', (n, stake, win) => {
    let s = bet(table(), { kind: 'PASS' }, 10);
    s = applyRoll(s, soft(4 === n ? 5 : 4)).state; // set some other point
    s = bet(s, { kind: 'PLACE', number: n as 6 }, stake);
    const before = bank(s);
    s = applyRoll(s, soft(n)).state;
    expect(bank(s) - before).toBe(win);
    expect(s.bets.find((b) => b.kind === 'PLACE')!.amount).toBe(stake);
  });

  it('rounds a six or eight up to a payable multiple', () => {
    let s = bet(table(), { kind: 'PASS' }, 10);
    s = applyRoll(s, soft(4)).state;
    const res = placeBet(s, 'A', { kind: 'PLACE', number: 6 }, 10);
    expect(res.ok).toBe(true);
    const st = (res as { state: TableState }).state;
    // Up, not down: a player asking for ten on the six gets twelve, the way a
    // dealer takes the extra rather than handing four back.
    expect(st.bets.find((b) => b.kind === 'PLACE')!.amount).toBe(12);
  });

  // The house default puts place bets off for a come-out, but the setup screen
  // lets a player turn that off. Both polarities go through the same
  // applyPhaseDefaults call, and only the default one used to be covered.
  it.each([
    [true, false, 1],
    [false, true, 0],
  ])(
    'placeOffOnComeOut=%s leaves the bet working=%s through a come-out seven',
    (placeOffOnComeOut, working, survivors) => {
      let s = table({ placeOffOnComeOut });
      s = bet(s, { kind: 'PASS' }, 10);
      s = applyRoll(s, soft(4)).state;
      s = bet(s, { kind: 'PLACE', number: 6 }, 60);
      s = applyRoll(s, soft(4)).state; // point made, now on come-out
      expect(s.bets.find((b) => b.kind === 'PLACE')!.working).toBe(working);

      const before = bank(s);
      s = applyRoll(s, soft(7)).state; // come-out seven
      // Either way the rack does not move: a losing stake left it when the bet
      // was placed. What changes is whether the bet is still on the felt.
      expect(bank(s) - before).toBe(0);
      expect(s.bets.filter((b) => b.kind === 'PLACE')).toHaveLength(survivors);
    },
  );

  it('can be turned on for the come-out by hand', () => {
    let s = bet(table(), { kind: 'PASS' }, 10);
    s = applyRoll(s, soft(4)).state;
    s = bet(s, { kind: 'PLACE', number: 6 }, 60);
    s = applyRoll(s, soft(4)).state;
    const id = s.bets.find((b) => b.kind === 'PLACE')!.id;
    s = (setWorking(s, id, true) as { state: TableState }).state;
    const before = bank(s);
    s = applyRoll(s, soft(6)).state;
    expect(bank(s) - before).toBe(70);
  });

  it('comes down on a seven when the point is on', () => {
    let s = bet(table(), { kind: 'PASS' }, 10);
    s = applyRoll(s, soft(4)).state;
    s = bet(s, { kind: 'PLACE', number: 6 }, 60);
    s = applyRoll(s, soft(7)).state;
    expect(s.bets).toHaveLength(0);
  });
});

describe('big 6 and 8', () => {
  // The felt draws these cells and the resolver settles them, but nothing else
  // in this file covered them: they were the one gap in the payout table.
  it.each([6, 8] as const)('pays big %i even money and leaves it up', (n) => {
    // Deliberately settled on the come-out: a place bet is off for the come-out
    // by house default, and big 6 and 8 are always live. That is both the
    // convention and most of why they are the worse bet.
    let s = bet(table(), { kind: 'BIG', number: n }, 10);
    expect(s.phase).toBe('COME_OUT');
    const before = bank(s);
    s = applyRoll(s, soft(n)).state;
    expect(bank(s) - before).toBe(10);
    expect(s.bets.find((b) => b.kind === 'BIG')!.amount).toBe(10);
  });

  it('loses to the seven', () => {
    let s = bet(table(), { kind: 'BIG', number: 6 }, 10);
    s = applyRoll(s, soft(4)).state;
    s = applyRoll(s, soft(7)).state;
    expect(bank(s)).toBe(9990);
    expect(s.bets).toHaveLength(0);
  });
});

describe('buy and lay', () => {
  it('buys the 4 at true odds less five percent', () => {
    let s = bet(table(), { kind: 'PASS' }, 10);
    s = applyRoll(s, soft(5)).state;
    s = bet(s, { kind: 'BUY', number: 4 }, 100);
    const before = bank(s);
    s = applyRoll(s, soft(4)).state;
    // 2:1 on $100 is $200, less $5 commission.
    expect(bank(s) - before).toBe(195);
  });

  it('lays against the 4 at 1:2 with vig on the win', () => {
    let s = bet(table(), { kind: 'PASS' }, 10);
    s = applyRoll(s, soft(5)).state;
    s = bet(s, { kind: 'LAY', number: 4 }, 200);
    const before = bank(s);
    s = applyRoll(s, soft(7)).state;
    // Wins $100, less $5 commission on the win.
    expect(bank(s) - before).toBe(95);
  });

  it('takes the commission up front when the table charges that way', () => {
    let s = createTable({ buyIn: 10_000, rules: { minBet: 1, vigOnWin: false } });
    s = bet(s, { kind: 'PASS' }, 10);
    s = applyRoll(s, soft(5)).state;
    s = bet(s, { kind: 'BUY', number: 10 }, 100);
    expect(bank(s)).toBe(10_000 - 10 - 100 - 5);
    const before = bank(s);
    s = applyRoll(s, soft(10)).state;
    expect(bank(s) - before).toBe(200);
  });

  it('keeps a lay working through the come-out', () => {
    // Place bets go off for a come-out; a lay does not, and the come-out seven
    // it survives to see is the roll it was bought for.
    let s = bet(table(), { kind: 'PASS' }, 10);
    s = applyRoll(s, soft(5)).state;
    s = bet(s, { kind: 'LAY', number: 10 }, 200);
    s = applyRoll(s, soft(5)).state; // point made, come-out now
    const before = bank(s);
    s = applyRoll(s, soft(7)).state;
    // $200 laid against the ten wins $100 at 1:2, less $5 commission, and the
    // lay itself stays on the felt for the next one.
    expect(bank(s) - before).toBe(95);
    expect(s.bets.find((b) => b.kind === 'LAY')!.amount).toBe(200);
  });
});

/* ------------------------------------------------------------------ *
 * Hardways, field, props, hops
 * ------------------------------------------------------------------ */

describe('hardways', () => {
  it.each([
    [4, 7],
    [10, 7],
    [6, 9],
    [8, 9],
  ])('hard %i pays %i:1', (n, ratio) => {
    let s = bet(table(), { kind: 'PASS' }, 10);
    s = applyRoll(s, soft(5)).state;
    s = bet(s, { kind: 'HARDWAY', number: n as 4 }, 10);
    const before = bank(s);
    s = applyRoll(s, hardRoll(n as 4)).state;
    expect(bank(s) - before).toBe(10 * ratio);
    expect(s.bets.find((b) => b.kind === 'HARDWAY')).toBeDefined();
  });

  it('loses when the number comes easy', () => {
    let s = bet(table(), { kind: 'PASS' }, 10);
    s = applyRoll(s, soft(5)).state;
    s = bet(s, { kind: 'HARDWAY', number: 8 }, 10);
    s = applyRoll(s, roll(2, 6)).state;
    expect(s.bets.find((b) => b.kind === 'HARDWAY')).toBeUndefined();
  });

  it('loses on any seven', () => {
    let s = bet(table(), { kind: 'PASS' }, 10);
    s = applyRoll(s, soft(5)).state;
    s = bet(s, { kind: 'HARDWAY', number: 6 }, 10);
    const before = bank(s);
    s = applyRoll(s, soft(7)).state;
    expect(s.bets.find((b) => b.kind === 'HARDWAY')).toBeUndefined();
    // The seven took the line as well, and neither stake comes back.
    expect(bank(s) - before).toBe(0);
    expect(s.bets).toHaveLength(0);
  });
});

describe('field', () => {
  it.each([
    [3, 10],
    [4, 10],
    [9, 10],
    [10, 10],
    [11, 10],
    [2, 20],
    [12, 30],
  ])('a $10 field on %i wins $%i', (total, win) => {
    let s = bet(table(), { kind: 'FIELD' }, 10);
    const before = bank(s);
    s = applyRoll(s, soft(total)).state;
    expect(bank(s) - before).toBe(win);
    // Only the winnings are paid: the house leaves the bet up, so the delta
    // above is profit and the same $10 is still sitting in the field.
    expect(s.bets.find((b) => b.kind === 'FIELD')!.amount).toBe(10);
  });

  it.each([5, 6, 7, 8])('loses on %i', (total) => {
    let s = bet(table(), { kind: 'FIELD' }, 10);
    s = applyRoll(s, soft(total)).state;
    expect(bank(s)).toBe(9990);
    expect(s.bets).toHaveLength(0);
  });
});

describe('propositions', () => {
  it('pays any seven at 4:1 and leaves the bet up', () => {
    let s = bet(table(), { kind: 'PROP', prop: 'ANY_7' }, 5);
    const before = bank(s);
    s = applyRoll(s, soft(7)).state;
    expect(bank(s) - before).toBe(20);
    expect(s.bets).toHaveLength(1);
  });

  it('pays a $4 horn on the twelve: $30 on the leg, $3 lost elsewhere', () => {
    let s = bet(table(), { kind: 'PROP', prop: 'HORN' }, 4);
    const before = bank(s);
    s = applyRoll(s, soft(12)).state;
    expect(bank(s) - before).toBe(27);
  });

  it('pays a $5 horn high yo on the eleven', () => {
    let s = bet(table(), { kind: 'PROP', prop: 'HORN_HIGH_YO' }, 5);
    const before = bank(s);
    s = applyRoll(s, soft(11)).state;
    // $2 on the yo pays $30, the other $3 is lost.
    expect(bank(s) - before).toBe(27);
  });

  it('pushes a world bet on the seven', () => {
    let s = bet(table(), { kind: 'PROP', prop: 'WORLD' }, 5);
    s = applyRoll(s, soft(7)).state;
    expect(bank(s)).toBe(10_000);
  });

  it('pays C&E correctly on both halves', () => {
    // A fresh table each way round: a winning prop rides, so re-betting the
    // same spot would top the bet up rather than replace it.
    let craps = bet(table(), { kind: 'PROP', prop: 'C_AND_E' }, 2);
    let before = bank(craps);
    craps = applyRoll(craps, soft(3)).state;
    expect(bank(craps) - before).toBe(6); // $1 craps pays 7, $1 eleven lost

    let eleven = bet(table(), { kind: 'PROP', prop: 'C_AND_E' }, 2);
    before = bank(eleven);
    eleven = applyRoll(eleven, soft(11)).state;
    expect(bank(eleven) - before).toBe(14); // $1 eleven pays 15, $1 craps lost
  });

  it('tops up a riding prop rather than replacing it', () => {
    let s = bet(table(), { kind: 'PROP', prop: 'ANY_7' }, 5);
    s = applyRoll(s, soft(7)).state; // pays 4:1 and stays up
    s = bet(s, { kind: 'PROP', prop: 'ANY_7' }, 5);
    expect(s.bets.find((b) => b.prop === 'ANY_7')!.amount).toBe(10);
  });
});

describe('hop bets', () => {
  it('pays 30:1 on a hard hop', () => {
    let s = bet(table(), { kind: 'HOP', hop: [5, 5] }, 5);
    const before = bank(s);
    s = applyRoll(s, roll(5, 5)).state;
    expect(bank(s) - before).toBe(150);
  });

  it('pays 15:1 on an easy hop either way round', () => {
    let s = bet(table(), { kind: 'HOP', hop: [2, 5] }, 5);
    const before = bank(s);
    s = applyRoll(s, roll(5, 2)).state;
    expect(bank(s) - before).toBe(75);
  });

  it('loses on anything else', () => {
    let s = bet(table(), { kind: 'HOP', hop: [2, 5] }, 5);
    s = applyRoll(s, roll(3, 4)).state;
    expect(bank(s)).toBe(9995);
  });
});

/* ------------------------------------------------------------------ *
 * Side bets
 * ------------------------------------------------------------------ */

describe('fire bet', () => {
  it('pays 249:1 for five unique points', () => {
    let s = bet(table(), { kind: 'FIRE' }, 5);
    s = bet(s, { kind: 'PASS' }, 10);
    for (const p of [4, 5, 6, 8, 9]) {
      s = applyRoll(s, soft(p)).state; // establish
      s = applyRoll(s, soft(p)).state; // make it
      s = bet(s, { kind: 'PASS' }, 10);
    }
    expect(s.firePoints).toHaveLength(5);
    const before = bank(s);
    s = applyRoll(s, soft(10)).state; // establish a sixth point
    s = applyRoll(s, soft(7)).state; // seven out
    // The losing pass line stake left the rack when it was placed, so the only
    // money moving back here is the fire bet: its own $5 plus 249 to 1.
    expect(bank(s) - before).toBe(5 + 5 * 249);
  });

  it('does not count the same point twice', () => {
    let s = bet(table(), { kind: 'FIRE' }, 5);
    s = bet(s, { kind: 'PASS' }, 10);
    for (let i = 0; i < 3; i++) {
      s = applyRoll(s, soft(6)).state;
      s = applyRoll(s, soft(6)).state;
      s = bet(s, { kind: 'PASS' }, 10);
    }
    expect(s.firePoints).toEqual([6]);
  });

  it('must be down before the shooter comes out', () => {
    let s = bet(table(), { kind: 'PASS' }, 10);
    s = applyRoll(s, soft(6)).state;
    expect(placeBet(s, 'A', { kind: 'FIRE' }, 5).ok).toBe(false);
  });
});

describe('all tall small', () => {
  it('pays the small when 2 through 6 all land before a seven', () => {
    let s = bet(table(), { kind: 'ATS', ats: 'SMALL' }, 5);
    s = bet(s, { kind: 'PASS' }, 10);
    let before = bank(s);
    for (const n of [2, 3, 4, 5]) s = applyRoll(s, soft(n)).state;
    before = bank(s);
    s = applyRoll(s, soft(6)).state;
    // The Small pays 30:1, so the $5 bet returns its stake plus $150 exactly.
    expect(bank(s) - before).toBe(5 + 150);
    expect(s.bets.find((b) => b.kind === 'ATS')).toBeUndefined();
  });

  it('pays the all at 150:1', () => {
    let s = bet(table(), { kind: 'ATS', ats: 'ALL' }, 5);
    for (const n of [2, 3, 4, 5, 6, 8, 9, 10, 11]) s = applyRoll(s, soft(n)).state;
    const before = bank(s);
    s = applyRoll(s, soft(12)).state;
    expect(bank(s) - before).toBe(5 + 750);
  });

  it('dies on a seven', () => {
    let s = bet(table(), { kind: 'ATS', ats: 'TALL' }, 5);
    s = applyRoll(s, soft(8)).state;
    s = applyRoll(s, soft(7)).state;
    expect(s.bets.find((b) => b.kind === 'ATS')).toBeUndefined();
    expect(s.atsHits).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * Table flow
 * ------------------------------------------------------------------ */

describe('table flow', () => {
  it('passes the dice on a seven out and keeps them otherwise', () => {
    let s = table();
    expect(s.shooter).toBe('A');
    s = applyRoll(s, soft(6)).state;
    s = applyRoll(s, soft(6)).state; // point made
    expect(s.shooter).toBe('A');
    s = applyRoll(s, soft(8)).state;
    s = applyRoll(s, soft(7)).state; // seven out
    expect(s.shooter).toBe('B');
    expect(s.shooterRollCount).toBe(0);
  });

  it('records every roll with its outcome', () => {
    let s = table();
    s = applyRoll(s, soft(11)).state;
    s = applyRoll(s, soft(3)).state;
    s = applyRoll(s, soft(9)).state;
    s = applyRoll(s, soft(5)).state;
    s = applyRoll(s, soft(9)).state;
    s = applyRoll(s, soft(4)).state;
    s = applyRoll(s, soft(7)).state;
    expect(s.history.map((h) => h.outcome)).toEqual([
      'NATURAL',
      'CRAPS',
      'POINT_ESTABLISHED',
      'NEUTRAL',
      'POINT_MADE',
      'POINT_ESTABLISHED',
      'SEVEN_OUT',
    ]);
  });

  it('keeps both seats independent', () => {
    let s = table();
    s = bet(s, { kind: 'PASS' }, 100, 'A');
    s = bet(s, { kind: 'DONT_PASS' }, 100, 'B');
    s = applyRoll(s, soft(7)).state;
    expect(bank(s, 'A')).toBe(10_100);
    expect(bank(s, 'B')).toBe(9900);
  });

  it('never moves a bankroll except by the settlements it reports', () => {
    const rng = createRng('ledger-check');
    let s = table();
    for (let i = 0; i < 2000; i++) {
      for (const seat of ['A', 'B'] as SeatId[]) {
        const specs: BetSpec[] = [
          { kind: s.phase === 'COME_OUT' ? 'PASS' : 'COME' },
          { kind: 'PLACE', number: 6 },
          { kind: 'FIELD' },
          { kind: 'HARDWAY', number: 8 },
          { kind: 'PROP', prop: 'HORN' },
        ];
        const pick = specs[Math.floor(rng.next() * specs.length)];
        const res = placeBet(s, seat, pick, 12);
        if (res.ok) s = res.state;
      }
      const before = { A: bank(s, 'A'), B: bank(s, 'B') };
      const { state, settlements } = applyRoll(s, rollDice(rng));
      for (const seat of ['A', 'B'] as SeatId[]) {
        const credited = settlements
          .filter((x) => x.seat === seat)
          .reduce((sum, x) => sum + x.credit, 0);
        expect(bank(state, seat) - before[seat]).toBeCloseTo(credited, 6);
      }
      s = state;
    }
  });
});

/* ------------------------------------------------------------------ *
 * Bet controls
 * ------------------------------------------------------------------ */

describe('bet controls', () => {
  function withInside(): TableState {
    let s = bet(table(), { kind: 'PASS' }, 10);
    s = applyRoll(s, soft(4)).state;
    s = bet(s, { kind: 'PLACE', number: 5 }, 25);
    s = bet(s, { kind: 'PLACE', number: 6 }, 30);
    s = bet(s, { kind: 'PLACE', number: 8 }, 30);
    s = bet(s, { kind: 'PLACE', number: 9 }, 25);
    return s;
  }

  it('presses only the number that hit, by one payable unit', () => {
    const s = withInside();
    const res = pressNumber(s, 'A', 6);
    expect(res.ok).toBe(true);
    const st = (res as { state: TableState }).state;
    expect(st.bets.find((b) => b.number === 6)!.amount).toBe(36);
    // The rest of the layout is left exactly as it was.
    expect(st.bets.find((b) => b.number === 5)!.amount).toBe(25);
    expect(st.bets.find((b) => b.number === 8)!.amount).toBe(30);
    expect(st.bets.find((b) => b.number === 9)!.amount).toBe(25);
  });

  it('power presses only the number that hit, by doubling it', () => {
    const s = withInside();
    const res = powerPressNumber(s, 'A', 6);
    const st = (res as { state: TableState }).state;
    expect(st.bets.find((b) => b.number === 6)!.amount).toBe(60);
    expect(st.bets.find((b) => b.number === 8)!.amount).toBe(30);
  });

  it('refuses to press a number with nothing on it', () => {
    const s = withInside();
    expect(pressNumber(s, 'A', 4).ok).toBe(false);
    expect(powerPressNumber(s, 'A', 10).ok).toBe(false);
  });

  it('turns everything off and back on', () => {
    const s = withInside();
    const off = (setAllWorking(s, 'A', false) as { state: TableState }).state;
    expect(off.bets.filter((b) => b.kind === 'PLACE').every((b) => !b.working)).toBe(true);
    const on = (setAllWorking(off, 'A', true) as { state: TableState }).state;
    expect(on.bets.filter((b) => b.kind === 'PLACE').every((b) => b.working)).toBe(true);
  });

  it('takes down everything it legally can and refunds the rack', () => {
    const s = withInside();
    const before = bank(s);
    const risk = atRisk(s, 'A');
    const res = takeDownAll(s, 'A');
    const st = (res as { state: TableState }).state;
    // The $10 pass line bet is a contract bet and stays.
    expect(st.bets).toHaveLength(1);
    expect(bank(st)).toBe(before + risk - 10);
  });

  it('lays maximum odds behind every line bet at once', () => {
    let s = bet(table(), { kind: 'PASS' }, 100);
    s = applyRoll(s, soft(6)).state;
    s = bet(s, { kind: 'COME' }, 100);
    s = applyRoll(s, soft(4)).state;
    const res = maxOddsAll(s, 'A');
    const st = (res as { state: TableState }).state;
    expect(st.bets.find((b) => b.kind === 'PASS')!.odds).toBe(500);
    expect(st.bets.find((b) => b.kind === 'COME')!.odds).toBe(300);
  });

  it('keeps issuing unique bet ids after a session is saved and reloaded', () => {
    let s = bet(table(), { kind: 'PASS' }, 10);
    s = applyRoll(s, soft(4)).state;
    s = bet(s, { kind: 'PLACE', number: 6 }, 30);
    s = bet(s, { kind: 'PLACE', number: 8 }, 30);

    // A round trip through storage is where a module-level counter would reset
    // and start handing out ids the restored bets already hold.
    const restored = JSON.parse(JSON.stringify(s)) as TableState;
    let after = bet(restored, { kind: 'PLACE', number: 5 }, 25);
    after = bet(after, { kind: 'PLACE', number: 9 }, 25);

    const ids = after.bets.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);

    // And the ids still address the right bets.
    const five = after.bets.find((b) => b.number === 5)!;
    const res = takeDown(after, five.id);
    expect(res.ok).toBe(true);
    const left = (res as { state: TableState }).state.bets;
    expect(left.some((b) => b.number === 5)).toBe(false);
    expect(left).toHaveLength(ids.length - 1);
  });

  it('refuses a bet the rack cannot cover', () => {
    const s = createTable({ buyIn: 50 });
    expect(placeBet(s, 'A', { kind: 'PASS' }, 100).ok).toBe(false);
  });

  it('takes an under-minimum bet at the minimum instead of refusing it', () => {
    const s = createTable({ buyIn: 10_000, rules: { minBet: 15, maxBet: 500 } });
    const res = placeBet(s, 'A', { kind: 'PASS' }, 5);
    expect(res.ok).toBe(true);
    const st = (res as { state: TableState }).state;
    expect(st.bets[0].amount).toBe(15);
    expect(st.seats.A.bankroll).toBe(10_000 - 15);
  });

  it('still honours the table maximum', () => {
    const s = createTable({ buyIn: 10_000, rules: { minBet: 10, maxBet: 500 } });
    expect(placeBet(s, 'A', { kind: 'PASS' }, 600).ok).toBe(false);
    expect(placeBet(s, 'A', { kind: 'PASS' }, 100).ok).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * Chip denominations, table minimums and the grouped calls
 * ------------------------------------------------------------------ */

describe('what a chip is worth on the felt', () => {
  const chip = (state: TableState, spec: BetSpec, amount: number) =>
    placeBet(state, 'A', spec, amount, { fromChip: true });

  it('bets the six and eight in sixes, converting five-dollar units', () => {
    // A quarter is five units, and five units of six is thirty. Nobody at a
    // real table says twenty-five on the six and means twenty-five.
    for (const [denom, expected] of [
      [5, 6],
      [25, 30],
      [100, 120],
      [500, 600],
    ] as const) {
      for (const number of [6, 8] as const) {
        const res = chip(table(), { kind: 'PLACE', number }, denom);
        expect(res.ok).toBe(true);
        const st = (res as { state: TableState }).state;
        expect(st.bets[0].amount).toBe(expected);
      }
    }
  });

  it('rounds a chip too small for one unit up to a single unit', () => {
    const res = chip(table(), { kind: 'PLACE', number: 6 }, 1);
    const st = (res as { state: TableState }).state;
    expect(st.bets[0].amount).toBe(6);
  });

  it('leaves the other box numbers alone, since they already pay on fives', () => {
    for (const number of [4, 5, 9, 10] as const) {
      const res = chip(table(), { kind: 'PLACE', number }, 25);
      const st = (res as { state: TableState }).state;
      expect(st.bets[0].amount).toBe(25);
    }
  });

  it('tops an existing six up by whole units', () => {
    let s = (chip(table(), { kind: 'PLACE', number: 6 }, 25) as { state: TableState }).state;
    s = (chip(s, { kind: 'PLACE', number: 6 }, 25) as { state: TableState }).state;
    expect(s.bets[0].amount).toBe(60);
  });

  it('lifts an under-minimum six to the minimum and then to a payable total', () => {
    // A $15 table: the $6 a nickel would buy is under the minimum, so it goes
    // to 15, and 15 is not payable in sixes, so it lands on 18.
    const s = createTable({ buyIn: 10_000, rules: { minBet: 15 } });
    const res = chip(s, { kind: 'PLACE', number: 6 }, 5);
    expect(res.ok).toBe(true);
    expect((res as { state: TableState }).state.bets[0].amount).toBe(18);
  });

  it('steps back down a unit rather than overdrawing a short rack', () => {
    // $28 left and a quarter on the six: $30 would overdraw, so it takes $24.
    const s = createTable({ buyIn: 28, rules: { minBet: 1 } });
    const res = chip(s, { kind: 'PLACE', number: 6 }, 25);
    expect(res.ok).toBe(true);
    const st = (res as { state: TableState }).state;
    expect(st.bets[0].amount).toBe(24);
    expect(st.seats.A.bankroll).toBe(4);
  });

  it('never moves money except by the wager it reports', () => {
    const before = table();
    const res = chip(before, { kind: 'PLACE', number: 8 }, 100);
    const st = (res as { state: TableState }).state;
    expect(before.seats.A.bankroll - st.seats.A.bankroll).toBe(st.bets[0].amount);
  });
});

describe('grouped place calls', () => {
  /** Every place/buy bet a seat holds, as number to amount. */
  const held = (state: TableState): Record<number, number> =>
    Object.fromEntries(state.bets.map((b) => [b.number as number, b.amount]));

  // One quarter per number, three calls. The six and eight are bet in sixes,
  // which is the whole reason $25 across costs $160 rather than $150.
  it.each([
    ['inside', INSIDE_NUMBERS, { 5: 25, 6: 30, 8: 30, 9: 25 }, 110],
    ['outside', OUTSIDE_NUMBERS, { 4: 25, 5: 25, 9: 25, 10: 25 }, 100],
    ['across', ACROSS_NUMBERS, { 4: 25, 5: 25, 6: 30, 8: 30, 9: 25, 10: 25 }, 160],
  ] as const)('places the %s numbers at the armed chip', (label, group, expected, spend) => {
    const start = table();
    const res = placeGroup(start, 'A', group, 25, label);
    expect(res.ok).toBe(true);
    const st = (res as { state: TableState }).state;
    expect(held(st)).toEqual(expected);
    expect(start.seats.A.bankroll - st.seats.A.bankroll).toBe(spend);
    expect(atRisk(st, 'A')).toBe(spend);
  });

  it('skips what it cannot place rather than sinking the whole call', () => {
    // $60 is enough for some of the layout but not all of it, and the tail of
    // the call also exercises the short-rack step-down: the six cannot take
    // its full $30, so it takes the largest payable total the rack covers.
    const s = createTable({ buyIn: 60, rules: { minBet: 1 } });
    const res = placeGroup(s, 'A', ACROSS_NUMBERS, 25, 'across');
    expect(res.ok).toBe(true);
    const st = (res as { state: TableState }).state;
    expect(held(st)).toEqual({ 4: 25, 5: 25, 6: 6 });
    expect(st.seats.A.bankroll).toBe(4);
    expect(atRisk(st, 'A') + st.seats.A.bankroll).toBe(60);
  });
});

describe('solo play', () => {
  function sevenOutFrom(state: TableState): TableState {
    let s = applyRoll(state, soft(4)).state; // point is four
    s = applyRoll(s, soft(7)).state; // seven out
    return s;
  }

  // A solo player keeps the dice on a seven out because there is nobody to
  // pass them to; a two-handed table hands them on. The pair is the test.
  it.each([
    [true, 'A'],
    [false, 'B'],
  ] as const)('solo=%s hands the dice to %s after a seven out', (solo, shooter) => {
    const s = sevenOutFrom(createTable({ solo, buyIn: 1000 }));
    expect(s.solo).toBe(solo);
    expect(s.shooter).toBe(shooter);
    expect(s.shooterRollCount).toBe(0);
  });
});


