/**
 * The protocol, driven as a protocol.
 *
 * The shell is the only app that holds both ends of the casino link — a game
 * gets the client, the floor gets the host — so this is the only place the two
 * can be pointed at each other and made to move money. That is why the sync
 * tool vendors `client.ts` here even though nothing in the shell runs it: an
 * untested wire format that moves money is worse than one asymmetric
 * dependency the build tree-shakes out.
 *
 * Everything below runs against a pair of fake windows rather than a browser,
 * because every behaviour worth testing here is about *which window a message
 * came from* and *what order messages arrive in*, and neither needs a DOM. What
 * it does need is control of the clock: the client retries its handshake on an
 * interval, coalesces its reports, and gives up on a floor after a deadline.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCasinoClient, type CasinoClient, type SeatedTable } from './client';
import { createHostLink, type ChipPosition, type HostLink } from './host';
import { CASINO_PROTOCOL_VERSION, CASINO_NAMESPACE } from './protocol';

/* ------------------------------------------------------------------ *
 * A pair of windows
 * ------------------------------------------------------------------ */

type Listener = (event: MessageEvent) => void;

/**
 * Enough of a `Window` for two frames to shout at each other.
 *
 * `postMessage` delivers synchronously, which a browser does not — but the only
 * thing the asynchrony buys a test is a `await Promise.resolve()` after every
 * assertion, and none of the ordering this file cares about depends on it. The
 * timers are faked; the delivery is not.
 */
class FakeWindow {
  listeners = new Map<string, Set<Listener>>();
  parent: FakeWindow = this;
  /** Everything this window was told to post, for the assertions to read. */
  sent: Array<{ to: FakeWindow; body: unknown }> = [];

  addEventListener(type: string, fn: Listener) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(fn);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, fn: Listener) {
    this.listeners.get(type)?.delete(fn);
  }

  /** As the *sender*: hand `data` to `target`, stamped with this window. */
  postTo(target: FakeWindow, data: unknown) {
    this.sent.push({ to: target, body: data });
    target.deliver({ data, source: this } as unknown as MessageEvent);
  }

  /** As the *receiver*. */
  deliver(event: MessageEvent) {
    for (const fn of this.listeners.get('message') ?? []) fn(event);
  }

  postMessage(data: unknown) {
    // The client calls `parent.postMessage(...)`, so a window receiving this
    // call is the destination and the sender is whoever holds the reference.
    // The harness rewires this per test; see `wire` below.
    void data;
    throw new Error('postMessage was not wired for this window');
  }
}

interface Harness {
  gameWin: FakeWindow;
  floorWin: FakeWindow;
  frame: { contentWindow: FakeWindow };
}

/**
 * Wire two windows so that the client's `parent.postMessage` lands on the
 * floor's listeners with the game window as the source, and the host's
 * `frame.contentWindow.postMessage` lands on the game's.
 */
function wire(): Harness {
  const gameWin = new FakeWindow();
  const floorWin = new FakeWindow();
  gameWin.parent = floorWin;

  floorWin.postMessage = (data: unknown) => gameWin.postTo(floorWin, data);
  gameWin.postMessage = (data: unknown) => floorWin.postTo(gameWin, data);

  return { gameWin, floorWin, frame: { contentWindow: gameWin } };
}

/** Swap the global `window` while a module reads it at construction time. */
function as<T>(win: FakeWindow, build: () => T): T {
  const previous = (globalThis as { window?: unknown }).window;
  (globalThis as { window?: unknown }).window = win;
  try {
    return build();
  } finally {
    (globalThis as { window?: unknown }).window = previous;
  }
}

/* ------------------------------------------------------------------ *
 * A seated table, ready to play
 * ------------------------------------------------------------------ */

interface Seated {
  harness: Harness;
  client: CasinoClient;
  host: HostLink;
  table: SeatedTable | null;
  positions: ChipPosition[];
  cashedOut: Array<{ seq: number; chips: number }>;
  shortfalls: number[];
  busy: boolean[];
  events: Array<{ kind: string; label: string; amount?: number }>;
  leaves: number[];
  ready: Array<{ game: string; title: string }>;
}

const CHIPS = 100_000;

