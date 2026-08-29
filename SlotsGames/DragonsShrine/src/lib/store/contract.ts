/**
 * The boundary between the game and everything that draws it.
 *
 * The store is the only thing that knows what is happening; the reels, the
 * cabinet, the feature screens and the effects layer are all pure functions of
 * what is declared here. That is the whole architecture in one sentence, and
 * it is why five people can build those pieces at the same time.
 *
 * Like `engine/types.ts`, this is a published contract: add, never rename.
 */

import type {
  Cell,
  FreeSpinsState,
  GambleChoice,
  GambleResult,
  Grid,
  HistoryEntry,
  HoldState,
  JackpotId,
  Orb,
  SessionStats,
  SpinResult,
  StripSet,
  WinTier,
} from '@/lib/engine/types';
import type { BuyOption } from '@/lib/engine/paytable';

/* ------------------------------------------------------------------ *
 * Where the machine is
 * ------------------------------------------------------------------ */

/**
 * The presentation state machine.
 *
 * Only one of these is true at a time and every screen keys off it. The
 * ordering below is the order a spin passes through them; a spin that wins
 * nothing skips straight from PRESENTING back to IDLE.
 *
 *   IDLE           accepting input
 *   SPINNING       reels in motion, some may already have landed
 *   PRESENTING     wins cycling, meter counting up
 *   TAKEOVER       a big win has the screen
 *   FEATURE_INTRO  the card announcing a feature
 *   FREE_SPINS     inside the shrine; spins run themselves
 *   HOLD           inside the link; respins run themselves
 *   FEATURE_OUTRO  the total card at the end of a feature
 *   GAMBLE         the win is on the cards
 */
export type Phase =
  | 'IDLE'
  | 'SPINNING'
  | 'PRESENTING'
  | 'TAKEOVER'
  | 'FEATURE_INTRO'
  | 'FREE_SPINS'
  | 'HOLD'
  | 'FEATURE_OUTRO'
  | 'GAMBLE';

/** What one reel is doing. The renderer animates the transitions between these. */
export type ReelStatus = 'IDLE' | 'SPINNING' | 'TEASE' | 'LANDED';

/** What the cabinet is currently celebrating, if anything. */
export interface Presentation {
  /** Bumped every time a new thing is presented, so effects can key off it. */
  key: number;
  amount: number;
  tier: WinTier;
  /** How long the meter should take to count there, milliseconds. */
  durationMs: number;
  /** True while this is a free spins total rather than a single spin. */
  cumulative: boolean;
}

/** The line or cluster currently lit on the grid. */
export interface Highlight {
  cells: Cell[];
  /** Index into PAYLINES, or null when the highlight is a scatter or feature. */
  line: number | null;
  /** Cents this particular highlight is worth. */
  amount: number;
}

/* ------------------------------------------------------------------ *
 * Sound
 * ------------------------------------------------------------------ */

/**
 * Every sound the machine can make.
 *
 * Named here rather than in the audio module so that the sequencer can ask for
 * a sound without importing the synthesiser, and so the two can be built in
 * parallel against the same list.
 */
export type SoundName =
  | 'spinStart'
  | 'reelLoop'
  | 'reelStop'
  | 'reelStopTease'
  | 'anticipation'
  | 'symbolLand'
  | 'winTick'
  | 'winSmall'
  | 'winMedium'
  | 'winBig'
  | 'winMega'
  | 'winEpic'
  | 'winLegendary'
  | 'meterCount'
  | 'meterEnd'
  | 'scatterLand'
  | 'orbLand'
  | 'orbLock'
  | 'featureTrigger'
  | 'freeSpinsIntro'
  | 'freeSpinsLoop'
  | 'freeSpinsOutro'
  | 'dragonRoar'
  | 'dragonReel'
  | 'multiplierUp'
  | 'holdIntro'
  | 'holdRespin'
  | 'holdFull'
  | 'jackpotMini'
  | 'jackpotMinor'
  | 'jackpotMajor'
  | 'jackpotGrand'
  | 'gambleFlip'
  | 'gambleWin'
  | 'gambleLose'
  | 'buttonPress'
  | 'buttonToggle'
  | 'betChange'
  | 'error'
  | 'coinDrop'
  | 'gong'
  | 'bellHit';

/* ------------------------------------------------------------------ *
 * Preferences
 * ------------------------------------------------------------------ */

export interface Preferences {
  sound: boolean;
  music: boolean;
  turbo: boolean;
  /** Skip the takeover screens; the meter still counts. */
  quickWins: boolean;
  /** Honour the OS setting; when true the machine drops most motion. */
  reducedMotion: boolean;
  /** Show the payline overlay while wins cycle. */
  showLines: boolean;
  /** Left-handed layout puts the spin button on the other side. */
  leftHanded: boolean;
}

/* ------------------------------------------------------------------ *
 * The store
 * ------------------------------------------------------------------ */

export interface SlotsState {
  /* --- machine --- */
  phase: Phase;
  /** Bumped once per spin. Anything that must reset per spin keys off it. */
  spinToken: number;
  /** The window as currently drawn. Holds the previous board until a new one lands. */
  grid: Grid;
  /** Per-reel animation state, {@link REELS} long. */
  reels: ReelStatus[];
  /** Where each reel is landing this spin. */
  stops: number[];
  /** Which band the reels are showing. */
  strips: StripSet;
  /** The spin the machine is currently resolving, or the last one it resolved. */
  result: SpinResult | null;

  /* --- money --- */
  /** Cents. */
  bankroll: number;
  betIndex: number;
  betPerLine: number;
  totalBet: number;
  /** Cents won by the spin being presented. */
  win: number;
  /** The meter as the player sees it -- counts up, so it lags {@link win}. */
  meter: number;

  /* --- presentation --- */
  presentation: Presentation | null;
  highlight: Highlight | null;
  /** Cells to sit behind a dimming veil while a line is lit. */
  dimmed: Cell[];
  /** Transient banner text, e.g. "DRAGON RAGE". */
  banner: string | null;

  /* --- features --- */
  free: FreeSpinsState | null;
  hold: HoldState | null;
  gamble: { stake: number; step: number; history: GambleResult[] } | null;
  /** Orbs locked on the grid during the link. */
  orbs: Orb[];
  /** Jackpot won this session, latched for the celebration. */
  jackpotWon: JackpotId | null;

  /* --- session --- */
  seed: string;
  stats: SessionStats;
  history: HistoryEntry[];
  autoplay: { left: number; total: number } | null;
  prefs: Preferences;
  /** Set when a spin cannot be paid for. */
  message: string | null;

  /* --- commands --- */
  spin: () => void;
  stopReels: () => void;
  setBetIndex: (index: number) => void;
  betUp: () => void;
  betDown: () => void;
  maxBet: () => void;
  startAutoplay: (count: number) => void;
  stopAutoplay: () => void;
  buyFeature: (option: BuyOption) => void;
  chooseGamble: (choice: GambleChoice) => void;
  collectGamble: () => void;
  /** Skip whatever celebration is on screen and settle it immediately. */
  skip: () => void;
  rebuy: () => void;
  setPref: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
  newSession: (seed?: string) => void;
  dismissMessage: () => void;
}
