import * as THREE from 'three';
import type { DiceType } from '../types/dice';
import { createPentagonalTrapezohedronGeometry } from './d10Geometry';

/**
 * After a die settles, we read which face is pointing "up" (or "down" for the
 * tetrahedron). This module precomputes a table of face normals in each die's
 * local frame and provides a quaternion → face-value lookup.
 *
 * Coverage:
 *   D6  — hand-coded (BoxGeometry, axis-aligned faces).
 *   D8  — hand-coded (OctahedronGeometry, ±xyz vertices).
 *   D12 — extracted from THREE.DodecahedronGeometry at module load.
 *   D20 — extracted from THREE.IcosahedronGeometry at module load.
 *   D4  — extracted from THREE.TetrahedronGeometry, read the *down* face
 *         (tetrahedrons rest on a face, the apex points up — convention is
 *          face-down value; trivial to flip later if you want a different rule).
 *   D10/D100 — no entry; callers should fall back to RNG until a real
 *              pentagonal-trapezohedron geometry lands.
 */

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const WORLD_DOWN = new THREE.Vector3(0, -1, 0);

interface FaceEntry {
  localNormal: THREE.Vector3;
  value: number;
}

interface DieTable {
  faces: FaceEntry[];
  /** D4 reads the face touching the table; everything else reads the one on top. */
  readDirection: 'up' | 'down';
}

const PHYSICS_DICE: ReadonlySet<DiceType> = new Set<DiceType>([
  'd4',
  'd6',
  'd8',
  'd10',
  'd12',
  'd20',
  'd100',
]);

export function isPhysicsDie(t: DiceType): boolean {
  return PHYSICS_DICE.has(t);
}

// ---------- D6 (BoxGeometry: faces along ±x, ±y, ±z) ----------
const D6: DieTable = {
  readDirection: 'up',
  faces: [
    { localNormal: new THREE.Vector3(0, 1, 0), value: 1 },
    { localNormal: new THREE.Vector3(0, -1, 0), value: 6 },
    { localNormal: new THREE.Vector3(0, 0, 1), value: 2 },
    { localNormal: new THREE.Vector3(0, 0, -1), value: 5 },
    { localNormal: new THREE.Vector3(1, 0, 0), value: 3 },
    { localNormal: new THREE.Vector3(-1, 0, 0), value: 4 },
  ],
};

// ---------- D8 (octahedron vertices at axes; face normals at (±,±,±)/√3) ----------
function buildD8(): DieTable {
  const s = 1 / Math.sqrt(3);
  // Standard D8 convention: opposite faces sum to 9.
  return {
    readDirection: 'up',
    faces: [
      { localNormal: new THREE.Vector3(s, s, s), value: 1 },
      { localNormal: new THREE.Vector3(-s, -s, -s), value: 8 },
      { localNormal: new THREE.Vector3(s, s, -s), value: 2 },
      { localNormal: new THREE.Vector3(-s, -s, s), value: 7 },
      { localNormal: new THREE.Vector3(s, -s, s), value: 3 },
      { localNormal: new THREE.Vector3(-s, s, -s), value: 6 },
      { localNormal: new THREE.Vector3(-s, s, s), value: 4 },
      { localNormal: new THREE.Vector3(s, -s, -s), value: 5 },
    ],
  };
}

// ---------- D12 / D20 / D4: extracted from THREE geometries ----------
function extractUniqueFaceNormals(
  geom: THREE.BufferGeometry,
  expectedCount: number,
): THREE.Vector3[] {
  const pos = geom.attributes.position as THREE.BufferAttribute;
  const idx = geom.index;
  const out: THREE.Vector3[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const n = new THREE.Vector3();

  const consume = (i0: number, i1: number, i2: number) => {
    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1);
    c.fromBufferAttribute(pos, i2);
    e1.subVectors(b, a);
    e2.subVectors(c, a);
    n.crossVectors(e1, e2).normalize();
    if (!out.some((existing) => existing.dot(n) > 0.99)) {
      out.push(n.clone());
    }
  };

  if (idx) {
    for (let i = 0; i < idx.count; i += 3) {
      consume(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2));
    }
  } else {
    for (let i = 0; i < pos.count; i += 3) {
      consume(i, i + 1, i + 2);
    }
  }
  if (out.length !== expectedCount) {
    console.warn(
      `[faceDetection] expected ${expectedCount} face normals, got ${out.length}`,
    );
  }
  return out.slice(0, expectedCount);
}

