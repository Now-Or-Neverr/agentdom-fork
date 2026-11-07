// Terrain mesh (vertex-coloured heightfield with a painterly grain texture) and
// the water surface: one big quad whose shader reads the sea depth from a baked
// depth texture -> turquoise shallows, deep blue water, moving shore foam,
// ripples and sun glints.
import * as THREE from 'three';
import { LOOK_GLSL, noiseTexture } from './look';

export interface Bounds {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

let grainTex: THREE.Texture | null = null;
// Soft speckled grain multiplied over the ground colours (shared, never disposed).
export function grain() {
  if (grainTex) return grainTex;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f2f2f2';
  g.fillRect(0, 0, S, S);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const r = 1 + rnd() * 3.2;
    const v = 200 + Math.floor(rnd() * 55);
    g.fillStyle = `rgba(${v},${v},${v - 6},${0.35 + rnd() * 0.4})`;
    g.beginPath();
    g.ellipse(x, y, r * 1.6, r, rnd() * 3, 0, Math.PI * 2);
    g.fill();
  }
  for (let i = 0; i < 500; i++) {
    g.fillStyle = `rgba(255,255,250,${0.25 + rnd() * 0.3})`;
    g.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  grainTex = new THREE.CanvasTexture(c);
  grainTex.wrapS = grainTex.wrapT = THREE.RepeatWrapping;
  grainTex.colorSpace = THREE.SRGBColorSpace;
  grainTex.anisotropy = 4;
  return grainTex;
}

// Heightfield grid with per-vertex colours.
export function terrainGeometry(b: Bounds, step: number, h: (x: number, z: number) => number, col: (x: number, z: number, h: number, slope: number, out: THREE.Color) => void, uvScale = 0.12, clipR = Infinity) {
  const nx = Math.ceil((b.x1 - b.x0) / step);
  const nz = Math.ceil((b.z1 - b.z0) / step);
  const W = nx + 1;
  const H = nz + 1;
  const pos = new Float32Array(W * H * 3);
  const colA = new Float32Array(W * H * 3);
  const uv = new Float32Array(W * H * 2);
  const hs = new Float32Array(W * H);
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const x = b.x0 + (i / nx) * (b.x1 - b.x0);
      const z = b.z0 + (j / nz) * (b.z1 - b.z0);
      hs[j * W + i] = h(x, z);
    }
  const c = new THREE.Color();
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      const x = b.x0 + (i / nx) * (b.x1 - b.x0);
      const z = b.z0 + (j / nz) * (b.z1 - b.z0);
      const y = hs[k];
      const dx = hs[j * W + Math.min(W - 1, i + 1)] - hs[j * W + Math.max(0, i - 1)];
      const dz = hs[Math.min(H - 1, j + 1) * W + i] - hs[Math.max(0, j - 1) * W + i];
      const slope = Math.hypot(dx, dz) / (2 * step);
      pos[k * 3] = x;
      pos[k * 3 + 1] = y;
      pos[k * 3 + 2] = z;
      col(x, z, y, slope, c);
      colA[k * 3] = c.r;
      colA[k * 3 + 1] = c.g;
      colA[k * 3 + 2] = c.b;
      uv[k * 2] = x * uvScale;
      uv[k * 2 + 1] = z * uvScale;
    }
  const idx: number[] = [];
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const a = j * W + i;
      const b2 = a + 1;
      const c2 = a + W;
      const d = c2 + 1;
      if (clipR < Infinity) {
        const cx = pos[a * 3] + step / 2;
        const cz = pos[a * 3 + 2] + step / 2;
        if (Math.hypot(cx, cz) > clipR) continue;
      }
      // alternate the diagonal for a less regular look
      if ((i + j) % 2) idx.push(a, c2, b2, b2, c2, d);
      else idx.push(a, c2, d, a, d, b2);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(colA, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

// Depth below sea level baked into a texture (R = depth / 6).
export function depthTexture(b: Bounds, res: number, h: (x: number, z: number) => number) {
  const w = res;
  const hh = Math.round((res * (b.z1 - b.z0)) / (b.x1 - b.x0));
  const data = new Uint8Array(w * hh * 4);
  for (let j = 0; j < hh; j++)
    for (let i = 0; i < w; i++) {
      const x = b.x0 + ((i + 0.5) / w) * (b.x1 - b.x0);
      const z = b.z0 + ((j + 0.5) / hh) * (b.z1 - b.z0);
      const y = h(x, z);
      const d = Math.max(0, Math.min(1, -y / 6));
      const k = (j * w + i) * 4;
      data[k] = Math.round(d * 255);
      data[k + 1] = y > 0 ? 255 : 0;
      data[k + 2] = 0;
      data[k + 3] = 255;
    }
  const t = new THREE.DataTexture(data, w, hh, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

const WATER_VS = /* glsl */ `
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const WATER_FS = /* glsl */ `
uniform sampler2D uDepth;
uniform vec4 uB;
uniform float uTime;
uniform vec3 uShallow;
uniform vec3 uMid;
uniform vec3 uDeep;
uniform vec3 uFoam;
uniform vec3 uLight;
uniform vec3 uGlint;
uniform float uFoamK;
uniform float uOuter;
uniform vec2 uFadeR;
uniform float uCloud;
uniform float uNight;
uniform sampler2D uLightMap;
uniform vec4 uLB;
uniform float uLamp;
varying vec3 vW;
${LOOK_GLSL}

void main() {
  vec2 uv = (vW.xz - uB.xy) / uB.zw;
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  vec4 dt = texture2D(uDepth, clamp(uv, 0.0, 1.0));
  float d = mix(uOuter, dt.r * 6.0, inside);
  float t = uTime;
  // broad drifting swell (no fine speckle)
  float n1 = lk_noise(vW.xz * 0.42 + vec2(t * 0.13, t * 0.07));
  float n2 = lk_noise(vW.xz * 0.95 - vec2(t * 0.09, t * 0.16));
  float n3 = lk_noise(vW.xz * 0.1 + vec2(t * 0.02, -t * 0.015));
  float n = n1 * 0.6 + n2 * 0.4;
  float dd = d + (n3 - 0.5) * 0.7;
  // depth ramp: sandy turquoise shallows -> teal -> deep blue
  vec3 col = mix(uShallow, uMid, smoothstep(0.08, 1.5, dd));
  col = mix(col, uDeep, smoothstep(1.3, 5.2, dd));
  col *= 0.95 + n * 0.1;
  // soft caustic web in the shallows
  vec2 cp = vW.xz * 1.1;
  float c1 = lk_noise(cp + vec2(t * 0.35, t * 0.22));
  float c2 = lk_noise(cp * 1.31 - vec2(t * 0.28, -t * 0.31) + 3.7);
  float caus = 1.0 - smoothstep(0.0, 0.16, abs(c1 - c2));
  float cfw = fwidth(cp.x);
  caus *= (1.0 - smoothstep(0.25, 0.7, cfw)) * smoothstep(0.05, 0.35, d) * (1.0 - smoothstep(0.9, 2.2, d));
  col += vec3(0.85, 1.0, 0.95) * caus * 0.09 * (1.0 - uNight);
  // long gentle swell streaks in open water
  float streak = smoothstep(0.6, 0.92, lk_noise(vec2(vW.x * 0.22 + t * 0.04, vW.z * 1.1 - t * 0.2)));
  col *= 1.0 + streak * 0.07 * smoothstep(0.6, 2.5, d);
  // broad sun / moon sheen (large soft patches, never pin-point specks)
  float sh = lk_noise(vW.xz * 0.16 + vec2(t * 0.05, -t * 0.03));
  col += uGlint * smoothstep(0.55, 0.85, sh) * 0.06 * smoothstep(1.0, 3.0, d);
  // shore: wet bright lip at the waterline plus two soft bands rolling in
  float lipN = lk_noise(vW.xz * 1.6 + t * 0.2);
  float lip = 1.0 - smoothstep(0.02, 0.13 + lipN * 0.08, d);
  float wave = fract(-d * 2.2 + t * 0.22 + n3 * 0.6);
  float band = smoothstep(0.0, 0.08, wave) * (1.0 - smoothstep(0.08, 0.32, wave));
  band *= (1.0 - smoothstep(0.1, 0.75, d)) * smoothstep(0.35, 0.7, lk_noise(vW.xz * 0.9 + vec2(t * 0.1, 0.0)));
  float foam = clamp(lip * 0.95 + band * 0.75, 0.0, 1.0) * (0.8 + n2 * 0.35) * uFoamK;
  foam = clamp(foam, 0.0, 1.0);
  col = mix(col, uFoam, foam * 0.85);
  // cloud shadows drift over the sea too
  col *= 1.0 - lk_cloud(vW.xz, t) * uCloud * 0.8;
  // lantern light shimmering on the water near the shore
  vec3 lm = texture2D(uLightMap, (vW.xz - uLB.xy) / uLB.zw).rgb;
  col += lm * uLamp * (1.1 + n2 * 0.9) * (0.7 + 0.3 * sin(vW.x * 3.0 + vW.z * 2.0 + t * 1.5));
  col = lk_grade(col, uNight);
  float a = mix(0.4, 0.92, smoothstep(0.0, 2.4, d));
  a = max(a, foam * 0.9);
  a = mix(a, 1.0, smoothstep(4.2, 5.8, d));
  a *= 1.0 - smoothstep(uFadeR.x, uFadeR.y, length(vW.xz));
  gl_FragColor = vec4(col * uLight, a);
  #include <colorspace_fragment>
}
`;

let black: THREE.DataTexture | null = null;
function blackTex() {
  if (!black) {
    black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    black.needsUpdate = true;
  }
  return black;
}

export function waterMaterial(depth: THREE.Texture, b: Bounds) {
  return new THREE.ShaderMaterial({
    vertexShader: WATER_VS,
    fragmentShader: WATER_FS,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uDepth: { value: depth },
      uB: { value: new THREE.Vector4(b.x0, b.z0, b.x1 - b.x0, b.z1 - b.z0) },
      uTime: { value: 0 },
      uShallow: { value: new THREE.Color('#7fe0d6') },
      uMid: { value: new THREE.Color('#2fb2cf') },
      uDeep: { value: new THREE.Color('#1677a8') },
      uFoam: { value: new THREE.Color('#f4fbf8') },
      uLight: { value: new THREE.Color(1, 1, 1) },
      uGlint: { value: new THREE.Color('#fff6dc') },
      uFoamK: { value: 1 },
      uOuter: { value: 6 },
      uFadeR: { value: new THREE.Vector2(1e5, 1e5 + 1) },
      uCloud: { value: 0 },
      uNight: { value: 0 },
      uLightMap: { value: blackTex() },
      uLB: { value: new THREE.Vector4(-1, -1, 2, 2) },
      uLamp: { value: 0 },
      uNoise: { value: noiseTexture() },
    },
  });
}

export const WATER_DAY = { shallow: '#8ee6d6', mid: '#3dbcd3', deep: '#1f84b3', foam: '#f6fcf9', glint: '#fff4d6' };
export const WATER_NIGHT = { shallow: '#2f6678', mid: '#1a4468', deep: '#0e2a4e', foam: '#a7bdd2', glint: '#40507a' };
