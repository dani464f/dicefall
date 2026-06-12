import * as THREE from 'three';

/**
 * Near-field tavern life over the cinematic backplate.
 *
 * The ROOM itself — fireplace, walls, beams, furniture — is a 2K
 * film-graded plate (see DiceScene's backplate block). Low-poly room
 * geometry read as "indie" next to it, so 3D keeps only what must move
 * or sit close to the lens:
 *
 *   - living flame sprites anchored OVER the plate's painted fireplace
 *     (the one thing a still image can't do is flicker)
 *   - the light rig that pushes warm, flickering light onto the real 3D
 *     table/dice (fire-direction key, chandelier top pool, table candles)
 *   - tabletop dressing beside the tray: wax candles with flames, a
 *     pewter mug, gold coins, a rolled parchment
 *   - dust motes drifting where the light lives
 *
 * Animation: `tick(time)` drives all flicker/sway/drift. The scene's
 * render loop calls it at ambient cadence (~24 fps) while the tab is
 * visible and reduced-motion is off.
 *
 * `setAnchorScale(s)` rescales the plate-anchored FX (fire sprites +
 * room lights) when the tray grows — the backplate scales with the
 * camera rig, so its painted features move outward by the same factor.
 */

export interface TavernWorld {
  group: THREE.Group;
  /** Advance flames/flicker/motes. `time` in seconds (monotonic). */
  tick: (time: number) => void;
  /** Rescale plate-anchored FX positions for the current tray scale. */
  setAnchorScale: (s: number) => void;
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
  /** World position of the painted fireplace fire on the backplate —
   *  computed by DiceScene from plate UVs so the live flames sit exactly
   *  on the painted glow. */
  fireSpriteAnchor: THREE.Vector3;
}

