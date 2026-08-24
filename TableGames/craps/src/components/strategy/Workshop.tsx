'use client';

/**
 * The strategy workshop.
 *
 * Library down the left, the selected system down the right. The house
 * strategies are read-only — not because they are special, but because they
 * are shared: duplicating one drops an editable copy into the player's own
 * list with every rule intact, which is the intended way in to the builder.
 *
 * Editing writes straight through to the store on every keystroke rather than
 * into a draft with a Save button. There is nothing to lose by it — a strategy
 * is small, the store is the only copy, and a half-finished rule that survives
 * closing the dialog is a feature, not a bug.
 */

import * as React from 'react';
import { Modal } from '@/components/Dialogs';
import { RuleCard } from '@/components/strategy/RuleEditor';
import { Button, NumberBox, Segmented, cn, money } from '@/components/ui/primitives';
import { uiClick } from '@/lib/audio';
import type { SeatId } from '@/lib/engine/types';
import { strategyWarnings } from '@/lib/strategy/library';
import type { Strategy, StrategyRule } from '@/lib/strategy/types';
import { allStrategies, useGame } from '@/lib/store/useGame';

/** How a seat is being played. */
type SeatMode = 'OFF' | 'MANUAL' | 'AUTO';

const SEAT_MODE_OPTIONS: ReadonlyArray<{ value: SeatMode; label: string; title: string }> = [
  { value: 'OFF', label: 'By hand', title: 'No strategy — you place every bet yourself' },
  { value: 'MANUAL', label: 'On call', title: 'Assigned, but only bets when you press Run' },
  { value: 'AUTO', label: 'Auto', title: 'Places and presses its own bets after every roll' },
];

/* ------------------------------------------------------------------ *
 * Library column
 * ------------------------------------------------------------------ */

function LibraryCard({
  strategy,
  selected,
  seats,
  onSelect,
}: {
  strategy: Strategy;
  selected: boolean;
  seats: string[];
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected}
        className={cn(
          'w-full rounded-lg border px-2.5 py-2 text-left transition-colors',
          selected
            ? 'border-brass-500/60 bg-brass-500/10'
            : 'border-white/[0.06] bg-pit-900/40 hover:border-white/15 hover:bg-pit-800/50',
        )}
      >
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-xs font-semibold text-pit-100">{strategy.name}</span>
          <span className="tabular shrink-0 text-[10px] text-pit-400">
            {money(strategy.unit)} unit
          </span>
        </span>
        <span className="mt-0.5 line-clamp-2 block text-[10px] leading-relaxed text-pit-400">
          {strategy.summary}
        </span>
        {seats.length > 0 ? (
          <span className="mt-1 flex flex-wrap gap-1">
            {seats.map((name) => (
              <span
                key={name}
                className="rounded-sm bg-brass-500/20 px-1 py-px text-[9px] font-bold tracking-wider text-brass-300 uppercase"
              >
                {name}
              </span>
            ))}
          </span>
        ) : null}
      </button>
    </li>
  );
}

/* ------------------------------------------------------------------ *
 * Assignment
 * ------------------------------------------------------------------ */

