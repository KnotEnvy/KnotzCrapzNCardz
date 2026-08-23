/**
 * Deterministic dice physics.
 *
 * The dice you see tumbling are driven by a real rigid-body simulation, but the
 * *result* is decided by the RNG before a single step is taken. Those two facts
 * are usually in tension: you cannot ask a physics engine to please land on a
 * six. We get both at once by exploiting the symmetry of a cube.
 *
 *   1. A uniform cube has an isotropic inertia tensor (a scalar multiple of the
 *      identity), so its rotational dynamics are invariant under any change of
 *      body frame.
 *   2. A cube collider is geometrically invariant under the 24 rotations of the
 *      octahedral group, so contacts behave identically too.
 *
 * Replacing a die's initial orientation q0 with q0 * R for a cube symmetry R
 * therefore yields the exact same trajectory, with every recorded orientation
 * q(t) becoming q(t) * R. The pips just ride along on a different face.
 *
 * So we simulate once with arbitrary initial conditions, see which face happens
 * to land up, then pick the R that swaps the desired face into that slot. The
 * tumble is genuine, the outcome is the RNG's, and there is no rejection
 * sampling, no snapping, and no re-running.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import type { DieFace, Roll } from '@/lib/engine/types';

export type Vec3 = [number, number, number];
/** Quaternion in (x, y, z, w) order, matching three.js and rapier. */
export type Quat = [number, number, number, number];

export interface DicePose {
  p: Vec3;
  q: Quat;
}

export interface DiceFrame {
  a: DicePose;
  b: DicePose;
}

export interface RollAnimation {
  frames: DiceFrame[];
  /** Frame index at which both dice have come to rest. */
  restIndex: number;
  /** The outcome these frames resolve to. */
  roll: Roll;
}

/* ------------------------------------------------------------------ *
 * Table geometry, shared with the renderer so the felt lines up.
 * ------------------------------------------------------------------ */

export const TABLE = {
  /**
   * Half-width along X. Narrower than the felt so the dice stay over the player
   * layout and never come to rest on top of the proposition box, where they
   * would hide the hardways and the props.
   */
  halfX: 7.5,
  /**
   * Half-depth along Z. Deliberately shallower than the felt: the renderer
   * pushes this box toward the viewer so the dice come to rest over the open
   * middle of the layout instead of covering the box numbers.
   */
  halfZ: 4.4,
  wallHeight: 4,
  dieHalf: 0.62,
} as const;

const STEP_HZ = 120;
/** Physics steps per recorded frame; frames are consumed at 60fps. */
const STEPS_PER_FRAME = 2;
const MAX_FRAMES = 260; // ~4.3s before we force a settle
const REST_LINEAR = 0.06;
const REST_ANGULAR = 0.12;
const REST_FRAMES_REQUIRED = 8;

let ready = false;

/** Loads the rapier WASM module. Safe to call repeatedly. */
export async function initDicePhysics(): Promise<void> {
  if (ready) return;
  await RAPIER.init();
  ready = true;
}

/* ------------------------------------------------------------------ *
 * Face to local-axis convention
 *
 *   +X = 1   -X = 6
 *   +Y = 2   -Y = 5
 *   +Z = 3   -Z = 4
 *
 * Opposite faces sum to seven, and 1-2-3 wind counter-clockwise about their
 * shared corner, which is the standard right-handed Western die.
 * ------------------------------------------------------------------ */

export const FACE_AXES: Record<DieFace, Vec3> = {
  1: [1, 0, 0],
  6: [-1, 0, 0],
  2: [0, 1, 0],
  5: [0, -1, 0],
  3: [0, 0, 1],
  4: [0, 0, -1],
};

const ALL_FACES: DieFace[] = [1, 2, 3, 4, 5, 6];

/* ------------------------------------------------------------------ *
 * Quaternion helpers (kept local so this module has no three.js dependency)
 * ------------------------------------------------------------------ */

function qMul(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

function qFromAxisAngle(axis: Vec3, angle: number): Quat {
  const [x, y, z] = axis;
  const len = Math.hypot(x, y, z) || 1;
  const h = angle / 2;
  const s = Math.sin(h) / len;
  return [x * s, y * s, z * s, Math.cos(h)];
}

/** Rotates a vector by a quaternion. */
function qRotate(q: Quat, v: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q;
  const [vx, vy, vz] = v;
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx),
  ];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Which face points most nearly straight up for a given orientation. */
