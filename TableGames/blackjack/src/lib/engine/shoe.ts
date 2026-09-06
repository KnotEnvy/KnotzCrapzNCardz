/**
 * The shoe.
 *
 * A real shoe is a stack of cards in a fixed order with a plastic cut card
 * pushed into it, and this is that and nothing more. Cards come off the front;
 * when the cut card surfaces, the round finishes and the shoe is remade.
 *
 * Three decisions worth knowing:
 *
 *   - The shuffle is a Fisher–Yates over the whole shoe, not a per-deck
 *     shuffle stitched together. A casino's shuffle machine approximates a
 *     uniform permutation and a card counter's entire edge rests on the shoe
 *     being one, so the simulation has to be dealing from a real one.
 *
 *   - The cut card is placed at a *fraction* of the shoe rather than a fixed
 *     number of cards, because that is how penetration is quoted and how it
 *     matters. 75% of a six-deck shoe is a countable game; 50% is not, and the
 *     difference is a slider in the setup screen rather than a constant here.
 *
 *   - Dealing advances a pointer; it does not shift a queue. The engine is
 *     immutable, so shifting would copy the tail of a 416-card array on every
 *     card. The array is built once by the shuffle and read-only thereafter,
 *     and `pos` is the only thing a deal changes. That took the simulation
 *     from milliseconds a round to microseconds.
 *
 *   - A shoe that runs out mid-round reshuffles rather than raising. See
 *     {@link reshuffleKeeping}.
 */

import { createRng, seedFrom, type Rng } from './rng';
import type { Card, ShoeState } from './types';
import { RANKS, SUITS } from './types';

/** One deck, in a fixed order. The shuffle is what makes it random. */
function buildDeck(startId: number): Card[] {
  const cards: Card[] = [];
  let id = startId;
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      cards.push({ rank, suit, id: id++ });
    }
  }
  return cards;
}

/**
 * Fisher–Yates, drawing from `rng.int` so the whole shuffle is a function of
 * the seed. Walking downwards is the correct form of the algorithm; the
 * upward variant is the one that is subtly biased.
 */
export function shuffle<T>(items: T[], rng: Rng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Build and shuffle a shoe.
 *
 * `shuffleId` increments rather than resetting so that the UI can key an
 * entire shoe off it — a new shoe is a new set of React nodes, not the old
 * ones with different cards in them.
 */
export function createShoe(
  decks: number,
  penetration: number,
  rng: Rng,
  shuffleId = 1,
): ShoeState {
  let cards: Card[] = [];
  for (let d = 0; d < decks; d++) {
    cards = cards.concat(buildDeck(d * 52));
  }
  cards = shuffle(cards, rng);
  const size = cards.length;
  return {
    cards,
    pos: 0,
    size,
    // Clamped so that a slider at either extreme still leaves a dealable shoe:
    // a cut at 0 would reshuffle before the first round, and a cut at the very
    // end would run the shoe dry mid-hand.
    cutAt: Math.max(20, Math.min(size - 15, Math.round(size * penetration))),
    cutReached: false,
    shuffleId,
    seed: seedFrom(rng),
  };
}

/**
 * Reshuffle mid-round, keeping the cards that are on the felt.
 *
 * A shoe can run out before a round finishes. It is rare — it needs a small
 * shoe, several seats and a lot of splitting — but "rare" is not "impossible",
 * and a single deck cut at 65% leaves eighteen cards while three seats
 * splitting to four hands can want more than that. This used to throw, on the
 * stated premise that the cut card made it unreachable; three seats on the
 * single-deck preset reached it in thirteen thousand rounds.
 *
 * What a dealer does is gather the discards, leave the cards in play where
 * they are, shuffle, and carry on. `inPlay` is those cards, and they are
 * removed from the new shoe so nobody ends up holding a card that is also
 * still to come. `cutReached` stays set, so the round still finishes and the
 * table takes a clean shoe before the next one.
 */
export function reshuffleKeeping(
  shoe: ShoeState,
  decks: number,
  penetration: number,
  inPlay: readonly Card[],
): ShoeState {
  const fresh = createShoe(decks, penetration, createRng(shoe.seed), shoe.shuffleId + 1);
  const held = new Set(inPlay.map((c) => c.id));
  const cards = fresh.cards.filter((c) => !held.has(c.id));

  return {
    ...fresh,
    cards,
    size: cards.length,
    // The cut card has already surfaced; nothing about a mid-round reshuffle
    // changes that the shoe is spent once this hand is over.
    cutReached: true,
  };
}

/** Cards dealt since the shuffle — which is also the size of the discard tray. */
export function dealt(shoe: ShoeState): number {
  return shoe.pos;
}

/** Cards still to come. */
export function remaining(shoe: ShoeState): number {
  return shoe.size - shoe.pos;
}

/** Decks still behind the cut card, to one decimal — what a counter estimates. */
export function decksRemaining(shoe: ShoeState): number {
  return remaining(shoe) / 52;
}

/** How far through the shoe we are, 0..1. Drives the penetration meter. */
export function penetrationSoFar(shoe: ShoeState): number {
  return shoe.size === 0 ? 0 : shoe.pos / shoe.size;
}

/**
 * Take the next card.
 *
 * Returns a new shoe rather than mutating, because every state transition in
 * this engine does — a round is replayable only if nothing in it was changed
 * in place. The array is shared between the old shoe and the new one, which is
 * safe precisely because nothing ever writes to it. The cut-card flag is set
 * on the way past; nothing acts on it until the round ends.
 *
 * Running a shoe completely dry is a bug elsewhere (the cut card is always at
 * least fifteen cards from the end), so it throws rather than dealing a card
 * that does not exist and settling money against it.
 */
export function draw(shoe: ShoeState): { card: Card; shoe: ShoeState } {
  if (shoe.pos >= shoe.size) {
    // Unreachable: every caller runs `ensureCards` first, which reshuffles the
    // discards back in. Kept as an assertion rather than a code path.
    throw new Error('The shoe is empty. ensureCards should have reshuffled it.');
  }
  const card = shoe.cards[shoe.pos];
  const pos = shoe.pos + 1;
  return {
    card,
    shoe: {
      ...shoe,
      pos,
      cutReached: shoe.cutReached || pos >= shoe.cutAt,
    },
  };
}




/** For the tests: is every suit and rank present exactly `decks` times? */
export function isCompleteShoe(shoe: ShoeState, decks: number): boolean {
  const seen = new Map<string, number>();
  for (const card of shoe.cards) {
    const key = `${card.rank}-${card.suit}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  if (seen.size !== RANKS.length * SUITS.length) return false;
  for (const count of seen.values()) if (count !== decks) return false;
  return true;
}
