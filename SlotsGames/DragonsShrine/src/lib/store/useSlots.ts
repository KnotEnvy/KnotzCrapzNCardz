'use client';

/**
 * The single store the cabinet talks to, and the sequencer that drives it.
 *
 * Everything the player sees is a pure function of what is in here, and
 * everything in here arrives one of two ways: the engine computed it, or the
 * sequencer scheduled it. The store itself decides nothing about money. It
 * debits a stake, hands the engine an RNG and a stake, and credits back
 * exactly the number that came out. There is no arithmetic in this file that
 * invents a payout, and there must never be one -- a store that can compute a
 * win is a store that can compute a *wrong* win, and the only defence against
 * that is not giving it the ability.
 *
 * What the store does own is time. A spin resolves in a microsecond and is
 * experienced over four seconds, and every one of those seconds is a decision:
 * which reel lands when, which one hesitates because the third pearl is live,
 * how long a meter climbs, when the free spins card gives way to the first
 * free spin. That choreography lives in `sequence.ts` as cancellable
 * timelines; this file is the script those timelines read from.
 *
 * Three rules run through the whole thing and are worth stating once.
 *
 * **Money is integer cents, always.** Every amount that enters the bankroll
 * comes from a `SpinResult`, a `HoldState`, or a `GambleResult`. The store
 * adds and subtracts them; it never multiplies, never divides, never rounds.
 *
 * **Nothing about a spin in flight is persisted.** The saved session is
 * bankroll, stake, preferences, statistics and the history strip -- five
 * inert values. A phase is not saved, a result is not saved, a half-played
 * free spins run is not saved. The alternative is a refresh in the middle of a
 * feature resuming into a machine that thinks it is mid-respin with no
 * timeline running, which is a permanently stuck cabinet holding the player's
 * money. Dropping the feature is a worse outcome for one player once; keeping
 * it is a worse outcome for every player who ever reloads.
 *
 * **Every timer is owned.** Nothing here calls `setTimeout` directly. Every
 * scheduled beat belongs to a timeline that can be killed in one call and is
 * guarded by a generation counter, so a timer belonging to spin 41 can never
 * write state belonging to spin 42. See {@link TimelineOptions.alive} in
 * `sequence.ts`; that comment is the most important one in the store.
 */

import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

import {
  AUTOPLAY_GAP,
  BET_LADDER,
  DEFAULT_BET_INDEX,
  REBUY_AMOUNT,
  STARTING_BANKROLL,
  TAKEOVER_FROM,
  TIER_COUNT_MS,
  TIMING,
  betPerLineAt,
  totalBetAt,
  winTier,
} from '@/lib/engine/config';
import { GAMBLE_MAX_STEPS, type BuyOption } from '@/lib/engine/paytable';
import { STRIPS } from '@/lib/engine/strips';
import {
  REELS,
  ROWS,
  WIN_TIERS,
  type Cell,
  type FeatureTrigger,
  type GambleChoice,
  type Grid,
  type HistoryEntry,
  type JackpotId,
  type SessionStats,
  type SpinResult,
  type Stake,
  type WinTier,
} from '@/lib/engine/types';
import { createRng, randomSeed, type Rng } from '@/lib/engine/rng';
import {
  playSound,
  setMusicEnabled,
  setSoundEnabled,
  startMusic,
  stopLoop,
  stopMusic,
  unlockAudio,
} from '@/lib/audio';

import type { Highlight, Preferences, SlotsState, SoundName } from './contract';
import { beatMs, countUp, timeline, type Beat, type CountUp, type Tempo, type Timeline } from './sequence';

/* ------------------------------------------------------------------ *
 * The engine seam
 *
 * Six modules, all of them pure. They are imported once here and called
 * through the thin wrappers below rather than scattered through the
 * lifecycle, so that the whole surface the store depends on is visible in one
 * screen -- and so that if a signature moves, exactly one block changes.
 * ------------------------------------------------------------------ */

import { spin as engineSpin, type SpinContext } from '@/lib/engine/spin';
import { applyFreeSpin, startFreeSpins, trailMultiplier } from '@/lib/engine/features';
import { finishHold, holdRespin, startHold } from '@/lib/engine/holdwin';
import { canGamble as engineCanGamble, gamble as engineGamble } from '@/lib/engine/gamble';
import { buyCost, buyForce } from '@/lib/engine/buy';

/** What a feature buy forces onto the reels. Named from the engine, never guessed at. */
type BuyForce = ReturnType<typeof buyForce>;

/* ------------------------------------------------------------------ *
 * Local constants
 *
 * Things that are decisions about the *store* rather than about the game, and
 * so do not belong in the frozen config the other four lanes compile against.
 * ------------------------------------------------------------------ */

/**
 * The saved-session key and its version.
 *
 * The version is bumped whenever the persisted shape changes. A mismatch is
 * discarded rather than migrated: a half-understood old save is worse than a
 * fresh cabinet, and the only thing a player actually loses is a bankroll the
 * machine will hand straight back through the rebuy button.
 */
const PERSIST_KEY = 'knotz-dragons-shrine-session';
const PERSIST_VERSION = 1;

/** How many spins the history strip remembers. Beyond this nobody is looking. */
const HISTORY_LIMIT = 40;

/**
 * The win that interrupts an autoplay run.
 *
 * Autoplay exists so a player can watch rather than press, and the one thing it
 * must not do is spin straight past the moment they were watching for. A BIG
 * (15x) hit is where the machine stops and hands control back.
 */
const AUTOPLAY_PAUSE_TIER: WinTier = 'BIG';

/** Gap between one orb's lock and the next during the hold-and-win intro. */
const ORB_LOCK_STAGGER_MS = 90;

/** Roughly one audible meter tick per this many milliseconds of count-up. */
const METER_TICK_MS = 130;

/** The fanfare each tier gets. NONE is silence, which is a decision, not an omission. */
const TIER_SOUND: Record<WinTier, SoundName | null> = {
  NONE: null,
  SMALL: 'winSmall',
  MEDIUM: 'winMedium',
  BIG: 'winBig',
  MEGA: 'winMega',
  EPIC: 'winEpic',
  LEGENDARY: 'winLegendary',
};

const JACKPOT_SOUND: Record<JackpotId, SoundName> = {
  MINI: 'jackpotMini',
  MINOR: 'jackpotMinor',
  MAJOR: 'jackpotMajor',
  GRAND: 'jackpotGrand',
};

/** Is `tier` at least as loud as `floor`? */
function tierAtLeast(tier: WinTier, floor: WinTier): boolean {
  return WIN_TIERS.indexOf(tier) >= WIN_TIERS.indexOf(floor);
}

/* ------------------------------------------------------------------ *
 * Runtime that is not state
 *
 * The RNG is a stream, the timelines are machinery, and the generation counter
 * is a guard. None of them are values a screen selects on, so none of them
 * belong in the store: putting them there would re-render the whole cabinet
 * every time a timer was rescheduled.
 * ------------------------------------------------------------------ */

