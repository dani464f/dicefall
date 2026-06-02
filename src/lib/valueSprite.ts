import * as THREE from 'three';

/**
 * A small floating label that hovers above a settled die so the user can read
 * its value without trying to identify which polyhedron face is on top. Used
 * for D4/D8/D12/D20 — D6 has its pips painted on, so it doesn't need one.
 */

const BG = '#c9a45c';      // bright gold pill — pops over the dark tray
const BG_INNER = '#a8854a'; // darker gold inset for depth
const BORDER = '#1b120d';
const TEXT = '#1b120d';

function paintValue(canvas: HTMLCanvasElement, value: number): void {
  const size = canvas.width;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, size, size);

  // Drop shadow halo
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = size * 0.08;

  // Rounded background pill
  const padX = size * 0.05;
  const padY = size * 0.18;
  const w = size - padX * 2;
  const h = size - padY * 2;
  const r = h * 0.42;

  const pill = (
    x: number,
    y: number,
    pw: number,
    ph: number,
    pr: number,
  ) => {
    ctx.beginPath();
    ctx.moveTo(x + pr, y);
    ctx.lineTo(x + pw - pr, y);
    ctx.quadraticCurveTo(x + pw, y, x + pw, y + pr);
    ctx.lineTo(x + pw, y + ph - pr);
    ctx.quadraticCurveTo(x + pw, y + ph, x + pw - pr, y + ph);
    ctx.lineTo(x + pr, y + ph);
    ctx.quadraticCurveTo(x, y + ph, x, y + ph - pr);
    ctx.lineTo(x, y + pr);
    ctx.quadraticCurveTo(x, y, x + pr, y);
    ctx.closePath();
  };

  pill(padX, padY, w, h, r);
  ctx.fillStyle = BG;
  ctx.fill();

  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.lineWidth = size * 0.012;
  ctx.strokeStyle = BORDER;
  ctx.stroke();

  // Inset darker band
  const innerInset = size * 0.02;
  pill(
    padX + innerInset,
    padY + innerInset,
    w - innerInset * 2,
    h - innerInset * 2,
    Math.max(0, r - innerInset),
  );
  ctx.fillStyle = BG_INNER;
  ctx.fill();

  // Number
  ctx.fillStyle = TEXT;
  ctx.font = `600 ${Math.round(size * 0.46)}px Georgia, "Times New Roman", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(value), size / 2, size / 2 + size * 0.02);
}

export function createValueSprite(value: number): {
  sprite: THREE.Sprite;
  dispose: () => void;
} {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  paintValue(canvas, value);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  texture.anisotropy = 4;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  // Pill is wider than tall (~2:1)
  sprite.scale.set(0.95, 0.5, 1);
  // Sprites render on top of everything by default with depthTest off; also
  // tag with renderOrder so it draws above the dice consistently.
  sprite.renderOrder = 999;

  return {
    sprite,
    dispose() {
      texture.dispose();
      material.dispose();
    },
  };
}
