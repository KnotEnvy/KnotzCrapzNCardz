import { beforeAll, describe, expect, it } from 'vitest';
import { FACE_AXES, faceUp, initDicePhysics, simulateThrow, TABLE } from './simulate';
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

/** All 36 ordered pairs, in a fixed order. */
const COMBINATIONS: Array<[DieFace, DieFace]> = [];
for (let d1 = 1 as DieFace; d1 <= 6; d1 = (d1 + 1) as DieFace) {
  for (let d2 = 1 as DieFace; d2 <= 6; d2 = (d2 + 1) as DieFace) {
    COMBINATIONS.push([d1, d2]);
  }
}

describe('simulateThrow', () => {
  // The whole contract of the relabelling trick in one loop: the RNG picks the
  // result first, one physics run is reused for every outcome, and the cube
  // rotation that puts the wanted face up must not disturb where the dice come
  // to rest. Asserting the pose on every combination rather than repeating a
  // single combination catches a rotation that only misbehaves for some faces.
  it('lands every combination face-up, flat on the felt and inside the rails', () => {
    const rand = mulberry32(12345);
    for (const [d1, d2] of COMBINATIONS) {
      const anim = simulateThrow({ d1, d2, total: d1 + d2 }, rand);
      const rest = anim.frames[anim.restIndex];
      expect(faceUp(rest.a.q).face, `die A for ${d1}-${d2}`).toBe(d1);
      expect(faceUp(rest.b.q).face, `die B for ${d1}-${d2}`).toBe(d2);

      for (const die of [rest.a, rest.b]) {
        const where = `${d1}-${d2}`;
        expect(faceUp(die.q).alignment, `flat for ${where}`).toBeGreaterThan(0.98);
        expect(die.p[1], `above the felt for ${where}`).toBeGreaterThan(0);
        expect(die.p[1], `not floating for ${where}`).toBeLessThan(TABLE.dieHalf * 2.2);
        expect(Math.abs(die.p[0]), `inside the side rails for ${where}`).toBeLessThan(TABLE.halfX);
        expect(Math.abs(die.p[2]), `inside the end rails for ${where}`).toBeLessThan(TABLE.halfZ);
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
    // The bound is what the click path needs; the statistic is what makes the
    // test honest on a shared machine. A mean over the batch lets one CPU
    // steal by a neighbouring process fail an otherwise healthy build, so this
    // takes the median of the individual throws instead. A real regression
    // moves every throw, not one of them.
    const rand = mulberry32(5150);
    const times: number[] = [];
    for (let i = 0; i < 21; i++) {
      const t0 = performance.now();
      simulateThrow({ d1: 6, d2: 6, total: 12 }, rand);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    const median = times[(times.length - 1) / 2];
    expect(median).toBeLessThan(60);
  }, 60_000);
});

/* ------------------------------------------------------------------ *
 * The die convention
 * ------------------------------------------------------------------ */

/*
 * FACE_AXES here and MATERIAL_ORDER in src/components/dice/DiceStage.tsx encode
 * the same physical die. Nothing imports one from the other and nothing
 * type-checks the relationship, so if they drift every roll renders a face that
 * does not match the result the engine settled — a silent, green-build bug.
 * This is the only thing standing between the two files.
 */
describe('the die the simulator and the renderer agree on', () => {
  const AXIS_NAMES = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'] as const;
  /** THREE.BoxGeometry orders its six material groups this way. */
  const BOX_GEOMETRY_AXES: Array<[number, number, number]> = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];

  it('lays a real die out in the order DiceStage builds its materials', () => {
    // Opposite faces sum to seven, or it is not a die.
    for (const [a, b] of [
      [1, 6],
      [2, 5],
      [3, 4],
    ] as const) {
      // `+ 0` normalises the negative zero that negating 0 produces.
      expect(FACE_AXES[a].map((v) => -v + 0)).toEqual([...FACE_AXES[b]]);
    }

    // A Western casino die reads 1, 2, 3 counter-clockwise around their shared
    // corner, which in a right-handed frame is axis(1) x axis(2) = axis(3).
    const [x1, y1, z1] = FACE_AXES[1];
    const [x2, y2, z2] = FACE_AXES[2];
    const cross = [y1 * z2 - z1 * y2, z1 * x2 - x1 * z2, x1 * y2 - y1 * x2].map((v) => v + 0);
    expect(cross).toEqual([...FACE_AXES[3]]);

    // And the pip layout, read off in BoxGeometry's group order, is exactly the
    // list DiceStage hands to its material array. Keep the two in step.
    const derived = BOX_GEOMETRY_AXES.map((axis, i) => {
      const face = (Object.keys(FACE_AXES) as unknown as DieFace[])
        .map(Number)
        .find((f) => FACE_AXES[f as DieFace].every((v, k) => v === axis[k]));
      expect(face, `no face on ${AXIS_NAMES[i]}`).toBeDefined();
      return face;
    });
    expect(derived).toEqual([1, 6, 2, 5, 3, 4]); // MATERIAL_ORDER in DiceStage.tsx
  });
});