/**
 * The seed this session is playing on, and the stream it drives.
 *
 * One seed, named once. An earlier draft drew `randomSeed()` separately for the
 * RNG and for `state.seed`, which meant the seed printed on the glass was not
 * the seed the reels were actually running -- a session that could not be
 * replayed from the only number it showed you. The RNG lives outside the store
 * because it is a stream, not a value: putting it in state would re-render the
 * cabinet on every draw.
 */
let sessionSeed = randomSeed();
let rng: Rng = createRng(sessionSeed);

/**
 * The generation guard.
 *
 * Bumped by {@link cancelSequence} -- that is, by every slam stop, every skip,
 * every new session, every autoplay stop and the start of every spin. Every
 * timeline and every count-up captures the value that was current when it was
 * built and refuses to write once it has moved on.
 *
 * This is belt *and* braces with cancellation, and both are needed. Cancelling
 * clears pending host timers, which stops almost everything; the guard stops
 * the rest -- a callback already dequeued by the browser, a step whose own body
 * started the next spin, a `requestAnimationFrame` that fired between the
 * cancel and the clear. Without the guard, the failure is reel 3 of the last
 * spin landing on top of this one, or a stale meter dragging a banked figure
 * back down. It happens once in ten thousand spins and never in a test.
 */
let generation = 0;

/** A guard closure for the generation current at the moment it is taken. */
function guard(): () => boolean {
  const mine = generation;
  return () => mine === generation;
}

/** The timeline currently playing, if any. Replaced, never stacked. */
let current: Timeline | null = null;
/** The meter climb currently running, if any. */
let meter: CountUp | null = null;
/** The pause between autoplay spins. The only timer outside a timeline, and it is owned. */
let autoTimer: ReturnType<typeof setTimeout> | null = null;

/** Monotonic ids, so React keys never collide across a session. */
let historySeq = 0;
let presentationSeq = 0;
let cardSeq = 0;

/**
 * Every jackpot this feature has already shouted about.
 *
 * A multiset, not a set: two MINI orbs on one board are two MINI jackpots and
 * both are owed a celebration and a line in the session stats. It exists
 * because the engine names a jackpot twice -- once when the orb carrying it
 * lands, and again in `finishHold`'s final list -- and the player must hear it
 * exactly once. Reset when the link starts.
 */
let announcedJackpots: JackpotId[] = [];

/**
 * True while the feature about to start was bought rather than triggered.
 *
 * A one-spin flag rather than a store field: it is set by `buyFeature`, read
 * by whichever feature the forced spin lights, and cleared immediately. It
 * exists because `SpinResult` quite rightly has no idea how its trigger was
 * paid for.
 */
let boughtPending = false;

/**
 * Whether the audio context has been woken yet.
 *
 * Browsers will not start an AudioContext without a user gesture, and the
 * first gesture this cabinet ever gets is a press of spin, autoplay or buy.
 * Calling `unlockAudio` anywhere else is either too early to work or too late
 * to matter, so it is hung off exactly those three and the flag stops the
 * base-game music being restarted on every subsequent press.
 */
let audioStarted = false;

/** Wake the audio bus on a real gesture, and bring the base music up with it. */
function wakeAudio(): void {
  if (audioStarted) return;
  audioStarted = true;
  unlockAudio();
  startMusic('base');
}

/**
 * Stop everything in flight and move the world on by one generation.
 *
 * One call, because that is the whole point: a slam stop, a skip, a new
 * session and a browser tab going to sleep all need to unwind the same way and
 * none of them can afford to remember which of six timers might be live.
 */
function cancelSequence() {
  generation++;
  current?.cancel();
  current = null;
  meter?.cancel();
  meter = null;
  if (autoTimer !== null) {
    clearTimeout(autoTimer);
    autoTimer = null;
  }
}

/** Start a timeline as the current one, clearing the pointer when it ends honestly. */
function play(build: (tl: Timeline) => void): Timeline {
  const alive = guard();
  const tl = timeline({
    alive,
    onDone: () => {
      // A step is allowed to start the next timeline before this one finishes
      // -- a slam stop does exactly that, by running the landing steps and the
      // "now present the win" step in the same tick. Only clear the pointer if
      // it still refers to this timeline.
      if (current === tl) current = null;
    },
  });
  build(tl);
  current = tl;
  tl.start();
  return tl;
}

/* ------------------------------------------------------------------ *
 * Tempo
 * ------------------------------------------------------------------ */

function tempoNow(): Tempo {
  const { turbo, reducedMotion } = useSlots.getState().prefs;
  return { turbo, reducedMotion };
}

/** The designed duration `base`, as this player's preferences actually get it. */
function ms(base: number, kind: Beat): number {
  return beatMs(base, kind, tempoNow());
}

/* ------------------------------------------------------------------ *
 * Small pure helpers
 * ------------------------------------------------------------------ */

/** A believable idle board, drawn from the real base strips rather than invented. */
function openingGrid(seed: string): Grid {
  const r = createRng(`${seed}:idle`);
  return STRIPS.BASE.map((strip) => {
    const at = r.int(strip.length);
    return Array.from({ length: ROWS }, (_, row) => strip[(at + row) % strip.length]);
  });
}

/** Every cell that is *not* in `cells`, which is what the dimming veil covers. */
function dimmedFor(cells: readonly Cell[]): Cell[] {
  const lit = new Set(cells.map((c) => c.reel * ROWS + c.row));
  const out: Cell[] = [];
  for (let reel = 0; reel < REELS; reel++) {
    for (let row = 0; row < ROWS; row++) {
      if (!lit.has(reel * ROWS + row)) out.push({ reel, row });
    }
  }
  return out;
}

/**
 * The wins a spin should cycle through, best first.
 *
 * Line amounts come out of the engine *before* the feature multiplier, because
 * that is the honest per-line figure. The glass shows the multiplied one, so
 * that the amounts a player adds up across the cycle sum to the total they were
 * actually paid. Multiplying here is the one place the store touches a win, and
 * it is display only -- the credited figure is always `result.totalWin`.
 */
function highlightsOf(result: SpinResult): Highlight[] {
  const mult = result.multiplier || 1;
  const out: Highlight[] = result.lineWins.map((w) => ({
    cells: w.cells,
    line: w.line,
    amount: w.amount * mult,
  }));
  if (result.scatter && result.scatter.amount > 0) {
    out.push({ cells: result.scatter.cells, line: null, amount: result.scatter.amount * mult });
  }
  out.sort((a, b) => b.amount - a.amount);
  return out;
}

function emptyStats(bankroll: number): SessionStats {
  return {
    spins: 0,
    freeSpins: 0,
    wagered: 0,
    won: 0,
    biggestWin: 0,
    dryStreak: 0,
    longestDryStreak: 0,
    featureTriggers: { FREE_SPINS: 0, HOLD_AND_WIN: 0 },
    jackpots: { MINI: 0, MINOR: 0, MAJOR: 0, GRAND: 0 },
    peak: bankroll,
  };
}

const DEFAULT_PREFS: Preferences = {
  sound: true,
  music: true,
  turbo: false,
  quickWins: false,
  reducedMotion: false,
  showLines: true,
  leftHanded: false,
};

/**
 * What the OS thinks about animation.
 *
 * Read once at session start and then watched, because a player who turns the
 * setting on mid-session has asked for the machine to calm down now, not next
 * time. The store only ever lets the OS force the preference *on*; a player who
 * has deliberately switched motion back on inside the game keeps it, because
 * their explicit choice in this cabinet is more specific than a system default.
 */
function osReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/* ------------------------------------------------------------------ *
 * Persistence
 * ------------------------------------------------------------------ */

/** Exactly the five inert things worth carrying between sessions. */
interface PersistedSlots {
  bankroll: number;
  betIndex: number;
  prefs: Preferences;
  stats: SessionStats;
  history: HistoryEntry[];
}

/**
 * `localStorage` where there is one, a Map where there is not.
 *
 * The store is imported by the node test runner and rendered on the server, and
 * in neither place does `localStorage` exist. Handing persist a shim rather
 * than letting it discover the absence keeps the failure mode boring: a session
 * that saves nowhere rather than a console full of warnings.
 */
function safeStorage(): StateStorage {
  if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
    return window.localStorage;
  }
  const memory = new Map<string, string>();
  return {
    getItem: (name) => memory.get(name) ?? null,
    setItem: (name, value) => void memory.set(name, value),
    removeItem: (name) => void memory.delete(name),
  };
}

/* ------------------------------------------------------------------ *
 * The store
 * ------------------------------------------------------------------ */

function freshState(seed: string, prefs: Preferences, bankroll = STARTING_BANKROLL) {
  return {
    phase: 'IDLE' as const,
    spinToken: 0,
    grid: openingGrid(seed),
    reels: new Array<'IDLE'>(REELS).fill('IDLE'),
    stops: new Array<number>(REELS).fill(0),
    strips: 'BASE' as const,
    result: null,

    bankroll,
    betIndex: DEFAULT_BET_INDEX,
    betPerLine: betPerLineAt(DEFAULT_BET_INDEX),
    totalBet: totalBetAt(DEFAULT_BET_INDEX),
    win: 0,
    meter: 0,

    presentation: null,
    highlight: null,
    dimmed: [],
    banner: null,
    featureCard: null,

    free: null,
    hold: null,
    gamble: null,
    canGamble: false,
    orbs: [],
    jackpotWon: null,

    seed,
    startedAt: Date.now(),
    stats: emptyStats(bankroll),
    history: [],
    autoplay: null,
    prefs,
    message: null,
  };
}

/**
 * The whole store, as one explicitly typed value.
 *
 * Annotated rather than inferred because every command below reaches back into
 * `useSlots` to do its work, and an inferred store type that depends on
 * functions that depend on the store type is a circularity TypeScript rightly
 * refuses to resolve.
 */
function initialState(): SlotsState {
  return {
    ...freshState(sessionSeed, { ...DEFAULT_PREFS, reducedMotion: osReducedMotion() }),

    /* --- commands: every one of them delegates downward --- */
    spin: () => beginPlayerSpin(),
    stopReels: () => slamStop(),
    setBetIndex: (index: number) => changeBet(index),
    betUp: () => stepBet(1),
    betDown: () => stepBet(-1),
    maxBet: () => changeBet(BET_LADDER.length - 1),
    startAutoplay: (count: number) => beginAutoplay(count),
    stopAutoplay: () => endAutoplay(),
    buyFeature: (option: BuyOption) => buy(option),
    startGamble: () => openGamble(),
    chooseGamble: (choice: GambleChoice) => takeGamble(choice),
    collectGamble: () => closeGamble(),
    skip: () => skipAhead(),
    rebuy: () => addFunds(),
    setPref: (key, value) => applyPref(key, value),
    newSession: (seed?: string) => restart(seed),
    dismissMessage: () => clearMessage(),
  };
}

export const useSlots = create<SlotsState>()(
  persist(initialState, {
      name: PERSIST_KEY,
      version: PERSIST_VERSION,
      storage: createJSONStorage(safeStorage),

      /**
       * An older save is dropped rather than guessed at. Returning an empty
       * object lets `merge` fall through to a fresh cabinet without persist
       * logging a missing-migration error. When a version 2 exists, this is
       * where a real translation goes.
       */
      migrate: () => ({}),

      /**
       * Five values. Nothing about a spin, a phase, a feature or a timer.
       *
       * `autoplay` is deliberately absent: an autoplay run is a live intention,
       * not a setting, and resuming one on page load would have the machine
       * start spending money before the player had touched it.
       */
      partialize: (s): PersistedSlots => ({
        bankroll: s.bankroll,
        betIndex: s.betIndex,
        prefs: s.prefs,
        stats: s.stats,
        history: s.history,
      }),

      /**
       * Belt and braces on top of the version check: a save missing anything
       * the current cabinet expects is used only for the parts that survive
       * inspection, rather than being spread over a valid state wholesale.
       */
      merge: (persisted, currentState) => {
        const saved = persisted as Partial<PersistedSlots> | undefined;
        const bankroll =
          typeof saved?.bankroll === 'number' && Number.isFinite(saved.bankroll)
            ? Math.max(0, Math.round(saved.bankroll))
            : currentState.bankroll;
        const betIndex =
          typeof saved?.betIndex === 'number'
            ? Math.min(Math.max(Math.round(saved.betIndex), 0), BET_LADDER.length - 1)
            : currentState.betIndex;
        const stats =
          saved?.stats && typeof saved.stats.spins === 'number' && saved.stats.featureTriggers
            ? saved.stats
            : emptyStats(bankroll);

        return {
          ...currentState,
          prefs: { ...DEFAULT_PREFS, ...saved?.prefs },
          bankroll,
          betIndex,
          betPerLine: betPerLineAt(betIndex),
          totalBet: totalBetAt(betIndex),
          stats,
          history: Array.isArray(saved?.history) ? saved.history.slice(0, HISTORY_LIMIT) : [],
        };
      },

      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // The history ids continue where the saved session left off, so a key
        // from before the reload can never collide with one after it.
        historySeq = state.history.reduce((max, h) => Math.max(max, h.id), 0);
        // The OS gets the last word on motion, and only in one direction.
        if (osReducedMotion() && !state.prefs.reducedMotion) {
          useSlots.setState({ prefs: { ...state.prefs, reducedMotion: true } });
        }
        setSoundEnabled(state.prefs.sound);
        setMusicEnabled(state.prefs.music);
      },
  }),
);

/* ================================================================== *
 * The lifecycle
 *
 * Everything below is the script. It is written as free functions rather than
 * closures inside `create` because a spin is not one action -- it is a dozen
 * beats calling each other across four seconds -- and a flat list of named
 * steps is the only version of that anyone can read.
 * ================================================================== */

/* ------------------------------------------------------------------ *
 * Starting a spin
 * ------------------------------------------------------------------ */

/**
 * The spin button.
 *
 * Refuses in three cases and each one is a different kind of refusal: the wrong
 * phase is silent (the button is already disabled; a beep would be noise), an
 * empty bankroll is loud (the player needs to know why nothing happened), and a
 * live autoplay run is neither -- it just falls through, because pressing spin
 * during autoplay should not queue a second spin on top of the scheduled one.
 */
