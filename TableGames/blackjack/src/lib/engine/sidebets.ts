/**
 * Side bets.
 *
 * Six of them, each with its real paytable and each resolving the moment the
 * cards it reads are on the felt — which for five of the six is immediately
 * after the deal, before insurance is even offered. That timing is not a
 * shortcut; it is how they are dealt. A perfect pair is decided by the two
 * cards in front of you and nothing that happens afterwards can change it.
 *
 * They are here because a modern blackjack table has them and a game that
 * pretends otherwise is not the game. They are also, every one of them, a
 * significantly worse bet than the hand they sit next to: the main game runs
 * around half a percent and the friendliest of these runs around three. The
 * UI says so on the chip — {@link SIDE_BET_SPECS} carries the edge, and the
 * betting circle prints it — because the honest version of offering a bad bet
 * is offering it with the number attached.
 *
 * Every edge quoted below is *computed*, not looked up, and it is computed for
 * these paytables at six decks rather than copied from a chart describing
 * somebody else's. `sidebets.sim.test.ts` enumerates every ordered pair or
 * triple of cards off a fresh six-deck shoe, weights each by its exact
 * probability and sums the payout — so five of the six figures below carry no
 * sampling error at all, and the sixth (Bust It, a bet on a hand the dealer
 * plays out) is measured over four hundred thousand rounds. Editing a paytable
 * without re-deriving its edge fails that test.
 *
 * Bust It's figure is the one with an uncertainty attached, and it is a wide
 * one: the bet pays four hundred to one on an eight-card dealer bust, so its
 * per-round standard deviation is about 2.5 units against the main game's
 * 1.15, and four hundred thousand rounds place it only to within a percent.
 * The 6.92% below is pooled over two million. Treat it as 6.9 ± 0.3, not as a
 * figure of the same kind as the five above it.
 *
 * Two of these are worth a second look if the numbers seem unfamiliar. Perfect
 * Pairs gets *better* with more decks, because a perfect pair needs a second
 * copy of the identical card and a six-deck shoe holds five of them where an
 * eight-deck shoe holds seven — the widely quoted 4.1% is the eight-deck
 * figure for this paytable, and at six decks the same paytable is 6.11%. And
 * published figures for these bets frequently describe a neighbouring
 * paytable; where a remembered number and the enumeration disagreed, the
 * enumeration won.
 */

import { winnings } from './money';
import type { Card, SideBetKind } from './types';
import { RANKS, SUITS } from './types';
import { isRed, rankValue } from './types';

/* ------------------------------------------------------------------ *
 * Specs
 * ------------------------------------------------------------------ */

export interface PayLine {
  label: string;
  /** Winnings ratio as [numerator, denominator]: `[25, 1]` is 25:1. */
  ratio: readonly [number, number];
}

export interface SideBetSpec {
  kind: SideBetKind;
  name: string;
  short: string;
  /** What the bet is, in one line, on the chip's tooltip. */
  blurb: string;
  /** Which cards decide it. */
  reads: string;
  paytable: readonly PayLine[];
  /** House edge in percent, for a six-deck shoe. Asserted by the sim suite. */
  edge: number;
  /** Colour token used on the felt, so each circle is recognisable at a glance. */
  accent: string;
}

