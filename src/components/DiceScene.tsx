import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { loadRapier, type Rapier } from '../lib/physics';
import { getUpwardFaceValue } from '../lib/faceDetection';
import {
  createD6Materials,
  disposeMaterials,
} from '../lib/diceFaceTextures';
import { buildFaceBakedDie, disposeFaceMaterials } from '../lib/dieFaceMaterials';
import {
  createPentagonalTrapezohedronGeometry,
  getPentagonalTrapezohedronVertices,
} from '../lib/d10Geometry';
import {
  resolveSceneTheme,
  type ResolvedSceneTheme,
} from '../lib/skins/sceneResolver';
import { diceAudio } from '../lib/audio/diceAudio';
import type { ThrowRequest } from '../hooks/useDiceRoller';
import type { SceneTheme } from '../types/skins';
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
  /** Called once a physical throw has settled and faces have been read.
   *  `token` is the throw's id at request time — the consumer should drop
   *  the result if it no longer matches the latest pending throw. */
  onResult: (
    diceType: DiceType,
    quantity: number,
    values: number[],
    token: number,
  ) => void;
  /**
   * Active skin's scene theme. Currently unused inside the scene — material
   * + lighting overrides are wired in a follow-up. The prop is part of the
   * public API now so consumers can pass it without breaking on upgrade.
   */
  sceneTheme?: SceneTheme | undefined;
}

interface SceneAPI {
  setResult: (result: RollResult | null) => void;
  setIsRolling: (rolling: boolean) => void;
  setThrowRequest: (request: ThrowRequest | null) => void;
  setOnResult: (cb: DiceSceneProps['onResult']) => void;
  /** Update lights + table/tray/dice materials when the active skin changes. */
  setSceneTheme: (theme: SceneTheme | undefined) => void;
  cleanup: () => void;
}

export function DiceScene({
  result,
  isRolling,
  throwRequest,
  onResult,
  sceneTheme,
}: DiceSceneProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<SceneAPI | null>(null);

  // Refs let the async init apply props that may have arrived before mount
  const latestResultRef = useRef<RollResult | null>(result);
  const latestIsRollingRef = useRef<boolean>(isRolling);
  const latestThrowRef = useRef<ThrowRequest | null>(throwRequest);
  const latestOnResultRef = useRef(onResult);
  const latestSceneThemeRef = useRef<SceneTheme | undefined>(sceneTheme);

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
        api = buildScene(mount, rapier, latestSceneThemeRef.current);
      } catch (err) {
        console.error('[Dicefall] buildScene failed, retrying without physics', err);
        api = buildScene(mount, null, latestSceneThemeRef.current);
      }
      // Re-check cancellation: the component may have unmounted during the
      // synchronous buildScene work (rare, but possible under HMR / Strict
      // Mode). If so, tear down the freshly-built scene immediately rather
      // than leaving a renderer + RAF + Rapier world dangling.
      if (cancelled) {
        api.cleanup();
        return;
      }
      // Wire teardown FIRST so even if a downstream setter throws, the
      // cleanup function still runs on unmount.
      teardown = api.cleanup;
      apiRef.current = api;
      api.setOnResult(latestOnResultRef.current);
      api.setResult(latestResultRef.current);
      api.setIsRolling(latestIsRollingRef.current);
      api.setThrowRequest(latestThrowRef.current);
    };
    init();

    return () => {
      cancelled = true;
      apiRef.current = null;
      teardown?.();
    };
  }, []);

  useEffect(() => {
    latestSceneThemeRef.current = sceneTheme;
    apiRef.current?.setSceneTheme(sceneTheme);
  }, [sceneTheme]);

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
// (per-die settle ceiling is computed from `DIE_RADIUS * 1.5` further down
//  the file, replacing the previous hand-tuned `SETTLE_MAX_Y = 0.8`.)
// If a die comes to rest on an edge / vertex with no clear upward face,
// give it a small kick and let physics resettle it. Up to 2 attempts.
// Nudges are intentionally tiny — just enough to topple, not enough to
// start the die spinning all over again.
const NUDGE_MAX = 2;
const NUDGE_IMPULSE_Y = 0.7;
const NUDGE_TORQUE_MAG = 0.25;

