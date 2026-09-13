'use client';

/**
 * The floor's API, typed.
 *
 * One module, one place that knows a URL, one error type. Everything above this
 * file deals in shapes rather than in `fetch`, which is what makes the
 * difference between "the wallet is stale" and "the network is down" a thing
 * the UI can actually say.
 *
 * The base URL is empty by default, and that is the whole deployment story: the
 * floor's binary serves this app, so `/api/v1/...` is same-origin and there is
 * nothing to configure. `NEXT_PUBLIC_FLOOR_URL` exists for the one case that
 * needs it — running the shell on Next's dev server against a floor on another
 * port — and for a deployment that deliberately splits them.
 */

const BASE = (process.env.NEXT_PUBLIC_FLOOR_URL ?? '').replace(/\/$/, '');
const API = `${BASE}/api/v1`;

/* ------------------------------------------------------------------ *
 * Shapes. These mirror the server's serde output exactly.
 * ------------------------------------------------------------------ */

export interface Player {
  id: string;
  handle: string;
  tier: 'guest' | 'member' | 'vip';
}

export interface Wallet {
  /** Spendable. */
  balance: number;
  /** On open tables. Not spendable until cashed out. */
  chips: number;
  lifetimeIn: number;
  lifetimeWagered: number;
  lifetimeWon: number;
}

export interface Identity {
  token: string;
  player: Player;
  wallet: Wallet;
}

export interface TableSession {
  id: string;
  game: string;
  chips: number;
  buyIn: number;
  wagered: number;
  won: number;
  rounds: number;
  seq: number;
  openedAt: number;
  updatedAt: number;
  closedAt: number | null;
  net: number;
}

export interface Me {
  player: Player;
  wallet: Wallet;
  /** Wallet plus every chip on every open table. What the player is worth. */
  total: number;
  openTables: TableSession[];
  /** When the next comp can be claimed, or null if one is waiting. */
  compReadyAt: number | null;
  compAmount: number;
}

export interface GameManifest {
  slug: string;
  title: string;
  tagline: string;
  kind: 'table' | 'slots' | 'video-poker' | 'specialty';
  path: string;
  accent: string;
  accentAlt: string;
  minBet: number;
  maxBet: number;
  defaultBuyIn: number;
  denominations: number[];
  edgeLabel: string;
  highlights: string[];
  live: boolean;
}

export interface Limits {
  minBet: number;
  maxBet: number;
  denominations: number[];
}

export interface Seating {
  session: TableSession;
  /** Scoped to this table session. Handed to the game in the handshake. */
  token: string;
  wallet: Wallet;
  resumed: boolean;
  limits: Limits;
}

export interface SyncResult {
  session: TableSession;
  wallet: Wallet;
  applied: boolean;
}

export interface CashOutResult {
  session: TableSession;
  wallet: Wallet;
  paid: number;
}

export interface LedgerEntry {
  id: number;
  amount: number;
  balanceAfter: number;
  kind: 'SIGNUP' | 'COMP' | 'BUY_IN' | 'CASH_OUT' | 'TOP_UP' | 'ADJUST';
  game: string | null;
  memo: string;
  at: number;
}

export interface TickerEntry {
  handle: string;
  game: string;
  kind: 'jackpot' | 'big-win' | 'feature' | 'milestone' | 'bust';
  label: string;
  amount: number | null;
  at: number;
}

export interface Leaderboard {
  bankrolls: Array<{ handle: string; tier: string; total: number }>;
  sessions: Array<{ handle: string; game: string; net: number; rounds: number; at: number }>;
}

/* ------------------------------------------------------------------ *
 * Errors
 * ------------------------------------------------------------------ */

/**
 * Everything the API can refuse, as one type.
 *
 * `code` is the server's stable machine-readable string; `message` is its
 * sentence, written for a person, and the UI shows it rather than inventing its
 * own. `balance` and `needed` ride along on `insufficient_funds` so the cashier
 * can offer exactly the shortfall instead of asking the player to work it out.
 */
export class FloorError extends Error {
  readonly code: string;
  readonly status: number;
  readonly balance?: number;
  readonly needed?: number;

  constructor(init: {
    code: string;
    message: string;
    status: number;
    balance?: number;
    needed?: number;
  }) {
    super(init.message);
    this.name = 'FloorError';
    this.code = init.code;
    this.status = init.status;
    this.balance = init.balance;
    this.needed = init.needed;
  }

  get insufficient(): boolean {
    return this.code === 'insufficient_funds';
  }

  /** The token is gone or expired: the shell has to sign in again. */
  get signedOut(): boolean {
    return this.code === 'unauthorized';
  }
}

/* ------------------------------------------------------------------ *
 * The call
 * ------------------------------------------------------------------ */

