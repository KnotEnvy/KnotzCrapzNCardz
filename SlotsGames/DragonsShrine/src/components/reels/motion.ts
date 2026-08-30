/**
 * How a reel actually moves.
 *
 * A slot reel is the one animation in the game that everybody has an opinion
 * about without knowing why, so it is worth being precise about what is being
 * simulated. A physical reel is a heavy printed band on a stepper: it winds
 * up, runs at a constant speed long enough for the band to become a blur,
 * decelerates, arrives a fraction of a symbol past its stop and springs back
 * into the detent. Four phases, and a renderer that skips any of them reads as
 * a slideshow.
 *
 * The model here is a small hand-integrated state machine, not a spring
 * library, for three reasons.
 *
 *   The reel has to land on an *exact* strip index. A spring lands where the
 *   physics puts it; a reel that does not stop on `stops[reel]` is showing the
 *   player a different outcome than the one the engine paid.
 *
 *   Nothing may re-render. One rAF loop drives all five reels by writing
 *   transforms straight to DOM nodes. React sees a reel twice per spin -- once
 *   when it starts, once when it comes to rest -- and never during the motion.
 *
 *   The store, not this file, decides when a reel stops. `SPINNING`, `TEASE`
 *   and `LANDED` arrive as status changes and each one is a command, so the
 *   presentation can never drift out of step with the sequencer no matter what
 *   the player does to it (slam stop, turbo, an autoplay that never pauses).
 *
 * ------------------------------------------------------------------
 * The one honest compromise, stated plainly
 *
 * A reel travelling at 27 symbols a second cannot decelerate onto an arbitrary
 * stop in the ~200ms the sequencer allows -- the nearest congruent landing
 * point may be most of a band away, which is two seconds of travel. Every real
 * video slot solves this the same way, and so does this one: at the moment the
 * reel is told where it is going, and while it is still moving fast enough to
 * be a smear, the band's *phase* is spliced -- the content mapping shifts so
 * the outcome is a comfortable five symbols ahead.
 *
 * What is never faked: the band is always the real strip, always contiguous,
 * always wrapping, and the reel always comes to rest showing exactly the four
 * symbols `stops[reel]` names. The splice only ever happens above
 * {@link SPLICE_MIN_SPEED}, which is the speed at which a symbol crosses a
 * cell in under three frames and the blur is heavier than a symbol is tall.
 * ------------------------------------------------------------------
 */

import { ROWS, type SymbolId } from '@/lib/engine/types';
import { TIMING, TURBO_SCALE } from '@/lib/engine/config';

/* ------------------------------------------------------------------ *
 * Constants
 *
 * All distances are in *symbols*, all speeds in symbols per second and all
 * durations in milliseconds. Working in symbol units rather than pixels is
 * what lets the same numbers drive a 44px phone cell and a 168px desktop one
 * without a single scale factor in the maths.
 * ------------------------------------------------------------------ */

/** Full tilt. Roughly 2,600px/s at a 96px cell -- a proper blur. */
export const RUN_SPEED = 27;

/** How long the reel takes to wind up to {@link RUN_SPEED}. */
export const ACCEL_MS = 240;

/** The normal deceleration. Short, because the sequencer only gives 165ms between reels. */
export const LAND_MS = 205;

/** The drop-in at the end of a tease, from a standstill. */
export const TEASE_DROP_MS = 190;

/**
 * How far past the stop the reel travels before springing back, in symbols.
 *
 * This is the whole difference between a reel that stops and a reel that
 * *lands*. It is small -- a fifth of a symbol -- because anything larger stops
 * reading as momentum and starts reading as a bug.
 */
export const OVERSHOOT = 0.22;

/**
 * Where a teasing reel hangs, in symbols short of its stop.
 *
 * A third of a symbol: enough that the player can see the next symbol on the
 * band creeping into the window and cannot yet tell what it is.
 */
export const TEASE_HANG = 0.34;

