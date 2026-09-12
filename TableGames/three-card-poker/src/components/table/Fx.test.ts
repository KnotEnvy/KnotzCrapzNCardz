/**
 * What the felt reacts to.
 *
 * `deriveFx` is the only part of the effects layer with a decision in it — the
 * rest is keyframes — and every decision it makes is a rule about the game
 * rather than about animation: which spot a settlement belongs to, whether a
 * hand earned a fanfare, whether the dealer played. Those are worth pinning,
 * because getting one wrong is silent: the table simply does not react, and a
 * missing reaction is exactly the sort of thing a green build hides and a
 * screenshot taken at the wrong millisecond cannot catch.
 *
 * Every fixture here is played through the real engine from a stacked deck, so
 * the settlements are the ones the game produces rather than ones written by
 * hand to match the assertion.
 */

import { describe, expect, it } from 'vitest';
import { deriveFx, NO_FX } from './Fx';
import { FULL, spotCentre } from './layout';
import { defaultRules } from '@/lib/engine/rules';
import { settle } from '@/lib/engine/resolve';
import {
  createTable,
  dealFrom,
  decide,
  revealDealer,
  setWager,
  type ActionResult,
} from '@/lib/engine/table';
import { freshDeck } from '@/lib/engine/deck';
import type { Card, Rank, Settlement, Suit, TableState } from '@/lib/engine/types';
import { cardIndex } from '@/lib/engine/types';

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

/** A deck with the given hands on top, in dealing order: seats, then dealer. */
function stacked(...hands: string[]): Card[] {
  const top = hands.flatMap(hand);
  const used = new Set(top.map((c) => c.id));
  return [...top, ...freshDeck().filter((c) => !used.has(c.id))];
}

function must(res: ActionResult): TableState {
  if (!res.ok) throw new Error(res.reason);
  return res.table;
}

/**
 * Bet, deal the stacked hands, decide, reveal and settle — one round, played
 * the way the game plays it.
 */
function round(
  decisions: Array<'PLAY' | 'FOLD'>,
  hands: string[],
  bets = { ante: 1000, pairPlus: 500, sixCard: 500 },
): { table: TableState; settlements: Settlement[] } {
  let t = createTable(defaultRules(), { seats: decisions.length });
  // Every seat exists; only the first `decisions.length` of them are sat at.
  for (const seat of t.seats.filter((s) => s.occupied)) {
    t = must(setWager(t, seat.id, 'ANTE', bets.ante));
    t = must(setWager(t, seat.id, 'PAIR_PLUS', bets.pairPlus));
    t = must(setWager(t, seat.id, 'SIX_CARD', bets.sixCard));
  }
  t = must(dealFrom(t, stacked(...hands)));
  for (const d of decisions) t = must(decide(t, d));
  t = must(revealDealer(t));
  return settle(t);
}

const g = FULL;

/* ------------------------------------------------------------------ *
 * Tests
 * ------------------------------------------------------------------ */

