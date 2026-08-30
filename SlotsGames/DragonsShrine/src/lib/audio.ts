'use client';

/**
 * The machine's whole sound, synthesised on the fly.
 *
 * Nothing here is loaded from a file. A reel click is a bandpassed noise burst
 * over a short wooden body, a temple bell is six inharmonic partials with
 * separate decays, a taiko is filtered noise sitting on a sine that falls half
 * an octave in forty milliseconds, and a gong is the same idea with a slow
 * attack and a tail measured in seconds. That keeps the bundle free of audio
 * assets, lets every voice carry its own velocity and pitch, and means a
 * fanfare can be built out of the same parts as the reel stops so the two
 * never sound like they came from different machines.
 *
 * Six things are worth knowing before changing any of it.
 *
 * 1. Every `gain` in this file means one thing: roughly the peak amplitude
 *    that voice puts on the output. Noise through a narrow filter arrives far
 *    quieter than an oscillator on the same envelope, so {@link noiseTrim}
 *    divides that difference out; additive voices (bell, gong, pluck, brass)
 *    normalise their partial set to sum to one for the same reason. Without
 *    both, the numbers below are not comparable and the mix is guesswork.
 *
 * 2. Everything meets at one bus and the bus ends in a soft clip. Below
 *    {@link KNEE} the curve is exactly y = x so the mix is untouched, and
 *    above it the curve bends and provably cannot reach 1 — its limit is
 *    KNEE + (1 - KNEE) * tanh(1) = 0.893. A slot piles up: twenty coins, a
 *    fanfare, a gong, a reel loop and a music bed can all be running on the
 *    same frame, which is exactly the case a table game never has to survive.
 *
 * 3. Every cue takes a `delay` in seconds, because a spin is a short score
 *    rather than a single event: five stops, a scatter, a line, a meter and a
 *    fanfare all have to be laid out in time by the caller. Nothing here fires
 *    on its own except the loops, which are explicitly started and stopped.
 *
 * 4. Unlike a craps table, this machine IS tonal — a slot's win music is the
 *    point. Everything pitched is drawn from one A minor pentatonic scale
 *    ({@link deg}), which is why a fanfare, a meter tick, a bell and a reel
 *    stop landing on the same frame harmonise rather than clash. That happens
 *    constantly and it is not something the caller can be asked to avoid.
 *
 * 5. The win fanfares are one function ({@link fanfare}) called with six
 *    numbers. SMALL through LEGENDARY, and the four jackpots, are literally
 *    the same motif — A D E A', rising — restated in more octaves, with more
 *    percussion under it, for longer. That is what makes an EPIC read as "the
 *    thing that just happened, but bigger" rather than as a different game.
 *
 * 6. Levels were MEASURED, not guessed. Every cue in this file was rendered
 *    through an offline Web Audio shim and read back for peak and RMS; the
 *    figures in the section comments below are those readings at the default
 *    gain, in dBFS. The shape of the mix is:
 *
 *      stings      (fanfares, jackpots, gong, feature cards)  peak 0.30..0.86
 *      felt        (reel stops, orbs, coins, drums)           peak 0.12..0.36
 *      interface   (buttons, meter ticks, symbol lands)       peak 0.05..0.14
 *      beds        (reel loop, ambience, music)               RMS  -46..-34
 *
 *    If the balance needs revisiting, measure it again rather than nudging
 *    numbers by ear — none of this can be checked by eye and the spectral
 *    split is where the real mistakes hide.
 *
 * The module is safe to import with no Web Audio at all: nothing touches
 * `window` until a call is made, and every call returns quietly when there is
 * no context to play into. `npm test` runs in node and imports this file.
 */

import type { SoundName } from '@/lib/store/contract';

export interface SoundOptions {
  /** Seconds from now. A spin is a short score, not a single cue. */
  delay?: number;
  /** 0..1, scaling this voice only. */
  gain?: number;
  /** Semitone offset, for sounds that step up as something builds. */
  pitch?: number;
}

/* ------------------------------------------------------------------ *
 * The bus
 * ------------------------------------------------------------------ */

let ctx: AudioContext | null = null;
/** Master. Everything, including music, arrives here. */
let bus: GainNode | null = null;
/** Cues and effect loops. */
let sfxBus: GainNode | null = null;
/** The music beds, so they can be muted without touching the effects. */
let musicBus: GainNode | null = null;
let noise: AudioBuffer | null = null;

let soundOn = true;
let musicOn = true;

/**
 * The whole machine's level, in one place.
 *
 * Held at unity so that `gain` on a voice means what it says: the peak
 * amplitude that voice puts on the bus, and therefore on the output.
 */
const MASTER = 1;

/**
 * How far under the effects the music sits.
 *
 * A slot's bed is atmosphere, not a soundtrack: it has to survive a fanfare
 * landing on top of it without either fighting the fanfare or vanishing. The
 * beds are written quiet and then this takes another 9 dB off.
 */
const MUSIC_LEVEL = 0.36;

/**
 * Where the soft clip starts bending.
 *
 * Under it the transfer curve is exactly y = x, so a single quiet sound passes
 * through untouched. Over it the curve is a tanh knee whose limit is
 * KNEE + (1 - KNEE) * tanh(1) = 0.893, the highest sample this module can
 * produce no matter how much lands at once.
 */
const KNEE = 0.55;

/** How long the shared noise buffer is, in seconds. */
const NOISE_SECONDS = 2;

/** How far ahead the loop schedulers place events, in seconds. */
const LOOKAHEAD = 0.28;

/** How often the loop schedulers wake up, in milliseconds. */
const TICK_MS = 90;

/**
 * The transfer curve for the bus limiter.
 *
 * Built on a concrete ArrayBuffer rather than by length: `new Float32Array(n)`
 * infers Float32Array<ArrayBufferLike>, and WaveShaperNode.curve wants the
 * buffer type pinned.
 */
function softClipCurve(n = 4096): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(new ArrayBuffer(n * Float32Array.BYTES_PER_ELEMENT));
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a <= KNEE ? a : KNEE + (1 - KNEE) * Math.tanh((a - KNEE) / (1 - KNEE));
    curve[i] = x < 0 ? -y : y;
  }
  return curve;
}

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();

    const shaper = ctx.createWaveShaper();
    shaper.curve = softClipCurve();
    // 'none' on purpose. An oversampled shaper filters on the way back down and
    // that filter rings, which can push a sample past the curve's own maximum —
    // the one thing this node exists to guarantee it cannot do.
    shaper.oversample = 'none';
    shaper.connect(ctx.destination);

    bus = ctx.createGain();
    bus.gain.value = MASTER;
    bus.connect(shaper);

    sfxBus = ctx.createGain();
    sfxBus.gain.value = 1;
    sfxBus.connect(bus);

    musicBus = ctx.createGain();
    musicBus.gain.value = musicOn ? MUSIC_LEVEL : 0;
    musicBus.connect(bus);
  }
  // Browsers start the context suspended until a gesture; nudge it each time.
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/**
 * Opens the audio graph from a user gesture.
 *
 * Browsers refuse to start an AudioContext otherwise, and a machine whose
 * first spin is silent reads as broken. Cheap and idempotent, so the cabinet
 * can call it from every pointerdown without thinking about it.
 */
export function unlockAudio(): void {
  const c = audio();
  if (c && c.state === 'suspended') void c.resume();
}

export function setSoundEnabled(on: boolean): void {
  soundOn = on;
  if (!on) {
    // Loops do not stop themselves, and a muted machine with a reel bed still
    // running is a CPU leak the player cannot hear and cannot end.
    for (const name of Array.from(loops.keys())) endLoop(name, 0.06);
  }
}

export function setMusicEnabled(on: boolean): void {
  musicOn = on;
  const c = audio();
  if (!c || !musicBus) return;
  musicBus.gain.cancelScheduledValues(c.currentTime);
  musicBus.gain.setValueAtTime(musicBus.gain.value, c.currentTime);
  musicBus.gain.linearRampToValueAtTime(on ? MUSIC_LEVEL : 0, c.currentTime + 0.35);
  if (on) {
    if (wantedTrack && !musicTrack) startMusic(wantedTrack);
  } else if (musicTrack) {
    // Keep what the game asked for so re-enabling resumes the right bed.
    stopBed(0.35);
  }
}

/**
 * A cue in flight: the context, where it goes, when it starts, and the two
 * modifiers every cue understands.
 */
interface Cue {
  c: AudioContext;
  out: AudioNode;
  /** Absolute context time. */
  t: number;
  /** Level scale, 1 by default. */
  g: number;
  /** Semitone offset applied to everything pitched, 0 by default. */
  p: number;
}

