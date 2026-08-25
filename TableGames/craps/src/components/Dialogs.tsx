'use client';

/**
 * Modals: hop bets, house rules, and a new session.
 *
 * Hand-rolled rather than pulled from a component library, because all three
 * want the same thing — a focus-trapped panel over a dimmed felt — and that is
 * about thirty lines.
 */

import { AnimatePresence, motion } from 'motion/react';
import * as React from 'react';
import { SetupForm, configFromTable, toSessionOptions, type SetupConfig } from './Setup';
import { PRINT_DIE_FACE, PRINT_DIE_PIP, PipPair } from './table/Pips';
import { Button, Panel, Segmented, Toggle, cn, money } from './ui/primitives';
import { hopOdds, formatRatio } from '@/lib/engine/odds';
import { useGame } from '@/lib/store/useGame';
import type { DieFace, OddsScheme, PropKind } from '@/lib/engine/types';

/* ------------------------------------------------------------------ *
 * Shell
 * ------------------------------------------------------------------ */

export function Modal({
  open,
  onClose,
  title,
  children,
  width = 'max-w-lg',
  bodyClassName = 'max-h-[70vh] overflow-y-auto thin-scroll p-4',
  action,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  width?: string;
  /** The workshop wants a taller body that scrolls its own two columns. */
  bodyClassName?: string;
  /** Extra controls beside the close button in the header. */
  action?: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key !== 'Tab' || !ref.current) return;
      const focusable = ref.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('button, input, select')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ scale: 0.96, y: 12 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.97, y: 8 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            className={cn('relative w-full', width)}
          >
            <Panel
              title={title}
              action={
                <span className="flex items-center gap-2">
                  {action}
                  <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close">
                    Esc
                  </Button>
                </span>
              }
              bodyClassName={bodyClassName}
            >
              {children}
            </Panel>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ *
 * Hop and horn bets
 * ------------------------------------------------------------------ */

/** The four horn numbers, each callable "high". */
const HORN_HIGH: Array<[PropKind, string, [DieFace, DieFace]]> = [
  ['HORN_HIGH_2', 'aces', [1, 1]],
  ['HORN_HIGH_3', 'three', [1, 2]],
  ['HORN_HIGH_YO', 'yo', [5, 6]],
  ['HORN_HIGH_12', 'twelve', [6, 6]],
];

/**
 * Every hop, grouped under the total it makes.
 *
 * Sorted by number rather than by dice combination: a player calling a hop is
 * thinking "I want the eight the hard way", not "I want four-four", so the
 * totals run 2 to 12 down the panel and the combinations sit underneath the
 * number they add up to.
 */
const HOP_BY_TOTAL: Array<{ total: number; combos: Array<[DieFace, DieFace]> }> = (() => {
  const byTotal = new Map<number, Array<[DieFace, DieFace]>>();
  for (let a = 1; a <= 6; a++) {
    for (let b = a; b <= 6; b++) {
      const total = a + b;
      const list = byTotal.get(total) ?? [];
      list.push([a as DieFace, b as DieFace]);
      byTotal.set(total, list);
    }
  }
  return [...byTotal.entries()]
    .sort((x, y) => x[0] - y[0])
    .map(([total, combos]) => ({ total, combos }));
})();

export function HopDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const wager = useGame((s) => s.wager);
  const chip = useGame((s) => s.chip);

  return (
    <Modal open={open} onClose={onClose} title="Hop and horn bets" width="max-w-2xl">
      <p className="mb-3 text-[11px] leading-relaxed text-pit-400">
        One-roll calls that do not have their own spot on the felt. Your {money(chip)} chip goes up
        on whichever you pick.
      </p>
      <h3 className="stat-label mb-2">Horn high</h3>
      <p className="mb-2 text-[11px] leading-relaxed text-pit-400">
        Five units: two on the number you call, one on each of the other three.
      </p>
      <div className="mb-5 grid grid-cols-4 gap-2">
        {HORN_HIGH.map(([prop, label, pair]) => (
          <button
            key={prop}
            type="button"
            onClick={() => {
              wager({ kind: 'PROP', prop });
              onClose();
            }}
            className="flex flex-col items-center gap-1 rounded-md border border-white/10 bg-pit-800 px-2 py-2 transition-colors hover:bg-pit-700"
            title={`Horn high ${label}`}
          >
            <svg width={40} height={18} viewBox="-20 -9 40 18" aria-hidden>
              <PipPair x={0} y={0} size={16} a={pair[0]} b={pair[1]} face={PRINT_DIE_FACE} pip={PRINT_DIE_PIP} />
            </svg>
            <span className="text-[10px] font-semibold text-pit-300">high {label}</span>
          </button>
        ))}
      </div>

      <h3 className="stat-label mb-2">Hop</h3>
      <p className="mb-2 text-[11px] leading-relaxed text-pit-400">
        An exact combination on the next roll. Pairs pay 30 to 1, splits pay 15 to 1.
      </p>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {HOP_BY_TOTAL.map(({ total, combos }) => (
          <div key={total} className="rounded-md border border-white/10 bg-pit-850/60 p-1.5">
            <div
              className="mb-1.5 text-center text-lg font-bold leading-none text-brass-300"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              {total}
            </div>
            <div className="flex flex-col gap-1">
              {combos.map(([a, b]) => {
                const hard = a === b;
                return (
                  <button
                    key={`${a}${b}`}
                    type="button"
                    onClick={() => {
                      wager({ kind: 'HOP', hop: [a, b] });
                      onClose();
                    }}
                    title={`Hop the ${a}-${b}${hard ? ', a pair' : ''}`}
                    className={cn(
                      'flex flex-col items-center gap-0.5 rounded border px-1 py-1 transition-colors',
                      hard
                        ? 'border-brass-500/40 bg-brass-500/10 hover:bg-brass-500/20'
                        : 'border-white/10 bg-pit-800 hover:bg-pit-700',
                    )}
                  >
                    <svg width={40} height={18} viewBox="-20 -9 40 18" aria-hidden>
                      <PipPair x={0} y={0} size={16} a={a} b={b} face={PRINT_DIE_FACE} pip={PRINT_DIE_PIP} />
                    </svg>
                    <span className="text-[9px] font-semibold text-pit-400">
                      {formatRatio(hopOdds(a, b))}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ *
 * House rules
 * ------------------------------------------------------------------ */

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const table = useGame((s) => s.table);
  const updateRules = useGame((s) => s.updateRules);
  const renameSeat = useGame((s) => s.renameSeat);
  const soundOn = useGame((s) => s.soundOn);
  const toggleSound = useGame((s) => s.toggleSound);
  const seed = useGame((s) => s.seed);
  const reseed = useGame((s) => s.reseed);
  const r = table.rules;

  return (
    <Modal open={open} onClose={onClose} title="House rules">
      <div className="space-y-5">
        <section>
          <h3 className="stat-label mb-2">Players</h3>
          <div className="grid grid-cols-2 gap-3">
            {(['A', 'B'] as const).map((id) => (
              <label key={id} className="block">
                <span className="stat-label">Seat {id}</span>
                <input
                  value={table.seats[id].name}
                  onChange={(e) => renameSeat(id, e.target.value.slice(0, 18))}
                  className="mt-1 w-full rounded border border-white/10 bg-pit-850 px-2 py-1.5 text-xs text-pit-100"
                />
              </label>
            ))}
          </div>
        </section>

        <section>
          <h3 className="stat-label mb-2">Limits</h3>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="stat-label">Table minimum</span>
              <input
                type="number"
                min={1}
                value={r.minBet}
                onChange={(e) => updateRules({ minBet: Math.max(1, Number(e.target.value) || 1) })}
                className="mt-1 w-full rounded border border-white/10 bg-pit-850 px-2 py-1.5 text-xs text-pit-100"
              />
            </label>
            <label className="block">
              <span className="stat-label">Table maximum</span>
              <input
                type="number"
                min={r.minBet}
                value={r.maxBet}
                onChange={(e) => updateRules({ maxBet: Math.max(r.minBet, Number(e.target.value) || r.minBet) })}
                className="mt-1 w-full rounded border border-white/10 bg-pit-850 px-2 py-1.5 text-xs text-pit-100"
              />
            </label>
          </div>
          <div className="mt-3">
            <span className="stat-label">Maximum odds</span>
            <div className="mt-1">
              <Segmented<OddsScheme>
                value={r.oddsScheme}
                onChange={(v) => updateRules({ oddsScheme: v })}
                className="flex-wrap"
                options={[
                  { value: '1x', label: '1x' },
                  { value: '2x', label: '2x' },
                  { value: '3-4-5', label: '3-4-5x', title: 'The modern standard' },
                  { value: '5x', label: '5x' },
                  { value: '10x', label: '10x' },
                  { value: '20x', label: '20x' },
                  { value: '100x', label: '100x' },
                ]}
              />
            </div>
          </div>
        </section>

        <section>
          <h3 className="stat-label mb-1">Table rules</h3>
          <Toggle
            checked={r.fieldPays3OnTwelve}
            onChange={(v) => updateRules({ fieldPays3OnTwelve: v })}
            label="Field pays triple on twelve"
            hint="Off pays double, which costs you about 2.8 percent more"
          />
          <Toggle
            checked={r.vigOnWin}
            onChange={(v) => updateRules({ vigOnWin: v })}
            label="Buy and lay commission on the win"
            hint="The modern rule, and cheaper than paying up front"
          />
          <Toggle
            checked={r.placeOffOnComeOut}
            onChange={(v) => updateRules({ placeOffOnComeOut: v })}
            label="Place bets off on the come-out"
          />
          <Toggle
            checked={r.hardwaysOffOnComeOut}
            onChange={(v) => updateRules({ hardwaysOffOnComeOut: v })}
            label="Hardways off on the come-out"
          />
          <Toggle
            checked={r.propsRideAfterWin}
            onChange={(v) => updateRules({ propsRideAfterWin: v })}
            label="Single-roll bets ride after a win"
            hint="What a real table does: it pays you and leaves the bet up"
          />
          <Toggle
            checked={r.enforceIncrements}
            onChange={(v) => updateRules({ enforceIncrements: v })}
            label="Snap wagers to payable increments"
            hint="Rounds the six and eight to multiples of six, and so on"
          />
          <Toggle
            checked={r.fireBetEnabled}
            onChange={(v) => updateRules({ fireBetEnabled: v })}
            label="Offer the Fire Bet"
          />
          <Toggle
            checked={r.atsEnabled}
            onChange={(v) => updateRules({ atsEnabled: v })}
            label="Offer All / Tall / Small"
          />
        </section>

        <section>
          <h3 className="stat-label mb-1">Session</h3>
          <Toggle checked={soundOn} onChange={() => toggleSound()} label="Sound" />
          <div className="mt-2 flex items-end gap-2">
            <label className="min-w-0 flex-1">
              <span className="stat-label">Dice seed</span>
              <input
                readOnly
                value={seed}
                className="tabular mt-1 w-full truncate rounded border border-white/10 bg-pit-850 px-2 py-1.5 text-[11px] text-pit-300"
              />
            </label>
            <Button size="sm" onClick={() => reseed()}>
              New seed
            </Button>
          </div>
          <p className="mt-1.5 text-[10px] leading-relaxed text-pit-400">
            Every roll comes from this seed, so the same seed replays the same session. Changing it
            starts a fresh stream of dice.
          </p>
        </section>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ *
 * New session
 * ------------------------------------------------------------------ */

export function NewSessionDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const table = useGame((s) => s.table);
  const newSession = useGame((s) => s.newSession);
  const seatStrategy = useGame((s) => s.seatStrategy);
  // The parent remounts this dialog every time it is opened, so plain initial
  // state is already the current table and needs no resetting effect.
  const [cfg, setCfg] = React.useState<SetupConfig>(() =>
    configFromTable(table, { A: seatStrategy.A.strategyId, B: seatStrategy.B.strategyId }),
  );

  return (
    <Modal open={open} onClose={onClose} title="New session" width="max-w-xl">
      <p className="mb-4 text-[11px] leading-relaxed text-pit-400">
        This clears the felt, the bankrolls and the history, and puts fresh dice in the box.
        Whatever you set here is what the new table opens with.
      </p>
      <SetupForm value={cfg} onChange={setCfg} />
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={() => {
            newSession(toSessionOptions(cfg));
            onClose();
          }}
        >
          Deal me in
        </Button>
      </div>
    </Modal>
  );
}
