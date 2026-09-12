'use client';

/**
 * The single store the UI talks to.
 *
 * It owns four things: the table (pure engine state), the round's pacing, the
 * trainer's grading, and the handful of preferences that decide how the felt
 * behaves. Every money-moving call delegates to the engine and swaps in
 * whatever table comes back, so the store cannot invent a payout of its own.
 *
 * The one piece of real logic here is the round driver. A Three Card Poker
 * round has a rhythm a table keeps: the machine delivers its stacks, each
 * player looks and decides, there is a beat before the dealer turns their
 * hand, and then the dealer turns every hand over from their left. The engine
 * has no clock, so the pacing lives here as timeouts that call engine
 * functions. Everything the driver does, a player could do by hand; it is a
 * metronome, not a second rulebook.
 */

import { useMemo } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import {
  initAudio,
  setAudioEnabled,
  sndBonus,
  sndCard,
  sndChip,
  sndClick,
  sndDeny,
  sndFlip,
  sndFold,
  sndLose,
  sndMachine,
  sndPushResult,
  sndShuffle,
  sndWin,
  sndWrong,
} from '@/lib/audio';
import { settle } from '@/lib/engine/resolve';
import { createRng, randomSeed, type Rng } from '@/lib/engine/rng';
import { DEFAULT_PRESET, defaultRules, presetById } from '@/lib/engine/rules';
import {
  abandonRound,
  clearBets,
  createTable,
  deal as dealIn,
  decide as decideIn,
  nextRound,
  rebet as rebetIn,
  rebuy as rebuyIn,
  recordDecision,
  renameSeat as renameSeatIn,
  revealDealer,
  seatOf,
  setRules as setRulesIn,
  setSeatOccupied as setSeatOccupiedIn,
  setWager as setWagerIn,
  type ActionResult,
} from '@/lib/engine/table';
import type { Decision, SeatId, Settlement, SpotKind, TableRules, TableState, Wagers } from '@/lib/engine/types';
import { SPOT_KEY } from '@/lib/engine/types';
import { choose, DEFAULT_BOT, type BotConfig } from '@/lib/strategy/autoplay';
import { adviseSeat, grade, type Advice } from '@/lib/strategy/strategy';

/* ------------------------------------------------------------------ *
 * Pacing
 * ------------------------------------------------------------------ */

/**
 * How long each beat of a round takes, at normal speed.
 *
 * Set by playing, not by reasoning. The pause before the dealer turns their
 * hand is the longest gap in the round because it is the moment the table is
 * watching; the settlement holds long enough to read three seats of numbers.
 */
const TIMING = {
  dealStack: 230,
  afterDeal: 420,
  beforeReveal: 700,
  revealDealer: 560,
  revealSeat: 460,
  afterReveal: 420,
  settleHold: 2800,
  botThink: 650,
} as const;

export type Speed = 'RELAXED' | 'NORMAL' | 'FAST';

const SPEED_SCALE: Record<Speed, number> = { RELAXED: 1.5, NORMAL: 1, FAST: 0.35 };

/**
 * When a hand's stack arrives from the machine, by its place in dealing order.
 * The felt staggers its cards by this and the driver waits for it, so the two
 * cannot drift apart.
 */
export function seatDealDelay(order: number, speed: Speed): number {
  return order * TIMING.dealStack * SPEED_SCALE[speed];
}

/** When the dealer reaches a seat's hand at the showdown, counted from the reveal. */
export function seatRevealDelay(order: number, speed: Speed): number {
  return (TIMING.revealDealer + order * TIMING.revealSeat) * SPEED_SCALE[speed];
}

/* ------------------------------------------------------------------ *
 * Toasts and grades
 * ------------------------------------------------------------------ */

export interface Toast {
  id: number;
  text: string;
  tone: 'ok' | 'warn' | 'win';
}

let toastId = 0;

/** One graded decision, shown in the trainer panel and then dropped. */
export interface Grade {
  id: number;
  seat: SeatId;
  correct: boolean;
  played: Decision;
  best: Decision;
  hand: string;
  why: string;
  /** Cents the choice gave up against the better one. Zero when it was the better one. */
  evGivenUp: number;
}

let gradeId = 0;

/* ------------------------------------------------------------------ *
 * The store
 * ------------------------------------------------------------------ */

/**
 * The RNG lives outside the store: it is a stream, not a value. A persisted
 * generator that resumes from a stale position looks reproducible and is not.
 */
