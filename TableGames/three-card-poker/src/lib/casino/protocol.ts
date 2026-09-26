/**
 * The casino floor protocol — the one contract between the casino and a game.
 *
 * GENERATED FILE. The canonical copy lives in `casino/protocol/protocol.ts`
 * and is vendored into the shell and into every game by
 * `casino/tools/sync-protocol.mjs`. Edit the canonical copy and run
 * `pnpm run casino:sync` from the repository root; `--check` fails if a copy
 * has drifted.
 *
 * ------------------------------------------------------------------------
 * Why a message protocol rather than a shared module
 * ------------------------------------------------------------------------
 *
 * Each game is a finished, self-contained app: its own build, its own store,
 * its own physics, its own audio graph. The whole value of this repository is
 * that those four things already work and are already tuned. A casino that
 * imported them would have to agree with all four on React version, bundler
 * config, CSS layer order and animation budget — and the first disagreement
 * would be paid for in the only currency that matters here, which is how the
 * games feel to play.
 *
 * So the casino hosts each game exactly as it is, in a frame, and money
 * crosses the boundary as messages. That is also, not by coincidence, how a
 * real casino integrates a third-party game: the cabinet runs the vendor's
 * software and the floor runs the wallet, and the two speak a wire protocol
 * with a session, a balance and a settlement. Getting a fifth game onto this
 * floor is a URL, a manifest row, and an implementation of this file.
 *
 * ------------------------------------------------------------------------
 * The money model: chips at the table
 * ------------------------------------------------------------------------
 *
 * There is one bankroll, the wallet, and it lives on the server. A game never
 * touches it. Instead, sitting down buys chips: the wallet is debited and the
 * chips become the game's bankroll. While seated, the game reports its chip
 * count after every settled round; the floor writes that to the server, which
 * holds it as the session's chip balance. Standing up cashes out: the chips
 * return to the wallet and the session closes.
 *
 * The invariant the server enforces, and the reason the model is shaped this
 * way, is that a player's assets are always
 *
 *     wallet + the chips on every open table
 *
 * with no third place money can be. A crashed tab, a closed laptop or a
 * reloaded frame leaves chips on a table rather than losing them, and the
 * floor can hand them back on the next visit.
 *
 * The consequence for a game is the part worth reading twice: **a game keeps
 * its own bankroll and its own engine, unchanged.** It is told what it has at
 * the start and says what it has as it goes. Nothing about how it pays a bet
 * changes, which is what makes this integration safe for games that were
 * finished before the casino existed.
 *
 * ------------------------------------------------------------------------
 * Units
 * ------------------------------------------------------------------------
 *
 * Every amount on the wire is an integer number of cents. Three of the four
 * games already think in cents; craps thinks in whole dollars and converts at
 * its own edge. Cents on the wire means the server's ledger is integers all
 * the way down, and a half-unit paytable cannot round money into existence.
 */

/** Message namespace. Anything without it is not ours and is ignored. */
export const CASINO_NAMESPACE = 'knotz-casino' as const;

/** Bumped only for a breaking change; the floor refuses a version it cannot speak. */
export const CASINO_PROTOCOL_VERSION = 1 as const;

/** What a game can do. The floor adapts its chrome to what is missing. */
export type GameCapability =
  /** Reports its chip count as it plays, so the wallet tracks in near-real time. */
  | 'chip-sync'
  /** Can settle up and hand its chips back on request, without a reload. */
  | 'cash-out'
  /** Signals when a round is in flight, so the floor can hold a cash-out. */
  | 'busy-signal'
  /** Emits jackpots and big wins for the floor ticker. */
  | 'events'
  /** Accepts more chips mid-session from the cashier. */
  | 'top-up';

/** The kinds of moment the floor puts on the ticker. */
export type FloorEventKind = 'jackpot' | 'big-win' | 'feature' | 'milestone' | 'bust';

export interface PlayerInfo {
  id: string;
  handle: string;
  /** 'guest' players are anonymous and their wallet is local to the device token. */
  tier: 'guest' | 'member' | 'vip';
}

export interface SessionInfo {
  /** Server-issued table session id. Every sync and the cash-out quote it. */
  id: string;
  /** Slug of the game this session belongs to, e.g. `craps`. */
  game: string;
  /** Bearer token scoped to this session alone. */
  token: string;
}

/** What the floor will let this table take, in cents. */
export interface TableLimits {
  minBet: number;
  maxBet: number;
  /** Chip denominations the floor wants offered, largest last. */
  denominations: readonly number[];
}

/* ------------------------------------------------------------------ *
 * Game → floor
 * ------------------------------------------------------------------ */

