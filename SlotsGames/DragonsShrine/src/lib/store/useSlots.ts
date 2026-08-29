'use client';

/**
 * STUB -- owned by the store workstream, which replaces this file wholesale.
 *
 * Everything that draws the machine selects off `useSlots`, so this inert
 * version exists to let those screens be built and typechecked before the
 * sequencer lands. It satisfies {@link SlotsState} and does nothing.
 */

import { create } from 'zustand';
import { DEFAULT_BET_INDEX, betPerLineAt, totalBetAt } from '@/lib/engine/config';
import { REELS, ROWS, type Grid, type SymbolId } from '@/lib/engine/types';
import type { SlotsState } from './contract';

const FILLER: SymbolId[] = ['COIN', 'LOTUS', 'FAN', 'LANTERN', 'KOI', 'TURTLE', 'TIGER'];

function placeholderGrid(): Grid {
  return Array.from({ length: REELS }, (_, r) =>
    Array.from({ length: ROWS }, (_, c) => FILLER[(r * ROWS + c) % FILLER.length]),
  );
}

export const useSlots = create<SlotsState>(() => ({
  phase: 'IDLE',
  spinToken: 0,
  grid: placeholderGrid(),
  reels: new Array(REELS).fill('IDLE'),
  stops: new Array(REELS).fill(0),
  strips: 'BASE',
  result: null,

  bankroll: 200_000,
  betIndex: DEFAULT_BET_INDEX,
  betPerLine: betPerLineAt(DEFAULT_BET_INDEX),
  totalBet: totalBetAt(DEFAULT_BET_INDEX),
  win: 0,
  meter: 0,

  presentation: null,
  highlight: null,
  dimmed: [],
  banner: null,

  free: null,
  hold: null,
  gamble: null,
  orbs: [],
  jackpotWon: null,

  seed: 'stub',
  stats: {
    spins: 0,
    freeSpins: 0,
    wagered: 0,
    won: 0,
    biggestWin: 0,
    dryStreak: 0,
    longestDryStreak: 0,
    featureTriggers: { FREE_SPINS: 0, HOLD_AND_WIN: 0 },
    jackpots: { MINI: 0, MINOR: 0, MAJOR: 0, GRAND: 0 },
    peak: 200_000,
  },
  history: [],
  autoplay: null,
  prefs: {
    sound: true,
    music: true,
    turbo: false,
    quickWins: false,
    reducedMotion: false,
    showLines: true,
    leftHanded: false,
  },
  message: null,

  spin: () => {},
  stopReels: () => {},
  setBetIndex: () => {},
  betUp: () => {},
  betDown: () => {},
  maxBet: () => {},
  startAutoplay: () => {},
  stopAutoplay: () => {},
  buyFeature: () => {},
  chooseGamble: () => {},
  collectGamble: () => {},
  skip: () => {},
  rebuy: () => {},
  setPref: () => {},
  newSession: () => {},
  dismissMessage: () => {},
}));