let rng: Rng = createRng(randomSeed());

/** Every timeout the driver has scheduled, so a reset can cancel all of them. */
let timers: Array<ReturnType<typeof setTimeout>> = [];

function clearTimers(): void {
  for (const t of timers) clearTimeout(t);
  timers = [];
}

export interface Prefs {
  sound: boolean;
  speed: Speed;
  /** Show the exact play, with its expected value, before the decision. */
  hints: boolean;
  /** Grade every decision against the exact answer afterwards. */
  trainer: boolean;
  /** The stats drawer, open beside the felt on a wide screen. */
  panelOpen: boolean;
  /** Which chip the rack has selected, in cents. */
  chip: number;
  presetId: string;
}

export type DialogId = 'setup' | 'strategy' | 'paytables' | 'help';

const WIDE_ENOUGH_FOR_PANEL = 1180;
const panelDefault = typeof window === 'undefined' || window.innerWidth >= WIDE_ENOUGH_FOR_PANEL;

/* ------------------------------------------------------------------ *
 * Persistence
 * ------------------------------------------------------------------ */

/**
 * localStorage, written once the felt comes to rest.
 *
 * The blackjack table measured what the persist middleware costs untended: it
 * serialises the whole persisted slice on every `set()`, and a round makes a
 * dozen of those. Nothing reads storage back inside a session, and anything
 * written mid-round is abandoned on reload anyway, so writes are coalesced and
 * held until the table is back at BETTING — one per round — and forced out on
 * `pagehide` and when the page is hidden, the two moments a browser actually
 * guarantees before discarding a tab.
 */
const PERSIST_MS = 400;

function debouncedLocalStorage(): StateStorage {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: [string, string] | null = null;

  const midRound = (): boolean => {
    try {
      return useGame.getState().table.phase !== 'BETTING';
    } catch {
      return false;
    }
  };

  const flush = (force = false) => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!pending) return;
    if (!force && midRound()) {
      timer = setTimeout(() => {
        timer = null;
        flush();
      }, PERSIST_MS);
      return;
    }
    const [key, value] = pending;
    pending = null;
    try {
      localStorage.setItem(key, value);
    } catch {
      // A full or blocked storage is not a reason to take the game down.
    }
  };

  if (typeof window !== 'undefined' && typeof document !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('pagehide', () => flush(true));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush(true);
    });
  }

  return {
    getItem: (key) => localStorage.getItem(key),
    removeItem: (key) => {
      pending = null;
      localStorage.removeItem(key);
    },
    setItem: (key, value) => {
      pending = [key, value];
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        flush();
      }, PERSIST_MS);
    },
  };
}

export interface GameStore {
  table: TableState;
  prefs: Prefs;
  bot: BotConfig;

  /** True while the driver owns the table and the player's buttons are dead. */
  busy: boolean;
  /** True while the machine is delivering the stacks. */
  dealing: boolean;
  autoplay: boolean;
  /** The settlements from the round just finished, for the felt to show. */
  settlements: Settlement[];
  toasts: Toast[];
  grades: Grade[];
  /** Last round's wagers, so "same bet" is one button. */
  lastBets: Map<SeatId, Wagers>;
  dialog: DialogId | null;

  /* --- betting --- */
  setChip(cents: number): void;
  addChip(seat: SeatId, spot: SpotKind): void;
  setWager(seat: SeatId, spot: SpotKind, cents: number): void;
  clearBet(seat?: SeatId): void;
  rebet(): void;
  rebuy(seat: SeatId, cents: number): void;

  /* --- the round --- */
  deal(): void;
  decide(decision: Decision): void;
  playForMe(): void;
  toggleAutoplay(): void;

  /* --- the table --- */
  setSeatOccupied(seat: SeatId, occupied: boolean): void;
  renameSeat(seat: SeatId, name: string): void;
  setRules(rules: TableRules): void;
  applyPreset(id: string): void;
  newSession(seed?: string): void;

  /* --- preferences and chrome --- */
  setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void;
  setBot<K extends keyof BotConfig>(key: K, value: BotConfig[K]): void;
  openDialog(d: DialogId | null): void;
  toast(text: string, tone?: Toast['tone']): void;
  dismissToast(id: number): void;
}

