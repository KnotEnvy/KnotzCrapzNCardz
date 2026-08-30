'use client';

/**
 * Everything that happens on the glass.
 *
 * One canvas, one requestAnimationFrame loop, one pool of particles, and a
 * single subscription to the store. Nothing in the rest of the app calls into
 * this file: the effects layer watches the machine and decides for itself what
 * to throw, which is why a coin fountain cannot be forgotten by whoever adds
 * the next feature screen.
 *
 * Five things it is built around.
 *
 *   It idles at nothing. The rAF loop is started when work arrives and
 *   cancelled the frame after the last particle dies. A slot spends most of
 *   its life doing nothing at all, and an effects layer that clears a
 *   full-screen canvas sixty times a second to draw zero particles is the
 *   single most expensive thing on an idle cabinet.
 *
 *   It allocates nothing per frame. Particles are a struct of arrays with a
 *   free-list; rings, beams and emitters are fixed pools of objects made once.
 *   The update loop creates no objects, no closures and no strings, so the
 *   collector has nothing to do during a LEGENDARY and there is no frame where
 *   two hundred coins suddenly stutter.
 *
 *   It reads transitions, not state. `useSlots.subscribe` gives the previous
 *   state alongside the new one, so "the presentation key changed", "a reel
 *   went from spinning to landed" and "an orb appeared" are all one cheap
 *   comparison. The component itself renders exactly once and never again.
 *
 *   It is never a tap target. The canvas is fixed, `pointer-events: none`, and
 *   sits above the feature overlay purely so its light falls on top of it.
 *
 *   Reduced motion reduces, it does not remove. Counts drop by roughly
 *   four-fifths, the screen never shakes and the flash is a quarter as bright
 *   and twice as slow — but a jackpot still throws confetti and a win still
 *   spills coins, because a slot that stops celebrating has stopped being a
 *   slot, and the player asked for less movement rather than less game.
 */

import { useEffect, useRef } from 'react';
import { useSlots } from '@/lib/store/useSlots';
import { CELLS, REELS, ROWS, type Cell, type JackpotId, type WinTier } from '@/lib/engine/types';

/* ------------------------------------------------------------------ *
 * Pools and palette
 * ------------------------------------------------------------------ */

const MAX_PARTICLES = 1100;
const MAX_RINGS = 16;
const MAX_EMITTERS = 8;
const BEAMS = 6;

/** Particle kinds. Plain numbers: a const enum is not allowed under isolatedModules. */
const COIN = 0;
const SPARK = 1;
const EMBER = 2;
const CONFETTI = 3;
const FIRE = 4;
const DUST = 5;
const GLINT = 6;

/**
 * The palette, straight off the design tokens in globals.css.
 *
 * Particles carry an index into this rather than a colour string, so a spawn
 * is six numbers written into typed arrays and never a string allocation.
 */
const COL = [
  '#ffe08a', // 0  gold-300
  '#f2cc5c', // 1  gold-400
  '#e0b33a', // 2  gold-500
  '#fff0c2', // 3  gold-200
  '#ffab5e', // 4  ember-300
  '#f57f2a', // 5  ember-400
  '#d95b16', // 6  ember-500
  '#ffffff', // 7  the hot core of anything
  '#b47cee', // 8  violet-400, the link
  '#9450d9', // 9  violet-500
  '#6fe4b2', // 10 jade-300, MINI
  '#63b3f5', // 11 MINOR
  '#ffd76a', // 12 GRAND
  '#ef5350', // 13 cinnabar-400
] as const;

const GOLDS = [0, 1, 2, 3];
const EMBERS = [4, 5, 6];
const JACKPOT_COL: Record<JackpotId, number> = { MINI: 10, MINOR: 11, MAJOR: 8, GRAND: 12 };

/** How many coins a win of each tier is worth. The signature slot gesture. */
const TIER_COINS: Record<WinTier, number> = {
  NONE: 0,
  SMALL: 12,
  MEDIUM: 30,
  BIG: 68,
  MEGA: 110,
  EPIC: 160,
  LEGENDARY: 230,
};

/** How long the fountain keeps spilling, seconds, roughly the count-up. */
const TIER_SECONDS: Record<WinTier, number> = {
  NONE: 0,
  SMALL: 0.35,
  MEDIUM: 0.7,
  BIG: 1.6,
  MEGA: 2.4,
  EPIC: 3.2,
  LEGENDARY: 4.2,
};

/** Screen shake amplitude in px. Anything under BIG does not shake at all. */
const TIER_SHAKE: Record<WinTier, number> = {
  NONE: 0,
  SMALL: 0,
  MEDIUM: 0,
  BIG: 5,
  MEGA: 8,
  EPIC: 11,
  LEGENDARY: 15,
};

const TAU = Math.PI * 2;
const GRAVITY = 2000;

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = (a: readonly number[]) => a[(Math.random() * a.length) | 0];

