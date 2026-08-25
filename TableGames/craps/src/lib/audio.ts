'use client';

/**
 * Table sound, synthesised on the fly.
 *
 * Everything here is generated from oscillators and filtered noise rather than
 * loaded from files: a dice clack is a short noise burst through a bandpass, a
 * clay chip is a bright tick over a resonant body, and the stick clearing the
 * layout is a filter sweeping down through a handful of those chips. It keeps
 * the bundle free of audio assets and lets each impact carry its own velocity,
 * so a hard bounce off the back wall genuinely sounds harder than a soft roll.
 *
 * Four things are worth knowing before changing any of it.
 *
 * 1. Every `gain` in this file means one thing: roughly the peak amplitude that
 *    voice puts on the output. Noise through a narrow filter arrives far
 *    quieter than an oscillator on the same envelope, so {@link noiseTrim}
 *    divides that difference out. Before it existed the numbers below were not
 *    comparable and the mix was guesswork — a dice clack measured as two thirds
 *    low-mid energy because its table thump was the one voice no filter was
 *    attenuating. With the trim in place the numbers can be read as a mix.
 *
 * 2. Everything meets at one bus, and the bus ends in a soft clip. Below
 *    {@link KNEE} the curve is exactly y = x, so the mix is untouched, and
 *    above it the curve bends and provably cannot reach 1.
 *
 *    It is insurance, not part of the sound, and the measurements say so: of
 *    twenty-six rendered cases — every sound alone, every roll's full score,
 *    a fast-mode overlap, a whole ten-bounce throw — the loudest real one peaks
 *    at 0.80 and the limiter takes at most 0.35 dB off any of them. It is kept
 *    anyway, for two reasons. Those twenty-six cases are not the space of all
 *    pile-ups: a player hammering fast mode with two bots betting, a toast
 *    refusing and a dialog clicking is a combination nobody has enumerated, and
 *    the fast-mode case already reaches 0.84 with only 1.6 dB left. And the
 *    failure it prevents — hard clipping on a percussive transient — is loud,
 *    ugly and instantly obvious, while the insurance is provably free on
 *    everything that has been measured.
 *
 * 3. Every sound takes a `delay` in seconds, because a roll is a short score
 *    rather than a single cue. The stick calls it, then the losers are swept,
 *    then the winners are paid, then the puck comes off. page.tsx lays those
 *    out in time; nothing here fires on its own.
 *
 * 4. Nothing is tonal except the stings that decide a hand, and even those
 *    are an interval rather than a tune. A craps table is chips, wood, cloth
 *    and one low thump. An arpeggio reads as an arcade machine.
 *
 * Levels were measured rather than guessed. Every sound here was rendered
 * offline through a Web Audio shim and read back for peak, RMS, length and
 * band-energy split; the stings sit around -20 dBFS RMS, the felt around -30,
 * and the interface around -40. If the balance ever needs revisiting, measure
 * it again rather than nudging numbers — none of this can be checked by eye,
 * and the spectral split is where the real mistakes showed up.
 */

/* ------------------------------------------------------------------ *
 * The bus
 * ------------------------------------------------------------------ */

let ctx: AudioContext | null = null;
let bus: GainNode | null = null;
let noise: AudioBuffer | null = null;
let enabled = true;

/**
 * The whole table's level, in one place.
 *
 * Held at unity so that `gain` on a voice means what it says: the peak
 * amplitude that voice puts on the bus, and therefore on the output. Turn this
 * down to quieten everything without disturbing the mix.
 */
const MASTER = 1;

/**
 * Where the soft clip starts bending.
 *
 * Under it the transfer curve is exactly y = x, so a single quiet sound passes
 * through untouched. Over it the curve is a tanh knee whose limit is
 * KNEE + (1 - KNEE) * tanh(1) = 0.893, which is the highest sample this module
 * can produce no matter how much lands at once.
 */
const KNEE = 0.55;

/** How long the shared white-noise buffer is, in seconds. */
const NOISE_SECONDS = 2;

/**
 * The transfer curve for the bus limiter.
 *
 * Built on a concrete ArrayBuffer rather than by length: `new Float32Array(n)`
 * infers Float32Array<ArrayBufferLike>, and WaveShaperNode.curve wants the
 * buffer type pinned.
 */
