'use client';

/**
 * The glyphs on the control rail.
 *
 * Drawn rather than pulled from an icon set, because there are eleven of them
 * and every one has to read at 14 pixels against lacquer. They are all one
 * weight, one grid, `currentColor`, and `aria-hidden` -- the accessible name
 * belongs to the button, never to the picture inside it.
 */

import * as React from 'react';

type IconProps = { className?: string };

function Svg({ className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className ?? 'h-[1.1em] w-[1.1em]'}
    >
      {children}
    </svg>
  );
}

export const MinusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12h14" />
  </Svg>
);

export const PlusIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const InfoIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 7.6v.6" />
  </Svg>
);

export const GearIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M19.4 14.2a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-2.87 1.2v.18a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.93-1.15l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 3.5 14.2H3.4a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.15-2.93l-.06-.06A2 2 0 1 1 7.42 4.4l.06.06a1.7 1.7 0 0 0 2.87-1.2V3.1a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.93 1.15l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0 1.2 2.87h.18a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.99 1.15Z" />
  </Svg>
);

export const ChartIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </Svg>
);

export const SoundOnIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 9.5v5h3.2L12 19V5L7.2 9.5H4Z" />
    <path d="M16 9.2a4 4 0 0 1 0 5.6M18.6 6.6a7.6 7.6 0 0 1 0 10.8" />
  </Svg>
);

export const SoundOffIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 9.5v5h3.2L12 19V5L7.2 9.5H4Z" />
    <path d="M16.5 10l4 4M20.5 10l-4 4" />
  </Svg>
);

export const MusicIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 18V6l10-2v12" />
    <circle cx="6.5" cy="18" r="2.5" />
    <circle cx="16.5" cy="16" r="2.5" />
  </Svg>
);

export const BoltIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M13 2 4.5 13.5H11L10.5 22 19.5 10.5H13L13 2Z" />
  </Svg>
);

export const LoopIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3.5 12a8.5 8.5 0 0 1 14.6-5.9L21 9" />
    <path d="M21 4v5h-5" />
    <path d="M20.5 12a8.5 8.5 0 0 1-14.6 5.9L3 15" />
    <path d="M3 20v-5h5" />
  </Svg>
);

export const CoinsIcon = (p: IconProps) => (
  <Svg {...p}>
    <ellipse cx="12" cy="6.5" rx="7.5" ry="3" />
    <path d="M4.5 6.5v5c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3v-5" />
    <path d="M4.5 11.5v5c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3v-5" />
  </Svg>
);

export const CardsIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="5" width="11" height="15" rx="2" />
    <path d="M17 7.4 20.6 8.4a2 2 0 0 1 1.4 2.45L19.4 20" />
  </Svg>
);
