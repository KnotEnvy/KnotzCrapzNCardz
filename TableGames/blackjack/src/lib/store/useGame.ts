'use client';

/**
 * The single store the UI talks to.
 *
 * It owns four things: the table (pure engine state), the round's animation
 * schedule, the trainer's per-decision grading, and the handful of preferences
 * that decide how the felt behaves. Every money-moving call delegates to the
 * engine and swaps in whatever table comes back, so the store can never invent
 * a payout of its own.
 *
 * The one piece of real logic here is the round driver. A round at a real
 * table is paced — cards come out one at a time, the dealer pauses before
 * turning the hole card, the settlement sits on the felt long enough to read.
 * The engine has no clock, so the pacing lives here as a queue of timeouts
 * that call engine functions. Everything the driver does, a player could do by
 * hand; it is a metronome, not a second rulebook.
 */

import { useMemo } from 'react';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  initAudio,
  sndBlackjack,
  sndBust,
  sndCard,
  sndChip,
  sndClick,
  sndCutCard,
  sndDeny,
  sndFlip,
  sndLose,
  sndPushResult,
  sndShuffle,
  sndWin,
  sndWrong,
  setAudioEnabled,
} from '@/lib/audio';
import { settle } from '@/lib/engine/resolve';
import { createRng, randomSeed, type Rng } from '@/lib/engine/rng';
import { DEFAULT_PRESET, defaultRules, estimateHouseEdge, presetById } from '@/lib/engine/rules';
import { penetrationSoFar } from '@/lib/engine/shoe';
import {
  clearBets,
  closeOffers,
  createTable,
  deal as dealCards,
  dealerStep,
  double as doubleDown,
  hit as hitHand,
  legalActions,
  abandonRound,
  nextRound,
  rebet as rebetTable,
  recordDecision,
  rebuy as rebuySeat,
  renameSeat as renameSeatIn,
  reshuffle as reshuffleShoe,
  seatOf,
  setBet as setBetIn,
  setRules as setRulesIn,
  setSeatOccupied as setSeatOccupiedIn,
  setSideBet as setSideBetIn,
  split as splitHand,
  stand as standHand,
  surrender as surrenderHand,
  takeEvenMoney as takeEvenMoneyIn,
  takeInsurance as takeInsuranceIn,
  type ActionResult,
} from '@/lib/engine/table';
import type {
  Action,
  SeatId,
  Settlement,
  SideBetKind,
  SideBetWager,
  TableRules,
  TableState,
} from '@/lib/engine/types';
import { advise, type Advice } from '@/lib/strategy/basic';
import { decide, DEFAULT_BOT, type BotConfig } from '@/lib/strategy/autoplay';
import { countTable, insuranceIsGood, type CountSystem } from '@/lib/strategy/counting';

/* ------------------------------------------------------------------ *
 * Pacing
 * ------------------------------------------------------------------ */

/**
 * How long each beat of a round takes, at normal speed.
 *
 * These were set by playing, not by reasoning. The deal is fast because a
 * dealer's hands are fast; the pause before the hole card is the longest gap
 * in the round because that is the moment the table is watching; the
 * settlement holds long enough to read four hands of numbers and no longer.
 */
const TIMING = {
  dealCard: 190,
  beforePeek: 420,
  dealerCard: 520,
  beforeSettle: 380,
  settleHold: 2400,
  botThink: 620,
} as const;

export type Speed = 'RELAXED' | 'NORMAL' | 'FAST';

const SPEED_SCALE: Record<Speed, number> = { RELAXED: 1.5, NORMAL: 1, FAST: 0.35 };

/* ------------------------------------------------------------------ *
 * Toasts
 * ------------------------------------------------------------------ */

export interface Toast {
  id: number;
  text: string;
  tone: 'ok' | 'warn' | 'win';
}

let toastId = 0;

/* ------------------------------------------------------------------ *
 * Trainer
 * ------------------------------------------------------------------ */