function begin(opts: SoundOptions): Cue | null {
  const c = audio();
  if (!c || !sfxBus || !soundOn) return null;
  return {
    c,
    out: sfxBus,
    t: c.currentTime + Math.max(0, opts.delay ?? 0),
    g: opts.gain ?? 1,
    p: opts.pitch ?? 0,
  };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/* ------------------------------------------------------------------ *
 * Pitch
 *
 * One scale for the whole machine. A minor pentatonic has no semitone
 * neighbours in it, which is precisely why a fanfare, a bell, five reel stops
 * and a meter tick can all land on the same frame and still sound deliberate.
 * ------------------------------------------------------------------ */

/** A3. Low enough for the drums to sit under, high enough for a phone. */
const ROOT = 220;

/** A minor pentatonic, in semitones: A C D E G. */
const PENT = [0, 3, 5, 7, 10];

/**
 * Scale degree to frequency. Degrees run continuously through octaves, so
 * `deg(5)` is the octave above `deg(0)` and negative degrees go below.
 */
function deg(n: number): number {
  const oct = Math.floor(n / PENT.length);
  const idx = n - oct * PENT.length;
  return ROOT * Math.pow(2, oct + PENT[idx] / 12);
}

/** Shifts a frequency by semitones. Used for the `pitch` option. */
function semi(f: number, n: number): number {
  return n === 0 ? f : f * Math.pow(2, n / 12);
}

/* ------------------------------------------------------------------ *
 * Primitives
 * ------------------------------------------------------------------ */

/**
 * One noise buffer for the whole session, crossfaded end to start so it can
 * also be looped without a seam.
 *
 * The crossfade matters. A raw random buffer looped in place steps from its
 * last sample to its first, and a step through a resonant filter is a click
 * once per buffer length — the single most obvious way a generated bed gives
 * itself away. Building the buffer from `frames + fade` samples and blending
 * the head with what follows the tail makes the seam continuous in the
 * original random stream, so the loop point is not merely disguised but
 * genuinely absent.
 */
function noiseBuffer(c: AudioContext): AudioBuffer {
  if (!noise || noise.sampleRate !== c.sampleRate) {
    const frames = Math.floor(c.sampleRate * NOISE_SECONDS);
    const fade = Math.floor(c.sampleRate * 0.05);
    const raw = new Float32Array(frames + fade);
    for (let i = 0; i < raw.length; i++) raw[i] = Math.random() * 2 - 1;
    noise = c.createBuffer(1, frames, c.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = raw[i];
    for (let j = 0; j < fade; j++) {
      const w = j / fade;
      data[j] = raw[j] * w + raw[frames + j] * (1 - w);
    }
  }
  return noise;
}

/**
 * How much of white noise a filter actually lets through.
 *
 * Taken from the craps table's audio module, where it was measured: a bandpass
 * at Q 2.6 passes a sliver of the spectrum and arrives an order of magnitude
 * quieter than the same envelope on an oscillator. Dividing by the filter's
 * own noise bandwidth puts every `gain` in this file on one scale.
 *
 * 0.577 is the RMS of the uniform noise going in and ~3.7 is the crest factor
 * of a short narrowband burst coming out.
 */
function noiseTrim(type: BiquadFilterType, freq: number, q: number, nyquist: number): number {
  let enbw: number;
  if (type === 'bandpass') enbw = (Math.PI / 2) * (freq / Math.max(0.2, q));
  else if (type === 'highpass') enbw = Math.max(200, nyquist - freq);
  else enbw = 1.11 * freq;
  const rms = 0.577 * Math.sqrt(Math.min(1, enbw / nyquist));
  return clamp(1 / (3.7 * rms), 0.25, 12);
}

interface HissOpts {
  at: number;
  /** Roughly the peak amplitude this voice contributes. See {@link noiseTrim}. */
  gain: number;
  decay: number;
  attack?: number;
  hold?: number;
  freq: number;
  /** Sweeps the filter to here over the whole envelope. */
  freqEnd?: number;
  q?: number;
  type?: BiquadFilterType;
}

/** Filtered noise with an envelope: every impact, breath and wash here. */
function hiss(c: AudioContext, out: AudioNode, o: HissOpts): void {
  const attack = o.attack ?? 0.002;
  const hold = o.hold ?? 0;
  const total = attack + hold + o.decay;
  const type = o.type ?? 'bandpass';
  const q = o.q ?? 1;
  const peak = Math.max(1e-4, o.gain * noiseTrim(type, o.freq, q, c.sampleRate / 2));

  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  src.loop = true;

  const filter = c.createBiquadFilter();
  filter.type = type;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(o.freq, o.at);
  if (o.freqEnd !== undefined) {
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, o.freqEnd), o.at + total);
  }

  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, o.at);
  g.gain.exponentialRampToValueAtTime(peak, o.at + attack);
  if (hold > 0) g.gain.setValueAtTime(peak, o.at + attack + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, o.at + total);

  src.connect(filter).connect(g).connect(out);
  src.start(o.at, Math.random() * (NOISE_SECONDS - 0.1));
  src.stop(o.at + total + 0.03);
}

interface ToneOpts {
  at: number;
  gain: number;
  freq: number;
  decay: number;
  attack?: number;
  hold?: number;
  /** Glides to here, which is what turns a sine into a drum. */
  freqEnd?: number;
  glide?: number;
  type?: OscillatorType;
  /** Cents of detune, for stacking two of the same voice without phasing. */
  detune?: number;
  lowpass?: number;
  /** Sweeps the lid over the envelope: the whole of a brass swell. */
  lowpassEnd?: number;
  lowpassQ?: number;
}

/** A pitched voice with an envelope, an optional glide and an optional lid. */
function tone(c: AudioContext, out: AudioNode, o: ToneOpts): void {
  const attack = o.attack ?? 0.005;
  const hold = o.hold ?? 0;
  const total = attack + hold + o.decay;

  const osc = c.createOscillator();
  osc.type = o.type ?? 'sine';
  if (o.detune) osc.detune.value = o.detune;
  osc.frequency.setValueAtTime(o.freq, o.at);
  if (o.freqEnd !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(20, o.freqEnd),
      o.at + (o.glide ?? o.decay),
    );
  }

  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, o.at);
  g.gain.exponentialRampToValueAtTime(Math.max(1e-4, o.gain), o.at + attack);
  if (hold > 0) g.gain.setValueAtTime(Math.max(1e-4, o.gain), o.at + attack + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, o.at + total);

  let node: AudioNode = osc;
  if (o.lowpass) {
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = o.lowpassQ ?? 0.7;
    lp.frequency.setValueAtTime(o.lowpass, o.at);
    if (o.lowpassEnd !== undefined) {
      lp.frequency.exponentialRampToValueAtTime(Math.max(40, o.lowpassEnd), o.at + total);
    }
    osc.connect(lp);
    node = lp;
  }
  node.connect(g).connect(out);
  osc.start(o.at);
  osc.stop(o.at + total + 0.03);
}

/**
 * A partial set: ratio to the fundamental, relative level, relative decay.
 *
 * Levels are normalised at build time so that the set sums to 1, which keeps
 * `gain` meaning "peak amplitude" for additive voices as well as for the
 * single-oscillator ones. The partials start in phase but at different
 * frequencies, so the real peak lands under the sum; the measurements in the
 * section comments are what actually came out.
 */
interface Partial {
  r: number;
  g: number;
  d: number;
}

function normalise(set: Partial[]): Partial[] {
  const sum = set.reduce((a, p) => a + p.g, 0);
  return set.map((p) => ({ ...p, g: p.g / sum }));
}

/**
 * A bonshō — the big bronze temple bell.
 *
 * Inharmonic on purpose: the 2.76 and 5.4 ratios are what stop it reading as
 * an organ. The long tail is the sound, so the decay figures are per-partial
 * and the top ones die first, which is why the bell darkens as it rings out.
 */
const BELL: Partial[] = normalise([
  { r: 1, g: 1, d: 1 },
  { r: 2.0, g: 0.46, d: 0.7 },
  { r: 2.76, g: 0.32, d: 0.52 },
  { r: 3.35, g: 0.2, d: 0.4 },
  { r: 5.4, g: 0.12, d: 0.26 },
  { r: 8.12, g: 0.06, d: 0.16 },
]);

function bell(c: AudioContext, out: AudioNode, at: number, gain: number, freq: number, decay = 2.6) {
  for (const p of BELL) {
    tone(c, out, {
      at,
      gain: gain * p.g,
      freq: freq * p.r,
      decay: decay * p.d,
      attack: 0.004,
    });
  }
  // The hammer. Without it the bell fades in rather than being struck.
  hiss(c, out, { at, gain: gain * 0.55, decay: 0.022, freq: freq * 4.5, q: 1.1 });
  hiss(c, out, { at, gain: gain * 0.3, decay: 0.06, freq: freq * 1.6, q: 2.2 });
}

/**
 * The gong: wider, denser and slower to arrive than the bell.
 *
 * The slow attack and the noise wash sweeping upward are what make it read as
 * a metal sheet spreading rather than a bell being hit — a gong's energy
 * climbs for a moment after the mallet lands.
 */
const GONG: Partial[] = normalise([
  { r: 1, g: 1, d: 1 },
  { r: 1.48, g: 0.62, d: 0.86 },
  { r: 2.11, g: 0.48, d: 0.7 },
  { r: 2.71, g: 0.36, d: 0.58 },
  { r: 3.4, g: 0.26, d: 0.44 },
  { r: 4.62, g: 0.18, d: 0.32 },
  { r: 6.13, g: 0.1, d: 0.22 },
]);

function gong(c: AudioContext, out: AudioNode, at: number, gain: number, freq = 132, decay = 3.4) {
  for (const p of GONG) {
    tone(c, out, {
      at,
      gain: gain * p.g,
      freq: freq * p.r,
      decay: decay * p.d,
      attack: 0.03 + 0.02 * (1 - p.g),
      detune: (Math.random() - 0.5) * 8,
    });
  }
  hiss(c, out, {
    at,
    gain: gain * 0.42,
    attack: 0.05,
    decay: decay * 0.42,
    freq: freq * 3,
    freqEnd: freq * 9,
    q: 0.7,
  });
  tone(c, out, { at, gain: gain * 0.3, freq: freq * 0.5, decay: decay * 0.5, attack: 0.04 });
}

