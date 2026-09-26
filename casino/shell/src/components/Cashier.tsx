'use client';

/**
 * The cage.
 *
 * Two dialogs and a card, and between them they are every moment money crosses
 * between the wallet and a table: buying in, topping up, and being comped when
 * there is nothing left.
 *
 * The design decision worth naming is that a buy-in is a *choice*, presented in
 * chips. The fast version of this screen is a single "Play" button that quietly
 * moves the game's default stake, and it is worse in a way that compounds: a
 * player who has not decided what they are risking at this table has not
 * started playing it. Chips on a felt are how a casino asks that question, so
 * that is how this asks it.
 */

import * as React from 'react';
import { Accent, Button, Chip, Dialog, Tag, useNow } from '@/components/ui/primitives';
import { money, moneyShort, toDollars, fromDollars } from '@/lib/money';
import type { GameManifest } from '@/lib/api';

/** The chip a given amount is paid out in, largest first. */
const DENOMS: Array<{ cents: number; label: string }> = [
  { cents: 500_000, label: '5K' },
  { cents: 100_000, label: '1K' },
  { cents: 50_000, label: '500' },
  { cents: 10_000, label: '100' },
  { cents: 2_500, label: '25' },
  { cents: 500, label: '5' },
  { cents: 100, label: '1' },
];

/**
 * Break an amount into the chips a cashier would actually hand over.
 *
 * Greedy, largest first, and capped at eight chips — past that it is a stack
 * rather than a set of chips and the count stops meaning anything, so the last
 * chip carries a multiplier instead.
 */