/* ------------------------------------------------------------------ *
 * Where the reels are
 * ------------------------------------------------------------------ */

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The reel window, in CSS pixels.
 *
 * Measured off the DOM when the reel lane offers a hook and computed from the
 * cabinet's own `--cell-size` / `--reel-gap` when it does not, so this layer
 * works whether or not another workstream has landed yet. Any element carrying
 * `data-fx-grid` claims the honour; the rest are conventional names tried in
 * order before falling back.
 */
function measureGrid(): Rect {
  if (typeof document !== 'undefined') {
    const el = document.querySelector(
      '[data-fx-grid],[data-reel-window],#reel-window,.reel-window',
    );
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.width > 60 && r.height > 60) return { x: r.left, y: r.top, w: r.width, h: r.height };
    }
  }
  const vw = typeof window === 'undefined' ? 1024 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 768 : window.innerHeight;
  let cell = 96;
  let gap = 6;
  if (typeof document !== 'undefined') {
    const cs = getComputedStyle(document.documentElement);
    cell = parseFloat(cs.getPropertyValue('--cell-size')) || cell;
    gap = parseFloat(cs.getPropertyValue('--reel-gap')) || gap;
  }
  const w = Math.min(vw * 0.94, cell * REELS + gap * (REELS - 1));
  const h = Math.min(vh * 0.62, cell * ROWS + gap * (ROWS - 1));
  return { x: (vw - w) / 2, y: (vh - h) / 2, w, h };
}

/* ------------------------------------------------------------------ *
 * The field
 * ------------------------------------------------------------------ */

interface Ring {
  on: boolean;
  x: number;
  y: number;
  r: number;
  rv: number;
  life: number;
  max: number;
  width: number;
  col: number;
}

interface Emitter {
  on: boolean;
  kind: number;
  left: number;
  rate: number;
  acc: number;
  x: number;
  y: number;
  spread: number;
  power: number;
  cols: readonly number[];
  /** Infinite emitters (the free spins embers) run until switched off. */
  endless: boolean;
}

/**
 * Everything the canvas is currently doing.
 *
 * One instance, created when the component mounts and destroyed when it
 * unmounts. Deliberately a plain class rather than React state: none of this
 * belongs in a render, and putting a hundred and sixty coins through a
 * reconciler would be absurd.
 */
class Field {
  private readonly canvas: HTMLCanvasElement;
  private readonly c: CanvasRenderingContext2D;
  private dpr = 1;
  private w = 0;
  private h = 0;

  /* Particles, as a struct of arrays. */
  private readonly px = new Float32Array(MAX_PARTICLES);
  private readonly py = new Float32Array(MAX_PARTICLES);
  private readonly pvx = new Float32Array(MAX_PARTICLES);
  private readonly pvy = new Float32Array(MAX_PARTICLES);
  private readonly plife = new Float32Array(MAX_PARTICLES);
  private readonly pmax = new Float32Array(MAX_PARTICLES);
  private readonly psize = new Float32Array(MAX_PARTICLES);
  private readonly prot = new Float32Array(MAX_PARTICLES);
  private readonly pspin = new Float32Array(MAX_PARTICLES);
  /** 0.5 far, 1.4 near: scales size, alpha and whether it gets a highlight. */
  private readonly pz = new Float32Array(MAX_PARTICLES);
  private readonly pkind = new Uint8Array(MAX_PARTICLES);
  private readonly pcol = new Uint8Array(MAX_PARTICLES);
  private readonly pbounce = new Uint8Array(MAX_PARTICLES);
  private readonly freeList = new Int32Array(MAX_PARTICLES);
  private freeTop = MAX_PARTICLES;
  private alive = 0;

  private readonly rings: Ring[] = [];
  private readonly emitters: Emitter[] = [];

  /* Whole-screen effects. */
  private flashLife = 0;
  private flashMax = 0;
  private flashCol = 3;
  private flashPeak = 0;
  private beamLife = 0;
  private beamMax = 0;
  private beamCol = 12;
  private dragonLife = 0;
  private dragonMax = 0;
  private dragonDir = 1;

  private raf = 0;
  private last = 0;
  private running = false;
  private destroyed = false;

  /** The store's own preference, kept in sync by the subscriber. */
  reduced = false;

