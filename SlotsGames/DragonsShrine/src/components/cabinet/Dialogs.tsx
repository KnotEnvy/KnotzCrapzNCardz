'use client';

/**
 * Everything behind glass.
 *
 * Four documents and one interruption. The paytable is the machine's legal
 * text and is written as such -- every figure on it is quoted twice, once as
 * the multiplier the paytable actually means and once as cash at the stake
 * currently on the deck, because a player reading "600" wants to know whether
 * that is six hundred dollars and it never is. Settings is every preference
 * the store carries, no more. The session panel is the honest accounting: what
 * went in, what came back, and how long the dry spells ran. Buy Feature is
 * priced from `BUY_COSTS` and says plainly that buying costs slightly more
 * than waiting.
 *
 * The fifth is the out-of-credit message, which is not a dialog anyone opened
 * and so is driven by `message` rather than by the UI store.
 *
 * Dialog visibility lives in `uiState` rather than here because the buttons
 * that open these are on the control deck, which is a sibling. The dialogs
 * themselves are unmounted when closed: the paytable draws fifty payline
 * diagrams and there is no reason for them to exist while nobody is reading.
 */

import * as React from 'react';
import { useCabinetUi } from './uiState';
import { SymbolArt, SYMBOL_META } from '@/components/symbols/Symbol';
import {
  Badge,
  Button,
  Dialog,
  Plate,
  PlateLabel,
  Segmented,
  Toggle,
  cn,
} from '@/components/ui/primitives';
import { STARTING_BANKROLL } from '@/lib/engine/config';
import { PAYLINES } from '@/lib/engine/lines';
import {
  BUY_COSTS,
  BUY_GRANTS,
  DRAGON_REEL_CHANCE,
  FREE_SPIN_AWARD,
  GAMBLE_MAX_RATIO,
  GAMBLE_MAX_STEPS,
  HOLD_RESPINS,
  HOLD_TRIGGER_ORBS,
  JACKPOTS,
  MAJOR_AT_CELLS,
  MULTIPLIER_TRAIL,
  ORB_VALUES,
  PAYS,
  RETRIGGER_SPINS,
  SCATTER_PAYS,
  SCATTER_TRIGGER,
  type BuyOption,
} from '@/lib/engine/paytable';
import {
  CELLS,
  JACKPOT_IDS,
  LINES,
  PAYING_SYMBOLS,
  REELS,
  ROWS,
  type JackpotId,
  type PayingSymbol,
  type SymbolId,
  type WinTier,
} from '@/lib/engine/types';
import { clock, count, linePay, money, moneyShort, ratio } from '@/lib/format';
import type { Preferences } from '@/lib/store/contract';
import { useSlots } from '@/lib/store/useSlots';

const JACKPOT_COLOR: Record<JackpotId, string> = {
  MINI: 'var(--jackpot-mini)',
  MINOR: 'var(--jackpot-minor)',
  MAJOR: 'var(--jackpot-major)',
  GRAND: 'var(--jackpot-grand)',
};

/** Paytable order is descending value, which is how a paytable is read. */
const PAY_ORDER: PayingSymbol[] = [...PAYING_SYMBOLS].reverse();

/* ------------------------------------------------------------------ *
 * Small shared parts
 * ------------------------------------------------------------------ */

function Tile({ id, className }: { id: SymbolId; className?: string }) {
  return (
    <span
      className={cn(
        'grid aspect-square shrink-0 place-items-center overflow-hidden rounded-md border border-gold-800/40 bg-ink-950/70',
        className,
      )}
    >
      <SymbolArt id={id} fit />
    </span>
  );
}

function Rule({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-white/[0.05] py-1 last:border-0">
      <span className="text-[11px] text-ink-300">{label}</span>
      <span className="numeric shrink-0 text-[11px] font-bold text-gold-300">{children}</span>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="display mb-2 text-[11px] font-bold tracking-[0.22em] text-gold-400 uppercase">
      {children}
    </h3>
  );
}

/* ------------------------------------------------------------------ *
 * Paytable
 * ------------------------------------------------------------------ */

type PayPage = 'symbols' | 'features' | 'lines';

