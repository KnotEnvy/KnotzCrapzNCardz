'use client';

/**
 * The wallet, on the glass.
 *
 * This is the one element that is on every screen of the casino, and it answers
 * one question the player asks constantly: what am I worth. Which is why it
 * leads with the *total* — wallet plus every chip on every table — and puts the
 * split underneath in smaller type.
 *
 * That ordering is the whole point of the component. The naive HUD shows the
 * spendable balance, which drops by a thousand dollars the moment a player sits
 * down at a table and reads, to anybody not thinking about it, as having lost a
 * thousand dollars. The total does not move when you buy in, because buying in
 * does not make you poorer. It moves when you win and when you lose, which is
 * the only time it should.
 */

import * as React from 'react';
import { Counter, Tag } from '@/components/ui/primitives';
import { money, moneyShort } from '@/lib/money';
import { useFloor } from '@/lib/floor';

export function WalletHud({ compact }: { compact?: boolean }): React.JSX.Element {
  const wallet = useFloor((s) => s.wallet);
  const total = useFloor((s) => s.total);
  const live = useFloor((s) => s.live);

  const balance = wallet?.balance ?? 0;
  const chips = wallet?.chips ?? 0;

  return (
    <div className="flex items-center gap-3">
      <div className="text-right">
        <Counter
          value={total}
          format={compact ? moneyShort : money}
          className={
            compact
              ? 'block text-lg font-bold text-neon-gold'
              : 'block text-2xl font-bold text-neon-gold floor:text-3xl'
          }
        />

        <div className="figure mt-0.5 flex items-center justify-end gap-2 text-[0.68rem] text-void-400">
          {/*
           * A dot rather than a word, and on this row rather than beside the
           * figure: next to the total it reads as a decimal point, which on the
           * one element that exists to state an amount precisely is the worst
           * possible place to put a stray full stop.
           *
           * The socket being up is worth showing at all — it is why the figure
           * above can be trusted while a game runs in a frame — but it is not
           * worth a word on every screen.
           */}
          <span
            aria-hidden
            title={live ? 'Live' : 'Reconnecting'}
            className={
              live
                ? 'h-1.5 w-1.5 rounded-full bg-neon-lime shadow-[0_0_0.4rem_var(--color-neon-lime)]'
                : 'h-1.5 w-1.5 rounded-full bg-void-600'
            }
          />
          <span title="Spendable">{money(balance)} free</span>
          {chips > 0 && (
            <>
              <span aria-hidden className="text-void-600">
                ·
              </span>
              <span className="text-neon-cyan" title="On open tables">
                {money(chips)} on tables
              </span>
            </>
          )}
        </div>
      </div>

      <span className="sr-only" aria-live="polite">
        Worth {money(total)}. {money(balance)} spendable, {money(chips)} on tables.
      </span>
    </div>
  );
}

/**
 * The handle, and what it is worth knowing about it.
 *
 * A guest sees "guest" and a nudge; that is deliberate, because a guest's token
 * is their account and losing the browser loses the bankroll. Saying so once,
 * quietly, in the place they already look, is better than a modal they dismiss.
 */
export function PlayerChip({ onOpen }: { onOpen: () => void }): React.JSX.Element | null {
  const player = useFloor((s) => s.player);
  if (!player) return null;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-neon-cyan focus-visible:outline-none"
    >
      <span
        aria-hidden
        className="display grid h-8 w-8 place-items-center rounded-lg bg-[color-mix(in_oklab,var(--color-neon-cyan)_18%,transparent)] text-xs text-neon-cyan ring-1 ring-neon-cyan/35"
      >
        {player.handle.slice(0, 2).toUpperCase()}
      </span>
      <span className="hidden sm:block">
        <span className="block text-xs font-semibold text-void-100 group-hover:text-white">
          {player.handle}
        </span>
        {player.tier === 'guest' ? (
          <Tag className="mt-0.5" tone="plain">
            guest
          </Tag>
        ) : (
          <Tag className="mt-0.5" tone="gold">
            {player.tier}
          </Tag>
        )}
      </span>
    </button>
  );
}