export function faceUp(q: Quat): { face: DieFace; alignment: number } {
  let best: DieFace = 1;
  let bestDot = -Infinity;
  for (const f of ALL_FACES) {
    const world = qRotate(q, FACE_AXES[f]);
    if (world[1] > bestDot) {
      bestDot = world[1];
      best = f;
    }
  }
  return { face: best, alignment: bestDot };
}

/**
 * A cube symmetry R with R * axis(want) = axis(have), optionally spun by a
 * further quarter turn about the wanted face so repeated rolls of the same
 * number do not always settle into an identical pose.
 */
function relabelRotation(want: DieFace, have: DieFace, quarterTurns: number): Quat {
  const d = FACE_AXES[want];
  const a = FACE_AXES[have];
  const c = dot(d, a);

  let base: Quat;
  if (c > 0.999) {
    base = [0, 0, 0, 1];
  } else if (c < -0.999) {
    // Antipodal: any perpendicular axis gives a valid 180 degree flip.
    const perp: Vec3 = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    base = qFromAxisAngle(cross(d, perp), Math.PI);
  } else {
    base = qFromAxisAngle(cross(d, a), Math.acos(c));
  }

  const spin = qFromAxisAngle(d, (Math.PI / 2) * (quarterTurns & 3));
  return qMul(base, spin);
}

/* ------------------------------------------------------------------ *
 * The simulation
 * ------------------------------------------------------------------ */

function buildWorld(): RAPIER.World {
  const world = new RAPIER.World({ x: 0, y: -34, z: 0 });
  world.timestep = 1 / STEP_HZ;

  const { halfX, halfZ, wallHeight } = TABLE;
  const staticFloor = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());

  // Felt.
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(halfX, 0.5, halfZ)
      .setTranslation(0, -0.5, 0)
      .setFriction(0.92)
      .setRestitution(0.28),
    staticFloor,
  );

  // Four rails. The far rail is the pyramid-rubber back wall the shooter has to
  // hit, so it gets noticeably more bounce than the side rails.
  const rails: Array<[Vec3, Vec3, number]> = [
    [[0, wallHeight / 2, -halfZ - 0.5], [halfX + 1, wallHeight, 0.5], 0.62],
    [[0, wallHeight / 2, halfZ + 0.5], [halfX + 1, wallHeight, 0.5], 0.4],
    [[-halfX - 0.5, wallHeight / 2, 0], [0.5, wallHeight, halfZ + 1], 0.4],
    [[halfX + 0.5, wallHeight / 2, 0], [0.5, wallHeight, halfZ + 1], 0.4],
  ];
  for (const [pos, half, restitution] of rails) {
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(half[0], half[1], half[2])
        .setTranslation(pos[0], pos[1], pos[2])
        .setFriction(0.5)
        .setRestitution(restitution),
      staticFloor,
    );
  }

  return world;
}

function addDie(world: RAPIER.World, at: Vec3): RAPIER.RigidBody {
  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(at[0], at[1], at[2])
      .setLinearDamping(0.16)
      .setAngularDamping(0.22)
      .setCcdEnabled(true),
  );
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(TABLE.dieHalf, TABLE.dieHalf, TABLE.dieHalf)
      .setDensity(1.6)
      .setFriction(0.62)
      .setRestitution(0.52),
    body,
  );
  return body;
}

/** Shoemake's uniform random rotation. */
function randomQuat(rand: () => number): Quat {
  const u1 = rand();
  const u2 = rand();
  const u3 = rand();
  const s1 = Math.sqrt(1 - u1);
  const s2 = Math.sqrt(u1);
  return [
    s1 * Math.sin(2 * Math.PI * u2),
    s1 * Math.cos(2 * Math.PI * u2),
    s2 * Math.sin(2 * Math.PI * u3),
    s2 * Math.cos(2 * Math.PI * u3),
  ];
}

function poseOf(body: RAPIER.RigidBody): DicePose {
  const t = body.translation();
  const r = body.rotation();
  return { p: [t.x, t.y, t.z], q: [r.x, r.y, r.z, r.w] };
}

