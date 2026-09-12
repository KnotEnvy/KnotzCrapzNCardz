/**
 * The deck, and the machine that shuffles it.
 *
 * Three Card Poker is dealt from one 52-card deck that goes back through a
 * shuffling machine after every round. The regulator's rule sheet puts it
 * plainly: the cards are shuffled "immediately prior to the commencement of
 * play and after each round of play has been completed", and the machine
 * dispenses them in stacks of three.
 *
 * That one fact shapes the whole game. There is no shoe, so there is no cut
 * card, no penetration and nothing to count — every round starts from a full
 * deck and no round remembers the last. It is also what makes the game exactly
 * solvable: a player's three cards and a dealer's three are drawn from the
 * same fifty-two every time, which is the premise every figure in
 * `analysis.ts` rests on.
 */

import type { Rng } from './rng';
import type { Card } from './types';
import { cardFromIndex, cardIndex } from './types';

/** One deck, in a fixed order. The shuffle is what makes it random. */
export function freshDeck(): Card[] {
  return Array.from({ length: 52 }, (_, i) => cardFromIndex(i));
}

/**
 * Fisher–Yates, drawing from `rng.int` so the whole shuffle is a function of
 * the seed. Walking downwards is the correct form of the algorithm; the
 * upward variant is the one that is subtly biased.
 */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** What the machine hands the dealer at the start of a round. */
export function shuffledDeck(rng: Rng): Card[] {
  return shuffle(freshDeck(), rng);
}

/** For the tests: fifty-two cards, each exactly once, each id matching its face. */
export function isCompleteDeck(cards: readonly Card[]): boolean {
  if (cards.length !== 52) return false;
  const seen = new Set<number>();
  for (const card of cards) {
    if (card.id !== cardIndex(card.rank, card.suit)) return false;
    seen.add(card.id);
  }
  return seen.size === 52;
}
