/**
 * Randomness.
 *
 * The shuffle is decided here and nowhere else. This is the same xoshiro128**
 * that runs the craps table across the hall, copied rather than shared: the
 * two games have no build in common, and eighty honest lines beat a package
 * boundary drawn between two apps that will never be deployed together.
 *
 * A session can run on a named seed, which makes an entire shoe reproducible.
 * That is how the test suite asserts a resolver against a known sequence, and
 * how a hand worth studying can be dealt again.
 */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [0, n). */
  int(n: number): number;
  /** How many raw words have been drawn. */
  readonly draws: number;
}

/** xoshiro128** — small, fast, and statistically solid for this purpose. */
export function createRng(seed: string): Rng {
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
  let s0 = mix();
  let s1 = mix();
  let s2 = mix();
  let s3 = mix();
  if ((s0 | s1 | s2 | s3) === 0) s0 = 1;

  const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;

  function word(): number {
    draws++;
    const result = Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7) >>> 0, 9) >>> 0;
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
      // likely. A 312-card shoe shuffled a hundred thousand times will find a
      // modulo bias that a hundred hands would not.
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

/**
 * A seed drawn from an existing stream.
 *
 * Lets a value carry the seed of its own next shuffle — which is how the shoe
 * can reshuffle itself mid-round without every function that deals a card
 * having to be handed a generator. It stays deterministic: the same session
 * replays the same reshuffles.
 */
export function seedFrom(rng: Rng): string {
  return `${rng.int(0xffffffff).toString(36)}-${rng.int(0xffffffff).toString(36)}`;
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