function softClipCurve(n = 4096) {
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
    // the one thing this node exists to guarantee it cannot do. The material is
    // percussive and only the loudest tenth of it touches the knee at all, so
    // there is nothing here for the aliasing to spoil.
    shaper.oversample = 'none';
    shaper.connect(ctx.destination);

    bus = ctx.createGain();
    bus.gain.value = MASTER;
    bus.connect(shaper);
  }
  // Browsers start the context suspended until a gesture; nudge it each time.
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export function setSoundEnabled(on: boolean) {
  enabled = on;
}

/**
 * Opens a sound. Returns null when there is nothing to play into — no window,
 * no Web Audio, or the player has the table muted — so each exported call is
 * one guard rather than one per voice.
 */
function begin(delay: number): { c: AudioContext; out: GainNode; t: number } | null {
  const c = audio();
  const out = bus;
  if (!c || !out || !enabled) return null;
  return { c, out, t: c.currentTime + Math.max(0, delay) };
}

/**
 * Whether the player has asked for less movement.
 *
 * Sound is not motion, so this gates almost nothing — but a whoosh for a chip
 * that the felt has decided not to fly is a sound with no picture, and the
 * flight layer drops out entirely under this query.
 */
function reducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/* ------------------------------------------------------------------ *
 * Primitives
 * ------------------------------------------------------------------ */

/**
 * One white-noise buffer for the whole session, read from a random offset each
 * time. Cutting a fresh buffer per impact was the old approach and it allocates
 * a few thousand floats on every dice bounce for no audible gain.
 */
function noiseBuffer(c: AudioContext): AudioBuffer {
  if (!noise || noise.sampleRate !== c.sampleRate) {
    const frames = Math.floor(c.sampleRate * NOISE_SECONDS);
    noise = c.createBuffer(1, frames, c.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
  }
  return noise;
}

interface HissOpts {
  /** Absolute context time. */
  at: number;
  /** Roughly the peak amplitude this voice contributes. See {@link noiseTrim}. */
  gain: number;
  decay: number;
  attack?: number;
  freq: number;
  /** Sweeps the filter to here over attack + decay. */
  freqEnd?: number;
  q?: number;
  type?: BiquadFilterType;
}

/**
 * How much of white noise a filter actually lets through.
 *
 * A bandpass at Q 2.6 passes a sliver of the spectrum and comes out an order of
 * magnitude quieter than the same envelope would on an oscillator. Without a
 * correction, `gain` means something different in every call and the mix is
 * guesswork: measured, a dice clack was two thirds low-mid energy purely
 * because its 190 Hz table thump was the one voice in it that no filter was
 * attenuating. Dividing by the filter's own noise bandwidth puts every `gain`
 * in this file on one scale — approximately the peak amplitude that voice
 * contributes — so the numbers below can be read as a mix.
 *
 * 0.577 is the RMS of the uniform noise going in and ~3.7 is the crest factor
 * of a short narrowband burst coming out. Both were measured offline rather
 * than assumed, and the clamp keeps a very narrow filter from asking for a
 * boost the envelope cannot safely deliver.
 */
function noiseTrim(type: BiquadFilterType, freq: number, q: number, nyquist: number): number {
  let enbw: number;
  if (type === 'bandpass') enbw = (Math.PI / 2) * (freq / Math.max(0.2, q));
  else if (type === 'highpass') enbw = Math.max(200, nyquist - freq);
  else enbw = 1.11 * freq;
  const rms = 0.577 * Math.sqrt(Math.min(1, enbw / nyquist));
  return clamp(1 / (3.7 * rms), 0.25, 12);
}

/** Filtered noise with an attack and an exponential tail: every impact here. */
function hiss(c: AudioContext, out: AudioNode, o: HissOpts) {
  const attack = o.attack ?? 0.002;
  const total = attack + o.decay;
  const type = o.type ?? 'bandpass';
  const q = o.q ?? 1;
  const peak = o.gain * noiseTrim(type, o.freq, q, c.sampleRate / 2);

  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);

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
  g.gain.exponentialRampToValueAtTime(0.0001, o.at + total);

  src.connect(filter).connect(g).connect(out);
  src.start(o.at, Math.max(0, Math.random() * (NOISE_SECONDS - total - 0.05)));
  src.stop(o.at + total + 0.03);
}

