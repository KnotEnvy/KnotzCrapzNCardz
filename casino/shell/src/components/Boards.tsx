'use client';

/**
 * The rail: the boards, the open tables, and the books.
 *
 * Everything here is a *reason to look at the floor rather than at a game*, and
 * that is the job of a lobby. A casino whose lobby is only a launcher gets used
 * once per session; one that tells you where your money is, who is ahead, and
 * what your last hour actually cost gets looked at between every game.
 */

import * as React from 'react';
import { Accent, Button, Heading, Panel, Skeleton, Tag } from '@/components/ui/primitives';
import { ago, money, moneySigned, moneyShort } from '@/lib/money';
import { useFloor } from '@/lib/floor';
import { floor as api, type Leaderboard as Board, type GameManifest, type TableSession } from '@/lib/api';

/* ------------------------------------------------------------------ *
 * Your open tables
 * ------------------------------------------------------------------ */

/**
 * Chips you left somewhere.
 *
 * This panel is the reason the session model is worth its complexity: a table
 * you walked away from still has your money on it, and the floor can hand it
 * back whenever you ask. Without this the model would just be an accounting
 * detail; with it, it is a feature.
 */
export function OpenTables({
  games,
  onResume,
  onCashOut,
  cashingOut,
}: {
  games: GameManifest[];
  onResume: (game: GameManifest) => void;
  onCashOut: (session: TableSession) => void;
  cashingOut: string | null;
}): React.JSX.Element | null {
  const tables = useFloor((s) => s.openTables);
  if (tables.length === 0) return null;

  const bySlug = new Map(games.map((g) => [g.slug, g]));

  return (
    <section>
      <Heading right={<Tag tone="accent">{tables.length}</Tag>}>Chips on tables</Heading>
      <div className="space-y-2">
        {tables.map((table) => {
          const game = bySlug.get(table.game);
          return (
            <Accent key={table.id} color={game?.accent ?? '#22d3ee'} alt={game?.accentAlt}>
              <Panel className="flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-void-100">
                    {game?.title ?? table.game}
                  </p>
                  <p className="figure mt-0.5 text-[0.68rem] text-void-400">
                    {money(table.chips)} · {table.rounds} rounds ·{' '}
                    <span className={table.net >= 0 ? 'text-neon-lime' : 'text-neon-red'}>
                      {moneySigned(table.net)}
                    </span>
                  </p>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {game && (
                    <Button size="sm" tone="primary" onClick={() => onResume(game)}>
                      Play
                    </Button>
                  )}
                  <Button
                    size="sm"
                    tone="ghost"
                    disabled={cashingOut === table.id}
                    onClick={() => onCashOut(table)}
                  >
                    {cashingOut === table.id ? '…' : 'Cash out'}
                  </Button>
                </div>
              </Panel>
            </Accent>
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * The boards
 * ------------------------------------------------------------------ */

/**
 * Two boards, because they answer different questions.
 *
 * The bankroll board is who is ahead overall, and it rewards sitting on a
 * stack. The session board is the best single sit-down, and it is the one a
 * player can realistically aim at on their first night — which is what stops a
 * leaderboard being decided in its first week and ignored thereafter.
 */
export function Leaderboard({ games }: { games: GameManifest[] }): React.JSX.Element {
  const [board, setBoard] = React.useState<Board | null>(null);
  const [tab, setTab] = React.useState<'bankrolls' | 'sessions'>('bankrolls');
  const me = useFloor((s) => s.player?.handle);

  React.useEffect(() => {
    let alive = true;
    const load = () => {
      void api
        .leaderboard()
        .then((b) => {
          if (alive) setBoard(b);
        })
        .catch(() => {
          /* a board that will not load is not worth an error message */
        });
    };
    load();
    /*
     * A minute. The board is not live-updated over the socket on purpose: it is
     * a ranking across every player, so keeping it current would mean pushing
     * a recomputed top twelve to every connected client on every settled round.
     * Nobody watches a leaderboard that closely.
     */
    const timer = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const bySlug = new Map(games.map((g) => [g.slug, g]));

  return (
    <section>
      <Heading
        right={
          <div className="flex gap-1">
            <Button
              size="sm"
              tone={tab === 'bankrolls' ? 'primary' : 'quiet'}
              onClick={() => setTab('bankrolls')}
            >
              Bankrolls
            </Button>
            <Button
              size="sm"
              tone={tab === 'sessions' ? 'primary' : 'quiet'}
              onClick={() => setTab('sessions')}
            >
              Best sits
            </Button>
          </div>
        }
      >
        The board
      </Heading>

      <Panel className="divide-y divide-white/5 overflow-hidden">
        {!board && (
          <div className="space-y-2 p-3">
            <Skeleton className="h-7" />
            <Skeleton className="h-7" />
            <Skeleton className="h-7" />
          </div>
        )}

        {board &&
          tab === 'bankrolls' &&
          (board.bankrolls.length === 0 ? (
            <Empty>Nobody has bought in yet.</Empty>
          ) : (
            board.bankrolls.map((row, i) => (
              <Row
                key={`${row.handle}-${i}`}
                rank={i + 1}
                handle={row.handle}
                mine={row.handle === me}
                right={
                  <span className="figure font-bold text-neon-gold">{moneyShort(row.total)}</span>
                }
              />
            ))
          ))}

        {board &&
          tab === 'sessions' &&
          (board.sessions.length === 0 ? (
            <Empty>No sessions with a round played yet.</Empty>
          ) : (
            board.sessions.map((row, i) => (
              <Row
                key={`${row.handle}-${row.at}-${i}`}
                rank={i + 1}
                handle={row.handle}
                mine={row.handle === me}
                note={`${bySlug.get(row.game)?.title ?? row.game} · ${row.rounds} rounds`}
                right={
                  <span
                    className={`figure font-bold ${row.net >= 0 ? 'text-neon-lime' : 'text-neon-red'}`}
                  >
                    {moneySigned(row.net)}
                  </span>
                }
              />
            ))
          ))}
      </Panel>
    </section>
  );
}

function Row({
  rank,
  handle,
  note,
  right,
  mine,
}: {
  rank: number;
  handle: string;
  note?: string;
  right: React.ReactNode;
  mine?: boolean;
}): React.JSX.Element {
  return (
    <div
      className={`flex items-center gap-3 px-3 py-2 ${mine ? 'bg-neon-cyan/6' : ''}`}
    >
      <span
        className={`display w-6 shrink-0 text-center text-[0.65rem] ${
          rank === 1 ? 'text-neon-gold' : rank <= 3 ? 'text-void-200' : 'text-void-500'
        }`}
      >
        {rank}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold text-void-100">
          {handle}
          {mine && <span className="ml-1.5 text-[0.6rem] text-neon-cyan">you</span>}
        </span>
        {note && <span className="block truncate text-[0.65rem] text-void-400">{note}</span>}
      </span>
      {right}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="px-3 py-6 text-center text-xs text-void-400">{children}</p>;
}

/* ------------------------------------------------------------------ *
 * The books
 * ------------------------------------------------------------------ */

const KIND_LABEL: Record<string, string> = {
  SIGNUP: 'Opening stake',
  COMP: 'Comped',
  BUY_IN: 'Bought in',
  CASH_OUT: 'Cashed out',
  TOP_UP: 'More chips',
  ADJUST: 'Adjustment',
};

/**
 * Every movement of money, from the server's own ledger.
 *
 * Two rows per table session and nothing in between, which is what the money
 * model produces — and showing it that way is honest about what the floor
 * actually knows: it knows what crossed the cage. What happened at the table is
 * the table's own history, and each game keeps one.
 */
export function Ledger({ games }: { games: GameManifest[] }): React.JSX.Element {
  const entries = useFloor((s) => s.ledger);
  const load = useFloor((s) => s.loadLedger);
  const bySlug = new Map(games.map((g) => [g.slug, g]));

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <section>
      <Heading
        right={
          <Button size="sm" tone="quiet" onClick={() => void load()}>
            Refresh
          </Button>
        }
      >
        The cage log
      </Heading>

      <Panel className="max-h-[22rem] divide-y divide-white/5 overflow-y-auto">
        {entries.length === 0 ? (
          <Empty>Nothing has crossed the cage yet.</Empty>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className="flex items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs text-void-100">
                  {KIND_LABEL[entry.kind] ?? entry.kind}
                  {entry.game && (
                    <span className="text-void-400">
                      {' '}
                      · {bySlug.get(entry.game)?.title ?? entry.game}
                    </span>
                  )}
                </span>
                <span className="block truncate text-[0.65rem] text-void-500">
                  {entry.memo || '—'} · {ago(entry.at)}
                </span>
              </span>
              <span
                className={`figure shrink-0 text-xs font-bold ${
                  entry.amount > 0
                    ? 'text-neon-lime'
                    : entry.amount < 0
                      ? 'text-void-300'
                      : 'text-void-500'
                }`}
              >
                {entry.amount === 0 ? money(0) : moneySigned(entry.amount)}
              </span>
            </div>
          ))
        )}
      </Panel>
    </section>
  );
}
