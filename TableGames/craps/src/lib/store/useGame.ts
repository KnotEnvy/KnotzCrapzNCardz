'use client';

/**
 * The single store the UI talks to.
 *
 * It owns three things: the table (pure engine state), the dice animation in
 * flight, and the handful of preferences that decide how the felt behaves.
 * Every money-moving call delegates to the engine and swaps in whatever table
 * comes back, so the store can never invent a payout of its own.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { RollAnimation } from '@/lib/dice/simulate';
import { initDicePhysics, simulateThrow } from '@/lib/dice/simulate';
import { applyRoll } from '@/lib/engine/resolve';
import {
  ACROSS_NUMBERS,
  INSIDE_NUMBERS,
  OUTSIDE_NUMBERS,
  betSpec,
  createTable,
  maxOddsAll,
  placeBet,
  placeGroup,
  powerPressNumber,
  pressNumber,
  rebuy,
  refreshWorkingDefaults,
  sameAction,
  setAllWorking,
  setOdds,
  setWorking,
  takeDown,
  takeDownAll,
  type ActionResult,
  type BetSpec,
} from '@/lib/engine/table';
import { createRng, randomSeed, rollDice, type Rng } from '@/lib/engine/rng';
import type {
  PointNumber,
  Roll,
  SeatId,
  Settlement,
  TableRules,
  TableState,
} from '@/lib/engine/types';
import { POINT_NUMBERS } from '@/lib/engine/types';

export type NumberMode = 'PLACE' | 'BUY' | 'LAY';

/** The grouped place calls, and the numbers each one covers. */
export type BetGroup = 'INSIDE' | 'OUTSIDE' | 'ACROSS';

const GROUPS: Record<BetGroup, { numbers: readonly PointNumber[]; label: string }> = {
  INSIDE: { numbers: INSIDE_NUMBERS, label: 'inside' },
  OUTSIDE: { numbers: OUTSIDE_NUMBERS, label: 'outside' },
  ACROSS: { numbers: ACROSS_NUMBERS, label: 'across' },
};

export interface Toast {
  id: number;
  text: string;
  tone: 'ok' | 'warn' | 'win';
}

/**
 * On a wide screen the stats panel earns its place beside the felt. On a
 * smaller one it would squeeze the table below readable, so it starts closed
 * and opens as a drawer. A returning player's own choice overrides this.
 */
const WIDE_ENOUGH_FOR_HUD = 1280;
const hudDefault = typeof window === 'undefined' || window.innerWidth >= WIDE_ENOUGH_FOR_HUD;

/** The dice RNG lives outside the store: it is a stream, not a value. */
let rng: Rng = createRng(randomSeed());
let toastId = 0;

/**
 * Dice playback is driven by requestAnimationFrame, which browsers pause in a
 * hidden tab. Without a wall-clock backstop, switching tabs mid-throw would
 * leave the table stuck on "dice are out" forever. setTimeout is throttled in
 * the background rather than suspended, so the roll still settles.
 */
let settleFallback: ReturnType<typeof setTimeout> | null = null;

function clearSettleFallback() {
  if (settleFallback !== null) {
    clearTimeout(settleFallback);
    settleFallback = null;
  }
}

/**
 * How long the win and loss figures stay on the felt after a roll.
 *
 * They used to sit there until the next roll, which on a slow table meant a
 * stale row of numbers over live bets. A seven out clears faster: the losses
 * register, then the layout is swept for the next shooter.
 */
const SETTLEMENT_HOLD_MS = 2600;
const SEVEN_OUT_HOLD_MS = 1800;

let settlementHold: ReturnType<typeof setTimeout> | null = null;

function clearSettlementHold() {
  if (settlementHold !== null) {
    clearTimeout(settlementHold);
    settlementHold = null;
  }
}

/** The box number the last roll landed on, or null if it was not one. */
function hitNumber(roll: Roll | null): PointNumber | null {
  if (!roll) return null;
  return POINT_NUMBERS.includes(roll.total as PointNumber) ? (roll.total as PointNumber) : null;
}

function holdSettlements(
  set: (fn: (s: GameState) => Partial<GameState>) => void,
  sevenOut: boolean,
) {
  clearSettlementHold();
  settlementHold = setTimeout(
    () => {
      settlementHold = null;
      set(() => ({ settlements: [] }));
    },
    sevenOut ? SEVEN_OUT_HOLD_MS : SETTLEMENT_HOLD_MS,
  );
}