function buildScene(
  mount: HTMLDivElement,
  rapier: Rapier | null,
  initialTheme: SceneTheme | undefined,
): SceneAPI {
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

  // --- Skin-driven materials + lighting ---------------------------------
  // The resolver turns the SceneTheme's string IDs into concrete configs.
  // Materials and lights are constructed once here, then their `color` /
  // `intensity` / `position` are mutated in setSceneTheme when the skin
  // changes — no scene rebuild required.
  let resolved: ResolvedSceneTheme = resolveSceneTheme(initialTheme);

  const ambient = new THREE.AmbientLight(
    resolved.lighting.ambient.color,
    resolved.lighting.ambient.intensity,
  );
  scene.add(ambient);

  const hemi = new THREE.HemisphereLight(
    resolved.lighting.hemisphere.sky,
    resolved.lighting.hemisphere.ground,
    resolved.lighting.hemisphere.intensity,
  );
  scene.add(hemi);

  // Candle key light — warm pool from upper-left.
  const candle = new THREE.PointLight(
    resolved.lighting.key.color,
    resolved.lighting.key.intensity,
    24,
    1.2,
  );
  candle.position.copy(resolved.lighting.key.position);
  candle.castShadow = true;
  candle.shadow.mapSize.set(1024, 1024);
  candle.shadow.bias = -0.0008;
  candle.shadow.radius = 4;
  scene.add(candle);

  // Back-rim — picks out dice silhouettes from the dark surroundings.
  const rim = new THREE.PointLight(
    resolved.lighting.rim.color,
    resolved.lighting.rim.intensity,
    18,
    1.3,
  );
  rim.position.copy(resolved.lighting.rim.position);
  scene.add(rim);

  // Direct top fill so the leather + glyphs always have a wash to play off.
  const top = new THREE.DirectionalLight(
    resolved.lighting.top.color,
    resolved.lighting.top.intensity,
  );
  top.position.copy(resolved.lighting.top.position);
  scene.add(top);

  // --- Tabletop (extends past the camera frustum) ---
  const tableGeom = new THREE.PlaneGeometry(22, 20);
  const tableMat = new THREE.MeshStandardMaterial({
    color: resolved.table.color,
    roughness: resolved.table.roughness,
    metalness: resolved.table.metalness,
  });
  const table = new THREE.Mesh(tableGeom, tableMat);
  table.rotation.x = -Math.PI / 2;
  table.position.y = -0.06;
  table.receiveShadow = true;
  scene.add(table);

  // --- Dice tray: leather floor inside, wooden rails around ---
  const trayFloorGeom = new THREE.PlaneGeometry(4.2, 4.2);
  const trayFloorMat = new THREE.MeshStandardMaterial({
    color: resolved.trayFloor.color,
    roughness: resolved.trayFloor.roughness,
    metalness: resolved.trayFloor.metalness,
  });
  const trayFloor = new THREE.Mesh(trayFloorGeom, trayFloorMat);
  trayFloor.rotation.x = -Math.PI / 2;
  trayFloor.position.y = 0;
  trayFloor.receiveShadow = true;
  scene.add(trayFloor);

  const railMat = new THREE.MeshStandardMaterial({
    color: resolved.trayRail.color,
    roughness: resolved.trayRail.roughness,
    metalness: resolved.trayRail.metalness,
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

  // Most-recent throw token the scene has processed. Guards against the
  // same throwRequest being replayed into the scene (StrictMode mount, HMR
  // resume, init effect re-applying latestThrowRef.current after build).
  let lastAppliedThrowToken: number | null = null;

  // -------- physics-driven throw path --------
  const setThrowRequest: SceneAPI['setThrowRequest'] = (req) => {
    if (!req) {
      lastAppliedThrowToken = null;
      removeActiveThrow();
      return;
    }
    if (req.token === lastAppliedThrowToken) return;
    if (!physics) return; // no physics available; App will use legacy path
    lastAppliedThrowToken = req.token;

    removeActiveThrow();
    removeLegacy();

    const dice: ThrowDie[] = [];
    for (let i = 0; i < req.quantity; i++) {
      const d = createThrowDie(
        req.diceType,
        i,
        physics,
        resolved.dice.color,
        resolved.dice.roughness,
        resolved.dice.metalness,
      );
      scene.add(d.mesh);
      dice.push(d);
    }
    activeThrow = {
      request: req,
      dice,
      startTime: sceneTime,
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
        ? createLegacyPhysicsDie(result.diceType, positions[i]!, i, physics)
        : createTweenDie(result.diceType, positions[i]!, i);
      scene.add(die.mesh);
      legacyDice.push(die);
    }
  };

  const setIsRolling: SceneAPI['setIsRolling'] = (rolling) => {
    for (const d of legacyDice) d.setIsRolling(rolling);
  };

  // ---------- render loop ----------
  // Fixed-timestep accumulator. Physics steps at exactly 1/60 s regardless
  // of display refresh rate. Without this, settle detection fired ~2.4×
  // faster on a 144 Hz monitor (and arbitrarily on backgrounded tabs).
  // We cap subSteps per frame so a paused tab doesn't avalanche-step on
  // return.
  const FIXED_DT = 1 / 60;
  const MAX_SUBSTEPS = 5;
  let raf = 0;
  let accumulator = 0;
  let sceneTime = 0;
  const clock = new THREE.Clock();
  const animate = () => {
    const delta = Math.min(clock.getDelta(), 0.1);
    accumulator += delta;
    let subSteps = 0;
    while (accumulator >= FIXED_DT && subSteps < MAX_SUBSTEPS) {
      if (physics) physics.world.step();
      if (activeThrow) {
        for (const d of activeThrow.dice) d.tick();
      }
      sceneTime += FIXED_DT;
      accumulator -= FIXED_DT;
      subSteps++;
    }
    // Legacy decorative dice tween off render-frame delta, which is fine
    // for them — they don't depend on physics ticks.
    for (const d of legacyDice) d.tick(delta);

    if (activeThrow) {
      if (!activeThrow.committed) {
        const elapsed = sceneTime - activeThrow.startTime;
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
          // the rAF callback's render-side-effect window. The token is
          // captured here so a stale commit (after Clear or re-roll) can
          // be rejected by the consumer.
          Promise.resolve().then(() => {
            onResult(
              t.request.diceType,
              t.request.quantity,
              values,
              t.request.token,
            );
          });
        }
      }
    }

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

  // Mutate lights + materials in place when the active skin changes. Live
  // dice keep their previous colour (they'll get replaced on the next roll
  // anyway), but the table, tray, rails, and lighting re-tint instantly.
  const setSceneTheme: SceneAPI['setSceneTheme'] = (theme) => {
    const next = resolveSceneTheme(theme);
    resolved = next;
    ambient.color.setHex(next.lighting.ambient.color);
    ambient.intensity = next.lighting.ambient.intensity;
    hemi.color.setHex(next.lighting.hemisphere.sky);
    hemi.groundColor.setHex(next.lighting.hemisphere.ground);
    hemi.intensity = next.lighting.hemisphere.intensity;
    candle.color.setHex(next.lighting.key.color);
    candle.intensity = next.lighting.key.intensity;
    candle.position.copy(next.lighting.key.position);
    rim.color.setHex(next.lighting.rim.color);
    rim.intensity = next.lighting.rim.intensity;
    rim.position.copy(next.lighting.rim.position);
    top.color.setHex(next.lighting.top.color);
    top.intensity = next.lighting.top.intensity;
    top.position.copy(next.lighting.top.position);
    tableMat.color.setHex(next.table.color);
    tableMat.roughness = next.table.roughness;
    tableMat.metalness = next.table.metalness;
    trayFloorMat.color.setHex(next.trayFloor.color);
    trayFloorMat.roughness = next.trayFloor.roughness;
    trayFloorMat.metalness = next.trayFloor.metalness;
    railMat.color.setHex(next.trayRail.color);
    railMat.roughness = next.trayRail.roughness;
    railMat.metalness = next.trayRail.metalness;
  };

  return {
    setResult,
    setIsRolling,
    setThrowRequest,
    setOnResult,
    setSceneTheme,
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
  diceColor: number,
  diceRoughness: number,
  diceMetalness: number,
): ThrowDie {
  const { rapier, world } = physics;
  const rawGeom = createGeometry(type);

  // For non-D6 dice, rebuild the geometry with per-face groups + a per-face
  // materials array so each face actually shows its number. D6 keeps its
  // pip-baked BoxGeometry path.
  let geom: THREE.BufferGeometry;
  let materials: THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[];
  if (type === 'd6') {
    geom = rawGeom;
    materials = createD6Materials();
  } else {
    const bundle = buildFaceBakedDie(type, rawGeom);
    if (bundle) {
      geom = bundle.geom;
      materials = bundle.materials;
    } else {
      geom = rawGeom;
      materials = new THREE.MeshStandardMaterial({
        color: diceColor,
        roughness: diceRoughness,
        metalness: diceMetalness,
      });
    }
  }
  const mesh = new THREE.Mesh(geom, materials);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  // Throw kinematics — from the user's side of the tray (camera-facing,
  // +Z) inward (-Z), with random horizontal jitter and a good amount of
  // tumble. Dice are vertically staggered so multi-throws don't overlap
  // at spawn.
  const startX = (Math.random() - 0.5) * 1.8;
  const startY = 2.4 + index * 0.55;
  const startZ = 1.3 + (Math.random() - 0.5) * 0.4;

  // Throw kinematics tuned to settle within ~1.5s instead of spinning. The
  // initial spin is just enough to tumble the die over a couple times in
  // the air before it lands; the heavy angular damping + high friction
  // then catch the rotation as soon as the edges/faces touch the floor.
  const lvx = (Math.random() - 0.5) * 1.0;
  const lvy = 0.2 + Math.random() * 0.4;
  const lvz = -2.8 - Math.random() * 1.0;

  const bodyDesc = rapier.RigidBodyDesc.dynamic()
    .setTranslation(startX, startY, startZ)
    .setLinvel(lvx, lvy, lvz)
    .setAngvel({
      x: (Math.random() - 0.5) * 14,
      y: (Math.random() - 0.5) * 14,
      z: (Math.random() - 0.5) * 14,
    })
    .setLinearDamping(0.55)
    .setAngularDamping(1.4);
  // CCD intentionally off — at the throw speeds we use, the default
  // discrete collision step is plenty and CCD costs roughly 2× the
  // physics-step time per die. Re-enable per-die only if a dice gets
  // tunneling reports at higher speeds.

  const body = world.createRigidBody(bodyDesc);

  const colliderDesc = createColliderDesc(rapier, type)
    .setRestitution(0.18)
    .setFriction(0.95)
    .setDensity(1.8);
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
  // Per-die impact detection state. We compare the speed *and* vertical
  // velocity sign against the previous tick to decide when a hit just
  // happened. The diceAudio module throttles globally, so it's fine for
  // every die to call playClack() independently.
  let prevLinSpeed = Math.hypot(lvx, lvy, lvz);
  let prevLvy = lvy;

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

      // Impact heuristic — fires on either of two clean signals:
      //   (a) Vertical velocity sign flip from negative→positive while we
      //       still have meaningful downward speed: that's a floor bounce.
      //   (b) Large frame-over-frame speed loss (>35%) while moving fast:
      //       that's a wall or die-on-die hit.
      // `intensity` scales the clack with the impact magnitude so a light
      // graze sounds different from a heavy land.
      const HIT_MIN_SPEED = 1.0;
      const FLOOR_FLIP_THRESHOLD = -0.8;
      const SPEED_DROP_RATIO = 0.65;
      let impactStrength = 0;
      if (prevLvy < FLOOR_FLIP_THRESHOLD && lv.y > 0) {
        // Floor bounce — intensity from how hard the die was falling.
        impactStrength = Math.min(1, -prevLvy / 5);
      } else if (
        prevLinSpeed > HIT_MIN_SPEED &&
        lmag < prevLinSpeed * SPEED_DROP_RATIO
      ) {
        // Side/dice impact — intensity from speed differential.
        impactStrength = Math.min(1, (prevLinSpeed - lmag) / 4);
      }
      if (impactStrength > 0) diceAudio.playClack(impactStrength);
      prevLinSpeed = lmag;
      prevLvy = lv.y;

      // Per-die settle ceiling derived from bounding radius — D4/D20
      // resting on a face / leaning on a wall sit higher than D6 ever
      // does, so a single hand-tuned constant misclassified them as
      // "still bouncing". `radius × 1.5` covers leaning + a small margin.
      const yOk = t.y < DIE_RADIUS[type] * 1.5;
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
      world.removeRigidBody(body);
      geom.dispose();
      if (Array.isArray(materials)) {
        if (type === 'd6') {
          disposeMaterials(materials);
        } else {
          disposeFaceMaterials(materials);
        }
      } else {
        materials.dispose();
      }
    },
  };
}

/**
 * Lazily-built, module-scoped Float32Array per die type for the convex-hull
 * collider. The earlier implementation built fresh THREE geometries on
 * every die — 20 D20s = 20 IcosahedronGeometry allocs + 20 disposes per
 * roll. Rapier clones the buffer into WASM memory when it builds the hull,
 * so caching the source array is safe.
 */
const HULL_VERT_CACHE = new Map<DiceType, Float32Array>();

function getHullVerts(type: DiceType): Float32Array | null {
  const cached = HULL_VERT_CACHE.get(type);
  if (cached) return cached;
  let geom: THREE.BufferGeometry | null = null;
  switch (type) {
    case 'd4':
      geom = new THREE.TetrahedronGeometry(0.58);
      break;
    case 'd8':
      geom = new THREE.OctahedronGeometry(0.6);
      break;
    case 'd12':
      geom = new THREE.DodecahedronGeometry(0.55);
      break;
    case 'd20':
      geom = new THREE.IcosahedronGeometry(0.6);
      break;
    default:
      return null;
  }
  const pos = geom.attributes.position as THREE.BufferAttribute;
  const verts = new Float32Array(pos.array as ArrayLike<number>);
  geom.dispose();
  HULL_VERT_CACHE.set(type, verts);
  return verts;
}

function createColliderDesc(
  rapier: Rapier,
  type: DiceType,
): InstanceType<Rapier['ColliderDesc']> {
  if (type === 'd6') {
    return rapier.ColliderDesc.cuboid(0.375, 0.375, 0.375);
  }
  if (type === 'd10' || type === 'd100') {
    const verts = getPentagonalTrapezohedronVertices(0.6);
    return (
      rapier.ColliderDesc.convexHull(verts) ?? rapier.ColliderDesc.ball(0.55)
    );
  }
  const verts = getHullVerts(type);
  if (!verts) return rapier.ColliderDesc.ball(0.55);
  const fallbackRadius = type === 'd4' ? 0.45 : 0.55;
  return (
    rapier.ColliderDesc.convexHull(verts) ??
    rapier.ColliderDesc.ball(fallbackRadius)
  );
}

/** Approximate bounding radius per die — used to derive the per-die
 *  settle-Y ceiling so a leaning D20 or D4 isn't measured against D6's
 *  half-edge. */
const DIE_RADIUS: Record<DiceType, number> = {
  d4: 0.58,
  d6: 0.375,
  d8: 0.6,
  d10: 0.6,
  d12: 0.55,
  d20: 0.6,
  d100: 0.6,
};

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
    .setAngularDamping(0.55);
  // CCD off — see note in the throw-builder above.

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
