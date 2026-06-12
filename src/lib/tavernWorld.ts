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
  const { getTexture, requestRender } = opts;
  const group = new THREE.Group();
  const disposables: Array<{ dispose: () => void }> = [];
  const track = <T extends { dispose: () => void }>(x: T): T => {
    disposables.push(x);
    return x;
  };

  // ---- shared materials ----------------------------------------------------
  const beamMat = track(
    new THREE.MeshStandardMaterial({
      map: getTexture('/textures/wood_diff.webp', true, requestRender, [1.4, 0.4]),
      normalMap: getTexture('/textures/wood_nor.webp', false, requestRender, [1.4, 0.4]),
      color: 0x4a3826,
      roughness: 0.9,
      metalness: 0.02,
    }),
  );
  const wallMat = track(
    new THREE.MeshStandardMaterial({
      map: getTexture('/textures/wood_diff.webp', true, requestRender, [6, 2]),
      normalMap: getTexture('/textures/wood_nor.webp', false, requestRender, [6, 2]),
      color: 0x2e2418,
      roughness: 0.95,
      metalness: 0.0,
    }),
  );
  const floorMat = track(
    new THREE.MeshStandardMaterial({
      map: getTexture('/textures/wood_diff.webp', true, requestRender, [9, 3.5]),
      normalMap: getTexture('/textures/wood_nor.webp', false, requestRender, [9, 3.5]),
      color: 0x241a10,
      roughness: 0.96,
      metalness: 0.0,
    }),
  );
  const stoneMat = track(
    new THREE.MeshStandardMaterial({
      map: getTexture('/textures/stone_diff.webp', true, requestRender, [1.4, 1]),
      normalMap: getTexture('/textures/stone_nor.webp', false, requestRender, [1.4, 1]),
      color: 0x8a7a6a,
      roughness: 0.94,
      metalness: 0.0,
    }),
  );
  const pewterMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x686c72,
      roughness: 0.45,
      metalness: 0.85,
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
  const darkGlassMat = track(
    new THREE.MeshStandardMaterial({
      color: 0x18301c,
      roughness: 0.18,
      metalness: 0.1,
    }),
  );
  const parchmentMat = track(
    new THREE.MeshStandardMaterial({
      color: 0xa8916a,
      roughness: 0.88,
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
  // The room stands at floor level — the gaming table is furniture in it.
  // Everything ground-based lives in floorGroup so the whole room sits
  // FLOOR_Y below the tabletop. Sightline note: from the seated camera the
  // tabletop occludes roughly everything below y≈-1.7 at the back wall, so
  // the fireplace is sized tall enough that its fire reads clearly over
  // the table edge.
  const FLOOR_Y = -1.6;
  const floorGroup = new THREE.Group();
  floorGroup.position.y = FLOOR_Y;
  group.add(floorGroup);

  // Plank floor — visible as a band between the table's far edge and the
  // wall; kills the void gap.
  {
    const floorGeom = new THREE.PlaneGeometry(44, 16);
    track(floorGeom);
    const floor = new THREE.Mesh(floorGeom, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, -8.5);
    floor.receiveShadow = true;
    floorGroup.add(floor);
  }

  // Back wall — wood paneling from the floor up to ≈6.4, leaving the
  // painted bokeh plate glowing above the panel line.
  {
    const wallGeom = new THREE.PlaneGeometry(34, 8.0);
    track(wallGeom);
    const wall = new THREE.Mesh(wallGeom, wallMat);
    wall.position.set(0, 2.4, -13.2);
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

  // Support columns flanking the play area — floor to ceiling beams.
  {
    const colGeom = new THREE.BoxGeometry(0.6, 9.6, 0.6);
    track(colGeom);
    for (const [cx, cz] of [
      [-10.2, -7.5],
      [10.2, -8.0],
    ] as Array<[number, number]>) {
      const col = new THREE.Mesh(colGeom, beamMat);
      col.position.set(cx, 4.8, cz);
      col.castShadow = true;
      col.receiveShadow = true;
      floorGroup.add(col);
    }
  }

  // ==========================================================================
  // FIREPLACE (left-back) — the second light source of the room.
  // ==========================================================================
  const fire = {
    light: new THREE.PointLight(0xff7a28, 70, 26, 1.7),
    sprites: [] as THREE.Sprite[],
    baseIntensity: 70,
  };
  {
    // All fireplace pieces live in floorGroup (y values are heights above
    // the room floor). Sized tall so the firelight + flames read clearly
    // over the tabletop occlusion line.
    const fx = -6.2;
    const fz = -12.4;
    const addF = (
      geom: THREE.BufferGeometry,
      mat: THREE.Material,
      x: number,
      y: number,
      z: number,
      castShadow = false,
    ) => {
      track(geom);
      const m = new THREE.Mesh(geom, mat);
      m.position.set(x, y, z);
      m.castShadow = castShadow;
      m.receiveShadow = true;
      floorGroup.add(m);
      return m;
    };
    // Stone surround: jambs + lintel + chimney breast (pokes above the
    // wall line into the backdrop glow).
    addF(new THREE.BoxGeometry(0.9, 3.4, 1.1), stoneMat, fx - 1.75, 1.7, fz, true);
    addF(new THREE.BoxGeometry(0.9, 3.4, 1.1), stoneMat, fx + 1.75, 1.7, fz, true);
    addF(new THREE.BoxGeometry(4.4, 0.8, 1.2), stoneMat, fx, 3.8, fz, true);
    addF(new THREE.BoxGeometry(3.6, 5.6, 0.95), stoneMat, fx, 7.0, fz - 0.05);
    // Hearth slab the fire sits on.
    addF(new THREE.BoxGeometry(4.2, 0.25, 1.8), stoneMat, fx, 0.125, fz + 0.45);
    // Firebox: near-black interior so the flames have a void to live in.
    const fireboxMat = track(
      new THREE.MeshStandardMaterial({ color: 0x0a0604, roughness: 1 }),
    );
    addF(new THREE.BoxGeometry(3.0, 2.9, 0.7), fireboxMat, fx, 1.7, fz - 0.15);
    // Glowing log + embers (emissive — bloom feeds on these in Phase B).
    const logMat = track(
      new THREE.MeshStandardMaterial({
        color: 0x2a1208,
        roughness: 1,
        emissive: 0xb33c08,
        emissiveIntensity: 0.7,
      }),
    );
    const logGeom = new THREE.CylinderGeometry(0.16, 0.16, 1.9, 8);
    track(logGeom);
    const log = new THREE.Mesh(logGeom, logMat);
    log.rotation.z = Math.PI / 2;
    log.position.set(fx, 0.42, fz + 0.2);
    floorGroup.add(log);
    const emberGeom = new THREE.PlaneGeometry(2.0, 0.6);
    track(emberGeom);
    const ember = new THREE.Mesh(emberGeom, emberMat);
    ember.rotation.x = -Math.PI / 2;
    ember.position.set(fx, 0.27, fz + 0.3);
    floorGroup.add(ember);
    // Layered flame sprites.
    const f1 = makeFlameSprite(2.1, 0.9);
    f1.position.set(fx, 1.5, fz + 0.25);
    const f2 = makeFlameSprite(1.4, 0.75);
    f2.position.set(fx - 0.5, 1.15, fz + 0.3);
    const f3 = makeFlameSprite(1.2, 0.75);
    f3.position.set(fx + 0.55, 1.1, fz + 0.3);
    fire.sprites.push(f1, f2, f3);
    floorGroup.add(f1, f2, f3);
    for (const s of fire.sprites) track(s.material);
    // The fire light itself.
    fire.light.position.set(fx, 1.8, fz + 1.3);
    fire.light.castShadow = false; // second shadow map not worth the cost
    floorGroup.add(fire.light);
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
    const addG = (
      geom: THREE.BufferGeometry,
      mat: THREE.Material,
      x: number,
      y: number,
      z: number,
      ry = 0,
    ) => {
      track(geom);
      const m = new THREE.Mesh(geom, mat);
      m.position.set(x, y, z);
      m.rotation.y = ry;
      m.receiveShadow = true;
      floorGroup.add(m);
      return m;
    };
    // A second, taller table + bench on the right, deep in shadow — its
    // top clears the gaming table's occlusion line so the silhouette and
    // mug glint actually read.
    addG(new THREE.BoxGeometry(3.4, 0.2, 1.9), beamMat, 8.6, 2.0, -10.2, -0.35);
    addG(new THREE.BoxGeometry(0.18, 2.0, 0.18), beamMat, 7.4, 1.0, -10.7, -0.35);
    addG(new THREE.BoxGeometry(0.18, 2.0, 0.18), beamMat, 9.7, 1.0, -9.7, -0.35);
    addG(new THREE.BoxGeometry(3.0, 0.14, 0.55), beamMat, 8.0, 1.15, -8.9, -0.35);
    addG(new THREE.CylinderGeometry(0.15, 0.17, 0.36, 10), pewterMat, 8.4, 2.28, -10.0);
    addG(new THREE.CylinderGeometry(0.1, 0.13, 0.58, 10), darkGlassMat, 9.1, 2.39, -10.4);

    // Shelf on the back wall with bottles (wall-mounted, above the table
    // occlusion line).
    addG(new THREE.BoxGeometry(4.2, 0.12, 0.5), beamMat, 6.4, 3.4, -13.0);
    for (const [bx, h] of [
      [5.0, 0.62],
      [5.8, 0.5],
      [6.7, 0.66],
      [7.6, 0.55],
    ] as Array<[number, number]>) {
      addG(new THREE.CylinderGeometry(0.11, 0.14, h, 10), darkGlassMat, bx, 3.46 + h / 2, -13.0);
    }

    // A barrel against the right wall.
    const barrel = addG(
      new THREE.CylinderGeometry(0.85, 0.95, 2.1, 14),
      beamMat,
      11.5,
      1.05,
      -7.5,
    );
    barrel.castShadow = true;
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
    // Candle cluster, left of the tray — pushed out so the seated shot's
    // close perspective doesn't blow them up. Slim, warm-dimmed wax.
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
  // DUST MOTES — floating in the warm light. Additive points, slow drift.
  // ==========================================================================
  const MOTE_COUNT = 54;
  const moteBase = new Float32Array(MOTE_COUNT * 3);
  const motePos = new Float32Array(MOTE_COUNT * 3);
  for (let i = 0; i < MOTE_COUNT; i++) {
    // Motes live ONLY where light lives — fire, chandelier, table candles.
    // Scattered over the whole table they read as specks on the wood.
    const cluster = i % 3;
    if (cluster === 0) {
      // fireplace column
      moteBase[i * 3] = -6.2 + (Math.random() - 0.5) * 2.6;
      moteBase[i * 3 + 1] = 0.4 + Math.random() * 3.2;
      moteBase[i * 3 + 2] = -11.5 + Math.random() * 2.0;
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
      const base = i === 0 ? 2.1 : i === 1 ? 1.4 : 1.2;
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

  const dispose = () => {
    for (const d of disposables) d.dispose();
  };

  return { group, tick, dispose };
}
