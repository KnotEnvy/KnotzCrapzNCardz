/**
 * The engine's test suite.
 *
 * Written for value rather than for count: each test either pins a rule a
 * casino would care about, or covers a path where getting it wrong moves
 * money. The exact figures are proven in `analysis.test.ts`, and the
 * measurements — where the engine is dealt millions of rounds and held against
 * those figures — are in the `*.sim.test.ts` files under their own config.
 *
 * Almost everything here deals from a stacked deck. `stacked` puts chosen
 * hands on the top of a deck in the order the machine hands them out, so a
 * test can say "seat A holds Q-6-4 and the dealer holds a pair of kings"
 * rather than hunting for a seed that deals it.
 */

import { describe, expect, it } from 'vitest';
import { freshDeck, isCompleteDeck, shuffledDeck } from './deck';
import { dollars, fmt, winnings } from './money';
import {
  ANTE_BONUS_TABLES,
  PAIR_PLUS_TABLES,
  SIX_CARD_TABLES,
  anteBonusLine,
  anteBonusTable,
  pairPlusLine,
  pairPlusTable,
  sixCardTable,
} from './paytables';
import { Q64_SCORE, QUALIFYING_SCORE, bestFive, evaluate3, handName, qualifies } from './poker';
import { settle, settleSeat } from './resolve';
import { createRng } from './rng';
import { RULE_PRESETS, defaultRules, matchingPreset, presetById, tableFigures } from './rules';
import {
  abandonRound,
  affordable,
  clearBets,
  coverNeeded,
  createTable,
  deal,
  dealFrom,
  decide,
  legalDecisions,
  nextRound,
  rebet,
  rebuy,
  recordDecision,
  revealDealer,
  seatOf,
  setRules,
  setSeatOccupied,
  setWager,
  type ActionResult,
} from './table';
import type { Card, Rank, SeatId, Suit, TableRules, TableState, Wagers } from './types';
import { cardIndex } from './types';
import { advise, decisionFor, grade } from '@/lib/strategy/strategy';
import { DEFAULT_BOT, playRound } from '@/lib/strategy/autoplay';

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const SUIT_OF: Record<string, Suit> = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' };
const RANK_OF: Record<string, Rank> = { T: 10, J: 11, Q: 12, K: 13, A: 14 };

/** `'Qs 6h 4d'` → three cards. Ranks 2-9, T, J, Q, K, A; suits s h d c. */
function hand(spec: string): Card[] {
  return spec.split(/\s+/).map((token) => {
    const rank = (RANK_OF[token[0]] ?? Number(token[0])) as Rank;
    const suit = SUIT_OF[token[1]];
    return { rank, suit, id: cardIndex(rank, suit) };
  });
}

const score = (spec: string) => evaluate3(hand(spec)).score;

/**
 * A deck with the given hands on top, in dealing order, and the rest of the
 * deck behind them. Dealing order is each playing seat left to right, then the
 * dealer.
 */
function stacked(...hands: string[]): Card[] {
  const top = hands.flatMap(hand);
  const used = new Set(top.map((c) => c.id));
  return [...top, ...freshDeck().filter((c) => !used.has(c.id))];
}

function must(res: ActionResult): TableState {
  if (!res.ok) throw new Error(res.reason);
  return res.table;
}

function table(rules: Partial<TableRules> = {}, seats = 1, bankroll?: number): TableState {
  return createTable({ ...defaultRules(), ...rules }, { seats, bankroll });
}

function bet(t: TableState, seat: SeatId, wagers: Partial<Wagers>): TableState {
  let next = t;
  if (wagers.ante !== undefined) next = must(setWager(next, seat, 'ANTE', wagers.ante));
  if (wagers.pairPlus !== undefined) next = must(setWager(next, seat, 'PAIR_PLUS', wagers.pairPlus));
  if (wagers.sixCard !== undefined) next = must(setWager(next, seat, 'SIX_CARD', wagers.sixCard));
  return next;
}

/** Deal the stacked hands, make the decisions given, reveal, settle. */
function playOut(t: TableState, decisions: Array<'PLAY' | 'FOLD'>, ...hands: string[]): TableState {
  let next = must(dealFrom(t, stacked(...hands)));
  for (const d of decisions) next = must(decide(next, d));
  next = must(revealDealer(next));
  return settle(next).table;
}

const $10 = dollars(10);

/* ------------------------------------------------------------------ *
 * Three-card hands
 * ------------------------------------------------------------------ */