/** One graded decision, shown as a card in the trainer panel and then dropped. */
export interface Grade {
  id: number;
  correct: boolean;
  played: Action;
  best: Action;
  why: string;
  hand: string;
  upcard: string;
}

let gradeId = 0;

/* ------------------------------------------------------------------ *
 * The store
 * ------------------------------------------------------------------ */

/**
 * The RNG lives outside the store: it is a stream, not a value.
 *
 * Putting it in the state would mean persisting it, and a persisted PRNG that
 * resumes from a stale position is worse than a fresh one — it looks
 * reproducible and is not.
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
  /** Show the basic-strategy advice before the play is made. */
  hints: boolean;
  /** Grade every decision against the chart afterwards. */
  trainer: boolean;
  /** Show the running and true count, and the deviation when one applies. */
  counting: boolean;
  countSystem: CountSystem;
  /** The stats and chart drawer, open beside the felt on a wide screen. */
  panelOpen: boolean;
  /** Which chip the rack has selected, in cents. */
  chip: number;
  presetId: string;
}

/**
 * On a wide screen the stats panel earns its place beside the felt. On a
 * smaller one it would squeeze the table below readable, so it starts closed
 * and opens as a drawer. A returning player's own choice overrides this.
 */
const WIDE_ENOUGH_FOR_PANEL = 1180;
const panelDefault = typeof window === 'undefined' || window.innerWidth >= WIDE_ENOUGH_FOR_PANEL;

export interface GameStore {
  table: TableState;
  prefs: Prefs;
  bot: BotConfig;

  /** True while the driver owns the table and the player's buttons are dead. */
  busy: boolean;
  /** Set while a bot is playing the seat for the player. */
  autoplay: boolean;
  /** The settlements from the round just finished, for the felt to show. */
  settlements: Settlement[];
  toasts: Toast[];
  grades: Grade[];
  /** Last round's wagers, so "same bet" is one button. */
  lastBets: Map<SeatId, { main: number; side: SideBetWager[] }>;
  /** Which dialog is open, if any. */
  dialog: null | 'setup' | 'chart' | 'rules' | 'sidebets' | 'help';

  /* --- betting --- */
  setChip(cents: number): void;
  addChip(seat: SeatId): void;
  addSideChip(seat: SeatId, kind: SideBetKind): void;
  setBet(seat: SeatId, cents: number): void;
  clearBet(seat?: SeatId): void;
  rebet(): void;
  rebuy(seat: SeatId, cents: number): void;

  /* --- the round --- */
  deal(): void;
  act(action: Action): void;
  takeInsurance(seat: SeatId, cents: number): void;
  declineInsurance(): void;
  takeEvenMoney(seat: SeatId): void;
  playForMe(): void;
  toggleAutoplay(): void;

  /* --- the table --- */
  setSeatOccupied(seat: SeatId, occupied: boolean): void;
  renameSeat(seat: SeatId, name: string): void;
  setRules(rules: TableRules): void;
  applyPreset(id: string): void;
  reshuffle(): void;
  newSession(seed?: string): void;

  /* --- preferences and chrome --- */
  setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void;
  setBot<K extends keyof BotConfig>(key: K, value: BotConfig[K]): void;
  openDialog(d: GameStore['dialog']): void;
  toast(text: string, tone?: Toast['tone']): void;
  dismissToast(id: number): void;

  /* --- derived --- */
  /*
   * These compute a fresh value on every call, so they must never be used as
   * zustand selectors — `useGame((s) => s.count())` subscribes a component to
   * a new object identity on every store read, which is an infinite render
   * loop. Call them off `useGame.getState()`, or use the `useAdvice` and
   * `useCount` hooks below, which memoise on the inputs that actually change.
   */
  advice(): Advice | null;
  count(): ReturnType<typeof countTable>;
  houseEdge(): number;
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
      const apply = (res: ActionResult, onOk?: (t: TableState) => void): boolean => {
        if (!res.ok) {
          sound(sndDeny, 0);
          get().toast(res.reason, 'warn');
          return false;
        }
        set({ table: res.table });
        if (res.note) get().toast(res.note, 'ok');
        onOk?.(res.table);
        return true;
      };

