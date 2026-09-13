'use client';

/**
 * A table.
 *
 * This is the one screen that brokers money, and every decision in it comes
 * from one rule: **a game is never told what its balance is except through the
 * handshake, and the server is never told anything except by this page.** A
 * game reports; the floor writes; the server decides. Nothing in the frame can
 * reach the wallet, because nothing in the frame has a token for it — the
 * session token it does get is scoped to one open table and is worthless the
 * moment that table closes.
 *
 * The flow, end to end:
 *
 *   1. The URL names a game. If the player already has chips on that table they
 *      sit straight back down at it; otherwise the cage opens first.
 *   2. `POST /sessions` debits the wallet and returns a session, its token, and
 *      the chips now on the table.
 *   3. The frame loads the game with `?casino=1`. The game announces itself and
 *      this page seats it with the figure from step 2.
 *   4. The game reports its position after each settled round. Those are
 *      coalesced and written to the server.
 *   5. Leaving asks the game to settle up, takes its final count, and posts the
 *      cash-out. The chips go back to the wallet and the table closes.
 *
 * And the step that is not in the list, because it is the whole reason the model
 * is shaped this way: *not* leaving. Closing the tab, losing the phone, walking
 * away — the chips stay on the table, the server still has them, and the lobby
 * offers them back. Nothing is lost by a frame going away, which is what lets
 * the games stay exactly the client-side games they already were.
 */

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { BuyInDialog, TopUpDialog } from '@/components/Cashier';
import { GameArt } from '@/components/GameArt';
import { Accent, Button, Counter, Dialog, Tag } from '@/components/ui/primitives';
import { createHostLink, type ChipPosition, type HostLink } from '@/lib/casino/host';
import { CASINO_FLAG } from '@/lib/casino/mode';
import { money, moneySigned } from '@/lib/money';
import { useFloor } from '@/lib/floor';
import {
  FloorError,
  floor as api,
  type GameManifest,
  type Seating,
  type TableSession,
} from '@/lib/api';

/**
 * How often a position is written to the server, at most.
 *
 * The game's own client already coalesces its reports; this is the second
 * stage, and the two windows do different jobs. The game's smooths a slot
 * settling several times a second into one message. This one decides how often
 * that message becomes a database write.
 *
 * Half a second is chosen against the failure it protects: the position the
 * server holds is what the cage pays if the tab dies, so the exposure of a
 * longer window is "the last half second of play is void". Shorter buys almost
 * nothing; much longer starts to be a whole round.
 */
const WRITE_EVERY_MS = 500;

/**
 * How long to wait for a game to settle up before cashing out without it.
 *
 * A game that implements `cash-out` replies in a frame or two. One that does
 * not — an older build, a game mid-crash, a frame already navigated away — will
 * never reply, and a leave button that hangs forever on that is worse than one
 * that pays out the last position the server has. Which is what it does: the
 * server's figure is authoritative in the absence of a newer one.
 */
const SETTLE_GRACE_MS = 2500;

export default function PlayPage(): React.JSX.Element {
  /*
   * `useSearchParams` in a statically exported route has to sit inside a
   * Suspense boundary: the page is prerendered at build time, when there is no
   * URL to read, and the boundary is what lets the prerender emit the fallback
   * and the client fill in the rest. The alternative — reading
   * `window.location` in an effect — is the same information one render later
   * and a hydration mismatch to reason about, for no gain.
   */
  return (
    <React.Suspense fallback={<Waiting label="Finding the table" />}>
      <Table />
    </React.Suspense>
  );
}

