'use client';

/**
 * The floor's end of the casino link.
 *
 * GENERATED FILE. The canonical copy lives in `casino/protocol/host.ts` and is
 * vendored into the shell by `casino/tools/sync-protocol.mjs`. Edit the
 * canonical copy and run `pnpm run casino:sync` from the repository root.
 *
 * ------------------------------------------------------------------------
 *
 * This is the side with a wallet to protect, so this is the side that checks
 * everything: the envelope, the direction, the origin, the frame the message
 * came from, and the sequence number. A game is trusted to report what it
 * holds — it is our own software — but "our own software in a frame" and "any
 * page that can reach a `postMessage` handler" are the same thing to a
 * browser, and only one of them is a game.
 *
 * What this file does *not* do is decide anything about money. It hands
 * positions to a callback and the callback talks to the server, which is the
 * only thing that may move a balance. Keeping that line sharp is what makes
 * the floor's UI replaceable without putting the ledger at risk.
 */

import {
  readEnvelope,
  toGame,
  type FloorEventKind,
  type GameCapability,
  type GameMessage,
  type HostMessage,
  type PlayerInfo,
  type SessionInfo,
  type TableLimits,
} from './protocol';

export interface ChipPosition {
  seq: number;
  chips: number;
  atRisk: number;
  wagered: number;
  won: number;
  rounds: number;
}

export interface HostLinkOptions {
  /** The frame the game is running in. Messages from anywhere else are dropped. */
  frame: () => HTMLIFrameElement | null;
  /** Slug we believe is loaded. A game announcing a different one is refused. */
  expect: string;
  /** The game said hello. Reply with `seat` to seat it. */
  onReady: (announced: { game: string; title: string; capabilities: readonly GameCapability[] }) => void;
  /** A settled position. Persist it. */
  onPosition: (position: ChipPosition) => void;
  /** Final count; the table is now empty and the session can be closed. */
  onCashedOut: (position: { seq: number; chips: number }) => void;
  /** The player is broke and wants the cashier. */
  onNeedChips: (shortfall: number) => void;
  /** A round is in flight, or is not. Hold the leave button while true. */
  onBusy: (busy: boolean) => void;
  /** Something for the ticker. */
  onFloorEvent: (event: { kind: FloorEventKind; label: string; amount?: number }) => void;
  /** The player asked to leave from inside the game. */
  onLeave: () => void;
}

export interface HostLink {
  /** Seat the game: this is who you are and what you have. */
  seat: (seating: {
    player: PlayerInfo;
    session: SessionInfo;
    chips: number;
    limits: TableLimits;
    openedAt: number;
    resumed: boolean;
  }) => void;
  /** Chips added mid-session. `total` is what the table holds afterwards. */
  credit: (credit: { chips: number; total: number; reason: string }) => void;
  /** Ask the game to settle up and hand the chips back. */
  requestCashOut: (reason: 'leaving' | 'cashier' | 'closing') => void;
  ack: (seq: number) => void;
  pause: () => void;
  resume: () => void;
  dispose: () => void;
}

/**
 * Whether a message came from the frame we are hosting.
 *
 * `event.source` is the frame's `contentWindow`, and comparing against it is
 * the only check that cannot be spoofed by a page that merely knows our
 * origin: a sibling frame, an opener, or an extension content script all fail
 * it. The origin check is a second gate for the cross-origin deployment,
 * where the games are served from their own host.
 */
function fromFrame(event: MessageEvent, frame: HTMLIFrameElement | null): boolean {
  if (!frame) return false;
  if (event.source === null || event.source !== frame.contentWindow) return false;
  return true;
}

export function createHostLink(options: HostLinkOptions): HostLink {
  /*
   * The window this link belongs to, captured now rather than read at every
   * use — same reason as the client: `dispose` has to remove its listener from
   * the window it added it to, and capturing makes the link drivable by the
   * protocol test that swaps the global.
   */
  const self = window;
  let disposed = false;
  /** Highest sequence applied. Anything at or below it is stale and dropped. */
  let applied = 0;
  /** Set once the game has cashed out, after which it may not move money. */
  let closed = false;

  const send = (body: HostMessage) => {
    if (disposed) return;
    const frame = options.frame();
    const win = frame?.contentWindow;
    if (!win) return;
    try {
      // Same-origin in every shipped configuration; `*` keeps a split-host
      // deployment working. Nothing sent to a game is a secret except the
      // session token, which is scoped to one table session and worth nothing
      // without it.
      win.postMessage(toGame(body), '*');
    } catch {
      // A frame mid-navigation is not an error.
    }
  };

  const onMessage = (event: MessageEvent) => {
    if (disposed) return;
    const frame = options.frame();
    if (!fromFrame(event, frame)) return;
    const msg = readEnvelope<GameMessage>(event, 'to-floor');
    if (!msg) return;

    switch (msg.type) {
      case 'ready':
        /*
         * A frame that announces itself as a different game than the one we
         * pointed it at is either a misconfigured manifest or something we
         * should not be seating. Either way it does not get a session.
         */
        if (msg.game !== options.expect) return;
        options.onReady({ game: msg.game, title: msg.title, capabilities: msg.capabilities });
        break;

      case 'chips': {
        if (closed) return;
        if (!Number.isInteger(msg.seq) || msg.seq <= applied) return;
        if (!plausible(msg.chips) || !plausible(msg.atRisk)) return;
        if (!plausible(msg.wagered) || !plausible(msg.won)) return;
        applied = msg.seq;
        options.onPosition({
          seq: msg.seq,
          chips: msg.chips,
          atRisk: msg.atRisk,
          wagered: msg.wagered,
          won: msg.won,
          rounds: Number.isInteger(msg.rounds) ? msg.rounds : 0,
        });
        break;
      }

      case 'cashed-out': {
        if (closed) return;
        if (!Number.isInteger(msg.seq) || msg.seq <= applied) return;
        if (!plausible(msg.chips)) return;
        applied = msg.seq;
        closed = true;
        options.onCashedOut({ seq: msg.seq, chips: msg.chips });
        break;
      }

      case 'need-chips':
        options.onNeedChips(plausible(msg.shortfall) ? msg.shortfall : 0);
        break;

      case 'busy':
        options.onBusy(msg.busy === true);
        break;

      case 'floor-event':
        if (typeof msg.label !== 'string' || msg.label.length > 120) return;
        options.onFloorEvent({
          kind: msg.kind,
          label: msg.label,
          amount: plausible(msg.amount) ? msg.amount : undefined,
        });
        break;

      case 'leave':
        options.onLeave();
        break;

      case 'pong':
        break;
    }
  };

  self.addEventListener('message', onMessage);

  return {
    seat: (seating) => send({ type: 'hello', ...seating }),
    credit: (credit) => send({ type: 'credit', ...credit }),
    requestCashOut: (reason) => send({ type: 'cash-out', reason }),
    ack: (seq) => send({ type: 'ack', seq }),
    pause: () => send({ type: 'pause' }),
    resume: () => send({ type: 'resume' }),
    dispose: () => {
      disposed = true;
      self.removeEventListener('message', onMessage);
    },
  };
}

/**
 * A number that could be money.
 *
 * The cap is not a table limit — the server owns those — it is a sanity gate
 * against `Infinity`, `NaN` and a float that has drifted off the integer
 * grid, all three of which are bugs rather than balances and all three of
 * which would otherwise reach the ledger.
 */
const MAX_PLAUSIBLE_CENTS = 1_000_000_000_00;

function plausible(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= MAX_PLAUSIBLE_CENTS;
}