function beginPlayerSpin(): void {
  const s = useSlots.getState();
  if (s.phase !== 'IDLE') return;

  if (s.bankroll < s.totalBet) {
    playSound('error');
    useSlots.setState({ message: 'Not enough credit for that stake.' });
    endAutoplay();
    return;
  }

  wakeAudio();
  playSound('buttonPress');
  chargeAndSpin();
}

/** Take the stake and put the reels in motion. The only place a base spin is paid for. */
function chargeAndSpin(force?: BuyForce): void {
  const s = useSlots.getState();
  const stake: Stake = { betPerLine: s.betPerLine, totalBet: s.totalBet };

  useSlots.setState((prev) => ({
    bankroll: prev.bankroll - stake.totalBet,
    stats: {
      ...prev.stats,
      spins: prev.stats.spins + 1,
      wagered: prev.stats.wagered + stake.totalBet,
    },
  }));

  launch('BASE', stake, force);
}

/**
 * Ask the engine for a spin and schedule the landing.
 *
 * Note the order: the whole result is known *before* the first reel lands. That
 * is not a shortcut, it is how a slot machine works -- the outcome is decided
 * the instant the button is pressed and the reels are a four-second animation
 * of a decision already made. It is also what makes the slam stop honest: there
 * is nothing left to roll.
 */
function launch(mode: 'BASE' | 'FREE', stake: Stake, force?: BuyForce): void {
  cancelSequence();
  const alive = guard();

  const ctx: SpinContext = {
    rng,
    stake,
    mode,
    free: useSlots.getState().free,
    force,
  };
  const result = engineSpin(ctx);

  useSlots.setState((prev) => ({
    phase: mode === 'FREE' ? 'FREE_SPINS' : 'SPINNING',
    spinToken: prev.spinToken + 1,
    reels: new Array<'SPINNING'>(REELS).fill('SPINNING'),
    stops: [...result.stops],
    strips: result.strips,
    result,
    win: 0,
    meter: 0,
    presentation: null,
    highlight: null,
    dimmed: [],
    banner: null,
    canGamble: false,
    message: null,
  }));

  playSound('spinStart');
  playSound('reelLoop');

  scheduleLanding(result, mode, alive);
}

/**
 * The reels coming to rest, one at a time, left to right.
 *
 * `TIMING.reelStop` between them is what makes a spin read as a sentence rather
 * than arriving as a single flashed frame -- and it is the gap that gives the
 * anticipation somewhere to live. A reel the engine flagged for a tease spins on
 * for `TIMING.anticipation` first, which turbo does not shorten, because that
 * hesitation is the best two seconds the game has and a turbo player has asked
 * to play faster, not to be robbed of it.
 */
function scheduleLanding(result: SpinResult, mode: 'BASE' | 'FREE', alive: () => boolean): void {
  const teasing = new Set(result.anticipation);

  play((tl) => {
    tl.hold(ms(TIMING.spinUp, 'motion'));

    for (let reel = 0; reel < REELS; reel++) {
      if (teasing.has(reel)) {
        tl.then(() => {
          useSlots.setState((prev) => {
            const reels = [...prev.reels];
            reels[reel] = 'TEASE';
            return { reels };
          });
          playSound('anticipation');
        });
        tl.hold(ms(TIMING.anticipation, 'tease'));
      }

      tl.then(() => landReel(reel, result, teasing.has(reel)));
      tl.hold(ms(TIMING.reelStop, 'motion'));
    }

    tl.hold(ms(TIMING.reelSettle, 'motion'));
    tl.then(() => {
      if (!alive()) return;
      afterLanding(result, mode);
    });
  });
}

/**
 * One reel arriving.
 *
 * Only this reel's column of the new board is spliced in. The rest of the grid
 * is still the previous spin's, which is exactly what the player is looking at:
 * two reels of the new board and three of the old one is not a bug, it is what
 * a slot machine looks like halfway through a spin.
 */
function landReel(reel: number, result: SpinResult, teased: boolean): void {
  useSlots.setState((prev) => {
    const grid = prev.grid.map((col, i) => (i === reel ? [...result.grid[reel]] : col));
    const reels = [...prev.reels];
    reels[reel] = 'LANDED';
    return { grid, reels };
  });

  playSound(teased ? 'reelStopTease' : 'reelStop');

  // The specials get their own voice on landing, because by the time the win
  // presentation starts it is too late for the player to have felt them arrive.
  const column = result.grid[reel];
  if (column.includes('SCATTER')) playSound('scatterLand', { delay: 0.05 });
  if (column.includes('ORB')) playSound('orbLand', { delay: 0.05 });
}

/**
 * The slam stop.
 *
 * Runs every step the landing timeline still owes, immediately, in order. The
 * reels land where the engine already decided they would land -- there is no
 * re-roll here and there must never be one, because a stop button that changed
 * the outcome would be the single most dishonest thing this machine could do.
 * All the player is buying is the four seconds.
 */
function slamStop(): void {
  const s = useSlots.getState();
  // Reels turn during free spins too, and the phase there stays FREE_SPINS so
  // the feature frame does not flicker off the glass. Asking the reels what
  // they are doing is more honest than asking the phase.
  const turning = s.reels.some((r) => r === 'SPINNING' || r === 'TEASE');
  if (!turning) return;
  if (s.phase !== 'SPINNING' && s.phase !== 'FREE_SPINS') return;
  playSound('buttonPress');
  current?.finish();
}

/* ------------------------------------------------------------------ *
 * Presenting a win
 * ------------------------------------------------------------------ */

/** The board has landed. Announce what it did, then present whatever it paid. */
function afterLanding(result: SpinResult, mode: 'BASE' | 'FREE'): void {
  stopLoop('reelLoop');

  if (result.rage) {
    useSlots.setState({ banner: 'DRAGON RAGE' });
    playSound('dragonRoar');
  } else if (result.dragonReels.length > 0) {
    useSlots.setState({ banner: result.dragonReels.length > 1 ? 'DRAGON REELS' : 'DRAGON REEL' });
    playSound('dragonReel');
  }

  // A free spin's bookkeeping -- the spin count, the running total, the
  // multiplier trail, a retrigger -- belongs to the engine and is applied the
  // instant the board is known, so the presentation can announce it.
  if (mode === 'FREE') {
    const before = useSlots.getState().free;
    if (before) {
      const after = applyFreeSpin(before, result);
      useSlots.setState((prev) => ({
        free: after,
        stats: { ...prev.stats, freeSpins: prev.stats.freeSpins + 1 },
      }));
      if (after.trailIndex > before.trailIndex) {
        playSound('multiplierUp');
        useSlots.setState({ banner: `${trailMultiplier(after)}x` });
      }
      if (after.retriggers > before.retriggers) {
        playSound('featureTrigger');
        useSlots.setState({ banner: `+${after.awarded - before.awarded} FREE SPINS` });
      }
    }
  }

  presentWin(result, mode);
}

/**
 * The celebration, and the only place the phase becomes loud.
 *
 * A win above {@link TAKEOVER_FROM} takes the screen unless the player has
 * asked for quick wins, in which case the meter still counts -- quick wins
 * removes the ceremony, never the money or the count that proves it. Inside a
 * feature the phase stays on the feature unless the win is big enough to take
 * over, because dropping to PRESENTING would pull the free spins frame off
 * screen for a second and put it back, which reads as a glitch.
 */
