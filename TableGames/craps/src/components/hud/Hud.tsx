'use client';

/**
 * The pro heads-up display: what the dice have done, and what it has cost.
 */

import * as React from 'react';
import { DistributionChart, EquityChart } from './Charts';
import { PipFace } from '@/components/table/Pips';
import { Panel, Stat, cn, money } from '@/components/ui/primitives';
import { seatSummary, tableSummary } from '@/lib/engine/stats';
import { allStrategies, useGame } from '@/lib/store/useGame';
import type { RollOutcome, RollRecord, SeatId } from '@/lib/engine/types';

const OUTCOME_TONE: Record<RollOutcome, string> = {
  NATURAL: 'bg-emerald-500/20 text-emerald-200 border-emerald-400/40',
  POINT_MADE: 'bg-emerald-500/25 text-emerald-100 border-emerald-300/50',
  POINT_ESTABLISHED: 'bg-amber-500/15 text-amber-200 border-amber-400/35',
  CRAPS: 'bg-rose-500/15 text-rose-200 border-rose-400/30',
  SEVEN_OUT: 'bg-rose-600/30 text-rose-100 border-rose-400/50',
  NEUTRAL: 'bg-white/5 text-pit-300 border-white/10',
};

const OUTCOME_WORD: Record<RollOutcome, string> = {
  NATURAL: 'winner',
  POINT_MADE: 'point made',
  POINT_ESTABLISHED: 'point set',
  CRAPS: 'craps',
  SEVEN_OUT: 'seven out',
  NEUTRAL: '',
};

/* ------------------------------------------------------------------ *
 * Roll history
 * ------------------------------------------------------------------ */