/** Below this speed a phase splice would be visible, so it is not attempted. */
export const SPLICE_MIN_SPEED = 8;

/** Band cells per reel: the four visible rows plus one entering and one leaving. */
export const BAND_CELLS = ROWS + 2;

/**
 * Blur thresholds, in symbols per second.
 *
 * Quantised rather than continuous. A filter whose parameters change every
 * frame is re-rasterised every frame; a filter that changes six times during a
 * spin is composited. The eye cannot tell the difference at these speeds and
 * the phone very much can.
 */
export const BLUR_STEPS = [1.5, 6, 12, 19, 25] as const;

/** How many discrete blur levels exist, level 0 being none. */
export const BLUR_LEVELS = BLUR_STEPS.length + 1;

/* ------------------------------------------------------------------ *
 * Maths
 * ------------------------------------------------------------------ */

/** Positive modulo. `-1 % 100` is -1 in JavaScript and 99 on a reel band. */
export function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/**
 * A cubic through (0,0) and (1,1) that leaves at speed `c` and arrives at rest.
 *
 * `c` is the *normalised* entry speed: the distance the reel would cover in
 * this glide if it never slowed down, over the distance it actually covers.
 * Passing c = 1 gives the natural curve -- it leaves at exactly the speed it
 * was already travelling, so the deceleration begins with no jolt at all,
 * which is the single most noticeable thing a reel renderer can get wrong.
 */
function hermite(u: number, c: number): number {
  return (c - 2) * u * u * u + (3 - 2 * c) * u * u + c * u;
}

/** Its derivative, so the blur can follow the real instantaneous speed. */
function hermiteRate(u: number, c: number): number {
  return 3 * (c - 2) * u * u + 2 * (3 - 2 * c) * u + c;
}

/** Quintic ease out: leaves at 5x average and decays hard. The tease curve. */
function quint(u: number): number {
  const k = 1 - u;
  return 1 - k * k * k * k * k;
}

function quintRate(u: number): number {
  const k = 1 - u;
  return 5 * k * k * k * k;
}

function easeInOut(u: number): number {
  return u * u * (3 - 2 * u);
}

/** The blur level for a speed. */
export function blurLevelFor(speed: number): number {
  let level = 0;
  for (const step of BLUR_STEPS) if (speed >= step) level++;
  return level;
}

/* ------------------------------------------------------------------ *
 * The surface a reel writes to
 * ------------------------------------------------------------------ */

/**
 * Everything the controller is allowed to touch.
 *
 * Deliberately five small functions rather than a DOM node: the controller
 * never learns what a pixel is, which is what keeps the maths above readable
 * and lets the component own responsiveness entirely.
 */
export interface ReelHooks {
  /** The band's offset, in symbols. Row `r` of the band ends up at `r + y`. */
  place: (y: number) => void;
  /** Put `symbol` into band slot `slot`, sitting at absolute band row `row`. */
  fill: (slot: number, row: number, symbol: SymbolId) => void;
  /** 0 for sharp, {@link BLUR_LEVELS} - 1 for full smear. */
  blur: (level: number) => void;
  /** The band is in motion and the landed face must be hidden. */
  moving: (on: boolean) => void;
  /** The band has arrived; hand over to the face layer and play the bounce. */
  settled: () => void;
}

type Mode = 'REST' | 'ACCEL' | 'RUN' | 'GLIDE' | 'HANG';

/* ------------------------------------------------------------------ *
 * One reel
 * ------------------------------------------------------------------ */

export interface ReelTempo {
  turbo: boolean;
  reducedMotion: boolean;
}

export class ReelController {
  private strip: SymbolId[];
  private len: number;

  /**
   * The strip index sitting on the top row, as a continuous number.
   *
   * It *decreases* as the reel spins, because the symbols move down the glass
   * and the band moves up through the strip. Everything else here is a
   * consequence of that one sign.
   */
  private pos = 0;
  /** Symbols per second, always >= 0; direction is baked into `pos`. */
  private speed = 0;
  /** Band row `r` shows `strip[mod(r + phase, len)]`. Shifted only by a splice. */
  private phase = 0;

