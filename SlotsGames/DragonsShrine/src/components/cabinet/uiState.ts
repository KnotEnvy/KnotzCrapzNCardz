'use client';

/**
 * Which pane of glass is open.
 *
 * Dialog visibility is not game state -- the store has no business knowing
 * that someone is reading the paytable -- but it is not local state either,
 * because the button that opens the paytable lives in the control deck and the
 * paytable itself lives in `Dialogs`, and `page.tsx` assembles the two as
 * siblings with no props between them. So it gets its own tiny store: the
 * smallest thing that is honest about the shape of the problem.
 *
 * The control deck also reads `dialog` to decide whether to listen for
 * keyboard shortcuts at all. A player typing a seed into the settings dialog
 * must not spin the reels with the space bar.
 */

import { create } from 'zustand';

import type { JackpotId } from '@/lib/engine/types';

/**
 * The four jackpot colours, as CSS variables declared in globals.css.
 *
 * Here rather than in any one screen because three of them quote the ladder --
 * the ladder itself, the paytable and the attract screen -- and a MINOR that is
 * a different blue on the start page than it is on the glass reads as two
 * different prizes.
 */
export const JACKPOT_COLOR: Record<JackpotId, string> = {
  MINI: 'var(--jackpot-mini)',
  MINOR: 'var(--jackpot-minor)',
  MAJOR: 'var(--jackpot-major)',
  GRAND: 'var(--jackpot-grand)',
};

export type DialogId = 'paytable' | 'settings' | 'session' | 'autoplay';

interface UiState {
  dialog: DialogId | null;
  open: (id: DialogId) => void;
  close: () => void;
  toggle: (id: DialogId) => void;

  /**
   * Whether the player has come through the attract screen.
   *
   * Deliberately not persisted, and deliberately not in the game store. Not
   * persisted because attract mode is where a cabinet sits when nobody is
   * playing it, and a returning player is nobody until they touch it again --
   * every load should open on the marquee. Not in the game store because
   * nothing about it is game state: no money moves, no seed is drawn, and a
   * spin that happened before a reload is not un-happened by seeing the title
   * again.
   *
   * It also does one thing that is not cosmetic at all. Browsers will not start
   * an AudioContext without a gesture, and until this screen existed the first
   * gesture might have been the spin button itself -- which meant the machine's
   * own opening sound was the one most likely to be missed. Pressing PLAY is
   * now guaranteed to happen first.
   */
  started: boolean;
  start: () => void;
}

export const useCabinetUi = create<UiState>((set) => ({
  dialog: null,
  open: (id) => set({ dialog: id }),
  close: () => set({ dialog: null }),
  toggle: (id) => set((s) => ({ dialog: s.dialog === id ? null : id })),

  started: false,
  start: () => set({ started: true, dialog: null }),
}));
