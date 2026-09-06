'use client';

/**
 * A playing card.
 *
 * Two faces on one element, rotated in 3D — the face is the shared PNG deck at
 * `public/cards`, the back is drawn in CSS. The flip is a transform rather than
 * a swap, so the hole card turning over is one continuous motion and not a
 * cut, which is the difference between a dealer's hand and a slideshow.
 *
 * Sizing is driven entirely by the parent: the card fills its container's
 * width and takes its height from the 2.5 x 3.5 aspect ratio a real card has.
 * Nothing here knows how big the table is.
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
  card: CardModel | null;
  /** Face down. A null card is always down — it is the hole card before the peek. */
  down?: boolean;
  /**
   * Index in the hand, used to stagger the deal animation and to fan the card.
   * Passing it is what makes four cards arrive one after another rather than
   * all at once.
   */
  index?: number;
  /** Skip the deal-in animation — for cards that were already on the felt. */
  still?: boolean;
  /** A small rotation, in degrees, so a hand does not look printed. */
  tilt?: number;
  className?: string;
}

/**
 * The card, memoised.
 *
 * A four-hand split with a dealer drawing to five is twenty of these
 * re-rendering on every store change. They depend only on their props, and the
 * props are primitives plus a frozen card, so memo is free and load-bearing.
 */
export const PlayingCard = React.memo(function PlayingCard({
  card,
  down = false,
  index = 0,
  still = false,
  tilt = 0,
  className,
}: PlayingCardProps) {
  const faceDown = down || card === null;
  const label = card ? cardLabel(card) : 'face down';

  return (
    <div
      className={cn('card3d', faceDown && 'card3d--down', !still && 'card-dealt', className)}
      style={
        {
          '--card-tilt': `${tilt}deg`,
          animationDelay: still ? undefined : `${index * 110}ms`,
          transform: `rotate(${tilt}deg)`,
        } as React.CSSProperties
      }
      role="img"
      aria-label={faceDown ? 'Face-down card' : `${label}`}
    >
      <div className="card3d__inner">
        <div
          className="card3d__face"
          style={card ? { backgroundImage: `url(${cardArtUrl(card)})` } : undefined}
        >
          {/*
            The art is the card. This corner index sits on top of it only as a
            fallback for the moment before a 60 KB PNG has arrived — without it
            a freshly dealt hand is four white rectangles on a slow connection.
            It is behind the image in the stacking order, so once the art
            paints, this is never seen.
          */}
          {card ? (
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
          ) : null}
        </div>
        <div className="card3d__back" />
      </div>
    </div>
  );
});

/* ------------------------------------------------------------------ *
 * A hand of them
 * ------------------------------------------------------------------ */

/**
 * Cards overlapped the way a dealer lays them: each one covering most of the
 * last, stepped down and to the right so every rank stays readable.
 *
 * The overlap tightens as the hand grows. Two cards sit wide apart; a
 * six-card twenty-one squeezes so that the whole hand still fits its box
 * rather than sliding under the next seat.
 */
export function CardFan({
  cards,
  holeDown = false,
  dealt = 0,
  size = 62,
  className,
}: {
  cards: readonly CardModel[];
  /** The second card is the hole card and is face down. */
  holeDown?: boolean;
  /** How many of these were already on the felt — the rest animate in. */
  dealt?: number;
  /** Card width in pixels. */
  size?: number;
  className?: string;
}) {
  const overlap = cards.length <= 2 ? 0.42 : cards.length <= 4 ? 0.3 : 0.22;
  const step = size * overlap;
  const width = cards.length === 0 ? size : size + step * (cards.length - 1);

  return (
    <div
      className={cn('relative', className)}
      style={{ width, height: size / 0.6944, containerType: 'inline-size' }}
    >
      {cards.map((card, i) => (
        <div
          key={card.id}
          className="absolute top-0"
          style={{ left: i * step, width: size, zIndex: i }}
        >
          <PlayingCard
            card={card}
            down={holeDown && i === 1}
            index={i}
            still={i < dealt}
            tilt={i === 0 ? 0 : (i % 2 === 0 ? 1 : -1) * Math.min(4, i * 1.5)}
          />
        </div>
      ))}
    </div>
  );
}