describe('three-card hands', () => {
  it('rank straight flush, trips, straight, flush, pair, high card', () => {
    const ladder = ['4h 5h 6h', '9s 9h 9d', '4s 5h 6d', '2c 9c Kc', 'Js Jd 3c', 'As Kd 9h'];
    for (let i = 1; i < ladder.length; i++) {
      expect(score(ladder[i - 1]), `${ladder[i - 1]} over ${ladder[i]}`).toBeGreaterThan(score(ladder[i]));
    }
  });

  /*
   * The rule sheet: "Ace, king, and queen are the highest ranked straight and
   * ace, 2, 3 is the lowest ranked straight." Scoring the wheel with the ace
   * high would make it the second-best straight in the game.
   */
  it('makes ace-two-three the lowest straight and ace-king-queen the highest', () => {
    expect(evaluate3(hand('As 2d 3h')).category).toBe('STRAIGHT');
    expect(score('As 2d 3h')).toBeLessThan(score('2s 3d 4h'));
    expect(score('Qs Kd Ah')).toBeGreaterThan(score('Js Qd Kh'));
    expect(evaluate3(hand('Ks Ad 2h')).category).toBe('HIGH_CARD');
  });

  it('never lets a suit break a tie', () => {
    expect(score('Qs 6h 4d')).toBe(score('Qc 6d 4s'));
    expect(score('Ah Kh 9h')).toBe(score('As Ks 9s'));
  });

  it('compares a pair, then its kicker', () => {
    expect(score('8s 8h Ad')).toBeGreaterThan(score('8c 8d Kh'));
    expect(score('9s 9h 2d')).toBeGreaterThan(score('8c 8d Ah'));
  });

  it('compares high cards all the way down', () => {
    expect(score('Qs 7h 3d')).toBeGreaterThan(score('Qc 6d 5h'));
    expect(score('Ks 9h 5d')).toBeGreaterThan(score('Kc 9d 4h'));
  });

  it('flags a mini royal only for ace-king-queen of one suit', () => {
    expect(evaluate3(hand('Ah Kh Qh')).miniRoyal).toBe(true);
    expect(evaluate3(hand('Kh Qh Jh')).miniRoyal).toBe(false);
    expect(evaluate3(hand('Ah Kd Qh')).miniRoyal).toBe(false);
  });

  it('names hands the way a dealer says them', () => {
    expect(handName(evaluate3(hand('Qs 6h 4d')))).toBe('Q-6-4 high');
    expect(handName(evaluate3(hand('7s 7h Ad')))).toBe('Pair of sevens');
    expect(handName(evaluate3(hand('As 2s 3s')))).toBe('Straight flush, three high');
    expect(handName(evaluate3(hand('6s 6h 6d')))).toBe('Three sixes');
  });

  it('qualifies the dealer at queen high and not a card lower', () => {
    expect(qualifies(evaluate3(hand('Qs 3h 2d')))).toBe(true);
    expect(qualifies(evaluate3(hand('Js Th 8d')))).toBe(false);
    expect(qualifies(evaluate3(hand('2s 2h 3d')))).toBe(true);
    // The best hand that does not qualify. (J-10-9 is a straight, which is
    // how the first draft of this line came to assert the opposite.)
    expect(QUALIFYING_SCORE).toBeGreaterThan(score('Js Th 8d'));
    expect(evaluate3(hand('Js Th 9d')).category).toBe('STRAIGHT');
  });

  it('draws the strategy line between Q-6-4 and Q-6-3', () => {
    expect(score('Qs 6h 4d')).toBe(Q64_SCORE);
    expect(score('Qs 6h 3d')).toBeLessThan(Q64_SCORE);
    expect(score('Qs 7h 2d')).toBeGreaterThan(Q64_SCORE);
  });
});

/* ------------------------------------------------------------------ *
 * Six cards
 * ------------------------------------------------------------------ */

describe('the best five of six', () => {
  it('finds a royal spread across both hands', () => {
    expect(bestFive([...hand('Ah Kh 2c'), ...hand('Qh Jh Th')])).toBe('ROYAL_FLUSH');
  });

  it('finds a wheel straight flush and a wheel straight', () => {
    expect(bestFive([...hand('As 2s 3s'), ...hand('4s 5s Kd')])).toBe('STRAIGHT_FLUSH');
    expect(bestFive([...hand('As 2d 3s'), ...hand('4c 5s Kd')])).toBe('STRAIGHT');
  });

  it('calls two sets of trips a full house', () => {
    expect(bestFive([...hand('9s 9h 9d'), ...hand('4c 4s 4d')])).toBe('FULL_HOUSE');
  });

  it('does not call three pairs anything better than two pair', () => {
    expect(bestFive([...hand('9s 9h 4d'), ...hand('4c Ks Kd')])).toBe('TWO_PAIR');
  });
});

/* ------------------------------------------------------------------ *
 * Money and paytables
 * ------------------------------------------------------------------ */