interface VoiceOpts {
  at: number;
  gain: number;
  decay: number;
  attack?: number;
  freq: number;
  /** Glides to here, which is what turns a sine into a thump. */
  freqEnd?: number;
  glide?: number;
  type?: OscillatorType;
  lowpass?: number;
}

/** A pitched voice with an envelope, an optional glide and an optional lid. */
function voice(c: AudioContext, out: AudioNode, o: VoiceOpts) {
  const attack = o.attack ?? 0.006;

  const osc = c.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.freq, o.at);
  if (o.freqEnd !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(20, o.freqEnd),
      o.at + (o.glide ?? o.decay),
    );
  }

  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, o.at);
  g.gain.exponentialRampToValueAtTime(o.gain, o.at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, o.at + attack + o.decay);

  let node: AudioNode = osc;
  if (o.lowpass) {
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = o.lowpass;
    lp.Q.value = 0.6;
    osc.connect(lp);
    node = lp;
  }
  node.connect(g).connect(out);
  osc.start(o.at);
  osc.stop(o.at + attack + o.decay + 0.03);
}

/**
 * One clay chip.
 *
 * Three parts, and all three matter: a bright tick where it strikes, a short
 * resonant body a couple of octaves down, and a woody bottom that keeps it from
 * sounding like glass. `bright` shifts the whole thing — a chip landing on a
 * stack is sharper than one landing on cloth.
 */
function clayTick(c: AudioContext, out: AudioNode, at: number, gain: number, bright = 1) {
  const j = 0.92 + Math.random() * 0.16;
  hiss(c, out, { at, gain: gain * 0.75, decay: 0.018, freq: 2400 * bright * j, q: 1.8 });
  hiss(c, out, { at, gain: gain * 0.42, decay: 0.05, freq: 780 * bright * j, q: 2.6 });
  voice(c, out, {
    at,
    gain: gain * 0.22,
    decay: 0.045,
    attack: 0.002,
    freq: 430 * j,
    type: 'triangle',
    lowpass: 1400,
  });
}

/* ------------------------------------------------------------------ *
 * The dice
 * ------------------------------------------------------------------ */

/**
 * Acrylic on wood. `force` in 0..1 scales brightness, length and level.
 *
 * Called live from the dice canvas on every bounce, so it normally wants no
 * delay — but it takes one like everything else here, which is what lets a
 * whole throw be laid out and measured offline in one go.
 */
export function diceClack(force = 0.6, delay = 0) {
  const s = begin(delay);
  if (!s) return;
  const f = clamp(force, 0.08, 1);
  // Per-clack detune. Without it a run of bounces reads as a machine gun.
  const j = 0.9 + Math.random() * 0.22;
  // The acrylic snap, which is most of what tells you the dice are plastic.
  hiss(s.c, s.out, { at: s.t, gain: 0.039 + f * 0.116, decay: 0.008, freq: 6500, type: 'highpass', q: 0.6 });
  hiss(s.c, s.out, {
    at: s.t,
    gain: 0.116 + f * 0.31,
    decay: 0.012 + f * 0.012,
    freq: (2500 + f * 2400) * j,
    q: 1.3,
  });
  hiss(s.c, s.out, { at: s.t, gain: 0.052 + f * 0.142, decay: 0.035 + f * 0.02, freq: 1150 * j, q: 2.2 });
  // The table taking the hit. Deliberately small: it is felt, not heard, and
  // when it was larger it swamped the click on anything without a woofer.
  voice(s.c, s.out, {
    at: s.t,
    gain: 0.019 + f * 0.058,
    decay: 0.045,
    attack: 0.002,
    freq: 190 * j,
    freqEnd: 130,
    glide: 0.04,
  });
}

/* ------------------------------------------------------------------ *
 * Chips
 * ------------------------------------------------------------------ */

/** One chip lifted off the rack: the lightest sound on the table. */
export function chipPick() {
  const s = begin(0);
  if (!s) return;
  clayTick(s.c, s.out, s.t, 0.24, 1.25);
}