  private grid: Rect;
  private gridAt = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const c = canvas.getContext('2d', { alpha: true });
    if (!c) throw new Error('2d context unavailable');
    this.c = c;
    for (let i = 0; i < MAX_PARTICLES; i++) this.freeList[i] = i;
    for (let i = 0; i < MAX_RINGS; i++) {
      this.rings.push({ on: false, x: 0, y: 0, r: 0, rv: 0, life: 0, max: 1, width: 2, col: 0 });
    }
    for (let i = 0; i < MAX_EMITTERS; i++) {
      this.emitters.push({
        on: false,
        kind: COIN,
        left: 0,
        rate: 0,
        acc: 0,
        x: 0,
        y: 0,
        spread: 0,
        power: 0,
        cols: GOLDS,
        endless: false,
      });
    }
    this.grid = measureGrid();
    this.resize();
  }

  /* --- geometry -------------------------------------------------- */

  resize = () => {
    if (typeof window === 'undefined') return;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.grid = measureGrid();
    this.gridAt = performance.now();
  };

  /** Cached for a quarter second: a getBoundingClientRect per coin is not free. */
  private box(): Rect {
    const now = performance.now();
    if (now - this.gridAt > 250) {
      this.grid = measureGrid();
      this.gridAt = now;
    }
    return this.grid;
  }

  private cellAt(cell: Cell): { x: number; y: number } {
    const g = this.box();
    return {
      x: g.x + ((cell.reel + 0.5) * g.w) / REELS,
      y: g.y + ((cell.row + 0.5) * g.h) / ROWS,
    };
  }

  /* --- pool ------------------------------------------------------ */

  private spawn(
    kind: number,
    x: number,
    y: number,
    vx: number,
    vy: number,
    life: number,
    size: number,
    col: number,
    z: number,
    spin: number,
  ): void {
    if (this.freeTop === 0) return;
    const i = this.freeList[--this.freeTop];
    this.pkind[i] = kind;
    this.px[i] = x;
    this.py[i] = y;
    this.pvx[i] = vx;
    this.pvy[i] = vy;
    this.plife[i] = life;
    this.pmax[i] = life;
    this.psize[i] = size;
    this.pcol[i] = col;
    this.pz[i] = z;
    this.prot[i] = Math.random() * TAU;
    this.pspin[i] = spin;
    this.pbounce[i] = 0;
    this.alive++;
    this.wake();
  }

  private kill(i: number): void {
    this.plife[i] = 0;
    this.freeList[this.freeTop++] = i;
    this.alive--;
  }

  private ring(x: number, y: number, r: number, rv: number, life: number, width: number, col: number) {
    for (const g of this.rings) {
      if (g.on) continue;
      g.on = true;
      g.x = x;
      g.y = y;
      g.r = r;
      g.rv = rv;
      g.life = life;
      g.max = life;
      g.width = width;
      g.col = col;
      this.wake();
      return;
    }
  }

  private emitter(e: Partial<Emitter> & { kind: number; x: number; y: number }) {
    for (const s of this.emitters) {
      if (s.on) continue;
      s.on = true;
      s.kind = e.kind;
      s.left = e.left ?? 0;
      s.rate = e.rate ?? 30;
      s.acc = 0;
      s.x = e.x;
      s.y = e.y;
      s.spread = e.spread ?? 0;
      s.power = e.power ?? 1;
      s.cols = e.cols ?? GOLDS;
      s.endless = e.endless ?? false;
      this.wake();
      return;
    }
  }

  private stopEmitters(kind: number) {
    for (const s of this.emitters) if (s.on && s.endless && s.kind === kind) s.on = false;
  }

  /* --- the loop -------------------------------------------------- */

  private wake() {
    if (this.running || this.destroyed) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private idle(): boolean {
    if (this.alive > 0) return false;
    if (this.flashLife > 0 || this.beamLife > 0 || this.dragonLife > 0) return false;
    for (const g of this.rings) if (g.on) return false;
    for (const s of this.emitters) if (s.on) return false;
    return true;
  }

  private frame = (now: number) => {
    if (this.destroyed) return;
    // Clamped: a backgrounded tab returns with a two-second delta and every
    // coin in flight would teleport through the floor.
    const dt = Math.min(0.05, Math.max(0.001, (now - this.last) / 1000));
    this.last = now;
    this.update(dt);
    this.draw();
    if (this.idle()) {
      this.running = false;
      this.c.clearRect(0, 0, this.w, this.h);
      return;
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  private update(dt: number) {
    const floor = this.h - 2;

    for (const s of this.emitters) {
      if (!s.on) continue;
      s.acc += s.rate * dt;
      let n = Math.floor(s.acc);
      if (n > 0) {
        s.acc -= n;
        if (!s.endless) n = Math.min(n, s.left);
        for (let k = 0; k < n; k++) this.emitOne(s);
        if (!s.endless) {
          s.left -= n;
          if (s.left <= 0) s.on = false;
        }
      }
    }

    for (let i = 0; i < MAX_PARTICLES; i++) {
      const life = this.plife[i];
      if (life <= 0) continue;
      const k = this.pkind[i];

      if (k === COIN) {
        this.pvy[i] += GRAVITY * dt;
        this.pvx[i] -= this.pvx[i] * 0.35 * dt;
        this.prot[i] += this.pspin[i] * dt;
        this.px[i] += this.pvx[i] * dt;
        this.py[i] += this.pvy[i] * dt;
        if (this.py[i] > floor && this.pvy[i] > 0) {
          // Real coins bounce, lose most of it, and skitter sideways.
          this.py[i] = floor;
          this.pvy[i] *= -0.42;
          this.pvx[i] *= 0.72;
          this.pspin[i] *= 0.6;
          if (this.pbounce[i] < 250) this.pbounce[i]++;
          if (this.pbounce[i] >= 3 || Math.abs(this.pvy[i]) < 60) {
            // Settled. Let it fade where it lies rather than jitter forever.
            this.plife[i] = Math.min(this.plife[i], 0.45);
            this.pvy[i] = 0;
            this.pvx[i] *= 0.4;
          }
        }
      } else if (k === CONFETTI) {
        this.pvy[i] += GRAVITY * 0.22 * dt;
        // Flutter: the paper turning over as it falls.
        this.pvx[i] += Math.sin(this.prot[i] * 1.7) * 90 * dt;
        this.pvx[i] -= this.pvx[i] * 1.4 * dt;
        this.prot[i] += this.pspin[i] * dt;
        this.px[i] += this.pvx[i] * dt;
        this.py[i] += this.pvy[i] * dt;
      } else if (k === SPARK) {
        this.pvy[i] += GRAVITY * 0.4 * dt;
        this.pvx[i] -= this.pvx[i] * 2.2 * dt;
        this.pvy[i] -= this.pvy[i] * 1.1 * dt;
        this.px[i] += this.pvx[i] * dt;
        this.py[i] += this.pvy[i] * dt;
      } else if (k === EMBER || k === FIRE) {
        // Hot air: they slow, rise and wander.
        this.pvy[i] -= (k === FIRE ? 320 : 46) * dt;
        this.pvy[i] -= this.pvy[i] * 0.9 * dt;
        this.pvx[i] += Math.sin(now01(this.prot[i], this.plife[i])) * 26 * dt;
        this.pvx[i] -= this.pvx[i] * 0.5 * dt;
        this.px[i] += this.pvx[i] * dt;
        this.py[i] += this.pvy[i] * dt;
      } else if (k === DUST) {
        this.pvy[i] -= 24 * dt;
        this.pvx[i] -= this.pvx[i] * 1.6 * dt;
        this.px[i] += this.pvx[i] * dt;
        this.py[i] += this.pvy[i] * dt;
        this.psize[i] += 26 * dt;
      } else {
        // GLINT: a fixed point of light that twinkles and goes out.
        this.prot[i] += this.pspin[i] * dt;
      }

      this.plife[i] = life - dt;
      if (this.plife[i] <= 0) this.kill(i);
      else if (this.py[i] > this.h + 80 || this.px[i] < -120 || this.px[i] > this.w + 120) this.kill(i);
    }

    for (const g of this.rings) {
      if (!g.on) continue;
      g.r += g.rv * dt;
      g.rv -= g.rv * 1.4 * dt;
      g.life -= dt;
      if (g.life <= 0) g.on = false;
    }

    if (this.flashLife > 0) this.flashLife -= dt;
    if (this.beamLife > 0) this.beamLife -= dt;
    if (this.dragonLife > 0) {
      this.dragonLife -= dt;
      const t = 1 - this.dragonLife / this.dragonMax;
      const g = this.box();
      const x = this.dragonDir > 0 ? -160 + t * (this.w + 320) : this.w + 160 - t * (this.w + 320);
      const y = g.y + g.h * 0.5 + Math.sin(t * 4.2) * g.h * 0.22;
      // The dragon sheds fire as it goes; the trail is what sells the pass.
      if (this.dragonLife > 0.2 && Math.random() < 0.7) {
        this.spawn(
          EMBER,
          x + rnd(-40, 40),
          y + rnd(-16, 16),
          rnd(-40, 40),
          rnd(-30, 10),
          rnd(0.5, 1.2),
          rnd(2, 5),
          pick(EMBERS),
          rnd(0.7, 1.2),
          0,
        );
      }
    }
  }

  private emitOne(s: Emitter) {
    if (s.kind === COIN) {
      const spin = rnd(-14, 14);
      this.spawn(
        COIN,
        s.x + rnd(-s.spread, s.spread),
        s.y + rnd(-8, 8),
        rnd(-460, 460) * s.power,
        rnd(-1500, -820) * s.power,
        rnd(2.2, 3.4),
        rnd(7, 13),
        pick(GOLDS),
        rnd(0.55, 1.35),
        spin,
      );
    } else if (s.kind === EMBER) {
      this.spawn(
        EMBER,
        s.x + rnd(-s.spread, s.spread),
        s.y + rnd(-10, 10),
        rnd(-30, 30),
        rnd(-70, -20),
        rnd(1.6, 3.4),
        rnd(1.4, 3.4),
        pick(EMBERS),
        rnd(0.5, 1.2),
        rnd(-2, 2),
      );
    } else if (s.kind === FIRE) {
      this.spawn(
        FIRE,
        s.x + rnd(-s.spread, s.spread),
        s.y + rnd(-6, 6),
        rnd(-70, 70),
        rnd(-320, -120) * s.power,
        rnd(0.5, 1.1),
        rnd(6, 16),
        pick(s.cols),
        rnd(0.6, 1.3),
        0,
      );
    } else {
      this.spawn(
        CONFETTI,
        s.x + rnd(-s.spread, s.spread),
        s.y,
        rnd(-320, 320),
        rnd(-820, -260) * s.power,
        rnd(2.4, 4),
        rnd(4, 9),
        pick(s.cols),
        rnd(0.6, 1.3),
        rnd(-9, 9),
      );
    }
  }

  /* --- paint ----------------------------------------------------- */

  private draw() {
    const c = this.c;
    c.clearRect(0, 0, this.w, this.h);

    /* Additive pass: everything that is light rather than an object. */
    c.globalCompositeOperation = 'lighter';

    if (this.beamLife > 0) this.drawBeams(c);
    if (this.dragonLife > 0) this.drawDragon(c);

    for (let i = 0; i < MAX_PARTICLES; i++) {
      const life = this.plife[i];
      if (life <= 0) continue;
      const k = this.pkind[i];
      if (k === COIN || k === CONFETTI) continue;
      const t = life / this.pmax[i];
      const z = this.pz[i];
      let a = t * z;
      let r = this.psize[i] * z;
      if (k === FIRE) {
        a = Math.min(1, t * 1.6) * 0.8 * z;
        r = this.psize[i] * (0.5 + (1 - t) * 1.1) * z;
      } else if (k === DUST) {
        a = t * 0.22 * z;
        r = this.psize[i] * z;
      } else if (k === GLINT) {
        a = t * z * (0.55 + 0.45 * Math.sin(this.prot[i] * 6));
      } else if (k === SPARK) {
        a = Math.min(1, t * 1.8) * z;
      }
      c.globalAlpha = Math.max(0, Math.min(1, a));
      c.fillStyle = COL[this.pcol[i]];
      c.beginPath();
      c.arc(this.px[i], this.py[i], Math.max(0.4, r), 0, TAU);
      c.fill();
      // The hot centre. Only on the near ones, which is what reads as depth.
      if (z > 1 && (k === SPARK || k === FIRE)) {
        c.globalAlpha = Math.max(0, Math.min(1, a * 0.7));
        c.fillStyle = COL[7];
        c.beginPath();
        c.arc(this.px[i], this.py[i], Math.max(0.3, r * 0.4), 0, TAU);
        c.fill();
      }
    }

    for (const g of this.rings) {
      if (!g.on) continue;
      const t = g.life / g.max;
      c.globalAlpha = Math.max(0, t * t * 0.9);
      c.strokeStyle = COL[g.col];
      c.lineWidth = Math.max(0.5, g.width * t);
      c.beginPath();
      c.arc(g.x, g.y, Math.max(1, g.r), 0, TAU);
      c.stroke();
    }

    if (this.flashLife > 0) {
      const t = this.flashLife / this.flashMax;
      c.globalAlpha = Math.max(0, t * t * this.flashPeak);
      c.fillStyle = COL[this.flashCol];
      c.fillRect(0, 0, this.w, this.h);
    }

    /* Solid pass: the things that are objects and cast their own edge. */
    c.globalCompositeOperation = 'source-over';

    for (let i = 0; i < MAX_PARTICLES; i++) {
      const life = this.plife[i];
      if (life <= 0) continue;
      const k = this.pkind[i];
      if (k !== COIN) continue;
      const t = Math.min(1, life / 0.45);
      const z = this.pz[i];
      const r = this.psize[i] * z;
      // A coin seen edge-on is a line; the cosine of its spin is its width.
      const face = Math.abs(Math.cos(this.prot[i]));
      c.globalAlpha = t * Math.min(1, 0.45 + z * 0.5);
      c.fillStyle = COL[this.pcol[i]];
      c.beginPath();
      c.ellipse(this.px[i], this.py[i], Math.max(0.6, r * (0.16 + 0.84 * face)), r, 0, 0, TAU);
      c.fill();
      if (z > 0.95) {
        c.globalAlpha = t * 0.5;
        c.fillStyle = COL[3];
        c.beginPath();
        c.ellipse(
          this.px[i] - r * 0.22 * face,
          this.py[i] - r * 0.24,
          Math.max(0.4, r * 0.34 * face),
          r * 0.38,
          0,
          0,
          TAU,
        );
        c.fill();
      }
    }

    for (let i = 0; i < MAX_PARTICLES; i++) {
      const life = this.plife[i];
      if (life <= 0 || this.pkind[i] !== CONFETTI) continue;
      const t = Math.min(1, life / 0.6);
      const z = this.pz[i];
      const s = this.psize[i] * z;
      const rot = this.prot[i];
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      // setTransform rather than save/rotate/restore: no stack, no allocation.
      c.setTransform(
        cos * this.dpr,
        sin * this.dpr,
        -sin * this.dpr,
        cos * this.dpr,
        this.px[i] * this.dpr,
        this.py[i] * this.dpr,
      );
      c.globalAlpha = t * Math.min(1, 0.5 + z * 0.5);
      c.fillStyle = COL[this.pcol[i]];
      // Foreshortened by its own spin, so it flickers as it turns.
      c.fillRect(-s * 0.5, -s * 0.22 * Math.abs(cos) - 0.5, s, s * 0.44 * Math.abs(cos) + 1);
    }
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    c.globalAlpha = 1;
  }

  private drawBeams(c: CanvasRenderingContext2D) {
    const t = this.beamLife / this.beamMax;
    const g = this.box();
    const cx = g.x + g.w / 2;
    const cy = g.y + g.h / 2;
    const reach = Math.hypot(this.w, this.h);
    const turn = (1 - t) * 1.6;
    const wide = 0.06 + 0.03 * Math.sin(t * 9);
    c.fillStyle = COL[this.beamCol];
    for (let i = 0; i < BEAMS; i++) {
      const a = turn + (i / BEAMS) * TAU;
      c.globalAlpha = Math.max(0, t * 0.16);
      c.beginPath();
      c.moveTo(cx, cy);
      c.lineTo(cx + Math.cos(a - wide) * reach, cy + Math.sin(a - wide) * reach);
      c.lineTo(cx + Math.cos(a + wide) * reach, cy + Math.sin(a + wide) * reach);
      c.closePath();
      c.fill();
    }
  }

  private drawDragon(c: CanvasRenderingContext2D) {
    const t = 1 - this.dragonLife / this.dragonMax;
    const g = this.box();
    const head = this.dragonDir > 0 ? -160 + t * (this.w + 320) : this.w + 160 - t * (this.w + 320);
    const fade = Math.min(1, Math.min(t, 1 - t) * 6);
    const len = 26;
    for (let i = 0; i < len; i++) {
      const u = i / len;
      const x = head - this.dragonDir * u * 260;
      const y = g.y + g.h * 0.5 + Math.sin((t - u * 0.16) * 4.2) * g.h * 0.22;
      const r = (1 - u) * 16 + 3;
      c.globalAlpha = fade * (0.42 - u * 0.3);
      c.fillStyle = COL[i < 4 ? 3 : i < 12 ? 4 : 5];
      c.beginPath();
      c.arc(x, y, r, 0, TAU);
      c.fill();
    }
  }

  /* ------------------------------------------------------------------ *
   * The effects themselves
   * ------------------------------------------------------------------ */

  /** How much of an effect to actually throw, given the motion preference. */
  private scale(n: number): number {
    return this.reduced ? Math.max(1, Math.round(n * 0.2)) : n;
  }

  /** Light across the whole screen. Under reduced motion: dimmer and slower. */
  flash(peak: number, seconds: number, col = 3) {
    this.flashCol = col;
    this.flashPeak = this.reduced ? peak * 0.28 : peak;
    this.flashMax = this.reduced ? seconds * 1.8 : seconds;
    this.flashLife = this.flashMax;
    this.wake();
  }

  /**
   * The cabinet taking a hit.
   *
   * On <body> rather than on anything of this layer's, because a shake that
   * moves the particles but not the reels underneath them looks like a bug in
   * the particles. Never under reduced motion, at all.
   */
  shake(amp: number) {
    if (this.reduced || amp <= 0 || typeof document === 'undefined') return;
    const b = document.body;
    b.style.setProperty('--fx-shake-amp', `${amp}px`);
    b.classList.remove('fx-shake');
    // Forces the class to restart when two big wins land back to back.
    void b.offsetWidth;
    b.classList.add('fx-shake');
    window.setTimeout(() => b.classList.remove('fx-shake'), 460);
  }

  /** The signature gesture: coins out of the reel window, scaled to the win. */
  coins(tier: WinTier) {
    const n = this.scale(TIER_COINS[tier]);
    if (n <= 0) return;
    const g = this.box();
    const secs = TIER_SECONDS[tier];
    const burst = Math.max(1, Math.round(n * 0.35));
    // A hard spill first so the win has an attack, then a steady fountain for
    // as long as the meter is counting.
    this.emitter({
      kind: COIN,
      x: g.x + g.w / 2,
      y: g.y + g.h * 0.62,
      left: burst,
      rate: 320,
      spread: g.w * 0.42,
      power: 1,
      cols: GOLDS,
    });
    this.emitter({
      kind: COIN,
      x: g.x + g.w / 2,
      y: g.y + g.h * 0.62,
      left: n - burst,
      rate: Math.max(4, (n - burst) / Math.max(0.4, secs)),
      spread: g.w * 0.46,
      power: 0.88,
      cols: GOLDS,
    });
  }

  /** Gold coming off a line that has just lit. */
  line(cells: readonly Cell[]) {
    const per = this.scale(9);
    for (const cell of cells) {
      const p = this.cellAt(cell);
      for (let i = 0; i < per; i++) {
        const a = Math.random() * TAU;
        const v = rnd(60, 300);
        this.spawn(
          SPARK,
          p.x + rnd(-14, 14),
          p.y + rnd(-14, 14),
          Math.cos(a) * v,
          Math.sin(a) * v - 60,
          rnd(0.35, 0.85),
          rnd(1.4, 3.2),
          pick(GOLDS),
          rnd(0.6, 1.3),
          0,
        );
      }
      this.spawn(GLINT, p.x, p.y, 0, 0, 0.7, 9, 3, 1.2, 7);
    }
  }

  /** One symbol lighting up: a ring and a handful of sparks off its edges. */
  burst(cell: Cell, col = 1, power = 1) {
    const p = this.cellAt(cell);
    const g = this.box();
    const r = Math.min(g.w / REELS, g.h / ROWS) * 0.5;
    this.ring(p.x, p.y, r * 0.4, 260 * power, 0.5, 3 * power, col);
    const n = this.scale(Math.round(10 * power));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rnd(-0.2, 0.2);
      const v = rnd(120, 420) * power;
      this.spawn(
        SPARK,
        p.x,
        p.y,
        Math.cos(a) * v,
        Math.sin(a) * v,
        rnd(0.3, 0.7),
        rnd(1.6, 3.6),
        col,
        rnd(0.7, 1.35),
        0,
      );
    }
  }

  /** A scatter or an orb arriving: a heavier version of the same idea. */
  impact(cell: Cell, col: number) {
    const p = this.cellAt(cell);
    this.ring(p.x, p.y, 6, 520, 0.55, 4, col);
    const n = this.scale(16);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const v = rnd(160, 520);
      this.spawn(
        SPARK,
        p.x,
        p.y,
        Math.cos(a) * v,
        Math.sin(a) * v * 0.7 - 40,
        rnd(0.3, 0.8),
        rnd(1.8, 4),
        col,
        rnd(0.7, 1.35),
        0,
      );
    }
    for (let i = 0; i < this.scale(6); i++) {
      this.spawn(DUST, p.x + rnd(-20, 20), p.y + rnd(-8, 14), rnd(-40, 40), rnd(-20, 10), rnd(0.5, 1), rnd(8, 18), col, 0.8, 0);
    }
  }

  /** An orb slamming into its niche: a shockwave, and the glass complaining. */
  orbSlam(cell: Cell) {
    const p = this.cellAt(cell);
    const g = this.box();
    const r = Math.min(g.w / REELS, g.h / ROWS);
    this.ring(p.x, p.y, 2, 900, 0.45, 6, 8);
    this.ring(p.x, p.y, 2, 520, 0.7, 3, 12);
    const n = this.scale(22);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const v = rnd(200, 700);
      this.spawn(
        SPARK,
        p.x,
        p.y,
        Math.cos(a) * v,
        Math.sin(a) * v * 0.6,
        rnd(0.25, 0.7),
        rnd(2, 4.4),
        i % 3 === 0 ? 12 : 8,
        rnd(0.7, 1.35),
        0,
      );
    }
    this.emitter({ kind: FIRE, x: p.x, y: p.y + r * 0.2, left: this.scale(10), rate: 90, spread: r * 0.3, power: 0.5, cols: [8, 9, 12] });
    this.shake(4);
  }

  /** The reel landing. Small enough to happen five times a spin, every spin. */
  landing(reel: number) {
    if (this.reduced) return;
    const g = this.box();
    const x = g.x + ((reel + 0.5) * g.w) / REELS;
    const y = g.y + g.h - 4;
    for (let i = 0; i < 5; i++) {
      this.spawn(DUST, x + rnd(-g.w / REELS / 2, g.w / REELS / 2), y, rnd(-60, 60), rnd(-90, -30), rnd(0.35, 0.6), rnd(6, 14), 2, 0.6, 0);
    }
  }

  /** Free spins beginning: a wall of fire up the whole screen. */
  fireWall() {
    const n = this.scale(90);
    this.emitter({
      kind: FIRE,
      x: this.w / 2,
      y: this.h + 10,
      left: n,
      rate: 260,
      spread: this.w * 0.52,
      power: 1.5,
      cols: [3, 4, 5, 6],
    });
    this.flash(0.4, 0.5, 4);
    this.shake(7);
  }

  /** Embers drifting for as long as the shrine is burning. */
  setEmbers(on: boolean) {
    if (!on) {
      this.stopEmitters(EMBER);
      return;
    }
    for (const s of this.emitters) if (s.on && s.endless && s.kind === EMBER) return;
    this.emitter({
      kind: EMBER,
      x: this.w / 2,
      y: this.h + 12,
      rate: this.reduced ? 1.5 : 7,
      spread: this.w * 0.5,
      power: 1,
      cols: EMBERS,
      endless: true,
    });
  }

  /** The dragon crossing the glass. */
  dragon() {
    this.dragonMax = this.reduced ? 2.6 : 1.8;
    this.dragonLife = this.dragonMax;
    this.dragonDir = Math.random() < 0.5 ? 1 : -1;
    this.wake();
  }

  /** A jackpot: confetti, and the beams turning behind it. */
  jackpot(id: JackpotId) {
    const col = JACKPOT_COL[id];
    const big = id === 'GRAND' || id === 'MAJOR';
    this.beamCol = col;
    this.beamMax = big ? 4.5 : 2.6;
    this.beamLife = this.beamMax;
    this.flash(big ? 0.55 : 0.3, big ? 0.6 : 0.35, col);
    this.shake(big ? 12 : 6);
    const n = this.scale(big ? 180 : 90);
    this.emitter({
      kind: CONFETTI,
      x: this.w / 2,
      y: this.h * 0.34,
      left: n,
      rate: 180,
      spread: this.w * 0.48,
      power: 1,
      cols: [col, 0, 1, 3, 7],
    });
    this.coins(big ? 'LEGENDARY' : 'MEGA');
    this.wake();
  }

  /** The board filled: everything, at once, from the middle. */
  supernova() {
    const g = this.box();
    const cx = g.x + g.w / 2;
    const cy = g.y + g.h / 2;
    this.ring(cx, cy, 4, 2600, 1.1, 14, 12);
    this.ring(cx, cy, 4, 1700, 1.4, 8, 3);
    this.ring(cx, cy, 4, 1000, 1.8, 4, 8);
    this.flash(0.75, 0.9, 3);
    this.shake(16);
    const n = this.scale(220);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rnd(-0.1, 0.1);
      const v = rnd(300, 1400);
      this.spawn(
        SPARK,
        cx,
        cy,
        Math.cos(a) * v,
        Math.sin(a) * v,
        rnd(0.5, 1.4),
        rnd(2, 5),
        i % 4 === 0 ? 7 : pick(GOLDS),
        rnd(0.6, 1.4),
        0,
      );
    }
    this.coins('LEGENDARY');
  }

  destroy() {
    this.destroyed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.running = false;
    if (typeof document !== 'undefined') document.body.classList.remove('fx-shake');
  }
}