function SeatRow({ seat, strategy }: { seat: SeatId; strategy: Strategy }) {
  const table = useGame((s) => s.table);
  const assigned = useGame((s) => s.seatStrategy[seat]);
  const assignStrategy = useGame((s) => s.assignStrategy);
  const setSeatAuto = useGame((s) => s.setSeatAuto);
  const runSeatStrategy = useGame((s) => s.runSeatStrategy);

  const playingThis = assigned.strategyId === strategy.id;
  const mode: SeatMode = !playingThis ? 'OFF' : assigned.auto ? 'AUTO' : 'MANUAL';
  const other = playingThis ? null : assigned.strategyId;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-white/[0.06] bg-pit-900/40 px-2.5 py-2">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold text-pit-100">
          {table.seats[seat].name}
        </span>
        <span className="block text-[10px] text-pit-400">
          {other ? 'playing something else' : mode === 'OFF' ? 'played by hand' : 'playing this'}
        </span>
      </span>

      <Segmented<SeatMode>
        value={mode}
        options={SEAT_MODE_OPTIONS}
        onChange={(next) => {
          uiClick();
          if (next === 'OFF') {
            assignStrategy(seat, null);
            return;
          }
          if (!playingThis) assignStrategy(seat, strategy.id);
          setSeatAuto(seat, next === 'AUTO');
        }}
      />

      <Button
        size="sm"
        onClick={() => runSeatStrategy(seat)}
        disabled={!playingThis}
        title="Apply this strategy to the felt once, right now"
      >
        Run
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Detail column
 * ------------------------------------------------------------------ */

function Detail({
  strategy,
  onCreated,
}: {
  strategy: Strategy;
  /** Duplicating is only useful if it hands you the copy to edit. */
  onCreated: (id: string) => void;
}) {
  const solo = useGame((s) => s.table.solo);
  const saveStrategy = useGame((s) => s.saveStrategy);
  const deleteStrategy = useGame((s) => s.deleteStrategy);
  const createStrategy = useGame((s) => s.createStrategy);
  const [confirmDelete, setConfirmDelete] = React.useState(false);

  const editable = strategy.origin === 'CUSTOM';
  const warnings = React.useMemo(() => strategyWarnings(strategy), [strategy]);
  const general = warnings.filter((w) => w.ruleId === null);
  const patch = (next: Partial<Strategy>) => saveStrategy({ ...strategy, ...next });

  const setRules = (rules: StrategyRule[]) => patch({ rules });

  const addRule = () => {
    // Ids only have to be unique inside one strategy, and the highest suffix
    // in use plus one is enough for that without a global counter.
    const used = strategy.rules
      .map((r) => Number(r.id.split('#')[1]))
      .filter((n) => !Number.isNaN(n));
    const next = (used.length > 0 ? Math.max(...used) : -1) + 1;
    setRules([
      ...strategy.rules,
      {
        id: `${strategy.id}#${next}`,
        enabled: true,
        when: 'POINT_ON',
        once: 'ALWAYS',
        all: [{ t: 'HAS_BET', target: { kind: 'PLACE', number: 6 }, has: false }],
        then: [{ t: 'BET', target: { kind: 'PLACE', number: 6 }, amount: { mode: 'UNITS', value: 1 } }],
      },
    ]);
  };

  const moveRule = (index: number, delta: number) => {
    const to = index + delta;
    if (to < 0 || to >= strategy.rules.length) return;
    const rules = [...strategy.rules];
    const [moved] = rules.splice(index, 1);
    rules.splice(to, 0, moved);
    setRules(rules);
  };

  return (
    <div className="flex min-h-0 flex-col gap-3">
      {/* Identity */}
      <header>
        {editable ? (
          <input
            value={strategy.name}
            onChange={(e) => patch({ name: e.target.value.slice(0, 40) })}
            aria-label="Strategy name"
            className="w-full rounded border border-white/10 bg-pit-850 px-2 py-1.5 text-sm font-semibold text-pit-100"
          />
        ) : (
          <h3
            className="text-lg font-bold tracking-wide text-brass-300"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {strategy.name}
          </h3>
        )}

        {editable ? (
          <input
            value={strategy.summary}
            onChange={(e) => patch({ summary: e.target.value.slice(0, 160) })}
            placeholder="One line about how it plays"
            aria-label="Strategy summary"
            className="mt-1.5 w-full rounded border border-white/10 bg-pit-850 px-2 py-1.5 text-[11px] text-pit-300"
          />
        ) : (
          <p className="mt-1 text-[11px] leading-relaxed text-pit-300">{strategy.summary}</p>
        )}
      </header>

      {/* Money */}
      <section className="flex flex-wrap items-end gap-4 rounded-md border border-white/[0.06] bg-pit-900/40 px-3 py-2">
        <label className="block">
          <span className="stat-label">Base unit</span>
          <div className="mt-1">
            <NumberBox
              value={strategy.unit}
              min={1}
              prefix="$"
              onChange={(unit) => patch({ unit })}
              ariaLabel="Base unit"
            />
          </div>
        </label>
        <label className="block">
          <span className="stat-label">Win goal</span>
          <div className="mt-1">
            <NumberBox
              value={strategy.winGoal}
              min={0}
              step={25}
              prefix="$"
              onChange={(winGoal) => patch({ winGoal })}
              ariaLabel="Win goal"
            />
          </div>
        </label>
        <label className="block">
          <span className="stat-label">Loss limit</span>
          <div className="mt-1">
            <NumberBox
              value={strategy.lossLimit}
              min={0}
              step={25}
              prefix="$"
              onChange={(lossLimit) => patch({ lossLimit })}
              ariaLabel="Loss limit"
            />
          </div>
        </label>
        <p className="min-w-[12rem] flex-1 text-[10px] leading-relaxed text-pit-400">
          Every bet written in units multiplies the base. Zero for a goal or a limit means it plays
          on regardless.
        </p>
      </section>

      {/* Who plays it */}
      <section>
        <h4 className="stat-label mb-1.5">Put it on a seat</h4>
        <div className="space-y-1.5">
          <SeatRow seat="A" strategy={strategy} />
          {solo ? (
            <p className="text-[10px] text-pit-400">
              This is a solo table. Start a two-player session to run a strategy against yourself.
            </p>
          ) : (
            <SeatRow seat="B" strategy={strategy} />
          )}
        </div>
      </section>

      {general.length > 0 ? (
        <ul className="rounded-md border border-amber-400/25 bg-amber-400/[0.07] px-3 py-2">
          {general.map((w) => (
            <li key={w.text} className="text-[10px] leading-relaxed text-amber-200/90">
              {w.text}
            </li>
          ))}
        </ul>
      ) : null}

      {/* Rules */}
      <section className="min-h-0">
        <div className="mb-1.5 flex items-center justify-between">
          <h4 className="stat-label">
            Rules · run top to bottom, every time there is a chance to bet
          </h4>
          {editable ? (
            <Button size="sm" onClick={addRule}>
              + Rule
            </Button>
          ) : null}
        </div>

        {strategy.rules.length === 0 ? (
          <p className="rounded-md border border-dashed border-white/10 px-3 py-4 text-center text-[11px] text-pit-400">
            No rules yet. Add one, or duplicate a house system and take it apart.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {strategy.rules.map((rule, i) => (
              <RuleCard
                key={rule.id}
                rule={rule}
                unit={strategy.unit}
                index={i}
                count={strategy.rules.length}
                readOnly={!editable}
                warnings={warnings.filter((w) => w.ruleId === rule.id).map((w) => w.text)}
                onChange={(next) => setRules(strategy.rules.map((r, j) => (i === j ? next : r)))}
                onRemove={() => setRules(strategy.rules.filter((_, j) => j !== i))}
                onMove={(delta) => moveRule(i, delta)}
              />
            ))}
          </ul>
        )}
      </section>

      {/* Housekeeping */}
      <footer className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] pt-3">
        <Button
          onClick={() => {
            onCreated(createStrategy(strategy));
            uiClick();
          }}
          title="Make an editable copy in your own library and open it"
        >
          Duplicate
        </Button>
        {editable ? (
          confirmDelete ? (
            <>
              <span className="text-[11px] text-pit-300">Delete {strategy.name}?</span>
              <Button variant="danger" size="sm" onClick={() => deleteStrategy(strategy.id)}>
                Delete it
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                Keep it
              </Button>
            </>
          ) : (
            <Button variant="danger" onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          )
        ) : (
          <span className="text-[10px] text-pit-400">
            House systems are read-only. Duplicate it to change anything.
          </span>
        )}
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Export and import
 * ------------------------------------------------------------------ */

function Exchange({ selected }: { selected: Strategy | null }) {
  const importStrategy = useGame((s) => s.importStrategy);
  const [text, setText] = React.useState('');
  const [open, setOpen] = React.useState(false);

  return (
    <div className="border-t border-white/[0.06] pt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="stat-label flex w-full items-center justify-between hover:text-pit-100"
      >
        Share a strategy
        <span aria-hidden>{open ? '▴' : '▾'}</span>
      </button>

      {open ? (
        <div className="mt-2 space-y-1.5">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste a strategy here, or export one below"
            aria-label="Strategy JSON"
            spellCheck={false}
            className="thin-scroll h-24 w-full resize-none rounded border border-white/10 bg-pit-850 p-2 font-mono text-[10px] leading-relaxed text-pit-300"
          />
          <div className="flex gap-1.5">
            <Button
              size="sm"
              className="flex-1"
              disabled={!selected}
              onClick={() => selected && setText(JSON.stringify(selected, null, 2))}
            >
              Export
            </Button>
            <Button
              size="sm"
              className="flex-1"
              disabled={text.trim().length === 0}
              onClick={() => {
                if (importStrategy(text)) setText('');
              }}
            >
              Import
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The dialog
 * ------------------------------------------------------------------ */

export function StrategyWorkshop({
  open,
  onClose,
  initialId,
}: {
  open: boolean;
  onClose: () => void;
  /** Which strategy to land on — the seat badge passes the one it is playing. */
  initialId?: string | null;
}) {
  const customStrategies = useGame((s) => s.customStrategies);
  const seatStrategy = useGame((s) => s.seatStrategy);
  const table = useGame((s) => s.table);
  const createStrategy = useGame((s) => s.createStrategy);

  const library = React.useMemo(() => allStrategies(customStrategies), [customStrategies]);
  // The page remounts this dialog every time it opens, so plain initial state
  // already lands on whatever the caller asked for — no effect has to reset it.
  const [selectedId, setSelectedId] = React.useState<string>(
    initialId ?? library[0]?.id ?? 'pass-odds',
  );
  const [filter, setFilter] = React.useState('');

  // Deleting the selected strategy leaves the id pointing at nothing, so the
  // fallback here is what everything below reads. There is no need to write it
  // back: a stale id is only ever compared against, never displayed.
  const selected = library.find((s) => s.id === selectedId) ?? library[0] ?? null;

  const needle = filter.trim().toLowerCase();
  const matches = (s: Strategy) =>
    needle.length === 0 ||
    s.name.toLowerCase().includes(needle) ||
    s.summary.toLowerCase().includes(needle);

  const houseList = library.filter((s) => s.origin === 'HOUSE' && matches(s));
  const mineList = library.filter((s) => s.origin === 'CUSTOM' && matches(s));

  /** Which seats are playing a given strategy, for the badges on its card. */
  const seatsFor = (id: string): string[] =>
    (['A', 'B'] as SeatId[])
      .filter((seat) => !(table.solo && seat === 'B'))
      .filter((seat) => seatStrategy[seat].strategyId === id)
      .map((seat) => `${table.seats[seat].name}${seatStrategy[seat].auto ? ' · auto' : ''}`);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Strategy workshop"
      width="max-w-6xl"
      bodyClassName="p-0"
    >
      <div className="grid max-h-[76vh] min-h-0 grid-cols-1 md:grid-cols-[16rem_minmax(0,1fr)]">
        {/* Library */}
        <aside className="thin-scroll flex max-h-[30vh] min-h-0 flex-col gap-2 overflow-y-auto border-white/[0.06] p-3 md:max-h-[76vh] md:border-r">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search systems"
            aria-label="Search strategies"
            className="h-7 w-full rounded border border-white/10 bg-pit-850 px-2 text-[11px] text-pit-100"
          />

          <div>
            <h3 className="stat-label mb-1.5">House systems · {houseList.length}</h3>
            <ul className="space-y-1.5">
              {houseList.map((s) => (
                <LibraryCard
                  key={s.id}
                  strategy={s}
                  selected={s.id === selected?.id}
                  seats={seatsFor(s.id)}
                  onSelect={() => setSelectedId(s.id)}
                />
              ))}
            </ul>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <h3 className="stat-label">Mine · {mineList.length}</h3>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelectedId(createStrategy())}
                title="Start a strategy from scratch"
              >
                + New
              </Button>
            </div>
            {mineList.length === 0 ? (
              <p className="text-[10px] leading-relaxed text-pit-400">
                Nothing here yet. Duplicate a house system to get a working set of rules you can
                pull apart, or start from scratch.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {mineList.map((s) => (
                  <LibraryCard
                    key={s.id}
                    strategy={s}
                    selected={s.id === selected?.id}
                    seats={seatsFor(s.id)}
                    onSelect={() => setSelectedId(s.id)}
                  />
                ))}
              </ul>
            )}
          </div>

          <Exchange selected={selected} />
        </aside>

        {/* Detail */}
        <div className="thin-scroll max-h-[46vh] min-h-0 overflow-y-auto p-3 md:max-h-[76vh] md:p-4">
          {selected ? (
            <Detail key={selected.id} strategy={selected} onCreated={setSelectedId} />
          ) : (
            <p className="text-[11px] text-pit-400">Nothing selected.</p>
          )}
        </div>
      </div>
    </Modal>
  );
}