export const SIDE_BET_SPECS: Record<SideBetKind, SideBetSpec> = {
  PERFECT_PAIRS: {
    kind: 'PERFECT_PAIRS',
    name: 'Perfect Pairs',
    short: 'PAIRS',
    blurb: 'Your first two cards are a pair.',
    reads: 'Your two cards',
    paytable: [
      { label: 'Perfect pair — same rank and suit', ratio: [25, 1] },
      { label: 'Coloured pair — same rank and colour', ratio: [12, 1] },
      { label: 'Mixed pair — same rank', ratio: [6, 1] },
    ],
    edge: 6.11,
    accent: 'var(--color-side-pairs)',
  },
  TWENTY_ONE_PLUS_THREE: {
    kind: 'TWENTY_ONE_PLUS_THREE',
    name: '21 + 3',
    short: '21+3',
    blurb: 'Your two cards and the dealer’s upcard make a poker hand.',
    reads: 'Your two cards and the dealer’s upcard',
    paytable: [
      { label: 'Suited trips', ratio: [100, 1] },
      { label: 'Straight flush', ratio: [40, 1] },
      { label: 'Three of a kind', ratio: [30, 1] },
      { label: 'Straight', ratio: [10, 1] },
      { label: 'Flush', ratio: [5, 1] },
    ],
    edge: 4.62,
    accent: 'var(--color-side-213)',
  },
  LUCKY_LADIES: {
    kind: 'LUCKY_LADIES',
    name: 'Lucky Ladies',
    short: 'LADIES',
    blurb: 'Your first two cards total twenty. Two queens of hearts is the top.',
    reads: 'Your two cards, and the dealer’s hand for the jackpot',
    paytable: [
      { label: 'Two queens of hearts + dealer blackjack', ratio: [1000, 1] },
      { label: 'Two queens of hearts', ratio: [200, 1] },
      { label: 'Matched 20 — same rank and suit', ratio: [25, 1] },
      { label: 'Suited 20', ratio: [10, 1] },
      { label: 'Any 20', ratio: [4, 1] },
    ],
    edge: 17.63,
    accent: 'var(--color-side-ladies)',
  },
  ROYAL_MATCH: {
    kind: 'ROYAL_MATCH',
    name: 'Royal Match',
    short: 'ROYAL',
    blurb: 'Your first two cards are the same suit.',
    reads: 'Your two cards',
    paytable: [
      { label: 'Royal match — suited king and queen', ratio: [25, 1] },
      { label: 'Any suited pair of cards', ratio: [5, 2] },
    ],
    edge: 6.67,
    accent: 'var(--color-side-royal)',
  },
  BUST_IT: {
    kind: 'BUST_IT',
    name: 'Bust It',
    short: 'BUST',
    blurb: 'The dealer busts — and the more cards it takes, the better.',
    reads: 'The dealer’s finished hand',
    paytable: [
      { label: 'Busts with 8 or more cards', ratio: [400, 1] },
      { label: 'Busts with 7 cards', ratio: [75, 1] },
      { label: 'Busts with 6 cards', ratio: [20, 1] },
      { label: 'Busts with 5 cards', ratio: [8, 1] },
      { label: 'Busts with 4 cards', ratio: [3, 1] },
      { label: 'Busts with 3 cards', ratio: [1, 1] },
    ],
    edge: 6.92,
    accent: 'var(--color-side-bust)',
  },
  SUPER_SEVENS: {
    kind: 'SUPER_SEVENS',
    name: 'Super Sevens',
    short: '7·7·7',
    blurb: 'Sevens. One pays, two pay well, three pay for the trip.',
    reads: 'Your two cards, plus a bonus card if both are sevens',
    paytable: [
      { label: 'Three suited sevens', ratio: [5000, 1] },
      { label: 'Three sevens', ratio: [500, 1] },
      { label: 'Two suited sevens', ratio: [100, 1] },
      { label: 'Two sevens', ratio: [50, 1] },
      { label: 'First card a seven', ratio: [3, 1] },
    ],
    edge: 11.4,
    accent: 'var(--color-side-sevens)',
  },
};

export const SIDE_BET_ORDER: readonly SideBetKind[] = [
  'PERFECT_PAIRS',
  'TWENTY_ONE_PLUS_THREE',
  'ROYAL_MATCH',
  'LUCKY_LADIES',
  'SUPER_SEVENS',
  'BUST_IT',
];

/* ------------------------------------------------------------------ *
 * Resolution
 * ------------------------------------------------------------------ */

/**
 * A resolved side bet. `net` is signed cents including the stake — a loser
 * returns `-amount` and a winner returns the winnings only, because the stake
 * comes back separately and the ledger only ever records the change.
 */
export interface SideBetResult {
  net: number;
  label: string | null;
}

const LOST: SideBetResult = { net: 0, label: null };

function pay(spec: SideBetSpec, index: number, amount: number): SideBetResult {
  const line = spec.paytable[index];
  return { net: winnings(amount, line.ratio[0], line.ratio[1]), label: line.label };
}

/* --- Perfect Pairs --- */

