import * as THREE from 'three';
import type { Rapier } from './physics';
import type { DiceType } from '../types/dice';
import {
  createPentagonalTrapezohedronGeometry,
  getPentagonalTrapezohedronVertices,
} from './d10Geometry';
import { createD6Materials } from './diceFaceTextures';
import { buildFaceBakedDie } from './dieFaceMaterials';

/**
 * Die-side assets shared across every throw for the app lifetime:
 * geometry, face-baked visuals, physics collider descriptors, and the
 * settled-die AO decal. Extracted from DiceScene.tsx so the scene file
 * owns orchestration, not asset construction.
 *
 * Everything here is module-scope cached — geometries and materials are
 * shared across meshes (three.js supports this explicitly), and Rapier
 * clones vertex buffers into WASM when building hulls, so caching the
 * source arrays is safe.
 */

// ---------------------------------------------------------------------------
// Render geometry
// ---------------------------------------------------------------------------

export function createGeometry(type: DiceType): THREE.BufferGeometry {
  switch (type) {
    case 'd4':
      return new THREE.TetrahedronGeometry(0.58);
    case 'd6':
      return new THREE.BoxGeometry(0.75, 0.75, 0.75);
    case 'd8':
      return new THREE.OctahedronGeometry(0.6);
    case 'd10':
    case 'd100':
      return createPentagonalTrapezohedronGeometry(0.6);
    case 'd12':
      return new THREE.DodecahedronGeometry(0.55);
    case 'd20':
      return new THREE.IcosahedronGeometry(0.6);
  }
}

// ---------------------------------------------------------------------------
// Shared face-baked visuals (one geometry + materials set per die type)
// ---------------------------------------------------------------------------

export interface DieVisual {
  geom: THREE.BufferGeometry;
  materials: THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[];
}

/** Visual keys extend DiceType with the two internal percentile roles —
 *  each is a d100 trapezohedron with a distinct face-label set. */
export type DieVisualKey = DiceType | 'd100tens' | 'd100units';

const DIE_VISUAL_CACHE = new Map<DieVisualKey, DieVisual>();

export function getSharedDieVisual(type: DieVisualKey): DieVisual | null {
  const cached = DIE_VISUAL_CACHE.get(type);
  if (cached) return cached;
  // Percentile roles: same geometry as d100, different painted faces —
  // tens die reads/shows 00–90, units die 0–9.
  if (type === 'd100tens' || type === 'd100units') {
    const rawGeom = createGeometry('d100');
    const label =
      type === 'd100tens'
        ? (v: number) => String(v).padStart(2, '0')
        : (v: number) => String(v);
    const bundle = buildFaceBakedDie('d100', rawGeom, { tableKey: type, label });
    if (!bundle) return null;
    const visual = { geom: bundle.geom, materials: bundle.materials };
    DIE_VISUAL_CACHE.set(type, visual);
    return visual;
  }
  const rawGeom = createGeometry(type);
  if (type === 'd6') {
    // Pip-baked BoxGeometry path; materials are themselves module-shared
    // inside diceFaceTextures.
    const visual = { geom: rawGeom, materials: createD6Materials() };
    DIE_VISUAL_CACHE.set(type, visual);
    return visual;
  }
  const bundle = buildFaceBakedDie(type, rawGeom);
  if (!bundle) return null; // caller falls back to per-die plain material
  const visual = { geom: bundle.geom, materials: bundle.materials };
  DIE_VISUAL_CACHE.set(type, visual);
  return visual;
}

// ---------------------------------------------------------------------------
// Physics collider descriptors
// ---------------------------------------------------------------------------

/**
 * Lazily-built, module-scoped Float32Array per die type for the convex-
 * hull collider. Building fresh THREE geometries per die was 20 allocs +
 * disposes per 20-die roll.
 */
const HULL_VERT_CACHE = new Map<DiceType, Float32Array>();

