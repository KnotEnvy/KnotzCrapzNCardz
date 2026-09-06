/**
 * The engine's test suite.
 *
 * Written for value rather than for count: each test either pins a rule that
 * a casino would care about, or covers a path where getting it wrong moves
 * money. The statistical tests — where the real proof that the rules add up
 * lives — are in `*.sim.test.ts` and run under their own config.
 *
 * Almost everything here deals from a stacked shoe. `withCards` puts a chosen
 * sequence on the front of a real shuffled shoe, so a test can say "the player
 * gets 8,8 and the dealer shows a six" without also having to reason about
 * what comes next.
 */

import { describe, expect, it } from 'vitest';
import { createRng } from './rng';
import { createShoe, isCompleteShoe, shuffle } from './shoe';
import { createTable, deal, dealerPlayOut, double, hit, nextRound, setBet, setSideBet, split, stand, surrender, takeEvenMoney, takeInsurance, closeOffers, legalActions, resetHandIds } from './table';
import { settle, settleHand } from './resolve';
import { dealerShouldHit, handValue, isBlackjack, isPair, displayTotal } from './hand';
import { fmt, winnings } from './money';
import { RULE_PRESETS, defaultRules, estimateHouseEdge, presetById, rulesShorthand } from './rules';
import {
  resolveBustIt,
  resolveLuckyLadies,
  resolvePerfectPairs,
  resolveRoyalMatch,
  resolveSuperSevens,
  resolveTwentyOnePlusThree,
} from './sidebets';
import type { Card, Rank, Suit, TableRules, TableState } from './types';
import { dollars } from './money';

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const rng = () => createRng('test-seed');

function card(rank: Rank, suit: Suit = 'spades', id = Math.floor(Math.random() * 1e6)): Card {
  return { rank, suit, id };
}

/** Build a table whose shoe deals exactly `order`, then whatever follows. */
function withCards(order: Array<[Rank, Suit]>, rules: Partial<TableRules> = {}, seats = 1): TableState {
  resetHandIds();
  const r = { ...defaultRules(), ...rules };
  const table = createTable(r, rng(), { seats });
  const stacked: Card[] = order.map(([rank, suit], i) => ({ rank, suit, id: 900_000 + i }));
  return {
    ...table,
    shoe: { ...table.shoe, cards: [...stacked, ...table.shoe.cards], size: table.shoe.size + stacked.length },
  };
}

function bet(table: TableState, amount = dollars(10)): TableState {
  const res = setBet(table, 'A', amount);
  if (!res.ok) throw new Error(res.reason);
  return res.table;
}

function must(res: ReturnType<typeof deal>): TableState {
  if (!res.ok) throw new Error(res.reason);
  return res.table;
}

const S = 'spades' as const;
const H = 'hearts' as const;
const D = 'diamonds' as const;
const C = 'clubs' as const;

/* ------------------------------------------------------------------ *
 * Hand mathematics
 * ------------------------------------------------------------------ */

describe('hand value', () => {
  it('counts an ace as eleven until it would bust', () => {
    expect(handValue([card(14), card(6)])).toMatchObject({ total: 17, soft: true, hard: 7 });
    expect(handValue([card(14), card(6), card(10)])).toMatchObject({ total: 17, soft: false, hard: 17 });
  });

  it('demotes only as many aces as it has to', () => {
    // A,A,9 is 21 — one ace stays at eleven.
    expect(handValue([card(14), card(14), card(9)])).toMatchObject({ total: 21, soft: true });
    // A,A,9,9 is 20 — both are down to one.
    expect(handValue([card(14), card(14), card(9), card(9)])).toMatchObject({ total: 20, soft: false });
  });

  it('reports the hard total when a hand busts', () => {
    const v = handValue([card(10), card(9), card(5)]);
    expect(v).toMatchObject({ total: 24, busted: true });
  });

  it('shows both readings of a soft hand and one of a hard one', () => {
    expect(displayTotal([card(14), card(6)])).toBe('7/17');
    expect(displayTotal([card(10), card(7)])).toBe('17');
  });
});

describe('blackjack', () => {
  it('is an ace and a ten on the first two cards, either way round', () => {
    expect(isBlackjack([card(14), card(13)])).toBe(true);
    expect(isBlackjack([card(12), card(14)])).toBe(true);
  });

  it('is not twenty-one on three cards', () => {
    expect(isBlackjack([card(7), card(4), card(10)])).toBe(false);
  });

  /*
   * The rule that is worth about a tenth of a percent and is wrong in a
   * surprising number of implementations: ace-ten on a split hand pays even
   * money, not three to two.
   */
  it('is not a natural on a split hand', () => {
    expect(isBlackjack([card(14), card(10)], 1)).toBe(false);
  });
});

describe('pairs', () => {
  it('reads by value, so a king and a jack are a pair', () => {
    expect(isPair([card(13), card(11)])).toBe(true);
    expect(isPair([card(13), card(9)])).toBe(false);
  });
});

