// Real weather on the map (the kind comes from Open-Meteo via /api/weather):
// rain streaks, storm (heavier rain + lightning flashes), snow flakes, fog,
// overcast light. Precipitation is screen-sized: a box of streaks / flakes
// that follows the camera and scales with zoom, animated on the GPU.
import * as THREE from 'three';
import type { WeatherKind } from '../../shared/live';

export interface WeatherLook {
  hemi: number; // multiplier for the sky light
  sun: number; // multiplier for the sun
  cloud: number; // cloud-shadow strength (added)
  overcast: number; // 0..1 greys the painted sky
  fog: number; // 0..1 haze
  wet: number; // 0..1 darker, glossier ground
}

export const WEATHER_LOOK: Record<WeatherKind | 'none', WeatherLook> = {
  none: { hemi: 1, sun: 1, cloud: 0, overcast: 0, fog: 0, wet: 0 },
  clear: { hemi: 1, sun: 1, cloud: 0, overcast: 0, fog: 0, wet: 0 },
  cloudy: { hemi: 0.9, sun: 0.5, cloud: 0.35, overcast: 0.45, fog: 0.08, wet: 0 },
  rain: { hemi: 0.7, sun: 0.22, cloud: 0.4, overcast: 0.75, fog: 0.18, wet: 1 },
  storm: { hemi: 0.56, sun: 0.1, cloud: 0.5, overcast: 1, fog: 0.22, wet: 1 },
  fog: { hemi: 0.98, sun: 0.4, cloud: 0.1, overcast: 0.55, fog: 1, wet: 0.2 },
  snow: { hemi: 1.02, sun: 0.5, cloud: 0.2, overcast: 0.5, fog: 0.25, wet: 0 },
};

function seeds(n: number, seed: number) {
  let a = seed >>> 0;
  const r = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const s = new Float32Array(n * 3);
  for (let i = 0; i < s.length; i++) s[i] = r();
  return s;
}

const RAIN_N = 2600;
const SNOW_N = 2200;

export class WeatherFx {
  group = new THREE.Group();
  kind: WeatherKind | null = null;
  flash = 0; // lightning, 0..1
  private rain: THREE.Mesh;
  private rainMat: THREE.ShaderMaterial;
  private rainGeo: THREE.InstancedBufferGeometry;
  private snow: THREE.Points;
  private snowMat: THREE.ShaderMaterial;
  private bolt = 6;
  private flicker = -1;
  private wind = 0.2;
  reduced = false;