function sitDown(options: { game?: string; expect?: string; seat?: boolean } = {}): Seated {
  const harness = wire();
  const out: Partial<Seated> & Omit<Seated, 'client' | 'host' | 'harness'> = {
    table: null,
    positions: [],
    cashedOut: [],
    shortfalls: [],
    busy: [],
    events: [],
    leaves: [],
    ready: [],
  };

  const host = as(harness.floorWin, () =>
    createHostLink({
      frame: () => harness.frame as unknown as HTMLIFrameElement,
      expect: options.expect ?? 'craps',
      onReady: (announced) => {
        out.ready.push({ game: announced.game, title: announced.title });
        if (options.seat === false) return;
        host.seat({
          player: { id: 'plr_1', handle: 'Knotz', tier: 'guest' },
          session: { id: 'ses_1', game: announced.game, token: 'session-token' },
          chips: CHIPS,
          limits: { minBet: 500, maxBet: 500_000, denominations: [100, 500, 2_500] },
          openedAt: 1_700_000_000_000,
          resumed: false,
        });
      },
      onPosition: (p) => out.positions.push(p),
      onCashedOut: (p) => out.cashedOut.push(p),
      onNeedChips: (s) => out.shortfalls.push(s),
      onBusy: (b) => out.busy.push(b),
      onFloorEvent: (e) => out.events.push(e),
      onLeave: () => {
        out.leaves.push(1);
      },
    }),
  );

  const client = as(harness.gameWin, () =>
    createCasinoClient({
      game: options.game ?? 'craps',
      title: 'Knotz Craps',
      capabilities: ['chip-sync', 'cash-out', 'events'],
      onSeat: (table) => {
        out.table = table;
      },
    }),
  );

  return { harness, client, host, ...(out as Omit<Seated, 'harness' | 'client' | 'host'>) };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as { window?: unknown }).window;
});

/* ------------------------------------------------------------------ *
 * The handshake
 * ------------------------------------------------------------------ */

describe('the handshake', () => {
  it('seats a game that announces itself', () => {
    const t = sitDown();

    // `ready` goes out on construction, so the floor has already answered.
    expect(t.ready).toEqual([{ game: 'craps', title: 'Knotz Craps' }]);
    expect(t.table).not.toBeNull();
    expect(t.table?.chips).toBe(CHIPS);
    expect(t.table?.player.handle).toBe('Knotz');
    expect(t.table?.session.token).toBe('session-token');
    expect(t.table?.limits.minBet).toBe(500);
    expect(t.client.seated).toBe(true);

    t.client.dispose();
    t.host.dispose();
  });

  it('stops retrying once it is answered', () => {
    const t = sitDown();
    const before = t.harness.gameWin.sent.length;

    // The retry interval is 250ms; a second of silence would be four more.
    vi.advanceTimersByTime(1000);
    expect(t.harness.gameWin.sent.length).toBe(before);

    t.client.dispose();
    t.host.dispose();
  });

  it('keeps saying hello until somebody answers, then gives up and plays alone', () => {
    const standalone = vi.fn();
    const harness = wire();

    // No host at all: a game framed by something that is not a floor.
    const client = as(harness.gameWin, () =>
      createCasinoClient({
        game: 'craps',
        title: 'Knotz Craps',
        capabilities: [],
        onSeat: () => {
          throw new Error('seated with no floor');
        },
        onStandalone: standalone,
      }),
    );

    // One on construction, then one every 250ms until the 4s deadline.
    vi.advanceTimersByTime(1000);
    expect(harness.gameWin.sent.length).toBeGreaterThan(3);
    expect(standalone).not.toHaveBeenCalled();

    vi.advanceTimersByTime(3500);
    expect(standalone).toHaveBeenCalledTimes(1);
    expect(client.seated).toBe(false);

    // And it has stopped shouting.
    const after = harness.gameWin.sent.length;
    vi.advanceTimersByTime(2000);
    expect(harness.gameWin.sent.length).toBe(after);

    client.dispose();
  });

  it('refuses to seat a game that is not the one the floor framed', () => {
    // The floor pointed the frame at craps; the frame says it is blackjack.
    // A mismatched manifest is the benign cause and it is still not seated.
    const t = sitDown({ game: 'blackjack', expect: 'craps' });

    expect(t.ready).toEqual([]);
    expect(t.table).toBeNull();

    t.client.dispose();
    t.host.dispose();
  });

  it('is not seated by a message from another window', () => {
    const t = sitDown({ seat: false });
    const stranger = new FakeWindow();

    // Correct envelope, correct direction, correct slug — wrong source. This is
    // the check that cannot be spoofed by a page that merely knows our origin.
    t.harness.floorWin.deliver({
      data: {
        ns: CASINO_NAMESPACE,
        v: CASINO_PROTOCOL_VERSION,
        dir: 'to-floor',
        body: { type: 'chips', seq: 1, chips: 9_999_999, atRisk: 0, wagered: 0, won: 0, rounds: 1 },
      },
      source: stranger,
    } as unknown as MessageEvent);

    expect(t.positions).toEqual([]);

    t.client.dispose();
    t.host.dispose();
  });

  it('ignores traffic that is not ours, and its own echo', () => {
    const t = sitDown();
    const noise: unknown[] = [
      null,
      'a string',
      { ns: 'someone-else', v: 1, dir: 'to-floor', body: { type: 'chips', seq: 9, chips: 1 } },
      { ns: CASINO_NAMESPACE, v: 99, dir: 'to-floor', body: { type: 'chips', seq: 9, chips: 1 } },
      // The floor's own outbound message, echoed back at it. The direction
      // field is what stops a window that both sends and listens reacting to
      // itself.
      { ns: CASINO_NAMESPACE, v: CASINO_PROTOCOL_VERSION, dir: 'to-game', body: { type: 'ack', seq: 1 } },
      { ns: CASINO_NAMESPACE, v: CASINO_PROTOCOL_VERSION, dir: 'to-floor', body: null },
    ];

    for (const data of noise) {
      t.harness.floorWin.deliver({ data, source: t.harness.gameWin } as unknown as MessageEvent);
    }

    expect(t.positions).toEqual([]);
    expect(t.cashedOut).toEqual([]);

    t.client.dispose();
    t.host.dispose();
  });
});