  private mode: Mode = 'REST';
  private accelT = 0;

  /* The glide in progress. */
  private from = 0;
  private span = 0;
  private dur = 1;
  private elapsed = 0;
  private entry = 1;
  private curve: 'hermite' | 'quint' | 'smooth' = 'hermite';
  /** Set when the glide should hand over to the face layer on arrival. */
  private finishing = false;

  /** Where this spin is going, once known. Null before the reel is told. */
  private target: number | null = null;

  /** Absolute band row of each recycled cell, and what it is currently showing. */
  private rows: number[];
  private shown: (SymbolId | null)[];

  private lastBlur = -1;
  private isMoving = false;

  constructor(
    private readonly hooks: ReelHooks,
    strip: SymbolId[],
    private tempo: ReelTempo,
  ) {
    this.strip = strip;
    this.len = strip.length;
    this.rows = Array.from({ length: BAND_CELLS }, (_, i) => i - 1);
    this.shown = new Array<SymbolId | null>(BAND_CELLS).fill(null);
  }

  /** True while the rAF loop still has work to do for this reel. */
  get active(): boolean {
    // `arrive()` already returned for the REST case, so HANG is the only halt.
    return this.mode !== 'HANG';
  }

  get atRest(): boolean {
    return this.mode === 'REST';
  }

  setTempo(tempo: ReelTempo): void {
    this.tempo = tempo;
  }

  /** A new band. Re-seeds the content without moving the reel. */
  setStrip(strip: SymbolId[], stop: number): void {
    this.strip = strip;
    this.len = strip.length;
    this.seat(stop);
  }

  /**
   * Put the reel at rest showing `stop`, with no motion at all.
   *
   * Used on mount, on a band change, and as the whole of the reduced-motion
   * landing. The face layer is what the player actually sees at rest, so this
   * only has to leave the band consistent underneath it.
   */
  seat(stop: number): void {
    this.mode = 'REST';
    this.speed = 0;
    this.pos = mod(stop, this.len);
    this.phase = 0;
    this.target = this.pos;
    this.reseat();
    this.setBlur(0);
    this.setMoving(false);
  }

  /* ---------------- commands from the store ---------------- */

  /** `IDLE -> SPINNING`. Wind up and run. */
  start(): void {
    if (this.tempo.reducedMotion) return;
    this.target = null;
    this.finishing = false;
    this.mode = 'ACCEL';
    this.accelT = 0;
    this.setMoving(true);
  }

  /**
   * `-> TEASE`. Decelerate toward the stop and hang just short of it.
   *
   * The tease is not a speed, it is a *shape*: full tilt decaying hard, so the
   * reel is already crawling well before the anticipation hold is over and
   * spends the last second visibly hesitating. The store holds TEASE for
   * `TIMING.anticipation`, which turbo deliberately does not shorten, so that
   * is exactly how long this curve is given.
   */
  tease(stop: number): void {
    if (this.tempo.reducedMotion) return;
    if (this.speed < SPLICE_MIN_SPEED) {
      // Too slow to hide a splice. Fall through to a plain landing instead of
      // showing the player the band jump.
      this.land(stop);
      return;
    }
    const dur = TIMING.anticipation;
    // Quintic leaves at five times its average speed, so the distance that
    // matches the current speed is a fifth of what a constant run would cover.
    const reach = (this.speed * dur) / 1000 / 5;
    const target = this.retarget(stop, reach);
    this.beginGlide(target + TEASE_HANG, dur, 'quint', false);
  }

