import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { loadRapier, type Rapier } from '../lib/physics';
import { getUpwardFaceValue } from '../lib/faceDetection';
import {
  createD6Materials,
  disposeMaterials,
} from '../lib/diceFaceTextures';
import { paintFaceDecals, disposeFaceDecals } from '../lib/diceFaceDecals';
import {
  createPentagonalTrapezohedronGeometry,
  getPentagonalTrapezohedronVertices,
} from '../lib/d10Geometry';
import type { ThrowRequest } from '../hooks/useDiceRoller';
import { DICE_FACES, type DiceType, type RollResult } from '../types/dice';

// ===========================================================================
// Public component
// ===========================================================================

interface DiceSceneProps {
  /** Legacy / RNG-driven path. Used when throwRequest is null. */
  result: RollResult | null;
  isRolling: boolean;
  /** Physics-driven path. When token changes, dice are thrown and detected. */
  throwRequest: ThrowRequest | null;
  /** Called once a physical throw has settled and faces have been read. */
  onResult: (diceType: DiceType, quantity: number, values: number[]) => void;
}

interface SceneAPI {
  setResult: (result: RollResult | null) => void;
  setIsRolling: (rolling: boolean) => void;
  setThrowRequest: (request: ThrowRequest | null) => void;
  setOnResult: (cb: DiceSceneProps['onResult']) => void;
  cleanup: () => void;
}

export function DiceScene({
  result,
  isRolling,
  throwRequest,
  onResult,
}: DiceSceneProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<SceneAPI | null>(null);

  // Refs let the async init apply props that may have arrived before mount
  const latestResultRef = useRef<RollResult | null>(result);
  const latestIsRollingRef = useRef<boolean>(isRolling);
  const latestThrowRef = useRef<ThrowRequest | null>(throwRequest);
  const latestOnResultRef = useRef(onResult);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let cancelled = false;
    let teardown: (() => void) | null = null;

    const init = async () => {
      let rapier: Rapier | null = null;
      try {
        rapier = await loadRapier();
      } catch (err) {
        console.warn('[Dicefall] Rapier failed to load', err);
      }
      if (cancelled) return;

      let api: SceneAPI;
      try {
        api = buildScene(mount, rapier);
      } catch (err) {
        console.error('[Dicefall] buildScene failed, retrying without physics', err);
        api = buildScene(mount, null);
      }
      apiRef.current = api;
      api.setOnResult(latestOnResultRef.current);
      api.setResult(latestResultRef.current);
      api.setIsRolling(latestIsRollingRef.current);
      api.setThrowRequest(latestThrowRef.current);
      teardown = api.cleanup;
    };
    init();

    return () => {
      cancelled = true;
      apiRef.current = null;
      teardown?.();
    };
  }, []);

  useEffect(() => {
    latestOnResultRef.current = onResult;
    apiRef.current?.setOnResult(onResult);
  }, [onResult]);

  useEffect(() => {
    latestResultRef.current = result;
    apiRef.current?.setResult(result);
  }, [result?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    latestIsRollingRef.current = isRolling;
    apiRef.current?.setIsRolling(isRolling);
  }, [isRolling]);

  useEffect(() => {
    latestThrowRef.current = throwRequest;
    apiRef.current?.setThrowRequest(throwRequest);
  }, [throwRequest?.token]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={mountRef} className="w-full h-full" />;
}

// ===========================================================================
// Scene factory
// ===========================================================================

interface PhysicsBundle {
  rapier: Rapier;
  world: InstanceType<Rapier['World']>;
  staticBodies: InstanceType<Rapier['RigidBody']>[];
  dispose: () => void;
}

type SettlementState =
  | 'rolling' // still moving or not yet near the table
  | 'settled' // at rest with a clear upward face
  | 'leaning' // at rest but the best face is ambiguous (~edge lean)
  | 'stuck'; // leaned and we've exhausted nudge attempts

interface ThrowDie {
  mesh: THREE.Mesh;
  body: InstanceType<Rapier['RigidBody']>;
  tick: () => void;
  settlementState: () => SettlementState;
  /** Pop the die with a small vertical impulse + random torque. Returns
   *  false if no nudges remain. */
  nudge: () => boolean;
  getFaceValue: () => number | null;
  dispose: () => void;
}

interface ActiveThrow {
  request: ThrowRequest;
  dice: ThrowDie[];
  startTime: number;
  committed: boolean;
}