/** One symbol's row: the art, the name, and 3/4/5 quoted twice. */
function PayRow({ id, betPerLine }: { id: PayingSymbol; betPerLine: number }) {
  const pays = PAYS[id];
  return (
    <li className="flex items-center gap-2 rounded-md border border-white/[0.06] bg-ink-950/50 p-1.5">
      <Tile id={id} className="w-12 sm:w-14" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[11px] font-semibold text-ink-100">
          {SYMBOL_META[id].label}
        </div>
        <dl className="mt-0.5 grid grid-cols-3 gap-1">
          {([5, 4, 3] as const).map((n) => (
            <div key={n} className="min-w-0">
              <dt className="text-[8px] font-bold tracking-[0.16em] text-ink-500 uppercase">
                {n} of a kind
              </dt>
              {/* `linePay` pads the multiple and the cash apart; keeping the
                  whitespace is the only reason the column lines up. */}
              <dd className="numeric truncate text-[10px] whitespace-pre text-gold-300">
                {linePay(pays[n - 3], betPerLine)}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </li>
  );
}

/** One payline, drawn on a five-by-four dot grid. */
function LineDiagram({ line }: { line: number }) {
  const rows = PAYLINES[line];
  const w = 46;
  const h = 38;
  const dx = w / (REELS + 1);
  const dy = h / (ROWS + 1);
  const pts = rows.map((row, reel) => `${dx * (reel + 1)},${dy * (row + 1)}`).join(' ');

  return (
    <li className="rounded border border-white/[0.06] bg-ink-950/60 p-1">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label={`Payline ${line + 1}`}>
        {Array.from({ length: REELS }, (_, reel) =>
          Array.from({ length: ROWS }, (_, row) => (
            <circle
              key={`${reel}-${row}`}
              cx={dx * (reel + 1)}
              cy={dy * (row + 1)}
              r={2}
              fill="var(--color-ink-700)"
            />
          )),
        )}
        <polyline
          points={pts}
          fill="none"
          stroke="var(--color-gold-400)"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {rows.map((row, reel) => (
          <circle
            key={reel}
            cx={dx * (reel + 1)}
            cy={dy * (row + 1)}
            r={2.6}
            fill="var(--color-gold-300)"
          />
        ))}
      </svg>
      <div className="numeric mt-0.5 text-center text-[8px] text-ink-500">{line + 1}</div>
    </li>
  );
}

function PaytableDialog({ onClose, reduced }: { onClose: () => void; reduced: boolean }) {
  const betPerLine = useSlots((s) => s.betPerLine);
  const totalBet = useSlots((s) => s.totalBet);
  const [page, setPage] = React.useState<PayPage>('symbols');

  return (
    <Dialog
      open
      onClose={onClose}
      reducedMotion={reduced}
      title="Paytable"
      width="max-w-3xl"
      footer={
        <span className="numeric rounded bg-ink-900/80 px-2 py-1 text-[10px] text-ink-400">
          Quoted at {money(betPerLine)} a line &middot; {money(totalBet)} a spin
        </span>
      }
    >
      <div className="mb-3 flex justify-center">
        <Segmented<PayPage>
          value={page}
          onChange={setPage}
          ariaLabel="Paytable section"
          options={[
            { value: 'symbols', label: 'Symbols' },
            { value: 'features', label: 'Features' },
            { value: 'lines', label: `${LINES} lines` },
          ]}
        />
      </div>

      {page === 'symbols' ? (
        <div className="space-y-4">
          <p className="text-[11px] leading-relaxed text-ink-400">
            Line wins pay left to right on adjacent reels and multiply the bet on one line. The
            golden pearl and the fire orb pay from anywhere and multiply the whole stake.
          </p>

          <ul className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
            {PAY_ORDER.map((id) => (
              <PayRow key={id} id={id} betPerLine={betPerLine} />
            ))}
          </ul>

          <section>
            <SectionTitle>Golden pearl &mdash; pays anywhere</SectionTitle>
            <div className="flex items-center gap-3 rounded-md border border-white/[0.06] bg-ink-950/50 p-2">
              <Tile id="SCATTER" className="w-14" />
              <dl className="grid flex-1 grid-cols-3 gap-2">
                {[5, 4, 3].map((n) => (
                  <div key={n}>
                    <dt className="text-[8px] font-bold tracking-[0.16em] text-ink-500 uppercase">
                      {n} pearls
                    </dt>
                    <dd className="numeric text-[11px] text-gold-300">
                      {count(SCATTER_PAYS[n])}x &middot; {money(SCATTER_PAYS[n] * totalBet)}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </section>

          <section>
            <SectionTitle>Fire orb &mdash; the link</SectionTitle>
            <div className="flex items-start gap-3 rounded-md border border-white/[0.06] bg-ink-950/50 p-2">
              <Tile id="ORB" className="w-14" />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] leading-relaxed text-ink-400">
                  An orb carries a multiple of the whole stake, or one of the two smaller jackpots.
                </p>
                <ul className="mt-1.5 flex flex-wrap gap-1">
                  {ORB_VALUES.map((v) => (
                    <li
                      key={v}
                      className="numeric rounded-sm border border-ember-700/50 bg-ember-700/15 px-1.5 py-0.5 text-[10px] text-ember-300"
                    >
                      {v}x &middot; {money(v * totalBet)}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>

          <section>
            <SectionTitle>Jackpots at this stake</SectionTitle>
            <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {JACKPOT_IDS.map((id) => (
                <li
                  key={id}
                  className="rounded-md border px-2 py-1.5 text-center"
                  style={{
                    borderColor: JACKPOT_COLOR[id],
                    background: `linear-gradient(180deg, color-mix(in srgb, ${JACKPOT_COLOR[id]} 12%, transparent), rgba(5,6,10,0.8))`,
                  }}
                >
                  <span
                    className="block text-[9px] font-black tracking-[0.18em] uppercase"
                    style={{ color: JACKPOT_COLOR[id] }}
                  >
                    {id}
                  </span>
                  <span className="numeric block text-sm font-black" style={{ color: JACKPOT_COLOR[id] }}>
                    {moneyShort(JACKPOTS[id] * totalBet)}
                  </span>
                  <span className="numeric block text-[9px] text-ink-500">{JACKPOTS[id]}x stake</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}

      {page === 'features' ? (
        <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded-md border border-ember-700/40 bg-ink-950/50 p-3">
            <SectionTitle>Shrine of Flames &mdash; free spins</SectionTitle>
            <p className="mb-2 text-[11px] leading-relaxed text-ink-400">
              {SCATTER_TRIGGER} golden pearls light the shrine. Inside it the dragon turns whole
              reels wild, and every dragon reel or extra pearl steps the multiplier trail up. The
              trail never steps back down inside a session.
            </p>
            <Rule label={`${SCATTER_TRIGGER} pearls`}>{FREE_SPIN_AWARD[3]} spins</Rule>
            <Rule label="4 pearls">{FREE_SPIN_AWARD[4]} spins</Rule>
            <Rule label="5 pearls">{FREE_SPIN_AWARD[5]} spins</Rule>
            <Rule label="Retrigger">+{RETRIGGER_SPINS} spins</Rule>
            <Rule label="Multiplier trail">{MULTIPLIER_TRAIL.join('x  ')}x</Rule>
            <Rule label="Dragon takes a reel">
              {Math.round(DRAGON_REEL_CHANCE.one * 100)}% of spins
            </Rule>
          </section>

          <section className="rounded-md border border-violet-700/40 bg-ink-950/50 p-3">
            <SectionTitle>Shrine Link &mdash; hold and win</SectionTitle>
            <p className="mb-2 text-[11px] leading-relaxed text-ink-400">
              {HOLD_TRIGGER_ORBS} fire orbs on one spin light the link. Only orbs land from then on,
              every orb holds where it fell, and every new orb puts the respins back to{' '}
              {HOLD_RESPINS}. Fill enough of the board and the board itself pays.
            </p>
            <Rule label="Trigger">{HOLD_TRIGGER_ORBS} orbs</Rule>
            <Rule label="Respins">{HOLD_RESPINS}, reset by every orb</Rule>
            <Rule label={`${MAJOR_AT_CELLS} niches filled`}>MAJOR</Rule>
            <Rule label={`All ${CELLS} niches filled`}>GRAND</Rule>
            <Rule label="Orbs carry">MINI and MINOR only</Rule>
          </section>

          <section className="rounded-md border border-cinnabar-700/40 bg-ink-950/50 p-3">
            <SectionTitle>Dragon Rage</SectionTitle>
            <p className="text-[11px] leading-relaxed text-ink-400">
              At random in the base game the dragon wakes and turns a scatter of cells wild before
              the win is worked out. It is not triggered by anything and it cannot be bought.
            </p>
          </section>

          <section className="rounded-md border border-gold-700/40 bg-ink-950/50 p-3">
            <SectionTitle>Gamble</SectionTitle>
            <p className="mb-2 text-[11px] leading-relaxed text-ink-400">
              Call the lantern red or black to double a win, up to {GAMBLE_MAX_STEPS} times. Collect
              at any point; a losing call ends the run and the win with it.
            </p>
            <Rule label="Maximum doubles">{GAMBLE_MAX_STEPS}</Rule>
            <Rule label="Wins eligible up to">{GAMBLE_MAX_RATIO}x the stake</Rule>
          </section>
        </div>
      ) : null}

      {page === 'lines' ? (
        <div>
          <p className="mb-3 text-[11px] leading-relaxed text-ink-400">
            All {LINES} lines are always active &mdash; line count is not a bet option, which is why
            the paytable can be quoted per line. Every line steps at most one row between reels, so
            a win can be traced with a finger.
          </p>
          <ul className="grid grid-cols-5 gap-1 sm:grid-cols-8 md:grid-cols-10">
            {PAYLINES.map((_, i) => (
              <LineDiagram key={i} line={i} />
            ))}
          </ul>
        </div>
      ) : null}
    </Dialog>
  );
}

/* ------------------------------------------------------------------ *
 * Settings
 * ------------------------------------------------------------------ */

function SettingsDialog({ onClose, reduced }: { onClose: () => void; reduced: boolean }) {
  const prefs = useSlots((s) => s.prefs);
  const setPref = useSlots((s) => s.setPref);
  const seed = useSlots((s) => s.seed);
  const newSession = useSlots((s) => s.newSession);

  const [draftSeed, setDraftSeed] = React.useState(seed);

  const toggles: Array<{ key: keyof Preferences; label: string; hint?: string }> = [
    { key: 'sound', label: 'Sound effects' },
    { key: 'music', label: 'Music' },
    { key: 'turbo', label: 'Turbo spin', hint: 'Shortens every beat of a spin except the teases' },
    {
      key: 'quickWins',
      label: 'Skip win takeovers',
      hint: 'The meter still counts; the screen is not taken over',
    },
    {
      key: 'reducedMotion',
      label: 'Reduced motion',
      hint: 'Cross-fades instead of large movement, and no particles',
    },
    { key: 'showLines', label: 'Show paylines on a win' },
    { key: 'leftHanded', label: 'Left-handed deck', hint: 'Puts the spin button on the other side' },
  ];

  return (
    <Dialog open onClose={onClose} title="Settings" width="max-w-md" reducedMotion={reduced}>
      <section className="mb-4">
        <SectionTitle>Machine</SectionTitle>
        {toggles.map((t) => (
          <Toggle
            key={t.key}
            label={t.label}
            hint={t.hint}
            checked={prefs[t.key]}
            onChange={(v) => setPref(t.key, v)}
          />
        ))}
      </section>

      <section>
        <SectionTitle>Session</SectionTitle>
        <p className="mb-2 text-[10px] leading-relaxed text-ink-400">
          Every spin comes from this seed, so the same seed replays the same session. Starting a new
          one clears the bankroll back to {money(STARTING_BANKROLL)} and forgets the history.
        </p>
        <label className="block">
          <PlateLabel>Seed</PlateLabel>
          <input
            value={draftSeed}
            onChange={(e) => setDraftSeed(e.target.value.slice(0, 40))}
            spellCheck={false}
            aria-label="Session seed"
            className="numeric mt-1 w-full rounded border border-white/10 bg-ink-950 px-2 py-1.5 text-[11px] text-ink-100"
          />
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => setDraftSeed(Math.random().toString(36).slice(2, 10))}
          >
            Random seed
          </Button>
          <Button
            size="sm"
            variant="gilt"
            onClick={() => {
              newSession(draftSeed.trim() === '' ? undefined : draftSeed.trim());
              onClose();
            }}
          >
            Start a new session
          </Button>
        </div>
      </section>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ *
 * Session statistics
 * ------------------------------------------------------------------ */

const TIER_TEXT: Record<WinTier, string> = {
  NONE: 'text-ink-600',
  SMALL: 'text-ink-300',
  MEDIUM: 'text-jade-300',
  BIG: 'text-gold-300',
  MEGA: 'text-ember-300',
  EPIC: 'text-violet-400',
  LEGENDARY: 'text-cinnabar-300',
};

function SessionDialog({ onClose, reduced }: { onClose: () => void; reduced: boolean }) {
  const stats = useSlots((s) => s.stats);
  const history = useSlots((s) => s.history);
  const bankroll = useSlots((s) => s.bankroll);
  const startedAt = useSlots((s) => s.startedAt);

  /* The clock is the only thing on this panel that moves on its own. */
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const back = stats.wagered > 0 ? (stats.won / stats.wagered) * 100 : 0;
  const recent = [...history].reverse().slice(0, 40);

  return (
    <Dialog open onClose={onClose} title="This session" width="max-w-2xl" reducedMotion={reduced}>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        <Plate label="Bankroll" value={money(bankroll)} valueClassName="text-sm" />
        <Plate label="Peak" value={money(stats.peak)} valueClassName="text-sm" />
        <Plate label="Wagered" value={money(stats.wagered)} valueClassName="text-sm" />
        <Plate
          label="Returned"
          value={money(stats.won)}
          tone="gold"
          valueClassName="text-sm"
          sub={`${back.toFixed(1)}% of turnover`}
        />
        <Plate label="Spins" value={count(stats.spins)} valueClassName="text-sm" />
        <Plate label="Free spins" value={count(stats.freeSpins)} valueClassName="text-sm" />
        <Plate
          label="Biggest win"
          value={money(stats.biggestWin)}
          tone="gold"
          valueClassName="text-sm"
        />
        <Plate
          label="Time played"
          value={clock((now - startedAt) / 1000)}
          valueClassName="text-sm"
        />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <section>
          <SectionTitle>Dry spells</SectionTitle>
          <Rule label="Spins since a win">{count(stats.dryStreak)}</Rule>
          <Rule label="Longest run without one">{count(stats.longestDryStreak)}</Rule>
        </section>

        <section>
          <SectionTitle>Features</SectionTitle>
          <Rule label="Free spins triggered">{count(stats.featureTriggers.FREE_SPINS)}</Rule>
          <Rule label="Links triggered">{count(stats.featureTriggers.HOLD_AND_WIN)}</Rule>
        </section>
      </div>

      <section className="mt-4">
        <SectionTitle>Jackpots</SectionTitle>
        <ul className="grid grid-cols-4 gap-1.5">
          {JACKPOT_IDS.map((id) => (
            <li
              key={id}
              className="rounded border border-white/[0.06] bg-ink-950/60 px-2 py-1 text-center"
            >
              <span
                className="block text-[9px] font-black tracking-[0.16em] uppercase"
                style={{ color: JACKPOT_COLOR[id] }}
              >
                {id}
              </span>
              <span className="numeric block text-sm font-bold text-ink-100">
                {count(stats.jackpots[id])}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-4">
        <SectionTitle>Recent spins</SectionTitle>
        {recent.length === 0 ? (
          <p className="text-[11px] text-ink-500">Nothing played yet.</p>
        ) : (
          <div className="max-h-64 overflow-y-auto rounded-md border border-white/[0.06]">
            <table className="w-full border-collapse text-left">
              <thead className="sticky top-0 bg-ink-900">
                <tr className="text-[9px] tracking-[0.16em] text-ink-500 uppercase">
                  <th className="px-2 py-1 font-bold">Spin</th>
                  <th className="px-2 py-1 font-bold">Bet</th>
                  <th className="px-2 py-1 font-bold">Win</th>
                  <th className="px-2 py-1 font-bold">Multiple</th>
                  <th className="px-2 py-1 font-bold">Tier</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((h) => (
                  <tr key={h.id} className="border-t border-white/[0.04]">
                    <td className="numeric px-2 py-1 text-[10px] text-ink-400">
                      {count(h.id)}
                      {h.free ? (
                        <Badge className="ml-1 bg-ember-700/40 text-ember-300">free</Badge>
                      ) : null}
                    </td>
                    <td className="numeric px-2 py-1 text-[10px] text-ink-300">
                      {money(h.totalBet)}
                    </td>
                    <td
                      className={cn('numeric px-2 py-1 text-[10px] font-bold', TIER_TEXT[h.tier])}
                    >
                      {h.win > 0 ? money(h.win) : '—'}
                    </td>
                    <td className="numeric px-2 py-1 text-[10px] text-ink-400">
                      {h.win > 0 ? ratio(h.win, h.totalBet) : '—'}
                    </td>
                    <td className={cn('px-2 py-1 text-[9px] tracking-[0.14em] uppercase', TIER_TEXT[h.tier])}>
                      {h.tier === 'NONE' ? '' : h.tier}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ *
 * Buy feature
 * ------------------------------------------------------------------ */

const BUY_COPY: Record<BuyOption, { name: string; blurb: string; accent: string }> = {
  FREE_SPINS: {
    name: 'Shrine of Flames',
    blurb: 'Enters free spins on three pearls, the same as landing them.',
    accent: 'var(--color-ember-400)',
  },
  HOLD_AND_WIN: {
    name: 'Shrine Link',
    blurb: 'Lights the link with a full six-orb trigger and three respins.',
    accent: 'var(--color-violet-400)',
  },
  SUPER: {
    name: 'Super Shrine',
    blurb: 'Enters free spins on five pearls: the longest run the shrine gives.',
    accent: 'var(--jackpot-grand)',
  },
};

function BuyDialog({ onClose, reduced }: { onClose: () => void; reduced: boolean }) {
  const totalBet = useSlots((s) => s.totalBet);
  const bankroll = useSlots((s) => s.bankroll);
  const buyFeature = useSlots((s) => s.buyFeature);

  const options: BuyOption[] = ['FREE_SPINS', 'HOLD_AND_WIN', 'SUPER'];

  return (
    <Dialog open onClose={onClose} title="Buy a feature" width="max-w-2xl" reducedMotion={reduced}>
      <p className="mb-3 text-[11px] leading-relaxed text-ink-400">
        Priced at the stake on the deck &mdash; {money(totalBet)} a spin. Buying returns very
        slightly less than waiting for the feature to arrive on its own, which is what a real buy
        button costs and why it is not simply the better way to play.
      </p>

      <ul className="grid gap-2 sm:grid-cols-3">
        {options.map((opt) => {
          const cost = BUY_COSTS[opt] * totalBet;
          const grant = BUY_GRANTS[opt];
          const afford = bankroll >= cost;
          const copy = BUY_COPY[opt];
          return (
            <li
              key={opt}
              className="flex flex-col rounded-lg border bg-ink-950/60 p-3"
              style={{ borderColor: copy.accent }}
            >
              <span
                className="display text-[11px] font-black tracking-[0.16em] uppercase"
                style={{ color: copy.accent }}
              >
                {copy.name}
              </span>
              <span className="numeric mt-1 text-lg leading-none font-black text-gold-300">
                {money(cost)}
              </span>
              <span className="numeric text-[9px] text-ink-500">{BUY_COSTS[opt]}x stake</span>
              <p className="mt-2 flex-1 text-[10px] leading-relaxed text-ink-400">{copy.blurb}</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {grant.scatters ? (
                  <Badge className="bg-gold-800/50 text-gold-300">{grant.scatters} pearls</Badge>
                ) : null}
                {grant.orbs ? (
                  <Badge className="bg-ember-700/40 text-ember-300">{grant.orbs} orbs</Badge>
                ) : null}
              </div>
              <Button
                variant="gilt"
                size="md"
                disabled={!afford}
                className="mt-3 w-full"
                onClick={() => {
                  buyFeature(opt);
                  onClose();
                }}
              >
                {afford ? 'BUY' : 'NOT ENOUGH CREDIT'}
              </Button>
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ *
 * Out of credit
 * ------------------------------------------------------------------ */

function MessageDialog({ message, reduced }: { message: string; reduced: boolean }) {
  const dismiss = useSlots((s) => s.dismissMessage);
  const rebuy = useSlots((s) => s.rebuy);

  return (
    <Dialog
      open
      onClose={dismiss}
      title="The machine cannot take that bet"
      width="max-w-sm"
      reducedMotion={reduced}
      footer={
        <>
          <Button variant="ghost" onClick={dismiss}>
            Not now
          </Button>
          <Button
            variant="gilt"
            onClick={() => {
              rebuy();
              dismiss();
            }}
          >
            Add funds
          </Button>
        </>
      }
    >
      <p className="text-[12px] leading-relaxed text-ink-200">{message}</p>
      <p className="mt-2 text-[11px] leading-relaxed text-ink-400">
        Lower the stake with the minus button, or add funds and carry on at this one.
      </p>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ *
 * The set
 * ------------------------------------------------------------------ */

export function Dialogs(): React.JSX.Element {
  const dialog = useCabinetUi((s) => s.dialog);
  const close = useCabinetUi((s) => s.close);
  const message = useSlots((s) => s.message);
  const reduced = useSlots((s) => s.prefs.reducedMotion);

  return (
    <>
      {dialog === 'paytable' ? <PaytableDialog onClose={close} reduced={reduced} /> : null}
      {dialog === 'settings' ? <SettingsDialog onClose={close} reduced={reduced} /> : null}
      {dialog === 'session' ? <SessionDialog onClose={close} reduced={reduced} /> : null}
      {dialog === 'buy' ? <BuyDialog onClose={close} reduced={reduced} /> : null}
      {message !== null ? <MessageDialog message={message} reduced={reduced} /> : null}
    </>
  );
}