function getHullVerts(type: DiceType): Float32Array | null {
  const cached = HULL_VERT_CACHE.get(type);
  if (cached) return cached;
  let geom: THREE.BufferGeometry | null = null;
  switch (type) {
    case 'd4':
      geom = new THREE.TetrahedronGeometry(0.58);
      break;
    case 'd8':
      geom = new THREE.OctahedronGeometry(0.6);
      break;
    case 'd12':
      geom = new THREE.DodecahedronGeometry(0.55);
      break;
    case 'd20':
      geom = new THREE.IcosahedronGeometry(0.6);
      break;
    default:
      return null;
  }
  const pos = geom.attributes.position as THREE.BufferAttribute;
  const verts = new Float32Array(pos.array as ArrayLike<number>);
  geom.dispose();
  HULL_VERT_CACHE.set(type, verts);
  return verts;
}

/** Collider edge rounding. Real dice have soft edges — a rounded hull
 *  rolls over its edges instead of pivoting on razor-sharp vertices, so
 *  dice tumble a beat longer and settle with less "clack-stop". Rapier's
 *  round shapes INFLATE outward by the radius; 0.025 on a 0.55–0.6 die
 *  is ~4%, well inside the settle-ceiling margin (DIE_RADIUS × 1.5). */
export const HULL_BEVEL = 0.025;

export function createColliderDesc(
  rapier: Rapier,
  type: DiceType,
): InstanceType<Rapier['ColliderDesc']> {
  if (type === 'd6') {
    // Shrink the half-extents by the bevel so the inflated shape matches
    // the visual cube instead of outgrowing it.
    const h = 0.375 - HULL_BEVEL;
    return rapier.ColliderDesc.roundCuboid(h, h, h, HULL_BEVEL);
  }
  if (type === 'd10' || type === 'd100') {
    const verts = getPentagonalTrapezohedronVertices(0.6);
    return (
      rapier.ColliderDesc.roundConvexHull(verts, HULL_BEVEL) ??
      rapier.ColliderDesc.convexHull(verts) ??
      rapier.ColliderDesc.ball(0.55)
    );
  }
  const verts = getHullVerts(type);
  if (!verts) return rapier.ColliderDesc.ball(0.55);
  const fallbackRadius = type === 'd4' ? 0.45 : 0.55;
  return (
    rapier.ColliderDesc.roundConvexHull(verts, HULL_BEVEL) ??
    rapier.ColliderDesc.convexHull(verts) ??
    rapier.ColliderDesc.ball(fallbackRadius)
  );
}

/** Approximate bounding radius per die — used to derive the per-die
 *  settle-Y ceiling so a leaning D20 or D4 isn't measured against D6's
 *  half-edge. */
export const DIE_RADIUS: Record<DiceType, number> = {
  d4: 0.58,
  d6: 0.375,
  d8: 0.6,
  d10: 0.6,
  d12: 0.55,
  d20: 0.6,
  d100: 0.6,
};

// ---------------------------------------------------------------------------
// Settled-die AO grounding decal (shared texture / geometry / material)
// ---------------------------------------------------------------------------

let AO_DECAL_TEX: THREE.CanvasTexture | null = null;
function getAODecalTexture(): THREE.CanvasTexture {
  if (AO_DECAL_TEX) return AO_DECAL_TEX;
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.28)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  AO_DECAL_TEX = new THREE.CanvasTexture(canvas);
  return AO_DECAL_TEX;
}

const AO_DECAL_GEOM = new THREE.PlaneGeometry(1, 1);
const AO_DECAL_MAT = new THREE.MeshBasicMaterial({
  map: null, // set lazily — canvas needs the DOM
  transparent: true,
  depthWrite: false,
  fog: false,
});

/** Build a grounding decal under a settled die. Geometry/material/texture
 *  are shared — callers only add/remove the returned mesh. */
export function createAODecal(
  x: number,
  z: number,
  type: DiceType,
): THREE.Mesh {
  if (!AO_DECAL_MAT.map) {
    AO_DECAL_MAT.map = getAODecalTexture();
    AO_DECAL_MAT.needsUpdate = true;
  }
  const decal = new THREE.Mesh(AO_DECAL_GEOM, AO_DECAL_MAT);
  decal.rotation.x = -Math.PI / 2;
  decal.position.set(x, 0.012, z);
  const s = DIE_RADIUS[type] * 3.1;
  decal.scale.set(s, s, 1);
  return decal;
}
