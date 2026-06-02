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

  // Top 5 kite faces: each face = top + upper[i] + lower[i] + upper[(i+1)%5]
  // Triangulated CCW from outside.
  for (let i = 0; i < 5; i++) {
    const ui = 1 + i;
    const uNext = 1 + ((i + 1) % 5);
    const li = 6 + i; // the lower-ring vertex sitting between ui and uNext angularly
    indices.push(TOP, ui, li);
    indices.push(TOP, li, uNext);
  }
  // Bottom 5 kite faces: each face = bottom + lower[i] + upper[(i+1)%5] + lower[(i+1)%5]
  // Triangulated CCW from outside.
  for (let i = 0; i < 5; i++) {
    const li = 6 + i;
    const lNext = 6 + ((i + 1) % 5);
    const uNext = 1 + ((i + 1) % 5);
    indices.push(BOTTOM, lNext, uNext);
    indices.push(BOTTOM, uNext, li);
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