function presentWin(result: SpinResult, mode: 'BASE' | 'FREE'): void {
  const s = useSlots.getState();
  const stake = mode === 'FREE' && s.free ? s.free.totalBet : s.totalBet;
  const total = result.totalWin;
  const tier = winTier(total, stake);
  const alive = guard();

  if (total <= 0) {
    // Nothing to show. Straight to the books, after a beat so the last reel has
    // finished settling before the machine moves on.
    play((tl) => {
      tl.hold(ms(TIMING.beforeWins, 'motion'));
      tl.then(() => settleSpin(result, mode));
    });
    return;
  }

  const countMs = ms(TIER_COUNT_MS[tier], 'read');
  const lineMs = ms(TIMING.linePresent, 'read');
  const highlights = highlightsOf(result);
  const takeover = tierAtLeast(tier, TAKEOVER_FROM) && !s.prefs.quickWins;

  play((tl) => {
    tl.hold(ms(TIMING.beforeWins, 'motion'));
    // Where the celebration actually begins. Everything below is measured from
    // here rather than from the head of the timeline, because the lead-in is
    // not part of the count and letting it be would end the presentation that
    // much before the meter had finished climbing.
    const opened = tl.cursor;

    tl.then(() => {
      presentationSeq++;
      useSlots.setState((prev) => ({
        win: total,
        meter: 0,
        presentation: {
          key: presentationSeq,
          amount: total,
          tier,
          durationMs: countMs,
          cumulative: false,
        },
        phase: takeover ? 'TAKEOVER' : prev.free ? 'FREE_SPINS' : prev.hold ? 'HOLD' : 'PRESENTING',
      }));

      const fanfare = TIER_SOUND[tier];
      if (fanfare) playSound(fanfare);
      runMeter(0, total, countMs, alive);
    });

    // The cycle. Each win gets `TIMING.linePresent` on the glass with everything
    // else dimmed behind it, and the cycle repeats until the meter has caught
    // up -- a LEGENDARY count runs six seconds and three lines take two, so
    // without the repeat the grid would sit dark and empty for four of them.
    if (highlights.length > 0) {
      const cycleMs = highlights.length * lineMs;
      const passes = Math.min(4, Math.max(1, Math.ceil(countMs / Math.max(1, cycleMs))));
      for (let pass = 0; pass < passes; pass++) {
        for (const h of highlights) {
          tl.then(() => {
            useSlots.setState({ highlight: h, dimmed: dimmedFor(h.cells) });
            playSound('winTick', { gain: 0.5 });
          });
          tl.hold(lineMs);
        }
      }
    }

    // Whichever ran longer -- the count or the cycle -- the other waits for it.
    const shown = tl.cursor - opened;
    if (countMs > shown) tl.hold(countMs - shown);

    tl.then(() => {
      useSlots.setState({ highlight: null, dimmed: [] });
    });
    tl.hold(ms(TIMING.afterWins, 'read'));
    tl.then(() => settleSpin(result, mode));
  });
}

/** The meter climb: frames, never an interval. See `countUp` for why. */
function runMeter(from: number, to: number, durationMs: number, alive: () => boolean): void {
  meter?.cancel();
  meter = countUp({
    from,
    to,
    durationMs,
    ticks: Math.min(28, Math.max(3, Math.round(durationMs / METER_TICK_MS))),
    alive,
    onValue: (value) => useSlots.setState({ meter: value }),
    onTick: (index, total) => playSound('meterCount', { pitch: (index / Math.max(1, total)) * 12 }),
    onDone: () => playSound('meterEnd'),
  });
}

/* ------------------------------------------------------------------ *
 * Settling
 * ------------------------------------------------------------------ */

/**
 * The books, and the one place a spin's win reaches the bankroll.
 *
 * Called exactly once per spin, from the end of that spin's presentation
 * timeline -- including the zero-win path, which still has to write the history
 * strip and the dry streak. Everything credited here is `result.totalWin` and
 * nothing else; the store does not add the lines up itself, because the engine
 * already did and two answers to the same question is one answer too many.
 */
function settleSpin(result: SpinResult, mode: 'BASE' | 'FREE'): void {
  const won = result.totalWin;
  const stake = mode === 'FREE' ? useSlots.getState().free?.totalBet ?? 0 : useSlots.getState().totalBet;

  bank(won, stake, mode === 'FREE');
  meter?.finish();

  useSlots.setState({ meter: won, win: won, highlight: null, dimmed: [], banner: null });

  if (mode === 'FREE') {
    // Deliberately not routed through `enterFeature`. Inside free spins the
    // base band's orbs are not on the reels at all, so the only trigger the
    // engine can hand back is a retrigger of the shrine itself -- and
    // `applyFreeSpin` has already folded its extra spins into `awarded`.
    // Treating it as a fresh trigger here would open a second session inside
    // the first one.
    continueFreeSpins();
    return;
  }

  if (result.trigger) {
    enterFeature(result.trigger, result);
    return;
  }

  toIdle(result.totalWin);
}

/**
 * Credit, count, remember.
 *
 * `bankroll` only ever moves by a whole number of cents here, and `Math.round`
 * is a tripwire rather than a conversion: if a float ever reaches this function
 * the bankroll stays an integer and the discrepancy shows up in the RTP
 * simulation instead of silently accumulating in a player's balance.
 */
function bank(won: number, stake: number, free: boolean): void {
  useSlots.setState((prev) => {
    const bankroll = prev.bankroll + Math.round(won);
    const stats: SessionStats = {
      ...prev.stats,
      won: prev.stats.won + Math.round(won),
      biggestWin: Math.max(prev.stats.biggestWin, Math.round(won)),
      dryStreak: won > 0 ? 0 : prev.stats.dryStreak + 1,
      longestDryStreak: Math.max(prev.stats.longestDryStreak, won > 0 ? 0 : prev.stats.dryStreak + 1),
      peak: Math.max(prev.stats.peak, bankroll),
    };

    historySeq++;
    const entry: HistoryEntry = {
      id: historySeq,
      win: Math.round(won),
      totalBet: stake,
      ratio: stake > 0 ? won / stake : 0,
      tier: winTier(won, stake),
      free,
      at: Date.now(),
    };

    return {
      bankroll,
      stats,
      history: [entry, ...prev.history].slice(0, HISTORY_LIMIT),
    };
  });
}

/**
 * Back to accepting input.
 *
 * The last thing that happens on every path through the machine, and the only
 * place autoplay is allowed to take another turn.
 */
function toIdle(lastWin: number): void {
  const s = useSlots.getState();
  const offer = lastWin > 0 && !s.autoplay && engineCanGamble(lastWin, s.totalBet);

  useSlots.setState({
    phase: 'IDLE',
    reels: new Array<'IDLE'>(REELS).fill('IDLE'),
    highlight: null,
    dimmed: [],
    banner: null,
    featureCard: null,
    canGamble: offer,
  });

  advanceAutoplay(lastWin);
}

/* ------------------------------------------------------------------ *
 * Free spins -- the Shrine of Flames
 * ------------------------------------------------------------------ */

