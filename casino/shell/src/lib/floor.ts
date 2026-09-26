'use client';

/**
 * The floor, as the shell sees it: who you are, what you are worth, what is on
 * the floor, and what the floor is shouting about.
 *
 * ------------------------------------------------------------------------
 * Why the balance arrives twice
 * ------------------------------------------------------------------------
 *
 * Every endpoint that moves money returns the wallet, and the socket pushes it
 * too. That is not redundancy for its own sake — it is what makes the wallet in
 * the top bar correct in the two cases that matter:
 *
 *   - The player is *inside a game*, in a frame, and their chips are moving.
 *     The shell brokers those syncs so it already knows; the response is the
 *     authoritative figure and it wins.
 *   - The player has the floor open in *another tab*, or on their phone. There
 *     is no response to read, so the socket carries it.
 *
 * Both paths write the same field, and every message carries a full value
 * rather than a delta, so they cannot disagree about a total by arriving out of
 * order — the newer one is simply right. A socket that says "you lagged" means
 * this client missed messages, and the recovery is to re-read rather than to
 * try to catch up.
 */

import { create } from 'zustand';
import {
  FloorError,
  feedUrl,
  floor,
  type GameManifest,
  type LedgerEntry,
  type Me,
  type Player,
  type TableSession,
  type TickerEntry,
  type Wallet,
} from './api';

/**
 * Where the token lives.
 *
 * `localStorage` rather than a cookie, because the floor authenticates with a
 * bearer header and a cookie would buy nothing but a CSRF surface. A guest's
 * token *is* their account, which is why signing out asks before throwing it
 * away.
 */
const TOKEN_KEY = 'knotz-casino-token';

function readToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    // A private window with storage blocked. The session still works; it just
    // will not survive a reload.
    return null;
  }
}

function writeToken(token: string | null) {
  if (typeof window === 'undefined') return;
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* nothing to do about it, and nothing worth breaking over */
  }
}

export type Status = 'booting' | 'ready' | 'offline';

export interface FloorState {
  status: Status;
  /** Set when the floor refused or could not be reached. Shown, then cleared. */
  problem: string | null;

  token: string | null;
  player: Player | null;
  wallet: Wallet | null;
  total: number;
  openTables: TableSession[];
  compReadyAt: number | null;
  compAmount: number;

  games: GameManifest[];
  ticker: TickerEntry[];
  ledger: LedgerEntry[];

  /** True while the socket is connected. The lobby shows it, quietly. */
  live: boolean;

