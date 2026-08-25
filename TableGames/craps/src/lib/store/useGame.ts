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
import { atRisk } from '@/lib/engine/table';
import type {
  PointNumber,
  Roll,
  RollRecord,
  SeatId,
  Settlement,
  TableRules,
  TableState,
} from '@/lib/engine/types';
import { POINT_NUMBERS } from '@/lib/engine/types';
import {
  HOUSE_STRATEGIES,
  duplicateStrategy,
  emptyStrategy,
  isStrategy,
} from '@/lib/strategy/library';
import { runStrategy } from '@/lib/strategy/run';
import {
  emptyMemory,
  emptySeatStrategy,
  type SeatStrategy,
  type Strategy,
  type StrategyLogEntry,
  type StrategyMemory,
} from '@/lib/strategy/types';

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

/**
 * One shared empty list. `settlements` is selected straight out of the store by
 * the felt, so handing it a brand-new `[]` every time the figures are cleared
 * would re-render the whole table for a value that has not changed.
 */
const NO_SETTLEMENTS: Settlement[] = Object.freeze([]) as unknown as Settlement[];

let settlementHold: ReturnType<typeof setTimeout> | null = null;

function clearSettlementHold() {
  if (settlementHold !== null) {
    clearTimeout(settlementHold);
    settlementHold = null;
  }
}

/* ------------------------------------------------------------------ *
 * Strategies
 * ------------------------------------------------------------------ */

let libraryCacheKey: Strategy[] | null = null;
let libraryCacheValue: Strategy[] = [];

/**
 * The house systems are code and the player's are data, so the library is the
 * two concatenated rather than one persisted list. Keeping the built-ins out
 * of storage means a fix to one of them reaches a returning player, instead of
 * being shadowed by the copy their browser saved months ago.
 */
export function allStrategies(customs: Strategy[]): Strategy[] {
  // Four components call this during render and the seat runner used to call
  // it twice a roll. Handing back the same array for the same customs keeps
  // `useMemo` deps and list identities stable instead of minting a fresh
  // seventeen-plus-entry array every time anything on the table changes.
  if (customs === libraryCacheKey) return libraryCacheValue;
  const built = buildLibrary(customs);
  libraryCacheKey = customs;
  libraryCacheValue = built;
  return built;
}

function buildLibrary(customs: Strategy[]): Strategy[] {
  /*
   * A custom strategy can never shadow a house one.
   *
   * The id is the identity used for seat assignment, for findStrategy and for
   * React keys, so a custom carrying a house id is worse than untidy: the
   * library puts the house systems first, `find` returns the house version,
   * and the player's saved edits silently never run. Filtering here also
   * repairs sessions that already have such a strategy persisted, which is
   * what saving over a house system used to produce.
   */
  const seen = new Set(HOUSE_STRATEGIES.map((s) => s.id));
  const safe: Strategy[] = [];
  for (const c of customs) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    safe.push(c);
  }
  return [...HOUSE_STRATEGIES, ...safe];
}

export function findStrategy(customs: Strategy[], id: string | null): Strategy | null {
  if (!id) return null;
  // The house systems come first in the library, so `find` over the two lists
  // in that order is the same answer allStrategies would give — and a custom
  // carrying a house id is unreachable either way. This runs once per auto
  // seat per roll, which is not the place to rebuild the whole library.
  for (const s of HOUSE_STRATEGIES) if (s.id === id) return s;
  for (const s of customs) if (s.id === id) return s;
  return null;
}

