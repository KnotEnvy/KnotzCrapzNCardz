'use client';

/**
 * Setting up a table.
 *
 * One form, two frames. The start screen wraps it when nobody has sat down
 * yet; the new-session dialog wraps the same component when they want to get
 * up and start again. Keeping it in one place is what stops the two from
 * drifting into offering different settings.
 *
 * The form is a plain controlled value with no store access of its own, so it
 * can be mounted anywhere and nothing is committed until the caller says so.
 */

import * as React from 'react';
import { Button, Segmented, Toggle, cn, money } from './ui/primitives';
import { useGame } from '@/lib/store/useGame';
import type { OddsScheme, TableRules, TableState } from '@/lib/engine/types';

export interface SetupConfig {
  solo: boolean;
  nameA: string;
  nameB: string;
  buyIn: number;
  minBet: number;
  maxBet: number;
  rebuyAmount: number;
  oddsScheme: OddsScheme;
  fieldPays3OnTwelve: boolean;
  vigOnWin: boolean;
  placeOffOnComeOut: boolean;
  hardwaysOffOnComeOut: boolean;
  enforceIncrements: boolean;
  propsRideAfterWin: boolean;
  fireBetEnabled: boolean;
  atsEnabled: boolean;
}

/** Seeds the form from whatever table is currently loaded. */
export function configFromTable(table: TableState): SetupConfig {
  const r = table.rules;
  return {
    solo: table.solo,
    nameA: table.seats.A.name,
    nameB: table.seats.B.name,
    buyIn: table.seats.A.buyIn,
    minBet: r.minBet,
    maxBet: r.maxBet,
    rebuyAmount: r.rebuyAmount,
    oddsScheme: r.oddsScheme,
    fieldPays3OnTwelve: r.fieldPays3OnTwelve,
    vigOnWin: r.vigOnWin,
    placeOffOnComeOut: r.placeOffOnComeOut,
    hardwaysOffOnComeOut: r.hardwaysOffOnComeOut,
    enforceIncrements: r.enforceIncrements,
    propsRideAfterWin: r.propsRideAfterWin,
    fireBetEnabled: r.fireBetEnabled,
    atsEnabled: r.atsEnabled,
  };
}

/** Turns the form into the arguments `newSession` wants. */
export function toSessionOptions(cfg: SetupConfig): {
  seatAName: string;
  seatBName: string;
  buyIn: number;
  solo: boolean;
  rules: Partial<TableRules>;
} {
  const minBet = Math.max(1, Math.round(cfg.minBet));
  return {
    seatAName: cfg.nameA.trim() || 'Player 1',
    seatBName: cfg.nameB.trim() || 'Player 2',
    buyIn: Math.max(minBet, Math.round(cfg.buyIn)),
    solo: cfg.solo,
    rules: {
      minBet,
      maxBet: Math.max(minBet, Math.round(cfg.maxBet)),
      rebuyAmount: Math.max(minBet, Math.round(cfg.rebuyAmount)),
      oddsScheme: cfg.oddsScheme,
      fieldPays3OnTwelve: cfg.fieldPays3OnTwelve,
      vigOnWin: cfg.vigOnWin,
      placeOffOnComeOut: cfg.placeOffOnComeOut,
      hardwaysOffOnComeOut: cfg.hardwaysOffOnComeOut,
      enforceIncrements: cfg.enforceIncrements,
      propsRideAfterWin: cfg.propsRideAfterWin,
      fireBetEnabled: cfg.fireBetEnabled,
      atsEnabled: cfg.atsEnabled,
    },
  };
}

/* ------------------------------------------------------------------ *
 * Fields
 * ------------------------------------------------------------------ */

function Field({
  label,
  hint,
  value,
  min,
  step = 1,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  step?: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="block">
      <span className="stat-label">{label}</span>
      <input
        type="number"
        min={min}
        step={step}
        value={value}
        onChange={(e) => onChange(Math.max(min, Number(e.target.value) || min))}
        className="tabular mt-1 w-full rounded border border-white/10 bg-pit-850 px-2 py-1.5 text-xs text-pit-100"
      />
      {hint ? <span className="mt-1 block text-[10px] text-pit-400">{hint}</span> : null}
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="stat-label">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, 18))}
        className="mt-1 w-full rounded border border-white/10 bg-pit-850 px-2 py-1.5 text-xs text-pit-100"
      />
    </label>
  );
}

/* ------------------------------------------------------------------ *
 * The form
 * ------------------------------------------------------------------ */

