import * as THREE from 'three';
import { getFaceEntries } from './faceDetection';
import type { DiceType } from '../types/dice';

/**
 * Paint the actual face value of each die directly onto each face, using the
 * same face-entry table that drives result detection — so the value visible
 * on top of a settled die is always what the scene reports.
 *
 * D6 is excluded (its pips are baked into the BoxGeometry per-face materials).
 */

// Decal plane size per die type. Sized to comfortably fit the inscribed
// circle of each face — small enough not to leak over an edge, large enough
// to read from camera distance. (Bumped up — readability beats overflow.)
const DECAL_SIZE: Partial<Record<DiceType, number>> = {
  d4: 0.55,
  d8: 0.48,
  d10: 0.48,
  d12: 0.48,
  d20: 0.40,
  d100: 0.48,
};

// Push the decal noticeably outside the face plane so it can't z-fight with
// the die's surface even on faces seen at glancing angles. The disc is small
// relative to the die so the offset doesn't read as "floating".
const DECAL_OFFSET = 1.06;

function computeInradius(geom: THREE.BufferGeometry): number {
  const pos = geom.attributes.position as THREE.BufferAttribute;
  const idx = geom.index;
  if (!idx) return 0;
  const a = new THREE.Vector3().fromBufferAttribute(pos, idx.getX(0));
  const b = new THREE.Vector3().fromBufferAttribute(pos, idx.getX(1));
  const c = new THREE.Vector3().fromBufferAttribute(pos, idx.getX(2));
  return a.add(b).add(c).divideScalar(3).length();
}

function paintNumber(value: number): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');

  // Transparent background — only the digits get painted, the die's surface
  // shows through everywhere else.
  ctx.clearRect(0, 0, size, size);

  // Bright gold glyph engraved into the polished black die. No disc backing —
  // we want the number to read as engraved metal, not a sticker.
  ctx.fillStyle = '#f3cf86';
  const px =
    value >= 100 ? size * 0.36 : value >= 10 ? size * 0.46 : size * 0.56;
  ctx.font = `700 ${Math.round(px)}px Georgia, "Times New Roman", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(value), size / 2, size / 2 + size * 0.04);

  // For 6 and 9 — and any number that could read upside-down — underline the
  // glyph so orientation is unambiguous.
  const ambiguous = value === 6 || value === 9 || value === 11;
  if (ambiguous) {
    const w = size * 0.22;
    const h = size * 0.025;
    const x = (size - w) / 2;
    const y = size * 0.74;
    ctx.fillRect(x, y, w, h);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  tex.anisotropy = 4;
  return tex;
}

interface DecalResource {
  mesh: THREE.Mesh;
  texture: THREE.CanvasTexture;
  material: THREE.MeshBasicMaterial;
  geometry: THREE.PlaneGeometry;
}

/**
 * Add a textured plane to each face of the die mesh, showing the face's
 * assigned value. Returns the decal resources so they can be disposed when
 * the die is removed.
 */
export function paintFaceDecals(
  parent: THREE.Mesh,
  diceType: DiceType,
  geom: THREE.BufferGeometry,
): DecalResource[] {
  if (diceType === 'd6') return [];
  const entries = getFaceEntries(diceType);
  if (!entries) return [];

  const inradius = computeInradius(geom);
  if (inradius <= 0) return [];

  const planeSize = DECAL_SIZE[diceType] ?? inradius * 0.7;
  const resources: DecalResource[] = [];

  for (const entry of entries) {
    const tex = paintNumber(entry.value);
    // MeshBasicMaterial so the ink is always at its painted color, not
    // washed out by the die's shadow side. DoubleSide so culling never hides
    // the decal regardless of how lookAt() oriented the plane.
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      alphaTest: 0.08,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const planeGeom = new THREE.PlaneGeometry(planeSize, planeSize);
    const decal = new THREE.Mesh(planeGeom, mat);
    // Position outside the face surface
    decal.position.copy(entry.localNormal).multiplyScalar(inradius * DECAL_OFFSET);
    // Orient so the plane lies flush with the face. Build the quaternion
    // directly: rotate the plane's default normal (0,0,1) onto the outward
    // face normal. (Robust even when the decal isn't yet parented.)
    decal.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      entry.localNormal.clone().normalize(),
    );
    decal.castShadow = false;
    decal.receiveShadow = false;
    decal.renderOrder = 2;

    parent.add(decal);
    resources.push({
      mesh: decal,
      texture: tex,
      material: mat,
      geometry: planeGeom,
    });
  }

  return resources;
}

export function disposeFaceDecals(resources: DecalResource[]): void {
  for (const r of resources) {
    r.mesh.parent?.remove(r.mesh);
    r.geometry.dispose();
    r.texture.dispose();
    r.material.dispose();
  }
}
