'use client';

/**
 * Two charts, drawn as SVG by hand.
 *
 * There is no charting library here because there is no chart here that needs
 * one: a bankroll line and a stacked bar are about forty lines of path
 * arithmetic each, and a library to draw them would be a hundred kilobytes to
 * spare writing them.
 */

import * as React from 'react';
import { cn } from '@/components/ui/primitives';
import { fmt } from '@/lib/engine/money';
import type { RoundRecord, SeatStats } from '@/lib/engine/types';

/* ------------------------------------------------------------------ *
 * Outcome bars
 * ------------------------------------------------------------------ */

/**
 * How the hands actually finished, as one bar.
 *
 * The interesting figure is not the win rate — blackjack wins about 43% of
 * hands and that number surprises people who then conclude the game is rigged.
 * It is the *pushes*, which are 8-9% and are why a 43% win rate is not a
 * disaster, and the blackjacks, which are where the 3:2 lives.
 */
export function OutcomeBars({ stats }: { stats: SeatStats }) {
  const decided = stats.wins + stats.losses + stats.pushes;
  if (decided === 0) {
    // `handsPlayed` counts hands dealt; this bar counts hands settled. Saying
    // "no hands yet" next to a hands-played counter reading 3 is a
    // contradiction the player has to resolve themselves.
    return (
      <p className="text-[10px] text-pit-500">
        {stats.handsPlayed > 0 ? 'Nothing settled yet — the round is still live.' : 'No hands yet.'}
      </p>
    );
  }

  const segments = [
    { label: 'Won', value: stats.wins, color: 'var(--color-win)' },
    { label: 'Pushed', value: stats.pushes, color: 'var(--color-push)' },
    { label: 'Lost', value: stats.losses, color: 'var(--color-lose)' },
  ];

  return (
    <div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-pit-800" role="img" aria-label="Hand outcomes">
        {segments.map((s) => (
          <div
            key={s.label}
            className="h-full transition-[width] duration-500"
            style={{ width: `${(s.value / decided) * 100}%`, background: s.color }}
            title={`${s.label}: ${s.value} (${Math.round((s.value / decided) * 100)}%)`}
          />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[10px]">
        {segments.map((s) => (
          <span key={s.label} className="flex items-center gap-1 text-pit-400">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
            {s.label} {Math.round((s.value / decided) * 100)}%
          </span>
        ))}
      </div>
      <div className="mt-1.5 grid grid-cols-3 gap-1 text-center text-[10px] text-pit-400">
        <span title="Naturals dealt">
          <span className="block font-mono text-brass-300">{stats.blackjacks}</span>blackjacks
        </span>
        <span title="Hands that went over 21">
          <span className="block font-mono text-lose">{stats.busts}</span>busts
        </span>
        <span title="Doubles and splits taken">
          <span className="block font-mono text-pit-200">
            {stats.doubles}/{stats.splits}
          </span>
          dbl/spl
        </span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The bankroll line
 * ------------------------------------------------------------------ */

/**
 * Cumulative result, oldest to newest.
 *
 * The zero line is drawn because it is the only reference that matters, and
 * the fill is split at it so a losing session is visibly below the water
 * rather than being a line you have to read the axis to place.
 */
export function Equity({ history, className }: { history: readonly RoundRecord[]; className?: string }) {
  const points = React.useMemo(() => {
    const out: number[] = [0];
    let sum = 0;
    // History is newest-first; the chart runs the other way.
    for (let i = history.length - 1; i >= 0; i--) {
      sum += history[i].net;
      out.push(sum);
    }
    return out.slice(-160);
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

  return (
    <div className={className}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-14 w-full" role="img" aria-label={`Session result: ${fmt(last)}`}>
        <defs>
          <linearGradient id="equity-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={up ? 'var(--color-win)' : 'var(--color-lose)'} stopOpacity="0.3" />
            <stop offset="100%" stopColor={up ? 'var(--color-win)' : 'var(--color-lose)'} stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1="0" y1={y(0)} x2={W} y2={y(0)} stroke="rgba(255,255,255,0.14)" strokeWidth="1" strokeDasharray="3 3" />
        <path d={area} fill="url(#equity-fill)" />
        <path
          d={line}
          fill="none"
          stroke={up ? 'var(--color-win)' : 'var(--color-lose)'}
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <circle cx={W} cy={y(last)} r="2.5" fill={up ? 'var(--color-win)' : 'var(--color-lose)'} />
      </svg>
      <div className="flex justify-between text-[9px] text-pit-500">
        <span>{points.length - 1} rounds</span>
        <span className="font-mono">{fmt(last)}</span>
      </div>
    </div>
  );
}
