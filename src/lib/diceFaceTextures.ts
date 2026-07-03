import * as THREE from 'three';

/**
 * Build a 6-material array for a D6 BoxGeometry, with each face showing its
 * D6-convention number (opposite faces sum to 7). The numbers are drawn onto
 * canvas textures so we don't ship image assets.
 *
 * BoxGeometry material order (three.js convention):
 *   0: +X (right)   1: -X (left)
 *   2: +Y (top)     3: -Y (bottom)
 *   4: +Z (front)   5: -Z (back)
 *
 * Our D6 face-value table (see faceDetection.ts D6):
 *   +Y → 1   -Y → 6
 *   +Z → 2   -Z → 5
 *   +X → 3   -X → 4
 */
const D6_FACE_VALUES_BY_AXIS: readonly number[] = [3, 4, 1, 6, 2, 5];

// Black tavern D6 with gold pips.
const BG = '#110a08';
const BG_DEEP = '#1a1108';
const INK = '#d4af6b';
const PIP_BG = '#3a2515';

function createCanvas(size: number): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  return { canvas, ctx };
}

function paintBackground(ctx: CanvasRenderingContext2D, size: number) {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, size, size);
  // Inset darker band so the cube reads as having a slight bevel.
  ctx.fillStyle = BG_DEEP;
  const inset = Math.round(size * 0.04);
  ctx.fillRect(inset, inset, size - inset * 2, size - inset * 2);
  ctx.fillStyle = BG;
  const inset2 = Math.round(size * 0.07);
  ctx.fillRect(inset2, inset2, size - inset2 * 2, size - inset2 * 2);
}

function drawPip(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  // soft ring + filled circle for a debossed-pip look
  ctx.fillStyle = PIP_BG;
  ctx.beginPath();
  ctx.arc(cx + r * 0.12, cy + r * 0.12, r * 1.06, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Standard D6 pip layout for values 1–6.
 *   Positions are returned as 0–1 normalized (x, y) pairs so the function
 *   doesn't care about texture resolution.
 */
function pipPositions(value: number): Array<[number, number]> {
  const a = 0.27;
  const b = 0.5;
  const c = 0.73;
  switch (value) {
    case 1:
      return [[b, b]];
    case 2:
      return [
        [a, a],
        [c, c],
      ];
    case 3:
      return [
        [a, a],
        [b, b],
        [c, c],
      ];
    case 4:
      return [
        [a, a],
        [c, a],
        [a, c],
        [c, c],
      ];
    case 5:
      return [
        [a, a],
        [c, a],
        [b, b],
        [a, c],
        [c, c],
      ];
    case 6:
      return [
        [a, a],
        [c, a],
        [a, b],
        [c, b],
        [a, c],
        [c, c],
      ];
    default:
      return [];
  }
}

function createD6FaceTexture(value: number, size = 256): THREE.CanvasTexture {
  const { canvas, ctx } = createCanvas(size);
  paintBackground(ctx, size);
  const pipR = size * 0.09;
  for (const [nx, ny] of pipPositions(value)) {
    drawPip(ctx, nx * size, ny * size, pipR);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Module-scope shared materials. Every D6 in every throw shows the same six
 * pip faces, so one materials array serves all meshes for the app lifetime
 * (three.js explicitly supports sharing materials across meshes). Before
 * this cache, each D6 painted 6 canvases + created 6 CanvasTextures + 6
 * materials per die per throw — a 6×D6 roll allocated 36 of each, then
 * disposed them all on Clear.
 *
 * Lifetime note: these are intentionally never disposed. Six 256px canvas
 * textures ≈ 1.5 MB GPU memory, kept warm for instant re-rolls.
 */
// Square pillow normal — bends shading normals outward in a band along
// the four UV borders so the cube's edges catch light like rounded
// resin instead of razor-sharp CG. BoxGeometry maps each face to the
// full [0,1]² UV square, so one shared map serves all six faces.
let SQUARE_PILLOW: THREE.CanvasTexture | null = null;
function getSquarePillowNormal(): THREE.CanvasTexture {
  if (SQUARE_PILLOW) return SQUARE_PILLOW;
  const S = 256;
  const BAND = 0.075;
  const MAX = 0.6;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  for (let py = 0; py < S; py++) {
    const v = 1 - (py + 0.5) / S;
    for (let px = 0; px < S; px++) {
      const u = (px + 0.5) / S;
      // Push toward each border within the band; corners blend both axes.
      let nx = 0;
      let ny = 0;
      if (u < BAND) nx = -(1 - u / BAND);
      else if (u > 1 - BAND) nx = 1 - (1 - u) / BAND;
      if (v < BAND) ny = -(1 - v / BAND);
      else if (v > 1 - BAND) ny = 1 - (1 - v) / BAND;
      const m = Math.hypot(nx, ny);
      let s = 0;
      if (m > 0) {
        s = Math.pow(Math.min(1, m), 1.7) * MAX;
        nx /= m;
        ny /= m;
      }
      const nz = Math.sqrt(Math.max(0, 1 - s * s));
      const idx = (py * S + px) * 4;
      img.data[idx] = Math.round((nx * s * 0.5 + 0.5) * 255);
      img.data[idx + 1] = Math.round((ny * s * 0.5 + 0.5) * 255);
      img.data[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  SQUARE_PILLOW = new THREE.CanvasTexture(canvas);
  SQUARE_PILLOW.needsUpdate = true;
  return SQUARE_PILLOW;
}

let SHARED_D6_MATERIALS: THREE.MeshPhysicalMaterial[] | null = null;

export function createD6Materials(): THREE.MeshPhysicalMaterial[] {
  if (SHARED_D6_MATERIALS) return SHARED_D6_MATERIALS;
  SHARED_D6_MATERIALS = D6_FACE_VALUES_BY_AXIS.map(
    (value) =>
      // Clearcoat to match the polyhedral dice — lacquered bone-black cube.
      // Env influence kept low for the same reason as dieFaceMaterials:
      // flat faces mirror HDRI hotspots into face-wide flashes if the
      // base layer is env-hot.
      new THREE.MeshPhysicalMaterial({
        map: createD6FaceTexture(value),
        normalMap: getSquarePillowNormal(), // rounded-edge light wrap
        roughness: 0.62,
        metalness: 0.08,
        specularIntensity: 0.4,
        clearcoat: 0.35,
        clearcoatRoughness: 0.32,
        envMapIntensity: 0.35,
      }),
  );
  return SHARED_D6_MATERIALS;
}
