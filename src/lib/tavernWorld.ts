import * as THREE from 'three';

/**
 * The ENTIRE tavern as real 3D geometry — a complete room the gaming
 * table stands inside, built for camera freedom: all four walls, floor,
 * timbered ceiling, stone fireplace, bar counter, moonlit windows, and
 * furniture in the gloom. No backplate — every angle is a real angle.
 *
 * Fidelity strategy (what keeps primitives from reading "indie"):
 *   - PBR texture on every large surface (wood / stone / plaster)
 *   - night-grade pools-of-light lighting: darkness does the modeling,
 *     geometry only has to read as silhouette + lit fragments
 *   - dense mid-ground dressing at varied rotations (nothing axis-aligned
 *     except architecture)
 *   - the film post chain (bloom + grain + vignette) unifies everything
 *
 * Room frame (world units; dice tray at origin, seated camera at +z):
 *   floor y = -3.4 (the gaming table is furniture standing on it)
 *   ceiling y = 8.6 · walls: x = ±15, z = -14 (back) / +16 (behind cam)
 *   fireplace on the LEFT WALL facing into the room
 *   bar along the BACK WALL · two moonlit windows on the RIGHT WALL
 *
 * Animation: `tick(time)` drives fire/candle flicker + mote drift at the
 * scene's ambient cadence (~24 fps, visible tab, reduced-motion off).
 */

export interface TavernWorld {
  group: THREE.Group;
  tick: (time: number) => void;
  dispose: () => void;
}

interface BuildOptions {
  /** Reuse DiceScene's cached texture loader. `repeat` is part of the
   *  cache key — every distinct tiling gets its own texture instance. */
  getTexture: (
    url: string,
    srgb: boolean,
    onLoad: () => void,
    repeat?: [number, number],
  ) => THREE.Texture;
  requestRender: () => void;
}

const FLOOR_Y = -3.4;
const CEIL_Y = 8.6;
const WALL_X = 15;
const WALL_Z_BACK = -14;
const WALL_Z_FRONT = 16;

// ---------------------------------------------------------------------------
// FLIPBOOK FLAMES — a 4×4 procedural sprite sheet (16 frames of layered
// teardrop gradients with per-frame turbulence). Cycling frames makes the
// flame SHAPE dance — the difference between "glowing dot that pulses"
// and "fire". The atlas canvas is painted once; each sprite gets its own
// texture clone (clones share pixels, carry independent UV transforms).
// ---------------------------------------------------------------------------
const FLIP_GRID = 4;
const FLIP_FRAMES = FLIP_GRID * FLIP_GRID;
let FLAME_ATLAS: HTMLCanvasElement | null = null;

function getFlameAtlas(): HTMLCanvasElement {
  if (FLAME_ATLAS) return FLAME_ATLAS;
  const cell = 128;
  const size = cell * FLIP_GRID;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  // Deterministic per-frame "turbulence" from layered sines.
  const jit = (f: number, k: number) =>
    Math.sin(f * 2.39996 * k + k * 1.7) * 0.5 +
    Math.sin(f * 1.13 * k + k * 0.43) * 0.5;
  const blob = (
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    core: string,
    mid: string,
  ) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(rx, ry);
    const g = ctx.createRadialGradient(0, 0.1, 0.02, 0, 0, 1);
    g.addColorStop(0, core);
    g.addColorStop(0.45, mid);
    g.addColorStop(1, 'rgba(255, 70, 8, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
  for (let f = 0; f < FLIP_FRAMES; f++) {
    const ox = (f % FLIP_GRID) * cell;
    const oy = Math.floor(f / FLIP_GRID) * cell;
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, cell, cell);
    ctx.clip();
    ctx.translate(ox + cell / 2, oy + cell * 0.62);
    // Body — broad orange teardrop, swaying.
    blob(
      jit(f, 1) * 7,
      0,
      cell * (0.3 + jit(f, 2) * 0.04),
      cell * (0.42 + jit(f, 3) * 0.06),
      'rgba(255, 196, 110, 0.95)',
      'rgba(255, 128, 36, 0.6)',
    );
    // Tongue — taller, narrower, leaning with the sway, rising per frame.
    blob(
      jit(f, 1) * 10 + jit(f, 5) * 4,
      -cell * (0.16 + jit(f, 4) * 0.05),
      cell * (0.14 + jit(f, 6) * 0.03),
      cell * (0.3 + jit(f, 7) * 0.08),
      'rgba(255, 226, 160, 0.9)',
      'rgba(255, 150, 50, 0.5)',
    );
    // Core — hot white-yellow heart near the base.
    blob(
      jit(f, 8) * 3,
      cell * 0.1,
      cell * 0.13,
      cell * (0.2 + jit(f, 9) * 0.03),
      'rgba(255, 248, 222, 1)',
      'rgba(255, 196, 100, 0.7)',
    );
    ctx.restore();
  }
  FLAME_ATLAS = canvas;
  return canvas;
}