interface LegacyDie {
  mesh: THREE.Mesh;
  tick: (delta: number) => void;
  setIsRolling: (rolling: boolean) => void;
  dispose: () => void;
}

const THROW_TIMEOUT_S = 7;
const SETTLE_FRAMES = 30; // ~0.5s at 60fps
const SETTLE_LIN_VEL = 0.05;
const SETTLE_ANG_VEL = 0.08;
// A die must be this close to the table to count as settled — prevents
// a die paused at the peak of a bounce from passing the velocity check.
const SETTLE_MAX_Y = 0.8;
// If a die comes to rest on an edge / vertex with no clear upward face,
// give it a small kick and let physics resettle it. Up to 2 attempts.
const NUDGE_MAX = 2;
const NUDGE_IMPULSE_Y = 1.2;
const NUDGE_TORQUE_MAG = 0.6;

function buildScene(mount: HTMLDivElement, rapier: Rapier | null): SceneAPI {
  // ---------- renderer / scene / camera / lights ----------
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  // Cinematic top-down angled camera per the tavern brief.
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(0, 5.5, 6.5);
  camera.lookAt(0, 0, 0);

  // --- Tavern lighting (cranked so the polished dice + gold engravings
  //     actually catch the room without going neon).
  scene.add(new THREE.AmbientLight(0xb88a5a, 0.65));
  scene.add(new THREE.HemisphereLight(0xbb8a5a, 0x1c0e08, 0.95));

  // Candle key light — bright amber pool from upper-left.
  const candle = new THREE.PointLight(0xffc890, 180, 24, 1.2);
  candle.position.set(-3.2, 4.6, 3.4);
  candle.castShadow = true;
  candle.shadow.mapSize.set(1024, 1024);
  candle.shadow.bias = -0.0008;
  candle.shadow.radius = 4;
  scene.add(candle);

  // Back-rim — picks out dice silhouettes from the dark wood.
  const rim = new THREE.PointLight(0xe2bc7a, 40, 18, 1.3);
  rim.position.set(2.8, 3.5, -3);
  scene.add(rim);

  // Direct top fill so the leather and gold decals always have a wash to
  // play off, instead of dropping into black on the candle's shadow side.
  const top = new THREE.DirectionalLight(0xffe2b0, 1.4);
  top.position.set(0.5, 8, 1);
  scene.add(top);

  // --- Tavern tabletop (dark walnut, extends past the camera frustum) ---
  const tableGeom = new THREE.PlaneGeometry(22, 20);
  const tableMat = new THREE.MeshStandardMaterial({
    color: 0x18100a,
    roughness: 0.92,
    metalness: 0.05,
  });
  const table = new THREE.Mesh(tableGeom, tableMat);
  table.rotation.x = -Math.PI / 2;
  table.position.y = -0.06;
  table.receiveShadow = true;
  scene.add(table);

  // --- Dice tray: leather floor inside, wooden rails around ---
  const trayFloorGeom = new THREE.PlaneGeometry(4.2, 4.2);
  const trayFloorMat = new THREE.MeshStandardMaterial({
    color: 0x1c0d06,
    roughness: 0.88,
    metalness: 0.02,
  });
  const trayFloor = new THREE.Mesh(trayFloorGeom, trayFloorMat);
  trayFloor.rotation.x = -Math.PI / 2;
  trayFloor.position.y = 0;
  trayFloor.receiveShadow = true;
  scene.add(trayFloor);

  // Wooden rail walls — walnut with a slight sheen on top edges.
  const railMat = new THREE.MeshStandardMaterial({
    color: 0x3b2114,
    roughness: 0.7,
    metalness: 0.08,
  });
  const railH = 0.35;
  const railT = 0.22;
  const inner = 2.1;
  const outer = inner + railT;
  // Two long rails (X-aligned, front & back) and two short rails (Z-aligned).
  const railNS = new THREE.BoxGeometry(outer * 2, railH, railT);
  const railEW = new THREE.BoxGeometry(railT, railH, outer * 2);
  const railNorth = new THREE.Mesh(railNS, railMat);
  railNorth.position.set(0, railH / 2, -inner - railT / 2);
  railNorth.castShadow = true;
  railNorth.receiveShadow = true;
  scene.add(railNorth);
  const railSouth = new THREE.Mesh(railNS, railMat);
  railSouth.position.set(0, railH / 2, inner + railT / 2);
  railSouth.castShadow = true;
  railSouth.receiveShadow = true;
  scene.add(railSouth);
  const railEast = new THREE.Mesh(railEW, railMat);
  railEast.position.set(inner + railT / 2, railH / 2, 0);
  railEast.castShadow = true;
  railEast.receiveShadow = true;
  scene.add(railEast);
  const railWest = new THREE.Mesh(railEW, railMat);
  railWest.position.set(-inner - railT / 2, railH / 2, 0);
  railWest.castShadow = true;
  railWest.receiveShadow = true;
  scene.add(railWest);

  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  mount.appendChild(renderer.domElement);

  const updateSize = () => {
    const w = mount.clientWidth;
    const h = mount.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  updateSize();
  const ro = new ResizeObserver(updateSize);
  ro.observe(mount);

  const physics: PhysicsBundle | null = rapier ? createPhysics(rapier) : null;

  // ---------- per-frame state ----------
  let activeThrow: ActiveThrow | null = null;
  let legacyDice: LegacyDie[] = [];
  let onResult: DiceSceneProps['onResult'] = () => {};

  const removeActiveThrow = () => {
    if (!activeThrow) return;
    for (const d of activeThrow.dice) {
      scene.remove(d.mesh);
      d.dispose();
    }
    activeThrow = null;
  };

  const removeLegacy = () => {
    for (const d of legacyDice) {
      scene.remove(d.mesh);
      d.dispose();
    }
    legacyDice = [];
  };

  const setOnResult: SceneAPI['setOnResult'] = (cb) => {
    onResult = cb;
  };

  // -------- physics-driven throw path --------
  const setThrowRequest: SceneAPI['setThrowRequest'] = (req) => {
    if (!req) {
      removeActiveThrow();
      return;
    }
    if (!physics) return; // no physics available; App will use legacy path

    removeActiveThrow();
    removeLegacy();

    const dice: ThrowDie[] = [];
    for (let i = 0; i < req.quantity; i++) {
      const d = createThrowDie(req.diceType, i, physics);
      scene.add(d.mesh);
      dice.push(d);
    }
    activeThrow = {
      request: req,
      dice,
      startTime: clock.elapsedTime,
      committed: false,
    };
  };

  // -------- legacy RNG-driven path (decorative tumble) --------
  const setResult: SceneAPI['setResult'] = (result) => {
    if (activeThrow) {
      // physics dice are the source of truth — ignore unless it's a clear
      if (result === null) {
        removeActiveThrow();
      }
      return;
    }
    removeLegacy();
    if (!result) return;
    const positions = computeGridPositions(result.individualResults.length);
    for (let i = 0; i < result.individualResults.length; i++) {
      const die = physics
        ? createLegacyPhysicsDie(result.diceType, positions[i], i, physics)
        : createTweenDie(result.diceType, positions[i], i);
      scene.add(die.mesh);
      legacyDice.push(die);
    }
  };

  const setIsRolling: SceneAPI['setIsRolling'] = (rolling) => {
    for (const d of legacyDice) d.setIsRolling(rolling);
  };

  // ---------- render loop ----------
  let raf = 0;
  const clock = new THREE.Clock();
  const animate = () => {
    const delta = Math.min(clock.getDelta(), 0.05);
    if (physics) physics.world.step();

    if (activeThrow) {
      for (const d of activeThrow.dice) d.tick();
      if (!activeThrow.committed) {
        const elapsed = clock.elapsedTime - activeThrow.startTime;
        // For each die, decide: rolling / settled / leaning / stuck.
        // - rolling: not ready
        // - settled: ready (clear face)
        // - leaning: not ready; apply a nudge and let physics resettle
        // - stuck: ready (no more nudges; result.may.be.null → RNG fallback)
        let allReady = true;
        for (const d of activeThrow.dice) {
          const s = d.settlementState();
          if (s === 'rolling') {
            allReady = false;
          } else if (s === 'leaning') {
            d.nudge();
            allReady = false;
          }
        }
        const timedOut = elapsed > THROW_TIMEOUT_S;
        if (allReady || timedOut) {
          const t = activeThrow; // capture for closures below
          t.committed = true;
          const faces = DICE_FACES[t.request.diceType];
          const values = t.dice.map((d) => {
            const v = d.getFaceValue();
            // ambiguous landing — fall back to a uniform random face so the
            // user still gets a result rather than a freeze.
            return v ?? Math.floor(Math.random() * faces) + 1;
          });
          // Defer to a microtask so React state updates don't run inside
          // the rAF callback's render-side-effect window.
          Promise.resolve().then(() => {
            onResult(t.request.diceType, t.request.quantity, values);
          });
        }
      }
    }

    for (const d of legacyDice) d.tick(delta);

    renderer.render(scene, camera);
    raf = requestAnimationFrame(animate);
  };
  raf = requestAnimationFrame(animate);

  const cleanup = () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    removeActiveThrow();
    removeLegacy();
    physics?.dispose();
    tableGeom.dispose();
    tableMat.dispose();
    trayFloorGeom.dispose();
    trayFloorMat.dispose();
    railNS.dispose();
    railEW.dispose();
    railMat.dispose();
    renderer.dispose();
    if (renderer.domElement.parentNode === mount) {
      mount.removeChild(renderer.domElement);
    }
  };

  return {
    setResult,
    setIsRolling,
    setThrowRequest,
    setOnResult,
    cleanup,
  };
}