describe('money', () => {
  it('floors a payout rather than rounding it up', () => {
    expect(winnings(dollars(5), 40, 1)).toBe(dollars(200));
    expect(winnings(101, 25, 2)).toBe(1262);
  });

  it('formats cents as a dealer would say them', () => {
    expect(fmt(dollars(1000))).toBe('$1,000');
    expect(fmt(dollars(7.5))).toBe('$7.50');
    expect(fmt(-dollars(25))).toBe('-$25');
  });
});

describe('paytables', () => {
  /*
   * Four hands in 22,100 — too few for any simulation to notice either way, so
   * the fallback is pinned here: a mini royal is a straight flush at a table
   * without its own line, and paid 200 to 1 at a table with one.
   */
  it('pays a mini royal as a straight flush unless the table has a line for it', () => {
    const royal = evaluate3(hand('Ah Kh Qh'));
    expect(pairPlusLine(pairPlusTable('40-30-6-3-1'), royal)?.ratio).toEqual([40, 1]);
    expect(pairPlusLine(pairPlusTable('200-40-30-6-3-1'), royal)?.ratio).toEqual([200, 1]);
    expect(pairPlusLine(pairPlusTable('200-40-30-6-3-1'), evaluate3(hand('Kh Qh Jh')))?.ratio).toEqual([40, 1]);
  });

  it('pays the Ante Bonus on a straight or better and nothing below', () => {
    const table = anteBonusTable('5-4-1');
    expect(anteBonusLine(table, evaluate3(hand('4s 5h 6d')))?.ratio).toEqual([1, 1]);
    expect(anteBonusLine(table, evaluate3(hand('2c 9c Kc')))).toBeNull();
  });

  it('gives every table a unique id that is its own pays', () => {
    for (const list of [PAIR_PLUS_TABLES, ANTE_BONUS_TABLES, SIX_CARD_TABLES]) {
      const ids = list.map((t) => t.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const t of list) expect(t.id).toBe(t.lines.map((l) => l.ratio[0]).join('-'));
    }
  });

  it('falls back to the default table for an id it does not know', () => {
    expect(pairPlusTable('no-such-table').id).toBe('40-30-6-3-1');
    expect(sixCardTable('').id).toBe('1000-200-100-20-15-10-7');
  });

  it('prices every preset, and the presets run best first', () => {
    const edges = RULE_PRESETS.map((p) => {
      const f = tableFigures(p.rules);
      return f.antePlay.houseEdge + (f.pairPlus?.houseEdge ?? 0) + (f.sixCard?.houseEdge ?? 0);
    });
    for (let i = 1; i < edges.length; i++) expect(edges[i], RULE_PRESETS[i].id).toBeGreaterThan(edges[i - 1]);
    expect(matchingPreset(defaultRules())?.id).toBe('common');
    expect(presetById('nonsense').id).toBe('common');
  });
});

/* ------------------------------------------------------------------ *
 * Betting
 * ------------------------------------------------------------------ */

describe('betting', () => {
  it('holds the Ante to the table limits', () => {
    const t = table();
    expect(setWager(t, 'A', 'ANTE', dollars(4))).toMatchObject({ ok: false });
    expect(setWager(t, 'A', 'ANTE', dollars(1001))).toMatchObject({ ok: false });
    expect(setWager(t, 'A', 'ANTE', dollars(5))).toMatchObject({ ok: true });
  });

  it('books Pair Plus on its own, with no Ante', () => {
    const t = bet(table(), 'A', { pairPlus: $10 });
    expect(seatOf(t, 'A').bets).toEqual({ ante: 0, pairPlus: $10, sixCard: 0 });
  });

  it('refuses a 6 Card Bonus with no Ante under it', () => {
    const res = setWager(table(), 'A', 'SIX_CARD', $10);
    expect(res).toMatchObject({ ok: false, reason: expect.stringContaining('Ante') });
  });

  it('takes the 6 Card Bonus down with the Ante', () => {
    let t = bet(table(), 'A', { ante: $10, sixCard: $10 });
    t = must(setWager(t, 'A', 'ANTE', 0));
    expect(seatOf(t, 'A').bets.sixCard).toBe(0);
  });

  /*
   * A player who Antes their last chips can be dealt a straight flush and only
   * be able to fold it. The table keeps the Play reserve back instead.
   */
  it('keeps enough back for the Play', () => {
    const t = table({}, 1, dollars(15));
    const res = setWager(t, 'A', 'ANTE', $10);
    expect(res).toMatchObject({ ok: false, reason: expect.stringContaining('Play') });
    expect(setWager(t, 'A', 'ANTE', dollars(7))).toMatchObject({ ok: true });
    expect(coverNeeded({ ante: dollars(7), pairPlus: 0, sixCard: 0 })).toBe(dollars(14));
  });

  it('refuses bets the table does not book', () => {
    const t = table({ pairPlus: false, sixCard: false });
    expect(setWager(t, 'A', 'PAIR_PLUS', $10)).toMatchObject({ ok: false });
    const anted = bet(t, 'A', { ante: $10 });
    expect(setWager(anted, 'A', 'SIX_CARD', $10)).toMatchObject({ ok: false });
  });

  it('closes betting once the cards are out', () => {
    const t = must(deal(bet(table(), 'A', { ante: $10 }), createRng('closed')));
    expect(setWager(t, 'A', 'ANTE', dollars(20))).toMatchObject({ ok: false, reason: 'Bets are closed.' });
    expect(clearBets(t)).toMatchObject({ ok: false });
  });

  it('refuses an empty seat', () => {
    expect(setWager(table({}, 1), 'B', 'ANTE', $10)).toMatchObject({ ok: false, reason: 'That seat is empty.' });
  });

  it('keeps somebody at the table', () => {
    expect(setSeatOccupied(table({}, 1), 'A', false)).toMatchObject({ ok: false });
  });
});

