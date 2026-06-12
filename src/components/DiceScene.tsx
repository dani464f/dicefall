import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { loadRapier, type Rapier } from '../lib/physics';
import { getUpwardFaceValue } from '../lib/faceDetection';
import { createD6Materials } from '../lib/diceFaceTextures';
import { buildFaceBakedDie } from '../lib/dieFaceMaterials';
import {
  createPentagonalTrapezohedronGeometry,
  getPentagonalTrapezohedronVertices,
} from '../lib/d10Geometry';
import {
  resolveSceneTheme,
  type ResolvedSceneTheme,
  type SurfaceTextureSet,
} from '../lib/skins/sceneResolver';
import { diceAudio } from '../lib/audio/diceAudio';
import { diceHaptics } from '../lib/haptics/diceHaptics';
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
  /** Tear down and recreate the four wall colliders at ±inner. Called when
   *  the tray resizes for a bigger throw; the floor is oversized already
   *  and never moves. */
  rebuildWalls: (inner: number) => void;
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
  /** Called once per physics step. `siblings` is the full active-throw
   *  list (including this die); used to classify impacts as die-on-die
   *  vs floor/wall so the right audio voice plays. */
  tick: (siblings: ThrowDie[]) => void;
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
  /** True while this die still needs simulation/animation frames — used by
   *  the render loop to decide whether it can idle the physics world and
   *  skip redrawing a static scene. */
  isActive: () => boolean;
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

// ---------------------------------------------------------------------------
// Shared texture cache — surfaces (and the backdrop) reuse loaded textures
// across scene rebuilds (StrictMode double-mount, skin switches). Never
// disposed; total GPU residency is a few MB.
// ---------------------------------------------------------------------------
const TEXTURE_CACHE = new Map<string, THREE.Texture>();

