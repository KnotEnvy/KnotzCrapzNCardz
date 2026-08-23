'use client';

/**
 * The two charts in the pro HUD.
 *
 * Both are hand-drawn SVG rather than a charting library: the shapes are simple,
 * the theming has to match the felt, and pulling in a chart runtime for eleven
 * bars and two lines would be the tail wagging the dog.
 *
 * Colours are the validated dark-surface steps. The seat hues here are one step
 * deeper than the chips on the felt, which is deliberate: chips sit on green
 * under a spotlight and want to be bright, chart marks sit on a dark panel and
 * would glare at the same lightness.
 */

import * as React from 'react';
import { distribution, equityCurve, WAYS, type EquityPoint } from '@/lib/engine/stats';
import type { RollRecord, SeatId, SessionStats } from '@/lib/engine/types';
import { money } from '@/components/ui/primitives';

export const SERIES: Record<SeatId, string> = {
  A: '#c08a14',
  B: '#3298dd',
};

const BAR = '#2f9e6e';
const BAR_SEVEN = '#43c98d';
const GRID = 'rgba(255,255,255,0.09)';
const AXIS_INK = '#6b7688';

/* ------------------------------------------------------------------ *
 * Distribution: what the dice actually did against what they should do
 * ------------------------------------------------------------------ */

