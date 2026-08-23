'use client';

/**
 * Table sound, synthesised on the fly.
 *
 * Everything here is generated with oscillators and filtered noise rather than
 * loaded from files: a dice clack is a short noise burst through a bandpass,
 * a chip drop is the same thing an octave down with a click transient. It keeps
 * the bundle free of audio assets and lets each impact carry its own velocity,
 * so a hard bounce off the back wall genuinely sounds harder than a soft roll.
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = true;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  // Browsers start the context suspended until a gesture; nudge it each time.
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export function setSoundEnabled(on: boolean) {
  enabled = on;
}

/** A short burst of filtered noise: the basis of every impact sound here. */
function burst(opts: {
  duration: number;
  frequency: number;
  q: number;
  gain: number;
  type?: BiquadFilterType;
}) {
  const c = audio();
  if (!c || !master || !enabled) return;

  const frames = Math.max(1, Math.floor(c.sampleRate * opts.duration));
  const buffer = c.createBuffer(1, frames, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) {
    // Decaying white noise.
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 2;
  }

  const src = c.createBufferSource();
  src.buffer = buffer;

  const filter = c.createBiquadFilter();
  filter.type = opts.type ?? 'bandpass';
  filter.frequency.value = opts.frequency;
  filter.Q.value = opts.q;

  const gain = c.createGain();
  gain.gain.value = opts.gain;
  gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + opts.duration);

  src.connect(filter).connect(gain).connect(master);
  src.start();
  src.stop(c.currentTime + opts.duration + 0.02);
}

function tone(freq: number, duration: number, gain: number, delay = 0, type: OscillatorType = 'sine') {
  const c = audio();
  if (!c || !master || !enabled) return;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t0 = c.currentTime + delay;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

/** Acrylic on wood. `force` in 0..1 scales brightness and level. */
export function diceClack(force = 0.6) {
  const f = Math.min(1, Math.max(0.08, force));
  burst({
    duration: 0.045 + f * 0.03,
    frequency: 1700 + f * 2600,
    q: 1.1,
    gain: 0.05 + f * 0.22,
  });
}

/** Clay chips landing in a stack. */
export function chipDrop() {
  burst({ duration: 0.06, frequency: 900, q: 1.6, gain: 0.14 });
  burst({ duration: 0.09, frequency: 320, q: 0.9, gain: 0.09 });
}

/** Chips sliding back across the felt to a winner. */
export function payout() {
  tone(523.25, 0.14, 0.1);
  tone(659.25, 0.16, 0.09, 0.07);
  tone(783.99, 0.26, 0.08, 0.14);
  burst({ duration: 0.12, frequency: 700, q: 1.2, gain: 0.08 });
}

/** The stick calling a seven out. */
export function sevenOut() {
  tone(196, 0.3, 0.1, 0, 'triangle');
  tone(146.83, 0.5, 0.09, 0.1, 'triangle');
  burst({ duration: 0.25, frequency: 260, q: 0.7, gain: 0.1 });
}

/** A point being set: the puck going ON. */
export function puckOn() {
  burst({ duration: 0.07, frequency: 550, q: 2.2, gain: 0.16 });
  tone(392, 0.18, 0.07, 0.03, 'triangle');
}

export function uiClick() {
  burst({ duration: 0.025, frequency: 2600, q: 2.4, gain: 0.06 });
}

/** A rejected action: short, low, unmistakable. */
export function refuse() {
  tone(140, 0.12, 0.08, 0, 'square');
}
