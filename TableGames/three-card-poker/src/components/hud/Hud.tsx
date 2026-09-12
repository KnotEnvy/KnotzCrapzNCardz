'use client';

/**
 * The panel beside the felt.
 *
 * In the order it matters while playing: what the session has cost against
 * what the game should cost, how the decisions are grading if the trainer is
 * on, what the table in front of you charges, and the switches. Everything
 * here is derived — nothing in this file can change the game.
 */

import * as React from 'react';
import { Button, cn, Meter, Panel, Stat, Toggle } from '@/components/ui/primitives';
import { Equity, HandTally, OutcomeBars } from './Charts';
import {
  ANTE_PLAY_TOTALS,
  STRATEGY_IDS,
  STRATEGY_LABEL,
  THREE_CARD_HANDS,
  antePlayFigures,
  qualifyingHands,
} from '@/lib/engine/analysis';
import { fmt, fmtSigned } from '@/lib/engine/money';
import { rulesShorthand, tableFigures } from '@/lib/engine/rules';
import { emptyStats } from '@/lib/engine/table';
import type { SeatStats } from '@/lib/engine/types';
import { HAND_CATEGORIES } from '@/lib/engine/types';
import { useGame } from '@/lib/store/useGame';

export function Hud({ className }: { className?: string }) {
  const trainer = useGame((s) => s.prefs.trainer);

  return (
    <aside
      className={cn('thin-scroll flex w-[19rem] shrink-0 flex-col gap-2 overflow-y-auto p-2', className)}
      aria-label="Session statistics"
    >
      <SessionPanel />
      {trainer ? <TrainerPanel /> : null}
      <TablePanel />
      <CoachingPanel />
    </aside>
  );
}

/* ------------------------------------------------------------------ *
 * The session
 * ------------------------------------------------------------------ */

/** Below this many hands a measured edge is noise with a decimal point. */
const ENOUGH_HANDS = 50;

function SessionPanel() {
  const table = useGame((s) => s.table);
  const agg = React.useMemo(() => aggregate(table.seats.filter((s) => s.occupied).map((s) => s.stats)), [table.seats]);
  const figures = tableFigures(table.rules);

  /*
   * Against the Ante for the house edge, and against Ante plus Play for the
   * element of risk — the two denominators the two published figures use.
   * Dividing by the wrong one moves the figure by forty percent, which is too
   * much to leave to a tooltip, so both are printed and both are named.
   */
  const edge = agg.anteStaked > 0 ? (-agg.mainNet / agg.anteStaked) * 100 : 0;
  const risk = agg.anteStaked > 0 ? (-agg.mainNet / (agg.anteStaked + agg.playWagered)) * 100 : 0;
  const decided = agg.plays + agg.folds;
  const playRate = decided > 0 ? agg.plays / decided : 0;
  const expectedPlayRate = ANTE_PLAY_TOTALS.OPTIMAL.plays / THREE_CARD_HANDS;
  const enough = agg.hands >= ENOUGH_HANDS;

  const recent = table.history.slice(0, 200);
  const qualified = recent.filter((r) => r.dealerQualified).length;
  const qualifyRate = qualifyingHands() / THREE_CARD_HANDS;

  return (
    <Panel title="Session" right={<span className="font-mono text-[10px] text-pit-500">round {table.round}</span>}>
      <Stat label="Net" value={fmtSigned(agg.net)} tone={agg.net > 0 ? 'good' : agg.net < 0 ? 'bad' : undefined} />
      <Stat label="Hands with an Ante" value={agg.hands} />
      <Stat label="Wagered" value={fmt(agg.anteStaked + agg.playWagered + agg.pairPlusWagered + agg.sixCardWagered)} />

      {/*
        Broken out by bet, because the total on its own cannot answer the one
        question a player has after a hand that lost the Ante and hit Pair
        Plus: where did the money go.
      */}
      <Stat
        label="— Ante and Play"
        value={fmtSigned(agg.mainNet)}
        tone={agg.mainNet > 0 ? 'good' : agg.mainNet < 0 ? 'bad' : undefined}
        /*
         * `fmt`, not `fmtSigned`: the signed formatter renders zero as the
         * word "even", which is right on a settlement chip and reads as a
         * typo in the middle of a sentence — "Includes even of Ante Bonus".
         */
        title={`The Ante, the Play and the Ante Bonus together. The Ante Bonus's share is ${fmt(agg.anteBonusNet)}, and it is paid on a played straight or better whatever the dealer holds.`}
      />
      {agg.pairPlusWagered > 0 ? (
        <Stat
          label="— Pair Plus"
          value={fmtSigned(agg.pairPlusNet)}
          tone={agg.pairPlusNet > 0 ? 'good' : agg.pairPlusNet < 0 ? 'bad' : undefined}
          title={`${fmt(agg.pairPlusWagered)} wagered.`}
        />
      ) : null}
      {agg.sixCardWagered > 0 ? (
        <Stat
          label="— 6 Card Bonus"
          value={fmtSigned(agg.sixCardNet)}
          tone={agg.sixCardNet > 0 ? 'good' : agg.sixCardNet < 0 ? 'bad' : undefined}
          title={`${fmt(agg.sixCardWagered)} wagered.`}
        />
      ) : null}

      <div className="my-2 border-t border-white/6" />

      <Stat
        label="House edge, measured"
        value={enough ? `${edge.toFixed(2)}%` : `needs ${ENOUGH_HANDS - agg.hands} more`}
        tone={enough ? (edge > 0 ? 'bad' : 'good') : undefined}
        title={`Your loss on the Ante and Play, Ante Bonus included, per dollar Anted. Exactly ${figures.antePlay.houseEdge.toFixed(2)}% for perfect play at this table — and it takes thousands of hands to settle anywhere near it.`}
      />
      <Stat
        label="Element of risk, measured"
        value={enough ? `${risk.toFixed(2)}%` : '—'}
        title={`The same loss per dollar put at risk, Play included. Exactly ${figures.antePlay.elementOfRisk.toFixed(2)}% for perfect play here.`}
      />
      <Stat
        label="Hands played"
        value={decided > 0 ? `${Math.round(playRate * 100)}%` : '—'}
        title={`Perfect play plays ${(expectedPlayRate * 100).toFixed(1)}% of hands: everything Q-6-4 or better.`}
      />
      <Stat
        label="Dealer qualified"
        value={recent.length > 0 ? `${Math.round((qualified / recent.length) * 100)}%` : '—'}
        title={`Over the last ${recent.length} rounds. Exactly ${(qualifyRate * 100).toFixed(1)}% of deals in the long run.`}
      />

      <div className="my-2 border-t border-white/6" />
      <OutcomeBars stats={agg} />
      <div className="my-2 border-t border-white/6" />
      <HandTally stats={agg} />
      <div className="my-2 border-t border-white/6" />
      <Equity history={table.history} />
    </Panel>
  );
}

