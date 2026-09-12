'use client';

/**
 * Three charts, drawn by hand.
 *
 * There is no charting library here because there is no chart here that needs
 * one: a bankroll line, a stacked bar and a row of tallies are a few dozen
 * lines of arithmetic each.
 */

import * as React from 'react';
import { cn } from '@/components/ui/primitives';
import { THREE_CARD_COUNTS, THREE_CARD_HANDS } from '@/lib/engine/analysis';
import { fmt } from '@/lib/engine/money';
import { CATEGORY_LABEL } from '@/lib/engine/poker';
import type { HandCategory, RoundRecord, SeatStats } from '@/lib/engine/types';
import { HAND_CATEGORIES } from '@/lib/engine/types';

/* ------------------------------------------------------------------ *
 * Outcome bar
 * ------------------------------------------------------------------ */

/**
 * How the hands with an Ante finished, as one bar.
 *
 * "Won" and "dealer did not qualify" are shown apart, because they are not the
 * same win: one pays the Play, the other pushes it, and a session that wins
 * most of its hands on non-qualifying dealers is making half what it looks
 * like. The folds are their own segment for the same reason — they are losses
 * the player chose.
 */
export function OutcomeBars({ stats }: { stats: SeatStats }) {
  const decided = stats.wins + stats.noQualify + stats.pushes + stats.losses + stats.folds;
  if (decided === 0) {
    return <p className="text-[10px] text-pit-500">{stats.hands > 0 ? 'Nothing settled yet — the round is still live.' : 'No hands yet.'}</p>;
  }

  const segments = [
    { label: 'Won', value: stats.wins, color: 'var(--color-win)' },
    { label: 'No qualifier', value: stats.noQualify, color: '#9be3bb' },
    { label: 'Push', value: stats.pushes, color: 'var(--color-push)' },
    { label: 'Lost', value: stats.losses, color: 'var(--color-lose)' },
    { label: 'Folded', value: stats.folds, color: 'var(--color-pit-600)' },
  ];
  const pct = (v: number) => Math.round((v / decided) * 100);

  return (
    <div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-pit-800" role="img" aria-label={segments.map((s) => `${s.label} ${pct(s.value)}%`).join(', ')}>
        {segments.map((s) => (
          <div
            key={s.label}
            className="h-full transition-[width] duration-500"
            style={{ width: `${(s.value / decided) * 100}%`, background: s.color }}
            title={`${s.label}: ${s.value} (${pct(s.value)}%)`}
          />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap justify-between gap-x-2 text-[10px]">
        {segments.map((s) => (
          <span key={s.label} className="flex items-center gap-1 text-pit-400">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
            {s.label} {pct(s.value)}%
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Hand tally
 * ------------------------------------------------------------------ */

const HAND_TONE: Record<HandCategory, string> = {
  STRAIGHT_FLUSH: 'var(--color-hand-straight-flush)',
  TRIPS: 'var(--color-hand-trips)',
  STRAIGHT: 'var(--color-hand-straight)',
  FLUSH: 'var(--color-hand-flush)',
  PAIR: 'var(--color-hand-pair)',
  HIGH_CARD: 'var(--color-hand-high)',
};

/**
 * What the deck has dealt, beside what it should.
 *
 * The expected column is exact — 48 straight flushes in 22,100 hands, and so
 * on — so this is the one place a player can watch the shuffle being honest,
 * and watch how long it takes: a straight flush every 460 hands means a
 * session of a hundred can easily see none and another can see two.
 */
export function HandTally({ stats }: { stats: SeatStats }) {
  const dealt = HAND_CATEGORIES.reduce((n, c) => n + stats.categories[c], 0);
  if (dealt === 0) return null;

  return (
    <table className="w-full text-[10px]">
      <thead>
        <tr className="text-pit-500">
          <th className="text-left font-normal">Hands dealt</th>
          <th className="text-right font-normal">seen</th>
          <th className="text-right font-normal">expected</th>
        </tr>
      </thead>
      <tbody>
        {HAND_CATEGORIES.map((c) => {
          const combos = c === 'STRAIGHT_FLUSH' ? THREE_CARD_COUNTS.STRAIGHT_FLUSH + THREE_CARD_COUNTS.MINI_ROYAL : THREE_CARD_COUNTS[c];
          const expected = (combos / THREE_CARD_HANDS) * dealt;
          return (
            <tr key={c}>
              <td className="py-px text-pit-300">
                <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full" style={{ background: HAND_TONE[c] }} />
                {CATEGORY_LABEL[c]}
              </td>
              <td className="py-px text-right font-mono tabular-nums text-pit-100">{stats.categories[c]}</td>
              <td className="py-px text-right font-mono tabular-nums text-pit-400">{expected < 10 ? expected.toFixed(1) : Math.round(expected)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ------------------------------------------------------------------ *
 * The bankroll line
 * ------------------------------------------------------------------ */

/**
 * Cumulative result over the last {@link WINDOW} rounds, oldest to newest.
 *
 * A window, not the session, and the caption says so: past a couple of hundred
 * rounds the endpoint here and the session's Net figure are different numbers,
 * and a label that called this "Session result" would make one of them look
 * wrong. The blackjack table's did.
 */
const WINDOW = 160;

export function Equity({ history, className }: { history: readonly RoundRecord[]; className?: string }) {
  const points = React.useMemo(() => {
    const out: number[] = [0];
    let sum = 0;
    for (let i = history.length - 1; i >= 0; i--) {
      sum += history[i].net;
      out.push(sum);
    }
    return out.slice(-WINDOW);
  }, [history]);

  if (points.length < 3) {
    return <p className={cn('text-[10px] text-pit-500', className)}>Play a few hands to see the curve.</p>;
  }

  const W = 260;
  const H = 56;
  const max = Math.max(...points, 0);
  const min = Math.min(...points, 0);
  const span = Math.max(1, max - min);
  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (v: number) => H - ((v - min) / span) * H;

  const line = points.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L ${W} ${y(0).toFixed(1)} L 0 ${y(0).toFixed(1)} Z`;
  const last = points[points.length - 1];
  const up = last >= 0;
  const tone = up ? 'var(--color-win)' : 'var(--color-lose)';

  return (
    <div className={className}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-14 w-full" role="img" aria-label={`Result over the last ${points.length - 1} rounds: ${fmt(last)}`}>
        <defs>
          <linearGradient id="equity-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={tone} stopOpacity="0.3" />
            <stop offset="100%" stopColor={tone} stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1="0" y1={y(0)} x2={W} y2={y(0)} stroke="rgba(255,255,255,0.14)" strokeWidth="1" strokeDasharray="3 3" />
        <path d={area} fill="url(#equity-fill)" />
        <path d={line} fill="none" stroke={tone} strokeWidth="1.5" strokeLinejoin="round" />
        <circle cx={W} cy={y(last)} r="2.5" fill={tone} />
      </svg>
      <div className="flex justify-between text-[9px] text-pit-500">
        <span>{points.length - 1 >= WINDOW ? `last ${WINDOW} rounds` : `${points.length - 1} rounds`}</span>
        <span className="font-mono">{fmt(last)}</span>
      </div>
    </div>
  );
}