/** Route a trigger to its feature. Both start the same way: a card, then the run. */
function enterFeature(trigger: FeatureTrigger, result: SpinResult): void {
  const bought = boughtPending;
  boughtPending = false;

  useSlots.setState((prev) => ({
    stats: {
      ...prev.stats,
      featureTriggers: {
        ...prev.stats.featureTriggers,
        [trigger.feature]: prev.stats.featureTriggers[trigger.feature] + 1,
      },
    },
  }));

  // Autoplay is for the stretch where nothing is happening. A feature is the
  // opposite of that, so the run ends here rather than resuming afterwards --
  // a player who set fifty spins going and walked back to find the shrine lit
  // should find it waiting for them, not four spins into the next fifty.
  endAutoplay();

  playSound('featureTrigger');
  if (trigger.feature === 'FREE_SPINS') enterFreeSpins(trigger, bought);
  else enterHold(result, bought);
}

function enterFreeSpins(trigger: FeatureTrigger, bought: boolean): void {
  const s = useSlots.getState();
  const stake: Stake = { betPerLine: s.betPerLine, totalBet: s.totalBet };
  const free = startFreeSpins(trigger, stake, bought);
  const alive = guard();

  cardSeq++;
  useSlots.setState({
    free,
    phase: 'FEATURE_INTRO',
    featureCard: {
      kind: 'INTRO',
      feature: 'FREE_SPINS',
      spins: free.awarded,
      key: cardSeq,
    },
    win: 0,
    meter: 0,
    presentation: null,
  });

  playSound('freeSpinsIntro');
  startMusic('free');

  play((tl) => {
    tl.hold(ms(TIMING.featureIntro, 'read'));
    tl.then(() => {
      if (!alive()) return;
      useSlots.setState({ phase: 'FREE_SPINS', featureCard: null });
      nextFreeSpin();
    });
  });
}

/** One free spin, or the end of the run. The loop is this function calling itself. */
function nextFreeSpin(): void {
  const free = useSlots.getState().free;
  if (!free) return;
  if (free.played >= free.awarded) {
    endFreeSpins();
    return;
  }
  launch('FREE', { betPerLine: free.betPerLine, totalBet: free.totalBet });
}

/** Between free spins: a beat to let the last one land before the next starts. */
function continueFreeSpins(): void {
  const free = useSlots.getState().free;
  if (!free) return;
  const alive = guard();

  play((tl) => {
    tl.hold(ms(AUTOPLAY_GAP, 'motion'));
    tl.then(() => {
      if (!alive()) return;
      useSlots.setState({ phase: 'FREE_SPINS', banner: null });
      nextFreeSpin();
    });
  });
}

/**
 * The total card.
 *
 * Credits nothing. Every free spin was banked as it finished, so this is a
 * summary of money the player already has -- which is deliberate: a feature
 * that pays in one lump at the end is a feature where a crash halfway through
 * costs the player everything, and one that pays as it goes is not.
 */
function endFreeSpins(): void {
  const free = useSlots.getState().free;
  if (!free) return;
  const alive = guard();

  cardSeq++;
  presentationSeq++;
  const tier = winTier(free.won, free.totalBet);

  useSlots.setState({
    phase: 'FEATURE_OUTRO',
    featureCard: { kind: 'OUTRO', feature: 'FREE_SPINS', total: free.won, key: cardSeq },
    presentation: {
      key: presentationSeq,
      amount: free.won,
      tier,
      durationMs: ms(TIER_COUNT_MS[tier], 'read'),
      cumulative: true,
    },
    win: free.won,
    meter: 0,
    highlight: null,
    dimmed: [],
    banner: null,
  });

  playSound('freeSpinsOutro');
  startMusic('base');
  runMeter(0, free.won, ms(TIER_COUNT_MS[tier], 'read'), alive);

  play((tl) => {
    tl.hold(ms(TIMING.featureOutro, 'read'));
    tl.then(() => {
      if (!alive()) return;
      const total = useSlots.getState().free?.won ?? 0;
      useSlots.setState({ free: null, featureCard: null, meter: total, win: total });
      toIdle(total);
    });
  });
}

/* ------------------------------------------------------------------ *
 * Hold and win -- the Shrine Link
 * ------------------------------------------------------------------ */

function enterHold(result: SpinResult, bought: boolean): void {
  const s = useSlots.getState();
  const stake: Stake = { betPerLine: s.betPerLine, totalBet: s.totalBet };
  const hold = startHold(rng, result.orbs, stake.totalBet, bought);
  const alive = guard();

  announcedJackpots = [];
  cardSeq++;
  useSlots.setState({
    hold,
    orbs: hold.orbs,
    phase: 'FEATURE_INTRO',
    featureCard: {
      kind: 'INTRO',
      feature: 'HOLD_AND_WIN',
      orbs: hold.orbs.length,
      key: cardSeq,
    },
    win: 0,
    meter: hold.collected,
    presentation: null,
    jackpotWon: null,
  });

  playSound('holdIntro');
  startMusic('hold');

  play((tl) => {
    // The triggering orbs lock one at a time. Six of them arriving on the same
    // frame is a state change; six of them arriving 90ms apart is a feature
    // starting, and the difference is entirely in the stagger.
    hold.orbs.forEach(() => {
      tl.then(() => playSound('orbLock'));
      tl.hold(ms(ORB_LOCK_STAGGER_MS, 'motion'));
    });

    tl.hold(ms(TIMING.featureIntro, 'read'));
    tl.then(() => {
      if (!alive()) return;
      useSlots.setState({ phase: 'HOLD', featureCard: null });
      nextRespin();
    });
  });
}

/** One respin of the link, or the end of it. */
function nextRespin(): void {
  const hold = useSlots.getState().hold;
  if (!hold) return;
  if (hold.respinsLeft <= 0) {
    endHold();
    return;
  }

  const alive = guard();
  // The engine hands back both the next state and a description of what just
  // happened. The state is taken wholesale -- the respin counter, the running
  // total and the jackpot ledger are all its arithmetic, not the store's.
  const { state: next, result: respin } = holdRespin(rng, hold);

  useSlots.setState({
    hold: next,
    orbs: respin.orbs,
    win: respin.total,
    meter: respin.total,
    banner: null,
  });

  playSound('holdRespin');
  for (const orb of respin.landed) {
    playSound('orbLand');
    if (orb.award.kind === 'JACKPOT') announceJackpot(orb.award.jackpot);
  }
  for (const jackpot of respin.jackpots) announceJackpot(jackpot);
  if (respin.full) playSound('holdFull');

  play((tl) => {
    if (respin.landed.length > 0) tl.hold(ms(TIMING.orbLand, 'read'));
    tl.hold(ms(TIMING.holdRespin, 'motion'));
    tl.then(() => {
      if (!alive()) return;
      if (respin.full || next.respinsLeft <= 0) endHold();
      else nextRespin();
    });
  });
}

function announceJackpot(jackpot: JackpotId): void {
  announcedJackpots.push(jackpot);
  playSound(JACKPOT_SOUND[jackpot]);
  useSlots.setState((prev) => ({
    jackpotWon: jackpot,
    banner: `${jackpot} JACKPOT`,
    stats: {
      ...prev.stats,
      jackpots: { ...prev.stats.jackpots, [jackpot]: prev.stats.jackpots[jackpot] + 1 },
    },
  }));
}

