'use client';

/**
 * The membership desk.
 *
 * A player arrives as a guest with a wallet and no password, which is the right
 * default for a play-money floor: the path from landing on the page to a first
 * bet should have nothing in it. The cost is that their token *is* their
 * account, so the browser holding it is the only copy — and this dialog is
 * where that gets fixed, without losing the bankroll or the open tables.
 *
 * Which is why "claim" is a different call from "register": it upgrades the row
 * that already has the money in it, rather than creating a second one and
 * leaving the first behind.
 */

import * as React from 'react';
import { Button, Dialog, Tag } from '@/components/ui/primitives';
import { money } from '@/lib/money';
import { useFloor } from '@/lib/floor';
import { FloorError } from '@/lib/api';

type Mode = 'overview' | 'claim' | 'signin';

export function AccountDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): React.JSX.Element {
  // Keyed on `open`, so every opening is a fresh mount with fresh fields.
  return <Desk key={open ? 'open' : 'shut'} open={open} onClose={onClose} />;
}

function Desk({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element {
  const player = useFloor((s) => s.player);
  const wallet = useFloor((s) => s.wallet);
  const total = useFloor((s) => s.total);
  const claimAccount = useFloor((s) => s.claimAccount);
  const signIn = useFloor((s) => s.signIn);
  const signOut = useFloor((s) => s.signOut);
  const openTables = useFloor((s) => s.openTables);

  /*
   * A dialog that reopens on the form the player abandoned, with their old
   * error still under it, reads as broken — so this component is *mounted* by
   * opening rather than hidden by it. See the export below: `AccountDialog`
   * keys this on `open`, which resets all five of these for free and without an
   * effect that has to remember to reset each one.
   */
  const [mode, setMode] = React.useState<Mode>('overview');
  const [handle, setHandle] = React.useState(() =>
    player?.tier === 'guest' ? '' : (player?.handle ?? ''),
  );
  const [password, setPassword] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setProblem(null);
    try {
      if (mode === 'claim') await claimAccount(handle.trim(), password);
      else await signIn(handle.trim(), password);
      onClose();
    } catch (error) {
      setProblem(
        error instanceof FloorError ? error.message : 'That did not work. Try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  const guest = player?.tier === 'guest';

  return (
    <Dialog open={open} onClose={onClose} title={mode === 'signin' ? 'Sign in' : 'Your account'}>
      {mode === 'overview' && (
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <span className="display grid h-12 w-12 place-items-center rounded-xl bg-neon-cyan/15 text-sm text-neon-cyan ring-1 ring-neon-cyan/35">
              {(player?.handle ?? '??').slice(0, 2).toUpperCase()}
            </span>
            <div>
              <p className="display text-sm text-void-100">{player?.handle ?? '—'}</p>
              <Tag className="mt-1" tone={guest ? 'plain' : 'gold'}>
                {player?.tier ?? 'guest'}
              </Tag>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Stat label="Worth" value={money(total)} lit />
            <Stat label="Spendable" value={money(wallet?.balance ?? 0)} />
            <Stat label="On tables" value={money(wallet?.chips ?? 0)} />
            <Stat label="Open tables" value={String(openTables.length)} />
            <Stat label="Lifetime action" value={money(wallet?.lifetimeWagered ?? 0)} />
            <Stat label="Lifetime paid out" value={money(wallet?.lifetimeWon ?? 0)} />
          </dl>

          {guest ? (
            <div className="rounded-lg bg-neon-gold/8 px-4 py-3 ring-1 ring-neon-gold/25">
              <p className="text-sm text-void-100">This bankroll lives in this browser.</p>
              <p className="mt-1 text-xs text-void-300">
                Put a handle and a password on it and it follows you — same wallet, same tables,
                nothing reset.
              </p>
              <Button tone="primary" size="md" className="mt-3 w-full" onClick={() => setMode('claim')}>
                Claim this bankroll
              </Button>
            </div>
          ) : (
            <Button
              tone="danger"
              size="md"
              className="w-full"
              onClick={() => {
                void signOut();
                onClose();
              }}
            >
              Sign out
            </Button>
          )}

          <button
            type="button"
            className="w-full text-center text-xs text-void-400 underline-offset-4 hover:text-void-200 hover:underline"
            onClick={() => setMode('signin')}
          >
            Sign in to a different account
          </button>
        </div>
      )}

      {mode !== 'overview' && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {mode === 'claim' && (
            <p className="text-xs leading-relaxed text-void-300">
              Your wallet, your tables and your history stay exactly as they are. This only adds a
              way back in.
            </p>
          )}

          <Field
            label="Handle"
            value={handle}
            onChange={setHandle}
            autoComplete="username"
            hint="Letters, digits, underscore and hyphen. Three to twenty."
          />
          <Field
            label="Password"
            value={password}
            onChange={setPassword}
            type="password"
            autoComplete={mode === 'claim' ? 'new-password' : 'current-password'}
            hint={mode === 'claim' ? 'Eight characters or more.' : undefined}
          />

          {problem && (
            <p className="rounded-lg bg-neon-red/10 px-3 py-2 text-xs text-neon-red ring-1 ring-neon-red/30">
              {problem}
            </p>
          )}

          <Button
            tone="primary"
            size="lg"
            className="w-full"
            type="submit"
            disabled={busy || handle.trim().length < 3 || password.length < 8}
          >
            {busy ? 'One moment…' : mode === 'claim' ? 'Claim it' : 'Sign in'}
          </Button>

          <button
            type="button"
            className="w-full text-center text-xs text-void-400 hover:text-void-200"
            onClick={() => {
              setMode('overview');
              setProblem(null);
            }}
          >
            Back
          </button>
        </form>
      )}
    </Dialog>
  );
}

function Stat({
  label,
  value,
  lit,
}: {
  label: string;
  value: string;
  lit?: boolean;
}): React.JSX.Element {
  return (
    <div className="rounded-lg bg-black/25 px-3 py-2 ring-1 ring-white/6">
      <dt className="text-[0.62rem] tracking-[0.14em] text-void-400 uppercase">{label}</dt>
      <dd className={`figure mt-0.5 font-bold ${lit ? 'text-neon-gold' : 'text-void-100'}`}>
        {value}
      </dd>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  autoComplete,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  autoComplete?: string;
  hint?: string;
}): React.JSX.Element {
  return (
    <label className="block">
      <span className="block text-[0.62rem] tracking-[0.14em] text-void-400 uppercase">
        {label}
      </span>
      <input
        type={type}
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg bg-void-900/80 px-3 py-2 text-sm text-void-100 ring-1 ring-white/10 focus:ring-2 focus:ring-neon-cyan focus:outline-none"
      />
      {hint && <span className="mt-1 block text-[0.65rem] text-void-500">{hint}</span>}
    </label>
  );
}