      /* ---------- the round driver ---------- */

      /**
       * Walk the dealer's hand, one card at a time, then settle.
       *
       * Recursive-by-timeout rather than a loop, because the whole point is
       * the gap between the cards. Each step calls the engine once and
       * schedules the next only if the engine says the hand is not finished.
       */
      const runDealer = () => {
        const t = get().table;
        if (t.phase !== 'DEALER') return;

        const before = t.dealer.cards.length;
        const holeWasDown = t.dealer.holeDown;
        const res = dealerStep(t);
        if (!res.ok) return;
        set({ table: res.table });

        if (holeWasDown) sound(sndFlip, 0);
        else if (res.table.dealer.cards.length > before) sound(sndCard, 0, 0.7);

        if (res.table.phase === 'SETTLE') {
          later(finishRound, ms(TIMING.beforeSettle));
        } else {
          later(runDealer, ms(TIMING.dealerCard));
        }
      };

      const finishRound = () => {
        const t = get().table;
        if (t.phase !== 'SETTLE') return;
        const trueCount = countTable(t, get().prefs.countSystem).true;
        const { table, settlements } = settle(t, trueCount);

        set({ table, settlements });
        scoreSounds(settlements, sound);

        later(() => {
          const cleared = nextRound(get().table);
          if (cleared.ok) {
            set({ table: cleared.table, settlements: [], busy: false });
            if (cleared.table.shoe.cutReached) sound(sndCutCard, 0);
            if (get().autoplay) later(() => get().deal(), ms(500));
          } else {
            set({ busy: false });
          }
        }, ms(TIMING.settleHold));
      };

      /** Hand the round to the dealer, or straight to settlement. */
      const advancePhase = () => {
        const t = get().table;
        if (t.phase === 'DEALER') {
          later(runDealer, ms(TIMING.beforePeek));
          return;
        }
        if (t.phase === 'PLAYER' && get().autoplay) {
          later(botMove, ms(TIMING.botThink));
          return;
        }
        set({ busy: false });
      };

      const botMove = () => {
        const t = get().table;
        if (t.phase !== 'PLAYER' || !t.focus) {
          advancePhase();
          return;
        }
        const choice = decide(t, get().bot);
        if (!choice) {
          set({ busy: false });
          return;
        }
        get().act(choice.action);
      };

      /* ---------- initial state ---------- */

      const rules = defaultRules();