/**
 * The link pays, once.
 *
 * Unlike free spins, hold-and-win genuinely is a single award: the orbs are a
 * board that is worth nothing until the respins stop, and `finishHold` is the
 * engine's final word on what that board came to. It is credited here and
 * nowhere else, and `hold` is torn down in the same beat so there is no way for
 * a second settle to find a feature still standing.
 */
function endHold(): void {
  const hold = useSlots.getState().hold;
  if (!hold) return;
  const alive = guard();

  const settlement = finishHold(hold);
  const total = settlement.total;

  // `finishHold` names every jackpot on the board, including the ones already
  // shouted about as their orbs landed. Announce only the difference, counted
  // rather than de-duplicated: two MINI orbs are two MINI jackpots.
  const outstanding = [...announcedJackpots];
  for (const jackpot of settlement.jackpots) {
    const seen = outstanding.indexOf(jackpot);
    if (seen >= 0) outstanding.splice(seen, 1);
    else announceJackpot(jackpot);
  }

  bank(total, hold.totalBet, false);

  cardSeq++;
  presentationSeq++;
  const tier = winTier(total, hold.totalBet);
  const countMs = ms(TIER_COUNT_MS[tier], 'read');

  useSlots.setState({
    phase: 'FEATURE_OUTRO',
    hold: null,
    featureCard: { kind: 'OUTRO', feature: 'HOLD_AND_WIN', total, key: cardSeq },
    presentation: {
      key: presentationSeq,
      amount: total,
      tier,
      durationMs: countMs,
      cumulative: true,
    },
    win: total,
    meter: 0,
  });

  startMusic('base');
  runMeter(0, total, countMs, alive);

  play((tl) => {
    tl.hold(ms(TIMING.featureOutro, 'read'));
    tl.then(() => {
      if (!alive()) return;
      useSlots.setState({ orbs: [], featureCard: null, meter: total, win: total });
      toIdle(total);
    });
  });
}

/* ------------------------------------------------------------------ *
 * Gamble
 * ------------------------------------------------------------------ */

/**
 * Move a settled win onto the cards.
 *
 * The win has already been credited by the time this is offered, so entering
 * the gamble takes it back out of the bankroll and puts it in the pot. That is
 * the honest model: the money is either in the balance or it is at risk, never
 * both, and a player looking at the bankroll during a gamble sees a figure they
 * could actually walk away with.
 */
function openGamble(): void {
  const s = useSlots.getState();
  if (s.phase !== 'IDLE' || !s.canGamble || s.win <= 0) return;
  if (!engineCanGamble(s.win, s.totalBet)) return;

  cancelSequence();
  playSound('buttonPress');
  useSlots.setState((prev) => ({
    phase: 'GAMBLE',
    bankroll: prev.bankroll - prev.win,
    gamble: { stake: prev.win, step: 0, history: [] },
    canGamble: false,
    presentation: null,
  }));
}

function takeGamble(choice: GambleChoice): void {
  const s = useSlots.getState();
  if (s.phase !== 'GAMBLE' || !s.gamble) return;
  // The engine throws rather than returning a silent loss when handed a step
  // past the cap, on the grounds that being asked for a sixth double is a
  // programming error and not a player action. It is this function's job to
  // make sure it never is one: at the top of the ladder there is nothing left
  // to offer, so the pot is taken.
  if (s.gamble.step >= GAMBLE_MAX_STEPS || s.gamble.stake <= 0) {
    closeGamble();
    return;
  }

  const alive = guard();
  const outcome = engineGamble(rng, choice, s.gamble.stake, s.gamble.step);

  playSound('gambleFlip');

  play((tl) => {
    tl.hold(ms(TIMING.gambleFlip, 'read'));
    tl.then(() => {
      if (!alive()) return;
      const live = useSlots.getState().gamble;
      if (!live) return;

      useSlots.setState({
        gamble: {
          stake: outcome.balance,
          step: outcome.step,
          history: [...live.history, outcome],
        },
        win: outcome.balance,
        meter: outcome.balance,
      });

      playSound(outcome.won ? 'gambleWin' : 'gambleLose');
      // A loss, or the last rung of the ladder, ends the run on its own. There
      // is no decision left to offer, so the machine takes it.
      if (!outcome.won || outcome.balance <= 0 || outcome.step >= GAMBLE_MAX_STEPS) closeGamble();
    });
  });
}

/**
 * Take what is left of the pot.
 *
 * The history strip and the session total are amended rather than appended to:
 * a gamble is the same win being re-resolved, not a second one, and a strip
 * showing "$40" followed by "$80" for a single spin would double-count it to
 * anyone reading down the column.
 */
function closeGamble(): void {
  const s = useSlots.getState();
  if (!s.gamble) return;

  const pot = s.gamble.stake;
  const staked = s.gamble.history[0]?.stake ?? pot;
  const delta = pot - staked;

  cancelSequence();
  playSound(pot > 0 ? 'coinDrop' : 'error');

  useSlots.setState((prev) => {
    const bankroll = prev.bankroll + pot;
    const history = [...prev.history];
    if (history.length > 0 && prev.gamble && prev.gamble.history.length > 0) {
      const first = history[0];
      history[0] = {
        ...first,
        win: pot,
        ratio: first.totalBet > 0 ? pot / first.totalBet : 0,
        tier: winTier(pot, first.totalBet),
      };
    }
    return {
      phase: 'IDLE' as const,
      gamble: null,
      bankroll,
      win: pot,
      meter: pot,
      canGamble: false,
      history,
      stats: {
        ...prev.stats,
        won: prev.stats.won + delta,
        biggestWin: Math.max(prev.stats.biggestWin, pot),
        peak: Math.max(prev.stats.peak, bankroll),
      },
    };
  });
}

/* ------------------------------------------------------------------ *
 * Autoplay
 * ------------------------------------------------------------------ */

function beginAutoplay(count: number): void {
  const s = useSlots.getState();
  if (s.phase !== 'IDLE') return;
  if (s.bankroll < s.totalBet) {
    playSound('error');
    useSlots.setState({ message: 'Not enough credit to start autoplay.' });
    return;
  }
  wakeAudio();
  playSound('buttonToggle');
  useSlots.setState({ autoplay: { left: count, total: count }, canGamble: false });
  takeAutoplayTurn();
}

function endAutoplay(): void {
  if (autoTimer !== null) {
    clearTimeout(autoTimer);
    autoTimer = null;
  }
  if (useSlots.getState().autoplay) useSlots.setState({ autoplay: null });
}

/** Spend one of the run's spins. */
function takeAutoplayTurn(): void {
  const s = useSlots.getState();
  if (!s.autoplay || s.phase !== 'IDLE') return;

  if (s.bankroll < s.totalBet) {
    endAutoplay();
    playSound('error');
    useSlots.setState({ message: 'Autoplay stopped -- not enough credit.' });
    return;
  }

  useSlots.setState((prev) =>
    prev.autoplay ? { autoplay: { ...prev.autoplay, left: prev.autoplay.left - 1 } } : {},
  );
  chargeAndSpin();
}