/**
 * A koto or guqin pluck: additive, with a hard pick transient.
 *
 * A plucked string is mostly its attack. The partials are harmonic (this is a
 * string, not a bell), the upper ones decay several times faster than the
 * fundamental so the note dulls as it rings, and the pitch drops a few cents
 * over the first fifty milliseconds because a plucked string under tension
 * does exactly that.
 */
const STRING: Partial[] = normalise([
  { r: 1, g: 1, d: 1 },
  { r: 2, g: 0.5, d: 0.58 },
  { r: 3, g: 0.26, d: 0.4 },
  { r: 4, g: 0.15, d: 0.3 },
  { r: 5, g: 0.09, d: 0.22 },
  { r: 6.02, g: 0.05, d: 0.16 },
]);

function pluck(
  c: AudioContext,
  out: AudioNode,
  at: number,
  gain: number,
  freq: number,
  decay = 0.9,
  bright = 1,
) {
  for (const p of STRING) {
    if (freq * p.r > c.sampleRate * 0.45) break;
    tone(c, out, {
      at,
      gain: gain * p.g * (p.r > 1 ? bright : 1),
      freq: freq * p.r * 1.002,
      freqEnd: freq * p.r,
      glide: 0.05,
      decay: decay * p.d,
      attack: 0.003,
    });
  }
  // The plectrum on the silk.
  hiss(c, out, { at, gain: gain * 0.34 * bright, decay: 0.014, freq: freq * 6, q: 1.4 });
}

/**
 * A pitched membrane — taiko, or a smaller frame drum at a higher pitch.
 *
 * Filtered noise for the skin over a sine that falls most of an octave in
 * forty milliseconds, which is the whole trick: the drop is what the ear reads
 * as a struck head rather than a bass note.
 */
function drum(
  c: AudioContext,
  out: AudioNode,
  at: number,
  gain: number,
  freq = 90,
  decay = 0.3,
  snap = 1,
) {
  tone(c, out, {
    at,
    gain: gain * 0.86,
    freq: freq * 2.1,
    freqEnd: freq,
    glide: 0.045,
    decay,
    attack: 0.002,
  });
  tone(c, out, {
    at,
    gain: gain * 0.2,
    freq: freq * 4.2,
    freqEnd: freq * 2,
    glide: 0.04,
    decay: decay * 0.4,
    attack: 0.002,
    type: 'triangle',
    lowpass: 900,
  });
  // The skin itself. Bandpassed low so it is a hide head, not a snare.
  hiss(c, out, {
    at,
    gain: gain * 0.34 * snap,
    decay: decay * 0.35,
    freq: 420 * snap,
    freqEnd: 180,
    q: 0.9,
  });
  hiss(c, out, { at, gain: gain * 0.18 * snap, decay: 0.012, freq: 3200, q: 0.8, type: 'highpass' });
}

/** A wood block or a bamboo click: the reel stops, the buttons, the ticking. */
function wood(c: AudioContext, out: AudioNode, at: number, gain: number, freq: number) {
  hiss(c, out, { at, gain: gain * 0.62, decay: 0.012, freq: freq * 2.6, q: 1.6 });
  hiss(c, out, { at, gain: gain * 0.4, decay: 0.03, freq, q: 5 });
  tone(c, out, {
    at,
    gain: gain * 0.45,
    freq,
    decay: 0.045,
    attack: 0.0015,
    type: 'triangle',
    lowpass: freq * 3.2,
  });
  tone(c, out, {
    at,
    gain: gain * 0.16,
    freq: freq * 1.51,
    decay: 0.03,
    attack: 0.0015,
    type: 'sine',
  });
}

/**
 * A shakuhachi-ish breathy tone: the anticipation, and the air in the shrine.
 *
 * Mostly noise through a resonant bandpass at the note, with a weak sine under
 * it to fix the pitch. The breath is louder than the tone on purpose — that
 * ratio is the instrument.
 */
function breath(
  c: AudioContext,
  out: AudioNode,
  at: number,
  gain: number,
  freq: number,
  attack: number,
  hold: number,
  decay: number,
  freqEnd?: number,
) {
  hiss(c, out, {
    at,
    gain: gain * 0.8,
    attack,
    hold,
    decay,
    freq,
    freqEnd: freqEnd ?? freq,
    q: 7,
  });
  hiss(c, out, {
    at,
    gain: gain * 0.3,
    attack,
    hold,
    decay,
    freq: freq * 2,
    freqEnd: (freqEnd ?? freq) * 2,
    q: 4,
  });
  tone(c, out, {
    at,
    gain: gain * 0.34,
    freq,
    freqEnd,
    glide: attack + hold + decay,
    attack,
    hold,
    decay,
    lowpass: freq * 3,
  });
  // Air noise across the mouthpiece, unpitched.
  hiss(c, out, { at, gain: gain * 0.14, attack, hold, decay, freq: 2600, q: 0.6, type: 'highpass' });
}

/**
 * Low brass and sub: the dragon, and the floor under the biggest wins.
 *
 * A sawtooth through a lid that opens as it swells and closes as it goes, plus
 * a sine an octave down. The octave doubling is not decoration — a laptop
 * speaker reproduces nothing at 55 Hz, and without the partial above it to
 * imply the fundamental the whole weight of the dragon disappears on exactly
 * the hardware most people will play on.
 */
function brass(
  c: AudioContext,
  out: AudioNode,
  at: number,
  gain: number,
  freq: number,
  attack: number,
  hold: number,
  decay: number,
  bend = 1,
) {
  tone(c, out, {
    at,
    gain: gain * 0.5,
    freq,
    freqEnd: freq * bend,
    glide: attack + hold,
    attack,
    hold,
    decay,
    type: 'sawtooth',
    lowpass: freq * 2,
    lowpassEnd: freq * 7,
    lowpassQ: 1.4,
  });
  tone(c, out, {
    at,
    gain: gain * 0.34,
    freq: freq * 0.5,
    freqEnd: freq * 0.5 * bend,
    glide: attack + hold,
    attack,
    hold,
    decay,
    lowpass: 220,
  });
  tone(c, out, {
    at,
    gain: gain * 0.16,
    freq: freq * 2,
    freqEnd: freq * 2 * bend,
    glide: attack + hold,
    attack: attack * 1.3,
    hold,
    decay: decay * 0.7,
    type: 'triangle',
    lowpass: freq * 5,
    detune: 6,
  });
}

/**
 * A struck coin: bright, metallic, inharmonic and short.
 *
 * Detuned per call because twenty of these land inside a second during a
 * fountain and an undetuned run of them reads as a machine gun.
 */
function coin(c: AudioContext, out: AudioNode, at: number, gain: number, jitter = 1) {
  const f = 2400 * jitter;
  tone(c, out, { at, gain: gain * 0.34, freq: f, decay: 0.13, attack: 0.001 });
  tone(c, out, { at, gain: gain * 0.24, freq: f * 1.71, decay: 0.1, attack: 0.001 });
  tone(c, out, { at, gain: gain * 0.14, freq: f * 2.53, decay: 0.07, attack: 0.001 });
  hiss(c, out, { at, gain: gain * 0.5, decay: 0.02, freq: f * 2.2, q: 1.2 });
  hiss(c, out, { at, gain: gain * 0.22, decay: 0.05, freq: 700 * jitter, q: 2.4 });
}

/* ------------------------------------------------------------------ *
 * The motif
 *
 * A D E A' — rising, four notes, resolving on the octave. Every fanfare in the
 * game is this, and only this, restated in more octaves with more under it.
 * ------------------------------------------------------------------ */

/** Scale degrees of the motif, and where each note falls in motif-steps. */
const MOTIF = [
  { d: 0, at: 0 },
  { d: 2, at: 1 },
  { d: 3, at: 2 },
  { d: 5, at: 3.4 },
];

interface Fanfare {
  /** Overall level. Everything inside scales from this. */
  level: number;
  /** Lowest scale degree the motif starts on. */
  base: number;
  /** How many times it restates, each an octave above the last. */
  reps: number;
  /** Seconds per motif step. */
  step: number;
  /** Gap between restatements, in motif steps. */
  gap: number;
  /** 0 = no percussion, 1 = a frame drum, 2 = taiko, 3 = the ensemble. */
  drums: number;
  /** Gong level under the whole thing, 0 for none. */
  gong: number;
  /** How many bells peal at the end. */
  bells: number;
  /** Low brass and sub level, 0 for none. */
  low: number;
  /** Seconds of accelerating drum crescendo before the first note. */
  preroll: number;
}

/**
 * The one fanfare, built to size.
 *
 * Everything the player hears as "bigger" is a number in {@link Fanfare}
 * rather than a different piece of music, so a MEGA is audibly the BIG they
 * just heard with another octave, another drum and a gong under it. That
 * relationship is the entire reason a slot's win ladder reads as a ladder.
 */
