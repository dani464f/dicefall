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

const BG = '#e8d4a8';
const BG_DEEP = '#d6c190';
const INK = '#1b120d';
const PIP_BG = '#3a2818';

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

export function createD6Materials(): THREE.MeshStandardMaterial[] {
  return D6_FACE_VALUES_BY_AXIS.map(
    (value) =>
      new THREE.MeshStandardMaterial({
        map: createD6FaceTexture(value),
        roughness: 0.5,
        metalness: 0.1,
      }),
  );
}

export function disposeMaterials(mats: THREE.MeshStandardMaterial[]): void {
  for (const m of mats) {
    m.map?.dispose();
    m.dispose();
  }
}
