'use client';

/**
 * The game's end of the casino link.
 *
 * GENERATED FILE. The canonical copy lives in `casino/protocol/client.ts` and
 * is vendored into every game by `casino/tools/sync-protocol.mjs`. Edit the
 * canonical copy and run `pnpm run casino:sync` from the repository root.
 *
 * ------------------------------------------------------------------------
 *
 * This file is deliberately the *only* thing a game has to understand about
 * the casino, and it is deliberately dumb: it owns a socket, a sequence
 * number and a timeout, and it knows nothing about bankrolls, bets or stores.
 * Each game keeps a small module of its own that wires this to its store,
 * because that is the part that is genuinely different per game — cents
 * versus dollars, one seat versus three, a rack versus a credit meter.
 *
 * The rule that makes the whole thing safe: **until `seat` fires, a game
 * behaves exactly as it always did.** Open a game's own URL and no floor ever
 * answers the handshake, the standalone timeout fires, and the game deals
 * from its own persisted bankroll as if the casino did not exist. That is not
 * a fallback bolted on the side; it is the default, and the casino is the
 * special case.
 */

import {
  CASINO_NAMESPACE,
  CASINO_PROTOCOL_VERSION,
  readEnvelope,
  toFloor,
  type GameCapability,
  type FloorEventKind,
  type GameMessage,
  type HostMessage,
  type PlayerInfo,
  type SessionInfo,
  type TableLimits,
} from './protocol';

export interface SeatedTable {
  player: PlayerInfo;
  session: SessionInfo;
  /** What the player has in front of them, in cents. */
  chips: number;
  limits: TableLimits;
  openedAt: number;
  resumed: boolean;
}

export interface CasinoClientOptions {
  /** Slug this game is registered under, e.g. `craps`. */
  game: string;
  /** Display name, for the floor's chrome. */
  title: string;
  capabilities: readonly GameCapability[];
  /** Seated: take this as the bankroll and start reporting. */
  onSeat: (table: SeatedTable) => void;
  /** Chips arrived from the cashier mid-session. */
  onCredit?: (credit: { chips: number; total: number; reason: string }) => void;
  /**
   * The floor wants the chips back. Settle up, return the final count, and
   * expect the frame to go away shortly afterwards.
   */
  onCashOutRequest?: (reason: 'leaving' | 'cashier' | 'closing') => void;
  onPause?: () => void;
  onResume?: () => void;
  /**
   * Nobody answered: this is a standalone session. Called exactly once, and
   * never if a floor did answer.
   */
  onStandalone?: () => void;
  /**
   * How long to wait for a floor before deciding there is not one.
   *
   * Short enough that a directly-opened game is not visibly waiting, long
   * enough to survive a cold frame on a slow phone. The handshake is also
   * retried while waiting, so this is a deadline rather than a single shot.
   */
  handshakeTimeoutMs?: number;
}

export interface CasinoClient {
  /** True once a floor has answered. */
  readonly seated: boolean;
  /** The current table, or null when standalone. */
  readonly table: SeatedTable | null;
  /**
   * Report the chip position. Call it after every settled round — it is
   * cheap, it coalesces, and the floor only writes what changed.
   *
   * `chips` must include everything at the table, rack plus at-risk, because
   * that is what the cage owes if the tab closes now.
   */
  report: (position: {
    chips: number;
    atRisk: number;
    wagered: number;
    won: number;
    rounds: number;
  }) => void;
  /** Settled up; here is the final count. Sent once, then the link goes quiet. */
  cashedOut: (chips: number) => void;
  /** Broke. Ask the floor to open the cashier. */
  needChips: (shortfall: number) => void;
  /** A round is in flight, or is not. */
  setBusy: (busy: boolean) => void;
  /** Put something on the floor ticker. */
  announce: (kind: FloorEventKind, label: string, amount?: number) => void;
  /** The player asked to leave from inside the game. */
  leave: () => void;
  /** Tear the listener down. */
  dispose: () => void;
}

/** Is this page inside something, and did that something say it is a floor? */
function embedded(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.parent && window.parent !== window) return true;
  } catch {
    // A cross-origin parent throws on access, which is itself the answer.
    return true;
  }
  return false;
}

/**
 * A no-op client, for the server render and for standalone play.
 *
 * Returning a real object rather than null means the calling game has no
 * branch to write: it reports its chips into the void until somebody listens.
 */
function inertClient(): CasinoClient {
  return {
    seated: false,
    table: null,
    report: () => {},
    cashedOut: () => {},
    needChips: () => {},
    setBusy: () => {},
    announce: () => {},
    leave: () => {},
    dispose: () => {},
  };
}

const DEFAULT_HANDSHAKE_TIMEOUT_MS = 4000;
const HANDSHAKE_RETRY_MS = 250;

/**
 * How long a chip report waits before going out.
 *
 * Reporting is on the settlement path of a live game, and a slot in turbo
 * settles several times a second. `postMessage` into a same-origin parent is
 * cheap but the server write behind it is not, so reports coalesce: the last
 * position inside the window is the one that goes, because it is the only one
 * that is still true. Zero is never coalesced away — see `report`.
 */
const REPORT_COALESCE_MS = 120;