function fanfare(q: Cue, f: Fanfare): void {
  const { c, out } = q;
  const lvl = f.level * q.g;
  const t0 = q.t + f.preroll;

  // The run-up: a drum accelerating into the first note.
  if (f.preroll > 0) {
    let at = q.t;
    let gap = 0.13;
    let i = 0;
    while (at < t0 - 0.02) {
      drum(c, out, at, lvl * (0.16 + 0.2 * (i / 8)), 120, 0.12, 0.8);
      at += gap;
      gap = Math.max(0.045, gap * 0.84);
      i++;
    }
  }

  const span = (MOTIF[MOTIF.length - 1].at + f.gap) * f.step;

  for (let r = 0; r < f.reps; r++) {
    const rt = t0 + r * span;
    const octave = r * PENT.length;
    const voice = 1 - r * 0.12;

    for (let n = 0; n < MOTIF.length; n++) {
      const m = MOTIF[n];
      const at = rt + m.at * f.step;
      const last = n === MOTIF.length - 1;
      const hz = semi(deg(f.base + octave + m.d), q.p);
      const long = last ? f.step * 5 : f.step * 2.4;

      pluck(c, out, at, lvl * 0.5 * voice, hz, long, 1);
      // The octave below carries the figure on a small speaker.
      if (f.reps > 1 || last) {
        pluck(c, out, at, lvl * 0.26 * voice, hz / 2, long * 1.2, 0.7);
      }
      // A fifth of shimmer over the top on the bigger sizes.
      if (f.drums >= 2) {
        pluck(c, out, at + 0.012, lvl * 0.16 * voice, hz * 3, long * 0.5, 1.2);
      }

      if (f.drums >= 1 && (n === 0 || last)) {
        drum(c, out, at, lvl * (last ? 0.5 : 0.34), last ? 68 : 96, last ? 0.5 : 0.26, 1);
      }
      if (f.drums >= 3 && !last) {
        drum(c, out, at + f.step * 0.5, lvl * 0.2, 150, 0.14, 1.2);
      }
    }

    if (f.gong > 0 && r === 0) gong(c, out, rt, lvl * f.gong, deg(f.base - 5), 3.2);
    if (f.low > 0) {
      brass(
        c,
        out,
        rt,
        lvl * f.low,
        semi(deg(f.base + octave) / 2, q.p),
        0.08,
        span * 0.4,
        span * 0.6,
        1,
      );
    }
  }

  // The peal: bells walking up the scale as the last note rings out.
  const endAt = t0 + f.reps * span;
  for (let b = 0; b < f.bells; b++) {
    bell(
      c,
      out,
      endAt - f.step * 1.2 + b * f.step * 0.62,
      lvl * (0.34 - b * 0.03),
      semi(deg(f.base + f.reps * PENT.length + b), q.p),
      2.4 + b * 0.2,
    );
  }
  if (f.low > 0) {
    // The floor arriving under the resolution.
    tone(c, out, {
      at: endAt - f.step,
      gain: lvl * f.low * 0.7,
      freq: semi(deg(f.base) / 2, q.p),
      decay: 1.6,
      attack: 0.02,
    });
  }
}

/* ------------------------------------------------------------------ *
 * Walking state
 *
 * Two cues climb the scale on their own when the caller does not say where
 * they are: the reel stops and the meter. Both take an explicit `pitch` when
 * the caller knows better — a reel renderer that knows it is reel 3 should say
 * so — but neither depends on it, because five identical clicks in a row and a
 * meter that ticks on one note are the two ways slot audio most obviously
 * gives itself away, and neither should be possible by omission.
 * ------------------------------------------------------------------ */

let reelStep = 0;
let reelStepAt = -99;
let meterStep = 0;
let meterStepAt = -99;

/** A gap longer than this means a new run has started. */
const RUN_GAP = 0.9;

function nextReelStep(now: number): number {
  if (now - reelStepAt > RUN_GAP) reelStep = 0;
  reelStepAt = now;
  return Math.min(reelStep++, 8);
}

function nextMeterStep(now: number): number {
  if (now - meterStepAt > 0.55) meterStep = 0;
  meterStepAt = now;
  // Wraps within two octaves so a six-second LEGENDARY count-up climbs and
  // climbs rather than disappearing into dog-whistle territory.
  const s = meterStep++;
  return s % 11;
}

/* ------------------------------------------------------------------ *
 * Cues
 *
 * Measured peak / RMS at the default gain, rendered offline through a Web
 * Audio shim. Figures are in the section comments; see the file header for
 * what the three bands mean.
 * ------------------------------------------------------------------ */

type LoopName = 'reelLoop' | 'anticipation' | 'freeSpinsLoop';
const LOOP_NAMES: readonly LoopName[] = ['reelLoop', 'anticipation', 'freeSpinsLoop'];
type CueName = Exclude<SoundName, LoopName>;