/** Chips going down on the felt. `chips` is how tall the drop is, 1..5. */
export function chipDrop(chips = 1, delay = 0) {
  const s = begin(delay);
  if (!s) return;
  const n = clamp(Math.round(chips), 1, 5);
  for (let i = 0; i < n; i++) {
    clayTick(s.c, s.out, s.t + i * (0.026 + Math.random() * 0.016), 0.48 - i * 0.056);
  }
  // The cloth taking the weight, which is what stops it reading as a table top.
  hiss(s.c, s.out, { at: s.t, gain: 0.088, decay: 0.07, freq: 260, q: 0.8, type: 'lowpass' });
}

/** Chips pushed back to a player: a takedown, or a bet coming off. */
export function chipSlide(chips = 2, delay = 0) {
  const s = begin(delay);
  if (!s) return;
  hiss(s.c, s.out, {
    at: s.t,
    gain: 0.22,
    decay: 0.17,
    attack: 0.02,
    freq: 1500,
    freqEnd: 620,
    q: 0.9,
  });
  const n = clamp(Math.round(chips), 1, 4);
  for (let i = 0; i < n; i++) clayTick(s.c, s.out, s.t + 0.05 + i * 0.03, 0.28 - i * 0.04, 0.95);
}

/**
 * A winner being paid.
 *
 * Deliberately not a tune. This used to be a three-note arpeggio, which is the
 * sound of picking up a coin in a platform game rather than of a dealer cutting
 * chips off a stack and pushing them across cloth. It is now exactly that: a
 * cut, a slide, and the stack settling in front of the player, with the only
 * pitched thing in it a short low sine under the landing.
 */
export function payout(chips = 2, delay = 0) {
  const s = begin(delay);
  if (!s) return;
  const n = clamp(Math.round(chips), 2, 6);
  // Cut off the stack: even, and brightening as the stack under them shortens.
  for (let i = 0; i < n; i++) {
    clayTick(s.c, s.out, s.t + i * 0.028, 0.51 - i * 0.043, 1 + i * 0.04);
  }
  const land = s.t + n * 0.028;
  hiss(s.c, s.out, {
    at: land,
    gain: 0.19,
    decay: 0.2,
    attack: 0.03,
    freq: 1400,
    freqEnd: 520,
    q: 0.8,
  });
  clayTick(s.c, s.out, land + 0.17, 0.43, 0.9);
  voice(s.c, s.out, {
    at: land + 0.17,
    gain: 0.12,
    decay: 0.12,
    freq: 150,
    freqEnd: 108,
    glide: 0.09,
  });
}

/**
 * The stick clearing losers off the layout.
 *
 * A sweep that starts bright and dulls as it loads up with chips, the chips
 * rattling along inside it, and a soft landing in the bank. Brisk on purpose:
 * the loss flights on the felt are the shortest thing in Fx and this has to be
 * over before they are.
 */
export function rake(chips = 2, delay = 0) {
  const s = begin(delay);
  if (!s) return;
  hiss(s.c, s.out, {
    at: s.t,
    gain: 0.41,
    decay: 0.26,
    attack: 0.012,
    freq: 2700,
    freqEnd: 640,
    q: 0.7,
  });
  hiss(s.c, s.out, { at: s.t, gain: 0.185, decay: 0.3, attack: 0.02, freq: 420, q: 0.6, type: 'lowpass' });
  const n = clamp(Math.round(chips), 2, 6);
  for (let i = 0; i < n; i++) {
    clayTick(s.c, s.out, s.t + 0.02 + i * (0.032 + Math.random() * 0.02), 0.3 - i * 0.026, 0.85);
  }
  voice(s.c, s.out, { at: s.t + 0.24, gain: 0.185, decay: 0.18, freq: 118, freqEnd: 72, glide: 0.1 });
}

/* ------------------------------------------------------------------ *
 * The two events that end a hand
 * ------------------------------------------------------------------ */

/**
 * A point made: the win sting, and one of the two places a low end is allowed.
 *
 * A sine dropping most of an octave under a warm fifth, with the burst's own
 * shimmer over the top. The fifth is two triangles through a lid rather than a
 * chord voicing — enough to read as major without turning into music.
 *
 * The sub is doubled at the octave on purpose. A laptop speaker reproduces
 * nothing at 84 Hz, so without the 168 Hz partial to imply it the whole weight
 * of this sting disappears on exactly the hardware most people will play on.
 */
