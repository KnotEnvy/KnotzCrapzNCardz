'use client';

/**
 * Table sound, synthesised on the fly.
 *
 * Nothing here is loaded from a file. A card sliding off a shoe is filtered
 * noise with a fast attack and a long tail; a chip is a bright tick over a
 * short resonant body; the shuffle is thirty of those cards overlapped with
 * jitter. It keeps the bundle free of audio assets, and it lets every sound
 * carry its own velocity — the last card of a five-card hand lands harder than
 * the first, because it is told to.
 *
 * Three things are worth knowing before changing any of it.
 *
 * 1. Every `gain` below means roughly the peak amplitude that voice puts on
 *    the output. Noise through a narrow filter arrives far quieter than an
 *    oscillator on the same envelope, so {@link noiseTrim} divides that
 *    difference out and the numbers can be read as a mix.
 *
 * 2. Everything meets at one bus and the bus ends in a soft clip. Below
 *    {@link KNEE} the curve is exactly y = x, so the mix is untouched; above
 *    it the curve bends and provably cannot reach 1. It is insurance against
 *    a pile-up nobody enumerated — a five-hand split settling all at once
 *    while the shoe is being shuffled — and it is free on everything else.
 *
 * 3. Nothing is tonal except the three stings that decide money, and those are
 *    an interval rather than a tune. A blackjack table is card stock, clay and
 *    a dealer's voice. An arpeggio reads as a slot machine, which is the one
 *    thing this room is not.
 */

/* ------------------------------------------------------------------ *
 * The bus
 * ------------------------------------------------------------------ */

let ctx: AudioContext | null = null;
let bus: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let enabled = true;

/** The whole table's level, in one place. Held at unity so `gain` means what it says. */
const MASTER = 1;

/** Where the soft clip starts bending. Its hard limit is KNEE + (1-KNEE)·tanh(1). */
const KNEE = 0.62;

/**
 * Noise through a bandpass loses most of its energy to the filter. Measured
 * across the filters used here, what comes out is about a fifth of what an
 * oscillator on the same envelope would give, so noise voices are scaled up by
 * the reciprocal and their `gain` numbers become comparable to the tonal ones.
 */
const noiseTrim = 5.0;

function softClipCurve(): Float32Array<ArrayBuffer> {
  const n = 1024;
  // Explicitly over an ArrayBuffer: `curve` is typed as Float32Array<ArrayBuffer>
  // in lib.dom, and a plain Float32Array is now Float32Array<ArrayBufferLike>,
  // which a SharedArrayBuffer would also satisfy and a WaveShaper would not.
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= KNEE ? a : KNEE + (1 - KNEE) * Math.tanh((a - KNEE) / (1 - KNEE));
    curve[i] = Math.sign(x) * y;
  }
  return curve;
}

/**
 * Bring the audio graph up.
 *
 * Must be called from inside a user gesture: every browser starts an
 * AudioContext suspended and will not resume it otherwise. The store calls
 * this on the first click anywhere in the app.
 */
export function initAudio(): void {
  if (ctx) {
    if (ctx.state === 'suspended') void ctx.resume();
    return;
  }
  type WithWebkit = typeof globalThis & { webkitAudioContext?: typeof AudioContext };
  const Ctor = window.AudioContext ?? (globalThis as WithWebkit).webkitAudioContext;
  if (!Ctor) return;

  ctx = new Ctor();
  const clip = ctx.createWaveShaper();
  clip.curve = softClipCurve();
  clip.oversample = '2x';
  bus = ctx.createGain();
  bus.gain.value = MASTER;
  bus.connect(clip);
  clip.connect(ctx.destination);

  // Two seconds of white noise, reused by every noise voice. Generating it
  // once costs nothing and generating it per sound costs a frame.
  const len = Math.floor(ctx.sampleRate * 2);
  noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
}

export function setAudioEnabled(on: boolean): void {
  enabled = on;
  if (on) initAudio();
}

export function audioEnabled(): boolean {
  return enabled;
}

function ready(): { ctx: AudioContext; bus: GainNode } | null {
  if (!enabled || !ctx || !bus) return null;
  if (ctx.state === 'suspended') void ctx.resume();
  return { ctx, bus };
}