export const useGame = create<GameStore>()(
  persist(
    (set, get) => {
      /* ---------- helpers ---------- */

      const ms = (base: number) => base * SPEED_SCALE[get().prefs.speed];

      const later = (fn: () => void, delay: number) => {
        const id = setTimeout(() => {
          timers = timers.filter((t) => t !== id);
          fn();
        }, delay);
        timers.push(id);
      };

      const sound = <A extends unknown[]>(fn: (...args: A) => void, ...args: A) => {
        if (get().prefs.sound) fn(...args);
      };

      /** Swap in an engine result, or turn a refusal into a toast. */
      const apply = (res: ActionResult): boolean => {
        if (!res.ok) {
          sound(sndDeny, 0);
          get().toast(res.reason, 'warn');
          return false;
        }
        set({ table: res.table });
        if (res.note) get().toast(res.note, 'ok');
        return true;
      };

      /* ---------- the round driver ---------- */

      /** Turn the dealer's hand, then every seat's, then settle. */
      const runShowdown = () => {
        const t = get().table;
        if (t.phase !== 'SHOWDOWN') {
          set({ busy: false });
          return;
        }
        const res = revealDealer(t);
        if (!res.ok) {
          set({ busy: false });
          return;
        }
        set({ table: res.table });

        const speed = get().prefs.speed;
        sound(sndFlip, 0);
        sound(sndFlip, 0.09);
        sound(sndFlip, 0.18);
        const seats = res.table.seats.filter((s) => s.cards.length === 3).length;
        for (let i = 0; i < seats; i++) sound(sndFlip, seatRevealDelay(i, speed) / 1000);

        later(finishRound, seatRevealDelay(seats, speed) + ms(TIMING.afterReveal));
      };

      const finishRound = () => {
        const t = get().table;
        if (t.phase !== 'SETTLE') {
          set({ busy: false });
          return;
        }
        const { table, settlements } = settle(t);
        set({ table, settlements });
        scoreSounds(settlements, sound);

        later(() => {
          const cleared = nextRound(get().table);
          if (!cleared.ok) {
            set({ busy: false });
            return;
          }
          set({ table: cleared.table, settlements: [], busy: false });
          if (get().autoplay) later(() => get().deal(), ms(500));
        }, ms(TIMING.settleHold));
      };

      /**
       * The bot's turn. The table is held busy while it "thinks", so a click in
       * that window cannot land on the next seat's decision instead.
       */
      const botMove = () => {
        const t = get().table;
        set({ busy: false });
        if (!get().autoplay || t.phase !== 'DECIDING' || !t.focus) return;
        const choice = choose(t, get().bot);
        if (choice) get().decide(choice);
      };

      const scheduleBot = () => {
        set({ busy: true });
        later(botMove, ms(TIMING.botThink));
      };

      /* ---------- initial state ---------- */

      return {
        table: createTable(defaultRules(), { seats: 1 }),
        prefs: {
          sound: true,
          speed: 'NORMAL',
          hints: false,
          trainer: false,
          panelOpen: panelDefault,
          // A real chip: the rack has no $10, and a default it cannot show
          // selected leaves a first-time player not knowing what a click bets.
          chip: 500,
          presetId: DEFAULT_PRESET,
        },
        bot: { ...DEFAULT_BOT },
        busy: false,
        dealing: false,
        autoplay: false,
        settlements: [],
        toasts: [],
        grades: [],
        lastBets: new Map(),
        dialog: null,

        /* ---------- betting ---------- */

        setChip(cents) {
          initAudio();
          sound(sndClick, 0);
          set((s) => ({ prefs: { ...s.prefs, chip: cents } }));
        },

        addChip(seatId, spot) {
          initAudio();
          const { table, prefs } = get();
          const current = seatOf(table, seatId).bets[SPOT_KEY[spot]];
          if (apply(setWagerIn(table, seatId, spot, current + prefs.chip))) sound(sndChip, 0, 1);
        },

        setWager(seatId, spot, cents) {
          apply(setWagerIn(get().table, seatId, spot, cents));
        },

        clearBet(seatId) {
          if (apply(clearBets(get().table, seatId))) sound(sndClick, 0);
        },

        rebet() {
          if (apply(rebetIn(get().table, get().lastBets))) sound(sndChip, 0, 2);
        },

        rebuy(seatId, cents) {
          if (apply(rebuyIn(get().table, seatId, cents))) {
            sound(sndChip, 0, 3);
            get().toast('Rebuy.', 'ok');
          }
        },

        /* ---------- the round ---------- */

        deal() {
          initAudio();
          if (get().busy) return;
          const { table } = get();

          const bets = new Map<SeatId, Wagers>();
          for (const s of table.seats) {
            if (s.occupied && (s.bets.ante > 0 || s.bets.pairPlus > 0)) bets.set(s.id, { ...s.bets });
          }

          const res = dealIn(table, rng);
          if (!res.ok) {
            // Autoplay with nothing to deal would otherwise sit silently forever.
            if (get().autoplay) set({ autoplay: false });
            apply(res);
            return;
          }

          set({ table: res.table, lastBets: bets, settlements: [], busy: true, dealing: true });

          const speed = get().prefs.speed;
          const stacks = res.table.seats.filter((s) => s.cards.length === 3).length + 1;
          sound(sndMachine, 0);
          for (let i = 0; i < stacks; i++) {
            for (let c = 0; c < 3; c++) sound(sndCard, 0.12 + seatDealDelay(i, speed) / 1000 + c * 0.055, 0.3 + c * 0.12);
          }

          later(() => {
            set({ dealing: false });
            const t = get().table;
            if (t.phase === 'SHOWDOWN') {
              // Pair Plus on its own asks for no decision.
              later(runShowdown, ms(TIMING.beforeReveal));
              return;
            }
            set({ busy: false });
            if (t.phase === 'DECIDING') {
              sound(sndFlip, 0);
              if (get().autoplay) scheduleBot();
            }
          }, seatDealDelay(stacks, speed) + ms(TIMING.afterDeal));
        },

        decide(decision) {
          initAudio();
          if (get().busy) return;
          let { table } = get();
          if (table.phase !== 'DECIDING' || !table.focus) return;
          const seat = seatOf(table, table.focus);

          /*
           * Grade first, while the hand being decided on is still the hand in
           * focus — and make the engine call against the table that carries the
           * grade. The blackjack store graded a decision, wrote it onto the
           * seat, and then called the engine with a snapshot from before the
           * grade, so every count was thrown away; round five found it.
           */
          let entry: Grade | null = null;
          if (get().prefs.trainer) {
            const advice = adviseSeat(seat, table.rules);
            if (advice) {
              const g = grade(advice, decision);
              entry = {
                id: ++gradeId,
                seat: seat.id,
                correct: g.correct,
                played: decision,
                best: advice.decision,
                hand: advice.handName,
                why: advice.why,
                evGivenUp: Math.round(g.evGivenUp),
              };
              table = recordDecision(table, seat.id, g.correct, g.evGivenUp);
            }
          }

          const res = decideIn(table, decision);
          if (!res.ok) {
            // The grade is not kept for a decision the table refused.
            apply(res);
            return;
          }
          set((s) => ({ table: res.table, grades: entry ? [entry, ...s.grades].slice(0, 40) : s.grades }));
          if (entry && !entry.correct) sound(sndWrong, 0.05);
          if (decision === 'PLAY') sound(sndChip, 0, 2);
          else sound(sndFold, 0);

          if (res.table.phase === 'SHOWDOWN') {
            set({ busy: true });
            later(runShowdown, ms(TIMING.beforeReveal));
            return;
          }
          sound(sndFlip, 0.2);
          if (get().autoplay) scheduleBot();
        },

        playForMe() {
          const t = get().table;
          if (get().busy || t.phase !== 'DECIDING' || !t.focus) return;
          const choice = choose(t, get().bot);
          if (choice) get().decide(choice);
        },

        toggleAutoplay() {
          const on = !get().autoplay;
          set({ autoplay: on });
          get().toast(on ? 'Autoplay on.' : 'Autoplay off.', 'ok');
          if (!on || get().busy) return;
          const phase = get().table.phase;
          if (phase === 'BETTING') later(() => get().deal(), 300);
          else if (phase === 'DECIDING') scheduleBot();
        },

        /* ---------- the table ---------- */

        setSeatOccupied(seatId, occupied) {
          if (apply(setSeatOccupiedIn(get().table, seatId, occupied))) sound(sndClick, 0);
        },

        renameSeat(seatId, name) {
          apply(renameSeatIn(get().table, seatId, name));
        },

        setRules(rules) {
          if (apply(setRulesIn(get().table, rules))) sound(sndClick, 0);
        },

        applyPreset(id) {
          const preset = presetById(id);
          set((s) => ({ prefs: { ...s.prefs, presetId: preset.id } }));
          get().setRules({ ...preset.rules });
        },

        newSession(seed) {
          clearTimers();
          rng = createRng(seed ?? randomSeed());
          const { table } = get();
          set({
            table: createTable(table.rules, { seats: table.seats.filter((s) => s.occupied).length }),
            settlements: [],
            grades: [],
            busy: false,
            dealing: false,
            autoplay: false,
            lastBets: new Map(),
          });
          sound(sndShuffle, 0);
          get().toast('New session.', 'ok');
        },

        /* ---------- preferences ---------- */

        setPref(key, value) {
          set((s) => ({ prefs: { ...s.prefs, [key]: value } }));
          if (key === 'sound') setAudioEnabled(value as boolean);
        },

        setBot(key, value) {
          set((s) => ({ bot: { ...s.bot, [key]: value } }));
        },

        openDialog(d) {
          sound(sndClick, 0);
          set({ dialog: d });
        },

        toast(text, tone = 'ok') {
          const id = ++toastId;
          set((s) => ({ toasts: [...s.toasts, { id, text, tone }].slice(-4) }));
          later(() => get().dismissToast(id), 2600);
        },

        dismissToast(id) {
          set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
        },
      };
    },
    {
      name: 'knotz-three-card-poker',
      storage: createJSONStorage(debouncedLocalStorage),
      /*
       * Bump this with any required field added to persisted state, and decide
       * where the old shape is brought forward — a branch in a `migrate`, or a
       * documented fallback at the point of use. The blackjack table shipped a
       * required field without one and a saved session stopped loading.
       */
      version: 1,
      /**
       * The table, the preferences and the bot, and nothing about the moment.
       * Toasts, grades, the settlement overlay and the driver's flags describe
       * a moment that has passed by the time the page comes back.
       *
       * `lastBets` is a Map and JSON has no Maps, so it is deliberately not
       * persisted rather than silently coming back as `{}`.
       */
      partialize: (s) => ({ table: s.table, prefs: s.prefs, bot: s.bot }),
      merge: (persisted, current) => {
        const merged = { ...current, ...(persisted as Partial<GameStore>) };
        // A round in flight when the tab closed cannot be resumed honestly:
        // its timers are gone. `abandonRound` returns what is owed, and knows
        // not to return it twice for a round already paid.
        if (merged.table) merged.table = abandonRound(merged.table);
        return {
          ...merged,
          lastBets: new Map(),
          toasts: [],
          grades: [],
          settlements: [],
          busy: false,
          dealing: false,
          autoplay: false,
          dialog: null,
        };
      },
    },
  ),
);

