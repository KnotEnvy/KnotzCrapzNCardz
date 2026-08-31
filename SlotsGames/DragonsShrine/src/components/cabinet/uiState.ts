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

export type DialogId = 'paytable' | 'settings' | 'session' | 'autoplay';

interface UiState {
  dialog: DialogId | null;
  open: (id: DialogId) => void;
  close: () => void;
  toggle: (id: DialogId) => void;
}

export const useCabinetUi = create<UiState>((set) => ({
  dialog: null,
  open: (id) => set({ dialog: id }),
  close: () => set({ dialog: null }),
  toggle: (id) => set((s) => ({ dialog: s.dialog === id ? null : id })),
}));
