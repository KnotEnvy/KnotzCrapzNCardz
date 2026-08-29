/**
 * Randomness.
 *
 * Every reel stop, every orb value, every random feature comes from here and
 * nowhere else. The generator is xoshiro128** seeded from a string, which
 * makes an entire session reproducible from its seed -- that is how the RTP
 * simulations verify the paytable, and how a spin worth arguing about can be
 * replayed exactly.
 *
 * The important discipline: draws are taken in a fixed order. A spin draws
 * five stops, then its feature rolls, always in the same sequence, so the same
 * seed at the same spin count produces the same board. Adding a draw in the
 * middle of that order re-rolls the whole future of every seeded test, which
 * is a legitimate change but never an accidental one.
 */

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
      // Rejection sampling: discard the ragged tail so every value is equally
      // likely. A reel strip is rarely a power of two, and modulo bias on a
      // 137-stop strip is a real, measurable tilt in the RTP.
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

/** True with probability `p`. */
export function chance(rng: Rng, p: number): boolean {
  return rng.next() < p;
}

/** One item from `items`, uniformly. */
export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[rng.int(items.length)];
}

/**
 * One item chosen against a weight table.
 *
 * Weights need not sum to anything in particular. Used for orb values, where
 * a 1x orb is common and a GRAND is not, and for anything else where the
 * distribution is the design.
 */
export function weighted<T>(rng: Rng, items: readonly T[], weights: readonly number[]): T {
  let total = 0;
  for (const w of weights) total += w;
  let r = rng.next() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r < 0) return items[i];
  }
  return items[items.length - 1];
}

/** Fisher-Yates, in place, returning the same array. */
export function shuffle<T>(rng: Rng, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}
