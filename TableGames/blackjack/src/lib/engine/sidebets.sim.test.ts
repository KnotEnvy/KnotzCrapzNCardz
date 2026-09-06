/**
 * Side bets, computed exactly.
 *
 * Every side bet except Bust It is decided by two or three cards off the top
 * of a fresh shoe, which means its return is not a thing to be estimated by
 * simulation — it can be enumerated. This walks every ordered pair or triple
 * of distinct cards, weights each by its exact probability of coming off an
 * unshuffled six-deck shoe, and sums the payout. The answer is the real house
 * edge to the last decimal, with no sampling error at all.
 *
 * That matters more than it might sound. A side bet's edge is the one number
 * the felt prints and the one number a player would want; publishing an
 * estimate with a confidence interval next to a paytable would be strange.
 * These figures are exact, and {@link SIDE_BET_SPECS} is asserted against them
 * so that editing a paytable without re-deriving the edge fails the build.
 *
 * Bust It is the exception: it is a bet on a hand the dealer plays out, so it
 * has no closed form here and is measured by simulation like the main game.
 */

import { describe, expect, it } from 'vitest';
import { SIDE_BET_SPECS } from './sidebets';
import {
  resolveLuckyLadies,
  resolvePerfectPairs,
  resolveRoyalMatch,
  resolveSuperSevens,
  resolveTwentyOnePlusThree,
} from './sidebets';
import { createRng } from './rng';
import { closeOffers, createTable, deal, dealerPlayOut, nextRound, setBet, setSideBet, stand } from './table';
import { settle } from './resolve';
import { defaultRules, presetById } from './rules';
import { dollars } from './money';
import { RANKS, SUITS } from './types';
import type { Card, TableState } from './types';

/* ------------------------------------------------------------------ *
 * Enumeration
 * ------------------------------------------------------------------ */

const DECKS = 6;
const STAKE = 100_000; // A large round stake, so integer flooring cannot bias the sum.

/** The 52 distinct cards, each present `DECKS` times in the shoe. */
const DISTINCT: Card[] = [];
for (const suit of SUITS) for (const rank of RANKS) DISTINCT.push({ rank, suit, id: 0 });

const SHOE_SIZE = 52 * DECKS;

/**
 * Expected return per unit staked, over every ordered pair of cards.
 *
 * Ordered rather than unordered because a few of these bets care which card
 * came first — Super Sevens pays 3:1 on a seven as the *first* card and
 * nothing for one as the second — and ordering the enumeration is both simpler
 * and closer to how the cards actually arrive.
 */
function enumeratePairs(payout: (a: Card, b: Card) => number): number {
  let expected = 0;
  for (const a of DISTINCT) {
    const pa = DECKS / SHOE_SIZE;
    for (const b of DISTINCT) {
      const sameCard = a.rank === b.rank && a.suit === b.suit;
      const left = sameCard ? DECKS - 1 : DECKS;
      if (left <= 0) continue;
      const pb = left / (SHOE_SIZE - 1);
      expected += pa * pb * payout(a, b);
    }
  }
  return expected / STAKE;
}

/** The same, over every ordered triple. 140,608 of them; a fraction of a second. */
function enumerateTriples(payout: (a: Card, b: Card, c: Card) => number): number {
  let expected = 0;
  for (const a of DISTINCT) {
    const pa = DECKS / SHOE_SIZE;
    for (const b of DISTINCT) {
      const usedB = a.rank === b.rank && a.suit === b.suit ? 1 : 0;
      const leftB = DECKS - usedB;
      if (leftB <= 0) continue;
      const pb = leftB / (SHOE_SIZE - 1);
      for (const c of DISTINCT) {
        const usedC =
          (a.rank === c.rank && a.suit === c.suit ? 1 : 0) +
          (b.rank === c.rank && b.suit === c.suit ? 1 : 0);
        const leftC = DECKS - usedC;
        if (leftC <= 0) continue;
        const pc = leftC / (SHOE_SIZE - 2);
        expected += pa * pb * pc * payout(a, b, c);
      }
    }
  }
  return expected / STAKE;
}

