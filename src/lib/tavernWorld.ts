import * as THREE from 'three';

/**
 * The tavern — a real 3D room around the gaming table.
 *
 * Everything here is deliberately low-poly primitives (boxes, cylinders,
 * sprites) dressed in PBR wood/stone and drowned in darkness. In a
 * night-grade scene with pools of warm light, silhouettes + rim glow read
 * as far more detail than actually exists — the same trick every game
 * uses for mid-ground set dressing.
 *
 * Layout (world units; the dice tray sits at origin, camera looks from +z):
 *   - gaming table surface y=0 (the existing table plane, now 18×13)
 *   - back wall z≈-12.5, fireplace at (-5.6, …, -11.8)
 *   - chandelier overhead at (0, 6.4, -2.5)
 *   - dressing (candles, mug, coins, scroll) on the tabletop outside the
 *     tray rails
 *
 * Animation: `tick(time)` drives fire/candle flicker, flame sway, and
 * dust motes. The scene's render loop calls it at ambient cadence (~24
 * fps) while the tab is visible and reduced-motion is off.
 */

export interface TavernWorld {
  group: THREE.Group;
  /** Advance flames/flicker/motes. `time` in seconds (monotonic). */
  tick: (time: number) => void;
  dispose: () => void;
}

interface BuildOptions {
  /** Reuse DiceScene's cached texture loader so maps are shared. */
  getTexture: (url: string, srgb: boolean, onLoad: () => void) => THREE.Texture;
  requestRender: () => void;
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
  });
  const s = new THREE.Sprite(mat);
  s.scale.set(scale * 0.6, scale, 1);
  return s;
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

  // ---- shared materials ----------------------------------------------------
  const woodMap = getTexture('/textures/wood_diff.webp', true, requestRender);
  const woodNor = getTexture('/textures/wood_nor.webp', false, requestRender);
  const stoneMap = getTexture('/textures/stone_diff.webp', true, requestRender);
  const stoneNor = getTexture('/textures/stone_nor.webp', false, requestRender);

  const beamMat = track(
    new THREE.MeshStandardMaterial({
      map: woodMap,
      normalMap: woodNor,
      color: 0x4a3826,
      roughness: 0.9,
      metalness: 0.02,
    }),
  );
  const wallMat = track(
    new THREE.MeshStandardMaterial({
      map: woodMap,
      normalMap: woodNor,
      color: 0x2e2418,
      roughness: 0.95,
      metalness: 0.0,
    }),
  );
  const stoneMat = track(
    new THREE.MeshStandardMaterial({
      map: stoneMap,
      normalMap: stoneNor,
      color: 0x8a7a6a,
      roughness: 0.94,
      metalness: 0.0,
    }),
  );
  const pewterMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x9a9da2,
      roughness: 0.38,
      metalness: 0.88,
    }),
  );
  const ironMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x1c1c1e,
      roughness: 0.55,
      metalness: 0.8,
    }),
  );
  const waxMat = track(
    new THREE.MeshStandardMaterial({
      color: 0xd9c8a4,
      roughness: 0.55,
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
  const darkGlassMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x18301c,
      roughness: 0.18,
      metalness: 0.1,
    }),
  );
  const parchmentMat = track(
    new THREE.MeshStandardMaterial({
      color: 0xc9b896,
      roughness: 0.85,
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
  // THE ROOM
  // ==========================================================================

  // Back wall — wood paneling, mostly swallowed by fog/darkness. Kept
  // low (top ≈ 6.1) so the painted bokeh plate glows above the panel
  // line: "more tavern" receding past the wall.
  {
    const wallGeom = new THREE.PlaneGeometry(34, 7.2);
    track(wallGeom);
    const wall = new THREE.Mesh(wallGeom, wallMat);
    wallMat.map!.repeat.set(6, 1.6);
    wall.position.set(0, 2.5, -13.2);
    wall.receiveShadow = true;
    group.add(wall);
  }

  // Heavy ceiling beams running toward the camera + one cross beam — the
  // top of frame reads as a timbered ceiling.
  {
    const beamLong = new THREE.BoxGeometry(0.55, 0.5, 26);
    const beamCross = new THREE.BoxGeometry(30, 0.5, 0.6);
    for (const x of [-7.5, 0, 7.5]) {
      add(beamLong, beamMat, x, 7.6, -3);
    }
    add(beamCross, beamMat, 0, 7.3, -9.5);
  }

  // Support columns flanking the play area, just outside the table.
  {
    const colGeom = new THREE.BoxGeometry(0.6, 9, 0.6);
    add(colGeom, beamMat, -10.2, 3.0, -7.5, { castShadow: true });
    add(colGeom, beamMat, 10.2, 3.0, -8.0, { castShadow: true });
  }

  // ==========================================================================
  // FIREPLACE (left-back) — the second light source of the room.
  // ==========================================================================
  const fire = {
    light: new THREE.PointLight(0xff7a28, 55, 22, 1.7),
    sprites: [] as THREE.Sprite[],
    baseIntensity: 55,
  };
  {
    const fx = -6.2;
    const fz = -12.4;
    // Stone surround: two jambs + lintel + chimney breast.
    const jamb = new THREE.BoxGeometry(0.8, 2.6, 1.1);
    add(jamb, stoneMat, fx - 1.55, 1.3, fz, { castShadow: true });
    add(jamb, stoneMat, fx + 1.55, 1.3, fz, { castShadow: true });
    const lintel = new THREE.BoxGeometry(4.0, 0.7, 1.2);
    add(lintel, stoneMat, fx, 2.95, fz, { castShadow: true });
    const breast = new THREE.BoxGeometry(3.4, 4.6, 0.9);
    add(breast, stoneMat, fx, 5.6, fz - 0.05);
    // Firebox: near-black interior so the flames have a void to live in.
    const boxGeom = new THREE.BoxGeometry(2.6, 2.4, 0.7);
    const fireboxMat = track(
      new THREE.MeshStandardMaterial({ color: 0x0a0604, roughness: 1 }),
    );
    add(boxGeom, fireboxMat, fx, 1.2, fz - 0.15);
    // Glowing log + embers (emissive, bloom feeds on these in Phase B).
    const logGeom = new THREE.CylinderGeometry(0.14, 0.14, 1.6, 8);
    const logMat = track(
      new THREE.MeshStandardMaterial({
        color: 0x2a1208,
        roughness: 1,
        emissive: 0xb33c08,
        emissiveIntensity: 0.55,
      }),
    );
    const log = new THREE.Mesh(logGeom, logMat);
    log.rotation.z = Math.PI / 2;
    log.position.set(fx, 0.32, fz + 0.18);
    group.add(log);
    track(logGeom);
    const emberGeom = new THREE.PlaneGeometry(1.7, 0.5);
    track(emberGeom);
    const ember = new THREE.Mesh(emberGeom, emberMat);
    ember.rotation.x = -Math.PI / 2;
    ember.position.set(fx, 0.06, fz + 0.25);
    group.add(ember);
    // Layered flame sprites.
    const f1 = makeFlameSprite(1.7, 0.85);
    f1.position.set(fx, 1.05, fz + 0.25);
    const f2 = makeFlameSprite(1.15, 0.7);
    f2.position.set(fx - 0.4, 0.8, fz + 0.3);
    const f3 = makeFlameSprite(0.95, 0.7);
    f3.position.set(fx + 0.45, 0.75, fz + 0.3);
    fire.sprites.push(f1, f2, f3);
    group.add(f1, f2, f3);
    for (const s of fire.sprites) track(s.material);
    // The fire light itself.
    fire.light.position.set(fx, 1.3, fz + 1.2);
    fire.light.castShadow = false; // second shadow map not worth the cost
    group.add(fire.light);
  }

  // ==========================================================================
  // CHANDELIER — wrought-iron ring with candles, overhead.
  // ==========================================================================
  const chandelier = {
    light: new THREE.PointLight(0xffc080, 18, 14, 1.8),
    sprites: [] as THREE.Sprite[],
    baseIntensity: 18,
  };
  {
    const cx = 0;
    const cy = 6.0;
    const cz = -2.5;
    const ringGeom = new THREE.TorusGeometry(1.5, 0.07, 8, 28);
    track(ringGeom);
    const ring = new THREE.Mesh(ringGeom, ironMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(cx, cy, cz);
    ring.castShadow = false;
    group.add(ring);
    // Chain up to the beam.
    const chainGeom = new THREE.CylinderGeometry(0.025, 0.025, 1.6, 6);
    add(chainGeom, ironMat, cx, cy + 0.8, cz);
    // Five candles around the ring.
    const candleGeom = new THREE.CylinderGeometry(0.055, 0.065, 0.4, 8);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const px = cx + Math.cos(a) * 1.5;
      const pz = cz + Math.sin(a) * 1.5;
      add(candleGeom, waxMat, px, cy + 0.2, pz);
      const fl = makeFlameSprite(0.32, 0.9);
      fl.position.set(px, cy + 0.52, pz);
      chandelier.sprites.push(fl);
      group.add(fl);
      track(fl.material);
    }
    chandelier.light.position.set(cx, cy + 0.4, cz);
    group.add(chandelier.light);
  }

  // ==========================================================================
  // GLOOM DRESSING — silhouettes that make it a *room*, not a set.
  // ==========================================================================
  {
    // A second table + bench, right side, deep in shadow.
    const tableTop = new THREE.BoxGeometry(3.4, 0.18, 1.8);
    add(tableTop, beamMat, 8.6, 0.95, -9.6, { ry: -0.35 });
    const legGeom = new THREE.BoxGeometry(0.16, 1.0, 0.16);
    add(legGeom, beamMat, 7.4, 0.45, -10.1, { ry: -0.35 });
    add(legGeom, beamMat, 9.7, 0.45, -9.1, { ry: -0.35 });
    const bench = new THREE.BoxGeometry(3.0, 0.12, 0.5);
    add(bench, beamMat, 8.2, 0.55, -8.4, { ry: -0.35 });
    // Mug + bottle on that table — barely-lit glints.
    const farMug = new THREE.CylinderGeometry(0.14, 0.16, 0.32, 10);
    add(farMug, pewterMat, 8.3, 1.2, -9.5, { ry: 0 });
    const farBottle = new THREE.CylinderGeometry(0.1, 0.13, 0.55, 10);
    add(farBottle, darkGlassMat, 9.0, 1.32, -9.8);

    // Shelf on the back wall with bottles.
    const shelfGeom = new THREE.BoxGeometry(4.2, 0.12, 0.5);
    add(shelfGeom, beamMat, 6.4, 4.0, -13.0);
    const bottleGeom = new THREE.CylinderGeometry(0.11, 0.14, 0.62, 10);
    for (const [bx, h] of [
      [5.0, 0.62],
      [5.8, 0.5],
      [6.7, 0.66],
      [7.6, 0.55],
    ] as Array<[number, number]>) {
      const g = new THREE.CylinderGeometry(0.11, 0.14, h, 10);
      track(g);
      const b = new THREE.Mesh(g, darkGlassMat);
      b.position.set(bx, 4.06 + h / 2, -13.0);
      group.add(b);
    }
    track(bottleGeom);

    // A barrel in the right-front gloom edge.
    const barrelGeom = new THREE.CylinderGeometry(0.85, 0.95, 2.0, 14);
    add(barrelGeom, beamMat, 11.5, 1.0, -5.5, { castShadow: true });
  }

  // ==========================================================================
  // TABLETOP DRESSING — the things an adventurer leaves by the tray.
  // ==========================================================================
  const tableCandles = {
    light: new THREE.PointLight(0xffb870, 9, 7, 2.0),
    sprites: [] as THREE.Sprite[],
    baseIntensity: 9,
  };
  {
    // Candle cluster, left of the tray: [x, z, height].
    const positions: Array<[number, number, number]> = [
      [-3.6, 1.9, 0.52],
      [-3.25, 2.25, 0.38],
      [-3.85, 2.4, 0.3],
    ];
    for (const [px, pz, h] of positions) {
      const g = new THREE.CylinderGeometry(0.11, 0.12, h, 10);
      track(g);
      const c = new THREE.Mesh(g, waxMat);
      c.position.set(px, h / 2, pz);
      c.castShadow = true;
      group.add(c);
      const fl = makeFlameSprite(0.3, 0.95);
      fl.position.set(px, h + 0.16, pz);
      tableCandles.sprites.push(fl);
      group.add(fl);
      track(fl.material);
    }
    tableCandles.light.position.set(-3.55, 1.0, 2.15);
    group.add(tableCandles.light);

    // Pewter mug, right of the tray.
    const mugBody = new THREE.CylinderGeometry(0.22, 0.26, 0.52, 14);
    add(mugBody, pewterMat, 3.7, 0.26, 1.7, { castShadow: true });
    const handleGeom = new THREE.TorusGeometry(0.16, 0.035, 8, 14, Math.PI);
    track(handleGeom);
    const handle = new THREE.Mesh(handleGeom, pewterMat);
    handle.position.set(3.96, 0.28, 1.7);
    handle.rotation.z = -Math.PI / 2;
    group.add(handle);

    // Coin stack + scatter, right-back of the tray.
    const coinGeom = new THREE.CylinderGeometry(0.09, 0.09, 0.025, 12);
    track(coinGeom);
    for (let i = 0; i < 5; i++) {
      const c = new THREE.Mesh(coinGeom, goldMat);
      c.position.set(3.3 + (i > 2 ? 0.02 : 0), 0.0225 + i * 0.027, -1.9);
      group.add(c);
    }
    for (const [sx, sz, r] of [
      [3.7, -2.2, 0.4],
      [3.05, -2.35, 1.1],
      [3.55, -1.65, 2.3],
    ] as Array<[number, number, number]>) {
      const c = new THREE.Mesh(coinGeom, goldMat);
      c.position.set(sx, 0.013, sz);
      c.rotation.y = r;
      group.add(c);
    }

    // Rolled parchment, left-back.
    const scrollGeom = new THREE.CylinderGeometry(0.09, 0.09, 1.15, 12);
    track(scrollGeom);
    const scroll = new THREE.Mesh(scrollGeom, parchmentMat);
    scroll.rotation.z = Math.PI / 2;
    scroll.rotation.y = 0.45;
    scroll.position.set(-3.4, 0.09, -2.3);
    scroll.castShadow = true;
    group.add(scroll);
  }

  // ==========================================================================
  // DUST MOTES — floating in the warm light. Additive points, slow drift.
  // ==========================================================================
  const MOTE_COUNT = 90;
  const moteBase = new Float32Array(MOTE_COUNT * 3);
  const motePos = new Float32Array(MOTE_COUNT * 3);
  for (let i = 0; i < MOTE_COUNT; i++) {
    // Cluster motes where the light lives: above the table and near the fire.
    const nearFire = i % 3 === 0;
    moteBase[i * 3] = nearFire
      ? -6.2 + (Math.random() - 0.5) * 3
      : (Math.random() - 0.5) * 9;
    moteBase[i * 3 + 1] = 0.5 + Math.random() * 4.5;
    moteBase[i * 3 + 2] = nearFire
      ? -11 + Math.random() * 2.5
      : -2 + (Math.random() - 0.5) * 7;
  }
  motePos.set(moteBase);
  const moteGeom = track(new THREE.BufferGeometry());
  moteGeom.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
  const moteMat = track(
    new THREE.PointsMaterial({
      color: 0xffc890,
      size: 0.035,
      transparent: true,
      opacity: 0.55,
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
  // Pseudo-random but deterministic flicker from layered sines — cheaper
  // and steadier than Math.random() jitter, no popping.
  const flicker = (t: number, speed: number, seed: number): number =>
    0.5 +
    0.5 *
      (Math.sin(t * speed + seed) * 0.55 +
        Math.sin(t * speed * 2.7 + seed * 1.7) * 0.3 +
        Math.sin(t * speed * 6.1 + seed * 0.6) * 0.15);

  const tick = (time: number) => {
    // Fireplace: big lazy flicker.
    const ff = flicker(time, 2.2, 1.3);
    fire.light.intensity = fire.baseIntensity * (0.78 + ff * 0.45);
    fire.light.position.x = -6.2 + Math.sin(time * 1.7) * 0.12;
    for (let i = 0; i < fire.sprites.length; i++) {
      const s = fire.sprites[i]!;
      const f = flicker(time, 3.1, i * 2.4);
      const base = i === 0 ? 1.7 : i === 1 ? 1.15 : 0.95;
      s.scale.set(base * 0.6 * (0.9 + f * 0.2), base * (0.85 + f * 0.3), 1);
      (s.material as THREE.SpriteMaterial).opacity = 0.6 + f * 0.35;
    }
    // Chandelier + table candles: tighter, smaller flicker.
    chandelier.light.intensity =
      chandelier.baseIntensity * (0.85 + flicker(time, 4.2, 7.7) * 0.3);
    for (let i = 0; i < chandelier.sprites.length; i++) {
      const s = chandelier.sprites[i]!;
      const f = flicker(time, 5.0, i * 3.1);
      s.scale.set(0.32 * 0.6 * (0.85 + f * 0.3), 0.32 * (0.8 + f * 0.4), 1);
    }
    tableCandles.light.intensity =
      tableCandles.baseIntensity * (0.82 + flicker(time, 4.6, 12.9) * 0.36);
    for (let i = 0; i < tableCandles.sprites.length; i++) {
      const s = tableCandles.sprites[i]!;
      const f = flicker(time, 5.4, i * 1.9 + 4.2);
      s.scale.set(0.3 * 0.6 * (0.85 + f * 0.3), 0.3 * (0.8 + f * 0.45), 1);
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
