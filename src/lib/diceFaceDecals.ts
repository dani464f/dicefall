import * as THREE from 'three';
import { getFaceEntries } from './faceDetection';
import type { DiceType } from '../types/dice';

/**
 * Paint each face of a die with its actual detected value using a small
 * OPAQUE gold disc — no transparency, no alphaTest, no culling tricks.
 * The disc is sized to fit safely inside the face boundary so it never
 * leaks over an edge.
 *
 * D6 is excluded — pips are baked into its per-face materials already.
 */

// Plane size per die type, hand-tuned to fit comfortably inside each face's
// inscribed circle (no overhang).
const DECAL_SIZE: Partial<Record<DiceType, number>> = {
  d4: 0.28,
  d8: 0.26,
  d10: 0.28,
  d12: 0.28,
  d20: 0.20,
  d100: 0.28,
};

const DECAL_OFFSET = 1.005;

const BG_GOLD = '#d4af6b';
const BG_GOLD_DARK = '#a8854a';
const INK = '#15090a';

function computeInradius(geom: THREE.BufferGeometry): number {
  const pos = geom.attributes.position as THREE.BufferAttribute;
  const idx = geom.index;
  if (!idx) return 0;
  const a = new THREE.Vector3().fromBufferAttribute(pos, idx.getX(0));
  const b = new THREE.Vector3().fromBufferAttribute(pos, idx.getX(1));
  const c = new THREE.Vector3().fromBufferAttribute(pos, idx.getX(2));
  return a.add(b).add(c).divideScalar(3).length();
}

function createDiscTexture(value: number): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');

  // Filled gold disc background — fully opaque, no transparency edges.
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.46;
  // Outer gradient: brighter gold center, darker edges
  const grad = ctx.createRadialGradient(cx, cy * 0.85, r * 0.2, cx, cy, r);
  grad.addColorStop(0, '#f3cf86');
  grad.addColorStop(0.5, BG_GOLD);
  grad.addColorStop(1, BG_GOLD_DARK);

  // First fill the whole canvas with the disc edge color so the corners of
  // the plane (outside the disc) blend with the rim, hiding the square edge
  // against the dark die surface.
  ctx.fillStyle = BG_GOLD_DARK;
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  // Dark engraved-looking border ring.
  ctx.strokeStyle = '#3a2515';
  ctx.lineWidth = size * 0.02;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  // Number — dark ink so it reads as engraved on the gold disc.
  ctx.fillStyle = INK;
  const px =
    value >= 100 ? size * 0.42 : value >= 10 ? size * 0.5 : size * 0.6;
  ctx.font = `800 ${Math.round(px)}px Georgia, "Times New Roman", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(value), cx, cy + size * 0.025);

  // Tiny underline on numbers that could read upside-down (6, 9, 11).
  if (value === 6 || value === 9 || value === 11) {
    const w = size * 0.15;
    const h = size * 0.022;
    ctx.fillRect((size - w) / 2, size * 0.71, w, h);
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
  material: THREE.MeshStandardMaterial;
  geometry: THREE.PlaneGeometry;
}

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

  const planeSize = DECAL_SIZE[diceType] ?? inradius * 0.45;
  const resources: DecalResource[] = [];

  for (const entry of entries) {
    const tex = createDiscTexture(entry.value);
    // OPAQUE material — solid gold disc baked into the texture. No
    // transparency, no alphaTest. Picks up scene lighting like real metal.
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.35,
      metalness: 0.55,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const planeGeom = new THREE.PlaneGeometry(planeSize, planeSize);
    const decal = new THREE.Mesh(planeGeom, mat);
    decal.position
      .copy(entry.localNormal)
      .multiplyScalar(inradius * DECAL_OFFSET);
    // Plane's +Z onto outward face normal — quaternion math, no lookAt
    // dependencies on parenting state.
    decal.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      entry.localNormal.clone().normalize(),
    );
    decal.castShadow = false;
    decal.receiveShadow = true;
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