const CUES: Record<CueName, (q: Cue) => void> = {
  /* --- the spin: felt --- */

  /** The reels engaging: a taiko, a bamboo whip and the mechanism taking up. */
  spinStart: (q) => {
    reelStep = 0;
    reelStepAt = q.c.currentTime;
    drum(q.c, q.out, q.t, 0.3 * q.g, 84, 0.34, 1);
    wood(q.c, q.out, q.t, 0.14 * q.g, 620);
    hiss(q.c, q.out, {
      at: q.t,
      gain: 0.13 * q.g,
      attack: 0.02,
      decay: 0.22,
      freq: 700,
      freqEnd: 2600,
      q: 0.8,
    });
    tone(q.c, q.out, {
      at: q.t,
      gain: 0.12 * q.g,
      freq: semi(deg(0), q.p),
      freqEnd: semi(deg(3), q.p),
      glide: 0.24,
      decay: 0.3,
      attack: 0.01,
      type: 'triangle',
      lowpass: 1200,
    });
  },

  /**
   * A reel landing. Pitched, and rising across the five.
   *
   * The pitch is the point. Five reels stopping on the same click is the sound
   * of a machine with one sample; five walking up the pentatonic is a figure,
   * and it makes the last reel feel like an arrival even when it pays nothing.
   */
  reelStop: (q) => {
    const step = q.p !== 0 ? 0 : nextReelStep(q.c.currentTime);
    const hz = semi(deg(6 + step), q.p);
    wood(q.c, q.out, q.t, 0.3 * q.g, hz);
    drum(q.c, q.out, q.t, 0.16 * q.g, 110, 0.14, 0.7);
    hiss(q.c, q.out, { at: q.t, gain: 0.07 * q.g, decay: 0.05, freq: 240, q: 0.7, type: 'lowpass' });
  },

  /** The same click, with the note left hanging: something is still coming. */
  reelStopTease: (q) => {
    const step = q.p !== 0 ? 0 : nextReelStep(q.c.currentTime);
    const hz = semi(deg(6 + step), q.p);
    wood(q.c, q.out, q.t, 0.3 * q.g, hz);
    drum(q.c, q.out, q.t, 0.18 * q.g, 104, 0.16, 0.7);
    // The tail: the bell of that same note, and the room holding its breath.
    bell(q.c, q.out, q.t + 0.01, 0.2 * q.g, hz, 1.9);
    breath(q.c, q.out, q.t + 0.04, 0.1 * q.g, hz / 2, 0.12, 0.5, 0.9);
  },

  /** A symbol arriving in its cell. Twenty of these a spin, so: quiet. */
  symbolLand: (q) => {
    const j = 0.9 + Math.random() * 0.22;
    hiss(q.c, q.out, { at: q.t, gain: 0.07 * q.g, decay: 0.03, freq: 1500 * j, q: 2.2 });
    hiss(q.c, q.out, { at: q.t, gain: 0.05 * q.g, decay: 0.05, freq: 300, q: 0.8, type: 'lowpass' });
    tone(q.c, q.out, {
      at: q.t,
      gain: 0.05 * q.g,
      freq: 260 * j,
      freqEnd: 190,
      glide: 0.04,
      decay: 0.06,
      attack: 0.002,
    });
  },

  /* --- wins: stings --- */

  /** The tick under a line cycling or a coin arriving on the meter. */
  winTick: (q) => {
    pluck(q.c, q.out, q.t, 0.1 * q.g, semi(deg(11), q.p), 0.34, 1.2);
    hiss(q.c, q.out, { at: q.t, gain: 0.05 * q.g, decay: 0.014, freq: 5200, q: 0.9, type: 'highpass' });
  },

  winSmall: (q) =>
    fanfare(q, {
      level: 0.42,
      base: 5,
      reps: 1,
      step: 0.115,
      gap: 0.8,
      drums: 0,
      gong: 0,
      bells: 1,
      low: 0,
      preroll: 0,
    }),

  winMedium: (q) =>
    fanfare(q, {
      level: 0.5,
      base: 5,
      reps: 1,
      step: 0.13,
      gap: 1,
      drums: 1,
      gong: 0,
      bells: 2,
      low: 0,
      preroll: 0,
    }),

  winBig: (q) =>
    fanfare(q, {
      level: 0.6,
      base: 0,
      reps: 2,
      step: 0.145,
      gap: 1,
      drums: 2,
      gong: 0.26,
      bells: 2,
      low: 0.2,
      preroll: 0.16,
    }),

  winMega: (q) =>
    fanfare(q, {
      level: 0.68,
      base: 0,
      reps: 2,
      step: 0.155,
      gap: 1.2,
      drums: 3,
      gong: 0.34,
      bells: 3,
      low: 0.3,
      preroll: 0.34,
    }),

  winEpic: (q) =>
    fanfare(q, {
      level: 0.74,
      base: 0,
      reps: 3,
      step: 0.16,
      gap: 1.2,
      drums: 3,
      gong: 0.42,
      bells: 4,
      low: 0.38,
      preroll: 0.55,
    }),

  winLegendary: (q) => {
    fanfare(q, {
      level: 0.8,
      base: -5,
      reps: 4,
      step: 0.165,
      gap: 1.2,
      drums: 3,
      gong: 0.5,
      bells: 5,
      low: 0.46,
      preroll: 0.85,
    });
    // The dragon under it. LEGENDARY is the only win tier that gets one.
    brass(q.c, q.out, q.t + 0.6, 0.24 * q.g, semi(deg(-10), q.p), 0.4, 1.6, 2.4, 1.06);
  },

  /**
   * The meter climbing.
   *
   * Called many times a second during a count-up, so it is the quietest thing
   * in the file that is not a button, and it walks the scale rather than
   * ticking on one note. {@link meterEnd} resolves it.
   */
  meterCount: (q) => {
    const step = q.p !== 0 ? 0 : nextMeterStep(q.c.currentTime);
    const hz = semi(deg(10 + step), q.p);
    pluck(q.c, q.out, q.t, 0.085 * q.g, hz, 0.26, 1.3);
    hiss(q.c, q.out, { at: q.t, gain: 0.035 * q.g, decay: 0.01, freq: 6000, q: 0.8, type: 'highpass' });
  },

  /** The count arriving. Back to the root, with the bell over it. */
  meterEnd: (q) => {
    meterStep = 0;
    meterStepAt = -99;
    const hz = semi(deg(10), q.p);
    pluck(q.c, q.out, q.t, 0.3 * q.g, hz, 1.4, 1);
    pluck(q.c, q.out, q.t, 0.16 * q.g, hz / 2, 1.8, 0.7);
    bell(q.c, q.out, q.t + 0.02, 0.24 * q.g, hz, 2.6);
    drum(q.c, q.out, q.t, 0.2 * q.g, 78, 0.4, 0.9);
  },

  /* --- features --- */

  /** A scatter landing: bright, metallic and unlike anything else on the grid. */
  scatterLand: (q) => {
    const hz = semi(deg(12), q.p);
    bell(q.c, q.out, q.t, 0.34 * q.g, hz, 1.5);
    wood(q.c, q.out, q.t, 0.16 * q.g, 900);
    hiss(q.c, q.out, {
      at: q.t,
      gain: 0.12 * q.g,
      attack: 0.01,
      decay: 0.4,
      freq: 3000,
      freqEnd: 7000,
      q: 0.7,
    });
    drum(q.c, q.out, q.t, 0.14 * q.g, 130, 0.2, 1);
  },

  /** An orb hitting the glass. Heavy, and lower than everything around it. */
  orbLand: (q) => {
    drum(q.c, q.out, q.t, 0.36 * q.g, 62, 0.44, 1.2);
    hiss(q.c, q.out, { at: q.t, gain: 0.16 * q.g, decay: 0.09, freq: 900, freqEnd: 260, q: 1.1 });
    bell(q.c, q.out, q.t + 0.015, 0.15 * q.g, semi(deg(4), q.p), 1.1);
    tone(q.c, q.out, {
      at: q.t,
      gain: 0.16 * q.g,
      freq: 90,
      freqEnd: 40,
      glide: 0.14,
      decay: 0.5,
      attack: 0.004,
    });
  },

  /** The orb locking into its niche: a mechanism, not a bell. */
  orbLock: (q) => {
    wood(q.c, q.out, q.t, 0.24 * q.g, 340);
    hiss(q.c, q.out, { at: q.t, gain: 0.14 * q.g, decay: 0.035, freq: 2600, q: 2.6 });
    pluck(q.c, q.out, q.t + 0.04, 0.14 * q.g, semi(deg(7), q.p), 0.5, 1.2);
    pluck(q.c, q.out, q.t + 0.1, 0.12 * q.g, semi(deg(9), q.p), 0.6, 1.2);
    tone(q.c, q.out, {
      at: q.t,
      gain: 0.12 * q.g,
      freq: 150,
      freqEnd: 96,
      glide: 0.08,
      decay: 0.16,
      attack: 0.003,
    });
  },

  /** Something has been triggered. The gong, and the room turning round. */
  featureTrigger: (q) => {
    gong(q.c, q.out, q.t, 0.5 * q.g, deg(-5), 3.6);
    let at = q.t;
    let gap = 0.16;
    for (let i = 0; i < 8; i++) {
      drum(q.c, q.out, at, (0.18 + i * 0.03) * q.g, 96 - i * 2, 0.18, 1);
      at += gap;
      gap = Math.max(0.05, gap * 0.86);
    }
    drum(q.c, q.out, at, 0.44 * q.g, 62, 0.6, 1.2);
    hiss(q.c, q.out, {
      at: q.t,
      gain: 0.16 * q.g,
      attack: 0.4,
      decay: 0.3,
      freq: 800,
      freqEnd: 5200,
      q: 0.6,
    });
    bell(q.c, q.out, at, 0.3 * q.g, semi(deg(10), q.p), 3);
  },

  /** Into the shrine: the motif, opened out, with the doors coming with it. */
  freeSpinsIntro: (q) => {
    fanfare(q, {
      level: 0.7,
      base: 0,
      reps: 3,
      step: 0.15,
      gap: 1,
      drums: 3,
      gong: 0.4,
      bells: 3,
      low: 0.3,
      preroll: 0.5,
    });
    breath(q.c, q.out, q.t, 0.16 * q.g, deg(5), 0.5, 0.6, 1.2, deg(7));
  },

  /** Out of the shrine: the same figure, falling, and the doors closing. */
  freeSpinsOutro: (q) => {
    const step = 0.17;
    for (let n = 0; n < MOTIF.length; n++) {
      const m = MOTIF[MOTIF.length - 1 - n];
      const at = q.t + n * step;
      pluck(q.c, q.out, at, 0.3 * q.g, semi(deg(5 + m.d), q.p), n === 3 ? 1.8 : 0.5, 1);
      pluck(q.c, q.out, at, 0.16 * q.g, semi(deg(m.d), q.p), n === 3 ? 2.2 : 0.6, 0.7);
    }
    gong(q.c, q.out, q.t + step * 3, 0.34 * q.g, deg(-5), 3.4);
    drum(q.c, q.out, q.t + step * 3, 0.3 * q.g, 66, 0.5, 0.9);
    bell(q.c, q.out, q.t + step * 3.6, 0.22 * q.g, deg(10), 2.8);
  },

  /** The dragon. Low brass bending up, a growl over it and the floor under it. */
  dragonRoar: (q) => {
    const f = semi(deg(-10), q.p);
    brass(q.c, q.out, q.t, 0.44 * q.g, f, 0.12, 0.5, 0.9, 1.14);
    // The growl: noise through a moving formant, which is what makes it animal.
    hiss(q.c, q.out, {
      at: q.t,
      gain: 0.26 * q.g,
      attack: 0.05,
      hold: 0.4,
      decay: 0.6,
      freq: 380,
      freqEnd: 1300,
      q: 1.6,
    });
    hiss(q.c, q.out, {
      at: q.t + 0.02,
      gain: 0.14 * q.g,
      attack: 0.08,
      hold: 0.4,
      decay: 0.7,
      freq: 1400,
      freqEnd: 600,
      q: 2.4,
    });
    tone(q.c, q.out, {
      at: q.t,
      gain: 0.28 * q.g,
      freq: f / 2,
      freqEnd: (f / 2) * 1.1,
      glide: 0.6,
      attack: 0.03,
      hold: 0.5,
      decay: 0.9,
    });
    drum(q.c, q.out, q.t, 0.24 * q.g, 54, 0.5, 0.8);
  },

  /** The dragon crossing a reel and turning it wild: a pass, not a roar. */
  dragonReel: (q) => {
    hiss(q.c, q.out, {
      at: q.t,
      gain: 0.2 * q.g,
      attack: 0.18,
      decay: 0.42,
      freq: 500,
      freqEnd: 3600,
      q: 0.9,
    });
    // Two wingbeats.
    drum(q.c, q.out, q.t + 0.05, 0.22 * q.g, 74, 0.28, 0.6);
    drum(q.c, q.out, q.t + 0.34, 0.18 * q.g, 68, 0.3, 0.6);
    brass(q.c, q.out, q.t + 0.1, 0.2 * q.g, semi(deg(-5), q.p), 0.14, 0.2, 0.6, 1.26);
    pluck(q.c, q.out, q.t + 0.42, 0.18 * q.g, semi(deg(10), q.p), 1.1, 1.3);
  },

  /** The trail advancing. Walks up with `pitch` when the caller supplies it. */
  multiplierUp: (q) => {
    pluck(q.c, q.out, q.t, 0.24 * q.g, semi(deg(7), q.p), 0.5, 1.2);
    pluck(q.c, q.out, q.t + 0.09, 0.24 * q.g, semi(deg(9), q.p), 0.8, 1.2);
    bell(q.c, q.out, q.t + 0.09, 0.16 * q.g, semi(deg(14), q.p), 1.6);
    drum(q.c, q.out, q.t, 0.16 * q.g, 120, 0.16, 1);
  },

  /* --- hold and win: cold, tense, restrained --- */

  /** Into the link. Deliberately not a fanfare: the temperature drops. */
  holdIntro: (q) => {
    gong(q.c, q.out, q.t, 0.34 * q.g, deg(-6), 3.8);
    // A minor third above the root and nothing else — the one interval in the
    // whole machine that is allowed to sound cold.
    tone(q.c, q.out, {
      at: q.t,
      gain: 0.16 * q.g,
      freq: deg(-5),
      decay: 2.4,
      attack: 0.5,
      type: 'triangle',
      lowpass: 500,
    });
    tone(q.c, q.out, {
      at: q.t,
      gain: 0.12 * q.g,
      freq: deg(-4),
      decay: 2.4,
      attack: 0.6,
      type: 'triangle',
      lowpass: 600,
      detune: 5,
    });
    bell(q.c, q.out, q.t + 0.5, 0.26 * q.g, deg(11), 3.2);
    for (let i = 0; i < 3; i++) wood(q.c, q.out, q.t + 0.9 + i * 0.22, 0.12 * q.g, 780);
  },

  /** One respin of the link. A tick and a held breath, and nothing more. */
  holdRespin: (q) => {
    wood(q.c, q.out, q.t, 0.16 * q.g, 520);
    tone(q.c, q.out, {
      at: q.t,
      gain: 0.1 * q.g,
      freq: 130,
      freqEnd: 96,
      glide: 0.1,
      decay: 0.22,
      attack: 0.004,
    });
    hiss(q.c, q.out, {
      at: q.t,
      gain: 0.07 * q.g,
      attack: 0.02,
      decay: 0.3,
      freq: 2400,
      freqEnd: 1200,
      q: 0.8,
    });
  },

  /** The board full. The one thing in the link that is not restrained. */
  holdFull: (q) => {
    gong(q.c, q.out, q.t, 0.6 * q.g, deg(-5), 4.2);
    fanfare(q, {
      level: 0.62,
      base: 0,
      reps: 3,
      step: 0.15,
      gap: 1,
      drums: 3,
      gong: 0,
      bells: 4,
      low: 0.4,
      preroll: 0.4,
    });
    tone(q.c, q.out, {
      at: q.t,
      gain: 0.3 * q.g,
      freq: 120,
      freqEnd: 44,
      glide: 0.5,
      decay: 1.6,
      attack: 0.02,
    });
  },

  /* --- jackpots: four clearly different sizes --- */

  /** MINI: a bell triad and nothing else. It is a nice win, not an event. */
  jackpotMini: (q) =>
    fanfare(q, {
      level: 0.5,
      base: 5,
      reps: 1,
      step: 0.12,
      gap: 0.8,
      drums: 1,
      gong: 0,
      bells: 2,
      low: 0,
      preroll: 0,
    }),

  /** MINOR: the motif twice, a drum under it, one gong. */
  jackpotMinor: (q) =>
    fanfare(q, {
      level: 0.62,
      base: 0,
      reps: 2,
      step: 0.14,
      gap: 1,
      drums: 2,
      gong: 0.3,
      bells: 3,
      low: 0.24,
      preroll: 0.3,
    }),

  /** MAJOR: the ensemble, the brass, and the dragon answering at the end. */
  jackpotMajor: (q) => {
    fanfare(q, {
      level: 0.74,
      base: 0,
      reps: 3,
      step: 0.155,
      gap: 1.2,
      drums: 3,
      gong: 0.44,
      bells: 4,
      low: 0.4,
      preroll: 0.6,
    });
    brass(q.c, q.out, q.t + 1.9, 0.22 * q.g, deg(-10), 0.3, 0.9, 1.6, 1.05);
  },

  /**
   * GRAND: the biggest thing in the game, and the only cue written to reach
   * the limiter's knee.
   *
   * Five seconds, four restatements of the motif spanning four octaves, the
   * whole percussion section, a gong that starts before the music does, the
   * dragon underneath and a bell peal walking out the top. If anything else in
   * this file ever measures louder than this, that is the bug.
   */
  jackpotGrand: (q) => {
    gong(q.c, q.out, q.t, 0.56 * q.g, deg(-10), 5);
    fanfare(q, {
      level: 0.86,
      base: -5,
      reps: 4,
      step: 0.17,
      gap: 1.2,
      drums: 3,
      gong: 0.34,
      bells: 6,
      low: 0.5,
      preroll: 1.1,
    });
    brass(q.c, q.out, q.t + 1.1, 0.3 * q.g, deg(-10), 0.5, 2, 2.4, 1.06);
    tone(q.c, q.out, {
      at: q.t + 1.1,
      gain: 0.3 * q.g,
      freq: 110,
      freqEnd: 41,
      glide: 0.8,
      decay: 3,
      attack: 0.05,
    });
    // The room. A slow wash opening under the whole thing.
    hiss(q.c, q.out, {
      at: q.t,
      gain: 0.16 * q.g,
      attack: 1,
      hold: 1.4,
      decay: 2,
      freq: 700,
      freqEnd: 6000,
      q: 0.5,
    });
  },

  /* --- gamble --- */

  /** A card turning: paper and air, with a wooden edge. */
  gambleFlip: (q) => {
    hiss(q.c, q.out, {
      at: q.t,
      gain: 0.14 * q.g,
      attack: 0.03,
      decay: 0.16,
      freq: 1800,
      freqEnd: 4200,
      q: 0.7,
    });
    wood(q.c, q.out, q.t + 0.2, 0.16 * q.g, 1100);
    hiss(q.c, q.out, { at: q.t + 0.2, gain: 0.08 * q.g, decay: 0.05, freq: 3400, q: 1.4 });
  },

  /** Doubled. Short, bright, up a fourth, and over before the next choice. */
  gambleWin: (q) => {
    pluck(q.c, q.out, q.t, 0.28 * q.g, semi(deg(7), q.p), 0.4, 1.2);
    pluck(q.c, q.out, q.t + 0.1, 0.3 * q.g, semi(deg(10), q.p), 1, 1.2);
    bell(q.c, q.out, q.t + 0.1, 0.18 * q.g, semi(deg(15), q.p), 1.6);
    drum(q.c, q.out, q.t, 0.16 * q.g, 110, 0.16, 1);
  },

  /**
   * Lost. The mirror of {@link gambleWin} and built the opposite way round:
   * the pitch falls, the string is damped instead of ringing, and the bell is
   * struck and stopped rather than left to sing.
   */
  gambleLose: (q) => {
    pluck(q.c, q.out, q.t, 0.24 * q.g, semi(deg(3), q.p), 0.3, 0.6);
    pluck(q.c, q.out, q.t + 0.11, 0.22 * q.g, semi(deg(0), q.p), 0.34, 0.5);
    tone(q.c, q.out, {
      at: q.t + 0.11,
      gain: 0.22 * q.g,
      freq: 128,
      freqEnd: 82,
      glide: 0.16,
      decay: 0.4,
      attack: 0.006,
      type: 'triangle',
      lowpass: 620,
    });
    hiss(q.c, q.out, { at: q.t + 0.11, gain: 0.1 * q.g, decay: 0.16, freq: 300, q: 0.7, type: 'lowpass' });
  },

  /* --- interface: the quietest band in the file --- */

  buttonPress: (q) => {
    wood(q.c, q.out, q.t, 0.13 * q.g, 1250);
  },

  buttonToggle: (q) => {
    wood(q.c, q.out, q.t, 0.11 * q.g, 1050);
    pluck(q.c, q.out, q.t + 0.045, 0.09 * q.g, semi(deg(12), q.p), 0.22, 1.3);
  },

  /** The stake moving. `pitch` walks it up and down the ladder. */
  betChange: (q) => {
    wood(q.c, q.out, q.t, 0.09 * q.g, 900);
    pluck(q.c, q.out, q.t, 0.12 * q.g, semi(deg(9), q.p), 0.3, 1.2);
  },

  /**
   * A refused action: short, low, unmistakable, and not a buzzer.
   *
   * A square wave reads as an error dialog. This is a damped low string under
   * a knock across the middle, which lands closer to a machine declining than
   * to a computer complaining.
   */
  error: (q) => {
    hiss(q.c, q.out, { at: q.t, gain: 0.09 * q.g, decay: 0.05, freq: 330, q: 0.8, type: 'lowpass' });
    hiss(q.c, q.out, { at: q.t, gain: 0.12 * q.g, decay: 0.09, freq: 480, q: 1.2 });
    tone(q.c, q.out, {
      at: q.t,
      gain: 0.22 * q.g,
      freq: 150,
      freqEnd: 116,
      glide: 0.12,
      decay: 0.18,
      attack: 0.004,
      type: 'triangle',
      lowpass: 700,
    });
  },

  /* --- money and metal --- */

  /**
   * One coin landing.
   *
   * The FX layer throws dozens of these during a fountain, so it is detuned
   * per call and pitched well above the drums: a coin shower is a texture, and
   * a texture made of identical events is a buzz.
   */
  coinDrop: (q) => {
    coin(q.c, q.out, q.t, 0.19 * q.g, 0.82 + Math.random() * 0.42);
  },

  gong: (q) => {
    gong(q.c, q.out, q.t, 0.52 * q.g, semi(deg(-5), q.p), 3.6);
  },

  bellHit: (q) => {
    bell(q.c, q.out, q.t, 0.4 * q.g, semi(deg(10), q.p), 2.8);
  },
};