function getCachedTexture(
  url: string,
  srgb: boolean,
  onLoad: () => void,
): THREE.Texture {
  const key = `${url}|${srgb ? 's' : 'l'}`;
  const cached = TEXTURE_CACHE.get(key);
  if (cached) return cached;
  const tex = new THREE.TextureLoader().load(url, onLoad, undefined, () => {
    // 404 / decode failure — leave the material flat-colored. The console
    // notes it; the scene must never crash over a missing map.
    console.warn(`[DiceScene] texture failed to load: ${url}`);
  });
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  TEXTURE_CACHE.set(key, tex);
  return tex;
}

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
  // Filmic tone mapping is the single biggest "game engine" signal — it
  // rolls highlights off gently (candle glints stop clipping to white)
  // and deepens the shadow floor. Light intensities below are tuned FOR
  // this curve; changing the mapping means re-tuning them.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;

  const scene = new THREE.Scene();
  // A whisper of warm-black fog seats the table into the backdrop and
  // swallows the table plane's far edge. Backdrop plane opts out (fog:
  // false on its material) so the painted image stays unfogged.
  scene.fog = new THREE.Fog(0x070402, 10, 26);

  // ---------- on-demand rendering (declared early — async texture/HDRI
  // loads arriving later need to dirty the frame) ----------
  // The scene is fully static between dice movements, so re-rendering
  // identical frames at 60 fps just burns GPU/battery. `renderPending`
  // counts down to 0 and the loop skips rendering until something dirties
  // the scene again. 2 frames per dirty event so changes landing between
  // RAF ticks (resize buffer swap, material mutation) settle visibly.
  let renderPending = 3;
  const requestRender = () => {
    if (renderPending < 2) renderPending = 2;
  };
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

  // --- Image-based lighting -------------------------------------------------
  // A 1K warm interior HDRI (billiard hall — dark room, bright tungsten
  // lamps) feeds scene.environment via PMREM. This is what makes the
  // lacquered dice GLINT as they tumble: high-contrast warm hotspots
  // reflected in the clearcoat. Per-skin strength via envIntensity.
  let sceneDisposed = false;
  scene.environmentIntensity = resolved.lighting.envIntensity;
  {
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    new HDRLoader().load(
      '/hdri/billiard_hall_1k.hdr',
      (hdrTex) => {
        if (sceneDisposed) {
          hdrTex.dispose();
          pmrem.dispose();
          return;
        }
        const envMap = pmrem.fromEquirectangular(hdrTex).texture;
        scene.environment = envMap;
        hdrTex.dispose();
        pmrem.dispose();
        requestRender();
      },
      undefined,
      () => {
        // HDRI missing → lights-only. Darker but fully functional.
        console.warn('[DiceScene] HDRI failed to load; IBL disabled');
        pmrem.dispose();
      },
    );
  }

  /** Apply (or clear) a surface's PBR texture set. Map presence changes
   *  require a shader recompile — hence needsUpdate. */
  const applySurfaceTextures = (
    mat: THREE.MeshStandardMaterial,
    textures: SurfaceTextureSet | undefined,
  ) => {
    if (textures) {
      const map = getCachedTexture(textures.map, true, requestRender);
      map.repeat.set(textures.repeat[0], textures.repeat[1]);
      mat.map = map;
      if (textures.normalMap) {
        const nor = getCachedTexture(textures.normalMap, false, requestRender);
        nor.repeat.set(textures.repeat[0], textures.repeat[1]);
        mat.normalMap = nor;
      } else {
        mat.normalMap = null;
      }
      if (textures.roughnessMap) {
        const rgh = getCachedTexture(
          textures.roughnessMap,
          false,
          requestRender,
        );
        rgh.repeat.set(textures.repeat[0], textures.repeat[1]);
        mat.roughnessMap = rgh;
      } else {
        mat.roughnessMap = null;
      }
    } else {
      mat.map = null;
      mat.normalMap = null;
      mat.roughnessMap = null;
    }
    mat.needsUpdate = true;
  };

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

  // --- Painted backdrop (Higgsfield tavern plate) ---
  // Mounted on a large plane behind the table. Camera direction is fixed
  // (only distance changes on tray resize) so a static plane reads
  // correctly at every framing. fog:false — the painting carries its own
  // depth; toneMapped:false — the plate is pre-graded.
  {
    new THREE.TextureLoader().load(
      '/backdrop/tavern.webp',
      (tex) => {
        if (sceneDisposed) {
          tex.dispose();
          return;
        }
        tex.colorSpace = THREE.SRGBColorSpace;
        const backdropGeom = new THREE.PlaneGeometry(38, 21.4);
        const backdropMat = new THREE.MeshBasicMaterial({
          map: tex,
          fog: false,
          toneMapped: false,
        });
        const backdrop = new THREE.Mesh(backdropGeom, backdropMat);
        backdrop.position.set(0, 7.5, -12);
        scene.add(backdrop);
        requestRender();
      },
      undefined,
      () => {
        // No backdrop asset → the fogged void. Fine.
      },
    );
  }

  // --- Tabletop (extends past the camera frustum) ---
  const tableGeom = new THREE.PlaneGeometry(22, 20);
  const tableMat = new THREE.MeshStandardMaterial({
    color: resolved.table.color,
    roughness: resolved.table.roughness,
    metalness: resolved.table.metalness,
  });
  applySurfaceTextures(tableMat, resolved.table.textures);
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
  applySurfaceTextures(trayFloorMat, resolved.trayFloor.textures);
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
  applySurfaceTextures(railMat, resolved.trayRail.textures);
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
    requestRender();
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
    requestRender();
  };

  const removeLegacy = () => {
    for (const d of legacyDice) {
      scene.remove(d.mesh);
      d.dispose();
    }
    legacyDice = [];
    requestRender();
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

    // Size the tray to the throw BEFORE spawning — dice spawn relative to
    // the new bounds. Resizing only ever happens here, with the tray
    // empty, so settled dice are never caught outside a shrinking wall.
    applyTrayLayout(trayInnerFor(req.quantity));

    const dice: ThrowDie[] = [];
    for (let i = 0; i < req.quantity; i++) {
      const d = createThrowDie(
        req.diceType,
        i,
        req.quantity,
        physics,
        resolved.dice.color,
        resolved.dice.roughness,
        resolved.dice.metalness,
        trayInner,
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
    requestRender();
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
    requestRender();
  };

  const setIsRolling: SceneAPI['setIsRolling'] = (rolling) => {
    for (const d of legacyDice) d.setIsRolling(rolling);
    requestRender();
  };

  // ---------- dynamic tray sizing ----------
  // The tray itself grows with the throw size so a fistful of dice has
  // floor room to spread out instead of piling into a heap (the camera
  // stays put — it's re-positioned ONCE per resize, instantly, so there is
  // no in-play camera motion). Visual floor + rails scale in place; the
  // physics walls are rebuilt at the matching bounds.
  const TRAY_BASE_INNER = 2.1;
  const TRAY_MAX_INNER = 3.4;
  const RAIL_T = 0.22;
  const CAM_BASE_POS = new THREE.Vector3(0, 5.5, 6.5);
  let trayInner = TRAY_BASE_INNER;

  /** Tray half-width needed for a given dice count. ≤4 dice use the
   *  classic 4.2-unit tray; beyond that each extra die buys ~0.16 units of
   *  half-width, capped so the biggest tray still sits inside the table. */
  const trayInnerFor = (quantity: number): number =>
    THREE.MathUtils.clamp(
      TRAY_BASE_INNER + Math.max(0, quantity - 4) * 0.16,
      TRAY_BASE_INNER,
      TRAY_MAX_INNER,
    );

  const applyTrayLayout = (inner: number) => {
    if (inner === trayInner) return;
    trayInner = inner;
    const s = inner / TRAY_BASE_INNER;
    // Floor plane: geometry is 4.2×4.2 in XY (rotated flat) — uniform
    // scale tracks the new side length.
    trayFloor.scale.set(s, s, 1);
    // Rails: stretch along their long axis, re-seat at the new bounds.
    const baseOuter = TRAY_BASE_INNER + RAIL_T;
    const newOuter = inner + RAIL_T;
    const railScale = newOuter / baseOuter;
    railNorth.scale.x = railScale;
    railSouth.scale.x = railScale;
    railNorth.position.z = -inner - RAIL_T / 2;
    railSouth.position.z = inner + RAIL_T / 2;
    railEast.scale.z = railScale;
    railWest.scale.z = railScale;
    railEast.position.x = inner + RAIL_T / 2;
    railWest.position.x = -inner - RAIL_T / 2;
    // Physics walls follow the visuals exactly.
    physics?.rebuildWalls(inner);
    // One instant camera framing per resize — scaled along the same
    // cinematic direction so the whole tray stays in frame. This is a
    // set, not an animation: between rolls of the same size nothing
    // moves at all.
    camera.position.copy(CAM_BASE_POS).multiplyScalar(s);
    camera.lookAt(0, 0, 0);
    requestRender();
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

    // ---- simulation gating ----
    // Rapier auto-sleeps bodies at rest. Once a throw is committed and all
    // its bodies sleep (we force-sleep settled dice at commit), stepping
    // the world is pure waste — nothing can move again until a new throw
    // wakes it. Same for legacy dice. While a throw is in flight
    // (uncommitted) we always step, so settle/timeout logic is unaffected.
    const throwNeedsSim =
      activeThrow !== null &&
      (!activeThrow.committed ||
        activeThrow.dice.some((d) => !d.body.isSleeping()));
    const legacyNeedsSim = legacyDice.some((d) => d.isActive());
    const needsSim = (throwNeedsSim || legacyNeedsSim) && physics !== null;
    // Tween dice (no-physics fallback) animate without the world.
    const tweenAnimating = physics === null && legacyNeedsSim;

    let subSteps = 0;
    if (needsSim) {
      accumulator += delta;
      while (accumulator >= FIXED_DT && subSteps < MAX_SUBSTEPS) {
        physics!.world.step();
        if (activeThrow) {
          for (const d of activeThrow.dice) d.tick(activeThrow.dice);
        }
        sceneTime += FIXED_DT;
        accumulator -= FIXED_DT;
        subSteps++;
      }
    } else {
      // Drop banked time so waking from idle doesn't avalanche-step.
      accumulator = 0;
    }
    // Legacy decorative dice tween off render-frame delta, which is fine
    // for them — they don't depend on physics ticks. Cheap no-op when
    // they're already at rest.
    for (const d of legacyDice) d.tick(delta);

    if (subSteps > 0 || tweenAnimating || legacyNeedsSim) {
      requestRender();
    }

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
          // Force already-settled bodies to sleep so the sim-gating check
          // above can idle the world deterministically instead of waiting
          // out Rapier's own sleep timer. A timed-out die that's still
          // tumbling is left awake — freezing it mid-air would be visible.
          for (const d of t.dice) {
            if (d.settlementState() !== 'rolling') d.body.sleep();
          }
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

    if (renderPending > 0) {
      renderer.render(scene, camera);
      renderPending--;
    }
    raf = requestAnimationFrame(animate);
  };
  raf = requestAnimationFrame(animate);

  const cleanup = () => {
    sceneDisposed = true;
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
    applySurfaceTextures(tableMat, next.table.textures);
    trayFloorMat.color.setHex(next.trayFloor.color);
    trayFloorMat.roughness = next.trayFloor.roughness;
    trayFloorMat.metalness = next.trayFloor.metalness;
    applySurfaceTextures(trayFloorMat, next.trayFloor.textures);
    railMat.color.setHex(next.trayRail.color);
    railMat.roughness = next.trayRail.roughness;
    railMat.metalness = next.trayRail.metalness;
    applySurfaceTextures(railMat, next.trayRail.textures);
    scene.environmentIntensity = next.lighting.envIntensity;
    requestRender();
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
  let wallBodies: InstanceType<Rapier['RigidBody']>[] = [];

  const addStatic = (
    desc: InstanceType<Rapier['ColliderDesc']>,
    pos: { x: number; y: number; z: number },
    into: InstanceType<Rapier['RigidBody']>[],
  ) => {
    const body = world.createRigidBody(
      rapier.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z),
    );
    world.createCollider(desc.setRestitution(0.45).setFriction(0.55), body);
    into.push(body);
  };

  // Floor (thick so fast-moving dice can't tunnel; oversized so it covers
  // every tray size the layout can request)
  addStatic(
    rapier.ColliderDesc.cuboid(7, 0.25, 6),
    { x: 0, y: -0.25, z: 0 },
    staticBodies,
  );

  const buildWalls = (inner: number) => {
    const wallH = 2.5;
    const wallT = 0.1;
    addStatic(
      rapier.ColliderDesc.cuboid(wallT, wallH, inner),
      { x: -inner, y: wallH, z: 0 },
      wallBodies,
    );
    addStatic(
      rapier.ColliderDesc.cuboid(wallT, wallH, inner),
      { x: inner, y: wallH, z: 0 },
      wallBodies,
    );
    addStatic(
      rapier.ColliderDesc.cuboid(inner, wallH, wallT),
      { x: 0, y: wallH, z: -inner },
      wallBodies,
    );
    addStatic(
      rapier.ColliderDesc.cuboid(inner, wallH, wallT),
      { x: 0, y: wallH, z: inner },
      wallBodies,
    );
  };
  buildWalls(2.1);

  return {
    rapier,
    world,
    staticBodies,
    rebuildWalls(inner: number) {
      for (const b of wallBodies) world.removeRigidBody(b);
      wallBodies = [];
      buildWalls(inner);
    },
    dispose() {
      world.free();
    },
  };
}

// ===========================================================================
// Throw die (physics-driven, face-detected)
// ===========================================================================

/**
 * Module-scope shared visuals — one geometry + materials set per die type,
 * shared by every mesh of that type for the app lifetime (three.js supports
 * sharing both across meshes; each mesh carries its own transform).
 *
 * Why: the face-baked build is the most expensive part of a throw. Per die
 * it ran toNonIndexed(), allocated a fresh UV Float32Array, created one
 * geometry group per triangle, and one MeshStandardMaterial per face —
 * a 6×D20 throw allocated 6 geometries + 120 materials, then disposed all
 * of it on the next Clear. The visuals are identical for every die of a
 * type (face textures were already cached), so build once and share.
 *
 * Skin caveat: the face-baked path bakes fixed DIE_BG / DIE_INK colours and
 * ignores the per-skin dice colour (only the non-baked fallback uses it),
 * so this cache needs no skin key today. If a future skin re-tints baked
 * dice faces, key this map by `${type}:${skinId}` and dispose on evict.
 */
const DIE_VISUAL_CACHE = new Map<
  DiceType,
  {
    geom: THREE.BufferGeometry;
    materials: THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[];
  }
>();

function getSharedDieVisual(type: DiceType): {
  geom: THREE.BufferGeometry;
  materials: THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[];
} | null {
  const cached = DIE_VISUAL_CACHE.get(type);
  if (cached) return cached;
  const rawGeom = createGeometry(type);
  if (type === 'd6') {
    // Pip-baked BoxGeometry path; materials are themselves module-shared
    // inside diceFaceTextures.
    const visual = { geom: rawGeom, materials: createD6Materials() };
    DIE_VISUAL_CACHE.set(type, visual);
    return visual;
  }
  const bundle = buildFaceBakedDie(type, rawGeom);
  if (!bundle) return null; // caller falls back to per-die plain material
  const visual = { geom: bundle.geom, materials: bundle.materials };
  DIE_VISUAL_CACHE.set(type, visual);
  return visual;
}

function createThrowDie(
  type: DiceType,
  index: number,
  quantity: number,
  physics: PhysicsBundle,
  diceColor: number,
  diceRoughness: number,
  diceMetalness: number,
  trayInner: number,
): ThrowDie {
  const { rapier, world } = physics;

  // Shared geometry + materials per die type (see DIE_VISUAL_CACHE). The
  // fallback below only triggers if a face table is missing — every current
  // die type has one, but keep the path so a future die ships safe.
  let geom: THREE.BufferGeometry;
  let materials: THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[];
  let ownsVisual = false;
  const sharedVisual = getSharedDieVisual(type);
  if (sharedVisual) {
    geom = sharedVisual.geom;
    materials = sharedVisual.materials;
  } else {
    // No face table for this type — plain skin-tinted material, owned by
    // this die and disposed with it.
    ownsVisual = true;
    geom = createGeometry(type);
    materials = new THREE.MeshStandardMaterial({
      color: diceColor,
      roughness: diceRoughness,
      metalness: diceMetalness,
    });
  }
  const mesh = new THREE.Mesh(geom, materials);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  // Throw kinematics — from the user's side of the tray (camera-facing,
  // +Z) inward (-Z). Dice spawn in round-robin lanes spread across the
  // tray width (instead of one random column) so multi-dice throws land
  // distributed rather than piling into a single heap, and are vertically
  // staggered so they don't overlap at spawn. Lane span and the spawn
  // line both scale with the tray, which grows with the throw size.
  const laneCount = Math.min(quantity, 5);
  const lane = index % laneCount;
  const laneSpan = trayInner * 1.5;
  const laneX =
    laneCount === 1 ? 0 : (lane / (laneCount - 1) - 0.5) * laneSpan;
  const startX = laneX + (Math.random() - 0.5) * 0.5;
  const startY = 2.4 + index * 0.55;
  const startZ = trayInner - 0.8 + (Math.random() - 0.5) * 0.4;

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
    tick(siblings) {
      const t = body.translation();
      const r = body.rotation();
      mesh.position.set(t.x, t.y, t.z);
      mesh.quaternion.set(r.x, r.y, r.z, r.w);

      const lv = body.linvel();
      const av = body.angvel();
      const lmag = Math.hypot(lv.x, lv.y, lv.z);
      const amag = Math.hypot(av.x, av.y, av.z);

      // Impact heuristic — fires on either of two clean signals:
      //   (a) Floor flip: y-velocity sign reversal while still falling fast.
      //   (b) Lateral hit: >35 % frame-over-frame speed loss while moving.
      // `impactStrength` scales the audio with the impact magnitude.
      // `floorFlip` separately remembers whether THIS impact was a floor
      // bounce; we use that below to skip the die-on-die classifier when
      // the answer is already known (the floor is never another die).
      const HIT_MIN_SPEED = 1.0;
      const FLOOR_FLIP_THRESHOLD = -0.8;
      const SPEED_DROP_RATIO = 0.65;
      let impactStrength = 0;
      let floorFlip = false;
      if (prevLvy < FLOOR_FLIP_THRESHOLD && lv.y > 0) {
        impactStrength = Math.min(1, -prevLvy / 5);
        floorFlip = true;
      } else if (
        prevLinSpeed > HIT_MIN_SPEED &&
        lmag < prevLinSpeed * SPEED_DROP_RATIO
      ) {
        impactStrength = Math.min(1, (prevLinSpeed - lmag) / 4);
      }
      if (impactStrength > 0) {
        // Classify floor/wall vs die-on-die by proximity to siblings.
        // Floor bounces (signal (a)) are always wood; for lateral hits
        // (signal (b)) we check whether another die was within ~2.4×
        // bounding radius at impact time. Same-die comparison is
        // skipped by identity check on the rigid-body reference.
        let isDieOnDie = false;
        if (!floorFlip && siblings.length > 1) {
          const closeR = DIE_RADIUS[type] * 2.4;
          const closeR2 = closeR * closeR;
          for (const sib of siblings) {
            if (sib.body === body) continue;
            const st = sib.body.translation();
            const dx = st.x - t.x;
            const dy = st.y - t.y;
            const dz = st.z - t.z;
            if (dx * dx + dy * dy + dz * dz < closeR2) {
              isDieOnDie = true;
              break;
            }
          }
        }
        if (isDieOnDie) {
          diceAudio.playClick(impactStrength);
        } else {
          diceAudio.playClack(impactStrength);
          // Pair haptics to wood hits only — die-on-die contacts are
          // too light and too frequent to feel right as buzzes (they'd
          // smear into a continuous vibration). The diceHaptics module
          // is gated by the Settings toggle and silently no-ops where
          // the platform API isn't available.
          diceHaptics.pulse(impactStrength);
        }
      }
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
      // Shared visuals (DIE_VISUAL_CACHE) live for the app lifetime — only
      // the rare fallback path owns its geometry + material.
      if (ownsVisual) {
        geom.dispose();
        if (!Array.isArray(materials)) materials.dispose();
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
// Legacy decorative dice (RNG path, kept as fallback when the reduced-
// motion setting suppresses the physics throw or Rapier WASM fails to
// load — every die type now has a real physics-read result by default).
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
    isActive() {
      // Needs sim while the body is awake; Rapier sleeps it at rest.
      return !body.isSleeping();
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
    isActive() {
      // The tween keeps a slow residual spin for as long as the roll is
      // "live"; once setIsRolling(false) snaps it to rest it's static.
      return isRolling;
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
