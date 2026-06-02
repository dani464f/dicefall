import * as THREE from 'three';
import { getFaceEntries } from './faceDetection';
import type { DiceType } from '../types/dice';

/**
 * Bake the dark die color + the gold face number directly into the
 * geometry's per-face materials, the same way D6 already does it. This is
 * the only approach we've found that reliably shows the painted numbers,
 * because there's no transparency / culling / orientation logic involved —
 * it just goes through the standard three.js indexed-material path.
 *
 * For each die type:
 *   - We compute, for each triangle in the buffer, which logical face it
 *     belongs to by matching its computed normal against the face-detection
 *     table.
 *   - We convert the geometry to non-indexed so we can set per-triangle UVs.
 *   - We set each triangle's UVs so the texture displays as a triangle
 *     filling the face.
 *   - We add a geometry group per triangle pointing to its face's material
 *     index, and build a materials array — one per face — with the face's
 *     value painted in gold on the die's base color.
 *
 * D6 is excluded; it has its own pip-based per-face materials.
 */

const DIE_BG = '#1c1410';
const DIE_INK = '#f1ce85';

const FACE_TEXTURES = new Map<string, THREE.CanvasTexture>();

function createTriangleFaceTexture(value: number): THREE.CanvasTexture {
  const cacheKey = `${value}`;
  const cached = FACE_TEXTURES.get(cacheKey);
  if (cached) return cached;

  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');

  // Fill with the die's base color so the texture seamlessly becomes the
  // face's surface — no transparent edges, no halos.
  ctx.fillStyle = DIE_BG;
  ctx.fillRect(0, 0, size, size);

  // Triangle UVs we'll use put:
  //   v0 (apex)        at (0.5, 0.05)
  //   v1 (bottom-left) at (0.05, 0.95)
  //   v2 (bottom-right) at (0.95, 0.95)
  // i.e. the texture's upper area is the apex region of the triangle.
  // We center the glyph in the triangle's centroid, which in this UV layout
  // is roughly (0.5, 0.65).
  const cx = size * 0.5;
  const cy = size * 0.62;

  ctx.fillStyle = DIE_INK;
  const px =
    value >= 100 ? size * 0.34 : value >= 10 ? size * 0.42 : size * 0.5;
  ctx.font = `800 ${Math.round(px)}px Georgia, "Times New Roman", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(value), cx, cy);

  // Underline ambiguous numerals (6 / 9 / 11) so orientation is clear.
  if (value === 6 || value === 9 || value === 11) {
    const w = px * 0.55;
    const h = px * 0.08;
    ctx.fillRect(cx - w / 2, cy + px * 0.4, w, h);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  tex.anisotropy = 4;
  FACE_TEXTURES.set(cacheKey, tex);
  return tex;
}

/**
 * For each triangle in `geom`, find the face entry whose outward normal it
 * matches best. Returns an array of length triangleCount, where each entry
 * is an index into `entries`.
 */
function computeTriangleFaceMapping(
  geom: THREE.BufferGeometry,
  entries: ReadonlyArray<{ localNormal: THREE.Vector3 }>,
): number[] {
  const pos = geom.attributes.position as THREE.BufferAttribute;
  const idx = geom.index;
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  const mapping: number[] = new Array(triCount);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const n = new THREE.Vector3();

  const getIdx = (i: number) => (idx ? idx.getX(i) : i);

  for (let t = 0; t < triCount; t++) {
    a.fromBufferAttribute(pos, getIdx(t * 3));
    b.fromBufferAttribute(pos, getIdx(t * 3 + 1));
    c.fromBufferAttribute(pos, getIdx(t * 3 + 2));
    e1.subVectors(b, a);
    e2.subVectors(c, a);
    n.crossVectors(e1, e2).normalize();

    let bestIdx = 0;
    let bestDot = -Infinity;
    for (let f = 0; f < entries.length; f++) {
      const d = entries[f].localNormal.dot(n);
      if (d > bestDot) {
        bestDot = d;
        bestIdx = f;
      }
    }
    mapping[t] = bestIdx;
  }
  return mapping;
}

export interface FaceMaterialBundle {
  /** The reworked geometry — non-indexed, with per-triangle groups + UVs. */
  geom: THREE.BufferGeometry;
  /** One material per face entry, indexed parallel to entries. */
  materials: THREE.MeshStandardMaterial[];
}

/**
 * Build a geometry + materials array such that each face of the die shows
 * its actual detected value, baked into the surface.
 *
 * Returns null for types that should keep their existing material setup
 * (D6 has its own pip-baked path).
 */
export function buildFaceBakedDie(
  diceType: DiceType,
  baseGeom: THREE.BufferGeometry,
): FaceMaterialBundle | null {
  if (diceType === 'd6') return null;
  const entries = getFaceEntries(diceType);
  if (!entries || entries.length === 0) return null;

  const mapping = computeTriangleFaceMapping(baseGeom, entries);

  // Convert to non-indexed so we can give each triangle its own UVs.
  const geom = baseGeom.index ? baseGeom.toNonIndexed() : baseGeom.clone();
  baseGeom.dispose();

  const triCount = geom.attributes.position.count / 3;
  const uvs = new Float32Array(geom.attributes.position.count * 2);
  for (let t = 0; t < triCount; t++) {
    const v0 = t * 3;
    const v1 = t * 3 + 1;
    const v2 = t * 3 + 2;
    // v0 = apex (top center)
    uvs[v0 * 2] = 0.5;
    uvs[v0 * 2 + 1] = 0.05;
    // v1 = bottom-left
    uvs[v1 * 2] = 0.05;
    uvs[v1 * 2 + 1] = 0.95;
    // v2 = bottom-right
    uvs[v2 * 2] = 0.95;
    uvs[v2 * 2 + 1] = 0.95;
  }
  geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

  geom.clearGroups();
  for (let t = 0; t < triCount; t++) {
    geom.addGroup(t * 3, 3, mapping[t]);
  }
  geom.computeVertexNormals();

  const materials = entries.map(
    (entry) =>
      new THREE.MeshStandardMaterial({
        map: createTriangleFaceTexture(entry.value),
        roughness: 0.32,
        metalness: 0.45,
      }),
  );

  return { geom, materials };
}

export function disposeFaceMaterials(materials: THREE.MeshStandardMaterial[]) {
  for (const m of materials) m.dispose();
  // Textures are cached & shared across throws — don't dispose them here.
}
