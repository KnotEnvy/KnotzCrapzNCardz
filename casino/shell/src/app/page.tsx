'use client';

/**
 * The floor.
 *
 * Reading order, top to bottom, and it is the layout: who you are and what you
 * are worth; what the floor is shouting about; the games; and then — on a wide
 * screen, in a rail; on a phone, underneath — where your money is, what the
 * cage owes you, and who is ahead.
 *
 * The games come before the boards because this is a casino and not a dashboard.
 * The boards come before nothing, because a lobby that is only a launcher is a
 * lobby nobody looks at twice.
 */

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AccountDialog } from '@/components/Account';
import { CompCard } from '@/components/Cashier';
import { Ledger, Leaderboard, OpenTables } from '@/components/Boards';
import { GameTile } from '@/components/GameTile';
import { Ticker } from '@/components/Ticker';
import { PlayerChip, WalletHud } from '@/components/WalletHud';
import { Button, Heading, Panel, Skeleton } from '@/components/ui/primitives';
import { money } from '@/lib/money';
import { useFloor } from '@/lib/floor';
import { FloorError, floor as api, type GameManifest, type TableSession } from '@/lib/api';

export default function FloorPage(): React.JSX.Element {
  const router = useRouter();

  const status = useFloor((s) => s.status);
  const problem = useFloor((s) => s.problem);
  const dismissProblem = useFloor((s) => s.dismissProblem);
  const boot = useFloor((s) => s.boot);
  const refresh = useFloor((s) => s.refresh);
  const games = useFloor((s) => s.games);
  const wallet = useFloor((s) => s.wallet);
  const total = useFloor((s) => s.total);
  const openTables = useFloor((s) => s.openTables);
  const compReadyAt = useFloor((s) => s.compReadyAt);
  const compAmount = useFloor((s) => s.compAmount);
  const claimComp = useFloor((s) => s.claimComp);
  const token = useFloor((s) => s.token);
  const applyWallet = useFloor((s) => s.applyWallet);

  const [account, setAccount] = React.useState(false);
  const [granted, setGranted] = React.useState<number | null>(null);
  const [cashingOut, setCashingOut] = React.useState<string | null>(null);

  React.useEffect(() => {
    void boot();
  }, [boot]);

  /*
   * Come back current.
   *
   * A player who was in a game, hit the back button, and is now looking at the
   * lobby has a wallet that moved while this page was not the one being
   * updated. The socket covers the case where this tab stayed open; this covers
   * the case where it was hidden, because a browser is free to throttle or drop
   * a socket in a background tab and usually does.
   */
  React.useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  const sit = (game: GameManifest) => {
    // The cage is on the play page, over the felt, so that a deep link to a
    // game reaches the same buy-in the lobby does. This is only navigation.
    router.push(`/play/?game=${encodeURIComponent(game.slug)}`);
  };

  const cashOut = async (table: TableSession) => {
    if (!token) return;
    setCashingOut(table.id);
    try {
      const result = await api.cashOut(token, table.id);
      applyWallet(result.wallet);
      await refresh();
    } catch (error) {
      // A table cashed out in another tab is not an error worth a banner: the
      // refresh below simply stops showing it.
      if (!(error instanceof FloorError && error.code === 'conflict')) {
        useFloor.setState({
          problem: error instanceof FloorError ? error.message : 'That cash-out did not land.',
        });
      }
      await refresh();
    } finally {
      setCashingOut(null);
    }
  };

  const takeComp = async () => {
    const amount = await claimComp();
    if (amount !== null) {
      setGranted(amount);
      setTimeout(() => setGranted(null), 4000);
    }
  };

  const compReady = compReadyAt === null;
  const broke = total === 0;
  const openBySlug = new Map(openTables.map((t) => [t.game, t]));

  return (
    <div className="relative z-10 flex min-h-dvh flex-col">
      {/* ---------------------------------------------------------------- *
          The bar. Sticky, because the wallet is the one thing that should
          never be scrolled away from.
         ---------------------------------------------------------------- */}
      <header className="sticky top-0 z-30 border-b border-white/6 bg-void-950/80 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-[86rem] items-center gap-4 px-4 py-3">
          <Mark />
          <div className="flex-1" />
          <WalletHud />
          <PlayerChip onOpen={() => setAccount(true)} />
        </div>
      </header>

      <Ticker />

      {problem && (
        <div className="mx-auto mt-3 w-full max-w-[86rem] px-4">
          <div className="flex items-center gap-3 rounded-lg bg-neon-red/10 px-4 py-2.5 ring-1 ring-neon-red/30">
            <span className="flex-1 text-xs text-neon-red">{problem}</span>
            <Button size="sm" tone="quiet" onClick={dismissProblem}>
              Dismiss
            </Button>
          </div>
        </div>
      )}

      <main className="mx-auto w-full max-w-[86rem] flex-1 px-4 py-6 floor:py-10">
        {/* ---------------------------------------------------------------- *
            The billing
           ---------------------------------------------------------------- */}
        <section className="mb-8 floor:mb-12">
          <p className="display text-[0.65rem] tracking-[0.35em] text-neon-cyan">
            One bankroll · every table
          </p>
          <h1 className="display mt-2 text-3xl leading-[1.05] text-void-100 floor:text-5xl">
            Knotz{' '}
            <span
              className="lit"
              style={{ ['--accent' as string]: 'var(--color-neon-gold)' }}
            >
              Casino
            </span>
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-void-300">
            Four games, four engines, one wallet. Buy chips at a table, take them back to the cage
            when you are done, and carry the same bankroll to the next one. Every return on this
            floor is a measured figure, printed on the tile.
          </p>

          <dl className="mt-6 grid grid-cols-2 gap-3 floor:max-w-2xl floor:grid-cols-4">
            <Figure label="Worth" value={money(total)} lit />
            <Figure label="Spendable" value={money(wallet?.balance ?? 0)} />
            <Figure label="On tables" value={money(wallet?.chips ?? 0)} />
            <Figure label="Games open" value={String(games.filter((g) => g.live).length)} />
          </dl>
        </section>

        <div className="grid gap-8 floor:grid-cols-[minmax(0,1fr)_20rem] floor:gap-10">
          {/* ------------------------------------------------------------ *
              The games
             ------------------------------------------------------------ */}
          <div>
            <Heading>On the floor</Heading>

            {status === 'booting' && games.length === 0 ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Skeleton className="h-80" />
                <Skeleton className="h-80" />
                <Skeleton className="h-80" />
                <Skeleton className="h-80" />
              </div>
            ) : games.length === 0 ? (
              <Panel className="p-8 text-center">
                <p className="text-sm text-void-200">The floor has no games on it.</p>
                <p className="mt-1 text-xs text-void-400">
                  The catalog came back empty, which means the floor is up but nothing is registered.
                </p>
              </Panel>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {games.map((game) => (
                  <GameTile
                    key={game.slug}
                    game={game}
                    open={openBySlug.get(game.slug)}
                    onSit={sit}
                  />
                ))}
              </div>
            )}
          </div>

          {/* ------------------------------------------------------------ *
              The rail
             ------------------------------------------------------------ */}
          <aside className="space-y-8">
            <OpenTables
              games={games}
              onResume={sit}
              onCashOut={(table) => void cashOut(table)}
              cashingOut={cashingOut}
            />

            <CompCard
              ready={compReady}
              readyAt={compReadyAt}
              amount={compAmount}
              broke={broke}
              granted={granted}
              onClaim={() => void takeComp()}
            />

            <Leaderboard games={games} />
            <Ledger games={games} />
          </aside>
        </div>
      </main>

      <footer className="border-t border-white/6 px-4 py-6">
        <div className="mx-auto flex w-full max-w-[86rem] flex-wrap items-center gap-x-6 gap-y-2 text-[0.68rem] text-void-500">
          <span>Play money. No purchase, no cash value, no payout.</span>
          <span className="text-void-600">·</span>
          <span>
            Every edge and return quoted here is measured by that game&rsquo;s own simulation suite.
          </span>
        </div>
      </footer>

      <AccountDialog open={account} onClose={() => setAccount(false)} />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Bits
 * ------------------------------------------------------------------ */

function Mark(): React.JSX.Element {
  return (
    <Link href="/" className="flex items-center gap-2.5 focus-visible:outline-none">
      <span
        aria-hidden
        className="grid h-9 w-9 place-items-center rounded-xl bg-neon-gold/12 ring-1 ring-neon-gold/35"
        style={{ boxShadow: '0 0 1.6rem -0.5rem var(--color-neon-gold)' }}
      >
        {/* A chip, cut. Four strokes and it reads at any size. */}
        <svg viewBox="0 0 24 24" className="h-5 w-5 text-neon-gold" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
          <circle cx="12" cy="12" r="4.2" stroke="currentColor" strokeWidth="1.6" />
          <path
            d="M12 3v3.6M12 17.4V21M3 12h3.6M17.4 12H21"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </span>
      <span className="display text-sm text-void-100">
        Knotz <span className="text-neon-gold">Casino</span>
      </span>
    </Link>
  );
}

function Figure({
  label,
  value,
  lit,
}: {
  label: string;
  value: string;
  lit?: boolean;
}): React.JSX.Element {
  return (
    <div className="rounded-xl bg-white/[0.03] px-3.5 py-3 ring-1 ring-white/8">
      <dt className="text-[0.6rem] tracking-[0.18em] text-void-400 uppercase">{label}</dt>
      <dd
        className={`figure mt-1 text-base font-bold ${lit ? 'text-neon-gold' : 'text-void-100'}`}
      >
        {value}
      </dd>
    </div>
  );
}
