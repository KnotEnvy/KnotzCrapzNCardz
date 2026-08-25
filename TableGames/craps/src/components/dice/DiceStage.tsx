'use client';

/**
 * The dice, in three dimensions, over the felt.
 *
 * No physics runs here. The tumble was solved before the throw started (see
 * `lib/dice/simulate`), so this component is a playback head: it walks the
 * recorded poses at sixty frames a second, fires a clack whenever a die
 * reverses direction against a surface, and tells the store to settle up the
 * moment both dice come to rest.
 */

import { PerspectiveCamera } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as React from 'react';
import * as THREE from 'three';
import { diceClack } from '@/lib/audio';
import { TABLE, type RollAnimation } from '@/lib/dice/simulate';
import { useGame } from '@/lib/store/useGame';
import type { DieFace } from '@/lib/engine/types';

/* ------------------------------------------------------------------ *
 * Die faces, painted onto a canvas
 * ------------------------------------------------------------------ */

const PIPS: Record<DieFace, Array<[number, number]>> = {
  1: [[0.5, 0.5]],
  2: [
    [0.27, 0.27],
    [0.73, 0.73],
  ],
  3: [
    [0.25, 0.25],
    [0.5, 0.5],
    [0.75, 0.75],
  ],
  4: [
    [0.27, 0.27],
    [0.73, 0.27],
    [0.27, 0.73],
    [0.73, 0.73],
  ],
  5: [
    [0.26, 0.26],
    [0.74, 0.26],
    [0.5, 0.5],
    [0.26, 0.74],
    [0.74, 0.74],
  ],
  6: [
    [0.27, 0.22],
    [0.73, 0.22],
    [0.27, 0.5],
    [0.73, 0.5],
    [0.27, 0.78],
    [0.73, 0.78],
  ],
};

