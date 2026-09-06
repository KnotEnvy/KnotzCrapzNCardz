'use client';

/**
 * Everything that opens over the felt.
 *
 * Four dialogs: the rule editor, the strategy chart, the side-bet paytables,
 * and the help card. They share nothing but the modal shell, because they are
 * four different things that happen to be presented the same way.
 */

import * as React from 'react';
import { Button, Meter, Modal, MoneyInput, Panel, Segmented, Stat, Toggle, cn } from '@/components/ui/primitives';
import { dollars, fmt } from '@/lib/engine/money';
import {
  RULE_PRESETS,
  estimateHouseEdge,
  matchingPreset,
  ruleEffects,
  rulesShorthand,
} from '@/lib/engine/rules';
import { SIDE_BET_ORDER, SIDE_BET_SPECS, ratioLabel } from '@/lib/engine/sidebets';
import { CODE_LABEL, CODE_TONE, UPCARDS, chartFor, upcardLabel, type Code } from '@/lib/strategy/basic';
import { DEVIATIONS } from '@/lib/strategy/counting';
import { useGame } from '@/lib/store/useGame';
import type { BlackjackPayout, DoubleRule, SurrenderRule, TableRules } from '@/lib/engine/types';

export function Dialogs() {
  const dialog = useGame((s) => s.dialog);
  const close = React.useCallback(() => useGame.getState().openDialog(null), []);

  return (
    <>
      <SetupDialog open={dialog === 'setup'} onClose={close} />
      <ChartDialog open={dialog === 'chart'} onClose={close} />
      <SideBetsDialog open={dialog === 'sidebets'} onClose={close} />
      <HelpDialog open={dialog === 'help'} onClose={close} />
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Rules
 * ------------------------------------------------------------------ */

/**
 * The rule editor.
 *
 * Its whole argument is the panel down the right: every switch is priced, the
 * list is sorted by what each is worth, and the total sits at the top. A
 * player who arrives believing "six decks or eight, what does it matter" and
 * leaves knowing that 6:5 costs four times what the deck count does has got
 * the only lesson this screen has to teach.
 */
function SetupDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const table = useGame((s) => s.table);
  // The editor holds a draft, and the draft has to start from whatever the
  // table's rules are *when it opens*. Rather than sync that with an effect —
  // which would re-render the whole dialog a second time and fight the user's
  // edits if the rules changed underneath — the body is a child keyed on the
  // rules it was opened with, so opening it is a mount and the draft is simply
  // its initial state.
  if (!open) return null;
  return <SetupBody key={JSON.stringify(table.rules)} onClose={onClose} />;
}

function SetupBody({ onClose }: { onClose: () => void }) {
  const table = useGame((s) => s.table);
  const setRules = useGame((s) => s.setRules);
  const applyPreset = useGame((s) => s.applyPreset);

  const [draft, setDraft] = React.useState<TableRules>(() => ({
    ...table.rules,
    sideBets: { ...table.rules.sideBets },
  }));

  const set = <K extends keyof TableRules>(key: K, value: TableRules[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const edge = estimateHouseEdge(draft);
  const effects = ruleEffects(draft);
  const preset = matchingPreset(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(table.rules);

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title="House rules"
      subtitle="Changing anything puts a fresh shoe in."
    >
      <div className="grid gap-4 md:grid-cols-[1fr_15rem]">
        <div className="space-y-3">
          <Panel title="Preset">
            <div className="grid gap-1.5 sm:grid-cols-2">
              {RULE_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setDraft({ ...p.rules, sideBets: { ...p.rules.sideBets } })}
                  className={cn(
                    'rounded-md border p-2 text-left transition-colors',
                    preset?.id === p.id
                      ? 'border-brass-500/60 bg-brass-500/10'
                      : 'border-white/8 bg-pit-850 hover:border-white/20',
                  )}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs font-medium text-pit-100">{p.name}</span>
                    <span className="font-mono text-[10px] text-pit-400">
                      {estimateHouseEdge(p.rules).toFixed(2)}%
                    </span>
                  </div>
                  <p className="mt-0.5 text-[10px] leading-tight text-pit-400">{p.note}</p>
                </button>
              ))}
            </div>
          </Panel>

          <Panel title="The shoe">
            <div className="flex items-center justify-between gap-3 py-1">
              <span className="text-xs text-pit-100">Decks</span>
              <Segmented
                value={String(draft.decks)}
                onChange={(v) => set('decks', Number(v))}
                options={[1, 2, 4, 6, 8].map((n) => ({ value: String(n), label: String(n) }))}
              />
            </div>
            <div className="py-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-pit-100">Penetration</span>
                <span className="font-mono text-[11px] text-pit-300">
                  {Math.round(draft.penetration * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={50}
                max={90}
                step={5}
                value={draft.penetration * 100}
                onChange={(e) => set('penetration', Number(e.target.value) / 100)}
                aria-label="Penetration"
                className="mt-1 w-full accent-[var(--color-brass-500)]"
              />
              <p className="text-[10px] text-pit-500">
                How deep the cut card goes. Only counting cares, and it cares a great deal.
              </p>
            </div>
          </Panel>

          <Panel title="The game">
            <div className="flex items-center justify-between gap-3 py-1">
              <span className="text-xs text-pit-100">Blackjack pays</span>
              <Segmented
                value={draft.blackjackPays}
                onChange={(v) => set('blackjackPays', v as BlackjackPayout)}
                options={[
                  { value: '3:2', label: '3:2' },
                  { value: '6:5', label: '6:5' },
                  { value: '1:1', label: '1:1' },
                ]}
              />
            </div>
            <Toggle
              checked={draft.hitsSoft17}
              onChange={(v) => set('hitsSoft17', v)}
              label="Dealer hits soft 17"
              hint="Ace-six is drawn to rather than stood on."
            />
            <div className="flex items-center justify-between gap-3 py-1">
              <span className="text-xs text-pit-100">Double on</span>
              <Segmented
                value={draft.double}
                onChange={(v) => set('double', v as DoubleRule)}
                options={[
                  { value: 'ANY2', label: 'Any 2' },
                  { value: '9-11', label: '9–11' },
                  { value: '10-11', label: '10–11' },
                ]}
              />
            </div>
            {/*
              A total restriction is read against the hand's total and every
              soft total is thirteen or more, so a 9-11 or 10-11 table refuses
              soft doubles whatever this says. Leaving it live would be a
              switch that costs nothing and does nothing.
            */}
            <Toggle
              checked={draft.doubleSoft && draft.double === 'ANY2'}
              onChange={(v) => set('doubleSoft', v)}
              disabled={draft.double !== 'ANY2'}
              label="Double a soft total"
              hint={
                draft.double === 'ANY2'
                  ? undefined
                  : `Doubling on ${draft.double} already rules this out — a soft total is never 9, 10 or 11.`
              }
            />
            <Toggle
              checked={draft.das}
              onChange={(v) => set('das', v)}
              label="Double after split"
              hint="Worth 0.14% to the player."
            />
          </Panel>

          <Panel title="Splits, surrender and the hole card">
            <div className="flex items-center justify-between gap-3 py-1">
              <span className="text-xs text-pit-100">Split to</span>
              <Segmented
                value={String(draft.resplitTo)}
                onChange={(v) => set('resplitTo', Number(v))}
                options={[1, 2, 3].map((n) => ({ value: String(n), label: `${n + 1} hands` }))}
              />
            </div>
            <Toggle checked={draft.resplitAces} onChange={(v) => set('resplitAces', v)} label="Re-split aces" />
            <Toggle
              checked={!draft.oneCardOnSplitAces}
              onChange={(v) => set('oneCardOnSplitAces', !v)}
              label="Hit split aces"
              hint="Almost nowhere allows this. Worth 0.19%."
            />
            <div className="flex items-center justify-between gap-3 py-1">
              <span className="text-xs text-pit-100">Surrender</span>
              <Segmented
                value={draft.surrender}
                onChange={(v) => set('surrender', v as SurrenderRule)}
                options={[
                  { value: 'NONE', label: 'None' },
                  { value: 'LATE', label: 'Late' },
                  { value: 'EARLY', label: 'Early' },
                ]}
              />
            </div>
            <Toggle
              checked={draft.holeCard === 'PEEK'}
              onChange={(v) => set('holeCard', v ? 'PEEK' : 'ENHC')}
              label="Dealer takes a hole card"
              hint="Off is the European game: a dealer natural takes doubles and splits too."
            />
            <Toggle checked={draft.insurance} onChange={(v) => set('insurance', v)} label="Offer insurance" />
          </Panel>

          <Panel title="Limits">
            <div className="flex items-center gap-2 py-1">
              <span className="w-20 text-xs text-pit-100">Minimum</span>
              <MoneyInput value={draft.minBet} onChange={(c) => set('minBet', c)} min={100} max={draft.maxBet} aria-label="Table minimum" />
              <span className="w-20 pl-2 text-xs text-pit-100">Maximum</span>
              <MoneyInput value={draft.maxBet} onChange={(c) => set('maxBet', c)} min={draft.minBet} max={dollars(100_000)} aria-label="Table maximum" />
            </div>
          </Panel>

          <Panel title="Side bets" right={<span className="text-[9px] text-pit-500">every one is worse than the hand</span>}>
            {SIDE_BET_ORDER.map((kind) => {
              const spec = SIDE_BET_SPECS[kind];
              return (
                <Toggle
                  key={kind}
                  checked={draft.sideBets[kind]}
                  onChange={(v) => set('sideBets', { ...draft.sideBets, [kind]: v })}
                  label={spec.name}
                  hint={`${spec.blurb} House edge ${spec.edge}%.`}
                />
              );
            })}
          </Panel>
        </div>

        {/*
          The price list. Sticky, because it is the argument the whole dialog
          is making: the number has to still be on screen when you flip the
          switch three panels down, or flipping it teaches nothing.
        */}
        <div className="space-y-3 md:sticky md:top-0 md:self-start">
          <Panel title="What this game costs">
            <div className="mb-2 text-center">
              <div
                className={cn(
                  'font-mono text-3xl tabular-nums',
                  edge < 0.5 ? 'text-win' : edge < 1 ? 'text-brass-300' : 'text-lose',
                )}
              >
                {edge.toFixed(2)}%
              </div>
              <div className="text-[10px] tracking-wider text-pit-500 uppercase">estimated house edge</div>
            </div>
            <Meter value={Math.min(1, edge / 2.5)} tone={edge < 0.5 ? 'win' : edge < 1 ? 'brass' : 'lose'} />
            <p className="mt-2 text-[10px] leading-tight text-pit-400">
              {/*
                Signed in words rather than by a minus. The figure used to read
                "is about $32.00 expected" for a thirty-two dollar *loss*, and
                "about -$78.40" for a seventy-eight dollar *gain* — backwards,
                on the one panel whose entire premise is honest pricing.
              */}
              Against a player using the chart. {fmt(dollars(100))} a hand for an hour at eighty hands{' '}
              {edge >= 0 ? 'costs about' : 'gains you about'}{' '}
              {fmt(Math.abs(Math.round(dollars(100) * 80 * (edge / 100))))}.
            </p>
            <p className="mt-1.5 text-[10px] leading-tight text-pit-500">
              Six decks, dealer standing on all seventeens, 3:2, double any two, double after split,
              split to four — that game is 0.40%, and everything listed below is what this table
              gives back or takes on top of it. Accurate to a tenth of a percent rather than a
              hundredth; the game&rsquo;s own simulation measures every preset and agrees with it
              inside the noise those measurements carry. A price list, not a guarantee.
            </p>

            <div className="mt-3 space-y-1">
              {effects.length === 0 ? (
                <p className="text-[10px] text-pit-500">
                  This is the reference game exactly — nothing to add or subtract.
                </p>
              ) : null}
              {effects.map((e) => (
                <div key={e.label} className="flex items-baseline justify-between gap-2 text-[11px]">
                  <span className="truncate text-pit-300">{e.label}</span>
                  <span className={cn('font-mono tabular-nums', e.good ? 'text-win' : 'text-lose')}>
                    {e.delta > 0 ? '+' : ''}
                    {e.delta.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Shorthand">
            <p className="font-mono text-[11px] break-words text-pit-200">{rulesShorthand(draft)}</p>
          </Panel>

          <div className="grid gap-2">
            <Button
              variant="primary"
              disabled={!dirty || table.phase !== 'BETTING'}
              onClick={() => {
                setRules(draft);
                onClose();
              }}
            >
              {table.phase === 'BETTING' ? 'Apply and reshuffle' : 'Finish the round first'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => applyPreset('vegas-strip')}>
              Back to the default game
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ *
 * The chart
 * ------------------------------------------------------------------ */

/**
 * Basic strategy, as the printed card.
 *
 * Built from the same tables the advisor reads, for the rules currently in
 * play — so a table that only doubles 10-11 shows a chart with those cells
 * already changed rather than a generic one with a footnote.
 */
function ChartDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const rules = useGame((s) => s.table.rules);
  const chart = React.useMemo(() => chartFor(rules), [rules]);
  const [tab, setTab] = React.useState<'hard' | 'soft' | 'pairs' | 'deviations'>('hard');

  const rows =
    tab === 'hard'
      ? Object.keys(chart.hard).map(Number).filter((n) => n >= 5 && n <= 17).sort((a, b) => a - b)
      : tab === 'soft'
        ? Object.keys(chart.soft).map(Number).sort((a, b) => a - b)
        : Object.keys(chart.pairs).map(Number).sort((a, b) => a - b);

  const grid = tab === 'hard' ? chart.hard : tab === 'soft' ? chart.soft : chart.pairs;

  const rowLabel = (n: number) =>
    tab === 'hard' ? String(n) : tab === 'soft' ? `A,${n - 11}` : n === 11 ? 'A,A' : `${n},${n}`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="Basic strategy"
      subtitle={`For the game in play: ${rulesShorthand(rules)}`}
    >
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'hard', label: 'Hard' },
          { value: 'soft', label: 'Soft' },
          { value: 'pairs', label: 'Pairs' },
          { value: 'deviations', label: 'Index plays' },
        ]}
        className="mb-3"
      />

      {tab === 'deviations' ? <DeviationTable /> : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-[2px] text-center">
              <thead>
                <tr>
                  <th className="w-14 text-[10px] font-normal tracking-wider text-pit-500 uppercase">You</th>
                  {UPCARDS.map((u) => (
                    <th key={u} className="text-[10px] font-normal text-pit-400">
                      {upcardLabel(u)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((n) => (
                  <tr key={n}>
                    <th className="font-mono text-[11px] font-normal text-pit-300">{rowLabel(n)}</th>
                    {grid[n].map((code, i) => (
                      <td key={i} className="p-0">
                        <span
                          title={CODE_LABEL[code]}
                          className="flex h-6 min-w-6 items-center justify-center rounded-[3px] text-[10px] font-semibold text-black/85"
                          style={{ background: `var(--color-act-${CODE_TONE[code]})` }}
                        >
                          {code}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-pit-400">
            {(['H', 'S', 'D', 'Ds', 'P', 'Ph', 'R'] as Code[]).map((c) => (
              <span key={c} className="flex items-center gap-1.5">
                <span
                  className="flex h-4 w-5 items-center justify-center rounded-[3px] text-[9px] font-semibold text-black/85"
                  style={{ background: `var(--color-act-${CODE_TONE[c]})` }}
                >
                  {c}
                </span>
                {CODE_LABEL[c]}
              </span>
            ))}
          </div>

          <p className="mt-3 text-[11px] leading-relaxed text-pit-400">
            A slash means the fallback: <span className="text-pit-200">D</span> is double if the table
            lets you and hit if it does not, <span className="text-pit-200">Ds</span> is double or
            stand, <span className="text-pit-200">Ph</span> is split only where doubling after a split
            is allowed. The chart above already has this table&rsquo;s restrictions applied, so what it
            shows is what the buttons will accept.
          </p>
        </>
      )}
    </Modal>
  );
}

function DeviationTable() {
  return (
    <div>
      <p className="mb-3 text-[11px] leading-relaxed text-pit-400">
        The Illustrious 18 and the Fab 4: the cells where the chart is wrong at a high enough count.
        Each one applies at the true count shown and beyond. Insurance is first because it is worth
        more than the rest of the list put together — and because below +3 it is the worst bet on the
        felt.
      </p>
      <ul className="space-y-1">
        {DEVIATIONS.map((d) => (
          <li key={d.hand} className="flex items-baseline gap-3 rounded border border-white/6 bg-pit-850 px-2 py-1.5">
            <span className="w-24 shrink-0 font-mono text-[11px] text-pit-100">{d.hand}</span>
            <span className="w-16 shrink-0 font-mono text-[11px] text-brass-300">
              {d.direction === 'at-or-above' ? '≥' : '≤'} {d.index > 0 ? '+' : ''}
              {d.index}
            </span>
            <span className="w-20 shrink-0 text-[11px] text-pit-200 capitalize">{d.action.toLowerCase()}</span>
            <span className="min-w-0 flex-1 text-[10px] leading-tight text-pit-500">{d.note}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Side bets
 * ------------------------------------------------------------------ */

function SideBetsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const rules = useGame((s) => s.table.rules);
  // Read off the specs rather than written into the prose, so a repriced
  // paytable cannot leave the paragraph above it claiming something else.
  const byEdge = SIDE_BET_ORDER.map((k) => SIDE_BET_SPECS[k]).sort((a, b) => a.edge - b.edge);
  const best = byEdge[0];
  const worst = byEdge[byEdge.length - 1];

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="Side bets"
      subtitle="Every paytable this table books, and what each one costs."
    >
      <p className="mb-3 text-[11px] leading-relaxed text-pit-400">
        The main game on this table runs at {estimateHouseEdge(rules).toFixed(2)}% against you. The
        friendliest bet on this page costs {best.edge}%, and the most tempting one costs{' '}
        {worst.edge}%. They are here
        because a real table has them, and the numbers are here because a real table does not print
        them — every figure below is computed for that paytable at six decks, not copied from a
        chart describing somebody else&rsquo;s.
      </p>

      <div className="grid gap-2 sm:grid-cols-2">
        {SIDE_BET_ORDER.map((kind) => {
          const spec = SIDE_BET_SPECS[kind];
          const on = rules.sideBets[kind];
          return (
            <Panel
              key={kind}
              className={cn(!on && 'opacity-45')}
              title={spec.name}
              right={
                <span
                  className={cn('font-mono text-[10px]', spec.edge > 10 ? 'text-lose' : 'text-brass-300')}
                  title="House edge on a six-deck shoe"
                >
                  {spec.edge}%
                </span>
              }
            >
              <p className="mb-2 text-[10px] leading-tight text-pit-400">{spec.blurb}</p>
              <table className="w-full">
                <tbody>
                  {spec.paytable.map((line) => (
                    <tr key={line.label}>
                      <td className="py-0.5 pr-2 text-[10px] leading-tight text-pit-300">{line.label}</td>
                      <td
                        className="py-0.5 text-right font-mono text-[11px] whitespace-nowrap"
                        style={{ color: spec.accent }}
                      >
                        {ratioLabel(line.ratio)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[9px] text-pit-500">Reads: {spec.reads.toLowerCase()}.</p>
            </Panel>
          );
        })}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ *
 * Help
 * ------------------------------------------------------------------ */

function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const table = useGame((s) => s.table);
  const seats = table.seats.filter((s) => s.occupied);

  return (
    <Modal open={open} onClose={onClose} title="How this plays" subtitle="And what the keyboard does.">
      <div className="space-y-4 text-[12px] leading-relaxed text-pit-300">
        <section>
          <h4 className="mb-1 text-[10px] tracking-[0.18em] text-brass-300 uppercase">The hand</h4>
          <p>
            Beat the dealer&rsquo;s total without going over twenty-one. The dealer has no choices:
            they draw to sixteen and stand on seventeen, {table.rules.hitsSoft17 ? 'except that they draw to a soft seventeen at this table' : 'including a soft seventeen at this table'}.
            A two-card twenty-one pays {table.rules.blackjackPays}; everything else pays even money.
          </p>
        </section>

        <section>
          <h4 className="mb-1 text-[10px] tracking-[0.18em] text-brass-300 uppercase">Keyboard</h4>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
            {[
              ['Space', 'Deal, then stand'],
              ['H', 'Hit'],
              ['S', 'Stand'],
              ['D', 'Double'],
              ['P', 'Split'],
              ['R', 'Surrender'],
              ['N', 'Decline insurance'],
              ['I', 'Take insurance'],
              ['E', 'Take even money'],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center gap-2">
                <kbd className="rounded bg-pit-800 px-1.5 py-0.5 font-mono text-[10px] text-pit-200">{k}</kbd>
                <span className="text-[11px]">{v}</span>
              </div>
            ))}
          </dl>
        </section>

        <section>
          <h4 className="mb-1 text-[10px] tracking-[0.18em] text-brass-300 uppercase">The trainer</h4>
          <p>
            Turn on <em>show the correct play</em> to see the chart&rsquo;s answer before you act, or{' '}
            <em>grade my decisions</em> to be marked afterwards. <em>Show the count</em> adds a Hi-Lo
            running and true count taken from the discard tray — the same cards you can see, and
            nothing more.
          </p>
        </section>

        <section>
          <h4 className="mb-1 text-[10px] tracking-[0.18em] text-brass-300 uppercase">Seats</h4>
          <p>
            Up to three, sharing one screen. Click an empty circle to sit down, and a seated one to
            put a chip in. Each seat keeps its own bankroll and its own statistics.
          </p>
          {seats.map((s) => (
            <Stat key={s.id} label={s.name} value={fmt(s.bankroll)} />
          ))}
        </section>
      </div>
    </Modal>
  );
}
