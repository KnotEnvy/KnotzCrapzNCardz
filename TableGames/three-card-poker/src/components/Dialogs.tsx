'use client';

/**
 * Everything that opens over the felt.
 *
 * Four dialogs: the house rules, the strategy card, the paytables side by
 * side, and the help card. They share nothing but the modal shell, because
 * they are four different things that happen to be presented the same way.
 *
 * Every number in all four is read from `analysis.ts` rather than written into
 * the prose, so a repriced table cannot leave a paragraph claiming something
 * else. The blackjack table's paytable dialog once hard-coded a figure into a
 * sentence two lines above the computed one, and they disagreed.
 */

import * as React from 'react';
import { Button, Modal, MoneyInput, Panel, Toggle, cn } from '@/components/ui/primitives';
import {
  ANTE_PLAY_TOTALS,
  SIX_CARD_COUNTS,
  SIX_CARD_SETS,
  STRATEGY_IDS,
  STRATEGY_LABEL,
  THREE_CARD_COUNTS,
  THREE_CARD_HANDS,
  antePlayFigures,
  pairPlusFigures,
  qualifyingHands,
  sixCardFigures,
} from '@/lib/engine/analysis';
import { dollars, fmt } from '@/lib/engine/money';
import {
  ANTE_BONUS_TABLES,
  PAIR_PLUS_TABLES,
  PAY_HAND_LABEL,
  SIX_CARD_TABLES,
  anteBonusTable,
  type PayLine,
  type Paytable,
} from '@/lib/engine/paytables';
import { RULE_PRESETS, matchingPreset, presetById, rulesShorthand, tableFigures } from '@/lib/engine/rules';
import type { Card, Rank, Suit, TableRules } from '@/lib/engine/types';
import { cardIndex, rankLabel } from '@/lib/engine/types';
import { advise } from '@/lib/strategy/strategy';
import { useGame } from '@/lib/store/useGame';

export function Dialogs() {
  const dialog = useGame((s) => s.dialog);
  const close = React.useCallback(() => useGame.getState().openDialog(null), []);

  return (
    <>
      <SetupDialog open={dialog === 'setup'} onClose={close} />
      <StrategyDialog open={dialog === 'strategy'} onClose={close} />
      <PaytablesDialog open={dialog === 'paytables'} onClose={close} />
      <HelpDialog open={dialog === 'help'} onClose={close} />
    </>
  );
}

/* ------------------------------------------------------------------ *
 * House rules
 * ------------------------------------------------------------------ */

/**
 * The rule editor.
 *
 * Its argument is the panel down the right: every table is priced where it is
 * chosen, and the total for the draft sits above them. A player who arrives
 * thinking "Pair Plus is Pair Plus" and leaves knowing one table costs three
 * times another has the only lesson this screen has to teach.
 */
function SetupDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const rules = useGame((s) => s.table.rules);
  // The draft starts from the rules as they are when the dialog opens: the body
  // is keyed on them, so opening is a mount and the draft is its initial state.
  if (!open) return null;
  return <SetupBody key={JSON.stringify(rules)} onClose={onClose} />;
}

/** An hour at the table, as the cost line prices it. */
const HOUR = { hands: 100, ante: dollars(10), side: dollars(5) };