/**
 * A cheap wandering value for the ember drift.
 *
 * Pulled out so the update loop can call it without building a closure or a
 * per-particle phase array: rotation and remaining life are two numbers the
 * particle already has, and their sum wanders slowly and differently for every
 * particle in the pool.
 */
function now01(rot: number, life: number): number {
  return rot + life * 3.1;
}

/* ------------------------------------------------------------------ *
 * The component
 * ------------------------------------------------------------------ */

export function FxLayer(): React.JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let field: Field;
    try {
      field = new Field(el);
    } catch {
      // No 2D context (a very old browser, or a locked-down embedding). The
      // game is entirely playable without particles, so this is not an error.
      return;
    }

    field.reduced = useSlots.getState().prefs.reducedMotion;
    window.addEventListener('resize', field.resize);
    window.addEventListener('orientationchange', field.resize);

    /*
     * One subscription, watching for transitions. Everything below is a
     * reference or a number comparison, because this runs on every store
     * write and a count-up writes sixty times a second.
     */
    const unsub = useSlots.subscribe((s, p) => {
      if (s.prefs.reducedMotion !== p.prefs.reducedMotion) {
        field.reduced = s.prefs.reducedMotion;
      }

      /* --- reels landing --- */
      if (s.reels !== p.reels) {
        for (let i = 0; i < s.reels.length; i++) {
          if (s.reels[i] === 'LANDED' && p.reels[i] !== 'LANDED') field.landing(i);
        }
        // The whole board is in: mark what landed on it. Doing this here
        // rather than off `result` matters — the engine resolves a spin before
        // the first reel has stopped, and a scatter that flashes while its
        // reel is still spinning gives the outcome away.
        const done = s.reels.every((r) => r === 'LANDED');
        const was = p.reels.every((r) => r === 'LANDED');
        if (done && !was && s.result) {
          if (s.result.scatter) {
            for (const cell of s.result.scatter.cells) field.impact(cell, 10);
          }
          if (s.result.orbs.length > 0 && s.phase !== 'HOLD') {
            for (const orb of s.result.orbs) field.impact(orb, 8);
          }
          if (s.result.dragonReels.length > 0) field.dragon();
        }
      }

      /* --- a line lighting up --- */
      if (s.highlight !== p.highlight && s.highlight) {
        field.line(s.highlight.cells);
        for (const cell of s.highlight.cells) field.burst(cell, 1, 0.7);
      }

      /* --- a win being presented --- */
      if (s.presentation !== p.presentation && s.presentation) {
        const tier = s.presentation.tier;
        field.coins(tier);
        const amp = TIER_SHAKE[tier];
        if (amp > 0) {
          field.shake(amp);
          field.flash(tier === 'LEGENDARY' ? 0.5 : 0.3, 0.45, 3);
        }
      }

      /* --- features --- */
      if (s.phase !== p.phase) {
        const burning = s.phase === 'FREE_SPINS' || (s.free !== null && s.phase !== 'IDLE');
        field.setEmbers(burning);
        if (s.phase === 'FREE_SPINS' && p.phase !== 'FREE_SPINS' && p.free === null) field.fireWall();
      }
      if (s.free === null && p.free !== null) field.setEmbers(false);

      /* --- the link --- */
      if (s.orbs !== p.orbs && s.orbs.length > p.orbs.length) {
        // Only the ones that are new: an orb already locked does not re-land.
        for (let i = p.orbs.length; i < s.orbs.length; i++) field.orbSlam(s.orbs[i]);
        if (s.orbs.length >= CELLS && p.orbs.length < CELLS) field.supernova();
      }

      /* --- jackpots --- */
      if (s.jackpotWon !== p.jackpotWon && s.jackpotWon) {
        if (s.jackpotWon === 'GRAND') field.supernova();
        field.jackpot(s.jackpotWon);
      }
    });

    return () => {
      unsub();
      window.removeEventListener('resize', field.resize);
      window.removeEventListener('orientationchange', field.resize);
      field.destroy();
    };
  }, []);

  return <canvas ref={canvas} className="fx-canvas" aria-hidden />;
}
