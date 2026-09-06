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
  const countSystem = useGame((s) => s.prefs.countSystem);
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
            /*
              The threshold this verdict uses — insurance at +3 — is published
              in Hi-Lo true counts, so the number shown beside it has to be the
              Hi-Lo equivalent rather than whatever the selected system's own
              count happens to be. A Knock-Out player was being shown a running
              count of -20 on an untouched shoe under a verdict computed from
              the same figure.
            */
            <span className={cn('font-mono', insuranceIsGood(count.hiLo) ? 'text-win' : 'text-lose')}>
              {countSystem === 'HI_LO' ? 'true' : 'Hi-Lo equiv.'} {count.hiLo >= 0 ? '+' : ''}
              {count.hiLo.toFixed(1)} —{' '}
              {insuranceIsGood(count.hiLo) ? 'take it' : 'a 7.4% bad bet at this count'}
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
                  {/*
                    Even money is a 3:2 offer and nothing else — at 6:5 or 1:1
                    there is no insurance stake that guarantees one unit, so
                    the engine refuses it. This condition used to read "not
                    1:1", which put a live button on the shipped Single Deck
                    preset that answered with a refusal toast, on a felt whose
                    README promises every button knows why it is unavailable.
                  */}
                  {natural && rules.blackjackPays === '3:2' ? (
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

  /*
   * Which visible buttons are refused, and why. Split and surrender are not
   * rendered at all when they are dead, so they are not listed either — a
   * reason for a button that is not on screen is noise.
   */
  const refusals = React.useMemo(
    () =>
      ACTION_ORDER.filter(
        (a) => !legal[a].allowed && legal[a].reason && a !== 'SPLIT' && a !== 'SURRENDER',
      ).map((a) => ({ action: a, reason: legal[a].reason! })),
    [legal],
  );
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
              aria-describedby={!state.allowed && state.reason ? `why-${action}` : undefined}
              onClick={() => act(action)}
              className={cn('min-w-[5.5rem]', recommended && 'ring-2 ring-brass-300 ring-offset-2 ring-offset-pit-950')}
            >
              {ACTION_LABEL[action]}
              <kbd className="ml-1 rounded bg-black/25 px-1 text-[9px] opacity-60">{ACTION_KEY[action]}</kbd>
            </Button>
          );
        })}
      </div>

      {/*
        The reasons, in the open.

        They used to live only in `title=` on a button carrying
        `disabled:pointer-events-none`, which is a tooltip that can never fire:
        no hover, no tab stop, nothing for a screen reader to reach. So the
        README's "each button knows why it is unavailable and says so rather
        than sitting there dead" was true of the data and false of the felt.
        Printing them is duller than a tooltip and it is the only version that
        reaches a keyboard, a phone and a screen reader alike. The printed text
        is doing all of the work: a `disabled` button is not focusable, so the
        `aria-describedby` on it is unreachable in practice and stays only for
        the case where a reader walks the tree rather than the tab order. The
        `title` stays for the hover.

        Rendered whenever there is a refusal to show — including while the
        driver is busy, which is when the buttons are dead but the rules
        behind them have not changed. Hiding it there left the buttons'
        `aria-describedby` pointing at nothing.
      */}
      {refusals.length > 0 ? (
        <p className="max-w-xl text-center text-[10px] leading-tight text-pit-500">
          {refusals.map(({ action, reason }) => (
            <span key={action} id={`why-${action}`} className="mr-2 inline-block">
              <span className="text-pit-400">{ACTION_LABEL[action]}:</span> {reason}
            </span>
          ))}
        </p>
      ) : null}

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
/**
 * Should the game's own keyboard handler leave this keystroke alone?
 *
 * Two separate reasons, and a round of judging for each.
 *
 * A form field always wins: typing a seat name should not deal a round.
 *
 * Enter and Space are harder, because they are both the game's shortcuts and
 * the two keys every button on the page is activated with. Round six found
 * the handler swallowing them from every focused control — focus "Paytables",
 * press Enter, and a round was dealt instead of the dialog opening — so a
 * guard was added for any focused button. Round seven found what that guard
 * cost: a *mouse* click leaves focus on the button it clicked, so after
 * clicking Hit the Hit button held focus and Space re-hit the hand instead of
 * standing it, which is the shortcut the README leads with.
 *
 * `:focus-visible` is the distinction the platform already draws, and it is
 * exactly the one wanted here: it matches a control the browser is showing a
 * focus ring on — one reached by keyboard — and not one that merely holds
 * focus because it was clicked. So a keyboard user's Enter reaches their
 * button, and a mouse user's Space still stands the hand.
 *
 * Exported, and taking an element rather than reading the DOM, because the
 * whole of this decision is worth a test and the suite runs in node.
 */
export function ignoresGameKey(key: string, target: Element | null): boolean {
  if (!target) return false;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return true;
  if (key !== ' ' && key !== 'enter') return false;

  const control = target.closest?.('button, a, [role="switch"], [tabindex]');
  if (!control) return false;
  try {
    // Focused by keyboard, so the browser is drawing a ring on it and the
    // player is aiming at it. Focused by a click, so they are not.
    return control.matches(':focus-visible');
  } catch {
    // No `:focus-visible` support. Yielding is the safer half: a swallowed
    // shortcut is an annoyance, an uncontrollable header is a wall.
    return true;
  }
}

export function useKeyboard(): void {
  const act = useGame((s) => s.act);
  const deal = useGame((s) => s.deal);
  const decline = useGame((s) => s.declineInsurance);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (ignoresGameKey(key, e.target as Element | null)) return;

      const { table, dialog } = useGame.getState();
      /*
       * A dialog owns the keyboard while it is open. Without this, Space
       * dealt a round and H/S/D/P/R played the hand behind an open Setup,
       * Chart, Paytables or Help — the player reading the strategy chart to
       * decide what to do would double down by pressing D on it.
       */
      if (dialog) return;

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