function SetupBody({ onClose }: { onClose: () => void }) {
  const table = useGame((s) => s.table);
  const setRules = useGame((s) => s.setRules);
  const [draft, setDraft] = React.useState<TableRules>(() => ({ ...table.rules }));

  const set = <K extends keyof TableRules>(key: K, value: TableRules[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const figures = tableFigures(draft);
  const preset = matchingPreset(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(table.rules);
  const betting = table.phase === 'BETTING';

  const hourCost =
    HOUR.hands *
    ((HOUR.ante * figures.antePlay.houseEdge) / 100 +
      (figures.pairPlus ? (HOUR.side * figures.pairPlus.houseEdge) / 100 : 0) +
      (figures.sixCard ? (HOUR.side * figures.sixCard.houseEdge) / 100 : 0));

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title="House rules"
      subtitle="The rules of Three Card Poker are the same at every table. What it pays is not."
    >
      <div className="grid gap-4 md:grid-cols-[1fr_15rem]">
        <div className="space-y-3">
          <Panel title="Preset">
            <div className="grid gap-1.5 sm:grid-cols-2">
              {RULE_PRESETS.map((p) => {
                const f = tableFigures(p.rules);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        pairPlusTable: p.rules.pairPlusTable,
                        anteBonusTable: p.rules.anteBonusTable,
                        sixCardTable: p.rules.sixCardTable,
                        pairPlus: p.rules.pairPlus,
                        sixCard: p.rules.sixCard,
                      }))
                    }
                    className={cn(
                      'rounded-md border p-2 text-left transition-colors',
                      preset?.id === p.id ? 'border-brass-500/60 bg-brass-500/10' : 'border-white/8 bg-pit-850 hover:border-white/20',
                    )}
                  >
                    <span className="text-xs font-medium text-pit-100">{p.name}</span>
                    <p className="mt-0.5 text-[10px] leading-tight text-pit-400">{p.note}</p>
                    <p className="mt-1 font-mono text-[10px] text-pit-300">
                      Ante {f.antePlay.houseEdge.toFixed(2)}% · PP {f.pairPlus?.houseEdge.toFixed(2) ?? '—'}% · 6CB{' '}
                      {f.sixCard?.houseEdge.toFixed(2) ?? '—'}%
                    </p>
                  </button>
                );
              })}
            </div>
          </Panel>

          <Panel title="Ante Bonus" right={<span className="text-[9px] text-pit-500">paid on a played straight or better</span>}>
            <TablePicker
              label="Ante Bonus paytable"
              tables={ANTE_BONUS_TABLES}
              value={draft.anteBonusTable}
              onChange={(id) => set('anteBonusTable', id)}
              edge={(id) => antePlayFigures(id).houseEdge}
            />
            <p className="mt-1.5 text-[10px] leading-tight text-pit-500">
              Priced as the whole Ante and Play, because the bonus is part of that bet: without it the same game would
              cost more than twice as much.
            </p>
          </Panel>

          <Panel title="Pair Plus">
            <Toggle checked={draft.pairPlus} onChange={(v) => set('pairPlus', v)} label="Book Pair Plus" />
            <TablePicker
              label="Pair Plus paytable"
              tables={PAIR_PLUS_TABLES}
              value={draft.pairPlusTable}
              onChange={(id) => set('pairPlusTable', id)}
              edge={(id) => pairPlusFigures(id).houseEdge}
              disabled={!draft.pairPlus}
            />
          </Panel>

          <Panel title="6 Card Bonus">
            <Toggle checked={draft.sixCard} onChange={(v) => set('sixCard', v)} label="Book the 6 Card Bonus" />
            <TablePicker
              label="6 Card Bonus paytable"
              tables={SIX_CARD_TABLES}
              value={draft.sixCardTable}
              onChange={(id) => set('sixCardTable', id)}
              edge={(id) => sixCardFigures(id).houseEdge}
              disabled={!draft.sixCard}
            />
          </Panel>

          <Panel title="Limits">
            <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5">
              <span className="text-xs text-pit-100">Ante minimum</span>
              <MoneyInput value={draft.minBet} onChange={(c) => set('minBet', c)} min={100} max={draft.maxBet} aria-label="Ante minimum" />
              <span className="text-xs text-pit-100">Ante maximum</span>
              <MoneyInput value={draft.maxBet} onChange={(c) => set('maxBet', c)} min={draft.minBet} max={dollars(100_000)} aria-label="Ante maximum" />
              <span className="text-xs text-pit-100">Pair Plus maximum</span>
              <MoneyInput value={draft.maxPairPlus} onChange={(c) => set('maxPairPlus', c)} min={draft.minBet} max={dollars(100_000)} aria-label="Pair Plus maximum" />
              <span className="text-xs text-pit-100">6 Card maximum</span>
              <MoneyInput value={draft.maxSixCard} onChange={(c) => set('maxSixCard', c)} min={draft.minBet} max={dollars(100_000)} aria-label="6 Card Bonus maximum" />
            </div>
            <p className="mt-1.5 text-[10px] text-pit-500">The side bets share the Ante minimum. The Play always equals the Ante.</p>
          </Panel>
        </div>

        {/* Sticky, because it is the argument the dialog is making. */}
        <div className="space-y-3 md:sticky md:top-0 md:self-start">
          <Panel title="What this table costs">
            <div className="mb-2 text-center">
              <div className={cn('font-mono text-3xl tabular-nums', figures.antePlay.houseEdge < 3.5 ? 'text-brass-300' : 'text-lose')}>
                {figures.antePlay.houseEdge.toFixed(2)}%
              </div>
              <div className="text-[10px] tracking-wider text-pit-500 uppercase">Ante and Play, per dollar Anted</div>
              <div className="mt-1 font-mono text-[11px] text-pit-300">
                {figures.antePlay.elementOfRisk.toFixed(2)}% <span className="text-pit-500">per dollar at risk</span>
              </div>
            </div>
            <div className="space-y-1 text-[11px]">
              <CostRow label="Pair Plus" figure={figures.pairPlus?.houseEdge ?? null} />
              <CostRow label="6 Card Bonus" figure={figures.sixCard?.houseEdge ?? null} />
            </div>
            <p className="mt-2 text-[10px] leading-tight text-pit-400">
              A hundred hands at a {fmt(HOUR.ante)} Ante, with {fmt(HOUR.side)} on each side bet this table books,
              played perfectly, costs about {fmt(Math.round(hourCost))} on average.
            </p>
            <p className="mt-1.5 text-[10px] leading-tight text-pit-500">
              Every figure on this screen is exact: counted over every hand a single deck can deal, not simulated and not
              copied from a chart. The game&rsquo;s test suite holds each one against the published figure for the same
              table.
            </p>
          </Panel>

          <Panel title="Posted">
            <p className="font-mono text-[11px] break-words text-pit-200">{rulesShorthand(draft)}</p>
          </Panel>

          <div className="grid gap-2">
            <Button
              variant="primary"
              disabled={!dirty || !betting}
              onClick={() => {
                setRules(draft);
                onClose();
              }}
            >
              {betting ? 'Apply' : 'Finish the round first'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDraft({ ...presetById('common').rules })}>
              Back to the common table
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function CostRow({ label, figure }: { label: string; figure: number | null }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-pit-300">{label}</span>
      <span className={cn('font-mono tabular-nums', figure === null ? 'text-pit-500' : figure < 5 ? 'text-brass-300' : 'text-lose')}>
        {figure === null ? 'not booked' : `${figure.toFixed(2)}%`}
      </span>
    </div>
  );
}