// ---------------------------------------------------------------------------
// Flame sprite texture — radial gradient painted once, shared by every flame.
// ---------------------------------------------------------------------------
let FLAME_TEX: THREE.CanvasTexture | null = null;
function getFlameTexture(): THREE.CanvasTexture {
  if (FLAME_TEX) return FLAME_TEX;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(
    size / 2,
    size * 0.6,
    2,
    size / 2,
    size * 0.55,
    size * 0.5,
  );
  g.addColorStop(0, 'rgba(255, 244, 214, 1)');
  g.addColorStop(0.25, 'rgba(255, 196, 110, 0.95)');
  g.addColorStop(0.55, 'rgba(255, 132, 38, 0.55)');
  g.addColorStop(1, 'rgba(255, 80, 10, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  FLAME_TEX = new THREE.CanvasTexture(canvas);
  FLAME_TEX.colorSpace = THREE.SRGBColorSpace;
  return FLAME_TEX;
}

function makeFlameSprite(scale: number, opacity: number): THREE.Sprite {
  const mat = new THREE.SpriteMaterial({
    map: getFlameTexture(),
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    opacity,
    // Flames must read through the room fog — fire IS the light source.
    fog: false,
  });
  const s = new THREE.Sprite(mat);
  s.scale.set(scale * 0.6, scale, 1);
  return s;
}

// ---------------------------------------------------------------------------

export function buildTavernWorld(opts: BuildOptions): TavernWorld {
  const { requestRender, fireSpriteAnchor } = opts;
  void requestRender; // textures now live on the plate; loader kept in the API
  const group = new THREE.Group();
  const disposables: Array<{ dispose: () => void }> = [];
  const track = <T extends { dispose: () => void }>(x: T): T => {
    disposables.push(x);
    return x;
  };

  // ---- near-field materials ------------------------------------------------
  const pewterMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x686c72,
      roughness: 0.45,
      metalness: 0.85,
    }),
  );
  const waxMat = track(
    new THREE.MeshStandardMaterial({
      color: 0xc9ae74,
      roughness: 0.6,
      metalness: 0.0,
    }),
  );
  const goldMat = track(
    new THREE.MeshStandardMaterial({
      color: 0xc8a14f,
      roughness: 0.32,
      metalness: 0.95,
    }),
  );
  const parchmentMat = track(
    new THREE.MeshStandardMaterial({
      color: 0xa8916a,
      roughness: 0.88,
      metalness: 0.0,
    }),
  );

  const add = (
    geom: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    opts2?: { ry?: number; rx?: number; castShadow?: boolean },
  ): THREE.Mesh => {
    track(geom);
    const m = new THREE.Mesh(geom, mat);
    m.position.set(x, y, z);
    if (opts2?.ry) m.rotation.y = opts2.ry;
    if (opts2?.rx) m.rotation.x = opts2.rx;
    if (opts2?.castShadow) m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };

  // ==========================================================================
  // FIRE — living flames over the plate's painted hearth + the warm key
  // light that pushes fire-glow onto the real 3D table from that side.
  // ==========================================================================
  const fire = {
    light: new THREE.PointLight(0xff7a28, 60, 26, 1.7),
    sprites: [] as THREE.Sprite[],
    baseIntensity: 60,
  };
  // Anchored group: everything inside follows setAnchorScale.
  const anchored = new THREE.Group();
  group.add(anchored);
  {
    const a = fireSpriteAnchor;
    const f1 = makeFlameSprite(2.4, 0.75);
    f1.position.copy(a);
    const f2 = makeFlameSprite(1.6, 0.6);
    f2.position.copy(a).add(new THREE.Vector3(-0.7, -0.45, 0.05));
    const f3 = makeFlameSprite(1.35, 0.6);
    f3.position.copy(a).add(new THREE.Vector3(0.75, -0.5, 0.05));
    fire.sprites.push(f1, f2, f3);
    anchored.add(f1, f2, f3);
    for (const s of fire.sprites) track(s.material);
    // The light is a STAGE light, not at the painted fire's depth — it
    // sits where it throws believable warm light across the 3D table
    // from the fire's screen direction. Film lighting, not simulation.
    fire.light.position.set(-7.5, 1.6, -7.0);
    fire.light.castShadow = false;
    anchored.add(fire.light);
  }

  // Chandelier pool from above (the chandelier itself is painted).
  const chandelier = {
    light: new THREE.PointLight(0xffc080, 15, 15, 1.8),
    baseIntensity: 15,
  };
  chandelier.light.position.set(0, 6.4, -2.5);
  anchored.add(chandelier.light);

  // ==========================================================================
  // TABLETOP DRESSING — the things an adventurer leaves by the tray.
  // (Unscaled: the tray and table stay at origin scale; only the camera
  // and plate move on tray growth.)
  // ==========================================================================
  const tableCandles = {
    light: new THREE.PointLight(0xffb870, 9, 7, 2.0),
    sprites: [] as THREE.Sprite[],
    baseIntensity: 9,
  };
  {
    // Candle cluster, left of the tray: [x, z, height].
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
      const fl = makeFlameSprite(0.26, 0.95);
      fl.position.set(px, h + 0.13, pz);
      tableCandles.sprites.push(fl);
      group.add(fl);
      track(fl.material);
    }
    tableCandles.light.position.set(-4.55, 0.95, 1.0);
    group.add(tableCandles.light);

    // Pewter mug, right of the tray.
    const mugBody = new THREE.CylinderGeometry(0.18, 0.21, 0.42, 14);
    add(mugBody, pewterMat, 4.5, 0.21, 0.5, { castShadow: true });
    const handleGeom = new THREE.TorusGeometry(0.13, 0.03, 8, 14, Math.PI);
    track(handleGeom);
    const handle = new THREE.Mesh(handleGeom, pewterMat);
    handle.position.set(4.71, 0.22, 0.5);
    handle.rotation.z = -Math.PI / 2;
    group.add(handle);

    // Coin stack + scatter, right-back of the tray.
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

    // Rolled parchment, left-back.
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
  // DUST MOTES — floating where the light lives. Additive points.
  // ==========================================================================
  const MOTE_COUNT = 48;
  const moteBase = new Float32Array(MOTE_COUNT * 3);
  const motePos = new Float32Array(MOTE_COUNT * 3);
  for (let i = 0; i < MOTE_COUNT; i++) {
    const cluster = i % 3;
    if (cluster === 0) {
      // over the painted fire glow
      moteBase[i * 3] = fireSpriteAnchor.x + (Math.random() - 0.5) * 3.0;
      moteBase[i * 3 + 1] = fireSpriteAnchor.y + Math.random() * 3.0;
      moteBase[i * 3 + 2] = fireSpriteAnchor.z + (Math.random() - 0.5) * 1.0;
    } else if (cluster === 1) {
      // chandelier halo
      moteBase[i * 3] = (Math.random() - 0.5) * 3.0;
      moteBase[i * 3 + 1] = 4.4 + Math.random() * 1.8;
      moteBase[i * 3 + 2] = -2.5 + (Math.random() - 0.5) * 2.6;
    } else {
      // table-candle pool
      moteBase[i * 3] = -4.5 + (Math.random() - 0.5) * 1.6;
      moteBase[i * 3 + 1] = 0.4 + Math.random() * 1.4;
      moteBase[i * 3 + 2] = 1.0 + (Math.random() - 0.5) * 1.6;
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
      opacity: 0.28,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    }),
  );
  const motes = new THREE.Points(moteGeom, moteMat);
  group.add(motes);

  // ==========================================================================
  // TICK — fire/candle flicker, flame sway, mote drift.
  // ==========================================================================
  const flicker = (t: number, speed: number, seed: number): number =>
    0.5 +
    0.5 *
      (Math.sin(t * speed + seed) * 0.55 +
        Math.sin(t * speed * 2.7 + seed * 1.7) * 0.3 +
        Math.sin(t * speed * 6.1 + seed * 0.6) * 0.15);

  const tick = (time: number) => {
    // Fire: big lazy flicker on light + sprites over the painted hearth.
    const ff = flicker(time, 2.2, 1.3);
    fire.light.intensity = fire.baseIntensity * (0.78 + ff * 0.45);
    for (let i = 0; i < fire.sprites.length; i++) {
      const s = fire.sprites[i]!;
      const f = flicker(time, 3.1, i * 2.4);
      const base = i === 0 ? 2.4 : i === 1 ? 1.6 : 1.35;
      s.scale.set(base * 0.6 * (0.9 + f * 0.2), base * (0.85 + f * 0.3), 1);
      (s.material as THREE.SpriteMaterial).opacity = 0.5 + f * 0.35;
    }
    chandelier.light.intensity =
      chandelier.baseIntensity * (0.85 + flicker(time, 4.2, 7.7) * 0.3);
    tableCandles.light.intensity =
      tableCandles.baseIntensity * (0.82 + flicker(time, 4.6, 12.9) * 0.36);
    for (let i = 0; i < tableCandles.sprites.length; i++) {
      const s = tableCandles.sprites[i]!;
      const f = flicker(time, 5.4, i * 1.9 + 4.2);
      s.scale.set(0.26 * 0.6 * (0.85 + f * 0.3), 0.26 * (0.8 + f * 0.45), 1);
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

  // Plate-anchored FX scale with the camera rig on tray growth.
  const setAnchorScale = (s: number) => {
    anchored.scale.setScalar(s);
  };

  const dispose = () => {
    for (const d of disposables) d.dispose();
  };

  return { group, tick, setAnchorScale, dispose };
}