/* ------------------------------------------------------------------ *
 * Voices
 * ------------------------------------------------------------------ */

interface NoiseOpts {
  delay?: number;
  gain?: number;
  /** Bandpass centre, in Hz. */
  freq?: number;
  q?: number;
  attack?: number;
  decay?: number;
  type?: BiquadFilterType;
}

function noise({
  delay = 0,
  gain = 0.2,
  freq = 2000,
  q = 1,
  attack = 0.002,
  decay = 0.08,
  type = 'bandpass',
}: NoiseOpts): void {
  const a = ready();
  if (!a || !noiseBuffer) return;
  const t = a.ctx.currentTime + delay;

  const src = a.ctx.createBufferSource();
  src.buffer = noiseBuffer;
  // A random offset into the buffer, so ten cards in a row are ten different
  // sounds rather than the same one ten times.
  src.loop = true;
  const filter = a.ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  const g = a.ctx.createGain();

  const peak = gain * noiseTrim;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);

  src.connect(filter);
  filter.connect(g);
  g.connect(a.bus);
  src.start(t, Math.random() * 1.5);
  src.stop(t + attack + decay + 0.02);
}

interface ToneOpts {
  delay?: number;
  gain?: number;
  freq: number;
  /** Slide to this frequency over the life of the note, if given. */
  to?: number;
  attack?: number;
  decay?: number;
  type?: OscillatorType;
}

function tone({
  delay = 0,
  gain = 0.15,
  freq,
  to,
  attack = 0.004,
  decay = 0.18,
  type = 'sine',
}: ToneOpts): void {
  const a = ready();
  if (!a) return;
  const t = a.ctx.currentTime + delay;

  const osc = a.ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + decay);

  const g = a.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);

  osc.connect(g);
  g.connect(a.bus);
  osc.start(t);
  osc.stop(t + attack + decay + 0.02);
}

/* ------------------------------------------------------------------ *
 * The table's sounds
 * ------------------------------------------------------------------ */

/**
 * A card off the shoe.
 *
 * Two layers: the slide (broad noise, quick) and the slap as it lands on the
 * felt (lower, shorter). `hard` is 0..1 and moves both the brightness and the
 * level, so the dealer's last card genuinely sounds like it was thrown.
 */
export function sndCard(delay = 0, hard = 0.5): void {
  noise({ delay, gain: 0.1 + hard * 0.06, freq: 2600 + hard * 1800, q: 0.7, attack: 0.001, decay: 0.045 });
  noise({ delay: delay + 0.02, gain: 0.07 + hard * 0.05, freq: 420, q: 1.4, attack: 0.001, decay: 0.06 });
}

/** The hole card turning over: the same slide, backwards and softer. */
export function sndFlip(delay = 0): void {
  noise({ delay, gain: 0.09, freq: 1500, q: 0.8, attack: 0.004, decay: 0.07 });
  noise({ delay: delay + 0.05, gain: 0.11, freq: 3200, q: 0.9, attack: 0.001, decay: 0.04 });
}

/** A clay chip landing on felt. */
export function sndChip(delay = 0, stack = 1): void {
  const n = Math.min(4, Math.max(1, Math.round(stack)));
  for (let i = 0; i < n; i++) {
    const d = delay + i * 0.022 + Math.random() * 0.008;
    noise({ delay: d, gain: 0.11, freq: 5200 + Math.random() * 1400, q: 2.2, attack: 0.0008, decay: 0.03 });
    tone({ delay: d, gain: 0.05, freq: 620 + Math.random() * 90, to: 380, attack: 0.001, decay: 0.05, type: 'triangle' });
  }
}

/** Chips pushed across the felt to a winner. */
export function sndPush(delay = 0): void {
  noise({ delay, gain: 0.07, freq: 900, q: 0.6, attack: 0.02, decay: 0.22, type: 'lowpass' });
  sndChip(delay + 0.12, 3);
}