  /** `-> LANDED`. Bring it in, past the stop and back. */
  land(stop: number): void {
    if (this.tempo.reducedMotion) {
      this.seat(stop);
      this.hooks.settled();
      return;
    }

    const slow = this.speed < SPLICE_MIN_SPEED;

    if (!slow || this.target === null) {
      // Moving fast enough to splice, so put the stop a comfortable glide
      // ahead and go. `entry = 1` makes the curve leave at exactly the speed
      // the reel is already doing.
      const dur = this.scaled(LAND_MS);
      const reach = (this.speed * dur) / 1000;
      const target = this.retarget(stop, Math.max(reach, ROWS + 1.5));
      this.beginGlide(target - OVERSHOOT, dur, 'hermite', true);
      return;
    }

    // Already teased into position: a short drop from a standstill, no splice.
    this.beginGlide(this.target - OVERSHOOT, this.scaled(TEASE_DROP_MS), 'smooth', true);
  }

  /** The slam stop, or a reel that must be correct right now. */
  snap(stop: number): void {
    this.seat(stop);
    this.hooks.settled();
  }

  /** Re-apply every position, after the cell size changed. */
  refresh(): void {
    this.hooks.place(-this.pos);
    for (let i = 0; i < BAND_CELLS; i++) {
      const symbol = this.shown[i];
      if (symbol) this.hooks.fill(i, this.rows[i], symbol);
    }
  }

  /* ---------------- the frame ---------------- */

  /** Advance by `dt` seconds. Returns true while the reel still needs frames. */
  tick(dt: number): boolean {
    switch (this.mode) {
      case 'ACCEL': {
        this.accelT += dt * 1000;
        const u = Math.min(1, this.accelT / ACCEL_MS);
        this.speed = RUN_SPEED * easeInOut(u);
        this.pos -= this.speed * dt;
        if (u >= 1) this.mode = 'RUN';
        break;
      }
      case 'RUN': {
        this.speed = RUN_SPEED;
        this.pos -= this.speed * dt;
        break;
      }
      case 'GLIDE': {
        this.elapsed += dt * 1000;
        const u = Math.min(1, this.elapsed / this.dur);
        const travelled =
          this.curve === 'quint'
            ? quint(u)
            : this.curve === 'smooth'
              ? easeInOut(u)
              : hermite(u, this.entry);
        const rate =
          this.curve === 'quint'
            ? quintRate(u)
            : this.curve === 'smooth'
              ? 6 * u * (1 - u)
              : hermiteRate(u, this.entry);
        this.pos = this.from - this.span * travelled;
        this.speed = Math.abs((this.span * rate) / (this.dur / 1000));
        if (u >= 1) {
          this.speed = 0;
          if (this.finishing) {
            this.arrive();
            return false;
          }
          this.mode = 'HANG';
        }
        break;
      }
      default:
        return false;
    }

    this.recycle();
    this.hooks.place(-this.pos);
    this.setBlur(blurLevelFor(this.speed));
    // `arrive()` already returned for the REST case, so HANG is the only halt.
    return this.mode !== 'HANG';
  }

  /* ---------------- internals ---------------- */

  private scaled(base: number): number {
    return this.tempo.turbo ? base * TURBO_SCALE : base;
  }

  /**
   * Choose the landing point and splice the band's phase to match.
   *
   * `reach` is how far the glide wants to travel. The target is snapped to a
   * whole symbol -- a reel must come to rest on a detent -- and the phase is
   * then set so that the strip index at that target is exactly `stop`. Every
   * band cell is rewritten from the new phase in the same frame; see the note
   * at the top of the file for why that is invisible and why it is allowed.
   */
  private retarget(stop: number, reach: number): number {
    const target = Math.round(this.pos - Math.max(reach, 1));
    this.phase = mod(stop - target, this.len);
    this.target = target;
    for (let i = 0; i < BAND_CELLS; i++) this.paint(i, this.rows[i]);
    return target;
  }

  private beginGlide(
    to: number,
    dur: number,
    curve: 'hermite' | 'quint' | 'smooth',
    finishing: boolean,
  ): void {
    this.from = this.pos;
    this.span = this.pos - to;
    this.dur = Math.max(1, dur);
    this.elapsed = 0;
    this.curve = curve;
    this.finishing = finishing;
    // Normalised entry speed: 1 means "carry on at exactly this speed and
    // decay from there", which is a deceleration with no seam in it.
    this.entry =
      this.span > 0.001
        ? Math.min(2.9, Math.max(0, (this.speed * (this.dur / 1000)) / this.span))
        : 0;
    this.mode = 'GLIDE';
    this.setMoving(true);
  }