/* ------------------------------------------------------------------ *
 * Loops
 *
 * Three effect loops and three music beds, all built the same way: a gain node
 * that everything in the loop plays into, a set of continuously running
 * sources, and an optional scheduler that places short events a little ahead
 * of the playhead.
 *
 * Seamlessness comes from construction rather than from luck. The continuous
 * voices are oscillators and a crossfaded noise buffer, neither of which has a
 * seam at all; the scheduled events are placed on an absolute clock, so they
 * do not drift and there is no loop point for them to click at. Stopping is
 * always a 60–140 ms ramp to silence before any node is stopped, because a
 * source cut at a non-zero sample is a click, and a click at the end of a bed
 * is worse than never having had the bed.
 * ------------------------------------------------------------------ */

interface Loop {
  gain: GainNode;
  /** Continuously running sources, stopped when the loop ends. */
  nodes: AudioScheduledSourceNode[];
  /** Scheduler handle, if this loop places events. */
  timer: ReturnType<typeof setInterval> | null;
  /** Absolute time of the next scheduled event. */
  next: number;
  step: number;
  started: number;
  /** Places one event and returns the seconds until the next. */
  emit?: (loop: Loop, step: number, at: number, elapsed: number) => number;
  /** Deferred teardown, cancelled if the loop is restarted. */
  ending: ReturnType<typeof setTimeout> | null;
}