export function resolvePerfectPairs(cards: readonly Card[], amount: number): SideBetResult {
  const spec = SIDE_BET_SPECS.PERFECT_PAIRS;
  const [a, b] = cards;
  if (!a || !b || a.rank !== b.rank) return LOST;
  if (a.suit === b.suit) return pay(spec, 0, amount);
  if (isRed(a) === isRed(b)) return pay(spec, 1, amount);
  return pay(spec, 2, amount);
}

/* --- 21 + 3 --- */

/**
 * Poker on three cards.
 *
 * Aces are high *and* low for the straight, so both A-2-3 and Q-K-A count —
 * that is the standard rule at every table that books this bet, and leaving
 * out the wheel would quietly shave the paytable.
 */
export function resolveTwentyOnePlusThree(
  playerCards: readonly Card[],
  upcard: Card | undefined,
  amount: number,
): SideBetResult {
  const spec = SIDE_BET_SPECS.TWENTY_ONE_PLUS_THREE;
  if (playerCards.length < 2 || !upcard) return LOST;
  const three = [playerCards[0], playerCards[1], upcard];

  const suits = new Set(three.map((c) => c.suit));
  const flush = suits.size === 1;
  const ranks = three.map((c) => c.rank).sort((x, y) => x - y);
  const trips = ranks[0] === ranks[1] && ranks[1] === ranks[2];
  // Ranks run 2..14 with the ace at 14, so the high straight is contiguous
  // already and only the wheel needs its own case.
  const straight =
    (ranks[1] === ranks[0] + 1 && ranks[2] === ranks[1] + 1) ||
    (ranks[0] === 2 && ranks[1] === 3 && ranks[2] === 14);

  if (trips && flush) return pay(spec, 0, amount);
  if (straight && flush) return pay(spec, 1, amount);
  if (trips) return pay(spec, 2, amount);
  if (straight) return pay(spec, 3, amount);
  if (flush) return pay(spec, 4, amount);
  return LOST;
}

/* --- Lucky Ladies --- */

function isQueenOfHearts(card: Card): boolean {
  return card.rank === 12 && card.suit === 'hearts';
}

/**
 * Twenty on two cards.
 *
 * The jackpot line needs the dealer's hand, which is not known when the rest
 * of the bet resolves. Rather than hold the whole bet back for it, the payout
 * is computed at deal time from the two player cards and *upgraded* at
 * settlement if the dealer turns out to have a natural — see
 * {@link luckyLadiesJackpotUpgrade}. `dealerBlackjack` is passed here for the
 * simulation, which knows both at once.
 */
export function resolveLuckyLadies(
  cards: readonly Card[],
  amount: number,
  dealerBlackjack: boolean,
): SideBetResult {
  const spec = SIDE_BET_SPECS.LUCKY_LADIES;
  const [a, b] = cards;
  if (!a || !b) return LOST;
  if (rankValue(a.rank) + rankValue(b.rank) !== 20) return LOST;

  if (isQueenOfHearts(a) && isQueenOfHearts(b)) {
    return dealerBlackjack ? pay(spec, 0, amount) : pay(spec, 1, amount);
  }
  if (a.rank === b.rank && a.suit === b.suit) return pay(spec, 2, amount);
  if (a.suit === b.suit) return pay(spec, 3, amount);
  return pay(spec, 4, amount);
}

/**
 * The difference between the 200:1 line and the 1000:1 line, applied once the
 * dealer's natural is known. Zero for every hand that is not two queens of
 * hearts, which is all but one in about seven thousand.
 */
export function luckyLadiesJackpotUpgrade(cards: readonly Card[], amount: number): number {
  const [a, b] = cards;
  if (!a || !b || !isQueenOfHearts(a) || !isQueenOfHearts(b)) return 0;
  const spec = SIDE_BET_SPECS.LUCKY_LADIES;
  return winnings(amount, spec.paytable[0].ratio[0], spec.paytable[0].ratio[1]) -
    winnings(amount, spec.paytable[1].ratio[0], spec.paytable[1].ratio[1]);
}

/* --- Royal Match --- */

export function resolveRoyalMatch(cards: readonly Card[], amount: number): SideBetResult {
  const spec = SIDE_BET_SPECS.ROYAL_MATCH;
  const [a, b] = cards;
  if (!a || !b || a.suit !== b.suit) return LOST;
  const ranks = new Set([a.rank, b.rank]);
  if (ranks.has(12) && ranks.has(13)) return pay(spec, 0, amount);
  return pay(spec, 1, amount);
}