  constructor() {
    // rain: one thin quad per streak, stretched along the fall direction
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds(RAIN_N, 11), 3));
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    this.rainGeo = g;
    const common = {
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uBox: { value: new THREE.Vector3(100, 20, 100) },
      uRight: { value: new THREE.Vector3(1, 0, 0) },
      uWind: { value: new THREE.Vector2(0.2, 0) },
      uOpacity: { value: 0.5 },
    };
    this.rainMat = new THREE.ShaderMaterial({
      uniforms: { ...common, uLen: { value: 1.6 }, uWidth: { value: 0.08 }, uSpeed: { value: 1.4 }, uColor: { value: new THREE.Color('#dfe8f4') } },
      vertexShader: /* glsl */ `
uniform float uTime;
uniform vec3 uCenter;
uniform vec3 uBox;
uniform vec3 uRight;
uniform vec2 uWind;
uniform float uLen;
uniform float uWidth;
uniform float uSpeed;
attribute vec3 aSeed;
varying float vA;
varying float vT;
void main() {
  float fall = fract(aSeed.y + uTime * uSpeed * (0.85 + aSeed.z * 0.3));
  vec3 c = uCenter + vec3((aSeed.x - 0.5) * uBox.x, (1.0 - fall) * uBox.y, (fract(aSeed.z * 7.13) - 0.5) * uBox.z);
  vec3 dir = normalize(vec3(uWind.x, -1.0, uWind.y));
  vec3 p = c - dir * position.y * uLen * (0.7 + aSeed.x * 0.6) + uRight * position.x * uWidth;
  vA = smoothstep(0.0, 0.06, fall) * (1.0 - smoothstep(0.92, 1.0, fall));
  vT = position.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`,
      fragmentShader: /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vA;
varying float vT;
void main() {
  float a = vA * uOpacity * (0.25 + vT * 0.75);
  gl_FragColor = vec4(uColor, a);
}`,
      transparent: true,
      depthWrite: false,
    });
    this.rain = new THREE.Mesh(g, this.rainMat);
    this.rain.frustumCulled = false;
    this.rain.renderOrder = 6;
    this.rain.visible = false;

    // snow: soft flakes drifting down with a sway
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(seeds(SNOW_N, 23), 3));
    sg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    this.snowMat = new THREE.ShaderMaterial({
      uniforms: { ...common, uSpeed: { value: 0.11 }, uPx: { value: 1 } },
      vertexShader: /* glsl */ `
uniform float uTime;
uniform vec3 uCenter;
uniform vec3 uBox;
uniform vec2 uWind;
uniform float uSpeed;
uniform float uPx;
varying float vA;
void main() {
  vec3 s = position;
  float fall = fract(s.y + uTime * uSpeed * (0.7 + s.z * 0.6));
  float sw = sin(uTime * (0.8 + s.x) + s.z * 40.0);
  vec3 p = uCenter + vec3((s.x - 0.5) * uBox.x + sw * 0.6 + uWind.x * fall * 6.0, (1.0 - fall) * uBox.y, (fract(s.z * 7.13) - 0.5) * uBox.z + cos(uTime * 0.7 + s.x * 30.0) * 0.4);
  vA = smoothstep(0.0, 0.05, fall) * (1.0 - smoothstep(0.93, 1.0, fall));
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  gl_PointSize = (3.0 + s.x * 4.0) * uPx;
}`,
      fragmentShader: /* glsl */ `
uniform float uOpacity;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.35, d) * vA * uOpacity;
  if (a < 0.02) discard;
  gl_FragColor = vec4(vec3(1.0), a);
}`,
      transparent: true,
      depthWrite: false,
    });
    this.snow = new THREE.Points(sg, this.snowMat);
    this.snow.frustumCulled = false;
    this.snow.renderOrder = 6;
    this.snow.visible = false;
    this.group.add(this.rain, this.snow);
  }

  set(kind: WeatherKind | null, windKmh = 10) {
    this.kind = kind;
    this.wind = Math.min(0.6, Math.max(0.08, windKmh / 60));
    const wet = kind === 'rain' || kind === 'storm';
    this.rain.visible = wet;
    this.rainGeo.instanceCount = kind === 'storm' ? RAIN_N : kind === 'rain' ? Math.round(RAIN_N * 0.62) : 0;
    this.rainMat.uniforms.uOpacity.value = kind === 'storm' ? 0.62 : 0.5;
    this.snow.visible = kind === 'snow';
    if (kind !== 'storm') this.flash = 0;
    this.bolt = 2 + Math.random() * 4;
  }

  // center: camera target on the ground; halfW / halfD: visible half extents
  // in world units; zoom: camera zoom; camRight: camera right vector.
  update(dt: number, t: number, center: THREE.Vector3, halfW: number, halfD: number, zoom: number, camRight: THREE.Vector3, dpr: number, night: number) {
    if (this.kind === 'storm' && !this.reduced) {
      this.bolt -= dt;
      if (this.bolt <= 0) {
        this.flash = 1;
        this.flicker = 0.14 + Math.random() * 0.1;
        this.bolt = 5 + Math.random() * 9;
      }
      if (this.flicker > 0) {
        this.flicker -= dt;
        if (this.flicker <= 0) this.flash = Math.max(this.flash, 0.75);
      }
    }
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 3.2);
    if (!this.rain.visible && !this.snow.visible) return;
    const H = 16 / Math.sqrt(zoom);
    for (const m of [this.rainMat, this.snowMat]) {
      const u = m.uniforms;
      u.uTime.value = t;
      (u.uCenter.value as THREE.Vector3).set(center.x, 0, center.z + H * 0.35);
      (u.uBox.value as THREE.Vector3).set(halfW * 2.3, H, halfD * 2.6 + H);
      (u.uWind.value as THREE.Vector2).set(this.wind, this.wind * 0.3);
    }
    const ru = this.rainMat.uniforms;
    (ru.uRight.value as THREE.Vector3).copy(camRight);
    ru.uLen.value = 2.0 / zoom;
    ru.uWidth.value = 0.075 / zoom;
    ru.uSpeed.value = 1.6;
    (ru.uColor.value as THREE.Color).set(night > 0.5 ? '#9fb0d0' : '#e6eef8');
    this.snowMat.uniforms.uPx.value = dpr;
    this.snowMat.uniforms.uOpacity.value = 0.95 - night * 0.25;
  }

  dispose() {
    this.rainGeo.dispose();
    this.rainMat.dispose();
    this.snow.geometry.dispose();
    this.snowMat.dispose();
  }
}