describe('re-betting', () => {
  it('puts last round back up', () => {
    const prev = new Map<SeatId, Wagers>([['A', { ante: $10, pairPlus: dollars(5), sixCard: dollars(5) }]]);
    const t = must(rebet(table(), prev));
    expect(seatOf(t, 'A').bets).toEqual(prev.get('A'));
  });

  it('skips what a raised minimum or an empty bankroll no longer allows', () => {
    const prev = new Map<SeatId, Wagers>([['A', { ante: dollars(5), pairPlus: dollars(25), sixCard: dollars(5) }]]);
    // A $10 minimum takes the $5 Ante and the $5 bonus down; Pair Plus stays.
    const raised = must(rebet(table({ minBet: $10 }), prev));
    expect(seatOf(raised, 'A').bets).toEqual({ ante: 0, pairPlus: dollars(25), sixCard: 0 });
    // $12 covers the Ante and its Play reserve and nothing else.
    const poor = must(rebet(table({}, 1, dollars(12)), prev));
    expect(seatOf(poor, 'A').bets).toEqual({ ante: dollars(5), pairPlus: 0, sixCard: 0 });
  });

  it('keeps what fits in priority order: Ante and its reserve, Pair Plus, then the bonus', () => {
    expect(affordable({ ante: $10, pairPlus: $10, sixCard: $10 }, dollars(35))).toEqual({ ante: $10, pairPlus: $10, sixCard: 0 });
    expect(affordable({ ante: $10, pairPlus: $10, sixCard: $10 }, dollars(15))).toEqual({ ante: 0, pairPlus: $10, sixCard: 0 });
  });
});

/* ------------------------------------------------------------------ *
 * The deal
 * ------------------------------------------------------------------ */

