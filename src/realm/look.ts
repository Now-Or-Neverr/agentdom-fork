// Shared "look" for the realm materials, injected into the stock three.js
// shaders: procedural roof tiles, contact darkening near the ground (reads a
// baked height texture), drifting cloud shadows, fluttering cloth and swaying
// foliage (vertex animation driven by the per-vertex `fx` code from Batch),
// and a gentle colour grade. All effects are cheap per-fragment maths.
import * as THREE from 'three';

export interface Look {
  uTime: { value: number };
  uHeight: { value: THREE.Texture };
  uHB: { value: THREE.Vector4 }; // x0, z0, w, d of the height texture
  uAO: { value: number };
  uCloud: { value: number };
  uNight: { value: number };
  uWind: { value: number };
  uLightMap: { value: THREE.Texture };
  uLB: { value: THREE.Vector4 };
  uLamp: { value: number };
  uNoise: { value: THREE.Texture };
}

let flat: THREE.DataTexture | null = null;
function flatHeight() {
  if (!flat) {
    flat = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
    flat.needsUpdate = true;
  }
  return flat;
}

export function makeLook(): Look {
  return {
    uTime: { value: 0 },
    uHeight: { value: flatHeight() },
    uHB: { value: new THREE.Vector4(-1, -1, 2, 2) },
    uAO: { value: 0 },
    uCloud: { value: 0 },
    uNight: { value: 0 },
    uWind: { value: 1 },
    uLightMap: { value: flatHeight() },
    uLB: { value: new THREE.Vector4(-1, -1, 2, 2) },
    uLamp: { value: 0 },
    uNoise: { value: noiseTexture() },
  };
}

// Height range packed into the 8-bit height texture.
export const H_MIN = -3;
export const H_SPAN = 12;

// Height texture from a regular grid (row-major, W x H samples, y values).
export function heightTexture(ys: ArrayLike<number>, W: number, H: number) {
  const data = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const v = Math.max(0, Math.min(255, Math.round(((ys[i] - H_MIN) / H_SPAN) * 255)));
    data[i * 4] = v;
    data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

export interface LookOpt {
  fx?: boolean; // geometry carries the `fx` attribute (tiles, cloth, foliage)
  ao?: boolean; // darken near the ground
  cloud?: boolean;
  grade?: boolean;
  lamp?: boolean; // warm lantern light at night (baked light map)
}

// Value noise from a pre-baked tiling texture (one fetch instead of four
// sin-hashes; much cheaper on integrated GPUs). Period: 32 cells.
const NOISE = /* glsl */ `
uniform sampler2D uNoise;
float lk_noise(vec2 p) { return texture2D(uNoise, p * 0.03125).r; }
`;

let noiseT: THREE.DataTexture | null = null;
export function noiseTexture() {
  if (noiseT) return noiseT;
  const P = 32;
  const T = 8; // texels per cell
  const S = P * T;
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const grid = new Float32Array(P * P).map(() => rnd());
  const g = (i: number, j: number) => grid[((j + P) % P) * P + ((i + P) % P)];
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const fx = (x + 0.5) / T - 0.5;
      const fy = (y + 0.5) / T - 0.5;
      const i = Math.floor(fx);
      const j = Math.floor(fy);
      let u = fx - i;
      let v = fy - j;
      u = u * u * (3 - 2 * u);
      v = v * v * (3 - 2 * v);
      const a = g(i, j) + (g(i + 1, j) - g(i, j)) * u;
      const b = g(i, j + 1) + (g(i + 1, j + 1) - g(i, j + 1)) * u;
      const k = (y * S + x) * 4;
      data[k] = Math.round((a + (b - a) * v) * 255);
      data[k + 3] = 255;
    }
  noiseT = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  noiseT.wrapS = noiseT.wrapT = THREE.RepeatWrapping;
  noiseT.magFilter = THREE.LinearFilter;
  noiseT.minFilter = THREE.LinearMipmapLinearFilter;
  noiseT.generateMipmaps = true;
  noiseT.needsUpdate = true;
  return noiseT;
}

// GLSL helpers shared with custom shaders (water).
export const LOOK_GLSL = NOISE + /* glsl */ `
float lk_cloud(vec2 xz, float t) {
  vec2 p = xz * 0.022 + vec2(t * 0.011, t * 0.006);
  float n = lk_noise(p) * 0.65 + lk_noise(p * 2.3 + 7.1) * 0.35;
  return smoothstep(0.56, 0.78, n);
}
vec3 lk_grade(vec3 c, float night) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, 1.1 - night * 0.05);
  // warm highlights by day, slightly lifted blue shadows at night
  c *= mix(vec3(1.025, 1.0, 0.965), vec3(0.96, 0.99, 1.06), night);
  return c;
}
`;