// ===========================================================================
// Physics world setup
// ===========================================================================

function createPhysics(rapier: Rapier): PhysicsBundle {
  const world = new rapier.World({ x: 0, y: -16, z: 0 });
  const staticBodies: InstanceType<Rapier['RigidBody']>[] = [];

  const addStatic = (
    desc: InstanceType<Rapier['ColliderDesc']>,
    pos: { x: number; y: number; z: number },
  ) => {
    const body = world.createRigidBody(
      rapier.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z),
    );
    world.createCollider(desc.setRestitution(0.45).setFriction(0.55), body);
    staticBodies.push(body);
  };

  // Floor (thick so fast-moving dice can't tunnel)
  addStatic(rapier.ColliderDesc.cuboid(7, 0.25, 6), { x: 0, y: -0.25, z: 0 });

  // Walls — same camera-fit bounds as before
  const wallH = 2.5;
  const wallT = 0.1;
  const wx = 2.1;
  const wz = 2.1;
  addStatic(rapier.ColliderDesc.cuboid(wallT, wallH, wz), { x: -wx, y: wallH, z: 0 });
  addStatic(rapier.ColliderDesc.cuboid(wallT, wallH, wz), { x: wx, y: wallH, z: 0 });
  addStatic(rapier.ColliderDesc.cuboid(wx, wallH, wallT), { x: 0, y: wallH, z: -wz });
  addStatic(rapier.ColliderDesc.cuboid(wx, wallH, wallT), { x: 0, y: wallH, z: wz });

  return {
    rapier,
    world,
    staticBodies,
    dispose() {
      world.free();
    },
  };
}