/* ------------------------------------------------------------------ *
 * Reporting a position
 * ------------------------------------------------------------------ */

describe('the chip position', () => {
  it('reaches the floor, with the rack and the exposure kept apart', () => {
    const t = sitDown();

    t.client.report({ chips: 112_000, atRisk: 2_000, wagered: 8_000, won: 20_000, rounds: 4 });
    vi.advanceTimersByTime(200);

    expect(t.positions).toHaveLength(1);
    expect(t.positions[0]).toMatchObject({
      seq: 1,
      chips: 112_000,
      atRisk: 2_000,
      wagered: 8_000,
      won: 20_000,
      rounds: 4,
    });

    t.client.dispose();
    t.host.dispose();
  });

  it('coalesces a burst into the one position that is still true', () => {
    const t = sitDown();

    // A slot in turbo. Four settlements inside the coalescing window.
    t.client.report({ chips: 101_000, atRisk: 0, wagered: 1_000, won: 2_000, rounds: 1 });
    t.client.report({ chips: 102_000, atRisk: 0, wagered: 2_000, won: 4_000, rounds: 2 });
    t.client.report({ chips: 103_000, atRisk: 0, wagered: 3_000, won: 6_000, rounds: 3 });
    t.client.report({ chips: 104_500, atRisk: 0, wagered: 4_000, won: 9_500, rounds: 4 });
    expect(t.positions).toEqual([]);

    vi.advanceTimersByTime(200);

    expect(t.positions).toHaveLength(1);
    expect(t.positions[0].chips).toBe(104_500);
    // The sequence is the fourth report's, not the first's: the floor's
    // staleness guard has to see the position it actually received.
    expect(t.positions[0].seq).toBe(4);

    t.client.dispose();
    t.host.dispose();
  });

  it('sends a broke position immediately, without waiting', () => {
    const t = sitDown();

    t.client.report({ chips: 0, atRisk: 0, wagered: CHIPS, won: 0, rounds: 40 });

    // No timer advanced. "You are out of chips" is the one position that cannot
    // wait: 120ms of ambiguity there reads as the game being broken.
    expect(t.positions).toHaveLength(1);
    expect(t.positions[0].chips).toBe(0);

    t.client.dispose();
    t.host.dispose();
  });

  it('drops a position that is older than one already applied', () => {
    const t = sitDown();
    const post = (body: unknown) =>
      t.harness.floorWin.deliver({
        data: { ns: CASINO_NAMESPACE, v: CASINO_PROTOCOL_VERSION, dir: 'to-floor', body },
        source: t.harness.gameWin,
      } as unknown as MessageEvent);

    post({ type: 'chips', seq: 5, chips: 150_000, atRisk: 0, wagered: 10, won: 20, rounds: 5 });
    post({ type: 'chips', seq: 3, chips: 10, atRisk: 0, wagered: 1, won: 0, rounds: 1 });
    post({ type: 'chips', seq: 5, chips: 1, atRisk: 0, wagered: 1, won: 0, rounds: 1 });
    post({ type: 'chips', seq: 6, chips: 151_000, atRisk: 0, wagered: 11, won: 21, rounds: 6 });

    expect(t.positions.map((p) => p.seq)).toEqual([5, 6]);
    expect(t.positions.map((p) => p.chips)).toEqual([150_000, 151_000]);

    t.client.dispose();
    t.host.dispose();
  });

  it('drops a figure that could not be money', () => {
    const t = sitDown();
    let seq = 10;
    const post = (chips: unknown) => {
      seq += 1;
      t.harness.floorWin.deliver({
        data: {
          ns: CASINO_NAMESPACE,
          v: CASINO_PROTOCOL_VERSION,
          dir: 'to-floor',
          body: { type: 'chips', seq, chips, atRisk: 0, wagered: 0, won: 0, rounds: 1 },
        },
        source: t.harness.gameWin,
      } as unknown as MessageEvent);
    };

    // Every one of these is a bug rather than a balance, and the ledger is the
    // last place any of them should turn up.
    post(Number.NaN);
    post(Number.POSITIVE_INFINITY);
    post(-1);
    post(1.5);
    post('100000');
    post(null);
    post(1e18);

    expect(t.positions).toEqual([]);

    // ...and a real one still gets through afterwards.
    post(120_000);
    expect(t.positions).toHaveLength(1);

    t.client.dispose();
    t.host.dispose();
  });
});