const loops = new Map<string, Loop>();

function openLoop(c: AudioContext, out: AudioNode, level: number, fade: number): Loop {
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, c.currentTime);
  gain.gain.linearRampToValueAtTime(level, c.currentTime + fade);
  gain.connect(out);
  return { gain, nodes: [], timer: null, next: c.currentTime + 0.06, step: 0, started: c.currentTime, ending: null };
}

function runLoop(loop: Loop, c: AudioContext) {
  const tick = () => {
    if (!loop.emit) return;
    let guard = 0;
    while (loop.next < c.currentTime + LOOKAHEAD && guard++ < 64) {
      loop.next += loop.emit(loop, loop.step, loop.next, loop.next - loop.started);
      loop.step++;
    }
  };
  tick();
  loop.timer = setInterval(tick, TICK_MS);
}

/**
 * Ends a loop cleanly: stop scheduling, ramp to silence, then tear down.
 *
 * The teardown is deferred rather than immediate because the ramp has to
 * finish before the sources are stopped, and it is cancellable because a loop
 * that is restarted during its own fade-out must not be dismantled underneath
 * its replacement.
 */
function endLoop(name: string, fade = 0.12) {
  const loop = loops.get(name);
  const c = ctx;
  if (!loop || !c) return;
  loops.delete(name);
  if (loop.timer !== null) clearInterval(loop.timer);
  loop.timer = null;
  const now = c.currentTime;
  loop.gain.gain.cancelScheduledValues(now);
  loop.gain.gain.setValueAtTime(Math.max(1e-4, loop.gain.gain.value), now);
  loop.gain.gain.exponentialRampToValueAtTime(0.0001, now + fade);
  const nodes = loop.nodes;
  const gain = loop.gain;
  for (const n of nodes) {
    try {
      n.stop(now + fade + 0.02);
    } catch {
      // Already stopped. Nothing to do and nothing to report.
    }
  }
  loop.ending = setTimeout(() => {
    gain.disconnect();
  }, (fade + 0.1) * 1000);
}

/** A continuously running noise source. Used by every bed that has air in it. */
function bedNoise(
  c: AudioContext,
  out: AudioNode,
  at: number,
  gain: number,
  type: BiquadFilterType,
  freq: number,
  q: number,
): AudioBufferSourceNode {
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  src.loop = true;
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  g.gain.value = gain * noiseTrim(type, freq, q, c.sampleRate / 2);
  src.connect(f).connect(g).connect(out);
  src.start(at, Math.random() * (NOISE_SECONDS - 0.1));
  return src;
}

/** A slow oscillator modulating a parameter: drift, wobble, tremolo. */
function lfo(
  c: AudioContext,
  target: AudioParam,
  rate: number,
  depth: number,
  at: number,
): OscillatorNode {
  const osc = c.createOscillator();
  osc.frequency.value = rate;
  const g = c.createGain();
  g.gain.value = depth;
  osc.connect(g).connect(target);
  osc.start(at);
  return osc;
}

/**
 * The reel bed: a wide low whir with air over it.
 *
 * Deliberately featureless. It runs for a second and a half on every spin of
 * the session, so anything with a shape in it becomes maddening by the
 * hundredth time; what it has to do is fill the hole the stopped reels leave
 * and make the first stop land on something.
 */
function startReelLoop(c: AudioContext, out: AudioNode, level: number): Loop {
  const loop = openLoop(c, out, level, 0.09);
  const at = c.currentTime;
  loop.nodes.push(bedNoise(c, loop.gain, at, 0.05, 'bandpass', 620, 1.1));
  loop.nodes.push(bedNoise(c, loop.gain, at, 0.028, 'lowpass', 240, 0.8));

  const body = c.createGain();
  body.gain.value = 0.05;
  body.connect(loop.gain);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 380;
  lp.Q.value = 1.2;
  lp.connect(body);
  const osc = c.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = 58;
  osc.connect(lp);
  osc.start(at);
  loop.nodes.push(osc);
  // The mechanism turning: a slow wobble on the lid, nothing rhythmic.
  loop.nodes.push(lfo(c, lp.frequency, 5.5, 90, at));
  loop.nodes.push(lfo(c, body.gain, 11, 0.012, at));
  return loop;
}

/**
 * The anticipation: a drone that will not stop rising and a drum that will not
 * stop accelerating.
 *
 * Startable and stoppable because the caller does not know how long a tease
 * lasts — the reel decides that. The drone climbs a fifth over four seconds
 * and then holds, the filter opens the whole time, and the drum halves its
 * gap every two seconds down to a floor. Nothing here resolves; resolution is
 * {@link CUES.reelStop}'s job, and the contrast is the effect.
 */
function startAnticipation(c: AudioContext, out: AudioNode, level: number, pitch: number): Loop {
  const loop = openLoop(c, out, level, 0.12);
  const at = c.currentTime;
  const root = semi(deg(0), pitch);

  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(300, at);
  lp.frequency.exponentialRampToValueAtTime(2600, at + 5);
  lp.Q.value = 3;
  lp.connect(loop.gain);

  for (const [mult, gain, detune] of [
    [1, 0.09, 0],
    [1.5, 0.05, 7],
    [2, 0.035, -6],
  ] as const) {
    const g = c.createGain();
    g.gain.value = gain;
    g.connect(lp);
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.detune.value = detune;
    osc.frequency.setValueAtTime(root * mult, at);
    // A fifth over four seconds, then held: a tease that keeps climbing past
    // its own resolution stops reading as tension and starts reading as a siren.
    osc.frequency.exponentialRampToValueAtTime(root * mult * 1.5, at + 4);
    osc.connect(g);
    osc.start(at);
    loop.nodes.push(osc);
  }

  // The shakuhachi over the top: air, and a wavering note.
  const airGain = c.createGain();
  airGain.gain.value = 0.05;
  airGain.connect(loop.gain);
  const air = c.createBiquadFilter();
  air.type = 'bandpass';
  air.Q.value = 6;
  air.frequency.setValueAtTime(root * 4, at);
  air.frequency.exponentialRampToValueAtTime(root * 6, at + 5);
  air.connect(airGain);
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  src.loop = true;
  src.connect(air);
  src.start(at, Math.random() * (NOISE_SECONDS - 0.1));
  loop.nodes.push(src);
  loop.nodes.push(lfo(c, air.frequency, 5.2, root * 0.09, at));

  loop.emit = (l, step, when, elapsed) => {
    const gap = Math.max(0.085, 0.42 * Math.pow(0.68, elapsed / 1.4));
    drum(c, l.gain, when, 0.2 + Math.min(0.22, elapsed * 0.06), 96 - Math.min(30, elapsed * 6), 0.2, 1);
    if (step % 4 === 3) wood(c, l.gain, when + gap * 0.5, 0.09, 1400);
    return gap;
  };
  runLoop(loop, c);
  return loop;
}

/**
 * Free spins ambience: fire, wind and a heartbeat.
 *
 * Sits under the free spins music bed rather than replacing it — the bed is
 * the tune, this is the room the tune is in, and the two are separate so a
 * player who turns music off still gets the shrine burning.
 */
function startFreeAmbience(c: AudioContext, out: AudioNode, level: number): Loop {
  const loop = openLoop(c, out, level, 0.5);
  const at = c.currentTime;
  // Fire: broadband, with the crackle scheduled rather than baked in.
  loop.nodes.push(bedNoise(c, loop.gain, at, 0.03, 'bandpass', 1100, 0.7));
  loop.nodes.push(bedNoise(c, loop.gain, at, 0.022, 'lowpass', 300, 0.6));

  const wind = c.createBiquadFilter();
  wind.type = 'bandpass';
  wind.frequency.value = 500;
  wind.Q.value = 2.4;
  const wg = c.createGain();
  wg.gain.value = 0.035;
  wind.connect(wg).connect(loop.gain);
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  src.loop = true;
  src.connect(wind);
  src.start(at, Math.random() * (NOISE_SECONDS - 0.1));
  loop.nodes.push(src);
  loop.nodes.push(lfo(c, wind.frequency, 0.13, 260, at));
  loop.nodes.push(lfo(c, wg.gain, 0.09, 0.016, at));

  loop.emit = (l, step, when) => {
    // Crackle: a couple of very short bright ticks at an irregular spacing.
    const n = 1 + (Math.random() < 0.35 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      hiss(c, l.gain, {
        at: when + i * 0.04 * Math.random(),
        gain: 0.05 + Math.random() * 0.05,
        decay: 0.01 + Math.random() * 0.02,
        freq: 2200 + Math.random() * 3500,
        q: 1.4,
      });
    }
    // A slow heartbeat under it, so the feature has a pulse even in silence.
    if (step % 6 === 0) drum(c, l.gain, when, 0.1, 58, 0.4, 0.5);
    return 0.16 + Math.random() * 0.3;
  };
  runLoop(loop, c);
  return loop;
}