/* --- Bust It --- */

/**
 * The only side bet that cannot resolve at deal time, because it is a bet on
 * the dealer's finished hand. It waits in the circle through the whole round.
 */
export function resolveBustIt(
  dealerCards: readonly Card[],
  dealerBusted: boolean,
  amount: number,
): SideBetResult {
  if (!dealerBusted) return LOST;
  const spec = SIDE_BET_SPECS.BUST_IT;
  const n = dealerCards.length;
  if (n >= 8) return pay(spec, 0, amount);
  if (n === 7) return pay(spec, 1, amount);
  if (n === 6) return pay(spec, 2, amount);
  if (n === 5) return pay(spec, 3, amount);
  if (n === 4) return pay(spec, 4, amount);
  if (n === 3) return pay(spec, 5, amount);
  return LOST;
}

/* --- Super Sevens --- */

/**
 * Sevens.
 *
 * The three-card lines need a third card, and the player has not decided
 * whether to take one yet. The table's answer, and the one used here, is that
 * a third card comes off the shoe *for the side bet* the moment the first two
 * are both sevens — it is turned over next to the circle, it counts against
 * the shoe, and it is the card the next player would otherwise have received.
 * See {@link superSevensNeedsBonus}; `table.ts` draws it during the deal.
 */
export function superSevensNeedsBonus(cards: readonly Card[]): boolean {
  return cards.length >= 2 && cards[0].rank === 7 && cards[1].rank === 7;
}

export function resolveSuperSevens(
  cards: readonly Card[],
  bonus: Card | undefined,
  amount: number,
): SideBetResult {
  const spec = SIDE_BET_SPECS.SUPER_SEVENS;
  const [a, b] = cards;
  if (!a) return LOST;
  if (a.rank !== 7) return LOST;

  if (b?.rank === 7) {
    if (bonus?.rank === 7) {
      const suited = a.suit === b.suit && b.suit === bonus.suit;
      return pay(spec, suited ? 0 : 1, amount);
    }
    return pay(spec, a.suit === b.suit ? 2 : 3, amount);
  }
  return pay(spec, 4, amount);
}

/* ------------------------------------------------------------------ *
 * What a side bet costs at *this* table
 * ------------------------------------------------------------------ */

/**
 * The house edge of a side bet, enumerated exactly for a given shoe size.
 *
 * `SIDE_BET_SPECS[kind].edge` is the six-deck figure, and for five rounds of
 * review it was the only figure — printed on the felt's chip tooltip and in
 * the rules editor with no qualifier, inches from the deck selector. That is
 * not a rounding error. Perfect Pairs needs a second copy of an identical
 * card, so at **one deck it is impossible**: the bet pays only its 12:1 and
 * 6:1 lines and the edge is 47.06%, not the 6.11% the felt printed. A game
 * whose stated argument is "the honest way to offer a bad bet is to offer it
 * with the number attached" was attaching a number eight times too kind.
 *
 * So the number is computed for the table in front of the player. Five of the
 * six are decided by two or three cards off the top of a fresh shoe, which
 * makes them a finite sum rather than something to estimate: walk every
 * ordered pair or triple of distinct cards, weight each by its exact
 * probability, add up the payout. `sidebets.sim.test.ts` asserts this against
 * the published six-deck figures, so the same code that prints on the felt is
 * the code the suite checks.
 *
 * Bust It is the exception and always has been: it is a bet on a hand the
 * dealer plays out, so it has no closed form here. Its figure is measured at
 * six decks and returned unchanged — {@link sideBetEdgeIsExact} says which is
 * which, so the UI can qualify it rather than overstate it.
 */
const EDGE_CACHE = new Map<string, number>();

/** A large round stake, so integer flooring in the payouts cannot bias the sum. */
const ENUM_STAKE = 100_000;

/** True when this kind's edge is enumerated rather than measured. */
export function sideBetEdgeIsExact(kind: SideBetKind): boolean {
  return kind !== 'BUST_IT';
}