interface GameState {
  table: TableState;
  seed: string;

  /* Dice */
  rolling: boolean;
  animation: RollAnimation | null;
  pendingRoll: Roll | null;
  lastRoll: Roll | null;
  settlements: Settlement[];
  physicsReady: boolean;

  /** Whether a session has been set up. False shows the start screen. */
  sessionStarted: boolean;

  /* Preferences */
  chip: number;
  numberMode: NumberMode;
  fastRoll: boolean;
  showHud: boolean;
  soundOn: boolean;

  /* Transient UI */
  toast: Toast | null;
  /** Bets that came down last roll, per seat, so "same action" can repeat them. */
  lastAction: Record<SeatId, Array<{ spec: BetSpec; amount: number }>>;

  /* Actions */
  initPhysics: () => Promise<void>;
  newSession: (opts: {
    seatAName: string;
    seatBName: string;
    buyIn: number;
    solo?: boolean;
    rules?: Partial<TableRules>;
  }) => void;
  reseed: (seed?: string) => void;

  setChip: (chip: number) => void;
  setNumberMode: (mode: NumberMode) => void;
  setActiveSeat: (seat: SeatId) => void;
  toggleFastRoll: () => void;
  toggleHud: () => void;
  toggleSound: () => void;
  updateRules: (rules: Partial<TableRules>) => void;
  renameSeat: (seat: SeatId, name: string) => void;
  addChips: (seat: SeatId, amount: number) => void;

  wager: (spec: BetSpec, amount?: number) => void;
  betGroup: (group: BetGroup) => void;
  adjustOdds: (betId: string, amount: number) => void;
  maxOdds: () => void;
  clearBet: (betId: string) => void;
  clearAll: () => void;
  press: (units?: number) => void;
  powerPress: () => void;
  toggleWorking: (betId: string) => void;
  allWorking: (working: boolean) => void;
  repeatLastAction: () => void;

  throwDice: () => void;
  settleDice: () => void;
  dismissToast: () => void;
}

function toast(set: (fn: (s: GameState) => Partial<GameState>) => void, text: string, tone: Toast['tone'] = 'ok') {
  toastId += 1;
  const id = toastId;
  set(() => ({ toast: { id, text, tone } }));
}

