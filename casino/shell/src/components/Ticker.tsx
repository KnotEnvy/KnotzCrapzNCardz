'use client';

/**
 * The tape.
 *
 * A casino floor is loud on purpose: the machine two rows over hitting its
 * jackpot is the single most effective thing in the building at making somebody
 * else play, and a website version of a casino that leaves it out feels like an
 * empty one. So every jackpot, big win and feature any player hits goes past
 * here.
 *
 * Two details it would be easy to get wrong:
 *
 * The content is rendered *twice*, and the CSS marquee translates by exactly
 * -50%. That is what makes the loop seamless — the animation ends on the
 * duplicate's first item, in the same position the original's first item
 * started, so there is no jump and no gap to fill.
 *
 * The labels come from other players' games, over a socket, which makes them
 * untrusted text. They are rendered as text children and never as markup, and
 * the store clips them to a sane length before they ever reach here.
 */

import * as React from 'react';
import { Accent } from '@/components/ui/primitives';
import { moneyShort } from '@/lib/money';
import { useFloor } from '@/lib/floor';
import type { GameManifest, TickerEntry } from '@/lib/api';

const ICON: Record<TickerEntry['kind'], string> = {
  jackpot: '◆',
  'big-win': '▲',
  feature: '✦',
  milestone: '●',
  bust: '▽',
};

/** One tone per kind, so the tape is scannable without being read. */
const TONE: Record<TickerEntry['kind'], string> = {
  jackpot: 'text-neon-gold',
  'big-win': 'text-neon-lime',
  feature: 'text-neon-magenta',
  milestone: 'text-neon-cyan',
  bust: 'text-void-400',
};

function Row({ entry, game }: { entry: TickerEntry; game?: GameManifest }): React.JSX.Element {
  return (
    <Accent
      as="span"
      color={game?.accent ?? '#22d3ee'}
      alt={game?.accentAlt}
      className="inline-flex shrink-0 items-center gap-2 px-5 py-2 text-xs whitespace-nowrap"
    >
      <span aria-hidden className={`text-[0.7rem] ${TONE[entry.kind]}`}>
        {ICON[entry.kind] ?? '●'}
      </span>
      <span className="font-semibold text-void-100">{entry.handle}</span>
      <span className="text-void-300">{entry.label}</span>
      {entry.amount !== null && entry.amount > 0 && (
        <span className="figure font-bold text-neon-gold">{moneyShort(entry.amount)}</span>
      )}
    </Accent>
  );
}

export function Ticker(): React.JSX.Element | null {
  const entries = useFloor((s) => s.ticker);
  const games = useFloor((s) => s.games);
  const byslug = React.useMemo(
    () => new Map(games.map((g) => [g.slug, g])),
    [games],
  );

  if (entries.length === 0) {
    return (
      <div className="border-y border-white/6 bg-void-900/60 py-2 text-center text-[0.7rem] tracking-[0.2em] text-void-400 uppercase">
        The floor is quiet. Be the first thing on the tape.
      </div>
    );
  }

  /*
   * A handful of rows moving slowly reads as a dead floor, so a short tape is
   * repeated until it is long enough to fill the marquee. The duplication for
   * the seamless loop is on top of that.
   */
  const filled: TickerEntry[] = [];
  while (filled.length < 8 && entries.length > 0) filled.push(...entries);
  const tape = [...filled, ...filled];

  return (
    <div
      className="relative overflow-hidden border-y border-white/6 bg-void-900/60"
      // The tape is decoration that repeats itself; a screen reader walking it
      // would read every win twice. The lobby's own panels carry the same
      // information in a list.
      aria-hidden
    >
      <div className="tape">
        {tape.map((entry, i) => (
          <Row key={`${entry.at}-${entry.handle}-${i}`} entry={entry} game={byslug.get(entry.game)} />
        ))}
      </div>

      {/* Fades the tape into the page at both ends, so rows arrive and leave
          rather than being clipped at a hard edge. */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-void-950 to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-void-950 to-transparent" />
    </div>
  );
}
