import { beforeAll, describe, expect, it } from 'vitest';
import { faceUp, initDicePhysics, simulateThrow, TABLE } from './simulate';
import type { DieFace } from '@/lib/engine/types';

beforeAll(async () => {
  await initDicePhysics();
}, 30_000);

/** Deterministic PRNG so failures are reproducible. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('simulateThrow', () => {
  it('finishes showing exactly the requested faces, for all 36 combinations', () => {
    const rand = mulberry32(12345);
    for (let d1 = 1 as DieFace; d1 <= 6; d1 = (d1 + 1) as DieFace) {
      for (let d2 = 1 as DieFace; d2 <= 6; d2 = (d2 + 1) as DieFace) {
        const anim = simulateThrow({ d1, d2, total: d1 + d2 }, rand);
        const rest = anim.frames[anim.restIndex];
        expect(faceUp(rest.a.q).face, `die A for ${d1}-${d2}`).toBe(d1);
        expect(faceUp(rest.b.q).face, `die B for ${d1}-${d2}`).toBe(d2);
      }
    }
  }, 60_000);

  it('settles both dice flat on the felt and inside the rails', () => {
    const rand = mulberry32(777);
    for (let i = 0; i < 40; i++) {
      const anim = simulateThrow({ d1: 3, d2: 5, total: 8 }, rand);
      const rest = anim.frames[anim.restIndex];
      for (const die of [rest.a, rest.b]) {
        expect(faceUp(die.q).alignment).toBeGreaterThan(0.98);
        expect(die.p[1]).toBeGreaterThan(0);
        expect(die.p[1]).toBeLessThan(TABLE.dieHalf * 2.2);
        expect(Math.abs(die.p[0])).toBeLessThan(TABLE.halfX);
        expect(Math.abs(die.p[2])).toBeLessThan(TABLE.halfZ);
      }
    }
  }, 60_000);

  it('produces a tumble of a watchable length', () => {
    const rand = mulberry32(99);
    const lengths: number[] = [];
    for (let i = 0; i < 30; i++) {
      lengths.push(simulateThrow({ d1: 1, d2: 1, total: 2 }, rand).restIndex);
    }
    const avg = lengths.reduce((s, n) => s + n, 0) / lengths.length;
    // Frames are consumed at 60fps, so this is roughly 1.2s to 3.5s.
    expect(avg).toBeGreaterThan(70);
    expect(avg).toBeLessThan(210);
  }, 60_000);

  it('is fast enough to run synchronously on a click', () => {
    const rand = mulberry32(5150);
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) simulateThrow({ d1: 6, d2: 6, total: 12 }, rand);
    const perThrow = (performance.now() - t0) / 20;
    expect(perThrow).toBeLessThan(60);
  }, 60_000);
});