/**
 * Take a set of face normals and label them so opposite faces sum to N+1
 * (standard die convention). If a normal has no clear opposite (D4), values
 * are assigned sequentially.
 */
function labelFaces(normals: THREE.Vector3[]): FaceEntry[] {
  const n = normals.length;
  const total = n + 1;
  const faces: FaceEntry[] = normals.map((normal) => ({
    localNormal: normal,
    value: 0,
  }));
  const used = new Uint8Array(n);
  let next = 1;
  for (let i = 0; i < n; i++) {
    if (used[i]) continue;
    let best = -1;
    let bestDot = -0.5; // require opposite-ish (dot < -0.5)
    for (let j = i + 1; j < n; j++) {
      if (used[j]) continue;
      const d = normals[i].dot(normals[j]);
      if (d < bestDot) {
        bestDot = d;
        best = j;
      }
    }
    if (best !== -1) {
      faces[i].value = next;
      faces[best].value = total - next;
      used[i] = 1;
      used[best] = 1;
      next++;
    } else {
      faces[i].value = next++;
      used[i] = 1;
    }
  }
  return faces;
}

function buildFromGeometry(
  geom: THREE.BufferGeometry,
  count: number,
  readDirection: 'up' | 'down',
): DieTable {
  const normals = extractUniqueFaceNormals(geom, count);
  geom.dispose();
  return { readDirection, faces: labelFaces(normals) };
}

function buildD10(): DieTable {
  return buildFromGeometry(
    createPentagonalTrapezohedronGeometry(1),
    10,
    'up',
  );
}

function buildD100(): DieTable {
  // Same geometry as D10; each face value × 10 (10, 20, …, 100).
  const base = buildFromGeometry(
    createPentagonalTrapezohedronGeometry(1),
    10,
    'up',
  );
  return {
    readDirection: base.readDirection,
    faces: base.faces.map((f) => ({
      localNormal: f.localNormal,
      value: f.value * 10,
    })),
  };
}

let TABLES: Partial<Record<DiceType, DieTable>> | null = null;
function getTables(): Partial<Record<DiceType, DieTable>> {
  if (TABLES) return TABLES;
  TABLES = {
    d4: buildFromGeometry(new THREE.TetrahedronGeometry(1, 0), 4, 'down'),
    d6: D6,
    d8: buildD8(),
    d10: buildD10(),
    d12: buildFromGeometry(new THREE.DodecahedronGeometry(1, 0), 12, 'up'),
    d20: buildFromGeometry(new THREE.IcosahedronGeometry(1, 0), 20, 'up'),
    d100: buildD100(),
  };
  return TABLES;
}

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

export interface QuatLike {
  x: number;
  y: number;
  z: number;
  w: number;
}

/**
 * Given a rigid body's current rotation, return the face value currently
 * pointing in the read direction, or null if the die is not flat enough
 * (best-face dot product with reference axis < 0.5).
 */
export function getUpwardFaceValue(
  quat: QuatLike,
  diceType: DiceType,
): number | null {
  const table = getTables()[diceType];
  if (!table) return null;
  _q.set(quat.x, quat.y, quat.z, quat.w);
  const ref = table.readDirection === 'up' ? WORLD_UP : WORLD_DOWN;
  let best: FaceEntry | null = null;
  let bestDot = -Infinity;
  for (const face of table.faces) {
    _v.copy(face.localNormal).applyQuaternion(_q);
    const d = _v.dot(ref);
    if (d > bestDot) {
      bestDot = d;
      best = face;
    }
  }
  if (bestDot < 0.5) return null;
  return best?.value ?? null;
}

/**
 * Read-only view of the labeled face entries (normal + value) for a given die
 * type. Used by the scene to paint each face with its actual detected value.
 * Returns null for unrecognized types.
 */
export function getFaceEntries(
  diceType: DiceType,
): ReadonlyArray<{ readonly localNormal: THREE.Vector3; readonly value: number }> | null {
  const table = getTables()[diceType];
  if (!table) return null;
  return table.faces;
}
