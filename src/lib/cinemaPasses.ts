import * as THREE from 'three';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

/**
 * Custom film-lens passes for the post chain — the "shot on anamorphic
 * glass, graded for a blockbuster" layer.
 *
 *   makeStreakPass()  — horizontal anamorphic flare streaks: bright HDR
 *                       sources (flames, window panes, gold glints) smear
 *                       into wide blue-tinted lines, the classic scope-lens
 *                       artifact. Runs in LINEAR space (before OutputPass)
 *                       so the threshold reads true HDR brightness.
 *
 *   makeCinemaPass()  — the print grade, display-referred (after
 *                       OutputPass): radial chromatic aberration at frame
 *                       edges, orange-and-teal split toning (shadows cool,
 *                       highlights warm), and a gentle filmic S-curve for
 *                       contrast. One pass, one texture fetch chain.
 */

const STREAK_SHADER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTexel: { value: new THREE.Vector2(1 / 1024, 1 / 1024) },
    uThreshold: { value: 1.15 },
    uStrength: { value: 0.55 },
    uTint: { value: new THREE.Color(0.75, 0.85, 1.25) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uTexel;
    uniform float uThreshold;
    uniform float uStrength;
    uniform vec3 uTint;
    varying vec2 vUv;

    vec3 brights(vec2 uv) {
      vec3 c = texture2D(tDiffuse, uv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      return c * smoothstep(uThreshold, uThreshold * 2.2, l);
    }

    void main() {
      vec3 base = texture2D(tDiffuse, vUv).rgb;
      // 12-tap horizontal smear, exponentially weighted. Wide reach —
      // the streak should cross a third of the frame off a hot flame.
      vec3 streak = vec3(0.0);
      float wsum = 0.0;
      for (int i = 1; i <= 12; i++) {
        float fi = float(i);
        float w = exp(-fi * 0.32);
        float off = fi * fi * 1.9 * uTexel.x; // quadratic spread
        streak += (brights(vUv + vec2(off, 0.0)) +
                   brights(vUv - vec2(off, 0.0))) * w;
        wsum += 2.0 * w;
      }
      streak /= wsum;
      gl_FragColor = vec4(base + streak * uTint * uStrength, 1.0);
    }
  `,
};

const CINEMA_SHADER = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uCA: { value: 0.0016 },
    uShadowTint: { value: new THREE.Color(0.92, 1.0, 1.12) }, // teal-ward
    uHighTint: { value: new THREE.Color(1.06, 1.0, 0.9) }, // amber-ward
    uToneAmount: { value: 0.55 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uCA;
    uniform vec3 uShadowTint;
    uniform vec3 uHighTint;
    uniform float uToneAmount;
    varying vec2 vUv;

    void main() {
      // --- radial chromatic aberration: zero at center, grows with r² ---
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);
      vec2 shift = d * r2 * uCA * 40.0;
      float cr = texture2D(tDiffuse, vUv + shift).r;
      float cg = texture2D(tDiffuse, vUv).g;
      float cb = texture2D(tDiffuse, vUv - shift).b;
      vec3 c = vec3(cr, cg, cb);

      // --- orange & teal split tone -------------------------------------
      float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
      float shadowW = (1.0 - smoothstep(0.0, 0.45, luma)) * uToneAmount;
      float highW = smoothstep(0.45, 1.0, luma) * uToneAmount;
      c = mix(c, c * uShadowTint, shadowW);
      c = mix(c, c * uHighTint, highW);

      // --- gentle filmic S-curve (print contrast) -----------------------
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.22);

      gl_FragColor = vec4(c, 1.0);
    }
  `,
};

export function makeStreakPass(): ShaderPass {
  const pass = new ShaderPass(STREAK_SHADER);
  return pass;
}

export function makeCinemaPass(): ShaderPass {
  return new ShaderPass(CINEMA_SHADER);
}

/** Keep the streak pass's texel size in sync with the composer. */
export function setStreakSize(pass: ShaderPass, w: number, h: number): void {
  (pass.uniforms.uTexel!.value as THREE.Vector2).set(1 / w, 1 / h);
}