/* ------------------------------------------------------------------ *
 * Cashing out
 * ------------------------------------------------------------------ */

describe('cashing out', () => {
  it('asks the game to settle up and takes its final count', () => {
    const t = sitDown();
    const asked: string[] = [];

    // Re-create the client with a cash-out handler, since the harness's default
    // has none: this is the game's half of the contract.
    t.client.dispose();
    const client = as(t.harness.gameWin, () =>
      createCasinoClient({
        game: 'craps',
        title: 'Knotz Craps',
        capabilities: ['cash-out'],
        onSeat: () => {},
        onCashOutRequest: (reason) => {
          asked.push(reason);
          client.cashedOut(137_500);
        },
      }),
    );

    t.host.requestCashOut('leaving');

    expect(asked).toEqual(['leaving']);
    expect(t.cashedOut).toEqual([{ seq: 1, chips: 137_500 }]);

    client.dispose();
    t.host.dispose();
  });

  it('flushes an unsent position before it settles', () => {
    const t = sitDown();
    const client = t.client;

    // A win landed inside the coalescing window, then the player left. The
    // pending position must go out *before* the final count, so the floor's
    // staleness guard does not drop the newer figure behind an older sequence.
    client.report({ chips: 140_000, atRisk: 0, wagered: 5_000, won: 45_000, rounds: 7 });
    client.cashedOut(140_000);

    expect(t.positions.map((p) => p.seq)).toEqual([1]);
    expect(t.cashedOut).toEqual([{ seq: 2, chips: 140_000 }]);

    client.dispose();
    t.host.dispose();
  });

  it('will not report or pay twice after it has settled', () => {
    const t = sitDown();

    t.client.cashedOut(90_000);
    t.client.cashedOut(9_999_999);
    t.client.report({ chips: 9_999_999, atRisk: 0, wagered: 0, won: 0, rounds: 99 });
    vi.advanceTimersByTime(500);

    expect(t.cashedOut).toEqual([{ seq: 1, chips: 90_000 }]);
    expect(t.positions).toEqual([]);

    t.client.dispose();
    t.host.dispose();
  });

  it('ignores a position that arrives after the table closed', () => {
    const t = sitDown();
    const post = (body: unknown) =>
      t.harness.floorWin.deliver({
        data: { ns: CASINO_NAMESPACE, v: CASINO_PROTOCOL_VERSION, dir: 'to-floor', body },
        source: t.harness.gameWin,
      } as unknown as MessageEvent);

    post({ type: 'cashed-out', seq: 4, chips: 80_000 });
    // A frame that has not noticed it is finished. The cage has already paid.
    post({ type: 'chips', seq: 5, chips: 500_000, atRisk: 0, wagered: 0, won: 0, rounds: 9 });
    post({ type: 'cashed-out', seq: 6, chips: 500_000 });

    expect(t.cashedOut).toEqual([{ seq: 4, chips: 80_000 }]);
    expect(t.positions).toEqual([]);

    t.client.dispose();
    t.host.dispose();
  });
});

/* ------------------------------------------------------------------ *
 * Everything else on the wire
 * ------------------------------------------------------------------ */

