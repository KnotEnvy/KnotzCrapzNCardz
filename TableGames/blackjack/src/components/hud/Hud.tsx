'use client';

/**
 * The panel beside the felt.
 *
 * Four things, in the order they matter while you are playing: what the shoe
 * is doing, what the session has cost, what the count says if you have asked
 * it to, and how your decisions are grading if the trainer is on. Everything
 * here is derived — nothing in this file can change the game.
 */

import * as React from 'react';
import { Button, cn, Meter, Panel, Segmented, Stat, Toggle } from '@/components/ui/primitives';
import { Equity, OutcomeBars } from './Charts';
import { fmt, fmtSigned } from '@/lib/engine/money';
import { estimateHouseEdge, rulesShorthand } from '@/lib/engine/rules';
import { decksRemaining, penetrationSoFar, remaining } from '@/lib/engine/shoe';
import { COUNT_ORDER, COUNT_SYSTEMS, betRamp, edgeAt, fmtCount } from '@/lib/strategy/counting';
import { useCount, useGame } from '@/lib/store/useGame';
import type { SeatStats } from '@/lib/engine/types';

export function Hud({ className }: { className?: string }) {
  const table = useGame((s) => s.table);
  const prefs = useGame((s) => s.prefs);
  const setPref = useGame((s) => s.setPref);
  const openDialog = useGame((s) => s.openDialog);

  return (
    <aside
      className={cn('thin-scroll flex w-[19rem] shrink-0 flex-col gap-2 overflow-y-auto p-2', className)}
      aria-label="Session statistics"
    >
      <ShoePanel />
      <SessionPanel />
      {prefs.counting ? <CountPanel /> : null}
      {prefs.trainer ? <TrainerPanel /> : null}

      <Panel title="Table">
        <Stat label="Rules" value={<span className="text-[10px]">{rulesShorthand(table.rules)}</span>} />
        <Stat
          label="House edge"
          value={`${estimateHouseEdge(table.rules).toFixed(2)}%`}
          tone={estimateHouseEdge(table.rules) > 0.8 ? 'bad' : 'good'}
          title="Estimated for a basic-strategy player by summing the published per-rule effects. Accurate to about a tenth of a percent."
        />
        <Stat label="Limits" value={`${fmt(table.rules.minBet)} – ${fmt(table.rules.maxBet)}`} />
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <Button size="sm" onClick={() => openDialog('setup')}>
            Rules
          </Button>
          <Button size="sm" onClick={() => openDialog('chart')}>
            Chart
          </Button>
        </div>
      </Panel>

      <Panel title="Coaching">
        <Toggle
          checked={prefs.hints}
          onChange={(v) => setPref('hints', v)}
          label="Show the correct play"
          hint="Before you act, with the reasoning."
        />
        <Toggle
          checked={prefs.trainer}
          onChange={(v) => setPref('trainer', v)}
          label="Grade my decisions"
          hint="Marks every play against the chart afterwards."
        />
        <Toggle
          checked={prefs.counting}
          onChange={(v) => setPref('counting', v)}
          label="Show the count"
          hint="Running and true, from the cards turned face up."
        />
      </Panel>
    </aside>
  );
}

/* ------------------------------------------------------------------ *
 * The shoe
 * ------------------------------------------------------------------ */

