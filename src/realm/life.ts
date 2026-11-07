// Life in the realm: robed citizens on the roads, junks and fishing boats in
// the bay, ox-carts and palanquins, chimney smoke, lamp glows and a soft golden
// aura under the selected settlement.
import * as THREE from 'three';
import { PROVINCES, type ProvinceId, type Role } from '../../shared/realm';
import { Batch, C, FX, Frame, G, rng, type FxFn } from './kit';
import { bakeFigure } from './figures';
export { Walkers, type Station, type Act } from './people';
import { SITE } from './layout';
import { softDot } from './tex';
import type { Graph, Mats } from './world';

export { softDot };


const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _o = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const _roll = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();

// ---------- vehicles ----------
function palanquinGeo(cabin: string) {
  const b = new Batch();
  const f = new Frame();
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, c: string, rx = 0) => b.add(G.box, c, f.mat(x, y + h / 2, z, 0, w, h, d, rx));
  box(0, 0.42, 0, 0.62, 0.62, 0.78, cabin);
  box(0, 0.42, 0, 0.66, 0.06, 0.82, C.woodD);
  box(0, 0.62, 0.395, 0.34, 0.3, 0.02, '#e9dcbc');
  for (const sx of [-1, 1]) box(sx * 0.36, 0.55, 0, 0.04, 0.04, 2.0, C.woodD);
  b.add(G.cone4, C.roof, f.mat(0, 1.18, 0, Math.PI / 4, 0.62, 0.32, 0.72));
  box(0, 1.04, 0, 0.74, 0.04, 0.9, C.ridge);
  for (const sz of [-0.85, 0.85]) {
    b.add(G.cone8, '#5b5146', f.mat(0, 0.3, sz, 0, 0.18, 0.6, 0.18));
    b.add(G.sph, '#e6c4a2', f.mat(0, 0.7, sz, 0, 0.12, 0.12, 0.12));
    b.add(G.cone8, '#d9b26a', f.mat(0, 0.82, sz, 0, 0.22, 0.1, 0.22));
  }
  return b;
}

function oxCartGeo(load: string) {
  const b = new Batch();
  const f = new Frame();
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, c: string) => b.add(G.box, c, f.mat(x, y + h / 2, z, 0, w, h, d));
  box(0, 0.3, -0.35, 0.72, 0.12, 1.0, C.wood);
  for (const sx of [-1, 1]) box(sx * 0.34, 0.42, -0.35, 0.04, 0.2, 1.0, C.woodD);
  box(0, 0.42, -0.4, 0.56, 0.24, 0.7, load);
  for (const sx of [-1, 1]) b.add(G.cyl12, C.woodD, f.mat(sx * 0.4, 0.3, -0.35, 0, 0.3, 0.06, 0.3, 0, Math.PI / 2));
  box(0, 0.32, 0.45, 0.05, 0.05, 0.9, C.woodD);
  box(0, 0.24, 0.95, 0.36, 0.34, 0.66, '#5b4636');
  for (const sx of [-1, 1]) for (const sz of [0.72, 1.18]) box(sx * 0.12, 0, sz, 0.08, 0.26, 0.08, '#3a2c26');
  box(0, 0.42, 1.34, 0.24, 0.24, 0.26, '#5b4636');
  for (const sx of [-1, 1]) box(sx * 0.17, 0.62, 1.32, 0.14, 0.04, 0.04, '#efe6d2');
  // driver with a straw hat
  b.add(G.cone8, '#6b5a48', f.mat(0, 0.6, 0.35, 0, 0.13, 0.4, 0.13));
  b.add(G.sph, '#e6c4a2', f.mat(0, 1.06, 0.35, 0, 0.1, 0.1, 0.1));
  b.add(G.cone8, '#d9b26a', f.mat(0, 1.15, 0.35, 0, 0.24, 0.12, 0.24));
  return b;
}