describe('dealer drawing', () => {
  const s17 = { ...defaultRules(), hitsSoft17: false };
  const h17 = { ...defaultRules(), hitsSoft17: true };

  it('stands on hard seventeen either way', () => {
    expect(dealerShouldHit([card(10), card(7)], s17)).toBe(false);
    expect(dealerShouldHit([card(10), card(7)], h17)).toBe(false);
  });

  it('splits on soft seventeen, which is the entire H17 rule', () => {
    expect(dealerShouldHit([card(14), card(6)], s17)).toBe(false);
    expect(dealerShouldHit([card(14), card(6)], h17)).toBe(true);
  });

  it('draws to sixteen and stands on eighteen', () => {
    expect(dealerShouldHit([card(10), card(6)], s17)).toBe(true);
    expect(dealerShouldHit([card(10), card(8)], s17)).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Money
 * ------------------------------------------------------------------ */

describe('money', () => {
  it('floors a payout rather than rounding it up', () => {
    // $5 at 3:2 is exactly $7.50; $5 at 6:5 is exactly $6.
    expect(winnings(dollars(5), 3, 2)).toBe(dollars(7.5));
    expect(winnings(dollars(5), 6, 5)).toBe(dollars(6));
    // A wager that does not divide: $7 at 3:2 is $10.50.
    expect(winnings(dollars(7), 3, 2)).toBe(dollars(10.5));
    // And one that cannot be paid exactly floors in the house's favour.
    expect(winnings(101, 3, 2)).toBe(151);
  });

  it('formats cents as a dealer would say them', () => {
    expect(fmt(dollars(1000))).toBe('$1,000');
    expect(fmt(dollars(7.5))).toBe('$7.50');
    expect(fmt(-dollars(25))).toBe('-$25');
  });
});

/* ------------------------------------------------------------------ *
 * The shoe
 * ------------------------------------------------------------------ */

describe('the shoe', () => {
  it('holds every card exactly once per deck', () => {
    for (const decks of [1, 2, 6, 8]) {
      const shoe = createShoe(decks, 0.75, rng());
      expect(shoe.cards).toHaveLength(decks * 52);
      expect(isCompleteShoe(shoe, decks)).toBe(true);
    }
  });

  it('puts the cut card where penetration says, clamped away from the ends', () => {
    const shoe = createShoe(6, 0.75, rng());
    expect(shoe.cutAt).toBe(Math.round(312 * 0.75));
    // A pathological slider still leaves a dealable shoe.
    expect(createShoe(1, 0.999, rng()).cutAt).toBeLessThanOrEqual(52 - 15);
    expect(createShoe(1, 0.0, rng()).cutAt).toBeGreaterThanOrEqual(20);
  });

  it('shuffles to a different order on a different seed, and the same on the same one', () => {
    const a = createShoe(1, 0.75, createRng('alpha')).cards.map((c) => c.id);
    const b = createShoe(1, 0.75, createRng('alpha')).cards.map((c) => c.id);
    const c = createShoe(1, 0.75, createRng('beta')).cards.map((c) => c.id);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  /*
   * A shuffle that never moves a card is a shuffle that has silently become
   * the identity. Over 52 cards a genuine permutation leaves on average one
   * card in place, so "fewer than five fixed points" is a loose but effective
   * canary.
   */
  it('actually permutes', () => {
    const before = createShoe(1, 0.75, rng()).cards;
    const after = shuffle(before.slice(), createRng('other'));
    const fixed = before.filter((c, i) => after[i].id === c.id).length;
    expect(fixed).toBeLessThan(5);
  });
});

/* ------------------------------------------------------------------ *
 * Dealing
 * ------------------------------------------------------------------ */

describe('the deal', () => {
  it('deals player, dealer, player, dealer and leaves the hole card down', () => {
    let t = bet(withCards([[5, S], [10, H], [6, D], [9, C]]));
    t = must(deal(t, rng()));
    expect(t.seats[0].hands[0].cards.map((c) => c.rank)).toEqual([5, 6]);
    expect(t.dealer.cards.map((c) => c.rank)).toEqual([10, 9]);
    expect(t.dealer.holeDown).toBe(true);
  });

  it('deals the dealer one card only under ENHC', () => {
    let t = bet(withCards([[5, S], [10, H], [6, D]], { holeCard: 'ENHC' }));
    t = must(deal(t, rng()));
    expect(t.dealer.cards).toHaveLength(1);
  });

  it('takes the wager out of the bankroll when the cards come out', () => {
    let t = bet(withCards([[5, S], [10, H], [6, D], [9, C]]), dollars(25));
    const before = t.seats[0].bankroll;
    t = must(deal(t, rng()));
    expect(t.seats[0].bankroll).toBe(before - dollars(25));
  });

  it('refuses to deal with nothing on the felt', () => {
    const t = withCards([]);
    expect(deal(t, rng())).toMatchObject({ ok: false });
  });

  it('does not deal to a seat that has not bet', () => {
    let t = withCards([[5, S], [10, H], [6, D], [9, C]], {}, 2);
    t = bet(t);
    t = must(deal(t, rng()));
    expect(t.seats[0].hands).toHaveLength(1);
    expect(t.seats[1].hands).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ *
 * The peek
 * ------------------------------------------------------------------ */

describe('the dealer’s peek', () => {
  it('ends the round immediately on a natural, before any decision', () => {
    // Player 9,7. Dealer shows an ace with a king under it.
    let t = bet(withCards([[9, S], [14, H], [7, D], [13, C]]));
    t = must(deal(t, rng()));
    // The ace opens insurance first.
    expect(t.phase).toBe('INSURANCE');
    t = must(closeOffers(t));
    expect(t.phase).toBe('DEALER');
    expect(t.seats[0].hands[0].done).toBe(false);
  });

  it('does not open insurance on a dealer ten', () => {
    let t = bet(withCards([[9, S], [13, H], [7, D], [5, C]]));
    t = must(deal(t, rng()));
    expect(t.phase).toBe('PLAYER');
  });

  it('lets play begin when the hole card is not a ten', () => {
    let t = bet(withCards([[9, S], [14, H], [7, D], [5, C]]));
    t = must(deal(t, rng()));
    t = must(closeOffers(t));
    expect(t.phase).toBe('PLAYER');
  });
});

/* ------------------------------------------------------------------ *
 * Playing
 * ------------------------------------------------------------------ */

describe('hitting', () => {
  it('finishes the hand on a bust', () => {
    let t = bet(withCards([[10, S], [7, H], [6, D], [5, C], [10, H]]));
    t = must(deal(t, rng()));
    t = must(hit(t));
    const hand = t.seats[0].hands[0];
    expect(hand.outcome).toBe('BUST');
    expect(hand.done).toBe(true);
  });

  it('finishes the hand on twenty-one without making the player say stand', () => {
    let t = bet(withCards([[10, S], [7, H], [6, D], [5, C], [5, H]]));
    t = must(deal(t, rng()));
    t = must(hit(t));
    expect(handValue(t.seats[0].hands[0].cards).total).toBe(21);
    expect(t.seats[0].hands[0].done).toBe(true);
    expect(t.phase).toBe('DEALER');
  });
});

describe('doubling', () => {
  it('doubles the wager, takes one card and stops', () => {
    let t = bet(withCards([[6, S], [7, H], [5, D], [5, C], [9, H]]), dollars(10));
    t = must(deal(t, rng()));
    const before = t.seats[0].bankroll;
    t = must(double(t));
    const hand = t.seats[0].hands[0];
    expect(hand.bet).toBe(dollars(20));
    expect(hand.cards).toHaveLength(3);
    expect(hand.done).toBe(true);
    expect(t.seats[0].bankroll).toBe(before - dollars(10));
  });

  it('is refused on three cards', () => {
    let t = bet(withCards([[2, S], [7, H], [3, D], [5, C], [4, H]]));
    t = must(deal(t, rng()));
    t = must(hit(t));
    expect(legalActions(t).DOUBLE.allowed).toBe(false);
  });

  it('respects a 10-11 table', () => {
    let t = bet(withCards([[4, S], [7, H], [5, D], [5, C]], { double: '10-11' }));
    t = must(deal(t, rng()));
    const legal = legalActions(t);
    expect(legal.DOUBLE.allowed).toBe(false);
    expect(legal.DOUBLE.reason).toContain('10-11');
  });

  it('respects a table that will not double a soft total', () => {
    let t = bet(withCards([[14, S], [7, H], [6, D], [5, C]], { doubleSoft: false }));
    t = must(deal(t, rng()));
    expect(legalActions(t).DOUBLE.allowed).toBe(false);
  });

  it('is refused when the bankroll cannot match it', () => {
    resetHandIds();
    const table = createTable(defaultRules(), rng(), { seats: 1, bankroll: dollars(30) });
    const stacked: Card[] = ([[6, S], [7, H], [5, D], [5, C]] as Array<[Rank, Suit]>).map(([r, s], i) => ({ rank: r, suit: s, id: 800_000 + i }));
    let t: TableState = { ...table, shoe: { ...table.shoe, cards: [...stacked, ...table.shoe.cards] } };
    t = bet(t, dollars(25));
    t = must(deal(t, rng()));
    expect(legalActions(t).DOUBLE.allowed).toBe(false);
  });
});

describe('splitting', () => {
  it('makes two hands, each with its own wager and a fresh card', () => {
    let t = bet(withCards([[8, S], [6, H], [8, D], [5, C], [3, H], [2, C]]), dollars(10));
    t = must(deal(t, rng()));
    const before = t.seats[0].bankroll;
    t = must(split(t));
    const seat = t.seats[0];
    expect(seat.hands).toHaveLength(2);
    expect(seat.hands[0].cards.map((c) => c.rank)).toEqual([8, 3]);
    expect(seat.hands[1].cards.map((c) => c.rank)).toEqual([8, 2]);
    expect(seat.bankroll).toBe(before - dollars(10));
    expect(seat.hands[1].bet).toBe(dollars(10));
  });

  it('gives split aces one card each and no more', () => {
    let t = bet(withCards([[14, S], [6, H], [14, D], [5, C], [9, H], [7, C]]));
    t = must(deal(t, rng()));
    t = must(split(t));
    const seat = t.seats[0];
    expect(seat.hands[0].done).toBe(true);
    expect(seat.hands[1].done).toBe(true);
    expect(t.phase).toBe('DEALER');
  });

  it('does not pay a split ace-ten as a natural', () => {
    let t = bet(withCards([[14, S], [6, H], [14, D], [5, C], [13, H], [7, C], [10, S]]), dollars(10));
    t = must(deal(t, rng()));
    t = must(split(t));
    t = dealerPlayOut(t);
    const { table: settled } = settle(t);
    const hand = settled.seats[0].hands[0];
    expect(hand.cards.map((c) => c.rank)).toEqual([14, 13]);
    expect(hand.outcome).not.toBe('BLACKJACK');
  });

  it('stops at the table’s re-split limit', () => {
    // Split to four hands, then refuse the fifth.
    let t = bet(withCards(
      [[8, S], [6, H], [8, D], [5, C], [8, H], [8, C], [8, S], [8, H], [8, D], [8, C]],
      { resplitTo: 3 },
    ));
    t = must(deal(t, rng()));
    t = must(split(t));
    t = must(split(t));
    t = must(split(t));
    expect(t.seats[0].hands).toHaveLength(4);
    expect(legalActions(t).SPLIT.reason).toContain('4 hands');
  });

  it('refuses to re-split aces unless the table allows it', () => {
    let t = bet(withCards([[14, S], [6, H], [14, D], [5, C], [14, H], [14, C], [9, S], [8, H]], {
      oneCardOnSplitAces: false,
      resplitAces: false,
    }));
    t = must(deal(t, rng()));
    t = must(split(t));
    expect(legalActions(t).SPLIT.allowed).toBe(false);
  });

  /*
   * Re-split aces is a rule that is easy to implement as a no-op: split aces
   * take one card each and stop, so if the hand is marked finished the moment
   * that card lands, a third ace can never be split and the switch does
   * nothing at all. It did exactly that here, while the setup screen credited
   * it with 0.08% and the README advertised it.
   */
  it('re-splits aces when the table allows it', () => {
    let t = bet(
      withCards([[14, S], [6, H], [14, D], [5, C], [14, H], [9, C], [8, S], [8, D]], {
        resplitAces: true,
        oneCardOnSplitAces: true,
        resplitTo: 3,
      }),
    );
    t = must(deal(t, rng()));
    t = must(split(t));
    // The first hand drew another ace, so it is still live — and the only
    // thing it may do is split again.
    const legal = legalActions(t);
    expect(legal.SPLIT.allowed).toBe(true);
    expect(legal.HIT.allowed).toBe(false);
    t = must(split(t));
    expect(t.seats[0].hands).toHaveLength(3);
    // Each of the three now holds one ace and one card, and none may draw.
    for (const hand of t.seats[0].hands) expect(hand.cards).toHaveLength(2);
  });

  it('does not re-split aces when the table does not allow it', () => {
    let t = bet(
      withCards([[14, S], [6, H], [14, D], [5, C], [14, H], [9, C]], {
        resplitAces: false,
        oneCardOnSplitAces: true,
      }),
    );
    t = must(deal(t, rng()));
    t = must(split(t));
    expect(t.seats[0].hands.every((h) => h.done)).toBe(true);
    expect(t.phase).toBe('DEALER');
  });

  it('stops re-splitting aces at the table limit', () => {
    let t = bet(
      withCards([[14, S], [6, H], [14, D], [5, C], [14, H], [14, C], [14, S], [9, H]], {
        resplitAces: true,
        oneCardOnSplitAces: true,
        resplitTo: 1,
      }),
    );
    t = must(deal(t, rng()));
    t = must(split(t));
    // Two hands is the limit here, so both stop even though both drew aces.
    expect(t.seats[0].hands).toHaveLength(2);
    expect(t.seats[0].hands.every((h) => h.done)).toBe(true);
  });

  it('refuses to double after a split when the table says no', () => {
    let t = bet(withCards([[8, S], [6, H], [8, D], [5, C], [3, H], [2, C]], { das: false }));
    t = must(deal(t, rng()));
    t = must(split(t));
    expect(legalActions(t).DOUBLE.allowed).toBe(false);
    expect(legalActions(t).DOUBLE.reason).toContain('after a split');
  });

  it('plays split hands left to right', () => {
    let t = bet(withCards([[8, S], [6, H], [8, D], [5, C], [3, H], [2, C], [4, S], [4, D]]));
    t = must(deal(t, rng()));
    t = must(split(t));
    expect(t.focus).toEqual({ seat: 'A', hand: 0 });
    t = must(stand(t));
    expect(t.focus).toEqual({ seat: 'A', hand: 1 });
  });
});

describe('surrender', () => {
  it('returns half the wager and ends the hand', () => {
    let t = bet(withCards([[10, S], [9, H], [6, D], [5, C]], { surrender: 'LATE' }), dollars(10));
    t = must(deal(t, rng()));
    t = must(surrender(t));
    t = dealerPlayOut(t);
    const { table: settled } = settle(t);
    expect(settled.seats[0].hands[0].outcome).toBe('SURRENDER');
    expect(settled.seats[0].hands[0].net).toBe(-dollars(5));
  });

  it('is refused after a hit', () => {
    let t = bet(withCards([[10, S], [9, H], [2, D], [5, C], [2, H]], { surrender: 'LATE' }));
    t = must(deal(t, rng()));
    t = must(hit(t));
    expect(legalActions(t).SURRENDER.allowed).toBe(false);
  });

  it('is refused on a table that does not offer it', () => {
    let t = bet(withCards([[10, S], [9, H], [6, D], [5, C]], { surrender: 'NONE' }));
    t = must(deal(t, rng()));
    expect(legalActions(t).SURRENDER.allowed).toBe(false);
  });

  /*
   * Early surrender is the whole reason casinos stopped offering it: it is
   * taken before the peek, so a dealer natural does not get to take the bet
   * first. Late surrender against the same hand returns nothing.
   */
  it('early surrender saves half the bet even against a dealer natural', () => {
    let t = bet(withCards([[10, S], [14, H], [6, D], [13, C]], { surrender: 'EARLY' }), dollars(10));
    t = must(deal(t, rng()));
    expect(t.phase).toBe('INSURANCE');
    t = must(surrender(t));
    t = must(closeOffers(t));
    t = dealerPlayOut(t);
    const { table: settled } = settle(t);
    expect(settled.seats[0].hands[0].net).toBe(-dollars(5));
  });

  it('late surrender against the same hand loses the lot', () => {
    let t = bet(withCards([[10, S], [14, H], [6, D], [13, C]], { surrender: 'LATE' }), dollars(10));
    t = must(deal(t, rng()));
    t = must(closeOffers(t));
    t = dealerPlayOut(t);
    const { table: settled } = settle(t);
    expect(settled.seats[0].hands[0].net).toBe(-dollars(10));
  });
});

/* ------------------------------------------------------------------ *
 * Insurance
 * ------------------------------------------------------------------ */

describe('insurance', () => {
  it('pays 2:1 when the hole card is a ten', () => {
    let t = bet(withCards([[9, S], [14, H], [7, D], [13, C]]), dollars(10));
    t = must(deal(t, rng()));
    t = must(takeInsurance(t, 'A', dollars(5)));
    t = must(closeOffers(t));
    t = dealerPlayOut(t);
    const { table: settled } = settle(t);
    // Insurance wins $10, the hand loses $10. Net zero — which is the point.
    expect(settled.seats[0].insuranceNet).toBe(dollars(10));
    expect(settled.seats[0].hands[0].net).toBe(-dollars(10));
  });

  it('loses when the hole card is not a ten', () => {
    let t = bet(withCards([[9, S], [14, H], [7, D], [5, C]]), dollars(10));
    t = must(deal(t, rng()));
    t = must(takeInsurance(t, 'A', dollars(5)));
    t = must(closeOffers(t));
    t = must(stand(t));
    t = dealerPlayOut(t);
    const { table: settled } = settle(t);
    expect(settled.seats[0].insuranceNet).toBe(-dollars(5));
  });

  /*
   * Even money is arithmetic, not convention. Insuring a natural for x returns
   * 2x when the dealer has one (the hand pushes) and p - x when they do not,
   * where p is the blackjack payout. Guaranteeing exactly 1 needs x = 1/2 from
   * the first and x = p - 1 from the second, and those agree only at 3:2. At
   * six to five the offer cannot be made honestly, so it is not made — this
   * used to accept it and quietly pay $7 on a $10 bet half the time.
   */
  it('refuses even money at a 6:5 table', () => {
    let t = bet(withCards([[14, S], [14, H], [13, D], [5, C]], { blackjackPays: '6:5' }), dollars(10));
    t = must(deal(t, rng()));
    const res = takeEvenMoney(t, 'A');
    expect(res).toMatchObject({ ok: false });
    expect(res.ok ? '' : res.reason).toContain('3:2');
    // Insurance is a different bet and is still available.
    expect(takeInsurance(t, 'A', dollars(5))).toMatchObject({ ok: true });
  });

  it('refuses even money against anything but an ace', () => {
    // Early surrender opens the offers on a ten, which is the one way to
    // reach this phase without a dealer ace showing.
    let t = bet(withCards([[14, S], [13, H], [13, D], [5, C]], { surrender: 'EARLY' }), dollars(10));
    t = must(deal(t, rng()));
    expect(t.phase).toBe('INSURANCE');
    expect(takeEvenMoney(t, 'A')).toMatchObject({ ok: false });
    expect(takeInsurance(t, 'A', dollars(5))).toMatchObject({ ok: false });
  });

  it('caps at half the wager', () => {
    let t = bet(withCards([[9, S], [14, H], [7, D], [5, C]]), dollars(10));
    t = must(deal(t, rng()));
    expect(takeInsurance(t, 'A', dollars(6))).toMatchObject({ ok: false });
  });

  /*
   * Even money is insurance for the maximum on a natural, and the arithmetic
   * has to come out to exactly 1:1 on the main wager whether or not the dealer
   * turns one over.
   */
  it('even money pays the same either way the hole card falls', () => {
    for (const hole of [13, 5] as Rank[]) {
      let t = bet(withCards([[14, S], [14, H], [13, D], [hole, C]]), dollars(10));
      t = must(deal(t, rng()));
      t = must(takeEvenMoney(t, 'A'));
      t = must(closeOffers(t));
      if (t.phase === 'PLAYER') t = must(stand(t));
      t = dealerPlayOut(t);
      const { table: settled } = settle(t);
      const seat = settled.seats[0];
      expect(seat.hands[0].net + (seat.insuranceNet ?? 0)).toBe(dollars(10));
    }
  });
});

/* ------------------------------------------------------------------ *
 * Settlement
 * ------------------------------------------------------------------ */

describe('settlement', () => {
  const rules = defaultRules();

  it('pays a natural at three to two', () => {
    const hand = { bet: dollars(10), baseBet: dollars(10), cards: [card(14), card(13)], splitDepth: 0, surrendered: false } as never;
    expect(settleHand(hand, [card(9), card(8)], false, rules).net).toBe(dollars(15));
  });

  it('pays a natural at six to five when the table says so', () => {
    const hand = { bet: dollars(10), baseBet: dollars(10), cards: [card(14), card(13)], splitDepth: 0, surrendered: false } as never;
    expect(settleHand(hand, [card(9), card(8)], false, { ...rules, blackjackPays: '6:5' }).net).toBe(dollars(12));
  });

  it('pushes two naturals', () => {
    const hand = { bet: dollars(10), baseBet: dollars(10), cards: [card(14), card(13)], splitDepth: 0, surrendered: false } as never;
    expect(settleHand(hand, [card(14), card(10)], true, rules)).toMatchObject({ outcome: 'PUSH', net: 0 });
  });

  /*
   * The house edge, in one assertion: a player who busts loses even when the
   * dealer busts afterwards. Everything else in the game is an attempt to
   * claw back the value of going first.
   */
  it('loses a busted hand even against a busted dealer', () => {
    const hand = { bet: dollars(10), baseBet: dollars(10), cards: [card(10), card(9), card(8)], splitDepth: 0, surrendered: false } as never;
    expect(settleHand(hand, [card(10), card(6), card(9)], false, rules)).toMatchObject({ outcome: 'BUST', net: -dollars(10) });
  });

  it('returns the stake and the winnings on a win', () => {
    const hand = { bet: dollars(10), baseBet: dollars(10), cards: [card(10), card(10)], splitDepth: 0, surrendered: false } as never;
    expect(settleHand(hand, [card(10), card(9)], false, rules)).toMatchObject({ net: dollars(10), returned: dollars(20) });
  });

  it('pays a double at the doubled amount and no more', () => {
    const hand = { bet: dollars(20), baseBet: dollars(10), cards: [card(5), card(6), card(10)], splitDepth: 0, surrendered: false } as never;
    expect(settleHand(hand, [card(10), card(7)], false, rules)).toMatchObject({ net: dollars(20), returned: dollars(40) });
  });

  it('leaves the bankroll exactly where the arithmetic says after a full round', () => {
    // Player 20 against dealer 19: a $25 win.
    let t = bet(withCards([[10, S], [10, H], [10, D], [9, C]]), dollars(25));
    const start = t.seats[0].bankroll;
    t = must(deal(t, rng()));
    t = must(stand(t));
    t = dealerPlayOut(t);
    const { table: settled } = settle(t);
    expect(settled.seats[0].bankroll).toBe(start + dollars(25));
  });

  it('records the round in the history', () => {
    let t = bet(withCards([[10, S], [10, H], [10, D], [9, C]]));
    t = must(deal(t, rng()));
    t = must(stand(t));
    t = dealerPlayOut(t);
    const { table: settled, record } = settle(t);
    expect(settled.history).toHaveLength(1);
    expect(record.dealerTotal).toBe(19);
    expect(record.hands[0].outcome).toBe('WIN');
  });

  /*
   * The strongest single assertion in the file: whatever a round did — split
   * twice, double both halves, take insurance — the bankroll at the end has to
   * be the bankroll at the start plus the sum of the signed results. It is the
   * one check that catches a stake taken and not returned, or returned twice,
   * anywhere in the money path.
   */
  it('conserves the bankroll across a split with two doubles', () => {
    // 8,8 against a 6. Split, each eight draws a three, double both elevens.
    let t = bet(
      withCards(
        [[8, S], [6, H], [8, D], [5, C], [3, H], [3, C], [10, S], [10, D], [10, H]],
        { das: true },
      ),
      dollars(10),
    );
    const start = t.seats[0].bankroll;
    t = must(deal(t, rng()));
    t = must(split(t));
    t = must(double(t));
    t = must(double(t));
    t = dealerPlayOut(t);
    const { table: settled } = settle(t);
    const seat = settled.seats[0];

    expect(seat.hands).toHaveLength(2);
    for (const hand of seat.hands) expect(hand.bet).toBe(dollars(20));
    const net = seat.hands.reduce((n, h) => n + h.net, 0);
    expect(seat.bankroll).toBe(start + net);
  });

  it('pushes a three-card twenty-one against a dealer twenty-one', () => {
    let t = bet(withCards([[7, S], [10, H], [4, D], [5, C], [10, S], [6, H]]));
    t = must(deal(t, rng()));
    t = must(hit(t));
    t = dealerPlayOut(t);
    const { table: settled } = settle(t);
    expect(settled.seats[0].hands[0].outcome).toBe('PUSH');
  });

  it('surrenders an odd wager in the house’s favour', () => {
    // $1.01 surrendered returns $0.50, not $0.51 — a dealer pushing chips
    // back rounds down, and so does this.
    let t = bet(withCards([[10, S], [9, H], [6, D], [5, C]], { surrender: 'LATE', minBet: 1 }), 101);
    t = must(deal(t, rng()));
    t = must(surrender(t));
    t = dealerPlayOut(t);
    const { table: settled } = settle(t);
    expect(settled.seats[0].hands[0].net).toBe(-51);
  });

  it('cannot pay twice for the same round', () => {
    let t = bet(withCards([[10, S], [10, H], [10, D], [9, C]]), dollars(25));
    t = must(deal(t, rng()));
    t = must(stand(t));
    t = dealerPlayOut(t);
    const first = settle(t);
    const second = settle(first.table);
    expect(second.settlements).toHaveLength(0);
    expect(second.table.seats[0].bankroll).toBe(first.table.seats[0].bankroll);
  });
});

/* ------------------------------------------------------------------ *
 * ENHC
 * ------------------------------------------------------------------ */

describe('no hole card', () => {
  /*
   * The rule's entire cost to the player, in one hand: the dealer's second
   * card arrives after the doubling is done, so a natural takes the doubled
   * chips as well. Under PEEK the same hand never gets to double at all.
   */
  it('takes a doubled bet when the dealer draws a natural', () => {
    let t = bet(withCards([[6, S], [14, H], [5, D], [9, C], [13, S]], {
      holeCard: 'ENHC',
      double: 'ANY2',
      insurance: false,
    }), dollars(10));
    t = must(deal(t, rng()));
    expect(t.dealer.cards).toHaveLength(1);
    t = must(double(t));
    t = dealerPlayOut(t);
    const { table: settled } = settle(t);
    expect(settled.dealer.cards.map((c) => c.rank)).toEqual([14, 13]);
    expect(settled.seats[0].hands[0].net).toBe(-dollars(20));
  });
});

/* ------------------------------------------------------------------ *
 * Side bets
 * ------------------------------------------------------------------ */

describe('side bets', () => {
  const amt = dollars(10);

  it('Perfect Pairs grades all three tiers', () => {
    expect(resolvePerfectPairs([card(8, S), card(8, S)], amt).net).toBe(dollars(250));
    expect(resolvePerfectPairs([card(8, H), card(8, D)], amt).net).toBe(dollars(120));
    expect(resolvePerfectPairs([card(8, H), card(8, S)], amt).net).toBe(dollars(60));
    expect(resolvePerfectPairs([card(8, H), card(9, S)], amt).net).toBe(0);
  });

  it('21+3 reads a three-card poker hand, wheel included', () => {
    expect(resolveTwentyOnePlusThree([card(7, S), card(7, S)], card(7, S), amt).net).toBe(dollars(1000));
    expect(resolveTwentyOnePlusThree([card(5, H), card(6, H)], card(7, H), amt).net).toBe(dollars(400));
    expect(resolveTwentyOnePlusThree([card(7, S), card(7, H)], card(7, D), amt).net).toBe(dollars(300));
    expect(resolveTwentyOnePlusThree([card(5, S), card(6, H)], card(7, D), amt).net).toBe(dollars(100));
    expect(resolveTwentyOnePlusThree([card(2, S), card(9, S)], card(13, S), amt).net).toBe(dollars(50));
    // A-2-3 is a straight; A-K-Q is a straight; A-K-2 is not.
    expect(resolveTwentyOnePlusThree([card(14, S), card(2, H)], card(3, D), amt).net).toBe(dollars(100));
    expect(resolveTwentyOnePlusThree([card(14, S), card(13, H)], card(12, D), amt).net).toBe(dollars(100));
    expect(resolveTwentyOnePlusThree([card(14, S), card(13, H)], card(2, D), amt).net).toBe(0);
  });

  it('Lucky Ladies grades twenty, and only twenty', () => {
    expect(resolveLuckyLadies([card(12, H), card(12, H)], amt, true).net).toBe(dollars(10_000));
    expect(resolveLuckyLadies([card(12, H), card(12, H)], amt, false).net).toBe(dollars(2000));
    expect(resolveLuckyLadies([card(13, S), card(13, S)], amt, false).net).toBe(dollars(250));
    expect(resolveLuckyLadies([card(13, S), card(12, S)], amt, false).net).toBe(dollars(100));
    expect(resolveLuckyLadies([card(13, S), card(12, H)], amt, false).net).toBe(dollars(40));
    // Soft twenty counts. Ace-nine is twenty and the bet pays on it.
    expect(resolveLuckyLadies([card(14, S), card(9, H)], amt, false).net).toBe(dollars(40));
    expect(resolveLuckyLadies([card(13, S), card(9, H)], amt, false).net).toBe(0);
  });

  it('Royal Match wants a suit, and pays more for the royal couple', () => {
    expect(resolveRoyalMatch([card(13, H), card(12, H)], amt).net).toBe(dollars(250));
    expect(resolveRoyalMatch([card(3, H), card(9, H)], amt).net).toBe(dollars(25));
    expect(resolveRoyalMatch([card(3, H), card(9, S)], amt).net).toBe(0);
  });

  it('Bust It scales with how many cards it took', () => {
    const five = [card(2), card(3), card(4), card(5), card(10)];
    expect(resolveBustIt(five, true, amt).net).toBe(dollars(80));
    expect(resolveBustIt(five.slice(0, 3), true, amt).net).toBe(dollars(10));
    expect(resolveBustIt(five, false, amt).net).toBe(0);
    // A dealer who does not bust pays nothing, however many cards it took.
    expect(resolveBustIt([...five, card(2), card(2), card(2)], false, amt).net).toBe(0);
  });

  it('Super Sevens pays the third card only when there is one', () => {
    expect(resolveSuperSevens([card(7, S), card(7, S)], card(7, S), amt).net).toBe(dollars(50_000));
    expect(resolveSuperSevens([card(7, S), card(7, H)], card(7, D), amt).net).toBe(dollars(5000));
    expect(resolveSuperSevens([card(7, S), card(7, S)], undefined, amt).net).toBe(dollars(1000));
    expect(resolveSuperSevens([card(7, S), card(7, H)], undefined, amt).net).toBe(dollars(500));
    expect(resolveSuperSevens([card(7, S), card(9, H)], undefined, amt).net).toBe(dollars(30));
    expect(resolveSuperSevens([card(9, S), card(7, H)], undefined, amt).net).toBe(0);
  });

  it('settles at the deal, and pays into the bankroll there', () => {
    let t = withCards([[8, S], [10, H], [8, S], [9, C]], {
      sideBets: { ...defaultRules().sideBets, PERFECT_PAIRS: true },
    });
    t = bet(t, dollars(10));
    const withSide = setSideBet(t, 'A', 'PERFECT_PAIRS', dollars(10));
    if (!withSide.ok) throw new Error(withSide.reason);
    t = withSide.table;
    const start = t.seats[0].bankroll;
    t = must(deal(t, rng()));
    // Stake out for both bets, then $250 of winnings and the $10 stake back.
    expect(t.seats[0].pendingSideBets[0].net).toBe(dollars(250));
    expect(t.seats[0].bankroll).toBe(start - dollars(20) + dollars(260));
  });

  /*
   * Lucky Ladies' top line needs the dealer's natural, which is not known when
   * the rest of the bet is graded — so the difference is recorded at grade
   * time and paid at settlement. Recomputing it from the hand instead loses
   * the jackpot to a split, because by then the second queen is on another
   * hand and the first has drawn to it.
   */
  it('pays the Lucky Ladies jackpot even when the pair was split', () => {
    let t = withCards(
      // ENHC deals player, dealer, player and stops; the two split cards come
      // next, and the dealer's second card is the sixth off the shoe.
      [[12, H], [14, S], [12, H], [9, S], [9, D], [13, C]],
      {
        holeCard: 'ENHC',
        insurance: false,
        sideBets: { ...defaultRules().sideBets, LUCKY_LADIES: true },
      },
    );
    t = bet(t, dollars(10));
    const withSide = setSideBet(t, 'A', 'LUCKY_LADIES', dollars(10));
    if (!withSide.ok) throw new Error(withSide.reason);
    t = must(deal(withSide.table, rng()));

    // Two queens of hearts: the 200:1 line is paid now, the difference to
    // 1000:1 is recorded against the dealer's hand.
    expect(t.seats[0].pendingSideBets[0].net).toBe(dollars(2000));
    expect(t.seats[0].pendingSideBets[0].jackpot).toBe(dollars(8000));

    t = must(split(t));
    t = must(stand(t));
    t = must(stand(t));
    t = dealerPlayOut(t);
    const { table: settled } = settle(t);

    // The dealer's ace pairs with the king under ENHC: a natural.
    expect(settled.dealer.outcome).toBe('BLACKJACK');
    expect(settled.seats[0].pendingSideBets[0].net).toBe(dollars(10_000));
  });

  /*
   * The ledger has to be able to say where the money went. A hand that loses
   * its wager and hits Perfect Pairs shows a positive session net beside a
   * hundred-percent loss rate, and only the split figures make that legible.
   */
  it('books a side bet’s result apart from the hand’s', () => {
    let t = withCards([[8, S], [10, H], [8, S], [9, C]], {
      sideBets: { ...defaultRules().sideBets, PERFECT_PAIRS: true },
    });
    t = bet(t, dollars(10));
    const withSide = setSideBet(t, 'A', 'PERFECT_PAIRS', dollars(10));
    if (!withSide.ok) throw new Error(withSide.reason);
    t = must(deal(withSide.table, rng()));
    t = must(stand(t));
    t = dealerPlayOut(t);
    const { table: settled } = settle(t);
    const stats = settled.seats[0].stats;

    // A perfect pair pays 25:1; sixteen against nineteen loses.
    expect(stats.sideNet).toBe(dollars(250));
    expect(settled.seats[0].hands[0].net).toBe(-dollars(10));
    expect(stats.net).toBe(dollars(250) - dollars(10));
    expect(stats.insuranceNet).toBe(0);
  });

  it('books insurance apart from the hand too', () => {
    let t = bet(withCards([[9, S], [14, H], [7, D], [13, C]]), dollars(10));
    t = must(deal(t, rng()));
    t = must(takeInsurance(t, 'A', dollars(5)));
    t = must(closeOffers(t));
    t = dealerPlayOut(t);
    const { table: settled } = settle(t);
    const stats = settled.seats[0].stats;
    expect(stats.insuranceNet).toBe(dollars(10));
    expect(stats.sideNet).toBe(0);
    // Insurance won exactly what the hand lost, which is the whole point of it.
    expect(stats.net).toBe(0);
  });

  it('caps a side bet at the main wager', () => {
    let t = withCards([], { sideBets: { ...defaultRules().sideBets, PERFECT_PAIRS: true } });
    t = bet(t, dollars(10));
    expect(setSideBet(t, 'A', 'PERFECT_PAIRS', dollars(11))).toMatchObject({ ok: false });
  });

  /*
   * The cap has to hold when the *main* bet moves, not only when the side bet
   * does. Betting the maximum on both and then dropping the hand to the table
   * minimum would otherwise leave a seventeen-percent bet twenty times the
   * size of a half-percent one, which is the exact shape the cap exists to
   * prevent.
   */
  it('brings a side bet down with the wager it is capped against', () => {
    let t = withCards([], { sideBets: { ...defaultRules().sideBets, LUCKY_LADIES: true } });
    t = bet(t, dollars(100));
    const withSide = setSideBet(t, 'A', 'LUCKY_LADIES', dollars(100));
    if (!withSide.ok) throw new Error(withSide.reason);
    t = withSide.table;

    const lowered = setBet(t, 'A', dollars(5));
    if (!lowered.ok) throw new Error(lowered.reason);
    expect(lowered.table.seats[0].pendingSideBets[0].amount).toBe(dollars(5));

    // Clearing the circle takes the side bets with it rather than leaving
    // chips on the felt that the deal would silently ignore.
    const cleared = setBet(lowered.table, 'A', 0);
    if (!cleared.ok) throw new Error(cleared.reason);
    expect(cleared.table.seats[0].pendingSideBets).toHaveLength(0);
  });

  it('refuses a side bet the table does not book', () => {
    let t = withCards([], { sideBets: { ...defaultRules().sideBets, LUCKY_LADIES: false } });
    t = bet(t, dollars(10));
    expect(setSideBet(t, 'A', 'LUCKY_LADIES', dollars(5))).toMatchObject({ ok: false });
  });
});

/* ------------------------------------------------------------------ *
 * Betting rules
 * ------------------------------------------------------------------ */

describe('the betting circle', () => {
  it('enforces the table minimum and maximum', () => {
    const t = withCards([]);
    expect(setBet(t, 'A', dollars(1))).toMatchObject({ ok: false });
    expect(setBet(t, 'A', dollars(5000))).toMatchObject({ ok: false });
    expect(setBet(t, 'A', dollars(5))).toMatchObject({ ok: true });
    // Zero clears the circle and is always allowed.
    expect(setBet(t, 'A', 0)).toMatchObject({ ok: true });
  });

  it('will not bet more than the bankroll', () => {
    const t = createTable(defaultRules(), rng(), { bankroll: dollars(20) });
    expect(setBet(t, 'A', dollars(25))).toMatchObject({ ok: false });
  });

  it('is closed once the cards are out', () => {
    let t = bet(withCards([[10, S], [10, H], [10, D], [9, C]]));
    t = must(deal(t, rng()));
    expect(setBet(t, 'A', dollars(20))).toMatchObject({ ok: false });
  });
});

/* ------------------------------------------------------------------ *
 * Round lifecycle
 * ------------------------------------------------------------------ */

describe('between rounds', () => {
  it('clears the felt and leaves the wager up for a re-bet', () => {
    let t = bet(withCards([[10, S], [10, H], [10, D], [9, C]]), dollars(25));
    t = must(deal(t, rng()));
    t = must(stand(t));
    t = dealerPlayOut(t);
    t = settle(t).table;
    t = must(nextRound(t));
    expect(t.phase).toBe('BETTING');
    expect(t.seats[0].hands).toHaveLength(0);
    expect(t.seats[0].pendingBet).toBe(dollars(25));
    expect(t.dealer.cards).toHaveLength(0);
  });

  it('takes a wager down that the bankroll can no longer cover', () => {
    let t = createTable(defaultRules(), rng(), { bankroll: dollars(30) });
    const stacked: Card[] = ([[10, S], [10, H], [6, D], [9, C], [5, S]] as Array<[Rank, Suit]>).map(([r, s], i) => ({ rank: r, suit: s, id: 700_000 + i }));
    t = { ...t, shoe: { ...t.shoe, cards: [...stacked, ...t.shoe.cards] } };
    t = bet(t, dollars(25));
    t = must(deal(t, rng()));
    t = must(stand(t));
    t = dealerPlayOut(t);
    t = settle(t).table;
    t = must(nextRound(t));
    expect(t.seats[0].bankroll).toBeLessThan(dollars(25));
    expect(t.seats[0].pendingBet).toBe(0);
  });

  it('refuses to start a new round mid-hand', () => {
    let t = bet(withCards([[10, S], [10, H], [10, D], [9, C]]));
    t = must(deal(t, rng()));
    expect(nextRound(t)).toMatchObject({ ok: false });
  });
});

/* ------------------------------------------------------------------ *
 * Rules
 * ------------------------------------------------------------------ */

describe('rule sets', () => {
  it('every preset is internally consistent', () => {
    for (const preset of RULE_PRESETS) {
      expect(preset.rules.decks).toBeGreaterThan(0);
      expect(preset.rules.penetration).toBeGreaterThan(0.4);
      expect(preset.rules.penetration).toBeLessThanOrEqual(0.9);
      expect(preset.rules.minBet).toBeLessThan(preset.rules.maxBet);
      expect(presetById(preset.id)).toBe(preset);
    }
  });

  it('estimates an edge in the range these games actually run at', () => {
    for (const preset of RULE_PRESETS) {
      const edge = estimateHouseEdge(preset.rules);
      expect(edge).toBeGreaterThan(-0.1);
      expect(edge).toBeLessThan(2.5);
    }
  });

  it('prices 6:5 as the disaster it is', () => {
    const base = presetById('vegas-strip').rules;
    const bad = { ...base, blackjackPays: '6:5' as const };
    expect(estimateHouseEdge(bad) - estimateHouseEdge(base)).toBeCloseTo(1.39, 2);
  });

  it('writes the shorthand a player would read off the felt', () => {
    expect(rulesShorthand(presetById('vegas-strip').rules)).toContain('6D');
    expect(rulesShorthand(presetById('vegas-strip').rules)).toContain('S17');
    expect(rulesShorthand(presetById('european').rules)).toContain('ENHC');
  });
});
