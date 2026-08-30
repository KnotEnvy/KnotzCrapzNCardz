'use client';

/**
 * The sequencer.
 *
 * A spin is a score, not an event. Pressing the button does not produce a
 * board; it starts about four seconds of choreography in which five reels land
 * one after another, a sixth beat holds its breath because reel four might be
 * the third pearl, a meter climbs, and three separate paylines each get their
 * own moment on the glass. The engine decides all of that in a microsecond.
 * Everything the player experiences is this file spending that microsecond
 * back out over time, in the right order, at the right tempo.
 *
 * Three ideas do all the work here.
 *
 * A **timeline** is a list of callbacks at offsets, started once and killable
 * in one call. Nothing in the game uses a bare `setTimeout`, because a bare
 * `setTimeout` is a promise you cannot take back and this machine has to take
 * everything back constantly: the player slams the reels, hits skip, starts a
 * new session, or simply switches browser tabs in the middle of a free spins
 * run. Every one of those has to unwind cleanly, and "cleanly" means one call.
 *
 * A **generation guard** is how a timeline that has been killed is stopped
 * from writing anyway. See {@link Timeline} below -- this is the single most
 * dangerous bug in the whole store and it gets its own essay.
 *
 * A **tempo** turns the designed durations in `TIMING` into the durations this
 * particular player actually gets, honouring turbo and reduced motion. It is a
 * pure function of preferences, which is what lets the reel renderer, the FX
 * layer and the audio bus all compute the same number independently and land
 * on the same frame.
 *
 * Nothing in this file knows what a slot machine is. It schedules and it
 * counts. That is deliberate: the choreography is hard enough to get right
 * without also owning any game state, and a scheduler with no opinions is one
 * that can be tested by advancing a fake clock and watching a list of strings
 * come out in order.
 */

import { TURBO_SCALE } from '@/lib/engine/config';

/* ------------------------------------------------------------------ *
 * Tempo
 * ------------------------------------------------------------------ */

/** The two preferences that change how long anything takes. */
export interface Tempo {
  turbo: boolean;
  reducedMotion: boolean;
}

/**
 * What a duration is *for*, which decides how the preferences may bend it.
 *
 *   `motion`  time spent moving -- reels spinning up, settling, a card sliding
 *             on. Pure animation; nothing is being read while it happens, so
 *             both turbo and reduced motion are free to crush it.
 *
 *   `read`    time the player needs to take something in -- a payline lit on
 *             the grid, a feature card, a total. Turbo shortens it, because a
 *             turbo player has opted into reading faster. Reduced motion
 *             shortens it far less and never below {@link READ_FLOOR_MS},
 *             because someone who has asked the OS for less animation has not
 *             asked to be shown less information.
 *
 *   `tease`   the anticipation hold before a reel that might complete a
 *             trigger. Turbo deliberately does *not* touch this: a tease
 *             shorter than its own recognition is worse than no tease, and a
 *             turbo player who never sees the machine hesitate before the
 *             third pearl has been quietly robbed of the best two seconds the
 *             game has. Reduced motion replaces the long spin with a short
 *             static hold rather than removing it, because the tease is
 *             information, not decoration.
 */
export type Beat = 'motion' | 'read' | 'tease';

/**
 * How hard reduced motion crushes pure animation.
 *
 * Not zero. Zero would make reels appear rather than land, which reads as a
 * rendering glitch rather than a fast machine; there still has to be enough
 * time for the eye to notice that something changed. An eighth of the designed
 * time is about the floor of "that happened" while being unmistakably still.
 */
export const REDUCED_MOTION_SCALE = 0.12;

/** How much reduced motion shortens time spent reading. Half, and no further. */
export const REDUCED_READ_SCALE = 0.5;

/** Reading time never drops below this under reduced motion, milliseconds. */
export const READ_FLOOR_MS = 400;

/** The static hold that stands in for an anticipation spin under reduced motion. */
export const REDUCED_TEASE_MS = 420;

/**
 * The designed duration `base`, as this player's preferences actually get it.
 *
 * Scales compose: turbo and reduced motion together are faster than either
 * alone, which is what a player who has both set has asked for. The floors are
 * applied last so they cannot be multiplied away.
 */
export function beatMs(base: number, kind: Beat, tempo: Tempo): number {
  if (kind === 'tease') {
    // Turbo is deliberately absent from this branch. See {@link Beat}.
    return tempo.reducedMotion ? REDUCED_TEASE_MS : base;
  }

  let ms = base;
  if (tempo.turbo) ms *= TURBO_SCALE;

  if (tempo.reducedMotion) {
    ms *= kind === 'read' ? REDUCED_READ_SCALE : REDUCED_MOTION_SCALE;
    if (kind === 'read') ms = Math.max(ms, READ_FLOOR_MS);
  }

  return Math.round(ms);
}

/** A tempo carrying no preferences, for tests and for the very first frame. */
export const PLAIN_TEMPO: Tempo = { turbo: false, reducedMotion: false };

/* ------------------------------------------------------------------ *
 * Timelines
 * ------------------------------------------------------------------ */