function sampanGeo(canopy: string) {
  const b = new Batch();
  const f = new Frame();
  b.add(G.box, '#5a4232', f.mat(0, 0.12, 0, 0, 0.62, 0.26, 1.7));
  b.add(G.cone4, '#5a4232', f.mat(0, 0.12, 1.0, 0, 0.44, 0.34, 0.24, Math.PI / 2));
  b.add(G.cone4, '#5a4232', f.mat(0, 0.12, -1.0, 0, 0.44, 0.34, 0.24, -Math.PI / 2));
  b.add(G.box, C.wood, f.mat(0, 0.26, 0, 0, 0.54, 0.03, 1.6));
  b.add(new THREE.CylinderGeometry(1, 1, 1, 10, 1, true, -Math.PI / 2, Math.PI), canopy, f.mat(0, 0.27, -0.15, 0, 0.3, 0.75, 0.3, -Math.PI / 2));
  // fisherman with a rod at the bow, a rower at the stern
  bakeFigure(b, f.sub(0, 0.27, 0.6, 0.4).sub(0, 0, 0, 0), { hair: 'm', hat: 'straw', prop: 'rod', acc: 'none', robe: '#5d6a5a' }, '#c9a14a', { armR: -0.75, armL: -0.6 });
  bakeFigure(b, new Frame(f.mat(0, 0.27, -0.75, Math.PI, 0.9, 0.9, 0.9)), { hair: 'f', hat: 'scarf', prop: 'none', acc: 'none', robe: '#7a5a48' }, '#4a6aa0', { armR: -0.9, armL: -0.9 });
  b.add(G.box, C.woodD, f.mat(0.12, 0.4, -1.1, 0, 0.03, 0.03, 1.0, -0.5));
  return b;
}

// Junk: tall stern castle, raked bow, three masts with ribbed batten sails.
function junkGeo(sail: string, rib: string, pennant: string) {
  const b = new Batch();
  const f = new Frame();
  const hull = '#4e3828';
  const hull2 = '#6a4a32';
  b.add(G.box, hull, f.mat(0, 0.18, 0, 0, 1.15, 0.5, 3.0));
  b.add(G.box, hull, f.mat(0, 0.12, 1.6, 0, 0.9, 0.42, 0.5, -0.25));
  b.add(G.box, hull, f.mat(0, 0.28, 1.95, 0, 0.6, 0.36, 0.45, -0.4));
  b.add(G.box, hull, f.mat(0, 0.42, -1.55, 0, 1.15, 0.6, 0.6));
  b.add(G.box, hull2, f.mat(0, 0.46, 0.2, 0, 1.18, 0.07, 3.1));
  b.add(G.box, '#8a5a3a', f.mat(0, 0.62, -1.5, 0, 1.2, 0.36, 0.75));
  b.add(G.box, '#7a3a28', f.mat(0, 0.86, -1.55, 0, 1.0, 0.1, 0.6));
  b.add(G.box, C.wood, f.mat(0, 0.44, 0.2, 0, 1.0, 0.04, 2.5));
  b.add(G.box, hull, f.mat(0, 0.1, -1.95, 0, 0.08, 0.6, 0.3));
  const masts: [number, number, number, number][] = [
    // z, mast height, sail width, sail height
    [0.35, 3.6, 1.7, 2.7],
    [1.45, 2.6, 1.15, 1.9],
    [-1.25, 2.4, 1.0, 1.7],
  ];
  masts.forEach(([z, mh, sw, sh], i) => {
    b.add(G.cyl6, C.woodD, f.mat(0, 0.45 + mh / 2, z, 0, 0.05, mh, 0.05));
    const y0 = 0.45 + mh - sh - 0.15;
    const ry = 0.35 + Math.PI / 2; // sail across the hull, slightly turned
    // battened sail: billows gently away from the mast (vertex animation)
    const billow: FxFn = (x, _y, zz) => FX.cloth + Math.min(0.99, Math.hypot(x, zz - z) / (sw * 0.5)) * 0.32;
    b.add(G.box, sail, f.mat(0, y0 + sh / 2, z - 0.06, ry, 0.06, sh, sw, 0.12), billow);
    const n = Math.max(4, Math.round(sh / 0.42));
    for (let j = 0; j <= n; j++) b.add(G.box, rib, f.mat(0, y0 + (sh * j) / n, z - 0.06, ry, 0.045, 0.025, sw + 0.04), billow);
    if (i === 0) b.add(G.box, pennant, f.mat(0.18, 0.45 + mh + 0.05, z, 0, 0.36, 0.18, 0.02), (x) => FX.cloth + Math.min(0.99, Math.abs(x) / 0.36));
  });
  // crew on deck
  const crew: [number, number, number, number][] = [
    [0.25, 0.48, -0.2, 0.3],
    [-0.3, 0.48, 0.9, -2.4],
    [0.1, 0.92, -1.5, Math.PI],
  ];
  crew.forEach(([x, y, z, ry], i) =>
    bakeFigure(b, new Frame(f.mat(x, y, z, ry, 0.62, 0.62, 0.62)), { hair: 'm', hat: i === 2 ? 'futou' : 'band', prop: 'none', acc: 'none', robe: i === 2 ? '#3f4a5c' : '#6b5444' }, pennant, { armR: i === 1 ? -0.8 : -0.2, armL: -0.3 }),
  );
  return b;
}

