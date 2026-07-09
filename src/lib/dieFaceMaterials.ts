import * as THREE from 'three';
import { getFaceEntries, type FaceTableKey } from './faceDetection';
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
// Numeral paint radiance is bloom-critical: at #f1ce85 the nearest dice
// to the candle key reflected over the 1.35 bloom bar and every numeral
// grew a halo ("weird light reflections", user report #3). Paint and key
// intensity (sceneResolver, 130) are tuned as a pair to stay under the
// bar at the closest tray position. Contrast on near-black faces is
// unaffected.
const DIE_INK = '#d0b273';

const FACE_TEXTURES = new Map<string, THREE.CanvasTexture>();

// ---------------------------------------------------------------------------
// EDGE-BEVEL NORMAL MAPS — the anti-"razor-sharp CG edge" trick. A band
// along each face's UV border bends the shading normal outward, so light
// wraps the rim exactly like a physical die's rounded edge, without any
// geometry change. Two shared maps cover every polyhedral die:
//   - triangle pillow: d4 / d8 / d20 (equilateral UV per face)
//   - radial pillow:   d12 pentagons + d10/d100 kites (radial UVs
//     converging at (0.5, 0.5) with perimeter at radius UV_R)
// Normal maps sample in LINEAR space (no SRGB tag). Bend math runs in UV
// space (v up); pixels write at y = (1 - v) to match flipY sampling.
// ---------------------------------------------------------------------------
const BEVEL_BAND = 0.085; // UV width of the rounded rim
const BEVEL_MAX = 0.6; // max tangent-space deflection (sin of bend angle)