function isAsleep(body: RAPIER.RigidBody): boolean {
  const v = body.linvel();
  const w = body.angvel();
  return Math.hypot(v.x, v.y, v.z) < REST_LINEAR && Math.hypot(w.x, w.y, w.z) < REST_ANGULAR;
}

interface RawThrow {
  frames: DiceFrame[];
  restIndex: number;
  landed: [DieFace, DieFace];
  /** How square-on the dice ended up. Low values mean a die is cocked. */
  alignment: number;
}

/** Runs one throw with arbitrary initial conditions and records the motion. */
function rawThrow(rand: () => number): RawThrow {
  const world = buildWorld();

  // The shooter stands at the near-right corner and throws toward the far rail.
  const originX = TABLE.halfX - 1.6;
  const originZ = TABLE.halfZ - 1.4;
  const spread = 0.55 + rand() * 0.5;

  const a = addDie(world, [originX, 2.1 + rand() * 0.5, originZ]);
  const b = addDie(world, [originX - spread, 2.4 + rand() * 0.5, originZ - spread * 0.6]);

  // Aim at a random spot along the far rail so no two throws travel the same line.
  const aimX = (rand() * 2 - 1) * (TABLE.halfX * 0.55);
  const aimZ = -TABLE.halfZ;
  const power = 1.02 + rand() * 0.22;

  for (const [body, extra] of [
    [a, 0] as const,
    [b, 0.6] as const,
  ]) {
    const t = body.translation();
    const dx = aimX - t.x + (rand() - 0.5) * 1.4;
    const dz = aimZ - t.z + (rand() - 0.5) * 0.9;
    const len = Math.hypot(dx, dz) || 1;
    const speed = (17 + rand() * 4 + extra) * power;

    const q = randomQuat(rand);
    body.setRotation({ x: q[0], y: q[1], z: q[2], w: q[3] }, true);
    body.setLinvel({ x: (dx / len) * speed, y: 3.2 + rand() * 2.4, z: (dz / len) * speed }, true);
    body.setAngvel(
      { x: (rand() - 0.5) * 46, y: (rand() - 0.5) * 46, z: (rand() - 0.5) * 46 },
      true,
    );
  }

  const frames: DiceFrame[] = [];
  let restStreak = 0;
  let restIndex = -1;

  for (let f = 0; f < MAX_FRAMES; f++) {
    for (let s = 0; s < STEPS_PER_FRAME; s++) world.step();
    frames.push({ a: poseOf(a), b: poseOf(b) });

    if (isAsleep(a) && isAsleep(b)) {
      restStreak++;
      if (restStreak >= REST_FRAMES_REQUIRED) {
        restIndex = f;
        break;
      }
    } else {
      restStreak = 0;
    }
  }

  if (restIndex < 0) restIndex = frames.length - 1;

  const last = frames[restIndex];
  const upA = faceUp(last.a.q);
  const upB = faceUp(last.b.q);
  world.free();

  return {
    frames,
    restIndex,
    landed: [upA.face, upB.face],
    alignment: Math.min(upA.alignment, upB.alignment),
  };
}

/**
 * Produces an animation that tumbles realistically and finishes showing exactly
 * `target`. Throws are re-run only when a die ends up cocked against a rail.
 */
export function simulateThrow(target: Roll, rand: () => number = Math.random): RollAnimation {
  if (!ready) throw new Error('initDicePhysics() must be awaited before simulateThrow()');

  let raw = rawThrow(rand);
  for (let attempt = 0; attempt < 8 && raw.alignment < 0.985; attempt++) {
    raw = rawThrow(rand);
  }

  // Swap the pips so the faces we want are the ones already resting up.
  const rA = relabelRotation(target.d1, raw.landed[0], Math.floor(rand() * 4));
  const rB = relabelRotation(target.d2, raw.landed[1], Math.floor(rand() * 4));

  const frames = raw.frames.map<DiceFrame>((fr) => ({
    a: { p: fr.a.p, q: qMul(fr.a.q, rA) },
    b: { p: fr.b.p, q: qMul(fr.b.q, rB) },
  }));

  return { frames, restIndex: raw.restIndex, roll: target };
}