describe('the rest of the link', () => {
  it('carries a top-up back to the game as an authoritative total', () => {
    const credits: Array<{ chips: number; total: number; reason: string }> = [];
    const harness = wire();

    const host = as(harness.floorWin, () =>
      createHostLink({
        frame: () => harness.frame as unknown as HTMLIFrameElement,
        expect: 'craps',
        onReady: () =>
          host.seat({
            player: { id: 'p', handle: 'K', tier: 'guest' },
            session: { id: 's', game: 'craps', token: 't' },
            chips: CHIPS,
            limits: { minBet: 500, maxBet: 1_000, denominations: [100] },
            openedAt: 0,
            resumed: false,
          }),
        onPosition: () => {},
        onCashedOut: () => {},
        onNeedChips: () => {},
        onBusy: () => {},
        onFloorEvent: () => {},
        onLeave: () => {},
      }),
    );

    const client = as(harness.gameWin, () =>
      createCasinoClient({
        game: 'craps',
        title: 'Knotz Craps',
        capabilities: ['top-up'],
        onSeat: () => {},
        onCredit: (credit) => credits.push(credit),
      }),
    );

    host.credit({ chips: 50_000, total: 150_000, reason: 'cashier' });

    expect(credits).toEqual([{ chips: 50_000, total: 150_000, reason: 'cashier' }]);
    // The client's own view of the table follows the total, not the delta: the
    // floor is the authority and the delta is only there to be announced.
    expect(client.table?.chips).toBe(150_000);

    client.dispose();
    host.dispose();
  });

  it('passes the busy signal, the cashier request and the leave button', () => {
    const t = sitDown();

    t.client.setBusy(true);
    t.client.setBusy(false);
    t.client.needChips(25_000);
    t.client.leave();

    expect(t.busy).toEqual([true, false]);
    expect(t.shortfalls).toEqual([25_000]);
    expect(t.leaves).toEqual([1]);

    t.client.dispose();
    t.host.dispose();
  });

  it('puts a win on the ticker, and refuses a label that is not one', () => {
    const t = sitDown();

    t.client.announce('jackpot', 'took the GRAND on Dragon’s Shrine', 5_000_000);
    t.client.announce('big-win', 'x'.repeat(500), 1_000);
    t.client.announce('feature', 'woke the shrine');

    expect(t.events).toEqual([
      { kind: 'jackpot', label: 'took the GRAND on Dragon’s Shrine', amount: 5_000_000 },
      { kind: 'feature', label: 'woke the shrine', amount: undefined },
    ]);

    t.client.dispose();
    t.host.dispose();
  });

  it('answers a ping, so a floor can tell a live frame from a hung one', () => {
    const t = sitDown();
    const before = t.harness.gameWin.sent.length;

    t.harness.gameWin.deliver({
      data: {
        ns: CASINO_NAMESPACE,
        v: CASINO_PROTOCOL_VERSION,
        dir: 'to-game',
        body: { type: 'ping', at: 42 },
      },
    } as unknown as MessageEvent);

    const sent = t.harness.gameWin.sent.slice(before);
    expect(sent).toHaveLength(1);
    expect((sent[0].body as { body: { type: string; at: number } }).body).toEqual({
      type: 'pong',
      at: 42,
    });

    t.client.dispose();
    t.host.dispose();
  });

  it('goes quiet when it is disposed', () => {
    const t = sitDown();

    t.client.dispose();
    t.client.report({ chips: 1, atRisk: 0, wagered: 0, won: 0, rounds: 1 });
    vi.advanceTimersByTime(500);

    expect(t.positions).toEqual([]);

    t.host.dispose();
  });

  it('takes a resumed table, and says so', () => {
    const harness = wire();
    let table: SeatedTable | null = null;

    const host = as(harness.floorWin, () =>
      createHostLink({
        frame: () => harness.frame as unknown as HTMLIFrameElement,
        expect: 'blackjack',
        onReady: () =>
          host.seat({
            player: { id: 'p', handle: 'K', tier: 'member' },
            session: { id: 's', game: 'blackjack', token: 't' },
            chips: 260_000,
            limits: { minBet: 500, maxBet: 250_000, denominations: [500] },
            openedAt: 1_700_000_000_000,
            resumed: true,
          }),
        onPosition: () => {},
        onCashedOut: () => {},
        onNeedChips: () => {},
        onBusy: () => {},
        onFloorEvent: () => {},
        onLeave: () => {},
      }),
    );

    const client = as(harness.gameWin, () =>
      createCasinoClient({
        game: 'blackjack',
        title: 'Knotz Blackjack 21',
        capabilities: ['chip-sync'],
        onSeat: (t) => {
          table = t;
        },
      }),
    );

    // The chips that were on the table are the chips it opens with — which is
    // the whole point of the session model.
    expect(table).not.toBeNull();
    expect(table!.chips).toBe(260_000);
    expect(table!.resumed).toBe(true);
    expect(table!.player.tier).toBe('member');

    client.dispose();
    host.dispose();
  });
});