interface Mover {
  mesh: THREE.Mesh;
  path: THREE.Vector3[];
  lens: number[];
  total: number;
  s: number;
  v: number;
  boat: boolean;
  loop: boolean;
  dir: number;
}

export class Movers {
  group = new THREE.Group();
  list: Mover[] = [];
  constructor(mats: Mats, lanes: { pts: THREE.Vector2[]; fishing: boolean }[], carts: THREE.Vector3[][], nJunks = 12, nCarts = 8) {
    const r = rng(41);
    const sails = ['#efe3c6', '#e6d3a8', '#d9b77a', '#efe3c6', '#c9935a', '#e9dcc0'];
    const ribs = ['#5a4030', '#4a3a2e', '#6b4a33'];
    const pens = PROVINCES.map((p) => p.color);
    const big = lanes.filter((l) => !l.fishing);
    const small = lanes.filter((l) => l.fishing);
    for (let i = 0; i < nJunks && big.length; i++) {
      const ln = big[i % big.length];
      const g = junkGeo(sails[i % sails.length], ribs[i % ribs.length], pens[i % pens.length]).build(mats.s)!;
      g.castShadow = true;
      g.scale.setScalar(1.4);
      this.add(g, ln.pts.map((p) => new THREE.Vector3(p.x, -0.16, p.y)), r() * 1000, 1.1 + r() * 0.5, true, true);
      this.wake(g, -1.95, 4.6, 2.6, (0.03 + 0.16) / 1.4);
    }
    const canopies = ['#7a6a48', '#6b5a3c', '#8a7350'];
    for (const ln of small) {
      const g = sampanGeo(canopies[Math.floor(r() * canopies.length)]).build(mats.s)!;
      g.castShadow = true;
      this.add(g, ln.pts.map((p) => new THREE.Vector3(p.x, -0.1, p.y)), r() * 1000, 0.5 + r() * 0.3, true, true);
      this.wake(g, -1.1, 2.8, 1.3, 0.13);
    }
    const loads = ['#c9b07a', '#8a6446', '#a7593a', '#d8c8a6'];
    for (let i = 0; i < nCarts && carts.length; i++) {
      const path = carts[i % carts.length];
      const pal = i % 3 === 1;
      const g = (pal ? palanquinGeo(['#7a3a28', '#5d6e60', '#8a6446'][i % 3]) : oxCartGeo(loads[i % loads.length])).build(mats.s)!;
      g.castShadow = true;
      g.scale.setScalar(0.85);
      this.add(g, path, r() * 1000, pal ? 0.8 + r() * 0.2 : 0.55 + r() * 0.2, false, false);
    }
  }
  private wakeMat: THREE.MeshBasicMaterial | null = null;
  private wakeGeo: THREE.PlaneGeometry | null = null;
  // Foam V trailing behind a boat (child of the hull, lies on the water).
  private wake(boat: THREE.Mesh, stern: number, len: number, w: number, y: number) {
    if (!this.wakeMat) {
      const c = document.createElement('canvas');
      c.width = 128;
      c.height = 256;
      const g = c.getContext('2d')!;
      g.lineCap = 'round';
      for (let i = 0; i < 26; i++) {
        const t = i / 25;
        const y0 = 256 - t * 250;
        const half = 6 + t * 40;
        const a = (1 - t) * 0.75;
        g.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
        for (const sx of [-1, 1]) {
          g.beginPath();
          g.ellipse(64 + sx * half, y0, 3.5 + t * 4, 6, sx * 0.45, 0, Math.PI * 2);
          g.fill();
        }
        g.fillStyle = `rgba(255,255,255,${(a * 0.45).toFixed(3)})`;
        g.beginPath();
        g.ellipse(64 + Math.sin(i * 1.7) * 4, y0, 6 + t * 10, 5, 0, 0, Math.PI * 2);
        g.fill();
      }
      const tex = new THREE.CanvasTexture(c);
      this.wakeMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.5 });
      this.wakeGeo = new THREE.PlaneGeometry(1, 1);
      this.wakeGeo.rotateX(-Math.PI / 2);
    }
    const m = new THREE.Mesh(this.wakeGeo!, this.wakeMat);
    m.scale.set(w, 1, len);
    m.position.set(0, y, stern - len / 2 + 0.3);
    m.renderOrder = 2;
    boat.add(m);
  }
  setNight(n: number) {
    if (this.wakeMat) this.wakeMat.opacity = 0.5 - n * 0.36;
  }
  private add(mesh: THREE.Mesh, path: THREE.Vector3[], s: number, v: number, boat: boolean, loop: boolean) {
    const n = loop ? path.length : path.length - 1;
    const lens: number[] = [];
    for (let i = 0; i < n; i++) lens.push(path[i].distanceTo(path[(i + 1) % path.length]) || 1e-3);
    const total = lens.reduce((a, b) => a + b, 0);
    this.list.push({ mesh, path, lens, total, s: s % total, v, boat, loop, dir: 1 });
    this.group.add(mesh);
  }
  update(dt: number, t: number) {
    for (const m of this.list) {
      if (m.loop) m.s = (m.s + m.v * dt) % m.total;
      else {
        m.s += m.v * dt * m.dir;
        if (m.s > m.total) {
          m.s = m.total;
          m.dir = -1;
        } else if (m.s < 0) {
          m.s = 0;
          m.dir = 1;
        }
      }
      let d = m.s;
      let i = 0;
      while (i < m.lens.length - 1 && d > m.lens[i]) {
        d -= m.lens[i];
        i++;
      }
      const a = m.path[i];
      const b = m.path[(i + 1) % m.path.length];
      const k = Math.min(1, d / m.lens[i]);
      const x = a.x + (b.x - a.x) * k;
      const z = a.z + (b.z - a.z) * k;
      const y = a.y + (b.y - a.y) * k;
      const head = Math.atan2(b.x - a.x, b.z - a.z) + (m.dir < 0 ? Math.PI : 0);
      let dh = head - m.mesh.rotation.y;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      m.mesh.rotation.y += dh * Math.min(1, dt * 3 + (t < 0.1 ? 1 : 0));
      if (m.boat) {
        m.mesh.position.set(x, y + Math.sin(t * 1.4 + m.s) * 0.05, z);
        m.mesh.rotation.z = Math.sin(t * 1.1 + m.s) * 0.035;
        m.mesh.rotation.x = Math.sin(t * 0.9 + m.s * 0.7) * 0.02;
      } else m.mesh.position.set(x, y + Math.abs(Math.sin(t * 6 + m.s)) * 0.02, z);
    }
  }
  dispose() {
    this.list.forEach((m) => m.mesh.geometry.dispose());
    this.wakeGeo?.dispose();
    this.wakeMat?.map?.dispose();
    this.wakeMat?.dispose();
  }
}

