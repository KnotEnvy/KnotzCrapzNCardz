'use client';

/**
 * The controls.
 *
 * Two bars that swap with the phase, because the table only ever asks one kind
 * of question at a time: how much, and then play or fold. Everything else — the
 * dealer's hand, the showdown — is something the player watches, and the bar
 * says so rather than offering buttons that do nothing.
 *
 * Every decision button reads its legality from the engine, including the
 * reason it is unavailable, and prints that reason rather than hiding it in a
 * tooltip: a `title` on a disabled button reaches no keyboard, no phone and no
 * screen reader, which the blackjack table spent five rounds of review finding.
 */

import * as React from 'react';
import { Button, Meter } from '@/components/ui/primitives';
import { Chip, DENOMINATIONS } from '@/components/table/Chip';
import { fmt, fmtSigned } from '@/lib/engine/money';
import { DEFAULT_BANKROLL, legalDecisions, seatOf } from '@/lib/engine/table';
import type { Decision } from '@/lib/engine/types';
import { useAdvice, useGame, type DialogId } from '@/lib/store/useGame';

export function Controls() {
  const phase = useGame((s) => s.table.phase);
  const dealing = useGame((s) => s.dealing);

  return (
    <div className="control-bar flex min-h-[92px] w-full items-center justify-center px-3 py-2">
      {phase === 'BETTING' ? <BettingBar /> : null}
      {phase === 'DECIDING' && !dealing ? <DecisionBar /> : null}
      {phase === 'SHOWDOWN' || phase === 'SETTLE' || (phase === 'DECIDING' && dealing) ? <WaitingBar /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Betting
 * ------------------------------------------------------------------ */

/** What a rebuy buys: the same stake every seat starts a session with. */
const REBUY = DEFAULT_BANKROLL;

function BettingBar() {
  const table = useGame((s) => s.table);
  const chip = useGame((s) => s.prefs.chip);
  const setChip = useGame((s) => s.setChip);
  const clearBet = useGame((s) => s.clearBet);
  const rebet = useGame((s) => s.rebet);
  const rebuy = useGame((s) => s.rebuy);
  const deal = useGame((s) => s.deal);
  const lastBets = useGame((s) => s.lastBets);

  const seats = table.seats.filter((s) => s.occupied);
  const total = seats.reduce((n, s) => n + s.bets.ante + s.bets.pairPlus + s.bets.sixCard, 0);
  const reserve = seats.reduce((n, s) => n + s.bets.ante, 0);
  const canDeal = seats.some((s) => s.bets.ante > 0 || s.bets.pairPlus > 0);
  const bankroll = seats.reduce((n, s) => n + s.bankroll, 0);

  /*
   * A seat that cannot make the table minimum on any spot is out of the game.
   * A rebuy puts it back in without wiping every seat's statistics, which is
   * what "New session" would do.
   */
  const broke = seats.filter((s) => s.bankroll < table.rules.minBet);

  return (
    <div className="flex w-full max-w-4xl flex-col items-center gap-1.5">
      <div className="flex w-full flex-wrap items-center justify-center gap-x-4 gap-y-2">
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

      <p className="text-center text-[10px] text-pit-500">
        {total === 0
          ? 'Click the Ante to play a hand, Pair Plus to bet on your cards alone, or both. The 6 Card Bonus rides on an Ante.'
          : reserve > 0
            ? `${fmt(reserve)} more stays in the bankroll for the Play bet, which has to match the Ante.`
            : 'Pair Plus alone: no decision to make, paid on your three cards.'}
      </p>

      {broke.length > 0 ? (
        <div className="flex w-full flex-wrap items-center justify-center gap-2">
          {broke.map((seat) => (
            <Button key={seat.id} variant="danger" size="sm" onClick={() => rebuy(seat.id, REBUY)}>
              {broke.length > 1 ? `${seat.name}: ` : ''}Rebuy {fmt(REBUY)}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Play or fold
 * ------------------------------------------------------------------ */

const DECISION_LABEL: Record<Decision, string> = { PLAY: 'Play', FOLD: 'Fold' };
const DECISION_KEY: Record<Decision, string> = { PLAY: 'P', FOLD: 'F' };

function DecisionBar() {
  const table = useGame((s) => s.table);
  const decide = useGame((s) => s.decide);
  const hints = useGame((s) => s.prefs.hints);
  const busy = useGame((s) => s.busy);
  const playForMe = useGame((s) => s.playForMe);
  const advice = useAdvice();
  const legal = React.useMemo(() => legalDecisions(table), [table]);

  if (!table.focus) return null;
  const seat = seatOf(table, table.focus);
  const refusals = (['PLAY', 'FOLD'] as const).filter((d) => !legal[d].allowed && legal[d].reason);
  const seated = table.seats.filter((s) => s.occupied).length;

  return (
    <div className="flex w-full max-w-4xl flex-col items-center gap-1.5">
      <div className="flex flex-wrap items-baseline justify-center gap-x-3 text-[11px]">
        {seated > 1 ? (
          <span className="tracking-[0.16em] text-brass-300 uppercase" style={{ fontFamily: 'var(--font-display)' }}>
            {seat.name}
          </span>
        ) : null}
        {advice ? <span className="font-mono text-pit-100">{advice.handName}</span> : null}
        <span className="text-pit-500">
          Ante {fmt(seat.wagers.ante)}
          {seat.wagers.pairPlus ? ` · Pair Plus ${fmt(seat.wagers.pairPlus)}` : ''}
          {seat.wagers.sixCard ? ` · 6 Card ${fmt(seat.wagers.sixCard)}` : ''}
        </span>
      </div>

      {/*
        The hint is the exact answer, not the chart's: what each choice is
        worth, in money, against the 18,424 hands the dealer could be holding.
      */}
      {hints && advice ? (
        <div className="flex max-w-3xl flex-wrap items-baseline justify-center gap-x-2 rounded-2xl border border-white/10 bg-black/40 px-3 py-1 text-center text-[11px]">
          <span className="tracking-[0.16em] text-brass-300 uppercase" style={{ fontFamily: 'var(--font-display)' }}>
            {DECISION_LABEL[advice.decision]}
          </span>
          <span className="text-pit-400">{advice.why}</span>
          <span className="font-mono whitespace-nowrap text-pit-300">
            play {fmtSigned(Math.round(advice.ev.PLAY))} · fold {fmtSigned(Math.round(advice.ev.FOLD))}
          </span>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-center gap-2">
        {(['PLAY', 'FOLD'] as const).map((d) => (
          <Button
            key={d}
            size="lg"
            variant={d === 'PLAY' ? 'primary' : 'secondary'}
            disabled={!legal[d].allowed || busy}
            aria-describedby={!legal[d].allowed && legal[d].reason ? `why-${d}` : undefined}
            onClick={() => decide(d)}
            className={
              hints && advice?.decision === d ? 'min-w-[6.5rem] ring-2 ring-brass-300 ring-offset-2 ring-offset-pit-950' : 'min-w-[6.5rem]'
            }
          >
            {DECISION_LABEL[d]}
            {d === 'PLAY' ? <span className="font-mono text-[11px] opacity-70">{fmt(seat.wagers.ante)}</span> : null}
            <kbd className="ml-1 rounded bg-black/25 px-1 text-[9px] opacity-60">{DECISION_KEY[d]}</kbd>
          </Button>
        ))}
        <Button variant="ghost" size="sm" onClick={playForMe} disabled={busy}>
          Play this hand for me
        </Button>
      </div>

      {refusals.length > 0 ? (
        <p className="max-w-xl text-center text-[10px] leading-tight text-pit-500">
          {refusals.map((d) => (
            <span key={d} id={`why-${d}`} className="mr-2 inline-block">
              <span className="text-pit-400">{DECISION_LABEL[d]}:</span> {legal[d].reason}
            </span>
          ))}
        </p>
      ) : (
        <p className="text-[10px] text-pit-500">
          Playing puts {fmt(seat.wagers.ante)} on Play. Folding gives up the Ante
          {seat.wagers.pairPlus ? ' and the Pair Plus' : ''}
          {seat.wagers.sixCard ? '; the 6 Card Bonus stays in action' : ''}.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Waiting
 * ------------------------------------------------------------------ */

function WaitingBar() {
  const table = useGame((s) => s.table);
  const dealing = useGame((s) => s.dealing);
  const label = dealing
    ? 'The machine deals'
    : table.phase === 'SHOWDOWN'
      ? 'The dealer turns their hand'
      : table.settled
        ? 'Paying the table'
        : 'Turning the hands over';

  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-2">
      <span className="text-[11px] tracking-[0.28em] text-pit-400 uppercase" style={{ fontFamily: 'var(--font-display)' }}>
        {label}
      </span>
      <Meter value={table.settled ? 1 : dealing ? 0.25 : 0.6} className="max-w-[12rem]" label="Round progress" />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Keyboard
 * ------------------------------------------------------------------ */

/**
 * Should the game's own keyboard handler leave this keystroke alone?
 *
 * Copied from the blackjack table with its reasoning, which took two rounds
 * of review from opposite sides to get right. A form field always wins. Enter
 * and Space are both the game's shortcuts and the two keys every button is
 * activated with, so they are yielded to a button the *keyboard* is on — which
 * `:focus-visible` distinguishes from a button that merely holds focus because
 * it was clicked.
 *
 * Exported, and taking an element rather than reading the DOM, because the
 * decision is worth a test and the suite runs in node.
 */
export function ignoresGameKey(key: string, target: Element | null): boolean {
  if (!target) return false;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return true;
  if (key !== ' ' && key !== 'enter') return false;

  const control = target.closest?.('button, a, [role="switch"], [role="radio"], [tabindex]');
  if (!control) return false;
  try {
    return control.matches(':focus-visible');
  } catch {
    // No `:focus-visible` support. Yielding is the safer half.
    return true;
  }
}

/**
 * The whole game from the keyboard.
 *
 * Space deals. P plays and F folds — and, deliberately, nothing plays or folds
 * by default. At the blackjack table Space stands, which is the safe answer on
 * most hands; here neither answer is safe on most hands, and a key that makes
 * the decision for a player who pressed it out of habit would be a key that
 * costs money.
 */
export function useKeyboard(): void {
  const deal = useGame((s) => s.deal);
  const decide = useGame((s) => s.decide);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (ignoresGameKey(key, e.target as Element | null)) return;

      const { table, dialog, openDialog } = useGame.getState();

      /*
       * The dialogs have keys of their own, handled above the dialog guard so
       * one can be swapped for another without closing the first. The same
       * letters the blackjack table uses where the meaning carries over: `C`
       * for the strategy card, `B` for the bets and what they pay.
       */
      const dialogKey: Record<string, DialogId> = { '?': 'help', ',': 'setup', c: 'strategy', b: 'paytables' };
      const wanted = dialogKey[e.key] ?? dialogKey[key];
      if (wanted) {
        e.preventDefault();
        openDialog(wanted === dialog ? null : wanted);
        return;
      }

      // A dialog owns the keyboard while it is open.
      if (dialog) return;

      if (table.phase === 'BETTING' && (key === ' ' || key === 'enter')) {
        e.preventDefault();
        deal();
        return;
      }
      if (table.phase === 'DECIDING') {
        if (key === 'p') {
          e.preventDefault();
          decide('PLAY');
        } else if (key === 'f') {
          e.preventDefault();
          decide('FOLD');
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deal, decide]);
}