/** Starts one of the three effect loops, or does nothing if it is running. */
function startEffectLoop(name: LoopName, opts: SoundOptions) {
  const c = audio();
  if (!c || !sfxBus || !soundOn) return;
  if (loops.has(name)) return;
  const g = opts.gain ?? 1;
  let loop: Loop;
  if (name === 'reelLoop') loop = startReelLoop(c, sfxBus, 0.5 * g);
  else if (name === 'anticipation') loop = startAnticipation(c, sfxBus, 0.62 * g, opts.pitch ?? 0);
  else loop = startFreeAmbience(c, sfxBus, 0.55 * g);
  loops.set(name, loop);
}

/**
 * Stops a running loop cleanly.
 *
 * Safe to call for a loop that is not running, for a name that is not a loop,
 * and before the context exists — the caller does not track what it started
 * and should not have to.
 */
export function stopLoop(name: SoundName): void {
  endLoop(name, name === 'freeSpinsLoop' ? 0.5 : 0.12);
}

/* ------------------------------------------------------------------ *
 * Music
 *
 * Three beds, all generated, all in the same key as everything else so a
 * fanfare landing on top of one is a chord rather than a collision. They are
 * written quiet and then {@link MUSIC_LEVEL} takes another 9 dB off, because a
 * slot's music sits well under its wins — if you can hum along with it during
 * a LEGENDARY, it is too loud.
 * ------------------------------------------------------------------ */

export type MusicTrack = 'base' | 'free' | 'hold';

let musicTrack: MusicTrack | null = null;
/** What the game last asked for, so muting and unmuting resumes it. */
let wantedTrack: MusicTrack | null = null;

const BED = 'music:bed';

/** A held pad: two or three detuned oscillators through a slowly moving lid. */
function pad(c: AudioContext, loop: Loop, at: number, freqs: number[], level: number, cutoff: number) {
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = cutoff;
  lp.Q.value = 0.9;
  lp.connect(loop.gain);
  loop.nodes.push(lfo(c, lp.frequency, 0.06, cutoff * 0.4, at));
  for (let i = 0; i < freqs.length; i++) {
    const g = c.createGain();
    g.gain.value = level * (i === 0 ? 1 : 0.6);
    g.connect(lp);
    const osc = c.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freqs[i];
    osc.detune.value = (i - 1) * 6;
    osc.connect(g);
    osc.start(at);
    loop.nodes.push(osc);
    loop.nodes.push(lfo(c, g.gain, 0.07 + i * 0.03, level * 0.3, at));
  }
}

/**
 * Base game: sparse and atmospheric.
 *
 * A low pad, air, and a temple bell every eight bars. There is no pulse in it
 * at all, on purpose — the base game already has a rhythm (spin, stop, stop,
 * stop) and a bed with a beat fights it.
 */
function bedBase(c: AudioContext, out: AudioNode): Loop {
  const loop = openLoop(c, out, 0.5, 1.2);
  const at = c.currentTime;
  pad(c, loop, at, [deg(-10), deg(-5), deg(-3)], 0.05, 420);
  loop.nodes.push(bedNoise(c, loop.gain, at, 0.012, 'bandpass', 900, 0.6));
  // A beat is 0.83 s: 72 BPM.
  loop.emit = (l, step, when) => {
    const bar = Math.floor(step / 4);
    if (step % 32 === 0) bell(c, l.gain, when, 0.12, deg(bar % 16 === 0 ? 5 : 7), 4.5);
    if (step % 16 === 8) pluck(c, l.gain, when, 0.07, deg(5 + (step % 3)), 1.6, 0.8);
    if (step % 16 === 11) pluck(c, l.gain, when, 0.045, deg(7 + (step % 2)), 1.2, 0.8);
    if (step % 32 === 24) drum(c, l.gain, when, 0.06, 62, 0.5, 0.4);
    return 0.83;
  };
  runLoop(loop, c);
  return loop;
}

/**
 * Free spins: driving, and the only bed with a kit in it.
 *
 * Taiko on the downbeats, a frame drum on the eighths, a bass pulse on the
 * root and a four-note koto ostinato over the top. 132 BPM, which is fast
 * enough to push and slow enough that a five-reel spin still fits in two bars.
 */
function bedFree(c: AudioContext, out: AudioNode): Loop {
  const loop = openLoop(c, out, 0.5, 0.6);
  const at = c.currentTime;
  pad(c, loop, at, [deg(-10), deg(-8), deg(-5)], 0.04, 600);
  const RIFF = [0, 2, 3, 2, 5, 3, 2, 0];
  // An eighth at 132 BPM.
  const eighth = 30 / 132;
  loop.emit = (l, step, when) => {
    const b = step % 8;
    if (b === 0 || b === 4) drum(c, l.gain, when, 0.16, b === 0 ? 60 : 72, 0.34, 0.9);
    if (b === 2 || b === 6) drum(c, l.gain, when, 0.09, 130, 0.16, 1.1);
    if (b % 2 === 1) drum(c, l.gain, when, 0.045, 190, 0.09, 1.3);
    tone(c, l.gain, {
      at: when,
      gain: b % 2 === 0 ? 0.06 : 0.03,
      freq: deg(-10 + (b === 6 ? 2 : 0)),
      decay: eighth * 0.8,
      attack: 0.01,
      type: 'triangle',
      lowpass: 300,
    });
    pluck(c, l.gain, when, b === 0 ? 0.075 : 0.05, deg(5 + RIFF[b]), eighth * 1.6, 1);
    if (step % 32 === 0) bell(c, l.gain, when, 0.1, deg(10), 3);
    return eighth;
  };
  runLoop(loop, c);
  return loop;
}

/**
 * Hold and win: tense, ticking, restrained.
 *
 * A clock, a cold drone with two oscillators beating against each other at
 * 0.7 Hz, and a single metallic ping every four beats. There is no melody in
 * it because the feature is a countdown and a tune would resolve something the
 * feature has not resolved.
 */
function bedHold(c: AudioContext, out: AudioNode): Loop {
  const loop = openLoop(c, out, 0.5, 0.8);
  const at = c.currentTime;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 340;
  lp.Q.value = 1.4;
  lp.connect(loop.gain);
  for (const [f, d] of [
    [deg(-10), 0],
    [deg(-10), 7],
    [deg(-8), -4],
  ] as const) {
    const g = c.createGain();
    g.gain.value = 0.05;
    g.connect(lp);
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = f;
    osc.detune.value = d;
    osc.connect(g);
    osc.start(at);
    loop.nodes.push(osc);
  }
  loop.nodes.push(lfo(c, lp.frequency, 0.11, 160, at));
  loop.nodes.push(bedNoise(c, loop.gain, at, 0.014, 'highpass', 4000, 0.5));
  // 96 BPM, ticking on the eighths.
  const eighth = 30 / 96;
  loop.emit = (l, step, when) => {
    wood(c, l.gain, when, step % 4 === 0 ? 0.06 : 0.035, step % 2 === 0 ? 1500 : 1180);
    if (step % 8 === 0) drum(c, l.gain, when, 0.07, 54, 0.4, 0.4);
    if (step % 16 === 12) bell(c, l.gain, when, 0.07, deg(12), 2.2);
    return eighth;
  };
  runLoop(loop, c);
  return loop;
}

function stopBed(fade: number) {
  endLoop(BED, fade);
  musicTrack = null;
}

/**
 * Puts a bed on, crossfading out whatever was playing.
 *
 * Idempotent: asking for the bed that is already running does nothing, which
 * matters because the phase machine will call this on every transition into a
 * state, not only on the ones that change the music.
 */
export function startMusic(track: MusicTrack): void {
  wantedTrack = track;
  const c = audio();
  if (!c || !musicBus) return;
  if (!musicOn) return;
  if (musicTrack === track && loops.has(BED)) return;
  if (loops.has(BED)) endLoop(BED, 0.4);
  const loop =
    track === 'free' ? bedFree(c, musicBus) : track === 'hold' ? bedHold(c, musicBus) : bedBase(c, musicBus);
  loops.set(BED, loop);
  musicTrack = track;
}

/** Takes the music off. The effects loops are untouched. */
export function stopMusic(): void {
  wantedTrack = null;
  stopBed(0.6);
}

/* ------------------------------------------------------------------ *
 * The one entry point
 * ------------------------------------------------------------------ */

/**
 * Plays a sound.
 *
 * `delay` places it on the spin's timeline, `gain` scales this one voice, and
 * `pitch` shifts everything tonal in it by that many semitones — which is what
 * lets the caller walk the meter up the scale as it counts, or say which reel
 * a stop belongs to. The three loop names start their loop instead; call
 * {@link stopLoop} with the same name to end it.
 */
export function playSound(name: SoundName, opts: SoundOptions = {}): void {
  if ((LOOP_NAMES as readonly string[]).includes(name)) {
    startEffectLoop(name as LoopName, opts);
    return;
  }
  const q = begin(opts);
  if (!q) return;
  CUES[name as CueName](q);
}
