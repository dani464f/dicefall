import * as THREE from 'three';

/**
 * Pentagonal trapezohedron — the standard "D10" shape.
 *   - 2 apex vertices (top + bottom)
 *   - 10 belt vertices in a zigzag (5 upper at angles 0°/72°/144°/216°/288°,
 *     5 lower offset by 36°)
 *   - 10 kite-shaped faces, each split into 2 triangles in the buffer
 *
 * The same shape is used for D100; only the face-value labeling differs.
 */

const APEX_RATIO = 1.0;
const BELT_RADIUS_RATIO = 0.66;
const BELT_HEIGHT_RATIO = 0.16;

function buildPositions(radius: number): number[] {
  const apex = radius * APEX_RATIO;
  const r = radius * BELT_RADIUS_RATIO;
  const h = radius * BELT_HEIGHT_RATIO;
  const positions: number[] = [];

  // v0: top apex
  positions.push(0, apex, 0);
  // v1..v5: upper ring at angles 0°, 72°, 144°, 216°, 288°
  for (let i = 0; i < 5; i++) {
    const a = (i * 72) * (Math.PI / 180);
    positions.push(r * Math.cos(a), h, r * Math.sin(a));
  }
  // v6..v10: lower ring at angles 36°, 108°, 180°, 252°, 324°
  for (let i = 0; i < 5; i++) {
    const a = (i * 72 + 36) * (Math.PI / 180);
    positions.push(r * Math.cos(a), -h, r * Math.sin(a));
  }
  // v11: bottom apex
  positions.push(0, -apex, 0);
  return positions;
}

export function createPentagonalTrapezohedronGeometry(
  radius: number,
): THREE.BufferGeometry {
  const positions = buildPositions(radius);

  const indices: number[] = [];
  const TOP = 0;
  const BOTTOM = 11;

  // Top 5 kite faces. Wound CCW *from outside* so the cross product points
  // outward (was CW — previously made D10/D100 back-culled and inverted the
  // face-detection result to 11−N / 110−N).
  for (let i = 0; i < 5; i++) {
    const ui = 1 + i;
    const uNext = 1 + ((i + 1) % 5);
    const li = 6 + i; // the lower-ring vertex sitting between ui and uNext angularly
    indices.push(TOP, li, ui);
    indices.push(TOP, uNext, li);
  }
  // Bottom 5 kite faces. Same winding swap as the top loop — produces an
  // outward-pointing normal for each face under the right-hand rule.
  for (let i = 0; i < 5; i++) {
    const li = 6 + i;
    const lNext = 6 + ((i + 1) % 5);
    const uNext = 1 + ((i + 1) % 5);
    indices.push(BOTTOM, uNext, lNext);
    indices.push(BOTTOM, li, uNext);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

/**
 * Flat (x,y,z) array of the 12 hull vertices for use as a Rapier convex-hull
 * collider.
 */
export function getPentagonalTrapezohedronVertices(
  radius: number,
): Float32Array {
  return new Float32Array(buildPositions(radius));
}

/**
 * Outward-pointing normal for each of the 10 kite faces, in geometry order:
 * top kites i=0..4 first (around the polar axis, CCW from above), then
 * bottom kites i=0..4. Used by face detection — see explanation below.
 *
 * The kite faces in this geometry are NOT planar. With our ratios
 * (apex 1.0, belt-radius 0.66, belt-height 0.16) the four kite vertices
 * sit ~6 % off coplanar, so the two triangles a kite gets sliced into
 * have normals that disagree by ~10°.
 *
 * The generic face-normal extractor in faceDetection.ts dedupes triangle
 * normals at `dot > 0.99`, which is too strict — each kite ends up as
 * two separate "faces" instead of one. Without this helper, D10 reads
 * its result from one of 20 entries (values 1–20) and the kite at top
 * shows two different glyphs.
 *
 * The fix: define each face's normal as the unit vector from the die
 * centre to the face's 4-vertex centroid. For a convex body centred
 * at origin, that's the canonical outward normal anyway, and the
 * triangle normals of either sub-triangle land near this direction
 * (closest-match in dieFaceMaterials still maps both correctly).
 */
export function getPentagonalTrapezohedronFaceNormals(): Float32Array {
  const apex = APEX_RATIO;
  const r = BELT_RADIUS_RATIO;
  const h = BELT_HEIGHT_RATIO;
  const upper: Array<[number, number, number]> = [];
  const lower: Array<[number, number, number]> = [];
  for (let i = 0; i < 5; i++) {
    const a = (i * 72) * (Math.PI / 180);
    upper.push([r * Math.cos(a), h, r * Math.sin(a)]);
  }
  for (let i = 0; i < 5; i++) {
    const a = (i * 72 + 36) * (Math.PI / 180);
    lower.push([r * Math.cos(a), -h, r * Math.sin(a)]);
  }
  const TOP: [number, number, number] = [0, apex, 0];
  const BOTTOM: [number, number, number] = [0, -apex, 0];

  const out = new Float32Array(10 * 3);
  let cursor = 0;
  const pushCentroidUnit = (
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    d: [number, number, number],
  ) => {
    const cx = (a[0] + b[0] + c[0] + d[0]) / 4;
    const cy = (a[1] + b[1] + c[1] + d[1]) / 4;
    const cz = (a[2] + b[2] + c[2] + d[2]) / 4;
    const m = Math.hypot(cx, cy, cz) || 1;
    out[cursor++] = cx / m;
    out[cursor++] = cy / m;
    out[cursor++] = cz / m;
  };

  // Top kites: TOP + lower(i) + upper(i) + upper(i+1) — same vertex set the
  // index buffer uses, just summed instead of split into two triangles.
  for (let i = 0; i < 5; i++) {
    pushCentroidUnit(TOP, lower[i]!, upper[i]!, upper[(i + 1) % 5]!);
  }
  // Bottom kites: BOTTOM + upper(i+1) + lower(i+1) + lower(i).
  for (let i = 0; i < 5; i++) {
    pushCentroidUnit(
      BOTTOM,
      upper[(i + 1) % 5]!,
      lower[(i + 1) % 5]!,
      lower[i]!,
    );
  }
  return out;
}