describe('deriveFx', () => {
  it('says nothing before a hand is dealt', () => {
    const fresh = createTable(defaultRules(), { seats: 1 });
    const fx = deriveFx(fresh, [], g);
    expect(fx).toEqual({ ...NO_FX, round: fresh.round });
  });

  it('reads the qualifier off the dealer, and only once the hand is turned', () => {
    // Q-6-4 is the lowest qualifying hand there is, so it is the one worth
    // asserting: one rank lower in any position and the dealer does not play.
    const { table } = round(['PLAY'], ['As Kh Qd', 'Qs 6h 4d']);
    expect(deriveFx(table, [], g).qualifier).toBe('YES');

    const short = round(['PLAY'], ['As Kh Qd', 'Js 6h 4d']);
    expect(deriveFx(short.table, [], g).qualifier).toBe('NO');

    // Before the reveal there is no answer to give.
    let mid = createTable(defaultRules(), { seats: 1 });
    mid = must(setWager(mid, 'A', 'ANTE', 1000));
    mid = must(dealFrom(mid, stacked('As Kh Qd', 'Qs 6h 4d')));
    expect(deriveFx(mid, [], g).qualifier).toBeNull();
  });

  it('collapses the Ante and its bonus onto the one diamond they share', () => {
    // A straight pays an Ante Bonus as well as the Ante, which is two
    // settlements on one printed spot. Flashing the diamond twice would be
    // two events where the player made one bet.
    const { table, settlements } = round(['PLAY'], ['9s 8h 7d', 'Qs 6h 4d']);
    const kinds = settlements.filter((s) => s.seat === 'A').map((s) => s.kind);
    expect(kinds).toContain('ANTE');
    expect(kinds).toContain('ANTE_BONUS');

    const fx = deriveFx(table, settlements, g);
    const anteFlashes = fx.flashes.filter((f) => f.spot === 'ANTE');
    expect(anteFlashes).toHaveLength(1);
    expect(anteFlashes[0].win).toBe(true);
  });

  it('flies winnings to the seat and rakes losses to the dealer', () => {
    const { table, settlements } = round(['PLAY'], ['9s 8h 7d', 'Qs 6h 4d']);
    const fx = deriveFx(table, settlements, g);

    const won = fx.flights.filter((f) => f.win);
    const lost = fx.flights.filter((f) => !f.win);
    expect(won.length).toBeGreaterThan(0);

    // Winnings end at the seat's own plate; anything raked ends at the tray.
    for (const f of won) expect(f.to.y).toBeGreaterThan(g.seats[0].y);
    for (const f of lost) expect(f.to).toEqual(g.bank);
    // And every one of them starts on the spot it was sitting on — the bet is
    // already off the table by the time this renders, so a flight that read
    // its origin off the felt would start from nowhere.
    for (const f of fx.flights) {
      const spot = fx.flashes.find((s) => s.key === f.key)!;
      expect(f.from).toEqual(spotCentre(g, spot.seat, spot.spot));
    }
  });

  it('leaves a push alone', () => {
    // The dealer does not qualify: the Ante wins and the Play pushes. A spot
    // where nothing moved has nothing to say, and lighting it would claim a
    // bet resolved.
    const { table, settlements } = round(['PLAY'], ['Ks 9h 5d', 'Js 6h 4d']);
    const play = settlements.find((s) => s.seat === 'A' && s.kind === 'PLAY');
    expect(play?.net).toBe(0);

    const fx = deriveFx(table, settlements, g);
    expect(fx.flashes.some((f) => f.spot === 'PLAY')).toBe(false);
    expect(fx.qualifier).toBe('NO');
  });

  it('marks a hand that pays a bonus, and shouts about the ones that stop the pit', () => {
    const straight = round(['PLAY'], ['9s 8h 7d', 'Qs 6h 4d']);
    const quiet = deriveFx(straight.table, straight.settlements, g);
    expect(quiet.bursts.map((b) => b.tone)).toEqual(['gold']);
    expect(quiet.wash).toBe(false);

    const trips = round(['PLAY'], ['9s 9h 9d', 'Qs 6h 4d']);
    const loud = deriveFx(trips.table, trips.settlements, g);
    expect(loud.bursts[0].tone).toBe('jackpot');
    expect(loud.bursts[0].label).toBe(trips.table.seats[0].result!.handName);
    expect(loud.wash).toBe(true);
  });

  it('gives a folded hand no fanfare', () => {
    // Folding a straight is a mistake the trainer will mark, but the hand was
    // given up: the Ante Bonus is gone with it and there is nothing to cheer.
    const { table, settlements } = round(['FOLD'], ['9s 8h 7d', 'Qs 6h 4d']);
    const fx = deriveFx(table, settlements, g);
    expect(fx.bursts).toHaveLength(0);
    expect(fx.wash).toBe(false);
  });

  it('still marks a six card bonus behind a fold, because it is still paid', () => {
    // The rule sheet is explicit that the 6 Card Bonus survives a fold. Four
    // of a kind across the six cards pays 100 to 1 whether the player stayed
    // in or not, so the table has to react to it whether they stayed or not.
    const { table, settlements } = round(['FOLD'], ['9s 9h 9d', '9c Kh 4d']);
    expect(table.seats[0].result?.sixCardHand).toBe('FOUR_OF_A_KIND');
    expect(settlements.find((s) => s.kind === 'SIX_CARD')?.net).toBeGreaterThan(0);

    const fx = deriveFx(table, settlements, g);
    expect(fx.bursts.map((b) => b.key)).toEqual(['0-six']);
    expect(fx.wash).toBe(true);
  });

  it('staggers three seats so the table settles one at a time', () => {
    const { table, settlements } = round(
      ['PLAY', 'PLAY', 'PLAY'],
      ['As Kh Qd', '9s 8h 7c', '4s 4h 9d', 'Qs 6h 4d'],
    );
    const fx = deriveFx(table, settlements, g);
    expect(new Set(fx.flashes.map((f) => f.seat))).toEqual(new Set([0, 1, 2]));

    // Every seat's effects start after the seat to its left.
    for (const seat of [0, 1, 2]) {
      const own = fx.flashes.filter((f) => f.seat === seat);
      expect(own.length).toBeGreaterThan(0);
      for (const f of own) expect(f.delay).toBe(seat * 110);
    }
  });

  it('never puts more chips in the air than read as money', () => {
    const { table, settlements } = round(
      ['PLAY', 'PLAY', 'PLAY'],
      ['As Kh Qd', '9s 8h 7c', '4s 4h 9d', 'Qs 6h 4d'],
    );
    const fx = deriveFx(table, settlements, g);
    expect(fx.flights.length).toBeLessThanOrEqual(10);
    // Every flight is one of the flashes, and no flash appears twice.
    expect(new Set(fx.flashes.map((f) => f.key)).size).toBe(fx.flashes.length);
    for (const f of fx.flights) expect(fx.flashes.some((s) => s.key === f.key)).toBe(true);
  });
});