interface FlameRec {
  sprite: THREE.Sprite;
  tex: THREE.CanvasTexture;
  /** Phase offset so flames don't cycle in lockstep. */
  seed: number;
  /** Flipbook speed, frames/second. Big fire burns faster than candles. */
  fps: number;
  baseScale: number;
}

function makeFlame(
  scale: number,
  opacity: number,
  fps: number,
  seed: number,
): FlameRec {
  const tex = new THREE.CanvasTexture(getFlameAtlas());
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.repeat.set(1 / FLIP_GRID, 1 / FLIP_GRID);
  const mat = new THREE.SpriteMaterial({
    map: tex,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    opacity,
    fog: false, // fire IS the light source; it must read through room fog
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(scale * 0.6, scale, 1);
  return { sprite, tex, seed, fps, baseScale: scale };
}

/** Point a flame's UV window at flipbook frame for time `t`. */
function advanceFlame(rec: FlameRec, t: number): void {
  const f = Math.floor(t * rec.fps + rec.seed * 7.13) % FLIP_FRAMES;
  rec.tex.offset.set(
    (f % FLIP_GRID) / FLIP_GRID,
    1 - (Math.floor(f / FLIP_GRID) + 1) / FLIP_GRID,
  );
}

// ---------------------------------------------------------------------------

export function buildTavernWorld(opts: BuildOptions): TavernWorld {
  const { getTexture, requestRender } = opts;
  const group = new THREE.Group();
  const disposables: Array<{ dispose: () => void }> = [];
  const track = <T extends { dispose: () => void }>(x: T): T => {
    disposables.push(x);
    return x;
  };

  // ---- materials -----------------------------------------------------------
  const woodMat = (repeat: [number, number], color: number, rough = 0.92) =>
    track(
      new THREE.MeshStandardMaterial({
        map: getTexture('/textures/wood_diff.webp', true, requestRender, repeat),
        normalMap: getTexture('/textures/wood_nor.webp', false, requestRender, repeat),
        color,
        roughness: rough,
        metalness: 0.02,
      }),
    );
  const floorMat = woodMat([10, 9], 0x2b1f13, 0.96);
  const ceilMat = woodMat([8, 7], 0x1c1410, 0.97);
  const beamMat = woodMat([1.6, 0.4], 0x4a3826);
  const wainscotMat = woodMat([7, 1.2], 0x33261a);
  const barWoodMat = woodMat([2.5, 0.8], 0x4d3a26, 0.85);
  const furnitureMat = woodMat([1.8, 0.9], 0x3c2d1d);
  const plasterMat = track(
    new THREE.MeshStandardMaterial({
      map: getTexture('/textures/plaster_diff.webp', true, requestRender, [6, 2.2]),
      normalMap: getTexture('/textures/plaster_nor.webp', false, requestRender, [6, 2.2]),
      color: 0x4a4036,
      roughness: 0.97,
      metalness: 0.0,
    }),
  );
  const stoneMat = track(
    new THREE.MeshStandardMaterial({
      map: getTexture('/textures/stone_diff.webp', true, requestRender, [1.6, 1.2]),
      normalMap: getTexture('/textures/stone_nor.webp', false, requestRender, [1.6, 1.2]),
      color: 0x7a6c5c,
      roughness: 0.95,
      metalness: 0.0,
    }),
  );
  const pewterMat = track(
    new THREE.MeshStandardMaterial({ color: 0x686c72, roughness: 0.45, metalness: 0.85 }),
  );
  const ironMat = track(
    new THREE.MeshStandardMaterial({ color: 0x17171a, roughness: 0.6, metalness: 0.75 }),
  );
  const waxMat = track(
    new THREE.MeshStandardMaterial({ color: 0xc9ae74, roughness: 0.6, metalness: 0 }),
  );
  const goldMat = track(
    new THREE.MeshStandardMaterial({ color: 0xc8a14f, roughness: 0.32, metalness: 0.95 }),
  );
  const darkGlassMat = track(
    new THREE.MeshStandardMaterial({ color: 0x16281a, roughness: 0.2, metalness: 0.1 }),
  );
  const parchmentMat = track(
    new THREE.MeshStandardMaterial({ color: 0xa8916a, roughness: 0.88, metalness: 0 }),
  );
  // Window panes: cold moonlight membrane, emissive so bloom catches it.
  const paneMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x0a0e16,
      emissive: 0x4a5c80,
      emissiveIntensity: 0.55,
      roughness: 0.4,
      metalness: 0.0,
    }),
  );
  const emberMat = track(
    new THREE.MeshBasicMaterial({ color: 0xff5a14, toneMapped: false }),
  );

  const add = (
    geom: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    o?: { ry?: number; rx?: number; rz?: number; cast?: boolean; recv?: boolean },
  ): THREE.Mesh => {
    track(geom);
    const m = new THREE.Mesh(geom, mat);
    m.position.set(x, y, z);
    if (o?.ry) m.rotation.y = o.ry;
    if (o?.rx) m.rotation.x = o.rx;
    if (o?.rz) m.rotation.z = o.rz;
    m.castShadow = o?.cast ?? false;
    m.receiveShadow = o?.recv ?? true;
    group.add(m);
    return m;
  };

  // ==========================================================================
  // SHELL — floor, ceiling, four walls (timber-framed: wood wainscot low,
  // plaster high, dark posts at intervals).
  // ==========================================================================
  {
    // Floor.
    add(
      new THREE.PlaneGeometry(WALL_X * 2 + 2, WALL_Z_FRONT - WALL_Z_BACK + 2),
      floorMat,
      0,
      FLOOR_Y,
      (WALL_Z_BACK + WALL_Z_FRONT) / 2,
      { rx: -Math.PI / 2 },
    );
    // Ceiling.
    add(
      new THREE.PlaneGeometry(WALL_X * 2 + 2, WALL_Z_FRONT - WALL_Z_BACK + 2),
      ceilMat,
      0,
      CEIL_Y,
      (WALL_Z_BACK + WALL_Z_FRONT) / 2,
      { rx: Math.PI / 2 },
    );
    const wallH = CEIL_Y - FLOOR_Y;
    const wainscotH = 3.2;
    const mkWall = (
      w: number,
      x: number,
      z: number,
      ry: number,
    ) => {
      // plaster upper
      add(new THREE.PlaneGeometry(w, wallH - wainscotH), plasterMat, x, FLOOR_Y + wainscotH + (wallH - wainscotH) / 2, z, { ry });
      // wood wainscot lower
      add(new THREE.PlaneGeometry(w, wainscotH), wainscotMat, x, FLOOR_Y + wainscotH / 2, z, { ry });
    };
    const depth = WALL_Z_FRONT - WALL_Z_BACK;
    mkWall(WALL_X * 2, 0, WALL_Z_BACK, 0); // back
    mkWall(WALL_X * 2, 0, WALL_Z_FRONT, Math.PI); // front (behind camera)
    mkWall(depth, -WALL_X, (WALL_Z_BACK + WALL_Z_FRONT) / 2, Math.PI / 2); // left
    mkWall(depth, WALL_X, (WALL_Z_BACK + WALL_Z_FRONT) / 2, -Math.PI / 2); // right

    // Timber posts along walls + corner posts.
    const postGeom = new THREE.BoxGeometry(0.45, wallH, 0.45);
    track(postGeom);
    const postAt = (x: number, z: number) => {
      const p = new THREE.Mesh(postGeom, beamMat);
      p.position.set(x, FLOOR_Y + wallH / 2, z);
      p.receiveShadow = true;
      group.add(p);
    };
    for (const z of [-13.8, -7, 0, 7, 15.8]) {
      postAt(-WALL_X + 0.25, z);
      postAt(WALL_X - 0.25, z);
    }
    for (const x of [-10, -3.5, 3.5, 10]) {
      postAt(x, WALL_Z_BACK + 0.25);
      postAt(x, WALL_Z_FRONT - 0.25);
    }

    // Ceiling beams: three lengthwise + cross beams.
    const beamLong = new THREE.BoxGeometry(0.6, 0.55, WALL_Z_FRONT - WALL_Z_BACK);
    for (const x of [-9, -3, 3, 9]) {
      add(beamLong, beamMat, x, CEIL_Y - 0.28, (WALL_Z_BACK + WALL_Z_FRONT) / 2, { recv: true });
    }
    const beamCross = new THREE.BoxGeometry(WALL_X * 2, 0.5, 0.6);
    for (const z of [-10, -3.5, 3, 9.5]) {
      add(beamCross, beamMat, 0, CEIL_Y - 0.8, z, { recv: true });
    }
  }

  // ==========================================================================
  // FIREPLACE — on the LEFT WALL, facing into the room. The room's hero
  // light: its glow rakes across the floor and the gaming table's left side.
  // ==========================================================================
  let emberField: {
    pts: Float32Array;
    geom: THREE.BufferGeometry;
    ox: number;
    oy: number;
    oz: number;
  } | null = null;
  // Every flipbook flame in the room, advanced together in tick().
  const allFlames: FlameRec[] = [];
  const newFlame = (
    scale: number,
    opacity: number,
    fps: number,
  ): FlameRec => {
    const rec = makeFlame(scale, opacity, fps, allFlames.length);
    allFlames.push(rec);
    track(rec.sprite.material);
    track(rec.tex);
    return rec;
  };

  const fire = {
    light: new THREE.PointLight(0xff7a28, 85, 30, 1.6),
    sprites: [] as FlameRec[],
    baseIntensity: 85,
  };
  {
    const fz = -5.5; // along the left wall
    const fx = -WALL_X + 0.9; // proud of the wall
    const g = new THREE.Group();
    g.position.set(fx, FLOOR_Y, fz);
    g.rotation.y = Math.PI / 2; // face +x, into the room
    group.add(g);
    const addF = (
      geom: THREE.BufferGeometry,
      mat: THREE.Material,
      x: number,
      y: number,
      z: number,
      cast = false,
    ) => {
      track(geom);
      const m = new THREE.Mesh(geom, mat);
      m.position.set(x, y, z);
      m.castShadow = cast;
      m.receiveShadow = true;
      g.add(m);
      return m;
    };
    // Stone surround: jambs, lintel, chimney breast to the ceiling.
    addF(new THREE.BoxGeometry(1.0, 3.6, 1.4), stoneMat, -2.05, 1.8, 0, true);
    addF(new THREE.BoxGeometry(1.0, 3.6, 1.4), stoneMat, 2.05, 1.8, 0, true);
    addF(new THREE.BoxGeometry(5.1, 0.9, 1.5), stoneMat, 0, 4.05, 0, true);
    addF(new THREE.BoxGeometry(4.2, CEIL_Y - FLOOR_Y - 4.5, 1.2), stoneMat, 0, 4.5 + (CEIL_Y - FLOOR_Y - 4.5) / 2, -0.1);
    // Hearth slab.
    addF(new THREE.BoxGeometry(5.4, 0.3, 2.4), stoneMat, 0, 0.15, 0.6);
    // Firebox void.
    const fireboxMat = track(
      new THREE.MeshStandardMaterial({ color: 0x090503, roughness: 1 }),
    );
    addF(new THREE.BoxGeometry(3.1, 3.1, 0.9), fireboxMat, 0, 1.85, -0.2);
    // Logs + ember bed.
    const logMat = track(
      new THREE.MeshStandardMaterial({
        color: 0x2a1208,
        roughness: 1,
        emissive: 0xb33c08,
        emissiveIntensity: 0.8,
      }),
    );
    const logGeom = new THREE.CylinderGeometry(0.17, 0.17, 2.0, 8);
    track(logGeom);
    for (const [ly, rz] of [
      [0.5, 0],
      [0.82, 0.5],
    ] as Array<[number, number]>) {
      const log = new THREE.Mesh(logGeom, logMat);
      log.rotation.z = Math.PI / 2;
      log.rotation.y = rz;
      log.position.set(0, ly, 0.15);
      g.add(log);
    }
    const emberGeom = new THREE.PlaneGeometry(2.4, 0.8);
    track(emberGeom);
    const ember = new THREE.Mesh(emberGeom, emberMat);
    ember.rotation.x = -Math.PI / 2;
    ember.position.set(0, 0.32, 0.3);
    g.add(ember);
    // Flames (positions in world space — sprites billboard, so they live
    // directly in the main group at the firebox mouth). Fast flipbook —
    // a hearth fire churns.
    const fwx = fx + 0.45;
    const f1 = newFlame(2.5, 0.9, 16);
    f1.sprite.position.set(fwx, FLOOR_Y + 1.9, fz);
    const f2 = newFlame(1.7, 0.75, 13);
    f2.sprite.position.set(fwx, FLOOR_Y + 1.5, fz - 0.6);
    const f3 = newFlame(1.45, 0.75, 14);
    f3.sprite.position.set(fwx, FLOOR_Y + 1.45, fz + 0.65);
    fire.sprites.push(f1, f2, f3);
    group.add(f1.sprite, f2.sprite, f3.sprite);
    fire.light.position.set(fx + 1.6, FLOOR_Y + 2.2, fz);
    fire.light.castShadow = false;
    group.add(fire.light);

    // Rising embers — a sparse column of hot points drifting up from the
    // log bed, swaying as they climb. Bloom turns them into fireflies.
    const EMBER_N = 14;
    const emberPts = new Float32Array(EMBER_N * 3);
    const emberGeomP = track(new THREE.BufferGeometry());
    emberGeomP.setAttribute('position', new THREE.BufferAttribute(emberPts, 3));
    const emberPtsMat = track(
      new THREE.PointsMaterial({
        color: 0xff8a30,
        size: 0.05,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
        sizeAttenuation: true,
      }),
    );
    const emberPoints = new THREE.Points(emberGeomP, emberPtsMat);
    group.add(emberPoints);
    emberField = {
      pts: emberPts,
      geom: emberGeomP,
      ox: fx + 0.5,
      oy: FLOOR_Y + 0.7,
      oz: fz,
    };
  }

  // ==========================================================================
  // BAR — counter along the back wall + back-bar shelving with bottles.
  // The second-strongest "this is a tavern" signifier after the fire.
  // ==========================================================================
  {
    const bz = WALL_Z_BACK + 2.4;
    const bx = 3.5;
    const counterTop = new THREE.BoxGeometry(11, 0.28, 1.5);
    add(counterTop, barWoodMat, bx, FLOOR_Y + 2.4, bz, { cast: true });
    const counterFront = new THREE.BoxGeometry(11, 2.4, 0.18);
    add(counterFront, wainscotMat, bx, FLOOR_Y + 1.2, bz + 0.66);
    // Back-bar: two long shelves on the wall with bottle rows.
    const shelfGeom = new THREE.BoxGeometry(10, 0.14, 0.55);
    add(shelfGeom, barWoodMat, bx, FLOOR_Y + 3.6, WALL_Z_BACK + 0.5);
    add(shelfGeom, barWoodMat, bx, FLOOR_Y + 4.8, WALL_Z_BACK + 0.5);
    // Bottle rows (deterministic pseudo-random heights/offsets).
    const rand = (i: number) => {
      const x = Math.sin(i * 127.1) * 43758.5453;
      return x - Math.floor(x);
    };
    for (let shelf = 0; shelf < 2; shelf++) {
      const sy = FLOOR_Y + (shelf === 0 ? 3.67 : 4.87);
      for (let i = 0; i < 11; i++) {
        const h = 0.45 + rand(i + shelf * 31) * 0.3;
        const bGeom = new THREE.CylinderGeometry(0.085, 0.105, h, 8);
        track(bGeom);
        const b = new THREE.Mesh(bGeom, darkGlassMat);
        b.position.set(
          bx - 4.6 + i * 0.92 + (rand(i * 3 + shelf) - 0.5) * 0.25,
          sy + h / 2,
          WALL_Z_BACK + 0.5 + (rand(i * 7 + shelf) - 0.5) * 0.15,
        );
        group.add(b);
      }
    }
    // A couple of mugs on the counter.
    const mugGeom = new THREE.CylinderGeometry(0.16, 0.19, 0.36, 10);
    add(mugGeom, pewterMat, bx - 3.2, FLOOR_Y + 2.72, bz - 0.2, { cast: true });
    add(mugGeom, pewterMat, bx + 2.6, FLOOR_Y + 2.72, bz + 0.1, { cast: true });
  }

  // ==========================================================================
  // WINDOWS — two leaded windows on the right wall, cold moonlight against
  // all the warmth. Color contrast = cinema.
  // ==========================================================================
  const moon = new THREE.PointLight(0x6a82b8, 9, 16, 1.8);
  {
    // Soft gradient for the moonlight shafts — painted once.
    const shaftCanvas = document.createElement('canvas');
    shaftCanvas.width = 64;
    shaftCanvas.height = 256;
    {
      const sctx = shaftCanvas.getContext('2d')!;
      const sg = sctx.createLinearGradient(0, 0, 0, 256);
      sg.addColorStop(0, 'rgba(255,255,255,0.55)');
      sg.addColorStop(0.6, 'rgba(255,255,255,0.18)');
      sg.addColorStop(1, 'rgba(255,255,255,0)');
      sctx.fillStyle = sg;
      sctx.fillRect(0, 0, 64, 256);
      // Feather the sides so the shaft has no hard vertical edges.
      const sgx = sctx.createLinearGradient(0, 0, 64, 0);
      sgx.addColorStop(0, 'rgba(0,0,0,1)');
      sgx.addColorStop(0.25, 'rgba(0,0,0,0)');
      sgx.addColorStop(0.75, 'rgba(0,0,0,0)');
      sgx.addColorStop(1, 'rgba(0,0,0,1)');
      sctx.globalCompositeOperation = 'destination-out';
      sctx.fillStyle = sgx;
      sctx.fillRect(0, 0, 64, 256);
    }
    const shaftTex = track(new THREE.CanvasTexture(shaftCanvas));
    shaftTex.colorSpace = THREE.SRGBColorSpace;

    const wx = WALL_X - 0.18;
    for (const wz of [-6.5, 0.5]) {
      // Volumetric-look moon shaft slanting from the pane into the room.
      const shaftGeom = new THREE.PlaneGeometry(2.0, 6.4);
      track(shaftGeom);
      const shaftMat = track(
        new THREE.MeshBasicMaterial({
          map: shaftTex,
          color: 0x6a82b8,
          transparent: true,
          opacity: 0.14,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          fog: false,
          side: THREE.DoubleSide,
        }),
      );
      const shaft = new THREE.Mesh(shaftGeom, shaftMat);
      shaft.position.set(wx - 2.0, FLOOR_Y + 2.9, wz);
      shaft.rotation.y = -Math.PI / 2 + 0.5;
      shaft.rotation.z = -0.62;
      group.add(shaft);
    }
    for (const wz of [-6.5, 0.5]) {
      // Frame.
      const frameV = new THREE.BoxGeometry(0.18, 2.6, 0.22);
      const frameH = new THREE.BoxGeometry(0.18, 0.22, 1.7);
      add(frameV, beamMat, wx, FLOOR_Y + 4.4, wz - 0.85);
      add(frameV, beamMat, wx, FLOOR_Y + 4.4, wz + 0.85);
      add(frameH, beamMat, wx, FLOOR_Y + 5.65, wz);
      add(frameH, beamMat, wx, FLOOR_Y + 3.15, wz);
      // Mullions.
      const mullV = new THREE.BoxGeometry(0.1, 2.4, 0.08);
      const mullH = new THREE.BoxGeometry(0.1, 0.08, 1.6);
      add(mullV, ironMat, wx, FLOOR_Y + 4.4, wz);
      add(mullH, ironMat, wx, FLOOR_Y + 4.4, wz);
      // Pane (emissive moonlight membrane).
      const paneGeom = new THREE.PlaneGeometry(1.7, 2.5);
      add(paneGeom, paneMat, wx + 0.02, FLOOR_Y + 4.4, wz, { ry: -Math.PI / 2 });
    }
    moon.position.set(WALL_X - 2.5, FLOOR_Y + 4.5, -3);
    group.add(moon);
  }

  // ==========================================================================
  // FURNITURE IN THE GLOOM — tables, benches, stools, barrels at varied
  // rotations. Silhouettes + lit fragments; the darkness models them.
  // ==========================================================================
  // Far-table candle flames, collected so tick() can flicker them.
  const farCandleSprites: FlameRec[] = [];
  {
    const mkTable = (x: number, z: number, ry: number) => {
      const top = new THREE.BoxGeometry(3.2, 0.2, 1.8);
      const t = add(top, furnitureMat, x, FLOOR_Y + 2.0, z, { ry, cast: true });
      void t;
      const legGeom = new THREE.BoxGeometry(0.18, 2.0, 0.18);
      for (const [dx, dz] of [
        [-1.35, -0.7],
        [1.35, -0.7],
        [-1.35, 0.7],
        [1.35, 0.7],
      ] as Array<[number, number]>) {
        const leg = new THREE.Mesh(legGeom, furnitureMat);
        track(legGeom);
        const cos = Math.cos(ry);
        const sin = Math.sin(ry);
        leg.position.set(x + dx * cos - dz * sin, FLOOR_Y + 1.0, z + dx * sin + dz * cos);
        leg.receiveShadow = true;
        group.add(leg);
      }
      // Bench.
      const bench = new THREE.BoxGeometry(3.0, 0.14, 0.5);
      add(bench, furnitureMat, x + Math.sin(ry) * 1.4, FLOOR_Y + 1.15, z + Math.cos(ry) * 1.4, { ry });
      // A candle on each far table: tiny wax + flame + NO extra light
      // (light budget) — the flame sprite + bloom carries it.
      const cGeom = new THREE.CylinderGeometry(0.07, 0.08, 0.3, 8);
      add(cGeom, waxMat, x + 0.5 * Math.cos(ry), FLOOR_Y + 2.25, z + 0.5 * Math.sin(ry));
      const fl = newFlame(0.22, 0.9, 10);
      fl.sprite.position.set(x + 0.5 * Math.cos(ry), FLOOR_Y + 2.52, z + 0.5 * Math.sin(ry));
      farCandleSprites.push(fl);
      group.add(fl.sprite);
      // A mug.
      const mGeom = new THREE.CylinderGeometry(0.13, 0.15, 0.3, 10);
      add(mGeom, pewterMat, x - 0.8 * Math.cos(ry), FLOOR_Y + 2.25, z - 0.8 * Math.sin(ry), { cast: true });
    };
    mkTable(-8.5, -9.5, 0.5);
    mkTable(9.0, -8.0, -0.35);
    mkTable(-9.5, 2.5, -0.2);

    // Stools.
    const stoolGeom = new THREE.CylinderGeometry(0.45, 0.5, 1.5, 10);
    for (const [sx, sz] of [
      [-6.6, -8.2],
      [10.8, -6.2],
      [7.2, -11.6],
      [-7.6, 4.4],
    ] as Array<[number, number]>) {
      add(stoolGeom, furnitureMat, sx, FLOOR_Y + 0.75, sz, { cast: true });
    }

    // Barrels: cluster right-back corner + one on its side.
    const barrelGeom = new THREE.CylinderGeometry(0.85, 0.95, 2.1, 14);
    add(barrelGeom, barWoodMat, 12.6, FLOOR_Y + 1.05, -11.8, { cast: true });
    add(barrelGeom, barWoodMat, 11.0, FLOOR_Y + 1.05, -12.6, { cast: true });
    const sideBarrel = add(barrelGeom, barWoodMat, 12.2, FLOOR_Y + 0.95, -9.2, { cast: true });
    sideBarrel.rotation.z = Math.PI / 2;
    sideBarrel.rotation.y = 0.4;
  }
  // (declared before mkTable uses it)

  // ==========================================================================
  // GAMING TABLE LEGS — DiceScene owns the tabletop slab (skin-driven
  // texture) + edge skirts; the legs that ground it on the room floor
  // live here. Six chunky posts: corners + mid-span (it's a long table).
  // ==========================================================================
  {
    const legH = -0.06 - FLOOR_Y; // tabletop underside to floor
    const legGeom = new THREE.BoxGeometry(0.55, legH, 0.55);
    track(legGeom);
    for (const [lx, lz] of [
      [-8.8, -6.3],
      [8.8, -6.3],
      [-8.8, 6.3],
      [8.8, 6.3],
      [-8.8, 0],
      [8.8, 0],
    ] as Array<[number, number]>) {
      const leg = new THREE.Mesh(legGeom, furnitureMat);
      leg.position.set(lx, FLOOR_Y + legH / 2, lz);
      leg.receiveShadow = true;
      group.add(leg);
    }
  }

  // ==========================================================================
  // CHANDELIER — wrought-iron ring over the gaming table. Real geometry
  // again (it can be in ANY future shot), plus its warm pool light.
  // ==========================================================================
  const chandelier = {
    light: new THREE.PointLight(0xffc080, 16, 15, 1.8),
    sprites: [] as FlameRec[],
    baseIntensity: 16,
  };
  {
    const cy = 5.6;
    const cz = -1.5;
    const ringGeom = new THREE.TorusGeometry(1.5, 0.07, 8, 28);
    track(ringGeom);
    const ring = new THREE.Mesh(ringGeom, ironMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, cy, cz);
    group.add(ring);
    const chainGeom = new THREE.CylinderGeometry(0.025, 0.025, CEIL_Y - cy, 6);
    add(chainGeom, ironMat, 0, cy + (CEIL_Y - cy) / 2, cz);
    const candleGeom = new THREE.CylinderGeometry(0.055, 0.065, 0.4, 8);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const px = Math.cos(a) * 1.5;
      const pz = cz + Math.sin(a) * 1.5;
      add(candleGeom, waxMat, px, cy + 0.2, pz);
      const fl = newFlame(0.3, 0.9, 10);
      fl.sprite.position.set(px, cy + 0.5, pz);
      chandelier.sprites.push(fl);
      group.add(fl.sprite);
    }
    chandelier.light.position.set(0, cy + 0.4, cz);
    group.add(chandelier.light);
  }

  // ==========================================================================
  // TABLETOP DRESSING — beside the tray (unchanged positions).
  // ==========================================================================
  const tableCandles = {
    light: new THREE.PointLight(0xffb870, 9, 7, 2.0),
    sprites: [] as FlameRec[],
    baseIntensity: 9,
  };
  {
    const positions: Array<[number, number, number]> = [
      [-4.6, 0.8, 0.5],
      [-4.25, 1.15, 0.36],
      [-4.85, 1.3, 0.28],
    ];
    for (const [px, pz, h] of positions) {
      const g = new THREE.CylinderGeometry(0.085, 0.095, h, 10);
      track(g);
      const c = new THREE.Mesh(g, waxMat);
      c.position.set(px, h / 2, pz);
      c.castShadow = true;
      group.add(c);
      const fl = newFlame(0.26, 0.95, 12);
      fl.sprite.position.set(px, h + 0.13, pz);
      tableCandles.sprites.push(fl);
      group.add(fl.sprite);
    }
    tableCandles.light.position.set(-4.55, 0.95, 1.0);
    group.add(tableCandles.light);

    const mugBody = new THREE.CylinderGeometry(0.18, 0.21, 0.42, 14);
    add(mugBody, pewterMat, 4.5, 0.21, 0.5, { cast: true });
    const handleGeom = new THREE.TorusGeometry(0.13, 0.03, 8, 14, Math.PI);
    track(handleGeom);
    const handle = new THREE.Mesh(handleGeom, pewterMat);
    handle.position.set(4.71, 0.22, 0.5);
    handle.rotation.z = -Math.PI / 2;
    group.add(handle);

    const coinGeom = new THREE.CylinderGeometry(0.09, 0.09, 0.025, 12);
    track(coinGeom);
    for (let i = 0; i < 4; i++) {
      const c = new THREE.Mesh(coinGeom, goldMat);
      c.position.set(4.1 + (i > 1 ? 0.02 : 0), 0.0225 + i * 0.027, -2.7);
      group.add(c);
    }
    for (const [sx, sz, r] of [
      [4.5, -3.0, 0.4],
      [3.8, -3.15, 1.1],
      [4.35, -2.3, 2.3],
    ] as Array<[number, number, number]>) {
      const c = new THREE.Mesh(coinGeom, goldMat);
      c.position.set(sx, 0.013, sz);
      c.rotation.y = r;
      group.add(c);
    }

    const scrollGeom = new THREE.CylinderGeometry(0.08, 0.08, 1.05, 12);
    track(scrollGeom);
    const scroll = new THREE.Mesh(scrollGeom, parchmentMat);
    scroll.rotation.z = Math.PI / 2;
    scroll.rotation.y = 0.5;
    scroll.position.set(-4.3, 0.08, -3.1);
    scroll.castShadow = true;
    group.add(scroll);
  }

  // ==========================================================================
  // DUST MOTES — where the light lives: fire column, chandelier halo,
  // candle pool, moon shafts.
  // ==========================================================================
  const MOTE_COUNT = 64;
  const moteBase = new Float32Array(MOTE_COUNT * 3);
  const motePos = new Float32Array(MOTE_COUNT * 3);
  for (let i = 0; i < MOTE_COUNT; i++) {
    const cluster = i % 4;
    if (cluster === 0) {
      moteBase[i * 3] = -WALL_X + 2 + Math.random() * 3;
      moteBase[i * 3 + 1] = FLOOR_Y + 1 + Math.random() * 4;
      moteBase[i * 3 + 2] = -5.5 + (Math.random() - 0.5) * 3;
    } else if (cluster === 1) {
      moteBase[i * 3] = (Math.random() - 0.5) * 3.0;
      moteBase[i * 3 + 1] = 3.8 + Math.random() * 2.0;
      moteBase[i * 3 + 2] = -1.5 + (Math.random() - 0.5) * 2.6;
    } else if (cluster === 2) {
      moteBase[i * 3] = -4.5 + (Math.random() - 0.5) * 1.6;
      moteBase[i * 3 + 1] = 0.4 + Math.random() * 1.4;
      moteBase[i * 3 + 2] = 1.0 + (Math.random() - 0.5) * 1.6;
    } else {
      moteBase[i * 3] = WALL_X - 2.5 - Math.random() * 2.5;
      moteBase[i * 3 + 1] = FLOOR_Y + 3 + Math.random() * 2.5;
      moteBase[i * 3 + 2] = -4 + (Math.random() - 0.5) * 6;
    }
  }
  motePos.set(moteBase);
  const moteGeom = track(new THREE.BufferGeometry());
  moteGeom.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
  const moteMat = track(
    new THREE.PointsMaterial({
      color: 0xffc890,
      size: 0.028,
      transparent: true,
      opacity: 0.26,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    }),
  );
  const motes = new THREE.Points(moteGeom, moteMat);
  group.add(motes);

  // ==========================================================================
  // TICK
  // ==========================================================================
  const flicker = (t: number, speed: number, seed: number): number =>
    0.5 +
    0.5 *
      (Math.sin(t * speed + seed) * 0.55 +
        Math.sin(t * speed * 2.7 + seed * 1.7) * 0.3 +
        Math.sin(t * speed * 6.1 + seed * 0.6) * 0.15);

  const tick = (time: number) => {
    // Flipbook frames — the flame SHAPES dance.
    for (const rec of allFlames) advanceFlame(rec, time);

    // Light + scale flicker layered on top.
    const ff = flicker(time, 2.2, 1.3);
    fire.light.intensity = fire.baseIntensity * (0.78 + ff * 0.45);
    for (let i = 0; i < fire.sprites.length; i++) {
      const rec = fire.sprites[i]!;
      const f = flicker(time, 3.1, i * 2.4);
      const base = rec.baseScale;
      rec.sprite.scale.set(
        base * 0.6 * (0.9 + f * 0.2),
        base * (0.85 + f * 0.3),
        1,
      );
      (rec.sprite.material as THREE.SpriteMaterial).opacity = 0.55 + f * 0.35;
    }
    chandelier.light.intensity =
      chandelier.baseIntensity * (0.85 + flicker(time, 4.2, 7.7) * 0.3);
    for (let i = 0; i < chandelier.sprites.length; i++) {
      const rec = chandelier.sprites[i]!;
      const f = flicker(time, 5.0, i * 3.1);
      rec.sprite.scale.set(
        rec.baseScale * 0.6 * (0.85 + f * 0.3),
        rec.baseScale * (0.8 + f * 0.4),
        1,
      );
    }
    tableCandles.light.intensity =
      tableCandles.baseIntensity * (0.82 + flicker(time, 4.6, 12.9) * 0.36);
    for (let i = 0; i < tableCandles.sprites.length; i++) {
      const rec = tableCandles.sprites[i]!;
      const f = flicker(time, 5.4, i * 1.9 + 4.2);
      rec.sprite.scale.set(
        rec.baseScale * 0.6 * (0.85 + f * 0.3),
        rec.baseScale * (0.8 + f * 0.45),
        1,
      );
    }
    for (let i = 0; i < farCandleSprites.length; i++) {
      const rec = farCandleSprites[i]!;
      const f = flicker(time, 5.8, i * 2.7 + 9.1);
      rec.sprite.scale.set(
        rec.baseScale * 0.6 * (0.85 + f * 0.3),
        rec.baseScale * (0.8 + f * 0.4),
        1,
      );
    }

    // Embers: each particle loops a rising arc with horizontal sway;
    // staggered phases so the column never empties or pulses.
    if (emberField) {
      const { pts, geom, ox, oy, oz } = emberField;
      const n = pts.length / 3;
      for (let i = 0; i < n; i++) {
        const speed = 0.16 + (i % 5) * 0.04;
        const phase = i * 0.737;
        const cycle = (time * speed + phase) % 1;
        pts[i * 3] = ox + Math.sin(time * 0.9 + i * 2.1) * 0.25 * cycle;
        pts[i * 3 + 1] = oy + cycle * 3.0;
        pts[i * 3 + 2] = oz + Math.cos(time * 0.7 + i * 1.3) * 0.2 * cycle;
      }
      geom.attributes.position!.needsUpdate = true;
    }

    // Motes: slow figure-eight drift around each base point.
    for (let i = 0; i < MOTE_COUNT; i++) {
      const sp = 0.12 + (i % 7) * 0.025;
      const ph = i * 1.318;
      motePos[i * 3] = moteBase[i * 3]! + Math.sin(time * sp + ph) * 0.5;
      motePos[i * 3 + 1] =
        moteBase[i * 3 + 1]! + Math.sin(time * sp * 0.7 + ph * 2.1) * 0.35;
      motePos[i * 3 + 2] =
        moteBase[i * 3 + 2]! + Math.cos(time * sp * 0.85 + ph) * 0.5;
    }
    moteGeom.attributes.position!.needsUpdate = true;
  };

  const dispose = () => {
    for (const d of disposables) d.dispose();
  };

  return { group, tick, dispose };
}