// ---------- particle sprites (all animated on the GPU) ----------
// Points have a fixed pixel size, so every sprite material takes uPpu
// (pixels per world unit) from the engine.
function sprites(n: number, fill: (i: number, pos: Float32Array, ph: Float32Array, sz: Float32Array) => void) {
  const pos = new Float32Array(n * 3);
  const ph = new Float32Array(n);
  const sz = new Float32Array(n);
  for (let i = 0; i < n; i++) fill(i, pos, ph, sz);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
  g.setAttribute('aSize', new THREE.BufferAttribute(sz, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  return g;
}
function spriteMat(vs: string, fs: string, color: string, additive: boolean) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPpu: { value: 30 }, uOpacity: { value: 1 }, uColor: { value: new THREE.Color(color) } },
    vertexShader: /* glsl */ `
uniform float uTime;
uniform float uPpu;
uniform float uOpacity;
attribute float aPhase;
attribute float aSize;
varying float vA;
varying float vR;
${vs}`,
    fragmentShader: /* glsl */ `
uniform vec3 uColor;
varying float vA;
varying float vR;
${fs}`,
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

export interface SmokeOpt {
  per?: number;
  rise?: number;
  size?: number;
  rate?: number;
  color?: string;
}

// Chimney / kiln / incense smoke: soft puffs rising, drifting with the wind and fading.
export class Smoke {
  mesh: THREE.Points;
  private mat: THREE.ShaderMaterial;
  private base: THREE.Color;
  constructor(src: THREE.Vector3[], o: SmokeOpt = {}) {
    const per = o.per ?? 9;
    const g = sprites(Math.max(1, src.length * per), (i, pos, ph, sz) => {
      const s = src[Math.floor(i / per)] ?? new THREE.Vector3(0, -99, 0);
      pos.set([s.x, s.y, s.z], i * 3);
      ph[i] = (i % per) / per + Math.floor(i / per) * 0.137;
      sz[i] = (o.size ?? 1) * (0.85 + ((i * 7) % 5) * 0.07);
    });
    const rise = (o.rise ?? 3.2).toFixed(2);
    const rate = (o.rate ?? 0.15).toFixed(3);
    this.base = new THREE.Color(o.color ?? '#eeeae2');
    this.mat = spriteMat(
      /* glsl */ `
void main() {
  float life = fract(uTime * ${rate} + aPhase);
  float sw = sin(uTime * 0.6 + aPhase * 17.0);
  vec3 p = position + vec3(life * 1.1 + sw * 0.22 * life, life * ${rise}, life * 0.45);
  vA = smoothstep(0.0, 0.1, life) * pow(1.0 - life, 1.4) * uOpacity;
  vR = aPhase * 6.28;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = (0.3 + life * 1.25) * aSize * uPpu;
}`,
      /* glsl */ `
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float lobe = 0.06 * sin(atan(c.y, c.x) * 3.0 + vR);
  float a = smoothstep(0.5 + lobe, 0.12, d) * vA;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor * (0.92 + (0.5 - gl_PointCoord.y) * 0.16), a);
}`,
      o.color ?? '#eeeae2',
      false,
    );
    this.mat.uniforms.uOpacity.value = 0.55;
    this.mesh = new THREE.Points(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
  }
  setPpu(ppu: number) {
    this.mat.uniforms.uPpu.value = ppu;
  }
  setNight(n: number) {
    (this.mat.uniforms.uColor.value as THREE.Color).copy(this.base).lerp(_c.set('#59607a'), n);
  }
  update(t: number) {
    this.mat.uniforms.uTime.value = t;
  }
  dispose() {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

// Warm glow on every lamp head (night), gently flickering.
export class Glows {
  points: THREE.Points;
  private mat: THREE.ShaderMaterial;
  constructor(pts: THREE.Vector3[], color = '#ffc978') {
    const g = sprites(Math.max(1, pts.length), (i, pos, ph, sz) => {
      const p = pts[i] ?? new THREE.Vector3(0, -99, 0);
      pos.set([p.x, p.y, p.z], i * 3);
      ph[i] = (i * 0.618) % 1;
      sz[i] = 1;
    });
    this.mat = spriteMat(
      /* glsl */ `
void main() {
  float f = 0.84 + 0.1 * sin(uTime * 7.0 + aPhase * 40.0) * sin(uTime * 2.3 + aPhase * 13.0) + 0.06 * sin(uTime * 13.0 + aPhase * 90.0);
  vA = uOpacity * f;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = 2.1 * uPpu * (0.94 + f * 0.08) * aSize;
}`,
      /* glsl */ `
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = pow(max(0.0, 1.0 - d), 1.8) * vA;
  gl_FragColor = vec4(uColor * a, a);
}`,
      color,
      true,
    );
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
  }
  setPpu(ppu: number) {
    this.mat.uniforms.uPpu.value = ppu;
  }
  setOpacity(o: number) {
    this.mat.uniforms.uOpacity.value = o;
    this.points.visible = o > 0.01;
  }
  update(t: number) {
    this.mat.uniforms.uTime.value = t;
  }
  dispose() {
    this.points.geometry.dispose();
    this.mat.dispose();
  }
}

// Fireflies drifting over meadows and along the shore at night.
export class Fireflies {
  points: THREE.Points;
  private mat: THREE.ShaderMaterial;
  constructor(spots: THREE.Vector3[]) {
    const g = sprites(Math.max(1, spots.length), (i, pos, ph, sz) => {
      const p = spots[i] ?? new THREE.Vector3(0, -99, 0);
      pos.set([p.x, p.y, p.z], i * 3);
      ph[i] = (i * 0.3819) % 1;
      sz[i] = 0.8 + ((i * 13) % 7) * 0.06;
    });
    this.mat = spriteMat(
      /* glsl */ `
void main() {
  float t = uTime * 0.5 + aPhase * 50.0;
  vec3 p = position + vec3(sin(t * 0.9) * 0.9 + sin(t * 2.1) * 0.2, 0.55 + sin(t * 1.3) * 0.35, cos(t * 0.7) * 0.9);
  float blink = pow(max(0.0, sin(uTime * 1.7 + aPhase * 31.0)), 3.0);
  vA = uOpacity * (0.25 + blink * 0.75);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = 0.42 * uPpu * aSize;
}`,
      /* glsl */ `
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = (pow(max(0.0, 1.0 - d), 3.0) + smoothstep(0.25, 0.0, d)) * vA;
  gl_FragColor = vec4(uColor * a, a);
}`,
      '#dfff8c',
      true,
    );
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
  }
  setPpu(ppu: number) {
    this.mat.uniforms.uPpu.value = ppu;
  }
  setOpacity(o: number) {
    this.mat.uniforms.uOpacity.value = o;
    this.points.visible = o > 0.01;
  }
  update(t: number) {
    this.mat.uniforms.uTime.value = t;
  }
  dispose() {
    this.points.geometry.dispose();
    this.mat.dispose();
  }
}

// Cherry petals drifting down from blossom trees.
export class Petals {
  points: THREE.Points;
  private mat: THREE.ShaderMaterial;
  constructor(trees: THREE.Vector3[], per = 6) {
    const g = sprites(Math.max(1, trees.length * per), (i, pos, ph, sz) => {
      const p = trees[Math.floor(i / per)] ?? new THREE.Vector3(0, -99, 0);
      pos.set([p.x, p.y, p.z], i * 3);
      ph[i] = (i % per) / per + Math.floor(i / per) * 0.29;
      sz[i] = 0.8 + ((i * 11) % 5) * 0.1;
    });
    this.mat = spriteMat(
      /* glsl */ `
void main() {
  float life = fract(uTime * 0.07 + aPhase);
  float t = uTime + aPhase * 40.0;
  vec3 p = position + vec3(sin(t * 1.1) * 0.5 + life * 2.2, -life * 2.3, cos(t * 0.8) * 0.45 + life * 0.6);
  vA = uOpacity * smoothstep(0.0, 0.08, life) * (1.0 - smoothstep(0.85, 1.0, life));
  vR = t * 1.7;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = 0.2 * uPpu * aSize;
}`,
      /* glsl */ `
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float cs = cos(vR), sn = sin(vR);
  c = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs);
  float d = length(c * vec2(1.0, 2.1));
  float a = smoothstep(0.5, 0.36, d) * vA;
  if (a < 0.02) discard;
  gl_FragColor = vec4(uColor * (0.9 + c.x * 0.4), a);
}`,
      '#ffc4d4',
      false,
    );
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
  }
  setPpu(ppu: number) {
    this.mat.uniforms.uPpu.value = ppu;
    this.points.visible = ppu > 28; // only when close enough to read
  }
  setOpacity(o: number) {
    this.mat.uniforms.uOpacity.value = o;
  }
  update(t: number) {
    this.mat.uniforms.uTime.value = t;
  }
  dispose() {
    this.points.geometry.dispose();
    this.mat.dispose();
  }
}

// Flocks of gulls wheeling over the bay (wing beat = vertical squash of a V).
export class Birds {
  mesh: THREE.InstancedMesh;
  private flocks: { cx: number; cz: number; r: number; y: number; w: number; n: number; ph: number }[] = [];
  constructor() {
    const g = new THREE.BufferGeometry();
    // body + two wings with raised tips (the y scale flaps them)
    const v = [0, 0, 0.18, -0.55, 0.22, -0.05, 0, 0, -0.12, 0, 0, 0.18, 0, 0, -0.12, 0.55, 0.22, -0.05];
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.computeVertexNormals();
    const m = new THREE.MeshBasicMaterial({ color: '#f4f1ea', side: THREE.DoubleSide });
    this.flocks = [
      { cx: 0, cz: -10, r: 9, y: 11, w: 0.16, n: 9, ph: 0 },
      { cx: -30, cz: -14, r: 6, y: 9, w: -0.22, n: 6, ph: 2 },
      { cx: 28, cz: -18, r: 7, y: 10, w: 0.19, n: 7, ph: 4 },
      { cx: 8, cz: 8, r: 5, y: 8, w: -0.25, n: 5, ph: 1 },
      { cx: -8, cz: -40, r: 10, y: 12, w: 0.13, n: 8, ph: 3 },
    ];
    const total = this.flocks.reduce((a, f) => a + f.n, 0);
    this.mesh = new THREE.InstancedMesh(g, m, total);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }
  setNight(n: number) {
    (this.mesh.material as THREE.MeshBasicMaterial).color.set('#f4f1ea').lerp(_c.set('#5a6280'), n);
  }
  update(t: number) {
    let i = 0;
    for (const f of this.flocks) {
      for (let k = 0; k < f.n; k++) {
        const a = t * f.w + f.ph + k * 0.32 * Math.sign(f.w) + Math.sin(t * 0.3 + k) * 0.05;
        const rr = f.r + Math.sin(k * 2.3 + t * 0.4) * 1.4;
        const x = f.cx + Math.sin(a) * rr;
        const z = f.cz + Math.cos(a) * rr;
        const y = f.y + Math.sin(t * 0.7 + k * 1.7) * 0.6;
        const head = a + (f.w > 0 ? Math.PI / 2 : -Math.PI / 2);
        const beat = Math.sin(t * 9 + k * 1.3);
        const glide = Math.sin(t * 0.5 + k) > 0.3 ? 0.25 : 1;
        _q.setFromAxisAngle(UP, head);
        _m.compose(_v.set(x, y, z), _q, _s.set(0.55, 0.3 + beat * 1.1 * glide, 0.55));
        this.mesh.setMatrixAt(i++, _m);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}

// Soft golden aura on the ground of the selected settlement.
export class Aura {
  mesh: THREE.Mesh;
  private mat: THREE.MeshBasicMaterial;
  private tex: THREE.CanvasTexture;
  constructor() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(128, 128, 40, 128, 128, 128);
    grd.addColorStop(0, 'rgba(255,255,255,0)');
    grd.addColorStop(0.72, 'rgba(255,255,255,0.18)');
    grd.addColorStop(0.9, 'rgba(255,255,255,0.75)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 256);
    this.tex = new THREE.CanvasTexture(c);
    const geo = new THREE.PlaneGeometry(2, 2);
    geo.rotateX(-Math.PI / 2);
    this.mat = new THREE.MeshBasicMaterial({ map: this.tex, color: '#f0c565', transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.visible = false;
    this.mesh.renderOrder = 3;
  }
  show(id: ProvinceId | null) {
    if (!id) {
      this.mesh.visible = false;
      return;
    }
    const s = SITE[id];
    this.mesh.visible = true;
    this.mesh.position.set(s.x, s.h + 0.06, s.z);
    this.mesh.userData.r = s.r - 0.2;
  }
  update(t: number) {
    if (!this.mesh.visible) return;
    const r = this.mesh.userData.r as number;
    this.mesh.scale.setScalar(r * (1 + Math.sin(t * 2) * 0.015));
    this.mat.opacity = 0.38 + Math.sin(t * 2) * 0.12;
  }
  dispose() {
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.tex.dispose();
  }
}