function Table(): React.JSX.Element {
  const router = useRouter();
  const slug = useSearchParams().get('game');

  const token = useFloor((s) => s.token);
  const player = useFloor((s) => s.player);
  const games = useFloor((s) => s.games);
  const wallet = useFloor((s) => s.wallet);
  const openTables = useFloor((s) => s.openTables);
  const compReadyAt = useFloor((s) => s.compReadyAt);
  const compAmount = useFloor((s) => s.compAmount);
  const boot = useFloor((s) => s.boot);
  const refresh = useFloor((s) => s.refresh);
  const claimComp = useFloor((s) => s.claimComp);
  const applyWallet = useFloor((s) => s.applyWallet);

  const [seating, setSeating] = React.useState<Seating | null>(null);
  const [leaving, setLeaving] = React.useState(false);
  const [receipt, setReceipt] = React.useState<{ paid: number; session: TableSession } | null>(null);
  const [chips, setChips] = React.useState(0);
  const [atRisk, setAtRisk] = React.useState(0);
  const [busyAtTable, setBusyAtTable] = React.useState(false);
  const [cageBusy, setCageBusy] = React.useState(false);
  const [cageProblem, setCageProblem] = React.useState<string | null>(null);
  const [topUp, setTopUp] = React.useState<{ open: boolean; suggested: number } | null>(null);
  const [flash, setFlash] = React.useState<{ key: number; text: string } | null>(null);

  const game = games.find((g) => g.slug === slug) ?? null;

  /*
   * What the screen is, derived rather than stored.
   *
   * An earlier version kept a `phase` and drove it from an effect that watched
   * the catalog, the identity and the open tables. Every one of those inputs is
   * already state, so the phase was a fourth copy of the same truth that could
   * be a render behind the other three — and React's compiler is right to
   * refuse it. Everything below is a function of what has loaded.
   */
  const ready = !!slug && !!token && games.length > 0;
  const view = receipt
    ? 'receipt'
    : !ready
      ? 'loading'
      : !game || !game.live
        ? 'lost'
        : seating
          ? leaving
            ? 'leaving'
            : 'seated'
          : 'cage';

  React.useEffect(() => {
    void boot();
  }, [boot]);

  /* ---------------------------------------------------------------- *
   * Sitting down
   * ---------------------------------------------------------------- */

  const takeSeat = React.useCallback(
    async (buyIn: number) => {
      if (!token || !slug) return;
      setCageBusy(true);
      setCageProblem(null);
      try {
        const result = await api.sit(token, slug, buyIn);
        setSeating(result);
        setChips(result.session.chips);
        applyWallet(result.wallet);
      } catch (error) {
        setCageProblem(
          error instanceof FloorError ? error.message : 'Could not open a table.',
        );
      } finally {
        setCageBusy(false);
      }
    },
    [token, slug, applyWallet],
  );

  /*
   * Chips already on this table: walk back to them rather than asking for a
   * buy-in the player has already paid. Once, guarded by a ref — the effect's
   * inputs change as the wallet moves, and a second `POST /sessions` would take
   * a second buy-in for a table that is already open.
   */
  const resumed = React.useRef(false);
  const resumable = ready && !!game && game.live && !seating
    ? openTables.find((t) => t.game === slug && t.chips > 0)
    : undefined;

  React.useEffect(() => {
    if (!resumable || resumed.current) return;
    resumed.current = true;
    void takeSeat(resumable.chips);
  }, [resumable, takeSeat]);

  /* ---------------------------------------------------------------- *
   * The writes
   * ---------------------------------------------------------------- */

  const frame = React.useRef<HTMLIFrameElement | null>(null);
  const link = React.useRef<HostLink | null>(null);

  /** The newest position not yet written, and the timer that will write it. */
  const pending = React.useRef<ChipPosition | null>(null);
  const writeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Set the moment a cash-out is posted, so nothing writes after it. */
  const closed = React.useRef(false);

  const sessionId = seating?.session.id ?? null;

  const write = React.useCallback(async () => {
    writeTimer.current = null;
    const position = pending.current;
    pending.current = null;
    if (!position || !token || !sessionId || closed.current) return;

    try {
      const result = await api.sync(token, sessionId, position);
      applyWallet(result.wallet);
      link.current?.ack(position.seq);
    } catch (error) {
      /*
       * A failed sync must not interrupt play. The next position supersedes
       * this one and the server drops anything stale, so the recovery is to put
       * it back in the slot and let the next tick carry it. Only a table that is
       * no longer open is worth stopping for.
       */
      if (error instanceof FloorError && (error.status === 404 || error.status === 409)) {
        closed.current = true;
        useFloor.setState({ problem: 'That table is no longer open.' });
        return;
      }
      if (pending.current === null) pending.current = position;
    }
  }, [token, sessionId, applyWallet]);

  const schedule = React.useCallback(
    (position: ChipPosition) => {
      pending.current = position;
      if (writeTimer.current !== null) return;
      writeTimer.current = setTimeout(() => void write(), WRITE_EVERY_MS);
    },
    [write],
  );

  /** Post the cash-out and show the receipt. */
  const settle = React.useCallback(
    async (final?: { seq: number; chips: number }) => {
      if (!token || !sessionId || closed.current) return;
      closed.current = true;
      if (writeTimer.current !== null) {
        clearTimeout(writeTimer.current);
        writeTimer.current = null;
      }
      try {
        const result = await api.cashOut(token, sessionId, final);
        applyWallet(result.wallet);
        setReceipt({ paid: result.paid, session: result.session });
      } catch (error) {
        if (error instanceof FloorError && error.code === 'conflict') {
          // Already cashed out: the game's reply and the leave button raced, and
          // both landing is the expected case rather than a fault.
          await refresh();
          router.push('/');
          return;
        }
        closed.current = false;
        setLeaving(false);
        useFloor.setState({
          problem:
            error instanceof FloorError
              ? error.message
              : 'The cash-out did not land. Your chips are still on the table.',
        });
      }
    },
    [token, sessionId, applyWallet, refresh, router],
  );

  const leave = React.useCallback(() => {
    if (closed.current) return;
    setLeaving(true);
    link.current?.requestCashOut('leaving');
    // The backstop. A game that settles up replies and `onCashedOut` gets there
    // first; one that cannot is cashed out on the server's own figure.
    setTimeout(() => {
      if (!closed.current) void settle();
    }, SETTLE_GRACE_MS);
  }, [settle]);

  /* ---------------------------------------------------------------- *
   * The link
   * ---------------------------------------------------------------- */

  /*
   * Built only once the session exists. A link with no session would hear a
   * game's `ready` and have nothing to seat it with, leaving the game holding a
   * handshake open against a floor that cannot answer.
   */
  React.useEffect(() => {
    if (!seating || !player || !token) return;

    const current = createHostLink({
      frame: () => frame.current,
      expect: seating.session.game,

      onReady: () => {
        // Said every 250ms until answered, so re-seating on each one is both
        // expected and harmless: the game seats once and takes the newer chip
        // count on any repeat.
        current.seat({
          player,
          session: {
            id: seating.session.id,
            game: seating.session.game,
            token: seating.token,
          },
          chips: seating.session.chips,
          limits: seating.limits,
          openedAt: seating.session.openedAt,
          resumed: seating.resumed,
        });
      },

      onPosition: (position) => {
        setChips(position.chips);
        setAtRisk(position.atRisk);
        schedule(position);
      },

      onCashedOut: (final) => {
        setChips(0);
        setAtRisk(0);
        void settle(final);
      },

      onNeedChips: (shortfall) => setTopUp({ open: true, suggested: shortfall }),

      onBusy: setBusyAtTable,

      onFloorEvent: (event) => {
        // Straight to the floor's ticker. Failing to post one is not worth
        // telling anybody about: it is a celebration, not a settlement.
        void api
          .announce(token, seating.session.id, {
            kind: event.kind,
            label: event.label,
            amount: event.amount,
          })
          .catch(() => {});
        if (event.kind === 'jackpot' || event.kind === 'big-win') {
          setFlash({ key: Date.now(), text: event.label });
        }
      },

      onLeave: leave,
    });

    link.current = current;
    return () => {
      current.dispose();
      if (link.current === current) link.current = null;
    };
  }, [seating, player, token, schedule, settle, leave]);

  /** The floor's own little celebration, cleared on its own timer. */
  React.useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 1500);
    return () => clearTimeout(timer);
  }, [flash]);

  /** Flush anything unwritten if the tab is closing. */
  React.useEffect(() => {
    const flush = () => {
      if (pending.current && !closed.current) void write();
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [write]);

  const bringChips = async (amount: number) => {
    if (!token || !sessionId) return;
    setCageBusy(true);
    setCageProblem(null);
    try {
      const result = await api.topUp(token, sessionId, amount);
      applyWallet(result.wallet);
      setChips(result.session.chips);
      link.current?.credit({ chips: amount, total: result.session.chips, reason: 'cashier' });
      setTopUp(null);
    } catch (error) {
      setCageProblem(error instanceof FloorError ? error.message : 'That did not go through.');
    } finally {
      setCageBusy(false);
    }
  };

  /* ---------------------------------------------------------------- *
   * Render
   * ---------------------------------------------------------------- */

  const seated = view === 'seated' || view === 'leaving';
  const net = seating ? chips - seating.session.buyIn : 0;

  return (
    <Accent
      color={game?.accent ?? '#22d3ee'}
      alt={game?.accentAlt}
      className="relative z-10 flex h-dvh flex-col"
    >
      {/* ---------------------------------------------------------------- *
          The table's own bar. Thin on purpose: everything below it is the
          game, and each game was built to own a whole viewport.
         ---------------------------------------------------------------- */}
      <header className="relative z-20 flex shrink-0 items-center gap-3 border-b border-white/8 bg-void-950/85 px-3 py-2 backdrop-blur-xl">
        <Button
          tone="ghost"
          size="sm"
          onClick={() => router.push('/')}
          title="Back to the floor. Your chips stay on this table."
        >
          ← Floor
        </Button>

        {game && (
          <span className="flex min-w-0 items-center gap-2">
            <span className="text-[var(--accent)]">
              <GameArt game={game} className="h-5 w-5" />
            </span>
            <span className="display hidden truncate text-xs text-void-100 sm:block">
              {game.title}
            </span>
          </span>
        )}

        <div className="flex-1" />

        {/* The chips at *this table*, not the wallet. On this screen that is the
            figure that matters, and it is in the game's own colour so the two
            can never be confused. */}
        {seated && (
          <div className="text-right">
            <Counter
              value={chips}
              format={money}
              className="block text-base leading-tight font-bold text-[var(--accent)]"
            />
            <span className="figure block text-[0.62rem] text-void-400">
              {atRisk > 0 ? `${money(atRisk)} riding · ` : ''}
              <span className={net >= 0 ? 'text-neon-lime' : 'text-neon-red'}>
                {moneySigned(net)}
              </span>
            </span>
          </div>
        )}

        {view === 'seated' && (
          <>
            <Button size="sm" tone="ghost" onClick={() => setTopUp({ open: true, suggested: 0 })}>
              + Chips
            </Button>
            <Button
              size="sm"
              tone="primary"
              disabled={busyAtTable}
              title={busyAtTable ? 'The round is still live' : 'Take the chips back to the cage'}
              onClick={leave}
            >
              Cash out
            </Button>
          </>
        )}

        {view === 'leaving' && <Tag tone="gold">settling up…</Tag>}
      </header>

      {/* ---------------------------------------------------------------- *
          The stage
         ---------------------------------------------------------------- */}
      <div className="stage relative flex-1">
        {game && seating && (
          /*
           * `allow-same-origin` is what lets the two windows exchange
           * structured messages and lets the game reach its own localStorage
           * for its preferences. `allow-scripts` is a game. Nothing else is
           * granted: no top-level navigation, no popups, no forms, no
           * pointer-lock. A game has no business doing any of them, and the
           * frame not being able to navigate the top window is what stops a
           * compromised game taking the player anywhere.
           */
          <iframe
            ref={frame}
            title={game.title}
            src={`${game.path}?${CASINO_FLAG}=1`}
            sandbox="allow-scripts allow-same-origin"
            allow="autoplay"
          />
        )}

        {/* A win, over the felt, for a moment. The game has its own
            celebration; this is the floor's, and it is deliberately small. */}
        {flash && (
          <div
            key={flash.key}
            className="flare pointer-events-none absolute top-4 left-1/2 z-10 -translate-x-1/2"
          >
            <span className="display rounded-full bg-void-950/85 px-4 py-2 text-[0.7rem] tracking-[0.2em] text-neon-gold ring-1 ring-neon-gold/40">
              {flash.text}
            </span>
          </div>
        )}

        {view === 'loading' && <Waiting label="Finding the table" />}
        {view === 'cage' && cageBusy && <Waiting label="Counting out the chips" />}
      </div>

      {/* ---------------------------------------------------------------- *
          The cage, the cashier, the receipt
         ---------------------------------------------------------------- */}
      {view === 'cage' && game && (
        <BuyInDialog
          // Keyed on the game so the stake always opens on this table's own
          // default rather than on one carried over from the last screen.
          key={game.slug}
          game={game}
          balance={wallet?.balance ?? 0}
          busy={cageBusy}
          problem={cageProblem}
          compReady={compReadyAt === null}
          compAmount={compAmount}
          onComp={() => void claimComp()}
          onConfirm={(buyIn) => void takeSeat(buyIn)}
          onClose={() => router.push('/')}
        />
      )}

      {topUp?.open && game && (
        <TopUpDialog
          // Keyed on what was asked for, so a game reporting a shortfall opens
          // the field on that figure rather than on the last one typed.
          key={topUp.suggested}
          game={game}
          balance={wallet?.balance ?? 0}
          chips={chips}
          busy={cageBusy}
          problem={cageProblem}
          suggested={topUp.suggested}
          compReady={compReadyAt === null}
          compAmount={compAmount}
          onComp={() => void claimComp()}
          onConfirm={(amount) => void bringChips(amount)}
          onClose={() => {
            setTopUp(null);
            setCageProblem(null);
          }}
        />
      )}

      {receipt && (
        <Receipt
          game={game}
          paid={receipt.paid}
          session={receipt.session}
          onDone={() => {
            void refresh();
            router.push('/');
          }}
        />
      )}

      {view === 'lost' && (
        <Dialog open onClose={() => router.push('/')} title="Not this way">
          <p className="text-sm text-void-200">
            {!game
              ? 'The floor has no game by that name.'
              : `${game.title} is not open yet.`}
          </p>
          <Button tone="primary" size="lg" className="mt-5 w-full" onClick={() => router.push('/')}>
            Back to the floor
          </Button>
        </Dialog>
      )}
    </Accent>
  );
}

/* ------------------------------------------------------------------ *
 * Bits
 * ------------------------------------------------------------------ */

function Waiting({ label }: { label: string }): React.JSX.Element {
  return (
    <div className="absolute inset-0 grid place-items-center">
      <div className="text-center">
        <span
          aria-hidden
          className="mx-auto block h-10 w-10 animate-spin rounded-full border-2 border-white/10 border-t-neon-cyan"
        />
        <p className="display mt-4 text-[0.68rem] tracking-[0.22em] text-void-400">{label}</p>
      </div>
    </div>
  );
}

/**
 * What the cage paid.
 *
 * Worth a screen rather than a toast. A session ending is the moment a player
 * finds out whether the last twenty minutes went well, and a casino that tells
 * them in a corner for two seconds has wasted the only satisfying part of
 * losing.
 */
function Receipt({
  game,
  paid,
  session,
  onDone,
}: {
  game: GameManifest | null;
  paid: number;
  session: TableSession;
  onDone: () => void;
}): React.JSX.Element {
  const up = session.net > 0;
  const even = session.net === 0;

  return (
    <Dialog open onClose={onDone} title="Cashed out">
      <div className="space-y-5 text-center">
        <div>
          <p className="display text-[0.62rem] tracking-[0.22em] text-void-400">
            {game?.title ?? session.game}
          </p>
          <p
            className={`figure mt-2 text-4xl font-bold ${
              up ? 'text-neon-lime' : even ? 'text-void-200' : 'text-neon-red'
            }`}
          >
            {even ? money(0) : moneySigned(session.net)}
          </p>
          <p className="mt-1 text-xs text-void-400">
            {up ? 'up over the session' : even ? 'level' : 'down over the session'}
          </p>
        </div>

        <dl className="grid grid-cols-3 gap-2 text-left">
          <Cell label="Bought in" value={money(session.buyIn)} />
          <Cell label="Paid out" value={money(paid)} lit />
          <Cell label="Rounds" value={String(session.rounds)} />
        </dl>

        {session.wagered > 0 && (
          <p className="text-[0.68rem] text-void-500">
            {money(session.wagered)} of action across {session.rounds} rounds.
          </p>
        )}

        <Button tone="primary" size="lg" className="w-full" onClick={onDone}>
          Back to the floor
        </Button>
      </div>
    </Dialog>
  );
}

function Cell({
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
      <dt className="text-[0.6rem] tracking-[0.14em] text-void-400 uppercase">{label}</dt>
      <dd className={`figure mt-0.5 text-sm font-bold ${lit ? 'text-neon-gold' : 'text-void-100'}`}>
        {value}
      </dd>
    </div>
  );
}