interface Step {
  /** Milliseconds from the timeline's start. */
  at: number;
  /** Insertion order, so two steps at the same offset keep their written order. */
  seq: number;
  run: () => void;
}

export interface TimelineOptions {
  /**
   * The generation guard.
   *
   * Return false and every remaining step becomes a no-op, immediately and
   * permanently. The store passes a closure comparing a captured generation
   * number against the live one, so that a timer belonging to spin 41 cannot
   * write state belonging to spin 42.
   *
   * THIS IS THE MOST DANGEROUS BUG IN THE STORE, and it is worth being explicit
   * about why, because it is subtle and it does not reproduce reliably.
   * `cancel()` clears the pending host timers, which handles almost every case.
   * What it cannot handle is a step that is *already executing* when the world
   * changes underneath it -- a landing step that calls into the store, which
   * synchronously starts a new spin, after which the rest of this timeline is
   * conceptually dead but its call stack is still unwinding. It also cannot
   * handle a `requestAnimationFrame` callback that has already been dequeued
   * by the browser, or a step whose own body triggers a cancel halfway
   * through. The symptom in all three cases is identical and horrible: reel 3
   * of the previous spin lands on top of the current one, or a stale count-up
   * drags the meter back down to an amount that was already paid. It surfaces
   * once in ten thousand spins, never in a test, and always in a screenshot
   * from a player. So: cancellation clears timers *and* every step re-checks
   * that it still belongs to the present before it does anything at all.
   */
  alive?: () => boolean;
  /** Called once when the last step has run, or when {@link Timeline.finish} completes. */
  onDone?: () => void;
}

/**
 * A cancellable list of callbacks at offsets.
 *
 * Built fluently and started once:
 *
 * ```ts
 * timeline({ alive })
 *   .hold(420)
 *   .then(() => landReel(0))
 *   .after(165, () => landReel(1))
 *   .start();
 * ```
 *
 * `hold` moves the cursor, `then` puts a step at the cursor, `after` does both,
 * and `at` ignores the cursor entirely for the rare step that belongs at an
 * absolute offset. Steps run in offset order, ties in written order.
 */
export interface Timeline {
  /** Where the next `then` will land, milliseconds from the start. */
  readonly cursor: number;
  readonly started: boolean;
  readonly cancelled: boolean;
  readonly done: boolean;

  at(offsetMs: number, run: () => void): Timeline;
  then(run: () => void): Timeline;
  after(gapMs: number, run: () => void): Timeline;
  hold(ms: number): Timeline;

  start(): Timeline;

  /**
   * Run everything still pending, right now, in order, then complete.
   *
   * This is what a slam stop is: the remaining reels land at the stops the
   * engine already chose, at once, honestly. It is also what skip is, for every
   * celebration on the machine -- running the rest of the score instantly
   * arrives at exactly the state waiting would have arrived at, which is the
   * only definition of "skip" that cannot desynchronise anything.
   */
  finish(): void;

  /** Drop everything pending. `onDone` is not called: this timeline never ended. */
  cancel(): void;
}