      return {
        table: createTable(rules, rng, { seats: 1 }),
        prefs: {
          sound: true,
          speed: 'NORMAL',
          hints: false,
          trainer: false,
          counting: false,
          countSystem: 'HI_LO',
          panelOpen: panelDefault,
          chip: 2500,
          presetId: DEFAULT_PRESET,
        },
        bot: { ...DEFAULT_BOT },
        busy: false,
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

        addChip(seatId) {
          initAudio();
          const { table, prefs } = get();
          const seat = seatOf(table, seatId);
          const next = seat.pendingBet + prefs.chip;
          if (apply(setBetIn(table, seatId, next))) sound(sndChip, 0, 1);
        },

        addSideChip(seatId, kind) {
          initAudio();
          const { table, prefs } = get();
          const seat = seatOf(table, seatId);
          const current = seat.pendingSideBets.find((sb) => sb.kind === kind)?.amount ?? 0;
          if (apply(setSideBetIn(table, seatId, kind, current + prefs.chip))) sound(sndChip, 0, 1);
        },

        setBet(seatId, cents) {
          apply(setBetIn(get().table, seatId, cents));
        },

        clearBet(seatId) {
          if (apply(clearBets(get().table, seatId))) sound(sndClick, 0);
        },

        rebet() {
          const { table, lastBets } = get();
          if (apply(rebetTable(table, lastBets))) sound(sndChip, 0, 2);
        },

        rebuy(seatId, cents) {
          if (apply(rebuySeat(get().table, seatId, cents))) {
            sound(sndChip, 0, 3);
            get().toast('Rebuy.', 'ok');
          }
        },

        /* ---------- the round ---------- */

        deal() {
          initAudio();
          const { table } = get();
          if (get().busy) return;

          const bets = new Map<SeatId, { main: number; side: SideBetWager[] }>();
          for (const s of table.seats) {
            if (s.pendingBet > 0) {
              bets.set(s.id, { main: s.pendingBet, side: s.pendingSideBets.map((sb) => ({ ...sb })) });
            }
          }

          const shuffling = table.shoe.cutReached;
          if (!apply(dealCards(table, rng), (t) => {
            set({ lastBets: bets, settlements: [], busy: true });
            if (shuffling) sound(sndShuffle, 0);
            const offset = shuffling ? 0.7 : 0;
            const cards = t.seats.filter((s) => s.hands.length > 0).length * 2 + t.dealer.cards.length;
            for (let i = 0; i < cards; i++) sound(sndCard, offset + i * 0.14, 0.4 + (i % 3) * 0.12);

            // A natural anywhere on the felt is worth hearing immediately.
            const naturals = t.seats.filter((s) => s.hands[0]?.done && s.hands[0]?.cards.length === 2);
            if (naturals.length > 0) sound(sndBlackjack, offset + cards * 0.14 + 0.2);
          })) {
            return;
          }

          const after = get().table;
          if (after.phase === 'DEALER') {
            later(runDealer, ms(TIMING.beforePeek + 400));
          } else if (after.phase === 'PLAYER') {
            set({ busy: false });
            if (get().autoplay) later(botMove, ms(TIMING.botThink));
          } else {
            // The offers are open; the player decides and the driver waits.
            set({ busy: false });
            if (get().autoplay) {
              const count = countTable(after, get().prefs.countSystem);
              if (get().bot.deviations && insuranceIsGood(count.true)) {
                for (const s of after.seats) {
                  if (s.hands.length > 0) get().takeInsurance(s.id, Math.floor(s.hands[0].bet / 2));
                }
              }
              later(() => get().declineInsurance(), ms(TIMING.botThink));
            }
          }
        },

        act(action) {
          initAudio();
          const { table, prefs } = get();
          if (table.phase !== 'PLAYER' && table.phase !== 'INSURANCE') return;

          // Grade before the move, while the hand it was made on still exists.
          if (prefs.trainer && table.focus) {
            const seat = seatOf(table, table.focus.seat);
            const hand = seat.hands[table.focus.hand];
            const up = table.dealer.cards[0];
            const best = advise(hand, up, legalActions(table), table.rules);
            if (best && hand && up) {
              const correct = best.action === action;
              const grade: Grade = {
                id: ++gradeId,
                correct,
                played: action,
                best: best.action,
                why: best.why,
                hand: hand.cards.map((c) => `${c.rank}`).join('-'),
                upcard: `${up.rank}`,
              };
              set((s) => ({
                grades: [grade, ...s.grades].slice(0, 40),
                table: recordDecision(s.table, table.focus!.seat, correct),
              }));
              if (!correct) sound(sndWrong, 0.05);
            }
          }

          const before = table.focus ? seatOf(table, table.focus.seat).hands[table.focus.hand] : null;
          const cardsBefore = before?.cards.length ?? 0;

          const res =
            action === 'HIT'
              ? hitHand(table)
              : action === 'STAND'
                ? standHand(table)
                : action === 'DOUBLE'
                  ? doubleDown(table)
                  : action === 'SPLIT'
                    ? splitHand(table)
                    : surrenderHand(table);

          if (!apply(res)) return;

          const after = get().table;
          if (action === 'DOUBLE') sound(sndChip, 0, 2);
          if (action === 'SPLIT') {
            sound(sndChip, 0, 2);
            sound(sndCard, 0.18, 0.6);
            sound(sndCard, 0.34, 0.6);
          }
          if (action === 'HIT' || action === 'DOUBLE') {
            const focusSeat = table.focus ? seatOf(after, table.focus.seat) : null;
            const hand = focusSeat?.hands[table.focus!.hand];
            if (hand && hand.cards.length > cardsBefore) sound(sndCard, 0, 0.75);
            if (hand?.outcome === 'BUST') sound(sndBust, 0.22);
          }
          if (action === 'STAND') sound(sndClick, 0);

          // Early surrender happens during the offers and must not skip the peek.
          if (after.phase === 'INSURANCE') {
            if (!after.focus) get().declineInsurance();
            return;
          }
          advancePhase();
        },

        takeInsurance(seatId, cents) {
          if (apply(takeInsuranceIn(get().table, seatId, cents))) sound(sndChip, 0, 1);
        },

        declineInsurance() {
          if (apply(closeOffers(get().table))) {
            set({ busy: true });
            advancePhase();
          }
        },

        takeEvenMoney(seatId) {
          if (apply(takeEvenMoneyIn(get().table, seatId))) {
            sound(sndChip, 0, 1);
            get().declineInsurance();
          }
        },

        playForMe() {
          const t = get().table;
          if (t.phase !== 'PLAYER' || !t.focus) return;
          const choice = decide(t, get().bot);
          if (choice) get().act(choice.action);
        },

        toggleAutoplay() {
          const on = !get().autoplay;
          set({ autoplay: on });
          get().toast(on ? 'Autoplay on — the chart is playing.' : 'Autoplay off.', 'ok');
          if (on && get().table.phase === 'BETTING' && !get().busy) later(() => get().deal(), 300);
        },

        /* ---------- the table ---------- */

        setSeatOccupied(seatId, occupied) {
          apply(setSeatOccupiedIn(get().table, seatId, occupied));
        },

        renameSeat(seatId, name) {
          apply(renameSeatIn(get().table, seatId, name));
        },

        setRules(rules) {
          if (apply(setRulesIn(get().table, rules, rng))) sound(sndShuffle, 0);
        },

        applyPreset(id) {
          const preset = presetById(id);
          set((s) => ({ prefs: { ...s.prefs, presetId: id } }));
          get().setRules({ ...preset.rules, sideBets: { ...preset.rules.sideBets } });
        },

        reshuffle() {
          if (apply(reshuffleShoe(get().table, rng))) sound(sndShuffle, 0);
        },

        newSession(seed) {
          clearTimers();
          rng = createRng(seed ?? randomSeed());
          const { table } = get();
          set({
            table: createTable(table.rules, rng, {
              seats: table.seats.filter((s) => s.occupied).length,
            }),
            settlements: [],
            grades: [],
            busy: false,
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

        /* ---------- derived ---------- */

        advice() {
          const t = get().table;
          if (!t.focus || t.phase !== 'PLAYER') return null;
          const seat = seatOf(t, t.focus.seat);
          return advise(seat.hands[t.focus.hand], t.dealer.cards[0], legalActions(t), t.rules);
        },

        count() {
          return countTable(get().table, get().prefs.countSystem);
        },

        houseEdge() {
          return estimateHouseEdge(get().table.rules);
        },
      };
    },
    {
      name: 'knotz-blackjack',
      storage: createJSONStorage(() => localStorage),
      /*
       * Bumped when ShoeState gained a required `seed`. A shoe persisted by
       * version 1 comes back without one, and the first mid-round reshuffle
       * then calls `createRng(undefined)` and throws — the crash the reshuffle
       * was added to fix, resurrected for anyone upgrading rather than
       * arriving fresh. Any change that adds a required field to persisted
       * state has to come with a bump here.
       */
      version: 2,
      /**
       * What survives a reload.
       *
       * The table and the preferences, and nothing else. Toasts, grades, the
       * settlement overlay and the driver's busy flag are all about a moment
       * that has passed by the time the page comes back; persisting them would
       * restore a table frozen mid-animation with a dead button bar.
       *
       * `lastBets` is a Map and JSON has no Maps, so it is deliberately not
       * persisted rather than silently coming back as `{}` and breaking the
       * re-bet button.
       */
      partialize: (s) => ({ table: s.table, prefs: s.prefs, bot: s.bot }),
      /** A persisted table can come back mid-round; see `abandonRound`. */
      merge: (persisted, current) => {
        const merged = { ...current, ...(persisted as Partial<GameStore>) };
        /*
         * A round in flight when the tab closed is abandoned rather than
         * resumed — the driver's timers are gone and the money is half
         * committed. `abandonRound` is engine code because it moves money, and
         * it knows the one thing this used to get wrong: a round parked at
         * SETTLE for the settlement hold has already been paid, so refunding
         * the stakes still shown on the felt is free money.
         */
        if (merged.table) merged.table = abandonRound(merged.table);
        return { ...merged, lastBets: new Map(), toasts: [], grades: [], settlements: [], busy: false, autoplay: false };
      },
    },
  ),
);

/* ------------------------------------------------------------------ *
 * Sound for a settlement
 * ------------------------------------------------------------------ */

/**
 * Score the end of a round.
 *
 * One sound per outcome would be a pile-up on a four-hand split, so this picks
 * the loudest thing that happened and plays that: a blackjack beats a win,
 * a win beats a push, and a table that lost everything gets the sweep once.
 */
function scoreSounds(
  settlements: readonly Settlement[],
  sound: <A extends unknown[]>(fn: (...args: A) => void, ...args: A) => void,
): void {
  if (settlements.length === 0) return;
  const main = settlements.filter((s) => s.kind === 'MAIN');
  const blackjack = main.some((s) => s.label === 'Blackjack' && s.net > 0);
  const won = main.some((s) => s.net > 0);
  const pushed = main.some((s) => s.net === 0);
  const bigSide = settlements.some((s) => s.kind === 'SIDE' && s.net > 0);

  if (blackjack) sound(sndBlackjack, 0.1);
  else if (won) sound(sndWin, 0.1);
  else if (pushed) sound(sndPushResult, 0.1);
  else sound(sndLose, 0.1);

  if (bigSide && !blackjack) sound(sndChip, 0.5, 3);
}

/* ------------------------------------------------------------------ *
 * Derived hooks
 * ------------------------------------------------------------------ */

/**
 * The chart's advice for the hand in focus.
 *
 * A hook rather than a selector, and the distinction is not stylistic: a
 * selector that builds an object returns a new identity every time zustand
 * reads it, React sees the value change on every render, and the component
 * re-renders forever. Memoising on the three things the answer depends on
 * makes the identity stable between decisions.
 */
export function useAdvice(): Advice | null {
  const table = useGame((s) => s.table);
  return useMemo(() => {
    if (!table.focus || table.phase !== 'PLAYER') return null;
    const seat = seatOf(table, table.focus.seat);
    const hand = seat.hands[table.focus.hand];
    if (!hand) return null;
    return advise(hand, table.dealer.cards[0], legalActions(table), table.rules);
  }, [table]);
}

/** The count, memoised on the shoe and the system rather than rebuilt per render. */
export function useCount(): ReturnType<typeof countTable> {
  const table = useGame((s) => s.table);
  const system = useGame((s) => s.prefs.countSystem);
  return useMemo(() => countTable(table, system), [table, system]);
}

/** Where the shoe is, 0..1. Selected by the penetration meter on its own. */
export function selectPenetration(s: GameStore): number {
  return penetrationSoFar(s.table.shoe);
}