function rack(cents: number): Array<{ cents: number; label: string; count: number }> {
  const out: Array<{ cents: number; label: string; count: number }> = [];
  let left = cents;
  for (const denom of DENOMS) {
    if (left < denom.cents) continue;
    const count = Math.floor(left / denom.cents);
    left -= count * denom.cents;
    out.push({ ...denom, count });
    if (out.length === 4) break;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Buying in
 * ------------------------------------------------------------------ */

export function BuyInDialog({
  game,
  balance,
  busy,
  problem,
  onConfirm,
  onClose,
  onComp,
  compReady,
  compAmount,
}: {
  game: GameManifest | null;
  balance: number;
  busy: boolean;
  problem: string | null;
  onConfirm: (buyIn: number) => void;
  onClose: () => void;
  onComp: () => void;
  compReady: boolean;
  compAmount: number;
}): React.JSX.Element | null {
  /*
   * The stake opens on the table's own default and is clamped to the wallet on
   * every render rather than corrected by an effect.
   *
   * The clamp has to be at render because the balance can move while the dialog
   * is open — a comp lands, or another tab cashes a table out — and an effect
   * that chased it would render one frame showing a figure the confirm button
   * refuses. Re-seeding per game is handled by the caller keying this component
   * on the slug, which is what makes the initial value a mount concern and not
   * a synchronisation concern.
   */
  const [chosen, setAmount] = React.useState(() =>
    game ? Math.min(game.defaultBuyIn, balance) : 0,
  );

  if (!game) return null;

  const amount = Math.max(0, Math.min(chosen, balance));
  const min = Math.min(game.minBet * 10, balance);
  const tooLittle = amount < Math.min(game.minBet, balance) || amount <= 0;
  const broke = balance <= 0;

  /**
   * Four stakes, spanning the range a player actually picks from: a short
   * session, the table's own default, a long one, and everything.
   */
  const presets = [
    { label: 'Short', cents: Math.round(game.defaultBuyIn / 2) },
    { label: 'Standard', cents: game.defaultBuyIn },
    { label: 'Long', cents: game.defaultBuyIn * 2 },
    { label: 'The lot', cents: balance },
  ].filter((p, i, all) => p.cents > 0 && p.cents <= balance && all.findIndex((q) => q.cents === p.cents) === i);

  return (
    <Accent color={game.accent} alt={game.accentAlt}>
      <Dialog open onClose={onClose} title={`Buy in — ${game.title}`}>
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs text-void-400">In the wallet</p>
              <p className="figure text-xl font-bold text-neon-gold">{money(balance)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-void-400">Table limits</p>
              <p className="figure text-sm text-void-200">
                {money(game.minBet)} – {moneyShort(game.maxBet)}
              </p>
            </div>
          </div>

          {broke ? (
            <div className="rounded-lg bg-neon-gold/8 px-4 py-4 ring-1 ring-neon-gold/25">
              <p className="text-sm text-void-100">The wallet is empty.</p>
              <p className="mt-1 text-xs text-void-300">
                {compReady
                  ? `The cage will comp you ${money(compAmount)} to get back in.`
                  : 'Cash out a table, or come back for the next comp.'}
              </p>
              {compReady && (
                <Button tone="primary" size="md" className="mt-3 w-full" onClick={onComp}>
                  Take the comp
                </Button>
              )}
            </div>
          ) : (
            <>
              {/* The chips. This is the figure, rendered as money rather than
                  as a number, and it is the part of the dialog people look at. */}
              <div className="rounded-xl bg-black/30 p-4 ring-1 ring-white/6">
                <div className="flex min-h-[3.5rem] flex-wrap items-center gap-3">
                  {rack(amount).map((r) => (
                    <span key={r.cents} className="flex items-center gap-1.5">
                      <Chip cents={r.cents} label={r.label} size={40} />
                      {r.count > 1 && (
                        <span className="figure text-xs text-void-300">×{r.count}</span>
                      )}
                    </span>
                  ))}
                  {amount <= 0 && <span className="text-xs text-void-400">Nothing on the felt</span>}
                </div>

                <label className="mt-4 block">
                  <span className="sr-only">Buy-in, in dollars</span>
                  <input
                    type="range"
                    min={Math.max(1, toDollars(min))}
                    max={Math.max(1, toDollars(balance))}
                    step={Math.max(1, toDollars(game.minBet))}
                    value={toDollars(amount)}
                    onChange={(e) => setAmount(fromDollars(Number(e.target.value)))}
                    className="w-full accent-[var(--accent)]"
                  />
                </label>

                <div className="mt-3 flex items-center gap-2">
                  <span className="figure text-void-400">$</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={toDollars(balance)}
                    value={toDollars(amount)}
                    onChange={(e) => setAmount(fromDollars(Number(e.target.value) || 0))}
                    className="figure w-full rounded-lg bg-void-900/80 px-3 py-2 text-lg font-bold text-void-100 ring-1 ring-white/10 focus:ring-2 focus:ring-[var(--accent)] focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {presets.map((p) => (
                  <Button
                    key={p.label}
                    size="sm"
                    tone={amount === p.cents ? 'primary' : 'ghost'}
                    onClick={() => setAmount(p.cents)}
                  >
                    {p.label}
                    <span className="figure ml-1 text-void-400">{moneyShort(p.cents)}</span>
                  </Button>
                ))}
              </div>

              {problem && (
                <p className="rounded-lg bg-neon-red/10 px-3 py-2 text-xs text-neon-red ring-1 ring-neon-red/30">
                  {problem}
                </p>
              )}

              <Button
                tone="primary"
                size="lg"
                className="w-full"
                disabled={busy || tooLittle}
                onClick={() => onConfirm(amount)}
              >
                {busy ? 'Taking the chips…' : `Sit down with ${money(amount)}`}
              </Button>

              {chosen > balance && (
                <p className="text-center text-xs text-void-400">
                  Trimmed to what the wallet holds.
                </p>
              )}
            </>
          )}
        </div>
      </Dialog>
    </Accent>
  );
}

/* ------------------------------------------------------------------ *
 * Topping up, without leaving the table
 * ------------------------------------------------------------------ */