/** Chips in the rack plus chips on the felt. */
function equity(table: TableState, seat: SeatId): number {
  return table.seats[seat].bankroll + atRisk(table, seat);
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
      set(() => ({ settlements: NO_SETTLEMENTS }));
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

  /* Strategies */
  /** The player's own systems. The seventeen house ones live in code. */
  customStrategies: Strategy[];
  /** Source of ids for new custom strategies; on the store so it survives a reload. */
  customSeq: number;
  /** What each seat is playing, and whether it plays itself. */
  seatStrategy: Record<SeatId, SeatStrategy>;
  /** What each seat's strategy remembers between rolls. */
  strategyMemory: Record<SeatId, StrategyMemory>;

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
    strategies?: Partial<Record<SeatId, string | null>>;
  }) => void;
  reseed: (seed?: string) => void;

  assignStrategy: (seat: SeatId, strategyId: string | null) => void;
  setSeatAuto: (seat: SeatId, auto: boolean) => void;
  /** Apply a seat's strategy once, by hand. */
  runSeatStrategy: (seat?: SeatId) => void;
  saveStrategy: (strategy: Strategy) => void;
  deleteStrategy: (id: string) => void;
  /** Creates a custom strategy — blank, or a copy of an existing one. */
  createStrategy: (from?: Strategy) => string;
  importStrategy: (json: string) => string | null;

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

      /**
       * Gives each seat's strategy its turn.
       *
       * Runs synchronously the moment a roll settles rather than on a timer.
       * The bets have to be on the felt before the player can throw again, and
       * a timer would either fight the settlement animation or lose the race
       * against someone hammering the roll button in fast mode.
       *
       * With `only` it runs that one seat whether or not it plays itself,
       * which is what the Run button does. Without it, only the seats set to
       * play themselves act.
       */
      const playStrategies = (
        table: TableState,
        record: RollRecord | null,
        settlements: Settlement[],
        opts: { only?: SeatId; force?: boolean } = {},
      ): { table: TableState; memory: Record<SeatId, StrategyMemory>; entries: StrategyLogEntry[] } => {
        const s = get();
        let working = table;
        // Copied only if a seat's memory actually changes. Most rolls of a
        // hand-played table change neither, and the HUD selects this record
        // whole — a fresh object every roll is a re-render for nothing.
        let memory = s.strategyMemory;
        let memoryCopied = false;
        const entries: StrategyLogEntry[] = [];
        const seats: SeatId[] = opts.only ? [opts.only] : ['A', 'B'];

        for (const seat of seats) {
          // Seat B exists in state even in a solo game; it simply never plays.
          if (working.solo && seat === 'B') continue;
          const assigned = s.seatStrategy[seat] ?? emptySeatStrategy();
          if (!opts.only && !assigned.auto) continue;

          const strategy = findStrategy(s.customStrategies, assigned.strategyId);
          if (!strategy) continue;

          const res = runStrategy({
            table: working,
            seat,
            strategy,
            memory: memory[seat] ?? emptyMemory(strategy.id, equity(working, seat)),
            record,
            settlements,
            force: opts.force,
          });
          working = res.table;
          if (res.memory !== memory[seat]) {
            if (!memoryCopied) {
              memory = { ...memory };
              memoryCopied = true;
            }
            memory[seat] = res.memory;
          }
          for (const entry of res.entries) entries.push(entry);
        }

        return { table: working, memory, entries };
      };

      /** Lays down the opening bets after a new session or a fresh assignment. */
      const primeStrategies = (only?: SeatId) => {
        const played = playStrategies(get().table, null, [], { only, force: true });
        set(() => ({ table: played.table, strategyMemory: played.memory }));
        return played.entries;
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

        customStrategies: [],
        customSeq: 0,
        seatStrategy: { A: emptySeatStrategy(), B: emptySeatStrategy() },
        strategyMemory: { A: emptyMemory(null), B: emptyMemory(null) },

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

          const table = createTable(opts);
          const previous = get().seatStrategy;
          const assign = (seat: SeatId): SeatStrategy => {
            const chosen = opts.strategies?.[seat];
            // `undefined` means the setup form had nothing to say about this
            // seat, so it keeps whatever it was playing. `null` means the
            // player explicitly chose to play it by hand.
            if (chosen === undefined) return previous[seat] ?? emptySeatStrategy();
            return { strategyId: chosen, auto: chosen !== null };
          };
          const seatStrategy: Record<SeatId, SeatStrategy> = { A: assign('A'), B: assign('B') };

          set(() => ({
            table,
            seed,
            sessionStarted: true,
            animation: null,
            lastRoll: null,
            settlements: [],
            rolling: false,
            pendingRoll: null,
            lastAction: { A: [], B: [] },
            seatStrategy,
            strategyMemory: {
              A: emptyMemory(seatStrategy.A.strategyId, table.seats.A.bankroll),
              B: emptyMemory(seatStrategy.B.strategyId, table.seats.B.bankroll),
            },
          }));
          // Anything playing itself gets its opening bets down before the
          // player sees the felt, rather than after the first throw.
          primeStrategies();
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

        /* ---------------- Strategies ---------------- */

        assignStrategy(seat, strategyId) {
          const { customStrategies, table } = get();
          const strategy = findStrategy(customStrategies, strategyId);
          set((s) => ({
            seatStrategy: {
              ...s.seatStrategy,
              [seat]: { strategyId, auto: strategyId === null ? false : s.seatStrategy[seat].auto },
            },
            // A different system is a different set of counters. Carrying the
            // old hit tallies over would have the new one pressing on hits it
            // never saw.
            strategyMemory: {
              ...s.strategyMemory,
              [seat]: emptyMemory(strategyId, equity(s.table, seat)),
            },
          }));
          toast(
            set,
            strategy
              ? `${table.seats[seat].name} is playing ${strategy.name}`
              : `${table.seats[seat].name} is back on the controls`,
            'ok',
          );
        },

        setSeatAuto(seat, auto) {
          set((s) => ({
            seatStrategy: { ...s.seatStrategy, [seat]: { ...s.seatStrategy[seat], auto } },
          }));
          if (auto) primeStrategies(seat);
        },

        runSeatStrategy(seat) {
          const state = get();
          if (state.rolling) {
            toast(set, 'Dice are out', 'warn');
            return;
          }
          const target = seat ?? state.table.activeSeat;
          const assigned = state.seatStrategy[target];
          if (!assigned?.strategyId) {
            toast(set, 'No strategy on that seat yet', 'warn');
            return;
          }

          const played = playStrategies(state.table, state.table.history.at(-1) ?? null, [], {
            only: target,
            force: true,
          });
          set(() => ({ table: played.table, strategyMemory: played.memory }));

          const last = played.entries.at(-1);
          if (!last) toast(set, 'Nothing for the strategy to do right now', 'ok');
          else toast(set, last.text, last.ok ? 'ok' : 'warn');
        },

        saveStrategy(strategy) {
          set((s) => {
            // Saving under a house id would create a custom that can never be
            // reached — see allStrategies. An edit to a house system becomes a
            // copy of it instead, which is what the player meant anyway.
            if (HOUSE_STRATEGIES.some((h) => h.id === strategy.id)) {
              const seq = s.customSeq + 1;
              const id = `mine-${seq}`;
              return {
                customSeq: seq,
                customStrategies: [
                  ...s.customStrategies,
                  duplicateStrategy(strategy, id, strategy.name),
                ],
              };
            }
            const existing = s.customStrategies.findIndex((x) => x.id === strategy.id);
            const customStrategies =
              existing >= 0
                ? s.customStrategies.map((x, i) => (i === existing ? strategy : x))
                : [...s.customStrategies, strategy];
            return { customStrategies };
          });
        },

        deleteStrategy(id) {
          set((s) => {
            const seatStrategy = { ...s.seatStrategy };
            const strategyMemory = { ...s.strategyMemory };
            // A seat cannot go on playing a system that no longer exists.
            for (const seat of ['A', 'B'] as SeatId[]) {
              if (seatStrategy[seat].strategyId !== id) continue;
              seatStrategy[seat] = emptySeatStrategy();
              strategyMemory[seat] = emptyMemory(null, equity(s.table, seat));
            }
            return {
              customStrategies: s.customStrategies.filter((x) => x.id !== id),
              seatStrategy,
              strategyMemory,
            };
          });
        },

        createStrategy(from) {
          const seq = get().customSeq + 1;
          const id = `mine-${seq}`;
          const strategy = from ? duplicateStrategy(from, id) : emptyStrategy(id);
          set((s) => ({ customSeq: seq, customStrategies: [...s.customStrategies, strategy] }));
          return id;
        },

        importStrategy(json) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(json);
          } catch {
            toast(set, 'That is not valid JSON', 'warn');
            return null;
          }
          if (!isStrategy(parsed)) {
            toast(set, 'That JSON is not a strategy', 'warn');
            return null;
          }
          // Imports always land as a new custom strategy, so a pasted copy can
          // never overwrite something the player already has under that id.
          const seq = get().customSeq + 1;
          const id = `mine-${seq}`;
          const strategy = duplicateStrategy(parsed, id, parsed.name);
          set((s) => ({ customSeq: seq, customStrategies: [...s.customStrategies, strategy] }));
          toast(set, `Imported ${strategy.name}`, 'ok');
          return id;
        },

        throwDice() {
          const state = get();
          if (state.rolling) return;

          const roll = rollDice(rng);

          clearSettlementHold();

          if (state.fastRoll || !state.physicsReady) {
            const { state: next, settlements, record } = applyRoll(state.table, roll);
            // What came down is read from the table the roll produced, before
            // any strategy puts something new in its place.
            recordAction(set, state.table, next, settlements);
            const played = playStrategies(next, record, settlements);
            set(() => ({
              table: played.table,
              strategyMemory: played.memory,
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
          const { state: next, settlements, record } = applyRoll(state.table, roll);
          recordAction(set, state.table, next, settlements);
          const played = playStrategies(next, record, settlements);
          set(() => ({
            table: played.table,
            strategyMemory: played.memory,
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
        // The strategy layer is deliberately outside TableState — the engine
        // has no business knowing a bot is playing — so adding it changed the
        // store's shape without changing the table's, and `version` stays at 3.
        // An older save simply arrives without these keys and `merge` fills
        // them in from the defaults below.
        customStrategies: s.customStrategies,
        customSeq: s.customSeq,
        seatStrategy: s.seatStrategy,
        strategyMemory: s.strategyMemory,
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

        // The same treatment for the strategy layer, which a save from before
        // it existed simply will not have: take it only if both seats are
        // there, otherwise deal a fresh set rather than a half-shaped one.
        const seatStrategy =
          saved?.seatStrategy?.A && saved.seatStrategy.B ? saved.seatStrategy : current.seatStrategy;
        const strategyMemory =
          saved?.strategyMemory?.A && saved.strategyMemory.B
            ? saved.strategyMemory
            : current.strategyMemory;

        return {
          ...current,
          ...saved,
          table: usable ? table : current.table,
          customStrategies: Array.isArray(saved?.customStrategies) ? saved.customStrategies : [],
          customSeq: typeof saved?.customSeq === 'number' ? saved.customSeq : 0,
          seatStrategy,
          strategyMemory,
        };
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
  const survivors = new Set<string>();
  for (const bet of after.bets) survivors.add(bet.id);
  // Contract bets that simply won are worth repeating; the line handles itself.
  const settled = new Set<string>();
  for (const s of settlements) settled.add(s.betId);

  const resolved: Record<SeatId, Array<{ spec: BetSpec; amount: number }>> = { A: [], B: [] };
  for (const bet of before.bets) {
    if (survivors.has(bet.id)) continue;
    if (!settled.has(bet.id)) continue;
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