export const useGame = create<GameState>()(
  persist(
    (set, get) => {
      /** Applies an engine result, surfacing any refusal as a toast. */
      const commit = (res: ActionResult, successTone: Toast['tone'] = 'ok') => {
        if (!res.ok) {
          toast(set, res.reason, 'warn');
          return false;
        }
        set(() => ({ table: res.state }));
        if (res.message) toast(set, res.message, successTone);
        return true;
      };

      return {
        table: createTable(),
        seed: randomSeed(),

        rolling: false,
        animation: null,
        pendingRoll: null,
        lastRoll: null,
        settlements: [],
        physicsReady: false,

        sessionStarted: false,

        chip: 25,
        numberMode: 'PLACE',
        fastRoll: false,
        showHud: hudDefault,
        soundOn: true,

        toast: null,
        lastAction: { A: [], B: [] },

        async initPhysics() {
          if (get().physicsReady) return;
          await initDicePhysics();
          set(() => ({ physicsReady: true }));
        },

        newSession(opts) {
          clearSettleFallback();
          clearSettlementHold();
          const seed = randomSeed();
          rng = createRng(seed);
          set(() => ({
            table: createTable(opts),
            seed,
            sessionStarted: true,
            animation: null,
            lastRoll: null,
            settlements: [],
            rolling: false,
            pendingRoll: null,
            lastAction: { A: [], B: [] },
          }));
          toast(set, opts.solo ? 'Table is yours. Good luck.' : 'New session. Good luck.', 'ok');
        },

        reseed(seed) {
          const s = seed ?? randomSeed();
          rng = createRng(s);
          set(() => ({ seed: s }));
          toast(set, `Dice reseeded to ${s.slice(0, 12)}`, 'ok');
        },

        setChip: (chip) => set(() => ({ chip })),
        setNumberMode: (numberMode) => set(() => ({ numberMode })),
        setActiveSeat: (seat) =>
          set((s) => ({ table: { ...s.table, activeSeat: seat } })),
        toggleFastRoll: () => set((s) => ({ fastRoll: !s.fastRoll })),
        toggleHud: () => set((s) => ({ showHud: !s.showHud })),
        toggleSound: () => set((s) => ({ soundOn: !s.soundOn })),

        updateRules(rules) {
          set((s) => ({
            table: refreshWorkingDefaults({
              ...s.table,
              rules: { ...s.table.rules, ...rules },
            }),
          }));
        },

        renameSeat(seat, name) {
          set((s) => ({
            table: {
              ...s.table,
              seats: { ...s.table.seats, [seat]: { ...s.table.seats[seat], name } },
            },
          }));
        },

        addChips(seat, amount) {
          set((s) => ({ table: rebuy(s.table, seat, amount) }));
          toast(set, `${get().table.seats[seat].name} bought in for $${amount}`, 'ok');
        },

        wager(spec, amount) {
          const { table, chip, rolling } = get();
          if (rolling) {
            toast(set, 'Dice are out', 'warn');
            return;
          }
          // `fromChip` only when the amount really is a rack denomination, so
          // the six and eight convert their five-dollar units into sixes.
          commit(
            placeBet(table, table.activeSeat, spec, amount ?? chip, {
              fromChip: amount === undefined,
            }),
          );
        },

        betGroup(group) {
          const { table, chip, rolling } = get();
          if (rolling) {
            toast(set, 'Dice are out', 'warn');
            return;
          }
          const { numbers, label } = GROUPS[group];
          commit(placeGroup(table, table.activeSeat, numbers, chip, label));
        },

        adjustOdds(betId, amount) {
          if (get().rolling) return;
          commit(setOdds(get().table, betId, amount));
        },

        maxOdds() {
          const { table } = get();
          commit(maxOddsAll(table, table.activeSeat));
        },

        clearBet(betId) {
          if (get().rolling) {
            toast(set, 'Dice are out', 'warn');
            return;
          }
          commit(takeDown(get().table, betId));
        },

        clearAll() {
          const { table } = get();
          commit(takeDownAll(table, table.activeSeat));
        },

        press(units = 1) {
          const { table, lastRoll } = get();
          const number = hitNumber(lastRoll);
          if (number === null) {
            toast(set, 'Press works on the number that just hit', 'warn');
            return;
          }
          commit(pressNumber(table, table.activeSeat, number, units));
        },

        powerPress() {
          const { table, lastRoll } = get();
          const number = hitNumber(lastRoll);
          if (number === null) {
            toast(set, 'Power press works on the number that just hit', 'warn');
            return;
          }
          commit(powerPressNumber(table, table.activeSeat, number));
        },

        toggleWorking(betId) {
          const { table } = get();
          const bet = table.bets.find((b) => b.id === betId);
          if (!bet) return;
          commit(setWorking(table, betId, !bet.working));
        },

        allWorking(working) {
          const { table } = get();
          commit(setAllWorking(table, table.activeSeat, working));
        },

        repeatLastAction() {
          const { table, lastAction } = get();
          commit(sameAction(table, table.activeSeat, lastAction[table.activeSeat]));
        },

        throwDice() {
          const state = get();
          if (state.rolling) return;

          const roll = rollDice(rng);

          clearSettlementHold();

          if (state.fastRoll || !state.physicsReady) {
            const { state: next, settlements } = applyRoll(state.table, roll);
            recordAction(set, state.table, next, settlements);
            set(() => ({
              table: next,
              lastRoll: roll,
              settlements,
              animation: null,
              rolling: false,
              pendingRoll: null,
            }));
            announce(set, settlements, next, roll);
            holdSettlements(set, isSevenOut(next));
            return;
          }

          const animation = simulateThrow(roll, () => rng.next());
          set(() => ({ rolling: true, animation, pendingRoll: roll, settlements: [] }));

          clearSettleFallback();
          const expectedMs = (animation.restIndex / 60) * 1000 + 1600;
          settleFallback = setTimeout(() => get().settleDice(), expectedMs);
        },

        settleDice() {
          clearSettleFallback();
          const state = get();
          if (!state.rolling || !state.pendingRoll) return;
          const roll = state.pendingRoll;
          const { state: next, settlements } = applyRoll(state.table, roll);
          recordAction(set, state.table, next, settlements);
          set(() => ({
            table: next,
            lastRoll: roll,
            settlements,
            rolling: false,
            pendingRoll: null,
          }));
          announce(set, settlements, next, roll);
          holdSettlements(set, isSevenOut(next));
        },

        dismissToast: () => set(() => ({ toast: null })),
      };
    },
    {
      name: 'knotz-craps-session',
      // Bumped whenever the saved table changes shape. A mismatched version is
      // discarded rather than migrated: a half-understood old session is worse
      // than a fresh table.
      version: 3,
      // An older save is dropped rather than guessed at. Returning an empty
      // object lets `merge` fall through to a fresh table without persist
      // logging a missing-migration error.
      migrate: () => ({}),
      partialize: (s) => ({
        table: s.table,
        seed: s.seed,
        sessionStarted: s.sessionStarted,
        chip: s.chip,
        numberMode: s.numberMode,
        fastRoll: s.fastRoll,
        showHud: s.showHud,
        soundOn: s.soundOn,
      }),
      /**
       * Belt and braces on top of the version check: if the saved table is
       * missing anything the current engine expects, deal a fresh one instead
       * of letting a half-shaped object reach the felt.
       */
      merge: (persisted, current) => {
        const saved = persisted as Partial<GameState> | undefined;
        const table = saved?.table as TableState | undefined;
        const usable =
          !!table &&
          typeof table.betSeq === 'number' &&
          typeof table.solo === 'boolean' &&
          !!table.stats &&
          Array.isArray(table.stats.totals) &&
          Array.isArray(table.bets) &&
          !!table.seats?.A &&
          !!table.seats?.B;
        return { ...current, ...saved, table: usable ? table : current.table };
      },
      onRehydrateStorage: () => (state) => {
        // Resume the dice stream where the saved session left off.
        if (state?.seed) rng = createRng(state.seed);
      },
    },
  ),
);

