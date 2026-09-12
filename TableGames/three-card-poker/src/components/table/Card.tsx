'use client';

/**
 * A playing card.
 *
 * Two faces on one element, rotated in 3D — the face is the shared PNG deck at
 * `public/cards`, the back is drawn in CSS. Turning a card over is a transform
 * rather than a swap, so a hand being revealed is one continuous motion and
 * not a cut.
 *
 * In Three Card Poker that motion carries the game. Nothing is dealt face up:
 * a player turns their own three cards to decide, and the dealer turns
 * everybody's over at the showdown. So the flip is the thing being watched,
 * and `flipDelay` exists so a hand turns over one card after another rather
 * than all three at once.
 *
 * Sizing is driven entirely by the parent: the card fills its container's
 * width and takes its height from a real card's proportions.
 */

import * as React from 'react';
import { cn } from '@/components/ui/primitives';
import type { Card as CardModel } from '@/lib/engine/types';
import { cardLabel, rankLabel, SUIT_GLYPH } from '@/lib/engine/types';

/** Where the art for a card lives. The deck is named by rank number and suit. */
export function cardArtUrl(card: CardModel): string {
  return `/cards/${card.rank}_of_${card.suit}.png`;
}

export interface PlayingCardProps {
  card: CardModel;
  down?: boolean;
  /** Which of the two decks this came from; they have different backs. */
  altBack?: boolean;
  /** Index in the hand, used to stagger the deal and to fan the card. */
  index?: number;
  /** Skip the deal-in animation — for cards that were already on the felt. */
  still?: boolean;
  /** Milliseconds before the stack this card is part of arrives. */
  dealDelay?: number;
  /** Milliseconds before this card turns over when `down` changes. */
  flipDelay?: number;
  tilt?: number;
  /** Where the deal flies in from, relative to where the card lands, in px. */
  from?: { x: number; y: number };
  className?: string;
}

/**
 * The card, memoised.
 *
 * Three seats and a dealer is twelve of these re-rendering on every store
 * change. They depend only on their props, and the props are primitives plus
 * a card that never changes identity within a round, so memo is free.
 */
export const PlayingCard = React.memo(function PlayingCard({
  card,
  down = false,
  altBack = false,
  index = 0,
  still = false,
  dealDelay = 0,
  flipDelay = 0,
  tilt = 0,
  from,
  className,
}: PlayingCardProps) {
  return (
    <div
      className={cn('card3d', down && 'card3d--down', !still && 'card-dealt', className)}
      style={
        {
          '--card-tilt': `${tilt}deg`,
          '--flip-delay': `${flipDelay}ms`,
          '--deal-x': from ? `${from.x}px` : undefined,
          '--deal-y': from ? `${from.y}px` : undefined,
          // A stack of three lands together, a beat apart inside the stack.
          animationDelay: still ? undefined : `${dealDelay + index * 55}ms`,
          transform: `rotate(${tilt}deg)`,
        } as React.CSSProperties
      }
      role="img"
      aria-label={down ? 'Face-down card' : cardLabel(card)}
    >
      <div className="card3d__inner">
        <div className="card3d__face" style={down ? undefined : { backgroundImage: `url(${cardArtUrl(card)})` }}>
          {/*
            The art is the card. This corner index sits behind it only as a
            fallback for the moment before a PNG has arrived — without it a
            freshly turned hand is three white rectangles on a slow connection.

            The face carries no art and no index while the card is down. A
            face-down card whose face is in the DOM is a card anyone can read
            with the inspector, and at this table the whole game is which
            cards you may see.
          */}
          {down ? null : (
            <span
              aria-hidden
              className="pointer-events-none absolute top-[4%] left-[6%] -z-10 leading-none font-semibold"
              style={{
                fontSize: 'clamp(9px, 22cqw, 22px)',
                color: card.suit === 'hearts' || card.suit === 'diamonds' ? '#c8102e' : '#16181d',
              }}
            >
              {rankLabel(card.rank)}
              {SUIT_GLYPH[card.suit]}
            </span>
          )}
        </div>
        <div className={cn('card3d__back', altBack && 'card3d__back--alt')} />
      </div>
    </div>
  );
});

/**
 * Three cards, fanned the way a player holds them on the felt: slightly
 * spread, each overlapping the last, the outer two turned out a few degrees.
 */
export function HandFan({
  cards,
  down,
  altBack,
  size = 60,
  still = false,
  dealDelay = 0,
  flipBase = 0,
  flipStagger = 0,
  from,
  className,
}: {
  cards: readonly CardModel[];
  down: boolean;
  altBack?: boolean;
  /** Card width in pixels. */
  size?: number;
  still?: boolean;
  /** Milliseconds before this hand's stack arrives from the machine. */
  dealDelay?: number;
  /** Milliseconds before the first card turns over. */
  flipBase?: number;
  /** Milliseconds between one card turning and the next. */
  flipStagger?: number;
  from?: { x: number; y: number };
  className?: string;
}) {
  const step = size * 0.52;
  const width = size + step * Math.max(0, cards.length - 1);

  return (
    <div
      className={cn('relative', className)}
      style={{ width, height: size / 0.6944, containerType: 'inline-size' }}
    >
      {cards.map((card, i) => (
        <div key={card.id} className="absolute top-0" style={{ left: i * step, width: size, zIndex: i }}>
          <PlayingCard
            card={card}
            down={down}
            altBack={altBack}
            index={i}
            still={still}
            dealDelay={dealDelay}
            flipDelay={flipBase + i * flipStagger}
            tilt={(i - 1) * 4}
            from={from}
          />
        </div>
      ))}
    </div>
  );
}