export function pointMade(delay = 0) {
  const s = begin(delay);
  if (!s) return;
  voice(s.c, s.out, {
    at: s.t,
    gain: 0.58,
    decay: 0.5,
    attack: 0.008,
    freq: 150,
    freqEnd: 84,
    glide: 0.12,
  });
  voice(s.c, s.out, {
    at: s.t,
    gain: 0.12,
    decay: 0.3,
    attack: 0.008,
    freq: 300,
    freqEnd: 168,
    glide: 0.12,
  });
  voice(s.c, s.out, {
    at: s.t + 0.01,
    gain: 0.22,
    decay: 0.5,
    attack: 0.02,
    freq: 196,
    type: 'triangle',
    lowpass: 1600,
  });
  voice(s.c, s.out, {
    at: s.t + 0.04,
    gain: 0.18,
    decay: 0.46,
    attack: 0.03,
    freq: 294,
    type: 'triangle',
    lowpass: 1900,
  });
  // The burst going off, opening upward.
  hiss(s.c, s.out, { at: s.t, gain: 0.29, decay: 0.28, freq: 2600, freqEnd: 5200, q: 0.6 });
  hiss(s.c, s.out, { at: s.t, gain: 0.16, decay: 0.5, attack: 0.05, freq: 6200, q: 0.5, type: 'highpass' });
}

/**
 * A come-out winner. The same shape as a made point, half the weight: it pays
 * the line and hands the dice straight back rather than ending anything.
 */
export function natural(delay = 0) {
  const s = begin(delay);
  if (!s) return;
  voice(s.c, s.out, {
    at: s.t,
    gain: 0.29,
    decay: 0.3,
    attack: 0.008,
    freq: 170,
    freqEnd: 96,
    glide: 0.1,
  });
  voice(s.c, s.out, {
    at: s.t + 0.02,
    gain: 0.2,
    decay: 0.3,
    attack: 0.02,
    freq: 294,
    type: 'triangle',
    lowpass: 1800,
  });
  voice(s.c, s.out, {
    at: s.t + 0.06,
    gain: 0.14,
    decay: 0.26,
    attack: 0.02,
    freq: 392,
    type: 'triangle',
    lowpass: 2200,
  });
  hiss(s.c, s.out, { at: s.t, gain: 0.18, decay: 0.18, freq: 2800, freqEnd: 4600, q: 0.7 });
}

/**
 * The stick calling a seven out.
 *
 * The mirror of {@link pointMade} and deliberately built the opposite way
 * round: the pitch falls instead of rising, the noise is dark instead of
 * bright, and the low voice goes further down and stays longer. It lands on the
 * same frame as the felt's shake, so most of its job is to give that shake
 * something to be.
 *
 * The 500 Hz knock body is not decoration. Rendered without it this was 92 per
 * cent sub-120 energy, which is a sting that a phone or a laptop simply does
 * not play.
 */
export function sevenOut(delay = 0) {
  const s = begin(delay);
  if (!s) return;
  // The stick on the wood as the call is made.
  hiss(s.c, s.out, { at: s.t, gain: 0.31, decay: 0.03, freq: 1500, q: 1.4 });
  hiss(s.c, s.out, { at: s.t, gain: 0.28, decay: 0.12, freq: 500, q: 1 });
  // The floor going out from under the hand, doubled at the octave so it
  // survives a small speaker.
  voice(s.c, s.out, {
    at: s.t,
    gain: 0.49,
    decay: 0.55,
    attack: 0.01,
    freq: 110,
    freqEnd: 45,
    glide: 0.16,
  });
  voice(s.c, s.out, {
    at: s.t,
    gain: 0.15,
    decay: 0.35,
    attack: 0.01,
    freq: 220,
    freqEnd: 90,
    glide: 0.16,
  });
  // Dark cloth, shaking.
  hiss(s.c, s.out, { at: s.t, gain: 0.2, decay: 0.5, attack: 0.03, freq: 260, q: 0.6, type: 'lowpass' });
  // A note that falls rather than rises.
  voice(s.c, s.out, {
    at: s.t + 0.02,
    gain: 0.29,
    decay: 0.5,
    attack: 0.02,
    freq: 165,
    freqEnd: 110,
    glide: 0.42,
    type: 'triangle',
    lowpass: 900,
  });
}