export function enhance(mat: THREE.Material, look: Look, opt: LookOpt) {
  const defs: string[] = [];
  if (opt.fx) defs.push('#define LK_FX');
  if (opt.ao) defs.push('#define LK_AO');
  if (opt.cloud) defs.push('#define LK_CLOUD');
  if (opt.grade) defs.push('#define LK_GRADE');
  if (opt.lamp) defs.push('#define LK_LAMP');
  const key = defs.join('|');
  mat.customProgramCacheKey = () => 'look:' + key;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, look);
    const head = defs.join('\n') + '\n';
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        head +
          /* glsl */ `#include <common>
uniform float uTime;
uniform float uWind;
varying vec3 vWp;
varying vec3 vWn;
#ifdef LK_FX
attribute float fx;
varying float vFx;
#endif
`,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
#ifdef LK_FX
vFx = fx;
{
  vec4 lk_b = vec4(position, 1.0);
  #ifdef USE_INSTANCING
  lk_b = instanceMatrix * lk_b;
  #endif
  lk_b = modelMatrix * lk_b;
  if (fx > 1.5 && fx < 3.5) {
    // cloth: flutter along the cloth normal, more towards the free edge
    float w = fx - 2.0;
    vec3 n = normalize(objectNormal);
    n *= sign(dot(n, vec3(0.31, 0.07, 0.95)) + 1e-4);
    float ph = uTime * 3.4 + lk_b.x * 0.8 + lk_b.z * 0.6;
    transformed += n * (sin(ph - w * 4.0) * 0.13 + sin(ph * 1.7 - w * 6.0) * 0.04) * w * uWind;
  } else if (fx > 4.5) {
    // foliage: the crown sways gently
    float hgt = max(0.0, position.y - 0.45);
    vec2 sd = lk_b.xz - position.xz;
    float ph = uTime * 1.25 + sd.x * 0.37 + sd.y * 0.29;
    transformed.x += sin(ph) * 0.028 * hgt * uWind;
    transformed.z += cos(ph * 0.8) * 0.018 * hgt * uWind;
  }
}
#endif
`,
      )
      .replace(
        '#include <project_vertex>',
        /* glsl */ `#include <project_vertex>
{
  vec4 lk_w = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
  lk_w = instanceMatrix * lk_w;
  #endif
  vWp = (modelMatrix * lk_w).xyz;
  vWn = normalize(inverseTransformDirection(transformedNormal, viewMatrix));
}
`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        head +
          /* glsl */ `#include <common>
uniform float uTime;
uniform sampler2D uHeight;
uniform vec4 uHB;
uniform float uAO;
uniform float uCloud;
uniform float uNight;
uniform sampler2D uLightMap;
uniform vec4 uLB;
uniform float uLamp;
varying vec3 vWp;
varying vec3 vWn;
#ifdef LK_FX
varying float vFx;
#endif
${LOOK_GLSL}
`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
#ifdef LK_FX
if (vFx > 0.5 && vFx < 1.5) {
  // clay roof tiles: rows of round tiles running down the slope; the eave
  // direction comes from the fx code (straight faces) or the normal (round roofs)
  vec3 n = normalize(vWn);
  float tl = length(n.xz);
  float u;
  if (vFx < 0.98) {
    u = atan(n.z, n.x) * (60.0 / 6.2831853);
  } else {
    float ang = (vFx - 1.0) / 0.45 * 3.14159265;
    u = dot(vWp.xz, vec2(cos(ang), sin(ang))) * 4.4;
  }
  float fw = fwidth(u);
  float k = (1.0 - smoothstep(0.28, 0.6, fw)) * smoothstep(0.08, 0.3, tl);
  float s = sin(u * 6.2831853);
  float ridge = smoothstep(0.15, 0.95, s);
  float gutter = smoothstep(-0.45, -0.95, s);
  float along = vWp.y * 6.0;
  float lip = smoothstep(0.82, 0.97, fract(along)) * (1.0 - smoothstep(0.2, 0.5, fwidth(along)));
  float vary = lk_noise(floor(vec2(u, along)) * 3.71) - 0.5;
  diffuseColor.rgb *= 1.0 + (ridge * 0.34 - gutter * 0.5 - lip * 0.2 * (0.4 + ridge) + vary * 0.1) * k;
}
#endif
#ifdef LK_AO
{
  vec2 huv = (vWp.xz - uHB.xy) / uHB.zw;
  float gh = texture2D(uHeight, huv).r * ${H_SPAN.toFixed(1)} + (${H_MIN.toFixed(1)});
  float up = vWp.y - gh;
  float ao = mix(0.58, 1.0, smoothstep(-0.05, 0.75, up));
  diffuseColor.rgb *= mix(1.0, ao, uAO);
}
#endif
`,
      )
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `
#ifdef LK_CLOUD
outgoingLight *= 1.0 - lk_cloud(vWp.xz, uTime) * uCloud;
#endif
#ifdef LK_LAMP
{
  vec3 lm = texture2D(uLightMap, (vWp.xz - uLB.xy) / uLB.zw).rgb;
  outgoingLight += diffuseColor.rgb * lm * uLamp * 2.2;
}
#endif
#ifdef LK_GRADE
outgoingLight = lk_grade(outgoingLight, uNight);
#endif
#include <opaque_fragment>`,
      );
  };
  mat.needsUpdate = true;
  return mat;
}

// Warm pools of lantern light baked into a small texture over the map (night).
export function lightMap(lights: THREE.Vector3[], x0: number, z0: number, w: number, d: number, px = 640) {
  const c = document.createElement('canvas');
  c.width = px;
  c.height = Math.round((px * d) / w);
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = 'lighter';
  const s = px / w;
  for (const l of lights) {
    const x = (l.x - x0) * s;
    const y = (l.z - z0) * s;
    const r = 3.4 * s;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,170,80,0.42)');
    grd.addColorStop(0.35, 'rgba(255,140,60,0.16)');
    grd.addColorStop(1, 'rgba(255,120,50,0)');
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.flipY = false;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}
