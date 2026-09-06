'use client';

/**
 * The controls.
 *
 * Three bars that swap with the phase, because a blackjack table only ever
 * asks you one kind of question at a time: how much, insurance or not, and
 * what to do with this hand. Showing all three at once would be a control
 * panel; showing one is a table.
 *
 * Every action button reads its own legality from the engine, including the
 * reason it is unavailable, so a greyed control can say "this table does not
 * allow doubling after a split" rather than sitting there dead.
 */

import * as React from 'react';
import { Button, cn, Meter } from '@/components/ui/primitives';
import { Chip, DENOMINATIONS } from '@/components/table/Chip';
import { fmt } from '@/lib/engine/money';
import { maxInsurance } from '@/lib/engine/rules';
import { legalActions, seatOf } from '@/lib/engine/table';
import { handValue } from '@/lib/engine/hand';
import { insuranceIsGood } from '@/lib/strategy/counting';
import type { Action } from '@/lib/engine/types';
import { useAdvice, useCount, useGame } from '@/lib/store/useGame';

export function Controls() {
  const table = useGame((s) => s.table);
  const phase = table.phase;

  return (
    <div className="control-bar flex min-h-[92px] w-full items-center justify-center px-3 py-2">
      {phase === 'BETTING' ? <BettingBar /> : null}
      {phase === 'INSURANCE' ? <InsuranceBar /> : null}
      {phase === 'PLAYER' ? <ActionBar /> : null}
      {(phase === 'DEALING' || phase === 'DEALER' || phase === 'SETTLE') ? <WaitingBar /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Betting
 * ------------------------------------------------------------------ */

function BettingBar() {
  const table = useGame((s) => s.table);
  const chip = useGame((s) => s.prefs.chip);
  const setChip = useGame((s) => s.setChip);
  const clearBet = useGame((s) => s.clearBet);
  const rebet = useGame((s) => s.rebet);
  const deal = useGame((s) => s.deal);
  const lastBets = useGame((s) => s.lastBets);

  const total = table.seats.reduce(
    (n, s) => n + s.pendingBet + s.pendingSideBets.reduce((m, sb) => m + sb.amount, 0),
    0,
  );
  const canDeal = table.seats.some((s) => s.occupied && s.pendingBet > 0);
  const bankroll = table.seats.filter((s) => s.occupied).reduce((n, s) => n + s.bankroll, 0);

  return (
    <div className="flex w-full max-w-4xl flex-wrap items-center justify-center gap-x-4 gap-y-2">
      <div className="flex items-center gap-1.5" role="group" aria-label="Chip rack">
        {DENOMINATIONS.map((d) => (
          <Chip
            key={d.cents}
            denom={d}
            size={38}
            selected={chip === d.cents}
            disabled={d.cents > bankroll}
            onClick={() => setChip(d.cents)}
          />
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => clearBet()} disabled={total === 0}>
          Clear
        </Button>
        <Button variant="secondary" size="sm" onClick={rebet} disabled={lastBets.size === 0}>
          Same bet
        </Button>
        <Button variant="primary" size="lg" onClick={deal} disabled={!canDeal} className="min-w-[7rem]">
          Deal
          {total > 0 ? <span className="ml-1.5 font-mono text-[11px] opacity-70">{fmt(total)}</span> : null}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Insurance
 * ------------------------------------------------------------------ */

/**
 * The offers.
 *
 * Insurance is a bad bet — 7.4% against you at a neutral shoe — and the panel
 * says so rather than presenting it neutrally. With the counting trainer on it
 * says something better: what the true count is, and therefore whether this is
 * the one time in a shoe when taking it is correct.
 */
function InsuranceBar() {
  const table = useGame((s) => s.table);
  const takeInsurance = useGame((s) => s.takeInsurance);
  const takeEvenMoney = useGame((s) => s.takeEvenMoney);
  const decline = useGame((s) => s.declineInsurance);
  const counting = useGame((s) => s.prefs.counting);
  const count = useCount();
  const rules = table.rules;

  const seats = table.seats.filter((s) => s.hands.length > 0);
  const anyOpen = seats.some((s) => s.insurance === 0);
  const earlyOnly = !rules.insurance || table.dealer.cards[0]?.rank !== 14;

  return (
    <div className="flex w-full max-w-4xl flex-col items-center gap-2">
      <div className="flex items-center gap-2 text-[11px] tracking-wide">
        <span className="text-brass-300 uppercase" style={{ fontFamily: 'var(--font-display)' }}>
          {earlyOnly ? 'Early surrender offered' : 'Insurance?'}
        </span>
        {!earlyOnly ? (
          counting ? (
            <span className={cn('font-mono', insuranceIsGood(count.true) ? 'text-win' : 'text-lose')}>
              true {count.true >= 0 ? '+' : ''}
              {count.true.toFixed(1)} —{' '}
              {insuranceIsGood(count.true) ? 'take it' : 'a 7.4% bad bet at this count'}
            </span>
          ) : (
            <span className="text-pit-400">It loses 7.4% of what you put up. Almost always decline.</span>
          )
        ) : (
          <span className="text-pit-400">Fold now, before the dealer looks at the hole card.</span>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        {!earlyOnly
          ? seats.map((seat) => {
              const cap = maxInsurance(seat.hands[0].bet);
              const natural = seat.hands[0].cards.length === 2 && handValue(seat.hands[0].cards).total === 21;
              if (seat.insurance > 0) {
                return (
                  <span key={seat.id} className="rounded border border-white/10 px-2 py-1 text-[11px] text-pit-400">
                    {seat.name}: {seat.tookEvenMoney ? 'even money' : fmt(seat.insurance)}
                  </span>
                );
              }
              return (
                <React.Fragment key={seat.id}>
                  {natural && rules.blackjackPays !== '1:1' ? (
                    <Button size="sm" variant="secondary" onClick={() => takeEvenMoney(seat.id)}>
                      {seats.length > 1 ? `${seat.name}: ` : ''}Even money
                    </Button>
                  ) : null}
                  <Button size="sm" variant="secondary" onClick={() => takeInsurance(seat.id, cap)}>
                    {seats.length > 1 ? `${seat.name}: ` : ''}Insure {fmt(cap)}
                  </Button>
                </React.Fragment>
              );
            })
          : null}

        <SurrenderIfOffered />

        <Button variant="primary" size="md" onClick={decline}>
          {anyOpen && !earlyOnly ? 'No insurance' : 'Continue'}
        </Button>
      </div>
    </div>
  );
}

function SurrenderIfOffered() {
  const table = useGame((s) => s.table);
  const act = useGame((s) => s.act);
  const legal = React.useMemo(() => legalActions(table), [table]);
  if (!legal.SURRENDER.allowed) return null;
  return (
    <Button size="sm" variant="secondary" onClick={() => act('SURRENDER')}>
      Surrender
    </Button>
  );
}

/* ------------------------------------------------------------------ *
 * Playing
 * ------------------------------------------------------------------ */

const ACTION_LABEL: Record<Action, string> = {
  HIT: 'Hit',
  STAND: 'Stand',
  DOUBLE: 'Double',
  SPLIT: 'Split',
  SURRENDER: 'Surrender',
};

/** The keyboard, which is how anybody plays more than fifty hands. */
const ACTION_KEY: Record<Action, string> = {
  HIT: 'H',
  STAND: 'S',
  DOUBLE: 'D',
  SPLIT: 'P',
  SURRENDER: 'R',
};

const ACTION_ORDER: readonly Action[] = ['HIT', 'STAND', 'DOUBLE', 'SPLIT', 'SURRENDER'];

function ActionBar() {
  const table = useGame((s) => s.table);
  const act = useGame((s) => s.act);
  const hints = useGame((s) => s.prefs.hints);
  const advice = useAdvice();
  const busy = useGame((s) => s.busy);

  const legal = React.useMemo(() => legalActions(table), [table]);
  const seat = table.focus ? seatOf(table, table.focus.seat) : null;
  const hand = seat && table.focus ? seat.hands[table.focus.hand] : null;

  return (
    <div className="flex w-full max-w-4xl flex-col items-center gap-2">
      {hints && advice ? (
        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-3 py-1 text-[11px]">
          <span className="tracking-[0.16em] text-brass-300 uppercase" style={{ fontFamily: 'var(--font-display)' }}>
            {ACTION_LABEL[advice.action]}
          </span>
          <span className="max-w-md truncate text-pit-400" title={advice.why}>
            {advice.why}
          </span>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-center gap-2">
        {ACTION_ORDER.map((action) => {
          const state = legal[action];
          // Surrender and split only appear when they are live: a permanently
          // dead button on every hand is noise, whereas a double that is
          // sometimes refused is information and stays visible with its reason.
          if (!state.allowed && (action === 'SPLIT' || action === 'SURRENDER')) return null;
          const recommended = hints && advice?.action === action;
          return (
            <Button
              key={action}
              size="lg"
              variant={action === 'HIT' || action === 'STAND' ? 'primary' : 'secondary'}
              disabled={!state.allowed || busy}
              title={state.reason}
              onClick={() => act(action)}
              className={cn('min-w-[5.5rem]', recommended && 'ring-2 ring-brass-300 ring-offset-2 ring-offset-pit-950')}
            >
              {ACTION_LABEL[action]}
              <kbd className="ml-1 rounded bg-black/25 px-1 text-[9px] opacity-60">{ACTION_KEY[action]}</kbd>
            </Button>
          );
        })}
      </div>

      {hand ? (
        <p className="text-[10px] text-pit-500">
          {seat!.name} · hand {(table.focus?.hand ?? 0) + 1} of {seat!.hands.length} · {fmt(hand.bet)}
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Waiting
 * ------------------------------------------------------------------ */

function WaitingBar() {
  const table = useGame((s) => s.table);
  const label =
    table.phase === 'DEALING'
      ? 'Dealing'
      : table.phase === 'DEALER'
        ? 'Dealer plays'
        : 'Settling';

  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-2">
      <span
        className="text-[11px] tracking-[0.28em] text-pit-400 uppercase"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {label}
      </span>
      <Meter value={table.phase === 'SETTLE' ? 1 : 0.5} className="max-w-[12rem]" />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Keyboard
 * ------------------------------------------------------------------ */

/**
 * The whole game from the keyboard.
 *
 * Blackjack is played fast — a live table deals sixty to eighty hands an hour
 * and this one goes faster — and reaching for a mouse between every decision
 * is the thing that makes a hundred hands feel like work. Space deals and
 * stands, which covers most of a session on its own.
 */
export function useKeyboard(): void {
  const act = useGame((s) => s.act);
  const deal = useGame((s) => s.deal);
  const decline = useGame((s) => s.declineInsurance);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

      const { table } = useGame.getState();
      const key = e.key.toLowerCase();

      if (table.phase === 'BETTING') {
        if (key === ' ' || key === 'enter') {
          e.preventDefault();
          deal();
        }
        return;
      }
      if (table.phase === 'INSURANCE') {
        // Space declines, because declining is right on almost every hand —
        // but taking the offer needs a key of its own, or the only way to
        // insure a hand is with a mouse.
        if (key === 'n' || key === ' ' || key === 'enter') {
          e.preventDefault();
          decline();
        }
        if (key === 'i') {
          e.preventDefault();
          const { takeInsurance } = useGame.getState();
          for (const seat of table.seats) {
            if (seat.hands.length > 0 && seat.insurance === 0) {
              takeInsurance(seat.id, maxInsurance(seat.hands[0].bet));
            }
          }
        }
        if (key === 'e') {
          e.preventDefault();
          const { takeEvenMoney } = useGame.getState();
          const seat = table.seats.find((x) => x.hands.length > 0 && x.insurance === 0);
          if (seat) takeEvenMoney(seat.id);
        }
        if (key === 'r') act('SURRENDER');
        return;
      }
      if (table.phase !== 'PLAYER') return;

      const map: Record<string, Action> = {
        h: 'HIT',
        s: 'STAND',
        d: 'DOUBLE',
        p: 'SPLIT',
        r: 'SURRENDER',
        ' ': 'STAND',
      };
      const action = map[key];
      if (action) {
        e.preventDefault();
        act(action);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [act, deal, decline]);
}
