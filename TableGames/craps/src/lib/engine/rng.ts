/**
 * Randomness.
 *
 * The dice are decided here and nowhere else. Two independent uniform draws in
 * 1..6, taken with rejection sampling so no face is even fractionally favoured
 * by modulo bias.
 *
 * A session can run on a named seed, which makes an entire shoot reproducible.
 * That matters for two reasons: it is how the test suite verifies the resolver
 * against known sequences, and it lets you replay a session you want to study.
 */

import type { DieFace, Roll } from './types';

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [0, n). */
  int(n: number): number;
  /** How many raw words have been drawn. */
  readonly draws: number;
}

/** xoshiro128** - small, fast, and statistically solid for this purpose. */
export function createRng(seed: string): Rng {
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let s3 = 0;
  let draws = 0;

  // splitmix32 the string into four words of state.
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const mix = () => {
    h = (h + 0x9e3779b9) >>> 0;
    let z = h;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
    return (z ^ (z >>> 15)) >>> 0;
  };
  s0 = mix();
  s1 = mix();
  s2 = mix();
  s3 = mix();
  if ((s0 | s1 | s2 | s3) === 0) s0 = 1;

  const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;

  function word(): number {
    draws++;
    const result = (Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7) >>> 0, 9) >>> 0) >>> 0;
    const t = (s1 << 9) >>> 0;
    s2 = (s2 ^ s0) >>> 0;
    s3 = (s3 ^ s1) >>> 0;
    s1 = (s1 ^ s2) >>> 0;
    s0 = (s0 ^ s3) >>> 0;
    s2 = (s2 ^ t) >>> 0;
    s3 = rotl(s3, 11);
    return result;
  }

  return {
    next: () => word() / 4294967296,
    int(n: number) {
      // Rejection sampling: discard the ragged tail so every value is equally likely.
      const limit = Math.floor(4294967296 / n) * n;
      let w = word();
      while (w >= limit) w = word();
      return w % n;
    },
    get draws() {
      return draws;
    },
  };
}

/** A seed drawn from the platform CSPRNG, or the clock if one is unavailable. */
export function randomSeed(): string {
  const g = globalThis as { crypto?: Crypto };
  if (g.crypto?.getRandomValues) {
    const buf = new Uint32Array(4);
    g.crypto.getRandomValues(buf);
    return Array.from(buf, (n) => n.toString(36)).join('-');
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Two honest dice. */
export function rollDice(rng: Rng): Roll {
  const d1 = (rng.int(6) + 1) as DieFace;
  const d2 = (rng.int(6) + 1) as DieFace;
  return { d1, d2, total: d1 + d2 };
}

export function isHardway(roll: Roll): boolean {
  return roll.d1 === roll.d2 && [4, 6, 8, 10].includes(roll.total);
}