/* ------------------------------------------------------------------ *
 * Sound for a settlement
 * ------------------------------------------------------------------ */

/**
 * Score the end of a round with the loudest thing that happened, once.
 *
 * A bonus paid — the Ante Bonus, Pair Plus, the 6 Card Bonus — beats a win,
 * a win beats a push, and a table that won nothing gets the sweep.
 */
function scoreSounds(
  settlements: readonly Settlement[],
  sound: <A extends unknown[]>(fn: (...args: A) => void, ...args: A) => void,
): void {
  if (settlements.length === 0) return;
  const bonus = settlements.some((s) => s.kind !== 'ANTE' && s.kind !== 'PLAY' && s.net > 0);
  const won = settlements.some((s) => s.net > 0);
  const pushed = settlements.every((s) => s.net >= 0);

  if (bonus) sound(sndBonus, 0.1);
  else if (won) sound(sndWin, 0.1);
  else if (pushed) sound(sndPushResult, 0.1);
  else sound(sndLose, 0.1);
}

/* ------------------------------------------------------------------ *
 * Derived hooks
 * ------------------------------------------------------------------ */

/**
 * The exact advice for the seat in focus.
 *
 * A hook rather than a selector: a selector that builds an object returns a
 * new identity on every read and re-renders forever, which the blackjack store
 * found twice. Memoised on the table, which only changes when something did.
 */
export function useAdvice(): Advice | null {
  const table = useGame((s) => s.table);
  return useMemo(() => {
    if (table.phase !== 'DECIDING' || !table.focus) return null;
    return adviseSeat(seatOf(table, table.focus), table.rules);
  }, [table]);
}