/** The dealer's hand sweeping a loser off the layout. */
export function sndSweep(delay = 0): void {
  const a = ready();
  if (!a || !noiseBuffer) return;
  const t = a.ctx.currentTime + delay;
  const src = a.ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.loop = true;
  const filter = a.ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(3200, t);
  filter.frequency.exponentialRampToValueAtTime(320, t + 0.32);
  filter.Q.value = 0.8;
  const g = a.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.09 * noiseTrim, t + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
  src.connect(filter);
  filter.connect(g);
  g.connect(a.bus);
  src.start(t, Math.random());
  src.stop(t + 0.38);
}

/** A whole shoe being shuffled: thirty riffles with jitter, then the cut. */
export function sndShuffle(delay = 0): void {
  for (let i = 0; i < 26; i++) {
    const d = delay + i * 0.018 + Math.random() * 0.012;
    noise({ delay: d, gain: 0.045, freq: 3000 + Math.random() * 2500, q: 1.1, attack: 0.001, decay: 0.028 });
  }
  noise({ delay: delay + 0.56, gain: 0.1, freq: 1200, q: 0.9, attack: 0.002, decay: 0.09 });
}

/* --- the three stings that decide money --- */

/**
 * A win. A rising major third, which is the smallest interval that reads as
 * good news without sounding like a jingle.
 */
export function sndWin(delay = 0): void {
  tone({ delay, gain: 0.1, freq: 523.25, attack: 0.006, decay: 0.16, type: 'triangle' });
  tone({ delay: delay + 0.075, gain: 0.09, freq: 659.25, attack: 0.006, decay: 0.24, type: 'triangle' });
  sndPush(delay + 0.05);
}

/** A blackjack. The same shape, a fifth higher and with a third note. */
export function sndBlackjack(delay = 0): void {
  tone({ delay, gain: 0.11, freq: 659.25, attack: 0.005, decay: 0.14, type: 'triangle' });
  tone({ delay: delay + 0.07, gain: 0.1, freq: 830.61, attack: 0.005, decay: 0.16, type: 'triangle' });
  tone({ delay: delay + 0.15, gain: 0.11, freq: 987.77, attack: 0.005, decay: 0.42, type: 'triangle' });
  sndPush(delay + 0.16);
}

/** A loss. One low note, falling, and the sweep. */
export function sndLose(delay = 0): void {
  tone({ delay, gain: 0.08, freq: 196, to: 130, attack: 0.008, decay: 0.3, type: 'sine' });
  sndSweep(delay + 0.02);
}

/** A push. Flat, neutral, over as soon as it starts. */
export function sndPushResult(delay = 0): void {
  tone({ delay, gain: 0.06, freq: 392, attack: 0.006, decay: 0.14, type: 'sine' });
}

/** A bust: the loss note with the card that caused it still ringing. */
export function sndBust(delay = 0): void {
  tone({ delay, gain: 0.09, freq: 155, to: 92, attack: 0.006, decay: 0.36, type: 'sawtooth' });
  noise({ delay, gain: 0.06, freq: 700, q: 0.7, attack: 0.002, decay: 0.16 });
}

/* --- interface --- */

export function sndClick(delay = 0): void {
  noise({ delay, gain: 0.05, freq: 4200, q: 3, attack: 0.0006, decay: 0.018 });
}

/** A refused action. Short, low, and unmistakably a no. */
export function sndDeny(delay = 0): void {
  tone({ delay, gain: 0.07, freq: 180, attack: 0.003, decay: 0.09, type: 'square' });
}

/** The cut card surfacing. One knock. */
export function sndCutCard(delay = 0): void {
  tone({ delay, gain: 0.07, freq: 240, to: 170, attack: 0.002, decay: 0.12, type: 'triangle' });
  noise({ delay, gain: 0.05, freq: 1400, q: 1.6, attack: 0.001, decay: 0.05 });
}

/** The trainer marking a play wrong. Quiet enough not to punish. */
export function sndWrong(delay = 0): void {
  tone({ delay, gain: 0.05, freq: 330, attack: 0.004, decay: 0.08, type: 'sine' });
  tone({ delay: delay + 0.09, gain: 0.05, freq: 262, attack: 0.004, decay: 0.14, type: 'sine' });
}
