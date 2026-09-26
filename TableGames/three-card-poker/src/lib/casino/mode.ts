/**
 * Am I on the casino floor, or am I on my own?
 *
 * GENERATED FILE. The canonical copy lives in `casino/protocol/mode.ts` and is
 * vendored into every game by `casino/tools/sync-protocol.mjs`. Edit the
 * canonical copy and run `pnpm run casino:sync` from the repository root.
 *
 * ------------------------------------------------------------------------
 *
 * This has to be answerable *synchronously, at module load*, before the
 * handshake has had a chance to complete — because the answer decides which
 * localStorage key the game's store persists to, and a store picks that when
 * it is created.
 *
 * Getting that right is what keeps the two modes from contaminating each
 * other. Without it, a casino session's chips would be written into the save
 * a standalone visit reads back, and a player who opened the game's own URL
 * after a night on the floor would find the casino's money in their pocket —
 * or worse, the floor would seat them and the game would briefly show a
 * bankroll nobody had bought. Two keys, no overlap, both modes keep their own
 * preferences and their own history.
 *
 * The detection is deliberately two conditions:
 *
 *   - the page is in a frame, and
 *   - the frame's URL says `?casino=1`
 *
 * Either alone is not enough. Framed-without-the-flag is somebody else
 * embedding the game, which should get the standalone game and no wallet.
 * Flagged-without-a-frame is a URL somebody pasted, and there is no floor on
 * the other end to answer. The handshake still has to succeed on top of both;
 * this only decides which *save file* to open.
 */

/** The query flag the floor adds when it frames a game. */
export const CASINO_FLAG = 'casino';

function framed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return !!window.parent && window.parent !== window;
  } catch {
    // A cross-origin parent throws on access, which is itself a yes.
    return true;
  }
}

function flagged(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get(CASINO_FLAG) === '1';
  } catch {
    return false;
  }
}

/**
 * Read once and cached, because it must give the same answer for the whole
 * life of the page. A game that answered differently on a later call would be
 * a game with two save files open at once.
 */
let cached: boolean | null = null;

export function onCasinoFloor(): boolean {
  if (cached === null) cached = framed() && flagged();
  return cached;
}

/**
 * A persist key for the mode the page is actually in.
 *
 * Call it where the store names its storage:
 *
 *     name: persistKey('knotz-blackjack')
 */
export function persistKey(base: string): string {
  return onCasinoFloor() ? `${base}:floor` : base;
}