export function sideBetEdge(kind: SideBetKind, decks: number): number {
  if (!sideBetEdgeIsExact(kind)) return SIDE_BET_SPECS[kind].edge;
  const key = `${kind}:${decks}`;
  const hit = EDGE_CACHE.get(key);
  if (hit !== undefined) return hit;
  const edge = (1 - expectedReturn(kind, decks)) * 100;
  EDGE_CACHE.set(key, edge);
  return edge;
}

/** The 52 distinct cards. Each appears `decks` times in a fresh shoe. */
const DISTINCT: Card[] = (() => {
  const out: Card[] = [];
  for (const suit of SUITS) for (const rank of RANKS) out.push({ rank, suit, id: 0 });
  return out;
})();

/** A winning side bet returns its stake as well as its winnings. */
function withStake(net: number): number {
  return net + (net > 0 ? ENUM_STAKE : 0);
}

function expectedReturn(kind: SideBetKind, decks: number): number {
  const size = 52 * decks;
  const same = (a: Card, b: Card) => a.rank === b.rank && a.suit === b.suit;

  /*
   * The 1000:1 Lucky Ladies line needs a dealer natural as well as the
   * player's two queens of hearts. The two are very nearly independent — the
   * player's cards remove no ace and one of the shoe's queens — so the
   * jackpot term is the 200:1 line's probability times the dealer's natural
   * rate. The whole term is worth about a twentieth of a percent, well below
   * the precision this figure is quoted to, and it is the one number here
   * that is not exact.
   */
  const dealerNatural = (2 * (4 * decks) * (16 * decks)) / ((size - 2) * (size - 3));

  const pairPayout = (a: Card, b: Card): number => {
    switch (kind) {
      case 'PERFECT_PAIRS':
        return withStake(resolvePerfectPairs([a, b], ENUM_STAKE).net);
      case 'ROYAL_MATCH':
        return withStake(resolveRoyalMatch([a, b], ENUM_STAKE).net);
      case 'LUCKY_LADIES': {
        const plain = resolveLuckyLadies([a, b], ENUM_STAKE, false).net;
        const jackpot = resolveLuckyLadies([a, b], ENUM_STAKE, true).net;
        return plain + (jackpot - plain) * dealerNatural + (plain > 0 ? ENUM_STAKE : 0);
      }
      default:
        return 0;
    }
  };

  const triplePayout = (a: Card, b: Card, c: Card): number => {
    if (kind === 'TWENTY_ONE_PLUS_THREE') {
      return withStake(resolveTwentyOnePlusThree([a, b], c, ENUM_STAKE).net);
    }
    // Super Sevens: the third card only exists when the first two are sevens.
    const bonus = a.rank === 7 && b.rank === 7 ? c : undefined;
    return withStake(resolveSuperSevens([a, b], bonus, ENUM_STAKE).net);
  };

  const needsThree = kind === 'TWENTY_ONE_PLUS_THREE' || kind === 'SUPER_SEVENS';
  let expected = 0;

  for (const a of DISTINCT) {
    const pa = decks / size;
    for (const b of DISTINCT) {
      const leftB = decks - (same(a, b) ? 1 : 0);
      if (leftB <= 0) continue;
      const pb = leftB / (size - 1);
      if (!needsThree) {
        expected += pa * pb * pairPayout(a, b);
        continue;
      }
      for (const c of DISTINCT) {
        const leftC = decks - (same(a, c) ? 1 : 0) - (same(b, c) ? 1 : 0);
        if (leftC <= 0) continue;
        const pc = leftC / (size - 2);
        expected += pa * pb * pc * triplePayout(a, b, c);
      }
    }
  }

  return expected / ENUM_STAKE;
}

/* ------------------------------------------------------------------ *
 * Display helpers
 * ------------------------------------------------------------------ */

export function ratioLabel(r: readonly [number, number]): string {
  return `${r[0]}:${r[1]}`;
}

/** The best line on a paytable, for the circle's "up to" label. */
export function topLine(kind: SideBetKind): PayLine {
  return SIDE_BET_SPECS[kind].paytable[0];
}

/** Every kind this table books, in a stable display order. */
export function enabledSideBets(enabled: Record<SideBetKind, boolean>): SideBetKind[] {
  return SIDE_BET_ORDER.filter((k) => enabled[k]);
}