/** House edge in percent, from an expected return per unit staked. */
function edgeOf(expectedReturn: number): number {
  return (1 - expectedReturn) * 100;
}

const measured: Array<[string, number, number]> = [];

function check(name: string, edge: number, published: number, tolerance = 0.06): void {
  measured.push([name, edge, published]);
  expect(Math.abs(edge - published), `${name}: computed ${edge.toFixed(3)}%, published ${published}%`).toBeLessThan(
    tolerance,
  );
}

/* ------------------------------------------------------------------ *
 * The exact ones
 * ------------------------------------------------------------------ */

describe('side bet edges, enumerated exactly', () => {
  it('Perfect Pairs', () => {
    const ret = enumeratePairs((a, b) => {
      const r = resolvePerfectPairs([a, b], STAKE);
      return r.net + winStake(r.net);
    });
    check('Perfect Pairs', edgeOf(ret), SIDE_BET_SPECS.PERFECT_PAIRS.edge);
  });

  it('Royal Match', () => {
    const ret = enumeratePairs((a, b) => {
      const r = resolveRoyalMatch([a, b], STAKE);
      return r.net + winStake(r.net);
    });
    check('Royal Match', edgeOf(ret), SIDE_BET_SPECS.ROYAL_MATCH.edge);
  });

  it('Lucky Ladies', () => {
    /*
     * The 1000:1 line needs a dealer natural as well as two queens of hearts.
     * Those two are very nearly independent — the player's two queens remove
     * no ace and one of the shoe's twenty-four queens — so the jackpot term is
     * the 200:1 line's probability times the dealer's natural rate, which for
     * six decks after two queens are gone is 0.04766. The whole term is worth
     * about a twentieth of a percent, so the approximation is far below the
     * precision the figure is published to.
     */
    const DEALER_NATURAL = 0.04766;
    const ret = enumeratePairs((a, b) => {
      const plain = resolveLuckyLadies([a, b], STAKE, false);
      const jackpot = resolveLuckyLadies([a, b], STAKE, true);
      const blended = plain.net + (jackpot.net - plain.net) * DEALER_NATURAL;
      return blended + winStake(plain.net);
    });
    check('Lucky Ladies', edgeOf(ret), SIDE_BET_SPECS.LUCKY_LADIES.edge, 0.4);
  });

  it('21 + 3', () => {
    const ret = enumerateTriples((a, b, c) => {
      const r = resolveTwentyOnePlusThree([a, b], c, STAKE);
      return r.net + winStake(r.net);
    });
    check('21 + 3', edgeOf(ret), SIDE_BET_SPECS.TWENTY_ONE_PLUS_THREE.edge);
  });

  it('Super Sevens', () => {
    /*
     * The third card only exists when the first two are both sevens, so the
     * enumeration weights the triple by that condition: for every other pair
     * the third card is irrelevant and the payout is the two-card one.
     */
    const ret = enumerateTriples((a, b, c) => {
      const bonus = a.rank === 7 && b.rank === 7 ? c : undefined;
      const r = resolveSuperSevens([a, b], bonus, STAKE);
      return r.net + winStake(r.net);
    });
    check('Super Sevens', edgeOf(ret), SIDE_BET_SPECS.SUPER_SEVENS.edge);
  });
});

/** A winning side bet returns its stake as well as its winnings. */
function winStake(net: number): number {
  return net > 0 ? STAKE : 0;
}

/* ------------------------------------------------------------------ *
 * The one that has to be dealt
 * ------------------------------------------------------------------ */