// ===========================================================================
// Throw die (physics-driven, face-detected)
// ===========================================================================

function createThrowDie(
  type: DiceType,
  index: number,
  physics: PhysicsBundle,
): ThrowDie {
  const { rapier, world } = physics;
  const geom = createGeometry(type);
  // Polished black tavern dice. Gold detail comes from the face decals/pips.
  // Slightly elevated base color + lower roughness so the candle highlights
  // skate across each facet rather than disappearing into matte black.
  const materials: THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[] =
    type === 'd6'
      ? createD6Materials()
      : new THREE.MeshStandardMaterial({
          color: 0x201612,
          roughness: 0.28,
          metalness: 0.55,
        });
  const mesh = new THREE.Mesh(geom, materials);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  // Paint each face's actual number onto the geometry. Skipped for D6
  // (which has pips baked into its per-face materials).
  const decals = paintFaceDecals(mesh, type, geom);

  // Throw kinematics — from the user's side of the tray (camera-facing,
  // +Z) inward (-Z), with random horizontal jitter and a good amount of
  // tumble. Dice are vertically staggered so multi-throws don't overlap
  // at spawn.
  const startX = (Math.random() - 0.5) * 1.8;
  const startY = 2.4 + index * 0.55;
  const startZ = 1.3 + (Math.random() - 0.5) * 0.4;

  // Slightly slower throw + less angular velocity = weightier, more "real"
  // dice that thunk into the table instead of skittering.
  const lvx = (Math.random() - 0.5) * 1.2;
  const lvy = 0.2 + Math.random() * 0.4;
  const lvz = -3.0 - Math.random() * 1.2;

  const bodyDesc = rapier.RigidBodyDesc.dynamic()
    .setTranslation(startX, startY, startZ)
    .setLinvel(lvx, lvy, lvz)
    .setAngvel({
      x: (Math.random() - 0.5) * 22,
      y: (Math.random() - 0.5) * 22,
      z: (Math.random() - 0.5) * 22,
    })
    .setLinearDamping(0.35)
    .setAngularDamping(0.55)
    .setCcdEnabled(true);

  const body = world.createRigidBody(bodyDesc);

  const colliderDesc = createColliderDesc(rapier, type)
    .setRestitution(0.22)
    .setFriction(0.7)
    .setDensity(1.6);
  world.createCollider(colliderDesc, body);

  // sync first frame
  {
    const t = body.translation();
    const r = body.rotation();
    mesh.position.set(t.x, t.y, t.z);
    mesh.quaternion.set(r.x, r.y, r.z, r.w);
  }

  let settledFrames = 0;
  let nudgeAttempts = 0;

  return {
    mesh,
    body,
    tick() {
      const t = body.translation();
      const r = body.rotation();
      mesh.position.set(t.x, t.y, t.z);
      mesh.quaternion.set(r.x, r.y, r.z, r.w);

      const lv = body.linvel();
      const av = body.angvel();
      const lmag = Math.hypot(lv.x, lv.y, lv.z);
      const amag = Math.hypot(av.x, av.y, av.z);
      const yOk = t.y < SETTLE_MAX_Y;
      if (yOk && lmag < SETTLE_LIN_VEL && amag < SETTLE_ANG_VEL) {
        settledFrames++;
      } else {
        settledFrames = 0;
      }
    },
    settlementState() {
      if (settledFrames < SETTLE_FRAMES) return 'rolling';
      const v = getUpwardFaceValue(body.rotation(), type);
      if (v !== null) return 'settled';
      return nudgeAttempts >= NUDGE_MAX ? 'stuck' : 'leaning';
    },
    nudge() {
      if (nudgeAttempts >= NUDGE_MAX) return false;
      nudgeAttempts++;
      settledFrames = 0;
      body.applyImpulse({ x: 0, y: NUDGE_IMPULSE_Y, z: 0 }, true);
      body.applyTorqueImpulse(
        {
          x: (Math.random() - 0.5) * NUDGE_TORQUE_MAG * 2,
          y: (Math.random() - 0.5) * NUDGE_TORQUE_MAG * 2,
          z: (Math.random() - 0.5) * NUDGE_TORQUE_MAG * 2,
        },
        true,
      );
      return true;
    },
    getFaceValue() {
      return getUpwardFaceValue(body.rotation(), type);
    },
    dispose() {
      disposeFaceDecals(decals);
      world.removeRigidBody(body);
      geom.dispose();
      if (Array.isArray(materials)) {
        disposeMaterials(materials);
      } else {
        materials.dispose();
      }
    },
  };
}