function ShoePanel() {
  const table = useGame((s) => s.table);
  const reshuffle = useGame((s) => s.reshuffle);
  const pen = penetrationSoFar(table.shoe);
  const cut = table.shoe.cutAt / Math.max(1, table.shoe.size);

  return (
    <Panel
      title="Shoe"
      right={
        <Button size="sm" variant="ghost" onClick={reshuffle} disabled={table.phase !== 'BETTING'}>
          Shuffle
        </Button>
      }
    >
      <Stat label="Cards left" value={remaining(table.shoe)} />
      <Stat label="Decks left" value={decksRemaining(table.shoe).toFixed(1)} />
      <Stat label="Round" value={table.round} />
      <div className="relative mt-2">
        <Meter value={pen} tone={table.shoe.cutReached ? 'lose' : 'brass'} label="Shoe penetration" />
        {/* The cut card's position, marked on the meter so the reshuffle is
            something you can see coming rather than something that happens. */}
        <div
          className="absolute top-0 h-1.5 w-[2px] bg-print-red"
          style={{ left: `${cut * 100}%` }}
          title="Cut card"
        />
      </div>
      <p className="mt-1 text-[10px] text-pit-500">
        {table.shoe.cutReached
          ? 'Cut card is out — new shoe after this round.'
          : `${Math.round(pen * 100)}% dealt, cut at ${Math.round(cut * 100)}%.`}
      </p>
    </Panel>
  );
}

/* ------------------------------------------------------------------ *
 * The session
 * ------------------------------------------------------------------ */

function SessionPanel() {
  const table = useGame((s) => s.table);
  const seats = table.seats.filter((s) => s.occupied);
  const agg = React.useMemo(() => aggregate(seats.map((s) => s.stats)), [seats]);

  /*
   * The main game's edge, against the main game's stake. `net` includes side
   * bets and insurance, and dividing that by the main wager alone is the exact
   * mistake autoplay.ts warns about — one Lucky Ladies hit makes the figure
   * arbitrarily wrong, and it is broken out below precisely so it can be
   * subtracted here.
   */
  const mainNet = agg.net - agg.sideNet - agg.insuranceNet;
  /*
   * Against the *initial* wager, which is what the house edge shown beside it
   * means and what every published figure means. Dividing by `agg.wagered` —
   * the total action, about 1.133 times the stake under basic strategy —
   * printed a measured 0.298% two rows under a model saying 0.40%, and the
   * comparison between those two numbers is the reason the panel exists.
   */
  const measured = agg.staked > 0 ? (-mainNet / agg.staked) * 100 : 0;

  return (
    <Panel title="Session">
      <Stat
        label="Net"
        value={fmtSigned(agg.net)}
        tone={agg.net > 0 ? 'good' : agg.net < 0 ? 'bad' : undefined}
      />
      <Stat label="Hands" value={agg.handsPlayed} />
      <Stat label="Wagered" value={fmt(agg.wagered + agg.sideWagered)} />
      {/*
        Broken out because the total on its own is unreadable on the hand that
        matters: a wager lost and a side bet hit shows a positive net beside a
        hundred-percent loss rate, and the player is left to work out which.
      */}
      {agg.sideWagered > 0 ? (
        <Stat
          label="— side bets"
          value={fmtSigned(agg.sideNet)}
          tone={agg.sideNet > 0 ? 'good' : agg.sideNet < 0 ? 'bad' : undefined}
          title={`${fmt(agg.sideWagered)} wagered on side bets.`}
        />
      ) : null}
      {agg.insuranceNet !== 0 ? (
        <Stat
          label="— insurance"
          value={fmtSigned(agg.insuranceNet)}
          tone={agg.insuranceNet > 0 ? 'good' : 'bad'}
        />
      ) : null}
      <Stat
        label="Measured edge"
        value={agg.handsPlayed >= 25 ? `${measured.toFixed(2)}%` : `needs ${25 - agg.handsPlayed} more`}
        tone={measured > 0 ? 'bad' : measured < 0 ? 'good' : undefined}
        title="Your loss on the hands themselves, per dollar you put in the circle before the cards came out — not per dollar of total action, which the Wagered line above counts and which doubles and splits push about 13% higher. Every published house edge means the first one. Side bets and insurance are shown separately below, and it takes thousands of hands to mean anything."
      />

      <div className="my-2 border-t border-white/6" />

      <OutcomeBars stats={agg} />

      <div className="my-2 border-t border-white/6" />

      <Equity history={table.history} />
    </Panel>
  );
}

