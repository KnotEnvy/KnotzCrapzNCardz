/**
 * GENERATED FILE. The canonical copy lives in `casino/protocol/mode.test.ts`
 * and is vendored into every app by `casino/tools/sync-protocol.mjs`.
 *
 * ------------------------------------------------------------------------
 *
 * One question, asked in the one environment where getting it wrong is silent:
 * outside a browser.
 *
 * `persistKey` is called at module scope by every game's store, which means it
 * runs in the node test runner and during the static export's prerender. If it
 * ever answered "casino" there — or threw reaching for `window` — the failure
 * would not be a red test in this file, it would be a store that persists to
 * the wrong key in one of the two modes, which is the kind of bug that only
 * shows up as somebody's bankroll appearing in the wrong place a week later.
 *
 * So this is deliberately a boring test of a boring function, and it is
 * vendored alongside the function so that every app runs it.
 */

import { describe, expect, it } from 'vitest';
import { onCasinoFloor, persistKey, CASINO_FLAG } from './mode';

describe('casino mode, outside a browser', () => {
  it('is not on the floor', () => {
    // No `window`: not framed, not flagged, and no exception on the way to
    // finding that out.
    expect(onCasinoFloor()).toBe(false);
  });

  it('leaves the persist key alone', () => {
    expect(persistKey('knotz-anything')).toBe('knotz-anything');
  });

  it('gives the same answer every time it is asked', () => {
    // The answer is cached precisely so that it cannot change under a running
    // page. Two save files open at once is the failure this prevents.
    expect(onCasinoFloor()).toBe(onCasinoFloor());
    expect(persistKey('k')).toBe(persistKey('k'));
  });

  it('names the flag the floor actually appends', () => {
    // The shell builds `?casino=1` into every game frame's src. If this name
    // and the shell's disagree, every game silently runs in standalone mode
    // inside the casino — playable, and funded by nothing.
    expect(CASINO_FLAG).toBe('casino');
  });
});