/* ------------------------------------------------------------------ *
 * Post-roll bookkeeping
 * ------------------------------------------------------------------ */

/** Whether the roll just applied ended the shooter's hand. */
function isSevenOut(table: TableState): boolean {
  return table.history[table.history.length - 1]?.outcome === 'SEVEN_OUT';
}

/** Remembers what came down so "Same Action" can put it straight back up. */
function recordAction(
  set: (fn: (s: GameState) => Partial<GameState>) => void,
  before: TableState,
  after: TableState,
  settlements: Settlement[],
) {
  const survivors = new Set(after.bets.map((b) => b.id));
  const resolved: Record<SeatId, Array<{ spec: BetSpec; amount: number }>> = { A: [], B: [] };

  for (const bet of before.bets) {
    if (survivors.has(bet.id)) continue;
    // Contract bets that simply won are worth repeating; the line handles itself.
    const wasSettled = settlements.some((s) => s.betId === bet.id);
    if (!wasSettled) continue;
    resolved[bet.seat].push({ spec: betSpec(bet), amount: bet.amount });
  }

  set(() => ({ lastAction: resolved }));
}

/** Turns the settlement list into one short line of table talk. */
function announce(
  set: (fn: (s: GameState) => Partial<GameState>) => void,
  settlements: Settlement[],
  table: TableState,
  roll: Roll,
) {
  const last = table.history[table.history.length - 1];
  const net = settlements.reduce((sum, s) => sum + s.net, 0);

  let headline: string;
  switch (last.outcome) {
    case 'NATURAL':
      headline = roll.total === 7 ? 'Seven, winner!' : 'Yo eleven!';
      break;
    case 'CRAPS':
      headline = roll.total === 12 ? 'Boxcars, craps' : roll.total === 2 ? 'Snake eyes, craps' : 'Ace deuce, craps';
      break;
    case 'POINT_ESTABLISHED':
      headline = `The point is ${roll.total}`;
      break;
    case 'POINT_MADE':
      headline = `${roll.total}! Winner on the point`;
      break;
    case 'SEVEN_OUT':
      headline = 'Seven out, line away';
      break;
    default:
      headline =
        roll.d1 === roll.d2 && [4, 6, 8, 10].includes(roll.total)
          ? `Hard ${roll.total}`
          : `${roll.total}`;
  }

  const money = net > 0 ? ` +$${Math.round(net).toLocaleString()}` : net < 0 ? ` -$${Math.abs(Math.round(net)).toLocaleString()}` : '';
  toast(set, headline + money, net > 0 ? 'win' : last.outcome === 'SEVEN_OUT' ? 'warn' : 'ok');
}
