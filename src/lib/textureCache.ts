import * as THREE from 'three';

/**
 * Module-scope surface-texture cache shared by the scene and the tavern
 * world. Textures survive scene rebuilds (StrictMode double-mount, skin
 * switches); total GPU residency is a few MB and is never reclaimed.
 *
 * `repeat` is part of the cache key: THREE.Texture carries tiling on the
 * texture object itself, so two materials wanting different repeats of
 * the same image need two texture instances (image bytes still come from
 * the browser HTTP cache; only the GPU upload duplicates).
 */
const TEXTURE_CACHE = new Map<string, THREE.Texture>();

export function getCachedTexture(
  url: string,
  srgb: boolean,
  onLoad: () => void,
  repeat: [number, number] = [1, 1],
): THREE.Texture {
  const key = `${url}|${srgb ? 's' : 'l'}|${repeat[0]}x${repeat[1]}`;
  const cached = TEXTURE_CACHE.get(key);
  if (cached) return cached;
  const tex = new THREE.TextureLoader().load(url, onLoad, undefined, () => {
    // 404 / decode failure — leave the material flat-colored. The console
    // notes it; the scene must never crash over a missing map.
    console.warn(`[textureCache] texture failed to load: ${url}`);
  });
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = 8;
  TEXTURE_CACHE.set(key, tex);
  return tex;
}