function createColliderDesc(
  rapier: Rapier,
  type: DiceType,
): InstanceType<Rapier['ColliderDesc']> {
  switch (type) {
    case 'd4':
      return rapier.ColliderDesc.ball(0.45);
    case 'd6':
      return rapier.ColliderDesc.cuboid(0.375, 0.375, 0.375);
    case 'd10':
    case 'd100': {
      // Real pentagonal-trapezohedron hull so dice can actually rest on a face.
      const verts = getPentagonalTrapezohedronVertices(0.6);
      const hull = rapier.ColliderDesc.convexHull(verts);
      return hull ?? rapier.ColliderDesc.ball(0.55);
    }
    case 'd8':
    case 'd12':
    case 'd20':
      return rapier.ColliderDesc.ball(0.55);
  }
}

// ===========================================================================
// Legacy decorative dice (RNG path, kept for D10 / D100)
// ===========================================================================

function createLegacyPhysicsDie(
  type: DiceType,
  targetPos: [number, number, number],
  index: number,
  physics: PhysicsBundle,
): LegacyDie {
  const { rapier, world } = physics;
  const geom = createGeometry(type);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xe8d4a8,
    roughness: 0.42,
    metalness: 0.18,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  void targetPos;
  const startX = (Math.random() - 0.5) * 1.6;
  const startY = 3.2 + index * 0.55;
  const startZ = (Math.random() - 0.5) * 1.6;

  const bodyDesc = rapier.RigidBodyDesc.dynamic()
    .setTranslation(startX, startY, startZ)
    .setLinvel((Math.random() - 0.5) * 2.5, -1.5, (Math.random() - 0.5) * 2.5)
    .setAngvel({
      x: (Math.random() - 0.5) * 16,
      y: (Math.random() - 0.5) * 16,
      z: (Math.random() - 0.5) * 16,
    })
    .setLinearDamping(0.4)
    .setAngularDamping(0.55)
    .setCcdEnabled(true);

  const body = world.createRigidBody(bodyDesc);
  const colliderDesc = createColliderDesc(rapier, type)
    .setRestitution(0.35)
    .setFriction(0.5)
    .setDensity(1.0);
  world.createCollider(colliderDesc, body);

  {
    const t = body.translation();
    const r = body.rotation();
    mesh.position.set(t.x, t.y, t.z);
    mesh.quaternion.set(r.x, r.y, r.z, r.w);
  }

  let isRolling = true;
  let dampingApplied = false;

  return {
    mesh,
    tick() {
      const t = body.translation();
      const r = body.rotation();
      mesh.position.set(t.x, t.y, t.z);
      mesh.quaternion.set(r.x, r.y, r.z, r.w);
      if (!isRolling && !dampingApplied) {
        body.setLinearDamping(3.5);
        body.setAngularDamping(4.0);
        dampingApplied = true;
      }
    },
    setIsRolling(r) {
      isRolling = r;
    },
    dispose() {
      world.removeRigidBody(body);
      geom.dispose();
      mat.dispose();
    },
  };
}