/**
 * Whether the run continues, decided the moment a spin settles.
 *
 * Four things stop it, and all four are the same idea: autoplay is for the
 * stretch of a session where nothing is happening, and the instant something
 * happens it hands control back. A feature triggered, a win worth looking at,
 * the money ran out, or the count reached zero.
 */
function advanceAutoplay(lastWin: number): void {
  const s = useSlots.getState();
  if (!s.autoplay) return;

  const tier = winTier(lastWin, s.totalBet);
  if (s.free || s.hold) return; // a feature owns the machine; the run is over
  if (tierAtLeast(tier, AUTOPLAY_PAUSE_TIER)) {
    endAutoplay();
    return;
  }
  if (s.autoplay.left <= 0) {
    endAutoplay();
    return;
  }
  if (s.bankroll < s.totalBet) {
    endAutoplay();
    useSlots.setState({ message: 'Autoplay stopped -- not enough credit.' });
    return;
  }

  const alive = guard();
  if (autoTimer !== null) clearTimeout(autoTimer);
  autoTimer = setTimeout(() => {
    autoTimer = null;
    if (!alive()) return;
    takeAutoplayTurn();
  }, ms(AUTOPLAY_GAP, 'motion'));
}

/* ------------------------------------------------------------------ *
 * Buying in
 * ------------------------------------------------------------------ */

/**
 * Pay for a feature outright.
 *
 * A bought feature is a real spin with a forced board, not a shortcut past the
 * engine: `buyForce` tells the engine what has to land, the engine lands it,
 * and everything downstream -- the trigger, the intro, the run, the settle --
 * is the same code the natural trigger uses. That is the only way the two can
 * be guaranteed to pay the same, which is what `rtp.sim.test.ts` measures.
 */
function buy(option: BuyOption): void {
  const s = useSlots.getState();
  if (s.phase !== 'IDLE') return;

  const cost = buyCost(option, s.totalBet);
  if (s.bankroll < cost) {
    playSound('error');
    useSlots.setState({ message: 'Not enough credit for that buy.' });
    return;
  }

  wakeAudio();
  playSound('buttonPress');
  endAutoplay();
  boughtPending = true;

  useSlots.setState((prev) => ({
    bankroll: prev.bankroll - cost,
    stats: {
      ...prev.stats,
      spins: prev.stats.spins + 1,
      wagered: prev.stats.wagered + cost,
    },
  }));

  launch('BASE', { betPerLine: s.betPerLine, totalBet: s.totalBet }, buyForce(option));
}

/* ------------------------------------------------------------------ *
 * Skip
 * ------------------------------------------------------------------ */

/**
 * Get to the end of whatever is on screen, now.
 *
 * Uniform across every phase, and deliberately so. Skip does not have a special
 * case per celebration; it runs the rest of the score instantly. Because every
 * beat is a step on a timeline, running the remaining steps arrives at exactly
 * the state waiting would have arrived at -- same board, same credit, same
 * books -- which is the only definition of skip that cannot desynchronise the
 * machine. The meter is jumped to its final value first so the count-up does
 * not keep writing over the settled figure.
 */
function skipAhead(): void {
  const s = useSlots.getState();
  if (s.phase === 'IDLE') return;

  if (s.phase === 'GAMBLE') {
    // There is no "rest of the score" to run here -- a gamble is waiting on a
    // decision, not on a clock -- so skip means take the money.
    closeGamble();
    return;
  }

  meter?.finish();
  current?.finish();
}

/* ------------------------------------------------------------------ *
 * The cabinet
 * ------------------------------------------------------------------ */

/** One rung up or down the ladder. */
function stepBet(direction: number): void {
  changeBet(useSlots.getState().betIndex + direction);
}

function clearMessage(): void {
  useSlots.setState({ message: null });
}

/** The stake ladder. Rejected mid-spin: a stake that moves under a live spin is a dispute. */
function changeBet(index: number): void {
  const s = useSlots.getState();
  if (s.phase !== 'IDLE') {
    playSound('error');
    return;
  }

  const next = Math.min(Math.max(Math.round(index), 0), BET_LADDER.length - 1);
  if (next === s.betIndex) return;

  playSound('betChange');
  useSlots.setState({
    betIndex: next,
    betPerLine: betPerLineAt(next),
    totalBet: totalBetAt(next),
    // The old win no longer qualifies against a new stake, and re-testing it
    // would let a player raise the bet to make a small win gambleable.
    canGamble: false,
  });
}

function addFunds(): void {
  playSound('coinDrop');
  useSlots.setState((prev) => ({
    bankroll: prev.bankroll + REBUY_AMOUNT,
    message: null,
    stats: { ...prev.stats, peak: Math.max(prev.stats.peak, prev.bankroll + REBUY_AMOUNT) },
  }));
}

function applyPref<K extends keyof Preferences>(key: K, value: Preferences[K]): void {
  useSlots.setState((prev) => ({ prefs: { ...prev.prefs, [key]: value } }));
  if (key === 'sound') {
    setSoundEnabled(value as boolean);
    if (value) playSound('buttonToggle');
  } else if (key === 'music') {
    setMusicEnabled(value as boolean);
  } else {
    playSound('buttonToggle');
  }
}

/**
 * Wipe the cabinet and deal a fresh one.
 *
 * Every timer dies here, which is the whole reason this is one function rather
 * than a `setState` at the call site: a new session that leaves a free spins
 * timeline running would have the old feature quietly spending the new
 * session's bankroll thirty seconds later.
 */
function restart(seed?: string): void {
  cancelSequence();
  stopMusic();
  stopLoop('reelLoop');
  boughtPending = false;
  historySeq = 0;

  sessionSeed = seed ?? randomSeed();
  rng = createRng(sessionSeed);
  audioStarted = false;

  const prefs = useSlots.getState().prefs;
  useSlots.setState(freshState(sessionSeed, prefs));
}

/* ------------------------------------------------------------------ *
 * Motion preference
 * ------------------------------------------------------------------ */

/**
 * Watch the OS setting for the life of the tab.
 *
 * Only ever forces the preference on. Someone who has turned motion back on
 * inside the game has made a choice about this cabinet specifically, which is
 * more specific than a system-wide default and outranks it.
 */
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  const sync = () => {
    if (query.matches && !useSlots.getState().prefs.reducedMotion) {
      useSlots.setState((prev) => ({ prefs: { ...prev.prefs, reducedMotion: true } }));
    }
  };
  sync();
  query.addEventListener('change', sync);
}

/* ------------------------------------------------------------------ *
 * Test seam
 *
 * The store is a singleton with a stream of randomness behind it, which is
 * exactly right for a cabinet and awkward for a test suite that needs to start
 * from a known place twice. `newSession(seed)` already reseeds; this exposes
 * the rest of the runtime so a test can assert that a cancelled timeline is
 * genuinely dead rather than merely quiet.
 * ------------------------------------------------------------------ */

/** @internal Not part of the published contract. */
export const __runtime = {
  get generation() {
    return generation;
  },
  get hasTimeline() {
    return current !== null;
  },
  get hasMeter() {
    return meter !== null && !meter.done;
  },
  get hasAutoTimer() {
    return autoTimer !== null;
  },
};