function aggregate(all: readonly SeatStats[]): SeatStats {
  return all.reduce<SeatStats>(
    (a, s) => ({
      handsPlayed: a.handsPlayed + s.handsPlayed,
      wins: a.wins + s.wins,
      losses: a.losses + s.losses,
      pushes: a.pushes + s.pushes,
      blackjacks: a.blackjacks + s.blackjacks,
      busts: a.busts + s.busts,
      surrenders: a.surrenders + s.surrenders,
      doubles: a.doubles + s.doubles,
      splits: a.splits + s.splits,
      wagered: a.wagered + s.wagered,
      staked: a.staked + s.staked,
      sideWagered: a.sideWagered + s.sideWagered,
      sideNet: a.sideNet + s.sideNet,
      insuranceNet: a.insuranceNet + s.insuranceNet,
      net: a.net + s.net,
      peakBankroll: Math.max(a.peakBankroll, s.peakBankroll),
      decisions: a.decisions + s.decisions,
      correctDecisions: a.correctDecisions + s.correctDecisions,
    }),
    {
      handsPlayed: 0, wins: 0, losses: 0, pushes: 0, blackjacks: 0, busts: 0,
      surrenders: 0, doubles: 0, splits: 0, wagered: 0, staked: 0, sideWagered: 0,
      sideNet: 0, insuranceNet: 0, net: 0, peakBankroll: 0,
      decisions: 0, correctDecisions: 0,
    },
  );
}

/* ------------------------------------------------------------------ *
 * The count
 * ------------------------------------------------------------------ */

