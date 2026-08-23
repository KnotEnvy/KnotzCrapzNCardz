'use client';

/**
 * Everything below the felt: whose money is on the table, which chip is armed,
 * the dealer calls, and the dice.
 */

import { motion } from 'motion/react';
import * as React from 'react';
import { DENOMS, RackChip } from './table/Chip';
import { Button, Segmented, cn, money } from './ui/primitives';
import { chipDrop, uiClick } from '@/lib/audio';
import { atRisk } from '@/lib/engine/table';
import { useGame, type NumberMode } from '@/lib/store/useGame';
import type { SeatId } from '@/lib/engine/types';

const SEAT_ACCENT: Record<SeatId, string> = {
  A: 'var(--color-seat-a)',
  B: 'var(--color-seat-b)',
};

/* ------------------------------------------------------------------ *
 * Seats
 * ------------------------------------------------------------------ */

export function SeatBar() {
  const table = useGame((s) => s.table);
  const setActiveSeat = useGame((s) => s.setActiveSeat);
  const addChips = useGame((s) => s.addChips);

  const ids: SeatId[] = table.solo ? ['A'] : ['A', 'B'];

  return (
    <div className={cn('grid gap-3', table.solo ? 'grid-cols-1' : 'grid-cols-2')}>
      {ids.map((id) => {
        const seat = table.seats[id];
        const active = table.activeSeat === id;
        const shooting = table.shooter === id;
        const risk = atRisk(table, id);
        const net = seat.bankroll + risk - seat.buyIn;

        return (
          <button
            key={id}
            type="button"
            onClick={() => {
              setActiveSeat(id);
              uiClick();
            }}
            aria-pressed={active}
            className={cn(
              'panel relative flex items-center gap-3 px-3 py-2 text-left transition-all',
              active ? 'ring-2' : 'opacity-70 hover:opacity-100',
            )}
            style={active ? ({ '--tw-ring-color': SEAT_ACCENT[id] } as React.CSSProperties) : undefined}
          >
            <span
              className="h-9 w-1.5 shrink-0 rounded-full"
              style={{ background: SEAT_ACCENT[id] }}
              aria-hidden
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate text-xs font-semibold text-pit-100">{seat.name}</span>
                {shooting ? (
                  <span className="shrink-0 rounded-sm bg-brass-500/20 px-1 py-px text-[9px] font-bold tracking-widest text-brass-300">
                    SHOOTER
                  </span>
                ) : null}
              </span>
              <span className="tabular block text-lg font-bold leading-tight text-pit-100">
                {money(seat.bankroll)}
              </span>
              <span className="tabular block text-[10px] text-pit-400">
                {money(risk)} at risk ·{' '}
                <span className={net > 0 ? 'text-win' : net < 0 ? 'text-lose' : ''}>
                  {money(net, { sign: true })}
                </span>
              </span>
            </span>
            {seat.bankroll < 5 ? (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  addChips(id, table.rules.rebuyAmount);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.stopPropagation();
                    addChips(id, table.rules.rebuyAmount);
                  }
                }}
                className="shrink-0 rounded bg-brass-500 px-2 py-1 text-[10px] font-bold text-pit-950 hover:bg-brass-400"
              >
                BUY IN
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Chip rack
 * ------------------------------------------------------------------ */

export function ChipRack() {
  const chip = useGame((s) => s.chip);
  const setChip = useGame((s) => s.setChip);
  const bankroll = useGame((s) => s.table.seats[s.table.activeSeat].bankroll);

  return (
    <div className="rail flex items-center gap-1.5 rounded-xl px-2.5 py-2">
      {DENOMS.map((d) => {
        const affordable = bankroll >= d.value;
        const selected = chip === d.value;
        return (
          <motion.button
            key={d.value}
            type="button"
            whileTap={{ scale: 0.92 }}
            animate={{ y: selected ? -8 : 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 28 }}
            onClick={() => {
              setChip(d.value);
              chipDrop();
            }}
            disabled={!affordable}
            aria-pressed={selected}
            aria-label={`${money(d.value)} chip`}
            title={`${money(d.value)} chip`}
            className={cn(
              'relative rounded-full transition-opacity',
              !affordable && 'cursor-not-allowed opacity-25',
              selected && 'drop-shadow-[0_0_10px_rgba(240,180,41,0.55)]',
            )}
          >
            <RackChip denom={d} size={46} />
          </motion.button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Dealer calls
 * ------------------------------------------------------------------ */

const BOX_NUMBERS = [4, 5, 6, 8, 9, 10];

export function ActionBar({ onOpenHop }: { onOpenHop: () => void }) {
  const table = useGame((s) => s.table);
  const numberMode = useGame((s) => s.numberMode);
  const setNumberMode = useGame((s) => s.setNumberMode);
  const maxOdds = useGame((s) => s.maxOdds);
  const press = useGame((s) => s.press);
  const powerPress = useGame((s) => s.powerPress);
  const betGroup = useGame((s) => s.betGroup);
  const allWorking = useGame((s) => s.allWorking);
  const clearAll = useGame((s) => s.clearAll);
  const repeat = useGame((s) => s.repeatLastAction);
  const rolling = useGame((s) => s.rolling);
  const lastRoll = useGame((s) => s.lastRoll);
  const chip = useGame((s) => s.chip);

  const mine = table.bets.filter((b) => b.seat === table.activeSeat);
  const hasNumbers = mine.some((b) => b.kind === 'PLACE' || b.kind === 'BUY' || b.kind === 'HARDWAY');
  const hasOdds = mine.some(
    (b) => b.number !== undefined && ['PASS', 'DONT_PASS', 'COME', 'DONT_COME'].includes(b.kind),
  );

  // Pressing is a call about the number that just hit, so the buttons name it
  // and stay dark until there is actually something there to press.
  const hit = lastRoll && BOX_NUMBERS.includes(lastRoll.total) ? lastRoll.total : null;
  const pressable =
    hit !== null &&
    mine.some((b) => b.number === hit && (b.kind === 'PLACE' || b.kind === 'BUY'));
  const pressHint =
    hit === null
      ? 'Press works on the number that just hit'
      : pressable
        ? `Press your ${hit}`
        : `Nothing on the ${hit} to press`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1.5">
        <span className="stat-label">Numbers</span>
        <Segmented<NumberMode>
          value={numberMode}
          onChange={(v) => {
            setNumberMode(v);
            uiClick();
          }}
          options={[
            { value: 'PLACE', label: 'Place', title: 'Place the number at house odds' },
            { value: 'BUY', label: 'Buy', title: 'True odds, five percent commission' },
            { value: 'LAY', label: 'Lay', title: 'Bet the number does not come before a seven' },
          ]}
        />
      </div>

      <span className="h-6 w-px bg-white/10" aria-hidden />

      {/* The grouped place calls, taken at whichever chip is armed. */}
      <Button
        size="sm"
        onClick={() => betGroup('INSIDE')}
        disabled={rolling}
        title={`Place the 5, 6, 8 and 9 at ${money(chip)} each`}
      >
        Inside
      </Button>
      <Button
        size="sm"
        onClick={() => betGroup('OUTSIDE')}
        disabled={rolling}
        title={`Place the 4, 5, 9 and 10 at ${money(chip)} each`}
      >
        Outside
      </Button>
      <Button
        size="sm"
        onClick={() => betGroup('ACROSS')}
        disabled={rolling}
        title={`Place all six box numbers at ${money(chip)} each`}
      >
        Across
      </Button>

      <span className="h-6 w-px bg-white/10" aria-hidden />

      <Button size="sm" onClick={maxOdds} disabled={rolling || !hasOdds} title="Take or lay the full odds behind every line bet">
        Max Odds
      </Button>
      <Button size="sm" onClick={() => press(1)} disabled={rolling || !pressable} title={pressHint}>
        {pressable ? `Press ${hit}` : 'Press'}
      </Button>
      <Button size="sm" onClick={powerPress} disabled={rolling || !pressable} title={pressable ? `Double your ${hit}` : pressHint}>
        {pressable ? `Power ${hit}` : 'Power Press'}
      </Button>
      <Button size="sm" onClick={repeat} disabled={rolling} title="Put back whatever came down last roll">
        Same Action
      </Button>

      <span className="h-6 w-px bg-white/10" aria-hidden />

      <Button size="sm" onClick={() => allWorking(true)} disabled={rolling || !hasNumbers}>
        All ON
      </Button>
      <Button size="sm" onClick={() => allWorking(false)} disabled={rolling || !hasNumbers}>
        All OFF
      </Button>
      <Button size="sm" onClick={onOpenHop} disabled={rolling} title="Hop and horn high bets">
        Hop / Horn…
      </Button>
      <Button size="sm" variant="danger" onClick={clearAll} disabled={rolling || mine.length === 0}>
        Take Down
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The dice
 * ------------------------------------------------------------------ */

export function RollButton() {
  const throwDice = useGame((s) => s.throwDice);
  const rolling = useGame((s) => s.rolling);
  const fastRoll = useGame((s) => s.fastRoll);
  const toggleFastRoll = useGame((s) => s.toggleFastRoll);
  const table = useGame((s) => s.table);
  const shooter = table.seats[table.shooter];

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => toggleFastRoll()}
        aria-pressed={fastRoll}
        title="Skip the dice animation for rapid strategy testing"
        className={cn(
          'flex h-11 w-11 shrink-0 items-center justify-center rounded-md border text-[10px] font-bold leading-tight transition-colors',
          fastRoll
            ? 'border-brass-500/60 bg-brass-500/20 text-brass-300'
            : 'border-white/10 bg-pit-800 text-pit-400 hover:text-pit-100',
        )}
      >
        FAST
      </button>
      <Button
        variant="primary"
        size="lg"
        onClick={throwDice}
        disabled={rolling}
        className="min-w-44 text-base font-bold tracking-widest uppercase"
      >
        {rolling ? 'Dice are out' : `Roll · ${shooter.name}`}
      </Button>
    </div>
  );
}