function TablePicker<H extends string>({
  label,
  tables,
  value,
  onChange,
  edge,
  disabled,
}: {
  label: string;
  tables: readonly Paytable<H>[];
  value: string;
  onChange: (id: string) => void;
  edge: (id: string) => number;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('grid gap-1', disabled && 'opacity-40')}>
      {tables.map((t) => {
        const selected = t.id === value;
        const e = edge(t.id);
        return (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(t.id)}
            className={cn(
              'flex items-center justify-between gap-3 rounded-md border px-2 py-1.5 text-left transition-colors',
              selected ? 'border-brass-500/60 bg-brass-500/10' : 'border-white/8 bg-pit-850 hover:border-white/20',
            )}
          >
            <span className="min-w-0">
              <span className="block font-mono text-[11px] text-pit-100">{t.lines.map((l) => l.ratio[0].toLocaleString('en-US')).join(' · ')}</span>
              <span className="block text-[10px] leading-tight text-pit-400">{t.note}</span>
            </span>
            <span className={cn('shrink-0 font-mono text-[11px] tabular-nums', e < 3 ? 'text-win' : e < 7 ? 'text-brass-300' : 'text-lose')}>
              {e.toFixed(2)}%
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Strategy
 * ------------------------------------------------------------------ */

function StrategyDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const rules = useGame((s) => s.table.rules);
  return (
    <Modal open={open} onClose={onClose} wide title="Play or fold" subtitle="The whole of Three Card Poker strategy, and the arithmetic under it.">
      <StrategyBody rules={rules} />
    </Modal>
  );
}

const card = (rank: Rank, suit: Suit): Card => ({ rank, suit, id: cardIndex(rank, suit) });

interface GridCell {
  third: number;
  /** Q-J-10 is a straight rather than a high-card hand. */
  straight: boolean;
  plays: boolean;
  /** What playing is worth over folding, in Antes. */
  margin: number;
}

/**
 * Every queen-high hand, worked out.
 *
 * Offsuit throughout — a suited hand is a flush and plays — and suits chosen
 * so no cell is accidentally something else. King-high and ace-high hands all
 * play and jack-high hands all fold, so this grid is the only part of the
 * strategy that needs looking at, and it is small.
 */
function queenGrid(rules: TableRules): Array<{ second: number; cells: Array<GridCell | null> }> {
  const rows: Array<{ second: number; cells: Array<GridCell | null> }> = [];
  for (let second = 11; second >= 3; second--) {
    const cells: Array<GridCell | null> = [];
    for (let third = 10; third >= 2; third--) {
      if (third >= second) {
        cells.push(null);
        continue;
      }
      const a = advise([card(12, 'spades'), card(second as Rank, 'hearts'), card(third as Rank, 'diamonds')], { ante: 100, pairPlus: 0 }, rules)!;
      cells.push({ third, straight: second === 11 && third === 10, plays: a.decision === 'PLAY', margin: a.playUnits + 1 });
    }
    rows.push({ second, cells });
  }
  return rows;
}

function StrategyBody({ rules }: { rules: TableRules }) {
  const grid = React.useMemo(() => queenGrid(rules), [rules]);
  const strategies = React.useMemo(
    () =>
      STRATEGY_IDS.map((id) => ({
        id,
        figures: antePlayFigures(rules.anteBonusTable, id),
        plays: ANTE_PLAY_TOTALS[id].plays,
      })),
    [rules.anteBonusTable],
  );
  const bonus = anteBonusTable(rules.anteBonusTable);

  return (
    <div className="space-y-4 text-[12px] leading-relaxed text-pit-300">
      <div className="rounded-lg border border-brass-500/40 bg-brass-500/8 px-4 py-3 text-center">
        <p className="text-lg tracking-[0.12em] text-brass-300 uppercase" style={{ fontFamily: 'var(--font-display)' }}>
          Play Q-6-4 or better. Fold the rest.
        </p>
        <p className="mt-1 text-[11px] text-pit-400">
          Any pair, flush, straight or better plays. Any king or ace high plays. Jack high or worse folds. Queen high
          plays from Q-6-4 up.
        </p>
      </div>

      <p>
        That line is usually printed as a rule of thumb. It is exact. This game walks all {THREE_CARD_HANDS.toLocaleString('en-US')}{' '}
        three-card hands against every one of the {(18_424).toLocaleString('en-US')} hands the dealer could hold with the
        rest of the deck, counting each hand&rsquo;s own suits and the cards it takes away, and there is no hand on which
        the exact answer and Q-6-4 disagree. The Ante Bonus does not move it either: it pays only on straights and better,
        and those play regardless.
      </p>

      <section>
        <h4 className="mb-1.5 text-[10px] tracking-[0.18em] text-brass-300 uppercase">Queen high, hand by hand</h4>
        <div className="overflow-x-auto">
          <table className="border-separate border-spacing-[2px] text-center">
            <thead>
              <tr>
                <th className="w-14 text-left text-[10px] font-normal text-pit-500">Q with</th>
                {[10, 9, 8, 7, 6, 5, 4, 3, 2].map((t) => (
                  <th key={t} className="w-11 text-[10px] font-normal text-pit-400">
                    {rankLabel(t)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.map((row) => (
                <tr key={row.second}>
                  <th className="text-left font-mono text-[11px] font-normal text-pit-300">Q-{rankLabel(row.second)}</th>
                  {row.cells.map((cell, i) =>
                    cell === null ? (
                      <td key={i} />
                    ) : (
                      <td key={i} className="p-0">
                        <span
                          title={`Q-${rankLabel(row.second)}-${rankLabel(cell.third)}: ${cell.straight ? 'a straight. ' : ''}playing is worth ${cell.margin >= 0 ? '+' : ''}${cell.margin.toFixed(3)} Antes against folding.`}
                          className={cn(
                            'flex h-7 min-w-10 flex-col items-center justify-center rounded-[3px] leading-none font-semibold text-black/85',
                            row.second === 6 && cell.third === 4 && 'ring-2 ring-brass-300',
                          )}
                          style={{ background: `var(--color-act-${cell.plays ? 'play' : 'fold'})` }}
                        >
                          <span className="text-[10px]">{cell.straight ? 'S' : cell.plays ? 'P' : 'F'}</span>
                          <span className="font-mono text-[8px] font-normal">
                            {cell.margin >= 0 ? '+' : '−'}
                            {Math.abs(cell.margin).toFixed(3).replace(/^0/, '')}
                          </span>
                        </span>
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1.5 text-[11px] text-pit-400">
          Each cell is what playing is worth over folding, in Antes, for that hand offsuit. Q-6-4, ringed, plays by a
          whisker; Q-6-3 beside it folds by one. Mistakes this close to the line cost almost nothing — the trainer prices
          them — and the expensive mistakes are the ones far from it: folding K-4-2, or playing J-10-8.
        </p>
      </section>

      <section>
        <h4 className="mb-1.5 text-[10px] tracking-[0.18em] text-brass-300 uppercase">What other ways of playing cost</h4>
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-pit-500">
              <th className="text-left font-normal">Strategy</th>
              <th className="text-right font-normal">plays</th>
              <th className="text-right font-normal">house edge</th>
              <th className="text-right font-normal">element of risk</th>
            </tr>
          </thead>
          <tbody>
            {strategies.map(({ id, figures, plays }) => (
              <tr key={id} className={id === 'OPTIMAL' ? 'text-pit-100' : undefined}>
                <td className="py-0.5">{STRATEGY_LABEL[id]}</td>
                <td className="py-0.5 text-right font-mono tabular-nums">{((plays / THREE_CARD_HANDS) * 100).toFixed(1)}%</td>
                <td className="py-0.5 text-right font-mono tabular-nums">{figures.houseEdge.toFixed(3)}%</td>
                <td className="py-0.5 text-right font-mono tabular-nums">{figures.elementOfRisk.toFixed(3)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1.5 text-[11px] text-pit-400">
          At this table&rsquo;s Ante Bonus of {bonus.lines.map((l) => l.ratio[0]).join('-')}. The exact strategy and the
          Q-6-4 line are the same row because they are the same strategy. &ldquo;Play what the dealer would&rdquo; sounds
          like a sensible shortcut and plays {ANTE_PLAY_TOTALS.MIMIC.plays - ANTE_PLAY_TOTALS.OPTIMAL.plays} extra
          hands in every {THREE_CARD_HANDS.toLocaleString('en-US')} — the queen-high hands below Q-6-4 — each of which
          loses more played than folded.
        </p>
      </section>

      <section>
        <h4 className="mb-1 text-[10px] tracking-[0.18em] text-brass-300 uppercase">Two numbers, two denominators</h4>
        <p>
          The <em>house edge</em> is what the Ante and Play lose per dollar Anted: per hand dealt. The{' '}
          <em>element of risk</em> is the same loss per dollar put on the felt, Play included. A perfect player plays
          about two hands in three, so they differ by that much, and both are true. Quoting one under the other&rsquo;s
          name is how a figure ends up forty percent wrong. The dealer qualifies on{' '}
          {((qualifyingHands() / THREE_CARD_HANDS) * 100).toFixed(2)}% of deals.
        </p>
      </section>

      <section>
        <h4 className="mb-1 text-[10px] tracking-[0.18em] text-brass-300 uppercase">The side bets</h4>
        <p>
          There is no strategy for Pair Plus or the 6 Card Bonus: they are paid on the cards, and nothing the player does
          changes them — except that folding a hand forfeits its Pair Plus. The strategy line never folds a hand that
          Pair Plus pays, so the two never conflict. Their only decision is whether to make them, and the paytables
          dialog prices that.
        </p>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Paytables
 * ------------------------------------------------------------------ */

function PaytablesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const rules = useGame((s) => s.table.rules);
  return (
    <Modal open={open} onClose={onClose} wide title="Paytables" subtitle="Every table this game books, side by side, with the one in force marked.">
      <div className="space-y-5">
        <p className="text-[11px] leading-relaxed text-pit-400">
          The same three cards are worth different amounts at different tables, and the difference is all in these
          columns. Each column&rsquo;s house edge is exact — the pays weighted by how many hands make them — and the
          first column of counts is where that comes from.
        </p>

        <PayMatrix
          caption="Pair Plus — your three cards, whatever the dealer holds"
          footnote="Pays are to one. A pair or better wins; anything less loses the bet, and so does folding the hand it rides on. A figure in brackets is a hand with no line of its own, paid as a straight flush."
          of={THREE_CARD_HANDS}
          hands={[
            { hand: 'MINI_ROYAL', label: 'Mini royal (A-K-Q suited)', count: THREE_CARD_COUNTS.MINI_ROYAL },
            { hand: 'STRAIGHT_FLUSH', label: 'Straight flush', count: THREE_CARD_COUNTS.STRAIGHT_FLUSH },
            { hand: 'TRIPS', label: 'Three of a kind', count: THREE_CARD_COUNTS.TRIPS },
            { hand: 'STRAIGHT', label: 'Straight', count: THREE_CARD_COUNTS.STRAIGHT },
            { hand: 'FLUSH', label: 'Flush', count: THREE_CARD_COUNTS.FLUSH },
            { hand: 'PAIR', label: 'Pair', count: THREE_CARD_COUNTS.PAIR },
          ]}
          tables={PAIR_PLUS_TABLES}
          inForce={rules.pairPlus ? rules.pairPlusTable : null}
          edge={(id) => pairPlusFigures(id).houseEdge}
          fallback={(table, hand) => (hand === 'MINI_ROYAL' ? table.lines.find((l) => l.hand === 'STRAIGHT_FLUSH') ?? null : null)}
        />

        <PayMatrix
          caption="Ante Bonus — a played straight or better, whatever the dealer holds"
          footnote="Pays are to one, on the Ante, on top of whatever the Ante and Play win or lose. Only a hand that was played is paid. Its edge is the edge of the whole Ante and Play, because it is part of that bet."
          of={THREE_CARD_HANDS}
          hands={[
            { hand: 'STRAIGHT_FLUSH', label: 'Straight flush', count: THREE_CARD_COUNTS.STRAIGHT_FLUSH + THREE_CARD_COUNTS.MINI_ROYAL },
            { hand: 'TRIPS', label: 'Three of a kind', count: THREE_CARD_COUNTS.TRIPS },
            { hand: 'STRAIGHT', label: 'Straight', count: THREE_CARD_COUNTS.STRAIGHT },
          ]}
          tables={ANTE_BONUS_TABLES}
          inForce={rules.anteBonusTable}
          edge={(id) => antePlayFigures(id).houseEdge}
          edgeLabel="Ante and Play"
        />

        <PayMatrix
          caption="6 Card Bonus — the best five of your three cards and the dealer's three"
          footnote="Pays are to one. Three of a kind or better wins; anything less loses the bet. A fold does not forfeit it."
          of={SIX_CARD_SETS}
          hands={[
            { hand: 'ROYAL_FLUSH', label: 'Royal flush', count: SIX_CARD_COUNTS.ROYAL_FLUSH },
            { hand: 'STRAIGHT_FLUSH', label: 'Straight flush', count: SIX_CARD_COUNTS.STRAIGHT_FLUSH },
            { hand: 'FOUR_OF_A_KIND', label: 'Four of a kind', count: SIX_CARD_COUNTS.FOUR_OF_A_KIND },
            { hand: 'FULL_HOUSE', label: 'Full house', count: SIX_CARD_COUNTS.FULL_HOUSE },
            { hand: 'FLUSH', label: 'Flush', count: SIX_CARD_COUNTS.FLUSH },
            { hand: 'STRAIGHT', label: 'Straight', count: SIX_CARD_COUNTS.STRAIGHT },
            { hand: 'THREE_OF_A_KIND', label: 'Three of a kind', count: SIX_CARD_COUNTS.THREE_OF_A_KIND },
          ]}
          tables={SIX_CARD_TABLES}
          inForce={rules.sixCard ? rules.sixCardTable : null}
          edge={(id) => sixCardFigures(id).houseEdge}
        />
      </div>
    </Modal>
  );
}

function PayMatrix<H extends string>({
  caption,
  footnote,
  of,
  hands,
  tables,
  inForce,
  edge,
  edgeLabel = 'House edge',
  fallback,
}: {
  caption: string;
  /** What wins, in words — it differs for every one of the three bets. */
  footnote: string;
  of: number;
  hands: ReadonlyArray<{ hand: H; label: string; count: number }>;
  tables: readonly Paytable<H>[];
  /** The table in force, or null when the bet is not booked. */
  inForce: string | null;
  edge: (id: string) => number;
  edgeLabel?: string;
  /** A pay a table implies without printing, like a mini royal paid as a straight flush. */
  fallback?: (table: Paytable<H>, hand: H) => PayLine<H> | null;
}) {
  return (
    <section>
      <h4 className="mb-1.5 text-[10px] tracking-[0.18em] text-brass-300 uppercase">{caption}</h4>
      <div className="thin-scroll overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-[11px]">
          <thead>
            <tr className="text-[10px] text-pit-500">
              <th className="py-1 pr-2 text-left font-normal">Hand</th>
              <th className="py-1 pr-3 text-right font-normal whitespace-nowrap">hands in {of.toLocaleString('en-US')}</th>
              {tables.map((t) => (
                <th
                  key={t.id}
                  className={cn('px-2 py-1 text-right font-normal whitespace-nowrap', t.id === inForce && 'rounded-t bg-brass-500/15 text-brass-300')}
                >
                  {t.id === inForce ? 'in force' : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {hands.map((h) => (
              <tr key={h.hand}>
                <td className="py-0.5 pr-2 whitespace-nowrap text-pit-300">{h.label}</td>
                <td className="py-0.5 pr-3 text-right font-mono tabular-nums text-pit-500">{h.count.toLocaleString('en-US')}</td>
                {tables.map((t) => {
                  const own = t.lines.find((l) => l.hand === h.hand);
                  const implied = own ? null : (fallback?.(t, h.hand) ?? null);
                  const line = own ?? implied;
                  return (
                    <td
                      key={t.id}
                      className={cn('px-2 py-0.5 text-right font-mono tabular-nums', t.id === inForce ? 'bg-brass-500/15 text-pit-100' : 'text-pit-300')}
                      title={implied ? 'No line of its own: paid as a straight flush.' : undefined}
                    >
                      {line ? (
                        <span className={implied ? 'text-pit-500' : undefined}>
                          {implied ? '(' : ''}
                          {line.ratio[0].toLocaleString('en-US')}
                          {implied ? ')' : ''}
                        </span>
                      ) : (
                        <span className="text-pit-600">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr>
              <td className="pt-1.5 pr-2 text-[10px] tracking-wider text-pit-400 uppercase" colSpan={2}>
                {edgeLabel}
              </td>
              {tables.map((t) => {
                const e = edge(t.id);
                return (
                  <td
                    key={t.id}
                    className={cn(
                      'px-2 pt-1.5 text-right font-mono tabular-nums',
                      t.id === inForce && 'rounded-b bg-brass-500/15',
                      e < 3 ? 'text-win' : e < 7 ? 'text-brass-300' : 'text-lose',
                    )}
                  >
                    {e.toFixed(2)}%
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[10px] text-pit-500">{footnote}</p>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Help
 * ------------------------------------------------------------------ */

function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const rules = useGame((s) => s.table.rules);
  const bonus = anteBonusTable(rules.anteBonusTable);

  return (
    <Modal open={open} onClose={onClose} title="How this plays" subtitle="And what the keyboard does.">
      <div className="space-y-4 text-[12px] leading-relaxed text-pit-300">
        <section>
          <h4 className="mb-1 text-[10px] tracking-[0.18em] text-brass-300 uppercase">The hand</h4>
          <p>
            You and the dealer each get three cards from a single deck, shuffled fresh by the machine every round. From
            the top: straight flush, three of a kind, straight, flush, pair, high card. With three cards a straight is
            rarer than a flush, so it beats one. Ace-king-queen is the highest straight and ace-two-three the lowest.
          </p>
        </section>

        <section>
          <h4 className="mb-1 text-[10px] tracking-[0.18em] text-brass-300 uppercase">Ante and Play</h4>
          <p>
            Put up an Ante and look at your cards. Then <strong>play</strong>, by putting the same amount on Play, or{' '}
            <strong>fold</strong> and lose the Ante. The dealer needs a queen high to qualify. If they do not, your Ante
            pays even money and your Play comes back. If they do, the better hand wins both at even money, and a tie
            pushes both.
          </p>
        </section>

        <section>
          <h4 className="mb-1 text-[10px] tracking-[0.18em] text-brass-300 uppercase">Ante Bonus</h4>
          <p>
            Play a straight or better and the Ante is paid a bonus on top, whatever the dealer holds — even when the
            dealer beats you. At this table: {bonus.lines.map((l) => `${PAY_HAND_LABEL[l.hand].toLowerCase()} ${l.ratio[0]} to 1`).join(', ')}.
          </p>
        </section>

        <section>
          <h4 className="mb-1 text-[10px] tracking-[0.18em] text-brass-300 uppercase">Pair Plus and the 6 Card Bonus</h4>
          <p>
            <strong>Pair Plus</strong> pays on a pair or better in your three cards, whatever the dealer holds, and can
            be played with no Ante at all. If you do Ante and then fold, it is forfeited with the Ante.{' '}
            <strong>The 6 Card Bonus</strong> needs an Ante, and pays on the best five-card hand in your three cards and
            the dealer&rsquo;s three. A fold does not forfeit it.
          </p>
        </section>

        <section>
          <h4 className="mb-1 text-[10px] tracking-[0.18em] text-brass-300 uppercase">Keyboard</h4>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
            {[
              ['Space', 'Deal'],
              ['P', 'Play'],
              ['F', 'Fold'],
              ['C', 'Strategy'],
              ['B', 'Paytables'],
              [',', 'House rules'],
              ['?', 'This card'],
              ['Esc', 'Close a dialog'],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center gap-2">
                <kbd className="rounded bg-pit-800 px-1.5 py-0.5 font-mono text-[10px] text-pit-200">{k}</kbd>
                <span className="text-[11px]">{v}</span>
              </div>
            ))}
          </dl>
          <p className="mt-1.5 text-[11px] text-pit-500">
            Nothing plays or folds by default. Both are real decisions, and a key that made one out of habit would be a
            key that costs money.
          </p>
        </section>

        <section>
          <h4 className="mb-1 text-[10px] tracking-[0.18em] text-brass-300 uppercase">Seats</h4>
          <p>
            Up to three, sharing one screen, each with its own bankroll. Click an empty seat to sit, and a spot to put the
            selected chip on it. A seat&rsquo;s cards are face up only on its own turn and at the showdown — the seats
            share a screen, but they do not get to share their cards.
          </p>
        </section>
      </div>
    </Modal>
  );
}