export type GameMessage =
  /**
   * First thing a game says, and it may say it more than once: the floor's
   * frame may finish loading before the game's script does, or after. Whoever
   * is late, `ready` and `hello` find each other.
   */
  | {
      type: 'ready';
      game: string;
      title: string;
      capabilities: readonly GameCapability[];
    }
  /**
   * The authoritative chip count at this table, after a settled round.
   *
   * `chips` is everything the player has here — the rack plus anything still
   * at risk on the layout — because that is the number that has to come back
   * as cash if the tab closes mid-hand. `atRisk` is reported separately so the
   * floor can show it, never subtracted twice.
   *
   * `seq` is monotonic per session and is how a stale message loses: the
   * server ignores anything at or below the sequence it has already applied.
   */
  | {
      type: 'chips';
      seq: number;
      chips: number;
      atRisk: number;
      /** Session totals, not deltas. Cumulative since this session opened. */
      wagered: number;
      won: number;
      rounds: number;
    }
  /** Settled up and handed everything back. The game is now at zero. */
  | { type: 'cashed-out'; seq: number; chips: number }
  /** Out of money and wants the cashier. `shortfall` is a hint, not a demand. */
  | { type: 'need-chips'; shortfall: number }
  /** A round is in flight (or is not). The floor holds cash-out while true. */
  | { type: 'busy'; busy: boolean }
  /** Something worth putting on the ticker happened. */
  | { type: 'floor-event'; kind: FloorEventKind; label: string; amount?: number }
  /** The player asked to leave from inside the game. */
  | { type: 'leave' }
  | { type: 'pong'; at: number };

/* ------------------------------------------------------------------ *
 * Floor → game
 * ------------------------------------------------------------------ */

export type HostMessage =
  /**
   * You are seated. Here is who you are, what session you are on, and what
   * you have in front of you.
   *
   * A game must not move money before this arrives, and must fall back to its
   * own standalone bankroll if it never does — which is exactly what happens
   * when someone opens the game's own URL directly, and is why a game stays
   * playable on its own after being wired to the floor.
   */
  | {
      type: 'hello';
      player: PlayerInfo;
      session: SessionInfo;
      chips: number;
      limits: TableLimits;
      /** Server time when the session opened, for the game's own clock. */
      openedAt: number;
      /** True when the session already existed and is being resumed. */
      resumed: boolean;
    }
  /** The cashier added chips mid-session. `total` is authoritative. */
  | { type: 'credit'; chips: number; total: number; reason: string }
  /** Please settle up and reply with `cashed-out`. */
  | { type: 'cash-out'; reason: 'leaving' | 'cashier' | 'closing' }
  /** The server applied a sync. Anything unacked is re-sent. */
  | { type: 'ack'; seq: number }
  /** The frame lost focus, or the floor put a takeover over the top. */
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'ping'; at: number };

/* ------------------------------------------------------------------ *
 * The envelope
 * ------------------------------------------------------------------ */

export interface CasinoEnvelope<T> {
  ns: typeof CASINO_NAMESPACE;
  v: typeof CASINO_PROTOCOL_VERSION;
  /** Which way this is going. Guards against a frame hearing its own echo. */
  dir: 'to-floor' | 'to-game';
  body: T;
}

export function toFloor(body: GameMessage): CasinoEnvelope<GameMessage> {
  return { ns: CASINO_NAMESPACE, v: CASINO_PROTOCOL_VERSION, dir: 'to-floor', body };
}

export function toGame(body: HostMessage): CasinoEnvelope<HostMessage> {
  return { ns: CASINO_NAMESPACE, v: CASINO_PROTOCOL_VERSION, dir: 'to-game', body };
}

/**
 * Unwrap a `MessageEvent` if, and only if, it is one of ours going the way we
 * are listening.
 *
 * Deliberately strict. A page in a frame hears every `postMessage` anyone
 * sends it, including from browser extensions and from dev-server hot-reload
 * clients, and a wallet is the last thing that should be typing-guessed. The
 * direction check is what stops a bug where a frame that both sends and
 * listens on the same window reacts to its own traffic.
 */
export function readEnvelope<T>(
  event: MessageEvent,
  dir: CasinoEnvelope<T>['dir'],
): T | null {
  const data = event.data as Partial<CasinoEnvelope<T>> | null | undefined;
  if (!data || typeof data !== 'object') return null;
  if (data.ns !== CASINO_NAMESPACE) return null;
  if (data.v !== CASINO_PROTOCOL_VERSION) return null;
  if (data.dir !== dir) return null;
  if (!data.body || typeof data.body !== 'object') return null;
  return data.body as T;
}

/* ------------------------------------------------------------------ *
 * Shared shapes for the floor's own API, so the shell and the games
 * describe a game the same way.
 * ------------------------------------------------------------------ */

/** A row in the catalog: everything the floor needs to show and seat a game. */
export interface GameManifest {
  slug: string;
  title: string;
  /** One line under the title on the tile. */
  tagline: string;
  kind: 'table' | 'slots' | 'video-poker' | 'specialty';
  /** Where the frame points. Relative to the floor's own origin. */
  path: string;
  /** Accent colour for the tile and the in-game chrome, as a hex string. */
  accent: string;
  /** Secondary accent, for gradients. */
  accentAlt: string;
  minBet: number;
  maxBet: number;
  /** What the floor offers as a buy-in by default. */
  defaultBuyIn: number;
  denominations: readonly number[];
  /** House edge or RTP, already formatted, e.g. `1.41% house edge`. */
  edgeLabel: string;
  /** Shown on the tile back. Three to five short lines. */
  highlights: readonly string[];
  /** False while a game is being built; the tile shows as coming soon. */
  live: boolean;
}