export function TopUpDialog({
  game,
  balance,
  chips,
  busy,
  problem,
  suggested,
  compReady,
  compAmount,
  onConfirm,
  onComp,
  onClose,
}: {
  game: GameManifest;
  balance: number;
  chips: number;
  busy: boolean;
  problem: string | null;
  /** What the game asked for, when it was the game that asked. */
  suggested: number;
  compReady: boolean;
  compAmount: number;
  onConfirm: (amount: number) => void;
  onComp: () => void;
  onClose: () => void;
}): React.JSX.Element {
  /*
   * Opens on whatever the game asked for, floored at half a buy-in so a game
   * that reported a tiny shortfall does not offer to bring one chip. Clamped at
   * render for the same reason as the buy-in dialog; re-seeded by the caller
   * keying this on the amount the game asked for.
   */
  const [chosen, setAmount] = React.useState(() =>
    Math.min(Math.max(suggested, Math.round(game.defaultBuyIn / 2)), balance),
  );
  const amount = Math.max(0, Math.min(chosen, balance));
  const broke = balance <= 0;

  return (
    <Accent color={game.accent} alt={game.accentAlt}>
      <Dialog open onClose={onClose} title="More chips">
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs text-void-400">On the table</p>
              <p className="figure text-lg font-bold text-[var(--accent)]">{money(chips)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-void-400">In the wallet</p>
              <p className="figure text-lg font-bold text-neon-gold">{money(balance)}</p>
            </div>
          </div>

          {broke ? (
            <div className="rounded-lg bg-neon-gold/8 px-4 py-4 ring-1 ring-neon-gold/25">
              <p className="text-sm text-void-100">Nothing left in the wallet.</p>
              <p className="mt-1 text-xs text-void-300">
                {compReady
                  ? `The cage will comp you ${money(compAmount)}.`
                  : 'Cash out another table, or come back for the next comp.'}
              </p>
              {compReady && (
                <Button tone="primary" size="md" className="mt-3 w-full" onClick={onComp}>
                  Take the comp
                </Button>
              )}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span className="figure text-void-400">$</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={toDollars(balance)}
                  value={toDollars(amount)}
                  onChange={(e) => setAmount(fromDollars(Number(e.target.value) || 0))}
                  className="figure w-full rounded-lg bg-void-900/80 px-3 py-2 text-lg font-bold text-void-100 ring-1 ring-white/10 focus:ring-2 focus:ring-[var(--accent)] focus:outline-none"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                {[
                  Math.round(game.defaultBuyIn / 2),
                  game.defaultBuyIn,
                  game.defaultBuyIn * 2,
                  balance,
                ]
                  .filter((c, i, all) => c > 0 && c <= balance && all.indexOf(c) === i)
                  .map((cents) => (
                    <Button
                      key={cents}
                      size="sm"
                      tone={amount === cents ? 'primary' : 'ghost'}
                      onClick={() => setAmount(cents)}
                    >
                      <span className="figure">{moneyShort(cents)}</span>
                    </Button>
                  ))}
              </div>

              {problem && (
                <p className="rounded-lg bg-neon-red/10 px-3 py-2 text-xs text-neon-red ring-1 ring-neon-red/30">
                  {problem}
                </p>
              )}

              <Button
                tone="primary"
                size="lg"
                className="w-full"
                disabled={busy || amount <= 0 || amount > balance}
                onClick={() => onConfirm(amount)}
              >
                {busy ? 'Counting it out…' : `Bring ${money(amount)} to the table`}
              </Button>
            </>
          )}
        </div>
      </Dialog>
    </Accent>
  );
}

/* ------------------------------------------------------------------ *
 * The comp
 * ------------------------------------------------------------------ */

/**
 * The card in the lobby rail that hands out the comp.
 *
 * It has two moods on purpose. With money in the wallet it is a small "come
 * back tomorrow" prompt. With an empty wallet it is the loudest thing on the
 * page, because a player staring at a floor they cannot afford to play is a
 * player about to close the tab.
 */
export function CompCard({
  ready,
  readyAt,
  amount,
  broke,
  onClaim,
  granted,
}: {
  ready: boolean;
  readyAt: number | null;
  amount: number;
  broke: boolean;
  onClaim: () => void;
  /** Set for a moment after a successful claim, to say what landed. */
  granted: number | null;
}): React.JSX.Element {
  const now = useNow();
  const wait = readyAt ? Math.max(1, Math.round((readyAt - now) / 60_000)) : 0;

  return (
    <Accent
      color={broke && ready ? '#fbbf24' : '#22d3ee'}
      alt="#e879f9"
      className={broke && ready ? 'pulse-ring rounded-2xl' : ''}
    >
      <div className="glass p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="display text-[0.65rem] tracking-[0.2em] text-void-300">The cage</p>
            <p className="figure mt-1 text-lg font-bold text-neon-gold">{money(amount)}</p>
          </div>
          {granted !== null ? (
            <Tag tone="win">+{money(granted)}</Tag>
          ) : ready ? (
            <Tag tone="gold">waiting</Tag>
          ) : (
            <Tag tone="plain">{wait > 59 ? `${Math.round(wait / 60)}h` : `${wait}m`}</Tag>
          )}
        </div>

        <p className="mt-2 text-[0.74rem] leading-snug text-void-300">
          {broke
            ? 'Out of money is not out of the game. Take a comp and sit back down.'
            : ready
              ? 'A comp is waiting whenever you want it.'
              : 'The next comp is on the clock. Flat broke overrides it.'}
        </p>

        <Button tone="primary" size="md" className="mt-3 w-full" disabled={!ready} onClick={onClaim}>
          {ready ? 'Collect' : 'Collected'}
        </Button>
      </div>
    </Accent>
  );
}