function RollHistory({ history }: { history: RollRecord[] }) {
  const strip = React.useRef<HTMLDivElement>(null);
  const recent = history.slice(-60);

  React.useEffect(() => {
    strip.current?.scrollTo({ left: strip.current.scrollWidth, behavior: 'smooth' });
  }, [history.length]);

  if (recent.length === 0) {
    return <p className="py-3 text-[11px] text-pit-400">No rolls yet. Get some money down.</p>;
  }

  return (
    <div ref={strip} className="thin-scroll -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
      {recent.map((rec) => (
        <div
          key={rec.index}
          className={`flex shrink-0 flex-col items-center gap-1 rounded-md border px-1.5 py-1.5 ${OUTCOME_TONE[rec.outcome]}`}
          title={`Roll ${rec.index}: ${rec.roll.d1}-${rec.roll.d2}${OUTCOME_WORD[rec.outcome] ? ` — ${OUTCOME_WORD[rec.outcome]}` : ''}`}
        >
          <svg width={30} height={14} viewBox="0 0 30 14" aria-hidden>
            <PipFace x={0} y={0} size={14} value={rec.roll.d1} face="#f2ead8" pip="#12160f" />
            <PipFace x={16} y={0} size={14} value={rec.roll.d2} face="#f2ead8" pip="#12160f" />
          </svg>
          <span className="tabular text-[11px] font-bold leading-none">{rec.roll.total}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Strategy log
 * ------------------------------------------------------------------ */

/**
 * What the strategies actually did, newest first.
 *
 * A bot that presses a number silently is indistinguishable from a bug, so
 * every call a strategy makes — and every one the table refused — turns up
 * here against the roll it happened on, next to the rule that made it.
 */
function StrategyLog({ seats }: { seats: SeatId[] }) {
  const table = useGame((s) => s.table);
  const seatStrategy = useGame((s) => s.seatStrategy);
  const strategyMemory = useGame((s) => s.strategyMemory);
  const customStrategies = useGame((s) => s.customStrategies);
  const library = allStrategies(customStrategies);

  const live = seats.filter((seat) => seatStrategy[seat].strategyId);
  if (live.length === 0) return null;

  const rows = live
    .flatMap((seat) =>
      (strategyMemory[seat]?.log ?? []).map((entry, i) => ({ seat, entry, i })),
    )
    // Newest roll at the top, but the calls within one roll keep the order
    // they were made in so a multi-action rule still reads downwards.
    .sort((a, b) => b.entry.roll - a.entry.roll || a.i - b.i)
    .slice(0, 16);

  const names = live
    .map((seat) => {
      const strategy = library.find((x) => x.id === seatStrategy[seat].strategyId);
      const stopped = strategyMemory[seat]?.stopped;
      return `${table.seats[seat].name}: ${strategy?.name ?? '—'}${stopped ? ' (stopped)' : ''}`;
    })
    .join(' · ');

  return (
    <Panel title="Strategy log" bodyClassName="p-2">
      <p className="mb-2 px-1 text-[10px] leading-relaxed text-pit-400">{names}</p>
      {rows.length === 0 ? (
        <p className="px-1 pb-1 text-[11px] text-pit-400">
          Nothing called yet. The strategy acts when the dice do.
        </p>
      ) : (
        <ul className="space-y-1">
          {rows.map(({ seat, entry, i }) => (
            <li
              key={`${seat}-${entry.roll}-${i}`}
              className="flex items-baseline gap-2 rounded px-1 py-0.5 odd:bg-white/[0.02]"
            >
              <span
                className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: seat === 'A' ? 'var(--color-seat-a)' : 'var(--color-seat-b)' }}
                aria-label={table.seats[seat].name}
              />
              <span className="tabular shrink-0 text-[10px] text-pit-400">{entry.roll}</span>
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    'block truncate text-[11px] leading-tight',
                    entry.ok ? 'text-pit-100' : 'text-lose',
                  )}
                >
                  {entry.text}
                </span>
                <span className="block truncate text-[10px] leading-tight text-pit-400">
                  {entry.rule}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ *
 * The panel
 * ------------------------------------------------------------------ */

export function Hud() {
  const table = useGame((s) => s.table);
  const summary = tableSummary(table);
  const seatIds: SeatId[] = table.solo ? ['A'] : ['A', 'B'];
  const seats = seatIds.map((id) => seatSummary(table, id));

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <Panel title="Roll history" bodyClassName="p-2">
        <RollHistory history={table.history} />
      </Panel>

      <StrategyLog seats={seatIds} />

      <Panel title="Dice distribution">
        <DistributionChart stats={table.stats} />
      </Panel>

      <Panel title="Session">
        <EquityChart
          history={table.history}
          names={{ A: table.seats.A.name, B: table.seats.B.name }}
          seats={seatIds}
        />
      </Panel>

      <Panel title="Table">
        <div className="grid grid-cols-3 gap-x-3 gap-y-3">
          <Stat label="Rolls" value={summary.rolls.toLocaleString()} />
          <Stat
            label="Rolls / seven"
            value={summary.rollsPerSeven ? summary.rollsPerSeven.toFixed(2) : '—'}
            sub="theory 6.00"
          />
          <Stat label="Hand" value={summary.currentHand} sub={`best ${summary.longestHand}`} />
          <Stat label="Points made" value={summary.pointsMade} />
          <Stat label="Seven outs" value={summary.sevenOuts} />
          <Stat
            label="Point rate"
            value={summary.rolls ? `${(summary.pointRate * 100).toFixed(0)}%` : '—'}
            sub="theory 40%"
          />
        </div>
      </Panel>

      <Panel title="Net yield">
        <div className="space-y-3">
          {seats.map((s) => (
            <div key={s.seat} className="grid grid-cols-3 gap-x-3">
              <Stat
                label={s.name}
                value={money(s.net, { sign: true })}
                tone={s.net > 0 ? 'up' : s.net < 0 ? 'down' : 'neutral'}
                sub={`from ${money(s.buyIn)}`}
              />
              <Stat
                label="Yield"
                value={s.totalWagered ? `${(s.yield * 100).toFixed(2)}%` : '—'}
                tone={s.yield > 0 ? 'up' : s.yield < 0 ? 'down' : 'neutral'}
                sub={`${money(s.totalWagered)} wagered`}
              />
              <Stat label="Drawdown" value={money(s.drawdown)} sub="from peak" />
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}