function CountPanel() {
  const bot = useGame((s) => s.bot);
  const setBot = useGame((s) => s.setBot);
  const table = useGame((s) => s.table);
  const system = useGame((s) => s.prefs.countSystem);
  const setPref = useGame((s) => s.setPref);
  const count = useCount();
  const spec = COUNT_SYSTEMS[system];
  const edge = edgeAt(count.hiLo, estimateHouseEdge(table.rules));

  return (
    <Panel
      title="Count"
      right={
        <span className="text-[9px] text-pit-500" title={spec.note}>
          BC {spec.bc.toFixed(2)}
        </span>
      }
    >
      <Segmented
        value={system}
        onChange={(v) => setPref('countSystem', v)}
        options={COUNT_ORDER.map((id) => ({
          value: id,
          label: COUNT_SYSTEMS[id].name,
          title: COUNT_SYSTEMS[id].note,
        }))}
        className="mb-2 w-full flex-wrap"
      />

      <div className="mb-2 flex items-baseline justify-center gap-4">
        <div className="text-center">
          <div className="font-mono text-2xl tabular-nums text-pit-100">
            {count.running > 0 ? '+' : ''}
            {count.running}
          </div>
          <div className="text-[9px] tracking-wider text-pit-500 uppercase">running</div>
        </div>
        {spec.balanced ? (
          <div className="text-center">
            <div
              className={cn(
                'font-mono text-2xl tabular-nums',
                count.true >= 2 ? 'text-win' : count.true <= -2 ? 'text-lose' : 'text-pit-100',
              )}
            >
              {fmtCount(count.true)}
            </div>
            <div className="text-[9px] tracking-wider text-pit-500 uppercase">true</div>
          </div>
        ) : null}
        {/*
          The number every published index is quoted in. Shown whenever the
          selected system is not Hi-Lo, because the edge, the ramp and the
          deviations below are all read off it — and showing them against a
          count in another system's units is how an untouched Knock-Out shoe
          came to be labelled a 10% player disadvantage.
        */}
        {spec.id !== 'HI_LO' ? (
          <div className="text-center">
            <div
              className={cn(
                'font-mono text-2xl tabular-nums',
                count.hiLo >= 2 ? 'text-win' : count.hiLo <= -2 ? 'text-lose' : 'text-pit-100',
              )}
            >
              {fmtCount(count.hiLo)}
            </div>
            <div className="text-[9px] tracking-wider text-pit-500 uppercase">Hi-Lo equiv.</div>
          </div>
        ) : null}
      </div>

      <Stat
        label="Your edge"
        value={`${edge > 0 ? '+' : ''}${edge.toFixed(2)}%`}
        tone={edge > 0 ? 'good' : 'bad'}
        title="The game's edge, moved by half a percent per unit of Hi-Lo true count."
      />
      <Stat label="Suggested bet" value={`${betRamp(count.hiLo)} unit${betRamp(count.hiLo) === 1 ? '' : 's'}`} />
      {spec.sideCountAces ? (
        <Stat label="Aces seen" value={count.acesSeen} title="This system is ace-neutral; the side count is yours to keep." />
      ) : null}

      <p className="mt-2 text-[10px] leading-tight text-pit-500">
        Counted from the cards that have been turned face up — not the shoe, and not the dealer&rsquo;s
        hole card until they turn it.
      </p>

      {/*
        The two switches that make the count worth keeping.

        Everything above this — the ramp, the edge, the index plays in the
        chart dialog — described what a counter *would* do while the bot that
        plays the game had them both hard off, because `setBot` existed and
        nothing in the app called it. A betting ramp shown beside a bot that
        flat-bets is the same defect as a rule switch priced at 0.08% that
        does nothing, and this game has now shipped that defect twice.
      */}
      <div className="mt-2 border-t border-white/6 pt-1.5">
        <Toggle
          checked={bot.spread}
          onChange={(v) => setBot('spread', v)}
          label="Autoplay bets the ramp"
          hint="Off, the bot plays whatever is in the circle. On, it bets the units shown above."
        />
        <Toggle
          checked={bot.deviations}
          onChange={(v) => setBot('deviations', v)}
          label="Autoplay takes index plays"
          hint="Insurance above +3, and the Illustrious 18 departures from the chart."
        />
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ *
 * The trainer
 * ------------------------------------------------------------------ */

function TrainerPanel() {
  const grades = useGame((s) => s.grades);
  const seats = useGame((s) => s.table.seats);
  const correct = grades.filter((g) => g.correct).length;
  const pct = grades.length === 0 ? 100 : Math.round((correct / grades.length) * 100);

  // The rolling list above is the last forty plays; the seat's own tally is
  // every play of the session and survives a reload.
  const lifetime = seats.reduce(
    (a, s) => ({ n: a.n + s.stats.decisions, ok: a.ok + s.stats.correctDecisions }),
    { n: 0, ok: 0 },
  );

  return (
    <Panel title="Trainer" right={<span className="font-mono text-[11px] text-pit-300">{pct}%</span>}>
      <Meter value={pct / 100} tone={pct >= 95 ? 'win' : pct >= 80 ? 'brass' : 'lose'} label="Accuracy" />
      {lifetime.n > 0 ? (
        <p className="mt-1.5 text-[10px] text-pit-500">
          {lifetime.ok} of {lifetime.n} correct this session
          {grades.length > 0 ? ` · last ${grades.length} shown` : ''}
        </p>
      ) : null}
      {grades.length === 0 ? (
        <p className="mt-2 text-[10px] text-pit-500">Every decision gets marked against the chart.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {grades.slice(0, 6).map((g) => (
            <li
              key={g.id}
              className={cn(
                'sweep-in rounded border px-2 py-1 text-[10px]',
                g.correct ? 'border-win/25 bg-win/8 text-pit-300' : 'border-lose/35 bg-lose/8 text-pit-200',
              )}
            >
              <span className="font-mono">{g.hand} v {g.upcard}</span>{' '}
              {g.correct ? (
                <span className="text-win">{g.played.toLowerCase()} ✓</span>
              ) : (
                <>
                  <span className="text-lose">
                    {g.played.toLowerCase()} → {g.best.toLowerCase()}
                  </span>
                  <span className="mt-0.5 block leading-tight text-pit-400">{g.why}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