export function createCasinoClient(options: CasinoClientOptions): CasinoClient {
  if (typeof window === 'undefined') return inertClient();
  if (!embedded()) {
    options.onStandalone?.();
    return inertClient();
  }

  const parent = window.parent;
  let table: SeatedTable | null = null;
  let seq = 0;
  let disposed = false;
  let settled = false;

  let handshake: ReturnType<typeof setInterval> | null = null;
  let deadline: ReturnType<typeof setTimeout> | null = null;
  let coalesce: ReturnType<typeof setTimeout> | null = null;
  let pending: Extract<GameMessage, { type: 'chips' }> | null = null;

  const send = (body: GameMessage) => {
    if (disposed) return;
    try {
      // The floor is same-origin in every shipped configuration, but a
      // deployment that splits them across hosts is legitimate, so the target
      // origin stays open here and the *floor* is the side that checks. A
      // game leaks nothing by telling its host what it holds; the floor is
      // the side with a wallet to protect.
      parent.postMessage(toFloor(body), '*');
    } catch {
      // A parent that has gone away is not an error worth crashing a game over.
    }
  };

  const stopHandshake = () => {
    if (handshake !== null) {
      clearInterval(handshake);
      handshake = null;
    }
    if (deadline !== null) {
      clearTimeout(deadline);
      deadline = null;
    }
  };

  const flush = () => {
    if (coalesce !== null) {
      clearTimeout(coalesce);
      coalesce = null;
    }
    if (pending === null) return;
    send(pending);
    pending = null;
  };

  const onMessage = (event: MessageEvent) => {
    const msg = readEnvelope<HostMessage>(event, 'to-game');
    if (!msg) return;

    switch (msg.type) {
      case 'hello': {
        // A floor that says hello twice is a floor whose frame reloaded under
        // us, or one re-announcing after its own reconnect. Take the newer
        // chip count either way, but only seat the game once.
        const first = table === null;
        table = {
          player: msg.player,
          session: msg.session,
          chips: msg.chips,
          limits: msg.limits,
          openedAt: msg.openedAt,
          resumed: msg.resumed,
        };
        stopHandshake();
        if (first) options.onSeat(table);
        else options.onCredit?.({ chips: 0, total: msg.chips, reason: 'resync' });
        break;
      }
      case 'credit': {
        if (table) table = { ...table, chips: msg.total };
        options.onCredit?.({ chips: msg.chips, total: msg.total, reason: msg.reason });
        break;
      }
      case 'cash-out':
        flush();
        options.onCashOutRequest?.(msg.reason);
        break;
      case 'ack':
        // Nothing to do today: the floor is the durable side and a lost sync
        // is superseded by the next one. The message exists so a future
        // client can re-send an unacked position without a protocol bump.
        break;
      case 'pause':
        options.onPause?.();
        break;
      case 'resume':
        options.onResume?.();
        break;
      case 'ping':
        send({ type: 'pong', at: msg.at });
        break;
    }
  };

  window.addEventListener('message', onMessage);

  const announceReady = () =>
    send({
      type: 'ready',
      game: options.game,
      title: options.title,
      capabilities: options.capabilities,
    });

  announceReady();
  handshake = setInterval(announceReady, HANDSHAKE_RETRY_MS);
  deadline = setTimeout(() => {
    stopHandshake();
    if (table === null) options.onStandalone?.();
  }, options.handshakeTimeoutMs ?? DEFAULT_HANDSHAKE_TIMEOUT_MS);

  /*
   * The tab is closing and there are chips on the table. One last position,
   * synchronously, so the cage knows what it owes. `pagehide` rather than
   * `beforeunload`: it fires on mobile Safari, where `beforeunload` does not.
   */
  const onPageHide = () => flush();
  window.addEventListener('pagehide', onPageHide);

  return {
    get seated() {
      return table !== null;
    },
    get table() {
      return table;
    },
    report: (position) => {
      if (table === null || settled) return;
      seq += 1;
      pending = { type: 'chips', seq, ...position };
      /*
       * A player down to nothing is the one position that cannot wait: the
       * floor's cashier prompt is the difference between "the game is broken"
       * and "you are out of chips", and 120ms of ambiguity there reads as the
       * former. Everything else coalesces.
       */
      if (position.chips === 0) {
        flush();
        return;
      }
      if (coalesce === null) coalesce = setTimeout(flush, REPORT_COALESCE_MS);
    },
    cashedOut: (chips) => {
      if (table === null || settled) return;
      settled = true;
      flush();
      seq += 1;
      send({ type: 'cashed-out', seq, chips });
    },
    needChips: (shortfall) => {
      if (table === null) return;
      send({ type: 'need-chips', shortfall });
    },
    setBusy: (busy) => {
      if (table === null) return;
      send({ type: 'busy', busy });
    },
    announce: (kind, label, amount) => {
      if (table === null) return;
      send({ type: 'floor-event', kind, label, amount });
    },
    leave: () => {
      if (table === null) return;
      flush();
      send({ type: 'leave' });
    },
    dispose: () => {
      flush();
      disposed = true;
      stopHandshake();
      window.removeEventListener('message', onMessage);
      window.removeEventListener('pagehide', onPageHide);
    },
  };
}

/** Re-exported so a game imports one module rather than two. */
export {
  CASINO_NAMESPACE,
  CASINO_PROTOCOL_VERSION,
  type GameCapability,
  type FloorEventKind,
  type PlayerInfo,
  type SessionInfo,
  type TableLimits,
};