export function SetupForm({
  value,
  onChange,
}: {
  value: SetupConfig;
  onChange: (next: SetupConfig) => void;
}) {
  const set = <K extends keyof SetupConfig>(key: K, v: SetupConfig[K]) =>
    onChange({ ...value, [key]: v });

  return (
    <div className="space-y-5">
      <section>
        <h3 className="stat-label mb-2">Who is playing</h3>
        <Segmented<'solo' | 'pair'>
          value={value.solo ? 'solo' : 'pair'}
          onChange={(v) => set('solo', v === 'solo')}
          options={[
            { value: 'solo', label: 'Solo', title: 'One player, and the dice never leave your hand' },
            { value: 'pair', label: 'Two players', title: 'Two seats at one screen, passing the dice' },
          ]}
        />
        <div className={cn('mt-3 grid gap-3', value.solo ? 'grid-cols-1' : 'grid-cols-2')}>
          <TextField label={value.solo ? 'Your name' : 'Seat A'} value={value.nameA} onChange={(v) => set('nameA', v)} />
          {value.solo ? null : (
            <TextField label="Seat B" value={value.nameB} onChange={(v) => set('nameB', v)} />
          )}
        </div>
      </section>

      <section>
        <h3 className="stat-label mb-2">Money</h3>
        <div className="grid grid-cols-3 gap-3">
          <Field
            label={value.solo ? 'Buy-in' : 'Buy-in each'}
            value={value.buyIn}
            min={1}
            step={100}
            onChange={(n) => set('buyIn', n)}
          />
          <Field
            label="Re-buy"
            hint="What BUY IN adds"
            value={value.rebuyAmount}
            min={1}
            step={100}
            onChange={(n) => set('rebuyAmount', n)}
          />
          <Field
            label="Table minimum"
            hint="Smaller bets are taken at this"
            value={value.minBet}
            min={1}
            onChange={(n) => set('minBet', n)}
          />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field label="Table maximum" value={value.maxBet} min={value.minBet} step={100} onChange={(n) => set('maxBet', n)} />
          <div>
            <span className="stat-label">Maximum odds</span>
            <div className="mt-1">
              <Segmented<OddsScheme>
                value={value.oddsScheme}
                onChange={(v) => set('oddsScheme', v)}
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
        </div>
      </section>

      <section>
        <h3 className="stat-label mb-1">House rules</h3>
        <Toggle
          checked={value.fieldPays3OnTwelve}
          onChange={(v) => set('fieldPays3OnTwelve', v)}
          label="Field pays triple on twelve"
          hint="Off pays double, which costs you about 2.8 percent more"
        />
        <Toggle
          checked={value.vigOnWin}
          onChange={(v) => set('vigOnWin', v)}
          label="Buy and lay commission on the win"
          hint="The modern rule, and cheaper than paying up front"
        />
        <Toggle
          checked={value.placeOffOnComeOut}
          onChange={(v) => set('placeOffOnComeOut', v)}
          label="Place bets off on the come-out"
        />
        <Toggle
          checked={value.hardwaysOffOnComeOut}
          onChange={(v) => set('hardwaysOffOnComeOut', v)}
          label="Hardways off on the come-out"
        />
        <Toggle
          checked={value.propsRideAfterWin}
          onChange={(v) => set('propsRideAfterWin', v)}
          label="Single-roll bets ride after a win"
        />
        <Toggle
          checked={value.enforceIncrements}
          onChange={(v) => set('enforceIncrements', v)}
          label="Snap wagers to payable increments"
          hint="A quarter on the six goes up as thirty, the way it is bet"
        />
        <Toggle
          checked={value.fireBetEnabled}
          onChange={(v) => set('fireBetEnabled', v)}
          label="Offer the Fire Bet"
        />
        <Toggle
          checked={value.atsEnabled}
          onChange={(v) => set('atsEnabled', v)}
          label="Offer All / Tall / Small"
        />
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The start screen
 * ------------------------------------------------------------------ */

/**
 * What a player sees before anything else. It owns the same form the new
 * session dialog does, so the settings chosen here are the settings the table
 * opens with — no second pass through House rules to make them stick.
 */
export function StartScreen() {
  const table = useGame((s) => s.table);
  const newSession = useGame((s) => s.newSession);
  const [cfg, setCfg] = React.useState<SetupConfig>(() => configFromTable(table));

  return (
    <div className="thin-scroll h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-center gap-6 p-6">
        <header className="text-center">
          <h1
            className="text-4xl font-bold tracking-[0.3em] text-brass-400 uppercase sm:text-5xl"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Knotz Craps
          </h1>
          <p className="mt-2 text-xs tracking-[0.2em] text-pit-400 uppercase">
            Real dice · True odds · Your table, your rules
          </p>
        </header>

        <div className="panel p-5">
          <SetupForm value={cfg} onChange={setCfg} />

          <div className="mt-6 flex flex-col items-center gap-2">
            <Button
              variant="primary"
              size="lg"
              className="w-full max-w-sm text-base font-bold tracking-widest uppercase"
              onClick={() => newSession(toSessionOptions(cfg))}
            >
              Take the dice
            </Button>
            <p className="text-[10px] text-pit-400">
              {cfg.solo ? 'One seat' : 'Two seats'} · {money(cfg.buyIn)} buy-in ·{' '}
              {money(cfg.minBet)} minimum · {cfg.oddsScheme} odds
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