function createTweenDie(
  type: DiceType,
  targetPos: [number, number, number],
  index: number,
): LegacyDie {
  const geom = createGeometry(type);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xe8d4a8,
    roughness: 0.42,
    metalness: 0.18,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const startPos: [number, number, number] = [
    targetPos[0] + (Math.random() - 0.5) * 3,
    3 + Math.random() * 1.5,
    targetPos[2] + (Math.random() - 0.5) * 1.5,
  ];
  mesh.position.set(...startPos);
  mesh.scale.setScalar(0);

  const spinAxis = randomUnitAxis();
  const spinSpeed = 14 + Math.random() * 6;
  const stagger = Math.min(index * 0.05, 0.25);

  let elapsed = -stagger;
  let isRolling = true;

  return {
    mesh,
    tick(delta) {
      if (!isRolling) {
        mesh.position.set(targetPos[0], targetPos[1], targetPos[2]);
        mesh.scale.setScalar(1);
        return;
      }
      elapsed += delta;
      if (elapsed < 0) {
        mesh.position.set(startPos[0], startPos[1], startPos[2]);
        mesh.scale.setScalar(0);
        return;
      }
      const t = Math.min(elapsed / 1.2, 1);
      const ease = easeOutBack(t);
      mesh.position.set(
        lerp(startPos[0], targetPos[0], ease),
        lerp(startPos[1], targetPos[1], ease),
        lerp(startPos[2], targetPos[2], ease),
      );
      const spinFactor = (1 - t * 0.92) * spinSpeed * delta;
      mesh.rotation.x += spinFactor * spinAxis[0];
      mesh.rotation.y += spinFactor * spinAxis[1];
      mesh.rotation.z += spinFactor * spinAxis[2];
      const scale = Math.min(elapsed / 0.15, 1);
      mesh.scale.setScalar(scale);
    },
    setIsRolling(r) {
      isRolling = r;
    },
    dispose() {
      geom.dispose();
      mat.dispose();
    },
  };
}

// ===========================================================================
// Shared helpers
// ===========================================================================

function createGeometry(type: DiceType): THREE.BufferGeometry {
  switch (type) {
    case 'd4':
      return new THREE.TetrahedronGeometry(0.58);
    case 'd6':
      return new THREE.BoxGeometry(0.75, 0.75, 0.75);
    case 'd8':
      return new THREE.OctahedronGeometry(0.6);
    case 'd10':
    case 'd100':
      return createPentagonalTrapezohedronGeometry(0.6);
    case 'd12':
      return new THREE.DodecahedronGeometry(0.55);
    case 'd20':
      return new THREE.IcosahedronGeometry(0.6);
  }
}

function computeGridPositions(count: number): [number, number, number][] {
  if (count === 0) return [];
  const cols = Math.min(count, 5);
  const rows = Math.ceil(count / cols);
  const spacing = 1.3;
  const startX = -((cols - 1) / 2) * spacing;
  const startZ = -((rows - 1) / 2) * spacing;
  const positions: [number, number, number][] = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    positions.push([startX + col * spacing, 0.45, startZ + row * spacing]);
  }
  return positions;
}

function randomUnitAxis(): [number, number, number] {
  const x = Math.random() - 0.5;
  const y = Math.random() - 0.5;
  const z = Math.random() - 0.5;
  const len = Math.sqrt(x * x + y * y + z * z) || 1;
  return [x / len, y / len, z / len];
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function easeOutBack(t: number) {
  const c1 = 1.15;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