function encodeNormalPixel(
  data: Uint8ClampedArray,
  idx: number,
  nx: number,
  ny: number,
  nz: number,
): void {
  data[idx] = Math.round((nx * 0.5 + 0.5) * 255);
  data[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
  data[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
  data[idx + 3] = 255;
}

function bevelRamp(distInsideEdge: number): number {
  // 0 at band's inner boundary → BEVEL_MAX at the edge itself.
  if (distInsideEdge > BEVEL_BAND) return 0;
  const t = 1 - distInsideEdge / BEVEL_BAND;
  return Math.pow(t, 1.7) * BEVEL_MAX;
}

let TRI_PILLOW: THREE.CanvasTexture | null = null;
function getTrianglePillowNormal(): THREE.CanvasTexture {
  if (TRI_PILLOW) return TRI_PILLOW;
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  const verts: Array<[number, number]> = [UV_APEX, UV_BL, UV_BR];
  const cx = 0.5;
  const cy = 0.5;
  // Precompute outward edge normals.
  const edges = verts.map((a, i) => {
    const b = verts[(i + 1) % 3]!;
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const len = Math.hypot(ex, ey);
    let nx = ey / len;
    let ny = -ex / len;
    // Ensure the normal points away from the centroid.
    if (nx * (cx - a[0]) + ny * (cy - a[1]) > 0) {
      nx = -nx;
      ny = -ny;
    }
    return { ax: a[0], ay: a[1], nx, ny };
  });
  for (let py = 0; py < S; py++) {
    const v = 1 - (py + 0.5) / S;
    for (let px = 0; px < S; px++) {
      const u = (px + 0.5) / S;
      // Signed distance to each edge line (negative = inside).
      let best = -Infinity;
      let bx = 0;
      let by = 0;
      for (const e of edges) {
        const d = (u - e.ax) * e.nx + (v - e.ay) * e.ny;
        if (d > best) {
          best = d;
          bx = e.nx;
          by = e.ny;
        }
      }
      const s = best >= 0 ? BEVEL_MAX : bevelRamp(-best);
      const nz = Math.sqrt(Math.max(0, 1 - s * s));
      encodeNormalPixel(img.data, (py * S + px) * 4, bx * s, by * s, nz);
    }
  }
  ctx.putImageData(img, 0, 0);
  TRI_PILLOW = new THREE.CanvasTexture(canvas);
  TRI_PILLOW.needsUpdate = true;
  return TRI_PILLOW;
}

let RADIAL_PILLOW: THREE.CanvasTexture | null = null;
function getRadialPillowNormal(): THREE.CanvasTexture {
  if (RADIAL_PILLOW) return RADIAL_PILLOW;
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  const R = UV_R;
  for (let py = 0; py < S; py++) {
    const v = 1 - (py + 0.5) / S;
    for (let px = 0; px < S; px++) {
      const u = (px + 0.5) / S;
      const dx = u - 0.5;
      const dy = v - 0.5;
      const r = Math.hypot(dx, dy);
      const s = r >= R ? BEVEL_MAX : bevelRamp(R - r);
      const inv = r > 1e-5 ? 1 / r : 0;
      const nz = Math.sqrt(Math.max(0, 1 - s * s));
      encodeNormalPixel(
        img.data,
        (py * S + px) * 4,
        dx * inv * s,
        dy * inv * s,
        nz,
      );
    }
  }
  ctx.putImageData(img, 0, 0);
  RADIAL_PILLOW = new THREE.CanvasTexture(canvas);
  RADIAL_PILLOW.needsUpdate = true;
  return RADIAL_PILLOW;
}

/** Die types whose faces are single UV triangles (vs radial fans). */
const TRIANGLE_FACED: ReadonlySet<DiceType> = new Set<DiceType>([
  'd4',
  'd8',
  'd20',
]);

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

function createTriangleFaceTexture(label: string): THREE.CanvasTexture {
  const cacheKey = label;
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
    label.length >= 3
      ? size * 0.18
      : label.length === 2
        ? size * 0.22
        : size * 0.26;

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
  const metrics = ctx.measureText(label);
  const ascent =
    (metrics as TextMetrics).actualBoundingBoxAscent ?? px * 0.7;
  const descent =
    (metrics as TextMetrics).actualBoundingBoxDescent ?? px * 0.1;
  // Y at which fillText (alphabetic baseline) places the text so the box
  // center is at cy.
  const drawY = cy + (ascent - descent) / 2;

  ctx.fillText(label, cx, drawY);

  // Underline ambiguous numerals (6 / 9 / 11) so orientation is clear. Keyed
  // on the label string: two-digit faces ("60", "90") read unambiguously and
  // aren't underlined; the units die's single "6" / "9" are.
  if (label === '6' || label === '9' || label === '11') {
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
 * For a face made of multiple triangles (pentagon = 5, kite = 2), assign
 * UVs so all triangles converge at the canvas center (0.5, 0.5) at the
 * face's geometric center and fan outward to a shared circle at the
 * perimeter. This way the glyph painted at (0.5, 0.5) appears exactly
 * once at the face center instead of repeating per sub-triangle.
 */
function assignRadialUVs(
  uvs: Float32Array,
  pos: THREE.BufferAttribute,
  triangleIndices: number[],
): void {
  // Collect all vertex positions of this face's triangles.
  const positions: THREE.Vector3[] = [];
  for (const t of triangleIndices) {
    for (let i = 0; i < 3; i++) {
      positions.push(new THREE.Vector3().fromBufferAttribute(pos, t * 3 + i));
    }
  }

  // Dedupe to unique vertex positions so the centroid isn't biased toward
  // shared vertices (e.g. the pentagon center which appears in all 5 tris).
  const seen = new Set<string>();
  const unique: THREE.Vector3[] = [];
  for (const p of positions) {
    const key = `${p.x.toFixed(4)}|${p.y.toFixed(4)}|${p.z.toFixed(4)}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(p);
    }
  }

  const centroid = new THREE.Vector3();
  for (const p of unique) centroid.add(p);
  centroid.divideScalar(unique.length);

  // Face normal from the first triangle's winding. We pushed three
  // vertices into `positions` per triangle in `triangleIndices`, which is
  // non-empty here (multi-triangle face guaranteed).
  const a = positions[0]!;
  const b = positions[1]!;
  const c = positions[2]!;
  const normal = new THREE.Vector3()
    .subVectors(b, a)
    .cross(new THREE.Vector3().subVectors(c, a))
    .normalize();

  // Orthonormal basis in the face plane (any consistent choice works since
  // the glyph at (0.5, 0.5) is rotationally invariant about its center).
  let right = new THREE.Vector3(1, 0, 0);
  if (Math.abs(normal.dot(right)) > 0.95) {
    right = new THREE.Vector3(0, 1, 0);
  }
  right
    .sub(normal.clone().multiplyScalar(right.dot(normal)))
    .normalize();
  const upDir = new THREE.Vector3().crossVectors(normal, right).normalize();

  // Find the farthest perimeter vertex so we can scale UV radii to [0, R].
  let maxDist = 0;
  for (const p of unique) {
    const d = p.distanceTo(centroid);
    if (d > maxDist) maxDist = d;
  }
  if (maxDist < 1e-6) maxDist = 1;

  const R = 0.46; // UV-space radius — small canvas margin for the glyph

  for (let ti = 0; ti < triangleIndices.length; ti++) {
    const t = triangleIndices[ti]!;
    for (let i = 0; i < 3; i++) {
      const p = positions[ti * 3 + i]!;
      const v = p.clone().sub(centroid);
      const x = v.dot(right);
      const y = v.dot(upDir);
      const dist = Math.sqrt(x * x + y * y);
      const idx = (t * 3 + i) * 2;
      if (dist < maxDist * 0.05) {
        // Shared center vertex — all sub-triangles agree on (0.5, 0.5).
        uvs[idx] = 0.5;
        uvs[idx + 1] = 0.5;
      } else {
        const angle = Math.atan2(y, x);
        const r = R * (dist / maxDist);
        uvs[idx] = 0.5 + r * Math.cos(angle);
        // Canvas V grows downward; invert so face-up maps to canvas-up.
        uvs[idx + 1] = 0.5 - r * Math.sin(angle);
      }
    }
  }
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
      const d = entries[f]!.localNormal.dot(n);
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
  opts?: { tableKey?: FaceTableKey; label?: (value: number) => string },
): FaceMaterialBundle | null {
  if (diceType === 'd6') return null;
  // Face values come from `tableKey` (defaults to diceType); the painted
  // glyph comes from `label` (defaults to the plain number). The percentile
  // roles pass a tens table + zero-padded label, or a units table + plain
  // label, while sharing the d100 trapezohedron geometry + bevel path.
  const tableKey = opts?.tableKey ?? diceType;
  const labelFn = opts?.label ?? ((v: number) => String(v));
  const entries = getFaceEntries(tableKey);
  if (!entries || entries.length === 0) return null;

  const mapping = computeTriangleFaceMapping(baseGeom, entries);

  // Convert to non-indexed so we can give each triangle its own UVs.
  const geom = baseGeom.index ? baseGeom.toNonIndexed() : baseGeom.clone();
  baseGeom.dispose();

  // BufferGeometry.attributes is a Record under strict TS — the .position
  // attribute is guaranteed to exist after we built the geometry above.
  const pos = geom.attributes.position! as THREE.BufferAttribute;
  const triCount = pos.count / 3;
  const uvs = new Float32Array(pos.count * 2);

  // Group triangles by face — multi-triangle faces (D12 pentagon = 5 tris,
  // D10/D100 kite = 2 tris) need a shared radial UV layout so the glyph
  // appears once at the face center, not once per sub-triangle.
  const trianglesPerFace = new Map<number, number[]>();
  for (let t = 0; t < triCount; t++) {
    const f = mapping[t]!;
    const arr = trianglesPerFace.get(f);
    if (arr) arr.push(t);
    else trianglesPerFace.set(f, [t]);
  }

  for (const [, tris] of trianglesPerFace) {
    if (tris.length === 1) {
      // Triangular face: keep the centered equilateral UV.
      const t = tris[0]!;
      const v0 = t * 3;
      const v1 = t * 3 + 1;
      const v2 = t * 3 + 2;
      uvs[v0 * 2] = UV_APEX[0];
      uvs[v0 * 2 + 1] = UV_APEX[1];
      uvs[v1 * 2] = UV_BL[0];
      uvs[v1 * 2 + 1] = UV_BL[1];
      uvs[v2 * 2] = UV_BR[0];
      uvs[v2 * 2 + 1] = UV_BR[1];
    } else {
      assignRadialUVs(uvs, pos, tris);
    }
  }

  geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

  geom.clearGroups();
  for (let t = 0; t < triCount; t++) {
    geom.addGroup(t * 3, 3, mapping[t]);
  }
  geom.computeVertexNormals();

  // Physical material with clearcoat — lacquered cast resin. The glint
  // comes from the CLEARCOAT layer catching the point lights; the base
  // layer is kept dielectric and env-quiet. The first cut (metalness
  // 0.42, envMapIntensity 0.9) turned every flat facet into a mirror for
  // the HDRI's tungsten hotspots — whole faces flashed while tumbling
  // and the HDR spikes leaked into the bloom/streak passes ("weird light
  // reflecting effect"). Resin, not chrome.
  // Verified via the __dfDebug frame harness: at roughness 0.42 the
  // 150-intensity candle key painted face-WIDE white speculars on flat
  // facets (GGX lobe covers the whole face when the half-vector aligns),
  // which then leaked into the streak pass as ghost-numeral copies. High
  // roughness + damped specularIntensity keeps faces matte and readable;
  // the remaining sheen comes from the (rough) clearcoat only.
  const bevelNormal = TRIANGLE_FACED.has(diceType)
    ? getTrianglePillowNormal()
    : getRadialPillowNormal();
  const materials = entries.map(
    (entry) =>
      new THREE.MeshPhysicalMaterial({
        map: createTriangleFaceTexture(labelFn(entry.value)),
        // Baked rim bevel — light wraps the face borders like a real
        // die's rounded edge (see the pillow-normal generators above).
        normalMap: bevelNormal,
        roughness: 0.65,
        metalness: 0.1,
        // Second despec pass: with a full tray the nearest faces sit
        // ~4.5u from the key and the clearcoat lobe peaked over the
        // 1.35 bloom bar — whole faces washed into pale glow. Pass-
        // isolated with the frame harness: bloom-off was clean,
        // bloom-on blew, so the fix is keeping face radiance under the
        // bar, not touching the chain.
        specularIntensity: 0.25,
        clearcoat: 0.18,
        clearcoatRoughness: 0.4,
        envMapIntensity: 0.3,
      }),
  );

  return { geom, materials };
}

// NOTE: there is intentionally no dispose helper here anymore. Face-baked
// bundles are cached at module scope in DiceScene (DIE_VISUAL_CACHE) and
// shared across every die of a type for the app lifetime — same pattern as
// FACE_TEXTURES above. Disposing them would break the next throw.