describe('the deal', () => {
  it('hands out stacks of three: seats left to right, the dealer last', () => {
    let t = table({}, 3);
    t = bet(t, 'A', { ante: $10 });
    t = bet(t, 'C', { ante: $10 });
    t = must(dealFrom(t, stacked('Qs 6h 4d', '9c 9d 2h', 'Ks Kh 3c')));
    expect(seatOf(t, 'A').cards).toEqual(hand('Qs 6h 4d'));
    expect(seatOf(t, 'B').cards).toEqual([]);
    expect(seatOf(t, 'C').cards).toEqual(hand('9c 9d 2h'));
    expect(t.dealer.cards).toEqual(hand('Ks Kh 3c'));
    expect(t.dealer.revealed).toBe(false);
  });

  it('takes every wager out of the bankroll, and holds the Play back until it is made', () => {
    let t = bet(table(), 'A', { ante: $10, pairPlus: dollars(5), sixCard: dollars(5) });
    t = must(deal(t, createRng('stakes')));
    const seat = seatOf(t, 'A');
    expect(seat.bankroll).toBe(dollars(1000) - dollars(20));
    expect(seat.wagers).toEqual({ ante: $10, pairPlus: dollars(5), sixCard: dollars(5), play: 0 });
  });

  it('shuffles a complete deck, the same on the same seed', () => {
    const a = shuffledDeck(createRng('alpha'));
    const b = shuffledDeck(createRng('alpha'));
    const c = shuffledDeck(createRng('beta'));
    expect(isCompleteDeck(a)).toBe(true);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('never deals the same card twice in a round', () => {
    const rng = createRng('unique');
    let t = table({}, 3);
    for (const id of ['A', 'B', 'C'] as const) t = bet(t, id, { ante: $10 });
    for (let i = 0; i < 200; i++) {
      const dealt = must(deal(t, rng));
      const ids = [...dealt.dealer.cards, ...dealt.seats.flatMap((s) => s.cards)].map((c) => c.id);
      expect(new Set(ids).size).toBe(12);
    }
  });

  it('refuses a felt with nothing on it', () => {
    expect(deal(table(), createRng('empty'))).toMatchObject({ ok: false });
  });

  it('refuses a seat whose bankroll went below its chips behind the engine’s back', () => {
    let t = bet(table(), 'A', { ante: $10 });
    t = { ...t, seats: t.seats.map((s) => (s.id === 'A' ? { ...s, bankroll: dollars(15) } : s)) };
    expect(deal(t, createRng('x'))).toMatchObject({ ok: false });
  });
});

/* ------------------------------------------------------------------ *
 * Decisions
 * ------------------------------------------------------------------ */

describe('play or fold', () => {
  it('asks each seat with an Ante in turn, and skips a Pair Plus bettor', () => {
    let t = table({}, 3);
    t = bet(t, 'A', { ante: $10 });
    t = bet(t, 'B', { pairPlus: $10 });
    t = bet(t, 'C', { ante: $10 });
    t = must(dealFrom(t, stacked('Qs 6h 4d', '9c 9d 2h', 'Ks Kh 3c', '2s 5d 7c')));
    expect(t.phase).toBe('DECIDING');
    expect(t.focus).toBe('A');
    t = must(decide(t, 'PLAY'));
    expect(t.focus).toBe('C');
    t = must(decide(t, 'FOLD'));
    expect(t.phase).toBe('SHOWDOWN');
    expect(t.focus).toBeNull();
  });

  it('goes straight to the showdown when nobody has an Ante', () => {
    const t = must(dealFrom(bet(table(), 'A', { pairPlus: $10 }), stacked('Qs 6h 4d', '2s 5d 7c')));
    expect(t.phase).toBe('SHOWDOWN');
  });

  it('puts the Play up from the bankroll, equal to the Ante', () => {
    let t = must(dealFrom(bet(table(), 'A', { ante: $10 }), stacked('Qs 6h 4d', '2s 5d 7c')));
    const before = seatOf(t, 'A').bankroll;
    t = must(decide(t, 'PLAY'));
    expect(seatOf(t, 'A').bankroll).toBe(before - $10);
    expect(seatOf(t, 'A').wagers.play).toBe($10);
  });

  it('refuses a decision when none is due', () => {
    expect(legalDecisions(table()).PLAY.allowed).toBe(false);
    expect(decide(table(), 'FOLD')).toMatchObject({ ok: false });
  });

  it('will not reveal the dealer before every seat has decided', () => {
    const t = must(dealFrom(bet(table(), 'A', { ante: $10 }), stacked('Qs 6h 4d', '2s 5d 7c')));
    expect(revealDealer(t)).toMatchObject({ ok: false });
  });
});

/* ------------------------------------------------------------------ *
 * Settlement
 * ------------------------------------------------------------------ */

describe('settlement', () => {
  const start = dollars(1000);

  /*
   * The branch people get backwards. A dealer without a queen pays the Ante
   * whatever the player holds — here a J-high hand that would lose to any
   * qualifying one — and pushes the Play.
   */
  it('pays the Ante and pushes the Play when the dealer does not qualify', () => {
    const t = playOut(bet(table(), 'A', { ante: $10 }), ['PLAY'], 'Js 7h 4d', 'Jc Th 8d');
    const seat = seatOf(t, 'A');
    expect(seat.result).toMatchObject({ outcome: 'NO_QUALIFY', ante: $10, play: 0, net: $10 });
    expect(seat.bankroll).toBe(start + $10);
  });

  it('pays both when the player beats a qualifying dealer', () => {
    const t = playOut(bet(table(), 'A', { ante: $10 }), ['PLAY'], '8s 8h 2d', 'Kc Th 9d');
    expect(seatOf(t, 'A').result).toMatchObject({ outcome: 'WIN', ante: $10, play: $10, net: dollars(20) });
    expect(seatOf(t, 'A').bankroll).toBe(start + dollars(20));
  });

  it('pushes both on hands identical in rank', () => {
    const t = playOut(bet(table(), 'A', { ante: $10 }), ['PLAY'], 'Ks 9h 5d', 'Kc 9d 5h');
    expect(seatOf(t, 'A').result).toMatchObject({ outcome: 'PUSH', ante: 0, play: 0, net: 0 });
    expect(seatOf(t, 'A').bankroll).toBe(start);
  });

  it('takes both when a qualifying dealer is higher', () => {
    const t = playOut(bet(table(), 'A', { ante: $10 }), ['PLAY'], 'Qs 6h 4d', 'Kc 9d 5h');
    expect(seatOf(t, 'A').result).toMatchObject({ outcome: 'LOSE', ante: -$10, play: -$10, net: -dollars(20) });
    expect(seatOf(t, 'A').bankroll).toBe(start - dollars(20));
  });

  /*
   * The Ante Bonus is paid on the hand, not on the showdown: a straight that
   * loses to a straight flush still collects it.
   */
  it('pays the Ante Bonus to a played straight even when the dealer beats it', () => {
    const t = playOut(bet(table(), 'A', { ante: $10 }), ['PLAY'], '4s 5h 6d', '9c Tc Jc');
    expect(seatOf(t, 'A').result).toMatchObject({ outcome: 'LOSE', ante: -$10, play: -$10, anteBonus: $10, net: -$10 });
  });

  it('pays the Ante Bonus on top of a win, at the table’s own rate', () => {
    const t = playOut(bet(table({ anteBonusTable: '5-4-1' }), 'A', { ante: $10 }), ['PLAY'], '7s 7h 7d', 'Kc 9d 5h');
    expect(seatOf(t, 'A').result).toMatchObject({ outcome: 'WIN', anteBonus: dollars(40), net: dollars(60) });
  });

  it('pays no Ante Bonus to a folded hand, however good', () => {
    const t = playOut(bet(table(), 'A', { ante: $10 }), ['FOLD'], '7s 7h 7d', 'Kc 9d 5h');
    expect(seatOf(t, 'A').result).toMatchObject({ outcome: 'FOLD', anteBonus: 0, ante: -$10 });
  });

  it('pays Pair Plus on the cards alone, whatever the dealer holds', () => {
    const t = playOut(bet(table(), 'A', { ante: $10, pairPlus: $10 }), ['PLAY'], '8s 8h 2d', 'Ac Ad Kd');
    expect(seatOf(t, 'A').result).toMatchObject({ outcome: 'LOSE', pairPlus: $10 });
  });

  it('pays Pair Plus with no Ante at all', () => {
    const t = playOut(bet(table(), 'A', { pairPlus: $10 }), [], '4h 5h 6h', 'Ac Ad Kd');
    expect(seatOf(t, 'A').result).toMatchObject({ outcome: null, pairPlus: dollars(400), net: dollars(400) });
    expect(seatOf(t, 'A').bankroll).toBe(start + dollars(400));
  });

  /*
   * The two rules a fold applies, from the rule sheet, side by side: Pair Plus
   * is forfeited with the Ante, and the 6 Card Bonus "shall not be forfeited if
   * the player folds".
   */
  it('forfeits Pair Plus with a fold, and leaves the 6 Card Bonus in action', () => {
    let t = bet(table(), 'A', { ante: $10, pairPlus: $10, sixCard: $10 });
    // A pair folded — a terrible fold — with the dealer completing a full house.
    t = playOut(t, ['FOLD'], '9s 9h 4d', '9d 4c 4h');
    const r = seatOf(t, 'A').result!;
    expect(r).toMatchObject({ outcome: 'FOLD', ante: -$10, pairPlus: -$10, sixCardHand: 'FULL_HOUSE', sixCard: dollars(200) });
    expect(seatOf(t, 'A').bankroll).toBe(start - $10 - $10 + dollars(200));
  });

  it('reads the 6 Card Bonus across the player’s and the dealer’s cards', () => {
    const t = playOut(bet(table(), 'A', { ante: $10, sixCard: $10 }), ['PLAY'], 'Ah Kh 2c', 'Qh Jh Th');
    expect(seatOf(t, 'A').result).toMatchObject({ sixCardHand: 'ROYAL_FLUSH', sixCard: dollars(10_000) });
  });

  it('settles in the order the rule sheet does: Ante, Play, Pair Plus, 6 Card Bonus', () => {
    let t = bet(table(), 'A', { ante: $10, pairPlus: $10, sixCard: $10 });
    t = must(dealFrom(t, stacked('4s 5h 6d', 'Kc 9d 5c')));
    t = must(revealDealer(must(decide(t, 'PLAY'))));
    const kinds = settle(t).settlements.map((s) => s.kind);
    expect(kinds).toEqual(['ANTE', 'PLAY', 'ANTE_BONUS', 'PAIR_PLUS', 'SIX_CARD']);
  });

  it('pays once, however many times it is asked', () => {
    let t = bet(table(), 'A', { ante: $10 });
    t = must(revealDealer(must(decide(must(dealFrom(t, stacked('8s 8h 2d', 'Kc Th 9d'))), 'PLAY'))));
    const once = settle(t).table;
    const twice = settle(once);
    expect(twice.settlements).toEqual([]);
    expect(seatOf(twice.table, 'A').bankroll).toBe(seatOf(once, 'A').bankroll);
    expect(settle(must(dealFrom(bet(table(), 'A', { ante: $10 }), stacked('8s 8h 2d', 'Kc Th 9d')))).settlements).toEqual([]);
  });

  it('keeps the books: every bet’s share adds up to the whole', () => {
    let t = bet(table(), 'A', { ante: $10, pairPlus: $10, sixCard: $10 });
    t = playOut(t, ['PLAY'], '4s 5h 6d', 'Kc 9d 5c');
    const s = seatOf(t, 'A').stats;
    expect(s.net).toBe(s.mainNet + s.pairPlusNet + s.sixCardNet);
    expect(t.history[0]).toMatchObject({ dealerQualified: true, dealerHand: 'HIGH_CARD' });
    expect(t.history[0].seats[0].net).toBe(s.net);
  });

  it('settles one seat without the table, for the parts that need it alone', () => {
    let t = bet(table(), 'A', { ante: $10 });
    t = must(decide(must(dealFrom(t, stacked('8s 8h 2d', 'Kc Th 9d'))), 'PLAY'));
    const { result, returned } = settleSeat(seatOf(t, 'A'), t.dealer.cards, t.rules);
    expect(result.outcome).toBe('WIN');
    expect(returned).toBe(dollars(40));
  });
});

/* ------------------------------------------------------------------ *
 * Conservation
 * ------------------------------------------------------------------ */

describe('the money', () => {
  /*
   * The one assertion that catches a stake taken and not returned, or returned
   * twice, anywhere in the money path: whatever the rounds did, every bankroll
   * ends where it started plus the sum of what the settlements said it won.
   */
  it('is conserved across a thousand rounds of every bet at three seats', () => {
    const rng = createRng('conservation');
    let t = table({}, 3, dollars(100_000));
    const bets = new Map<SeatId, Wagers>(
      (['A', 'B', 'C'] as const).map((id, i) => [id, { ante: dollars(5 + i * 5), pairPlus: i === 1 ? 0 : dollars(5), sixCard: i === 2 ? 0 : dollars(5) }]),
    );
    const starts = t.seats.map((s) => s.bankroll);
    const nets = [0, 0, 0];

    for (let i = 0; i < 1000; i++) {
      const strategy = (['OPTIMAL', 'Q64', 'MIMIC', 'ALWAYS'] as const)[i % 4];
      const out = playRound(t, { strategy }, rng, bets);
      expect(out.dealt).toBe(true);
      out.table.seats.forEach((s, j) => void (nets[j] += out.table.history[0].seats.find((r) => r.seat === s.id)?.net ?? 0));
      t = out.table;
    }

    t.seats.forEach((s, j) => {
      expect(s.bankroll, s.id).toBe(starts[j] + nets[j]);
      expect(s.stats.net, s.id).toBe(nets[j]);
    });
  });
});

/* ------------------------------------------------------------------ *
 * Between rounds
 * ------------------------------------------------------------------ */

describe('between rounds', () => {
  it('will not clear a round that has not been paid', () => {
    let t = bet(table(), 'A', { ante: $10 });
    t = must(revealDealer(must(decide(must(dealFrom(t, stacked('8s 8h 2d', 'Kc Th 9d'))), 'PLAY'))));
    expect(nextRound(t)).toMatchObject({ ok: false });
    expect(nextRound(settle(t).table)).toMatchObject({ ok: true });
  });

  it('leaves the wagers up for the next round, less whatever can no longer be covered', () => {
    let t = bet(table({}, 1, dollars(60)), 'A', { ante: $10, pairPlus: $10, sixCard: $10 });
    // Lose everything: $30 down to $30 left, then the Play takes $10 more.
    t = playOut(t, ['PLAY'], 'Qs 6h 4d', 'Kc 9d 5h');
    t = must(nextRound(t));
    expect(seatOf(t, 'A').bankroll).toBe(dollars(20));
    expect(seatOf(t, 'A').bets).toEqual({ ante: $10, pairPlus: 0, sixCard: 0 });
    expect(t.phase).toBe('BETTING');
    expect(seatOf(t, 'A').cards).toEqual([]);
  });

  it('refunds a round abandoned before it was paid', () => {
    let t = bet(table(), 'A', { ante: $10, pairPlus: $10 });
    t = must(decide(must(dealFrom(t, stacked('8s 8h 2d', 'Kc Th 9d'))), 'PLAY'));
    const back = abandonRound(t);
    expect(seatOf(back, 'A').bankroll).toBe(dollars(1000));
    expect(back.phase).toBe('BETTING');
  });

  /*
   * The window the blackjack table got wrong for four rounds of review: a
   * finished round held on the felt still shows its wagers, and they have
   * already been paid.
   */
  it('refunds nothing for a round abandoned after it was paid', () => {
    let t = bet(table(), 'A', { ante: $10 });
    t = playOut(t, ['PLAY'], '8s 8h 2d', 'Kc Th 9d');
    const paid = seatOf(t, 'A').bankroll;
    expect(seatOf(abandonRound(t), 'A').bankroll).toBe(paid);
  });

  it('reconciles the chips on the felt when the rules change', () => {
    let t = bet(table({}, 1, dollars(100)), 'A', { ante: $10, pairPlus: dollars(50), sixCard: $10 });
    const res = setRules(t, { ...t.rules, minBet: dollars(25), maxPairPlus: dollars(40), sixCard: false });
    t = must(res);
    // The Ante is raised to the minimum; with its $25 reserve that leaves $50,
    // and Pair Plus is capped at $40. The bonus is no longer booked.
    expect(seatOf(t, 'A').bets).toEqual({ ante: dollars(25), pairPlus: dollars(40), sixCard: 0 });
    const tight = must(setRules(t, { ...t.rules, minBet: dollars(60) }));
    expect(seatOf(tight, 'A').bets.ante).toBe(0);
  });

  it('tops a seat up with a rebuy and lifts its peak', () => {
    const t = must(rebuy(table({}, 1, dollars(3)), 'A', dollars(1000)));
    expect(seatOf(t, 'A').bankroll).toBe(dollars(1003));
    expect(seatOf(t, 'A').stats.peakBankroll).toBe(dollars(1003));
  });
});

/* ------------------------------------------------------------------ *
 * Advice
 * ------------------------------------------------------------------ */

describe('the advisor', () => {
  const rules = defaultRules();

  it('plays Q-6-4 and folds Q-6-3, from the exact odds', () => {
    const q64 = advise(hand('Qs 6h 4d'), { ante: $10, pairPlus: 0 }, rules)!;
    const q63 = advise(hand('Qs 6h 3d'), { ante: $10, pairPlus: 0 }, rules)!;
    expect(q64.decision).toBe('PLAY');
    expect(q63.decision).toBe('FOLD');
    expect(q64.playUnits).toBeGreaterThan(-1);
    expect(q63.playUnits).toBeLessThan(-1);
    expect(q64.odds.hands).toBe(18_424);
  });

  it('knows a mini royal can be tied but never beaten', () => {
    const odds = advise(hand('As Ks Qs'), { ante: $10, pairPlus: 0 }, rules)!.odds;
    expect(odds.lose).toBe(0);
    expect(odds.tie).toBe(3);
  });

  it('charges a fold for the Pair Plus it forfeits', () => {
    const a = advise(hand('9s 9h 4d'), { ante: $10, pairPlus: $10 }, rules)!;
    expect(a.ev.FOLD).toBe(-dollars(20));
    const graded = grade(a, 'FOLD');
    expect(graded.correct).toBe(false);
    // Playing wins the pair's Pair Plus for certain, on top of the hand.
    expect(graded.evGivenUp).toBeGreaterThan(dollars(20));
  });

  it('marks the better choice correct and prices the worse one', () => {
    const a = advise(hand('Ks 4h 2d'), { ante: $10, pairPlus: 0 }, rules)!;
    expect(grade(a, 'PLAY')).toEqual({ correct: true, evGivenUp: 0 });
    expect(grade(a, 'FOLD').evGivenUp).toBeGreaterThan(0);
  });

  it('decides the way each strategy says', () => {
    const w = { ante: $10, pairPlus: 0, sixCard: 0 };
    expect(decisionFor('MIMIC', hand('Qs 3h 2d'), w, rules)).toBe('PLAY');
    expect(decisionFor('Q64', hand('Qs 3h 2d'), w, rules)).toBe('FOLD');
    expect(decisionFor('OPTIMAL', hand('Qs 3h 2d'), w, rules)).toBe('FOLD');
    expect(decisionFor('ALWAYS', hand('2s 5h 7d'), w, rules)).toBe('PLAY');
  });

  it('records a graded decision and what it cost', () => {
    const t = recordDecision(table(), 'A', false, 123.6);
    expect(seatOf(t, 'A').stats).toMatchObject({ decisions: 1, correctDecisions: 0, evGivenUp: 124 });
  });

  it('plays a round through the bot with nothing but the public actions', () => {
    const out = playRound(table(), DEFAULT_BOT, createRng('bot'), new Map([['A', { ante: $10, pairPlus: 0, sixCard: 0 }]]));
    expect(out.dealt).toBe(true);
    expect(out.plays + out.folds).toBe(1);
    expect(out.table.phase).toBe('BETTING');
  });
});