export function timeline(options: TimelineOptions = {}): Timeline {
  const steps: Step[] = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let cursor = 0;
  let seq = 0;
  let started = false;
  let cancelled = false;
  let done = false;
  let ran = 0;

  const alive = () => !cancelled && !done && (options.alive?.() ?? true);

  function complete() {
    if (done || cancelled) return;
    done = true;
    timers.clear();
    options.onDone?.();
  }

  function order(): Step[] {
    return [...steps].sort((a, b) => a.at - b.at || a.seq - b.seq);
  }

  const api: Timeline = {
    get cursor() {
      return cursor;
    },
    get started() {
      return started;
    },
    get cancelled() {
      return cancelled;
    },
    get done() {
      return done;
    },

    at(offsetMs, run) {
      steps.push({ at: Math.max(0, Math.round(offsetMs)), seq: seq++, run });
      return api;
    },

    then(run) {
      return api.at(cursor, run);
    },

    after(gapMs, run) {
      return api.hold(gapMs).then(run);
    },

    hold(ms) {
      cursor += Math.max(0, Math.round(ms));
      return api;
    },

    start() {
      if (started) return api;
      started = true;

      const queue = order();
      if (queue.length === 0) {
        // An empty score still has to end, or whatever was waiting on it hangs.
        complete();
        return api;
      }

      queue.forEach((step, index) => {
        const timer = setTimeout(() => {
          timers.delete(timer);
          // The guard, again, per step. See TimelineOptions.alive.
          if (!alive()) return;
          ran = Math.max(ran, index + 1);
          step.run();
          // Completion is scheduled separately rather than hung off the last
          // step, because a step is allowed to cancel the timeline it is in
          // (skip, inside a presentation, does exactly that) and `complete`
          // must not fire afterwards.
          if (index === queue.length - 1 && alive()) complete();
        }, step.at);
        timers.add(timer);
      });

      return api;
    },

    finish() {
      if (done || cancelled) return;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();

      const queue = order();
      // `ran` is the high-water mark of what has already fired. Everything at
      // or beyond it is still owed and gets paid now, in order. Re-running a
      // step that has already run would land a reel twice or credit a win
      // twice, which is the one thing a slam stop must never do.
      const pending = started ? queue.slice(ran) : queue;
      ran = queue.length;

      for (const step of pending) {
        if (!alive()) return;
        step.run();
      }
      complete();
    },

    cancel() {
      if (done) return;
      cancelled = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
  };

  return api;
}

/* ------------------------------------------------------------------ *
 * The count-up
 * ------------------------------------------------------------------ */

/**
 * A frame-driven climb from one integer to another.
 *
 * Explicitly not `setInterval`. An interval ticking a meter is wrong in three
 * separate ways: it fixes the number of steps rather than the duration, so a
 * slow frame stretches the whole count; it drifts, so a six-second LEGENDARY
 * count and its six-second fanfare finish visibly apart; and browsers throttle
 * it in a background tab, so a player who switches away mid-count comes back to
 * a meter still crawling toward a figure that was banked ten seconds ago.
 *
 * `requestAnimationFrame` against a wall clock fixes the first two. The third
 * it makes *worse* -- rAF does not throttle in a hidden tab, it stops entirely
 * -- so there is a `setTimeout` backstop that force-finishes the count if the
 * frames never arrive. setTimeout in a hidden tab is throttled but never
 * suspended, which is exactly the property needed for a safety net.
 */
export interface CountUp {
  /** Stop where it is. `onDone` is not called. */
  cancel(): void;
  /** Jump to the final value and complete. This is what skip does to a meter. */
  finish(): void;
  readonly done: boolean;
}

export interface CountUpOptions {
  from: number;
  to: number;
  durationMs: number;
  /** Every frame, with an integer already rounded for display. */
  onValue: (value: number) => void;
  /** Fired `ticks` times across the count, for the coin patter. */
  onTick?: (index: number, total: number) => void;
  ticks?: number;
  onDone?: () => void;
  /** The same generation guard the timelines use. */
  alive?: () => boolean;
}

/** Frame pacing for environments with no `requestAnimationFrame` (tests, SSR). */
const FALLBACK_FRAME_MS = 16;

/** How long past the scheduled end the backstop waits before forcing the finish. */
const BACKSTOP_SLACK_MS = 400;

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/**
 * Ease-out, gently.
 *
 * A linear count-up reads as a number changing. A count-up that decelerates
 * reads as a number *arriving*, which is the entire point of the meter: the
 * last few hundred cents crawling in is what makes a big win feel like it is
 * still going. Quadratic is enough -- anything stronger and the tail looks
 * stuck, which players read as the machine having frozen mid-payout.
 */
function ease(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

export function countUp(options: CountUpOptions): CountUp {
  const { from, to, durationMs, onValue, onTick, onDone } = options;
  const ticks = Math.max(0, options.ticks ?? 0);
  const alive = options.alive ?? (() => true);

  const start = now();
  const span = to - from;
  let frame: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let backstop: ReturnType<typeof setTimeout> | null = null;
  let ticked = 0;
  let finished = false;
  let stopped = false;

  function clear() {
    if (frame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
    if (timer !== null) clearTimeout(timer);
    if (backstop !== null) clearTimeout(backstop);
    frame = null;
    timer = null;
    backstop = null;
  }

  function schedule(fn: () => void) {
    if (typeof requestAnimationFrame === 'function') {
      frame = requestAnimationFrame(() => fn());
    } else {
      timer = setTimeout(fn, FALLBACK_FRAME_MS);
    }
  }

  function emitTicks(progress: number) {
    if (ticks === 0 || !onTick) return;
    const due = Math.floor(progress * ticks);
    while (ticked < due && ticked < ticks) {
      onTick(ticked, ticks);
      ticked++;
    }
  }

  function complete() {
    if (finished || stopped) return;
    finished = true;
    clear();
    onValue(to);
    emitTicks(1);
    onDone?.();
  }

  function step() {
    if (stopped || finished) return;
    if (!alive()) {
      // Stale: a newer spin owns the meter now. Leave its value alone.
      stopped = true;
      clear();
      return;
    }

    const elapsed = now() - start;
    if (durationMs <= 0 || elapsed >= durationMs) {
      complete();
      return;
    }

    const t = ease(elapsed / durationMs);
    onValue(Math.round(from + span * t));
    emitTicks(t);
    schedule(step);
  }

  if (durationMs <= 0 || span === 0) {
    // Nothing to animate. Still asynchronous, so that callers can rely on
    // `onDone` never firing before they have finished setting up.
    timer = setTimeout(complete, 0);
  } else {
    onValue(from);
    schedule(step);
    backstop = setTimeout(() => {
      if (!finished && !stopped && alive()) complete();
    }, durationMs + BACKSTOP_SLACK_MS);
  }

  return {
    cancel() {
      if (finished) return;
      stopped = true;
      clear();
    },
    finish() {
      complete();
    },
    get done() {
      return finished;
    },
  };
}