/* ------------------------------------------------------------------ *
 * The puck, and money moving on its own
 * ------------------------------------------------------------------ */

/** The puck slapped down on a number, white side up. */
export function puckOn(delay = 0) {
  const s = begin(delay);
  if (!s) return;
  hiss(s.c, s.out, { at: s.t, gain: 0.3, decay: 0.02, freq: 2200, q: 2.5 });
  hiss(s.c, s.out, { at: s.t, gain: 0.12, decay: 0.012, freq: 5000, q: 0.6, type: 'highpass' });
  hiss(s.c, s.out, { at: s.t, gain: 0.15, decay: 0.07, freq: 300, q: 0.7, type: 'lowpass' });
  voice(s.c, s.out, { at: s.t, gain: 0.18, decay: 0.09, attack: 0.003, freq: 420, type: 'triangle', lowpass: 2200 });
  // Two notes up: the point is on.
  voice(s.c, s.out, { at: s.t + 0.07, gain: 0.1, decay: 0.1, freq: 294, type: 'triangle', lowpass: 1600 });
  voice(s.c, s.out, { at: s.t + 0.15, gain: 0.1, decay: 0.14, freq: 440, type: 'triangle', lowpass: 2000 });
}

/** The puck turned over and pushed off to the side. Duller, and falling. */
export function puckOff(delay = 0) {
  const s = begin(delay);
  if (!s) return;
  hiss(s.c, s.out, { at: s.t, gain: 0.26, decay: 0.018, freq: 1500, q: 2.2 });
  hiss(s.c, s.out, { at: s.t, gain: 0.15, decay: 0.09, freq: 260, q: 0.7, type: 'lowpass' });
  voice(s.c, s.out, { at: s.t + 0.03, gain: 0.13, decay: 0.14, freq: 330, freqEnd: 220, glide: 0.12, type: 'triangle', lowpass: 1400 });
}

/**
 * A come or don't-come bet travelling to the number it caught.
 *
 * Cloth under a chip, then the chip arriving. Under reduced motion the felt
 * does not fly the chip, so neither does this — only the arrival is left.
 */
export function comeTravel(delay = 0) {
  const s = begin(delay);
  if (!s) return;
  if (!reducedMotion()) {
    hiss(s.c, s.out, {
      at: s.t,
      gain: 0.15,
      decay: 0.16,
      attack: 0.03,
      freq: 1800,
      freqEnd: 700,
      q: 0.9,
    });
  }
  clayTick(s.c, s.out, s.t + 0.15, 0.29, 0.95);
}

/* ------------------------------------------------------------------ *
 * Interface
 * ------------------------------------------------------------------ */

/** A control answering. Dry, short and well under everything on the felt. */
export function uiClick() {
  const s = begin(0);
  if (!s) return;
  hiss(s.c, s.out, { at: s.t, gain: 0.16, decay: 0.012, freq: 3000, q: 2.2 });
  hiss(s.c, s.out, { at: s.t, gain: 0.084, decay: 0.025, freq: 1300, q: 2.6 });
}

/**
 * A refused action: short, low, unmistakable, and not a buzzer.
 *
 * A square wave was the first attempt and it read as an error dialog. This is a
 * triangle under a low lid with a knock across the middle to carry it on a
 * small speaker, which lands closer to a dealer's hand on your chips.
 */
export function refuse() {
  const s = begin(0);
  if (!s) return;
  hiss(s.c, s.out, { at: s.t, gain: 0.095, decay: 0.04, freq: 320, q: 0.8, type: 'lowpass' });
  hiss(s.c, s.out, { at: s.t, gain: 0.135, decay: 0.08, freq: 480, q: 1.2 });
  voice(s.c, s.out, {
    at: s.t,
    gain: 0.23,
    decay: 0.13,
    attack: 0.004,
    freq: 150,
    freqEnd: 118,
    glide: 0.11,
    type: 'triangle',
    lowpass: 700,
  });
}
