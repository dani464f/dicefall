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

/**
 * Equilateral UV triangle centered in the canvas, so the triangle's centroid
 * is at exactly (0.5, 0.5). That lets us paint the glyph at the canvas
 * center and have it land on the face centroid after texture mapping.
 *
 * Equilateral with circumradius `R` around (0.5, 0.5):
 *   apex (top):       (0.5, 0.5 - R)
 *   bottom-left:      (0.5 - R*cos30°, 0.5 + R*sin30°)
 *   bottom-right:     (0.5 + R*cos30°, 0.5 + R*sin30°)
 *
 * R = 0.46 keeps the triangle inside the [0,1] canvas with a small margin.
 */
const UV_R = 0.46;
const UV_COS30 = Math.cos(Math.PI / 6);
const UV_SIN30 = Math.sin(Math.PI / 6);

const UV_APEX: [number, number] = [0.5, 0.5 - UV_R];
const UV_BL: [number, number] = [0.5 - UV_R * UV_COS30, 0.5 + UV_R * UV_SIN30];
const UV_BR: [number, number] = [0.5 + UV_R * UV_COS30, 0.5 + UV_R * UV_SIN30];

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

  // Sized so the glyph fits inside the triangle's inscribed circle.
  // For an equilateral triangle of circumradius R, the inscribed circle
  // radius is R/2 = 0.23 in UV → ~ 59 px on a 256 canvas. Keep the glyph
  // below ~50 px tall so it never leaks across an edge.
  const px =
    value >= 100 ? size * 0.18 : value >= 10 ? size * 0.22 : size * 0.26;

  ctx.fillStyle = DIE_INK;
  ctx.font = `800 ${Math.round(px)}px Georgia, "Times New Roman", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  const cx = size / 2;
  const cy = size / 2;

  // Use the glyph's actual rendered bounding box so the visual center of
  // the digit (not the EM box center) lands on the face centroid.
  // Some browsers don't expose the actualBoundingBox* values; fall back to
  // an approximate offset (~22 % of font px) that works for most serif
  // digits when those metrics are missing.
  const metrics = ctx.measureText(String(value));
  const ascent =
    (metrics as TextMetrics).actualBoundingBoxAscent ?? px * 0.7;
  const descent =
    (metrics as TextMetrics).actualBoundingBoxDescent ?? px * 0.1;
  // Y at which fillText (alphabetic baseline) places the text so the box
  // center is at cy.
  const drawY = cy + (ascent - descent) / 2;

  ctx.fillText(String(value), cx, drawY);

  // Underline ambiguous numerals (6 / 9 / 11) so orientation is clear.
  if (value === 6 || value === 9 || value === 11) {
    const w = px * 0.45;
    const h = px * 0.08;
    // Position just under the glyph descender, still inside the triangle.
    ctx.fillRect(cx - w / 2, drawY + descent + size * 0.012, w, h);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  tex.anisotropy = 8;
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
    // Equilateral UV triangle whose centroid is at (0.5, 0.5).
    uvs[v0 * 2] = UV_APEX[0];
    uvs[v0 * 2 + 1] = UV_APEX[1];
    uvs[v1 * 2] = UV_BL[0];
    uvs[v1 * 2 + 1] = UV_BL[1];
    uvs[v2 * 2] = UV_BR[0];
    uvs[v2 * 2 + 1] = UV_BR[1];
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