/** Casino dice: translucent crimson with flush-filled white pips. */
function faceTexture(value: DieFace): THREE.CanvasTexture {
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const g = canvas.getContext('2d')!;

  g.fillStyle = '#c1122c';
  g.fillRect(0, 0, S, S);

  // A little depth so the faces are not flat colour under the key light.
  const sheen = g.createRadialGradient(S * 0.34, S * 0.28, S * 0.05, S * 0.5, S * 0.5, S * 0.78);
  sheen.addColorStop(0, 'rgba(255,255,255,0.13)');
  sheen.addColorStop(1, 'rgba(90,0,12,0.32)');
  g.fillStyle = sheen;
  g.fillRect(0, 0, S, S);

  const r = S * 0.082;
  for (const [px, py] of PIPS[value]) {
    const x = px * S;
    const y = py * S;
    // Pips are drilled and filled, so they sit very slightly proud.
    g.beginPath();
    g.arc(x, y + r * 0.16, r, 0, Math.PI * 2);
    g.fillStyle = 'rgba(60,0,10,0.55)';
    g.fill();
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fillStyle = '#fbf7f0';
    g.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * BoxGeometry orders its material groups +X, -X, +Y, -Y, +Z, -Z. The simulator
 * decides which face is up by the same axis convention, so the two have to
 * agree here or every roll would read wrong.
 */
const MATERIAL_ORDER: DieFace[] = [1, 6, 2, 5, 3, 4];

function useDieMaterials() {
  return React.useMemo(() => {
    const mats = MATERIAL_ORDER.map(
      (face) =>
        new THREE.MeshPhysicalMaterial({
          map: faceTexture(face),
          // Casino dice are polished to a near-mirror finish, which is most of
          // why they read as glass rather than plastic. The clearcoat is what
          // carries that: a tight, bright specular sitting on top of a fairly
          // matte crimson body.
          roughness: 0.19,
          metalness: 0,
          // Clearcoat is kept well under 1. There is no environment map in this
          // scene, so a full-strength coat has nothing to reflect and only
          // costs the diffuse its brightness — the dice go dark rather than
          // glossy. Verified on screen, not from the numbers.
          clearcoat: 0.8,
          clearcoatRoughness: 0.12,
          reflectivity: 0.5,
        }),
    );
    return mats;
  }, []);
}

/* ------------------------------------------------------------------ *
 * Contact shadow
 * ------------------------------------------------------------------ */

/**
 * The dark pool directly under a die.
 *
 * The shadow map already puts the die's cast shadow on the felt, but a mapped
 * shadow of a small object at this light distance stays roughly the same
 * weight whether the die is resting or six units up. What sells contact is the
 * opposite: a tight, dark blob when it lands and a wide, faint one while it is
 * in the air. This is that, driven straight off the die's height.
 */
function useContactBlobs(count: number) {
  return React.useMemo(
    () =>
      Array.from(
        { length: count },
        () =>
          new THREE.MeshBasicMaterial({
            color: 0x000000,
            transparent: true,
            opacity: 0.4,
            depthWrite: false,
          }),
      ),
    [count],
  );
}

/** Height above the felt at which a die stops darkening the cloth under it. */
const CONTACT_FADE = 5.5;

function applyContact(blob: THREE.Mesh | null, p: readonly number[], dieHalf: number) {
  if (!blob) return;
  const h = Math.max(0, p[1] - dieHalf);
  const k = Math.max(0, 1 - h / CONTACT_FADE);
  blob.position.set(p[0], 0.015, p[2]);
  const spread = 1 + h * 0.16;
  blob.scale.set(spread, spread, spread);
  (blob.material as THREE.MeshBasicMaterial).opacity = 0.44 * k * k;
}

/* ------------------------------------------------------------------ *
 * Playback
 * ------------------------------------------------------------------ */

const SETTLE_HOLD_MS = 260;

/**
 * Where the dice box sits relative to the felt, in world units: pushed toward
 * the viewer so the dice land on the open bands rather than the box numbers,
 * and to the left so they stay clear of the proposition column.
 */
const DICE_Z_OFFSET = 2.4;
const DICE_X_OFFSET = -2.7;

function Dice({ animation, onSettled }: { animation: RollAnimation | null; onSettled: () => void }) {
  const materials = useDieMaterials();
  // One material per blob: opacity is written per die every frame, so a shared
  // instance would leave both dice wearing whichever one was updated last.
  const blobMaterials = useContactBlobs(2);
  const a = React.useRef<THREE.Mesh>(null);
  const b = React.useRef<THREE.Mesh>(null);
  const blobA = React.useRef<THREE.Mesh>(null);
  const blobB = React.useRef<THREE.Mesh>(null);
  const clock = React.useRef(0);
  const settledAt = React.useRef<number | null>(null);
  const lastImpactFrame = React.useRef(-10);
  const soundOn = useGame((s) => s.soundOn);

  /** Frames where a die reverses vertically: that is a bounce. */
  const impacts = React.useMemo(() => {
    if (!animation) return new Set<number>();
    const set = new Set<number>();
    const { frames } = animation;
    for (let i = 2; i < frames.length; i++) {
      for (const key of ['a', 'b'] as const) {
        const y0 = frames[i - 2][key].p[1];
        const y1 = frames[i - 1][key].p[1];
        const y2 = frames[i][key].p[1];
        if (y1 < y0 && y2 >= y1 && y1 < TABLE.dieHalf * 3) set.add(i);
      }
    }
    return set;
  }, [animation]);

  React.useEffect(() => {
    clock.current = 0;
    settledAt.current = null;
    lastImpactFrame.current = -10;
  }, [animation]);

  useFrame((_, delta) => {
    if (!animation || !a.current || !b.current) return;

    clock.current += delta * 60;
    const index = Math.min(Math.floor(clock.current), animation.restIndex);
    const frame = animation.frames[index];

    a.current.position.fromArray(frame.a.p);
    a.current.quaternion.fromArray(frame.a.q);
    b.current.position.fromArray(frame.b.p);
    b.current.quaternion.fromArray(frame.b.q);

    applyContact(blobA.current, frame.a.p, TABLE.dieHalf);
    applyContact(blobB.current, frame.b.p, TABLE.dieHalf);

    if (soundOn && index > lastImpactFrame.current + 3 && impacts.has(index)) {
      lastImpactFrame.current = index;
      // Earlier bounces in a throw carry more energy than the last few taps.
      const progress = index / Math.max(1, animation.restIndex);
      diceClack(0.95 - progress * 0.7);
    }

    if (index >= animation.restIndex) {
      if (settledAt.current === null) settledAt.current = performance.now();
      else if (performance.now() - settledAt.current > SETTLE_HOLD_MS) {
        settledAt.current = Number.POSITIVE_INFINITY; // fire once
        onSettled();
      }
    }
  });

  const half = TABLE.dieHalf;
  const size: [number, number, number] = [half * 2, half * 2, half * 2];
  return (
    <>
      {/* Written out rather than mapped: collecting the two refs into an array
          to loop over reads them during render, which is what
          react-hooks/refs is there to stop. */}
      <mesh ref={blobA} material={blobMaterials[0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[half * 1.5, 24]} />
      </mesh>
      <mesh ref={blobB} material={blobMaterials[1]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[half * 1.5, 24]} />
      </mesh>
      <mesh ref={a} material={materials} castShadow receiveShadow>
        <boxGeometry args={size} />
      </mesh>
      <mesh ref={b} material={materials} castShadow receiveShadow>
        <boxGeometry args={size} />
      </mesh>
    </>
  );
}

/** The dice at rest from the previous throw, so the table is never empty. */
function RestingDice({ animation }: { animation: RollAnimation | null }) {
  const materials = useDieMaterials();
  // Resting dice never move, so their blobs never change weight and one shared
  // material is right.
  const [blobMaterial] = useContactBlobs(1);
  const half = TABLE.dieHalf;
  if (!animation) return null;
  const frame = animation.frames[animation.restIndex];
  return (
    <>
      {([frame.a, frame.b] as const).map((pose, i) => (
        <mesh
          key={`blob-${i}`}
          material={blobMaterial}
          position={[pose.p[0], 0.015, pose.p[2]]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <circleGeometry args={[half * 1.5, 24]} />
        </mesh>
      ))}
      {([frame.a, frame.b] as const).map((pose, i) => (
        <mesh
          key={i}
          material={materials}
          position={pose.p}
          quaternion={new THREE.Quaternion(...pose.q)}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[half * 2, half * 2, half * 2]} />
        </mesh>
      ))}
    </>
  );
}

/**
 * Frames the world so the table fills the felt behind it.
 *
 * The camera is declared rather than aimed with lookAt: with no yaw or roll,
 * pointing at the table is a single pitch angle, and stating it as a prop keeps
 * this component from reaching in and mutating three's camera every resize.
 */
function Rig() {
  const size = useThree((s) => s.size);
  const aspect = size.width / Math.max(1, size.height);
  // Pull back on narrow windows so the throw never leaves the frame.
  const pullback = aspect < 1.9 ? 1.9 / Math.max(1.1, aspect) : 1;
  const y = 20.5 * pullback;
  const z = 14.5 * pullback;
  const target = 0.5;

  return (
    <PerspectiveCamera
      makeDefault
      fov={33}
      near={0.5}
      far={120}
      position={[0, y, z]}
      rotation={[-Math.atan2(y, z - target), 0, 0]}
    />
  );
}

export function DiceStage() {
  const animation = useGame((s) => s.animation);
  const rolling = useGame((s) => s.rolling);
  const settleDice = useGame((s) => s.settleDice);

  // The canvas measures its container on mount. If the surrounding flex layout
  // has not settled by then the observer can miss the first pass and leave the
  // drawing buffer at its 300x150 default, so nudge it once the frame is laid
  // out. Harmless if it already measured correctly.
  // A timer rather than requestAnimationFrame: rAF is suspended in a hidden or
  // throttled tab, which is exactly the case where the first measurement is
  // most likely to have been missed.
  React.useEffect(() => {
    const id = setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
    return () => clearTimeout(id);
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <Canvas
        // 'percentage' is PCFShadowMap. The softer default is deprecated in
        // this version of three and silently falls back to this anyway.
        shadows="percentage"
        /*
         * Deliberately 'always'. On-demand rendering would save an idle GPU
         * between throws, but flipping the mode after a throw settles left the
         * resting dice unrendered — the canvas stayed blank until the next
         * roll. Revisit only with a visual check, not just a green build.
         */
        frameloop="always"
        dpr={[1, 2]}
        gl={{ alpha: true, antialias: true }}
        style={{ pointerEvents: 'none', background: 'transparent' }}
      >
        <Rig />
        {/* Enough fill to read the pips in shadow, not so much that the
            crimson washes out to pink under the key light. */}
        <ambientLight intensity={0.42} />
        <hemisphereLight args={['#dff3e6', '#06301f', 0.32]} />
        <directionalLight
          position={[6, 18, 10]}
          intensity={1.75}
          castShadow
          shadow-mapSize={[1024, 1024]}
          shadow-camera-left={-14}
          shadow-camera-right={14}
          shadow-camera-top={10}
          shadow-camera-bottom={-10}
          shadow-bias={-0.0008}
        />
        <directionalLight position={[-10, 8, -6]} intensity={0.35} color="#ffe6b0" />
        {/* Bounce off the cloth. A die sitting on a green table picks up green
            along its lower edges, and without it the crimson reads as if the
            dice were photographed against nothing. */}
        <directionalLight position={[0, -6, 3]} intensity={0.3} color="#2f9c62" />

        {/* The whole box sits forward of centre so the dice land on the open
            felt below the box numbers rather than on top of them. */}
        <group position={[DICE_X_OFFSET, 0, DICE_Z_OFFSET]}>
          {/* Invisible floor that catches the dice shadow and nothing else. */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <planeGeometry args={[TABLE.halfX * 2, TABLE.halfZ * 2]} />
            <shadowMaterial opacity={0.42} />
          </mesh>

          {rolling && animation ? (
            <Dice animation={animation} onSettled={settleDice} />
          ) : (
            <RestingDice animation={animation} />
          )}
        </group>
      </Canvas>
    </div>
  );
}