  /** The band has reached its stop. Hand the column back to the face layer. */
  private arrive(): void {
    this.mode = 'REST';
    // Renormalise so `pos` cannot drift into the range where a float transform
    // loses sub-pixel precision. Invisible: the face layer is taking over on
    // this same frame.
    const detent = this.target ?? Math.round(this.pos);
    const shift = detent - mod(detent, this.len);
    this.pos -= shift;
    this.target = detent - shift;
    this.phase = mod(this.phase + shift, this.len);
    for (let i = 0; i < BAND_CELLS; i++) this.rows[i] -= shift;
    this.reseat();
    this.setBlur(0);
    this.setMoving(false);
    this.hooks.settled();
  }

  /** Lay the band cells out around the current position and paint them. */
  private reseat(): void {
    const top = Math.floor(this.pos);
    for (let i = 0; i < BAND_CELLS; i++) {
      this.rows[i] = top + i - 1;
      this.paint(i, this.rows[i]);
    }
    this.hooks.place(-this.pos);
  }

  /**
   * Move any cell that has fallen out of the bottom back to the top.
   *
   * One cell recycles per symbol crossed, so at full speed this is roughly
   * thirty attribute writes a second across the whole machine -- as against
   * rebuilding a hundred-cell band, which is what a naive renderer does and
   * why naive renderers drop frames on a phone.
   */
  private recycle(): void {
    const top = this.pos - 1;
    const bottom = this.pos + ROWS;
    for (let i = 0; i < BAND_CELLS; i++) {
      let row = this.rows[i];
      let moved = false;
      while (row > bottom) {
        row -= BAND_CELLS;
        moved = true;
      }
      while (row < top - 1) {
        row += BAND_CELLS;
        moved = true;
      }
      if (moved) {
        this.rows[i] = row;
        this.paint(i, row);
      }
    }
  }

  private paint(slot: number, row: number): void {
    const symbol = this.strip[mod(row + this.phase, this.len)];
    this.shown[slot] = symbol;
    this.hooks.fill(slot, row, symbol);
  }

  private setBlur(level: number): void {
    if (level === this.lastBlur) return;
    this.lastBlur = level;
    this.hooks.blur(level);
  }

  private setMoving(on: boolean): void {
    if (on === this.isMoving) return;
    this.isMoving = on;
    this.hooks.moving(on);
  }
}

/* ------------------------------------------------------------------ *
 * The loop
 * ------------------------------------------------------------------ */

/**
 * One requestAnimationFrame for the whole machine.
 *
 * Five separate loops would be five separate style recalculations per frame
 * and five separate chances to tear. This one wakes when a reel is given
 * something to do and stops itself the moment the last one comes to rest, so
 * an idle cabinet costs nothing at all -- which on a phone is the difference
 * between a game you can leave open and a game that eats the battery.
 */
export class ReelDriver {
  private reels: ReelController[] = [];
  private raf = 0;
  private last = 0;

  attach(reels: ReelController[]): void {
    this.reels = reels;
  }

  wake(): void {
    if (this.raf) return;
    this.last = 0;
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    if (!this.raf) return;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private frame = (now: number): void => {
    // A tab that was backgrounded comes back with a gap of seconds. Clamping
    // to two frames keeps a returning reel from teleporting through its stop.
    const dt = this.last ? Math.min((now - this.last) / 1000, 0.034) : 0;
    this.last = now;

    let live = false;
    for (const reel of this.reels) if (reel.tick(dt)) live = true;

    if (live) {
      this.raf = requestAnimationFrame(this.frame);
    } else {
      this.raf = 0;
    }
  };
}