  /* --- actions --- */
  boot: () => Promise<void>;
  refresh: () => Promise<void>;
  loadLedger: () => Promise<void>;
  claimComp: () => Promise<number | null>;
  claimAccount: (handle: string, password: string) => Promise<void>;
  signIn: (handle: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Apply a wallet the API just returned. The authoritative path. */
  applyWallet: (wallet: Wallet) => void;
  dismissProblem: () => void;
}

/** The socket lives outside the store: it is a connection, not a value. */
let socket: WebSocket | null = null;
let reconnectAt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
/** Set once boot has been started, so React's double-invoke does not race it. */
let booting: Promise<void> | null = null;

export const useFloor = create<FloorState>()((set, get) => {
  /* ---------- helpers ---------- */

  const absorb = (me: Me) =>
    set({
      player: me.player,
      wallet: me.wallet,
      total: me.total,
      openTables: me.openTables,
      compReadyAt: me.compReadyAt,
      compAmount: me.compAmount,
      status: 'ready',
    });

  const complain = (error: unknown) => {
    if (error instanceof FloorError) {
      if (error.signedOut) {
        // The token is dead. Throw it away and come back as somebody new
        // rather than showing a floor that refuses every button.
        writeToken(null);
        set({ token: null, player: null, wallet: null, total: 0, openTables: [] });
        void get().boot();
        return;
      }
      set({ problem: error.message });
      if (error.code === 'offline' || error.code === 'timeout') set({ status: 'offline' });
      return;
    }
    set({ problem: 'Something went wrong on the way to the floor.' });
  };

  /* ---------- the live feed ---------- */

  const connect = (token: string | null) => {
    if (typeof window === 'undefined') return;
    if (socket) {
      socket.onclose = null;
      socket.close();
      socket = null;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    let ws: WebSocket;
    try {
      ws = new WebSocket(feedUrl(token));
    } catch {
      return;
    }
    socket = ws;

    ws.onopen = () => {
      reconnectAt = 0;
      set({ live: true, status: 'ready' });
    };

    ws.onmessage = (event) => {
      let signal: Record<string, unknown>;
      try {
        signal = JSON.parse(String(event.data)) as Record<string, unknown>;
      } catch {
        return;
      }

      switch (signal.type) {
        case 'wallet': {
          /*
           * A balance from the socket. It carries the two figures a HUD needs
           * and nothing else, so it updates them in place rather than
           * triggering a re-read: the lobby's job here is to be current, not to
           * be complete.
           */
          const balance = num(signal.balance);
          const chips = num(signal.chips);
          if (balance === null || chips === null) return;
          set((s) => ({
            wallet: s.wallet ? { ...s.wallet, balance, chips } : s.wallet,
            total: balance + chips,
          }));
          break;
        }
        case 'ticker': {
          const entry = asTicker(signal);
          if (entry) set((s) => ({ ticker: [entry, ...s.ticker].slice(0, 30) }));
          break;
        }
        case 'resync':
          // This client was too slow and missed messages. Every signal is a
          // full value, so the fix is one re-read.
          void get().refresh();
          break;
      }
    };

    ws.onclose = () => {
      set({ live: false });
      if (socket !== ws) return;
      socket = null;
      /*
       * Reconnect with a backoff that tops out at fifteen seconds. The floor
       * restarting during a deploy should reconnect in under a second; a floor
       * that is genuinely down should not be hammered by every open tab.
       */
      reconnectAt = Math.min(reconnectAt === 0 ? 500 : reconnectAt * 2, 15_000);
      reconnectTimer = setTimeout(() => connect(get().token), reconnectAt);
    };

    ws.onerror = () => set({ live: false });
  };

  /* ---------- the store ---------- */

  return {
    status: 'booting',
    problem: null,
    token: null,
    player: null,
    wallet: null,
    total: 0,
    openTables: [],
    compReadyAt: null,
    compAmount: 0,
    games: [],
    ticker: [],
    ledger: [],
    live: false,

    boot: async () => {
      // React mounts effects twice in development, and two guest sign-ups is
      // two wallets. One promise, shared.
      if (booting) return booting;
      booting = (async () => {
        // The catalog and the ticker are public, so they load without waiting
        // for an identity: the floor should be *visible* before it is yours.
        const [catalog, tape] = await Promise.allSettled([floor.games(), floor.ticker()]);
        if (catalog.status === 'fulfilled') set({ games: catalog.value.games });
        if (tape.status === 'fulfilled') set({ ticker: tape.value.entries });

        let token = readToken();
        try {
          if (!token) {
            const identity = await floor.signUpAsGuest();
            token = identity.token;
            writeToken(token);
            set({ token, player: identity.player, wallet: identity.wallet });
          } else {
            set({ token });
          }
          absorb(await floor.me(token));
        } catch (error) {
          if (error instanceof FloorError && error.signedOut) {
            // A token from a floor that has since been reset. Start again.
            writeToken(null);
            try {
              const identity = await floor.signUpAsGuest();
              writeToken(identity.token);
              set({ token: identity.token });
              absorb(await floor.me(identity.token));
            } catch (second) {
              complain(second);
            }
          } else {
            complain(error);
          }
        }
        connect(get().token);
      })();
      try {
        await booting;
      } finally {
        booting = null;
      }
    },

    refresh: async () => {
      const token = get().token;
      if (!token) return;
      try {
        const [me, tape] = await Promise.all([floor.me(token), floor.ticker()]);
        absorb(me);
        set({ ticker: tape.entries });
      } catch (error) {
        complain(error);
      }
    },

    loadLedger: async () => {
      const token = get().token;
      if (!token) return;
      try {
        const { entries } = await floor.ledger(token);
        set({ ledger: entries });
      } catch (error) {
        complain(error);
      }
    },

    claimComp: async () => {
      const token = get().token;
      if (!token) return null;
      try {
        const result = await floor.comp(token);
        set((s) => ({
          wallet: result.wallet,
          total: result.wallet.balance + result.wallet.chips,
          compReadyAt: result.nextAt,
          ledger: s.ledger.length > 0 ? [] : s.ledger,
        }));
        return result.granted;
      } catch (error) {
        complain(error);
        return null;
      }
    },

    claimAccount: async (handle, password) => {
      const token = get().token;
      if (!token) return;
      const identity = await floor.claim(token, handle, password);
      writeToken(identity.token);
      set({ token: identity.token, player: identity.player, wallet: identity.wallet });
      connect(identity.token);
      await get().refresh();
    },

    signIn: async (handle, password) => {
      const identity = await floor.login(handle, password);
      writeToken(identity.token);
      set({ token: identity.token, player: identity.player, wallet: identity.wallet, ledger: [] });
      connect(identity.token);
      await get().refresh();
    },

    signOut: async () => {
      const token = get().token;
      writeToken(null);
      set({
        token: null,
        player: null,
        wallet: null,
        total: 0,
        openTables: [],
        ledger: [],
        status: 'booting',
      });
      if (token) {
        try {
          await floor.logout(token);
        } catch {
          // A token we have already forgotten failing to be forgotten by the
          // server is not worth telling anybody about.
        }
      }
      booting = null;
      await get().boot();
    },

    applyWallet: (wallet) =>
      set({ wallet, total: wallet.balance + wallet.chips }),

    dismissProblem: () => set({ problem: null }),
  };
});

/* ------------------------------------------------------------------ *
 * Narrowing what the socket sends
 * ------------------------------------------------------------------ */

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * A ticker row is written by another player's game, so it is checked rather
 * than trusted: a handle and a label go straight into the DOM as text, and a
 * malformed amount would render as `$NaN` across the whole floor.
 */
function asTicker(signal: Record<string, unknown>): TickerEntry | null {
  const handle = signal.handle;
  const label = signal.label;
  const game = signal.game;
  const kind = signal.kind;
  if (typeof handle !== 'string' || typeof label !== 'string') return null;
  if (typeof game !== 'string' || typeof kind !== 'string') return null;
  return {
    handle: handle.slice(0, 24),
    game,
    kind: kind as TickerEntry['kind'],
    label: label.slice(0, 120),
    amount: num(signal.amount),
    at: num(signal.at) ?? Date.now(),
  };
}

/** The manifest for one slug, or undefined if the floor does not have it. */
export function useGameManifest(slug: string | null): GameManifest | undefined {
  return useFloor((s) => (slug ? s.games.find((g) => g.slug === slug) : undefined));
}
