'use client';

/**
 * One mark per game, drawn as line art in the game's own accent.
 *
 * Drawn rather than imported, for a reason that is about the plug-in story
 * rather than about file size: a game joins this floor by adding a row to the
 * catalog and a directory of static files, and requiring a hand-made
 * illustration for the tile as well would make "add a game" a design task. A
 * mark chosen by `kind` means a new video poker game gets a reasonable tile the
 * day it is registered, and a bespoke one only if somebody wants to draw it.
 *
 * Everything below inherits `currentColor` and is sized by its container, so the
 * same mark works at 28px in the frame chrome and at 160px on a tile.
 */

import * as React from 'react';
import type { GameManifest } from '@/lib/api';

type MarkProps = { className?: string };

/** Two dice at rest, one showing the hard eight. */
function Dice({ className }: MarkProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden>
      <g stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
        <rect x="6" y="20" width="28" height="28" rx="6" />
        <rect
          x="32"
          y="10"
          width="26"
          height="26"
          rx="6"
          transform="rotate(12 45 23)"
          opacity="0.75"
        />
      </g>
      <g fill="currentColor">
        {/* Four and four: the hard eight, which is the bet this table is
            remembered for. */}
        <circle cx="14" cy="28" r="2.1" />
        <circle cx="26" cy="28" r="2.1" />
        <circle cx="14" cy="40" r="2.1" />
        <circle cx="26" cy="40" r="2.1" />
        <g opacity="0.75">
          <circle cx="39" cy="20" r="2.1" />
          <circle cx="51" cy="22" r="2.1" />
          <circle cx="37" cy="32" r="2.1" />
          <circle cx="49" cy="34" r="2.1" />
        </g>
      </g>
    </svg>
  );
}

/** An ace over a face card, fanned: the hand the game is named for. */
function Blackjack({ className }: MarkProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden>
      <g stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
        <rect
          x="10"
          y="12"
          width="26"
          height="38"
          rx="4"
          transform="rotate(-11 23 31)"
          opacity="0.65"
        />
        <rect x="28" y="14" width="26" height="38" rx="4" transform="rotate(8 41 33)" />
      </g>
      {/* The pip, and the count. Two glyphs rather than a drawing, because at
          tile size a drawn spade and a drawn heart are the same smudge. */}
      <text
        x="41"
        y="40"
        textAnchor="middle"
        fill="currentColor"
        fontSize="15"
        fontWeight="700"
        fontFamily="var(--font-display)"
        transform="rotate(8 41 33)"
      >
        21
      </text>
      <path
        d="M19 34c-3-3-5-5-5-7.6a3.6 3.6 0 0 1 6.4-2.2A3.6 3.6 0 0 1 27 26.4C27 29 25 31 22 34z"
        fill="currentColor"
        opacity="0.65"
        transform="rotate(-11 23 31)"
      />
    </svg>
  );
}

/** Three cards, face down, in a row: the whole game in one shape. */
function ThreeCard({ className }: MarkProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden>
      <g stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
        <rect x="5" y="18" width="18" height="28" rx="3.5" opacity="0.55" />
        <rect x="23" y="14" width="18" height="28" rx="3.5" opacity="0.78" />
        <rect x="41" y="18" width="18" height="28" rx="3.5" />
      </g>
      {/* A lattice back on the middle card only: three identical hatched
          rectangles at this size turn into a grey block. */}
      <g stroke="currentColor" strokeWidth="0.8" opacity="0.4">
        <path d="M26 17l12 12M26 23l12 12M26 29l12 10M32 17l6 6" />
      </g>
      <circle cx="50" cy="32" r="3" fill="currentColor" opacity="0.9" />
    </svg>
  );
}

/** A reel window with a coiled dragon over it. */
function Reels({ className }: MarkProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden>
      <g stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
        <rect x="6" y="14" width="52" height="36" rx="5" />
        <path d="M23 14v36M41 14v36" opacity="0.45" />
      </g>
      {/*
       * The dragon: one open path for the body and neck, a wing, and a lit eye.
       * It reads as a creature at 28px, which is the only size that matters —
       * anything more detailed disappears at tile scale and looks fussy large.
       */}
      <path
        d="M14 42c4-1 6-4 6-8s2-8 7-9c4-.8 6 1.4 9 1.4 3.4 0 5-2.4 8-2.4 2.6 0 4.6 1.6 5.4 3.6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.95"
      />
      <path
        d="M28 27c2.6-3.4 6.4-4.6 9.6-3.2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity="0.6"
      />
      <circle cx="47" cy="26" r="1.7" fill="currentColor" />
    </svg>
  );
}

/** A stacked chip, for a kind we have no mark for yet. */
function Generic({ className }: MarkProps): React.JSX.Element {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden>
      <g stroke="currentColor" strokeWidth="1.6">
        <circle cx="32" cy="32" r="20" />
        <circle cx="32" cy="32" r="11" opacity="0.5" />
        <path d="M32 12v6M32 46v6M12 32h6M46 32h6M18 18l4 4M42 42l4 4M46 18l-4 4M22 42l-4 4" />
      </g>
    </svg>
  );
}

/**
 * The mark for a game.
 *
 * By slug first, so a game can have its own; by kind second, so a new one does
 * not need to.
 */
export function GameArt({
  game,
  className,
}: {
  game: Pick<GameManifest, 'slug' | 'kind'>;
  className?: string;
}): React.JSX.Element {
  switch (game.slug) {
    case 'craps':
      return <Dice className={className} />;
    case 'blackjack':
      return <Blackjack className={className} />;
    case 'three-card-poker':
      return <ThreeCard className={className} />;
    case 'dragons-shrine':
      return <Reels className={className} />;
    default:
      break;
  }
  switch (game.kind) {
    case 'slots':
      return <Reels className={className} />;
    case 'table':
    case 'video-poker':
      return <ThreeCard className={className} />;
    default:
      return <Generic className={className} />;
  }
}