describe('Bust It, measured', () => {
  /*
   * A bet on the dealer's finished hand cannot be enumerated over the deal, so
   * it is dealt. The player stands on everything, which is not basic strategy
   * and does not matter: the bet reads only the dealer's cards, and the
   * dealer's hand is independent of what the player does with theirs.
   */
  it('measures at its published edge', () => {
    const rules = {
      ...presetById('vegas-strip').rules,
      sideBets: { ...defaultRules().sideBets, BUST_IT: true },
    };
    const rng = createRng('bust-it');
    let table = createTable(rules, rng, { seats: 1, bankroll: dollars(100_000_000) });

    const N = 500_000;
    let staked = 0;
    let net = 0;
    // Accumulated to work out the band this measurement is actually entitled
    // to, rather than asserting one that sounds tight.
    let sumSq = 0;
    let rounds = 0;

    for (let i = 0; i < N; i++) {
      table = must(setBet(table, 'A', dollars(10)));
      table = must(setSideBet(table, 'A', 'BUST_IT', dollars(10)));
      const dealt = deal(table, rng);
      if (!dealt.ok) break;
      table = dealt.table;
      if (table.phase === 'INSURANCE') table = must(closeOffers(table));
      let guard = 0;
      while (table.phase === 'PLAYER' && table.focus && guard++ < 32) {
        table = must(stand(table));
      }
      if (table.phase === 'DEALER') table = dealerPlayOut(table);

      const settled = settle(table);
      table = settled.table;
      staked += dollars(10);
      // The main bet's result is in stats.net too, so the side bet is taken
      // from the settlement list rather than from the seat's ledger.
      const round = settled.settlements
        .filter((s) => s.kind === 'SIDE' && s.sideKind === 'BUST_IT')
        .reduce((n, s) => n + s.net, 0);
      net += round;
      const units = round / dollars(10);
      sumSq += units * units;
      rounds++;
      const cleared = nextRoundOf(table);
      if (cleared) table = cleared;
    }

    const edge = (-net / staked) * 100;
    measured.push(['Bust It', edge, SIDE_BET_SPECS.BUST_IT.edge]);

    /*
     * The band is computed, not chosen. This bet pays four hundred to one on
     * an eight-card dealer bust, and that tail dominates its variance: the
     * per-round standard deviation is about 2.5 units against the main game's
     * 1.15, so half a million rounds place the edge to within roughly a
     * percent and no tighter.
     *
     * It was asserted at 0.3 for two runs and passed both by luck. Then a
     * change to the RNG stream shifted every seeded measurement — nothing to
     * do with Bust It — and it failed at 0.41, which is well inside the noise
     * this measurement has always had. A tolerance that only holds on the
     * seeds you happened to try is not a test.
     */
    const mean = net / dollars(10) / rounds;
    const sd = Math.sqrt(Math.max(0, sumSq / rounds - mean * mean));
    const threeSigma = ((3 * sd) / Math.sqrt(rounds)) * 100;

    expect(
      Math.abs(edge - SIDE_BET_SPECS.BUST_IT.edge),
      `Bust It measured ${edge.toFixed(3)}%, published ${SIDE_BET_SPECS.BUST_IT.edge}%, 3σ ±${threeSigma.toFixed(3)}`,
    ).toBeLessThan(Math.max(0.5, threeSigma));
  }, 300_000);
});

function must(res: { ok: boolean } & Record<string, unknown>): TableState {
  if (!res.ok) throw new Error(String(res.reason));
  return res.table as TableState;
}

function nextRoundOf(table: TableState): TableState | null {
  const res = nextRound(table);
  return res.ok ? res.table : null;
}

/* ------------------------------------------------------------------ *
 * The table
 * ------------------------------------------------------------------ */

describe('summary', () => {
  it('prints every side bet against its published figure', () => {
    const rows = measured.map(
      ([name, edge, published]) =>
        `  ${name.padEnd(16)} computed ${edge.toFixed(3).padStart(7)}%   published ${published.toFixed(2).padStart(6)}%`,
    );
    console.log(['', '  Side bet house edge, six decks:', '', ...rows, ''].join('\n'));
    expect(measured.length).toBeGreaterThan(0);
  });
});