interface CallOptions {
  method?: 'GET' | 'POST';
  token?: string | null;
  body?: unknown;
  /** Abort the request if the floor does not answer. */
  timeoutMs?: number;
}

/**
 * Ten seconds.
 *
 * Long enough to survive a cold container and a slow phone; short enough that a
 * cash-out which is never going to land fails while the player is still looking
 * at the screen, rather than after they have given up and reloaded.
 */
const DEFAULT_TIMEOUT_MS = 10_000;

async function call<T>(path: string, options: CallOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
      // The token is in a header, so there is nothing for a cookie to do and
      // nothing for a third-party site to ride on.
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch (cause) {
    clearTimeout(timer);
    const aborted = cause instanceof Error && cause.name === 'AbortError';
    throw new FloorError({
      code: aborted ? 'timeout' : 'offline',
      message: aborted
        ? 'The floor is not answering. Try that again.'
        : 'Cannot reach the floor. Check the connection.',
      status: 0,
    });
  }
  clearTimeout(timer);

  const text = await response.text();
  const parsed: unknown = text ? safeParse(text) : null;

  if (!response.ok) {
    const body = (parsed ?? {}) as Record<string, unknown>;
    throw new FloorError({
      code: typeof body.error === 'string' ? body.error : 'error',
      message:
        typeof body.message === 'string' ? body.message : `The floor said ${response.status}.`,
      status: response.status,
      balance: typeof body.balance === 'number' ? body.balance : undefined,
      needed: typeof body.needed === 'number' ? body.needed : undefined,
    });
  }

  return parsed as T;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * The endpoints
 * ------------------------------------------------------------------ */

export const floor = {
  /* --- who you are --- */

  signUpAsGuest: (handle?: string) =>
    call<Identity>('/auth/guest', { method: 'POST', body: { handle } }),

  register: (handle: string, password: string) =>
    call<Identity>('/auth/register', { method: 'POST', body: { handle, password } }),

  login: (handle: string, password: string) =>
    call<Identity>('/auth/login', { method: 'POST', body: { handle, password } }),

  /** Turn a guest into a member, keeping the wallet and every open table. */
  claim: (token: string, handle: string, password: string) =>
    call<Identity>('/auth/claim', { method: 'POST', token, body: { handle, password } }),

  logout: (token: string) => call<{ ok: boolean }>('/auth/logout', { method: 'POST', token }),

  me: (token: string) => call<Me>('/me', { token }),

  comp: (token: string) =>
    call<{ granted: number; wallet: Wallet; nextAt: number | null }>('/me/comp', {
      method: 'POST',
      token,
    }),

  ledger: (token: string, limit = 40) =>
    call<{ entries: LedgerEntry[] }>(`/me/ledger?limit=${limit}`, { token }),

  /* --- the floor --- */

  games: () => call<{ games: GameManifest[] }>('/games'),

  ticker: (limit = 24) => call<{ entries: TickerEntry[] }>(`/ticker?limit=${limit}`),

  leaderboard: () => call<Leaderboard>('/leaderboard'),

  /* --- tables --- */

  sit: (token: string, game: string, buyIn?: number) =>
    call<Seating>('/sessions', { method: 'POST', token, body: { game, buyIn } }),

  history: (token: string) => call<{ sessions: TableSession[] }>('/sessions', { token }),

  sync: (
    token: string,
    session: string,
    position: {
      seq: number;
      chips: number;
      atRisk: number;
      wagered: number;
      won: number;
      rounds: number;
    },
  ) => call<SyncResult>(`/sessions/${session}/sync`, { method: 'POST', token, body: position }),

  topUp: (token: string, session: string, amount: number) =>
    call<SyncResult>(`/sessions/${session}/top-up`, { method: 'POST', token, body: { amount } }),

  cashOut: (token: string, session: string, final?: { seq: number; chips: number }) =>
    call<CashOutResult>(`/sessions/${session}/cash-out`, {
      method: 'POST',
      token,
      body: final ?? {},
      // A cash-out is the request worth waiting longest for: the alternative to
      // waiting is a player who thinks their chips vanished.
      timeoutMs: 20_000,
    }),

  announce: (
    token: string,
    session: string,
    event: { kind: string; label: string; amount?: number },
  ) => call<{ ok: boolean }>(`/sessions/${session}/event`, { method: 'POST', token, body: event }),
};

/** Where the live feed lives, for the socket to open. */
export function feedUrl(token: string | null): string {
  const origin =
    BASE ||
    (typeof window === 'undefined' ? '' : `${window.location.protocol}//${window.location.host}`);
  const ws = origin.replace(/^http/, 'ws');
  return token ? `${ws}/api/v1/ws?token=${encodeURIComponent(token)}` : `${ws}/api/v1/ws`;
}