function aggregate(all: readonly SeatStats[]): SeatStats {
  const out = emptyStats(0);
  for (const s of all) {
    out.rounds += s.rounds;
    out.hands += s.hands;
    out.plays += s.plays;
    out.folds += s.folds;
    out.wins += s.wins;
    out.noQualify += s.noQualify;
    out.pushes += s.pushes;
    out.losses += s.losses;
    out.anteStaked += s.anteStaked;
    out.playWagered += s.playWagered;
    out.mainNet += s.mainNet;
    out.anteBonusNet += s.anteBonusNet;
    out.pairPlusWagered += s.pairPlusWagered;
    out.pairPlusNet += s.pairPlusNet;
    out.sixCardWagered += s.sixCardWagered;
    out.sixCardNet += s.sixCardNet;
    out.net += s.net;
    out.peakBankroll = Math.max(out.peakBankroll, s.peakBankroll);
    out.decisions += s.decisions;
    out.correctDecisions += s.correctDecisions;
    out.evGivenUp += s.evGivenUp;
    for (const c of HAND_CATEGORIES) out.categories[c] += s.categories[c];
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * The trainer
 * ------------------------------------------------------------------ */

function TrainerPanel() {
  const grades = useGame((s) => s.grades);
  const seats = useGame((s) => s.table.seats);
  const correct = grades.filter((g) => g.correct).length;
  const pct = grades.length === 0 ? 100 : Math.round((correct / grades.length) * 100);
  const lifetime = seats.reduce(
    (a, s) => ({ n: a.n + s.stats.decisions, ok: a.ok + s.stats.correctDecisions, lost: a.lost + s.stats.evGivenUp }),
    { n: 0, ok: 0, lost: 0 },
  );

  return (
    <Panel title="Trainer" right={<span className="font-mono text-[11px] text-pit-300">{pct}%</span>}>
      <Meter value={pct / 100} tone={pct >= 95 ? 'win' : pct >= 80 ? 'brass' : 'lose'} label="Accuracy" />
      {lifetime.n > 0 ? (
        <>
          <p className="mt-1.5 text-[10px] text-pit-500">
            {lifetime.ok} of {lifetime.n} decisions right this session
            {grades.length > 0 ? ` · last ${grades.length} shown` : ''}
          </p>
          {/*
            The number the trainer exists for: not "you were wrong three
            times" but what being wrong cost, in expected value, exactly.
          */}
          <Stat
            label="Expected value given up"
            value={fmt(lifetime.lost)}
            tone={lifetime.lost > 0 ? 'bad' : 'good'}
            title="What your mistaken plays and folds were worth on average against the better choice, worked out from every hand the dealer could have held."
          />
        </>
      ) : null}
      {grades.length === 0 ? (
        <p className="mt-2 text-[10px] text-pit-500">Every play and fold gets marked against the exact answer.</p>
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
              <span className="font-mono">{g.hand}</span>{' '}
              {g.correct ? (
                <span className="text-win">{g.played.toLowerCase()} ✓</span>
              ) : (
                <>
                  <span className="text-lose">
                    {g.played.toLowerCase()} → {g.best.toLowerCase()} · cost {fmt(g.evGivenUp)}
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

/* ------------------------------------------------------------------ *
 * The table
 * ------------------------------------------------------------------ */

function TablePanel() {
  const rules = useGame((s) => s.table.rules);
  const openDialog = useGame((s) => s.openDialog);
  const f = tableFigures(rules);

  return (
    <Panel title="Table">
      <Stat label="Posted" value={<span className="text-[10px]">{rulesShorthand(rules)}</span>} />
      <Stat
        label="Ante and Play"
        value={`${f.antePlay.houseEdge.toFixed(2)}%`}
        title={`House edge per dollar Anted, for perfect play: exact. Per dollar put at risk it is ${f.antePlay.elementOfRisk.toFixed(2)}%.`}
      />
      {f.pairPlus ? (
        <Stat label="Pair Plus" value={`${f.pairPlus.houseEdge.toFixed(2)}%`} tone={f.pairPlus.houseEdge > 5 ? 'bad' : undefined} title="House edge per dollar wagered: exact." />
      ) : null}
      {f.sixCard ? (
        <Stat label="6 Card Bonus" value={`${f.sixCard.houseEdge.toFixed(2)}%`} tone="bad" title="House edge per dollar wagered: exact." />
      ) : null}
      <Stat label="Ante limits" value={`${fmt(rules.minBet)} – ${fmt(rules.maxBet)}`} />
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        <Button size="sm" onClick={() => openDialog('setup')}>
          Rules
        </Button>
        <Button size="sm" onClick={() => openDialog('strategy')}>
          Strategy
        </Button>
        <Button size="sm" onClick={() => openDialog('paytables')}>
          Pays
        </Button>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ *
 * Coaching
 * ------------------------------------------------------------------ */

function CoachingPanel() {
  const prefs = useGame((s) => s.prefs);
  const setPref = useGame((s) => s.setPref);
  const strategy = useGame((s) => s.bot.strategy);
  const setBot = useGame((s) => s.setBot);
  const anteBonus = useGame((s) => s.table.rules.anteBonusTable);

  /*
   * What each way of playing costs at this table, beside the switch that
   * picks it — so choosing "never fold" for autoplay is choosing a number, and
   * the number is on the button.
   */
  const strategies = React.useMemo(
    () => STRATEGY_IDS.map((id) => ({ id, edge: antePlayFigures(anteBonus, id).houseEdge })),
    [anteBonus],
  );

  return (
    <Panel title="Coaching">
      <Toggle
        checked={prefs.hints}
        onChange={(v) => setPref('hints', v)}
        label="Show the correct play"
        hint="Before you decide, with what each choice is worth."
      />
      <Toggle
        checked={prefs.trainer}
        onChange={(v) => setPref('trainer', v)}
        label="Grade my decisions"
        hint="Marks every play and fold, and totals what the mistakes cost."
      />
      <div className="mt-1.5 border-t border-white/6 pt-1.5">
        <span className="block text-xs text-pit-100">Autoplay plays</span>
        <span className="block text-[10px] leading-tight text-pit-400">
          For watching what a way of playing costs. The house edge of each at this table:
        </span>
        <div className="mt-1.5 grid gap-1" role="radiogroup" aria-label="Autoplay strategy">
          {strategies.map(({ id, edge }) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={strategy === id}
              onClick={() => setBot('strategy', id)}
              className={cn(
                'flex items-center justify-between rounded border px-2 py-1 text-left text-[11px] transition-colors',
                strategy === id
                  ? 'border-brass-500/60 bg-brass-500/10 text-pit-100'
                  : 'border-white/8 bg-pit-850 text-pit-300 hover:border-white/20',
              )}
            >
              <span>{STRATEGY_LABEL[id]}</span>
              <span className="font-mono tabular-nums text-pit-400">{edge.toFixed(2)}%</span>
            </button>
          ))}
        </div>
      </div>
    </Panel>
  );
}