export function DistributionChart({ stats }: { stats: SessionStats }) {
  const [hover, setHover] = React.useState<number | null>(null);
  const rows = distribution(stats.totals, stats.rolls);

  const W = 320;
  const H = 150;
  const padL = 26;
  const padB = 20;
  const padT = 10;
  const plotW = W - padL - 8;
  const plotH = H - padB - padT;

  const peak = Math.max(1, ...rows.map((r) => Math.max(r.actual, r.expected)));
  const step = plotW / rows.length;
  const barW = Math.max(6, step - 6); // a 2px+ gap between adjacent fills
  const yOf = (v: number) => padT + plotH - (v / peak) * plotH;

  const active = hover !== null ? rows.find((r) => r.total === hover) : null;

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Roll distribution over ${stats.rolls} rolls, compared with the expected frequency for two dice`}
        onMouseLeave={() => setHover(null)}
      >
        {/* Recessive baseline only; no horizontal grid needed at this size. */}
        <line x1={padL} y1={padT + plotH} x2={W - 8} y2={padT + plotH} stroke={GRID} strokeWidth={1} />

        {rows.map((r, i) => {
          const x = padL + i * step + (step - barW) / 2;
          const h = Math.max(0, padT + plotH - yOf(r.actual));
          const isSeven = r.total === 7;
          return (
            <g key={r.total}>
              {/* Generous hit target, independent of the mark. */}
              <rect
                x={padL + i * step}
                y={padT}
                width={step}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHover(r.total)}
              />
              <rect
                x={x}
                y={yOf(r.actual)}
                width={barW}
                height={h}
                rx={Math.min(4, barW / 2)}
                fill={isSeven ? BAR_SEVEN : BAR}
                opacity={hover === null || hover === r.total ? 1 : 0.45}
              />
              {/* Expected frequency: a reference tick, not a second series. */}
              <line
                x1={x - 2}
                y1={yOf(r.expected)}
                x2={x + barW + 2}
                y2={yOf(r.expected)}
                stroke="#e6e9ef"
                strokeWidth={1.5}
                opacity={0.75}
              />
              <text
                x={padL + i * step + step / 2}
                y={H - 6}
                textAnchor="middle"
                fontSize={9}
                fill={isSeven ? '#e6e9ef' : AXIS_INK}
                fontWeight={isSeven ? 700 : 400}
              >
                {r.total}
              </text>
            </g>
          );
        })}

        <text x={4} y={padT + 6} fontSize={9} fill={AXIS_INK}>
          {Math.round(peak)}
        </text>
        <text x={4} y={padT + plotH} fontSize={9} fill={AXIS_INK}>
          0
        </text>
      </svg>

      <figcaption className="mt-1 flex items-center justify-between gap-2 text-[10px] text-pit-400">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ background: BAR }} />
          rolled
          <span className="ml-2 inline-block h-[2px] w-3 bg-pit-100/75" />
          expected
        </span>
        <span className="tabular">
          {active
            ? `${active.total}: ${active.actual} vs ${active.expected.toFixed(1)} (${active.z >= 0 ? '+' : ''}${active.z.toFixed(1)}σ)`
            : `${stats.rolls} rolls · 1 in ${(36 / WAYS[7]).toFixed(0)} is a seven`}
        </span>
      </figcaption>
    </figure>
  );
}

/* ------------------------------------------------------------------ *
 * Session equity
 * ------------------------------------------------------------------ */

export function EquityChart({
  history,
  names,
  seats = ['A', 'B'],
}: {
  history: RollRecord[];
  names: Record<SeatId, string>;
  /** Which seats to draw. A solo table passes one and gets one line. */
  seats?: SeatId[];
}) {
  const [hoverX, setHoverX] = React.useState<number | null>(null);
  const points = React.useMemo(() => equityCurve(history), [history]);

  const W = 320;
  const H = 150;
  const padL = 34;
  const padB = 16;
  const padT = 10;
  const plotW = W - padL - 34; // room for the direct end labels
  const plotH = H - padB - padT;

  if (points.length < 2) {
    return (
      <div className="flex h-[150px] items-center justify-center text-[11px] text-pit-400">
        The session curve appears once the dice are out.
      </div>
    );
  }

  const lo = Math.min(0, ...points.flatMap((p) => [p.A, p.B]));
  const hi = Math.max(0, ...points.flatMap((p) => [p.A, p.B]));
  const span = Math.max(1, hi - lo);
  const xOf = (i: number) => padL + (i / (points.length - 1)) * plotW;
  const yOf = (v: number) => padT + plotH - ((v - lo) / span) * plotH;

  const path = (key: SeatId) =>
    points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(p[key]).toFixed(1)}`).join(' ');

  const last = points[points.length - 1];
  const hovered: EquityPoint | null =
    hoverX === null
      ? null
      : points[Math.max(0, Math.min(points.length - 1, Math.round(((hoverX - padL) / plotW) * (points.length - 1))))];

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Cumulative win and loss for ${names.A} and ${names.B} across the session`}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setHoverX(((e.clientX - rect.left) / rect.width) * W);
        }}
        onMouseLeave={() => setHoverX(null)}
      >
        {/* Break-even is the only reference line that matters here. */}
        <line
          x1={padL}
          y1={yOf(0)}
          x2={padL + plotW}
          y2={yOf(0)}
          stroke={GRID}
          strokeWidth={1}
          strokeDasharray="3 3"
        />
        <text x={4} y={yOf(0) + 3} fontSize={9} fill={AXIS_INK}>
          even
        </text>
        <text x={4} y={padT + 6} fontSize={9} fill={AXIS_INK}>
          {money(hi)}
        </text>
        <text x={4} y={padT + plotH} fontSize={9} fill={AXIS_INK}>
          {money(lo)}
        </text>

        {seats.map((seat) => (
          <path
            key={seat}
            d={path(seat)}
            fill="none"
            stroke={SERIES[seat]}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {/* Direct labels at the live end, so the legend is not load-bearing.
            When both seats finish close together the labels are nudged apart,
            otherwise they overprint and neither is readable. */}
        {(() => {
          const yA = yOf(last.A);
          const yB = yOf(last.B);
          const clash = seats.length > 1 && Math.abs(yA - yB) < 11;
          const labelY: Record<SeatId, number> = clash
            ? { A: Math.min(yA, yB) - 4, B: Math.max(yA, yB) + 10 }
            : { A: yA + 3, B: yB + 3 };
          return seats.map((seat) => (
            <g key={`end-${seat}`}>
              <circle
                cx={xOf(points.length - 1)}
                cy={yOf(last[seat])}
                r={3}
                fill={SERIES[seat]}
                stroke="#14171c"
                strokeWidth={2}
              />
              <text
                x={xOf(points.length - 1) + 6}
                y={labelY[seat]}
                fontSize={9}
                fill="#e6e9ef"
                className="tabular"
              >
                {money(last[seat], { sign: true })}
              </text>
            </g>
          ));
        })()}

        {hovered && hoverX !== null ? (
          <g pointerEvents="none">
            <line
              x1={Math.max(padL, Math.min(padL + plotW, hoverX))}
              y1={padT}
              x2={Math.max(padL, Math.min(padL + plotW, hoverX))}
              y2={padT + plotH}
              stroke="rgba(255,255,255,0.25)"
              strokeWidth={1}
            />
            {seats.map((seat) => (
              <circle
                key={seat}
                cx={Math.max(padL, Math.min(padL + plotW, hoverX))}
                cy={yOf(hovered[seat])}
                r={3.5}
                fill={SERIES[seat]}
                stroke="#14171c"
                strokeWidth={2}
              />
            ))}
          </g>
        ) : null}
      </svg>

      <figcaption className="mt-1 flex items-center justify-between gap-3 text-[10px] text-pit-400">
        <span className="flex items-center gap-3">
          {seats.map((seat) => (
            <span key={seat} className="flex items-center gap-1.5">
              <span className="inline-block h-[2px] w-3" style={{ background: SERIES[seat] }} />
              <span className="max-w-20 truncate">{names[seat]}</span>
            </span>
          ))}
        </span>
        <span className="tabular">
          {hovered
            ? `roll ${hovered.index}: ${seats.map((seat) => money(hovered[seat], { sign: true })).join(' / ')}`
            : `last ${points.length - 1} rolls`}
        </span>
      </figcaption>
    </figure>
  );
}
