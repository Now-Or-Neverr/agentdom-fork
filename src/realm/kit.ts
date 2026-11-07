// Low-poly geometry kit. Static parts are merged per material so the whole realm
// renders in a handful of draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Imperial palette: charcoal tile roofs, dark lacquer timber, red columns,
// cream marble terraces, pale stone courtyards; warm paper lattices and glowing
// trims in each province colour.
export const C = {
  body: '#8c6744', // dark lacquer walls
  body2: '#a07a52',
  body3: '#3b2a1e',
  base: '#3a3430',
  roof: '#55504c', // slate tiles
  roof2: '#625c56',
  roofU: '#3d2e24', // eave underside (dark rafters)
  ridge: '#37322f',
  glassOff: '#3a2d24',
  ground: '#c9b089',
  plaza: '#cdb68e',
  plaza2: '#bfa77f',
  avenue: '#d6cebd',
  walk: '#e0d9cb',
  curb: '#c2b9a7',
  road: '#4d515d',
  road2: '#454955',
  mark: '#f4f1e8',
  markY: '#f2c94c',
  marble: '#c2b7a2',
  marble2: '#a79b87',
  col: '#7a3a28', // red lacquer columns
  colD: '#4e2f20',
  bracket: '#5d6e60', // painted bracket band
  rwall: '#cbb595', // ochre-red compound walls
  rwallD: '#a8916f',
  cwall: '#8b857b', // city wall bricks
  cwall2: '#9f988c',
  grass: '#9bd47b',
  grass2: '#8bc96a',
  leaf: '#5f8a3a',
  leaf2: '#6f9a45',
  leaf3: '#4f7a32',
  pine: '#335f3a',
  pine2: '#2b5233',
  blossom: '#e8a9b8',
  blossom2: '#d98ea2',
  blossom3: '#f3cbd4',
  trunk: '#6b4a33',
  rock: '#9b948a',
  rock2: '#878075',
  sand: '#e3cc98',
  wall: '#cfc7b6',
  wall2: '#b8b09e',
  wood: '#8a6446',
  woodD: '#5a4030',
  metal: '#22242b',
  bronze: '#5e5140',
  gold: '#f2c14e',
  goldD: '#c99a2e',
  cream: '#fff6e0',
  red: '#d9473a',
  lanternR: '#ff5b3a',
  white: '#ffffff',
};

export const WIN_WARM = '#ffd77a';
export const WIN_SOFT = '#ffe9b8';
export const WIN_COOL = '#ffe0a0';

export function mix(a: THREE.ColorRepresentation, b: THREE.ColorRepresentation, t: number) {
  return new THREE.Color(a).lerp(new THREE.Color(b), t);
}

// Bright neon version of a (possibly muted) province colour.
export function neon(hex: THREE.ColorRepresentation) {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  if (hsl.s < 0.2) return c.setHSL(0.6, 0.55, 0.72); // grey -> silver blue
  return c.setHSL(hsl.h, Math.min(1, hsl.s * 1.25 + 0.2), Math.min(0.66, Math.max(0.56, hsl.l + 0.12)));
}

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
export function M(x: number, y: number, z: number, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}

// Local coordinate frame (build objects relative to their own origin).
export class Frame {
  constructor(public m = new THREE.Matrix4()) {}
  static at(x: number, y: number, z: number, ry = 0) {
    return new Frame(M(x, y, z, ry));
  }
  sub(x: number, y: number, z: number, ry = 0) {
    return new Frame(this.m.clone().multiply(M(x, y, z, ry)));
  }
  mat(x: number, y: number, z: number, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) {
    return this.m.clone().multiply(M(x, y, z, ry, sx, sy, sz, rx, rz));
  }
  pt(x: number, y: number, z: number) {
    return new THREE.Vector3(x, y, z).applyMatrix4(this.m);
  }
}

const _c = new THREE.Color();
// Merged geometry with baked vertex colours.
// Per-vertex effect codes read by the realm shaders (see look.ts):
// 0 plain, 1 tiled roof, 2..3 fluttering cloth (2 + amount), 5 swaying foliage.
export const FX = { plain: 0, tiles: 1, cloth: 2, sway: 5 } as const;
export type FxFn = (x: number, y: number, z: number) => number;

export class Batch {
  parts: THREE.BufferGeometry[] = [];
  tag: string | null = null;
  fx = 0; // effect code applied to parts added while set
  boxes = new Map<string, THREE.Box3>();
  add(g: THREE.BufferGeometry, color: THREE.ColorRepresentation, m?: THREE.Matrix4, fx: number | FxFn = this.fx) {
    const geo = g.index ? g.toNonIndexed() : g.clone();
    if (m) geo.applyMatrix4(m);
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal') geo.deleteAttribute(k);
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const n = geo.attributes.position.count;
    const arr = new Float32Array(n * 3);
    const fa = new Float32Array(n);
    _c.set(color);
    const pa = geo.attributes.position.array as ArrayLike<number>;
    for (let i = 0; i < n; i++) {
      arr[i * 3] = _c.r;
      arr[i * 3 + 1] = _c.g;
      arr[i * 3 + 2] = _c.b;
      fa[i] = typeof fx === 'number' ? fx : fx(pa[i * 3], pa[i * 3 + 1], pa[i * 3 + 2]);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    geo.setAttribute('fx', new THREE.BufferAttribute(fa, 1));
    if (this.tag) {
      geo.computeBoundingBox();
      const b = this.boxes.get(this.tag);
      if (b) b.union(geo.boundingBox!);
      else this.boxes.set(this.tag, geo.boundingBox!.clone());
    }
    this.parts.push(geo);
  }
  build(mat: THREE.Material): THREE.Mesh | null {
    if (!this.parts.length) return null;
    const merged = mergeGeometries(this.parts, false);
    this.parts.forEach((p) => p.dispose());
    this.parts = [];
    if (!merged) return null;
    merged.computeBoundingSphere();
    return new THREE.Mesh(merged, mat);
  }
}

// Fast batch of flat quads (windows, paving lines, light pools, signs).
// The unit quad lies in the local XY plane facing +Z.
const QV = [
  [-0.5, -0.5],
  [0.5, -0.5],
  [0.5, 0.5],
  [-0.5, 0.5],
];
const _v = new THREE.Vector3();
export class QuadBatch {
  pos: number[] = [];
  col: number[] = [];
  uv: number[] = [];
  idx: number[] = [];
  add(m: THREE.Matrix4, color: THREE.ColorRepresentation = '#ffffff', uv: [number, number, number, number] = [0, 0, 1, 1]) {
    const base = this.pos.length / 3;
    _c.set(color);
    QV.forEach(([x, y], i) => {
      _v.set(x, y, 0).applyMatrix4(m);
      this.pos.push(_v.x, _v.y, _v.z);
      this.col.push(_c.r, _c.g, _c.b);
      this.uv.push(i === 0 || i === 3 ? uv[0] : uv[2], i < 2 ? uv[1] : uv[3]);
    });
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  // flat on the ground (facing up)
  ground(x: number, y: number, z: number, w: number, d: number, color: THREE.ColorRepresentation, ry = 0, uv?: [number, number, number, number]) {
    this.add(M(x, y, z, ry, w, d, 1, -Math.PI / 2), color, uv);
  }
  build(mat: THREE.Material): THREE.Mesh | null {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    this.pos = this.col = this.uv = this.idx = [];
    return new THREE.Mesh(g, mat);
  }
}

// Template geometries (cloned, never disposed).
export const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl4: new THREE.CylinderGeometry(1, 1, 1, 4),
  cyl6: new THREE.CylinderGeometry(1, 1, 1, 6),
  cyl8: new THREE.CylinderGeometry(1, 1, 1, 8),
  cyl12: new THREE.CylinderGeometry(1, 1, 1, 12),
  cyl16: new THREE.CylinderGeometry(1, 1, 1, 16),
  cyl24: new THREE.CylinderGeometry(1, 1, 1, 24),
  cyl48: new THREE.CylinderGeometry(1, 1, 1, 48),
  cone4: new THREE.CylinderGeometry(0, 1, 1, 4),
  cone8: new THREE.CylinderGeometry(0, 1, 1, 8),
  cone12: new THREE.CylinderGeometry(0, 1, 1, 12),
  ico0: new THREE.IcosahedronGeometry(1, 0),
  ico1: new THREE.IcosahedronGeometry(1, 1),
  sph: new THREE.SphereGeometry(1, 10, 8),
  sphL: new THREE.SphereGeometry(1, 7, 5),
  col6: new THREE.CylinderGeometry(1, 1, 1, 6, 1, true),
  dome: new THREE.SphereGeometry(1, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2),
  torus: new THREE.TorusGeometry(1, 0.06, 6, 32),
  tri: (() => {
    // triangular prism: base on y=0 (x -0.5..0.5), apex at y=1, depth along z
    const g = new THREE.CylinderGeometry(1, 1, 1, 3);
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0.5, 0);
    g.scale(1 / Math.sqrt(3), 1 / 1.5, 1);
    return g;
  })(),
};
const CYL = { 4: G.cyl4, 6: G.cyl6, 8: G.cyl8, 12: G.cyl12, 16: G.cyl16, 24: G.cyl24, 48: G.cyl48 } as const;
export type Seg = keyof typeof CYL;

const Z_AXIS = new THREE.Vector3(0, 0, 1);
const _d = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _sq = new THREE.Quaternion();
// Box stretched between two points (in world space), w x h cross-section.
export function segMat(a: THREE.Vector3, b: THREE.Vector3, w: number, h = w) {
  _d.subVectors(b, a);
  const len = _d.length() || 1e-4;
  _sq.setFromUnitVectors(Z_AXIS, _d.multiplyScalar(1 / len));
  _mid.addVectors(a, b).multiplyScalar(0.5);
  return new THREE.Matrix4().compose(_mid, _sq, _s.set(w, h, len));
}

// Batches used while building a scene.
export class Kit {
  s = new Batch(); // lit, vertex colours
  glow = new Batch(); // neon trims, embers, lanterns (unlit)
  halo = new Batch(); // soft wide copies of neon trims (additive, night)
  lan = new Batch(); // lamp heads
  water = new Batch(); // moat, canals and ponds
  win = new QuadBatch(); // windows (unlit, vertex colours)
  marks = new QuadBatch(); // paving lines
  pools = new QuadBatch(); // lamp light pools on the ground
  signs = new QuadBatch(); // province icon plaques (atlas)
  lights: THREE.Vector3[] = []; // lamp points (glow sprites)
  smoke: THREE.Vector3[] = [];
  incense: THREE.Vector3[] = []; // thin incense smoke sources
  embers: THREE.Vector3[] = [];

  setTag(t: string | null) {
    this.s.tag = t;
  }
  box(f: Frame, x: number, y: number, z: number, w: number, h: number, d: number, col: THREE.ColorRepresentation, ry = 0, b: Batch = this.s, rx = 0, rz = 0) {
    b.add(G.box, col, f.mat(x, y + h / 2, z, ry, w, h, d, rx, rz));
  }
  cyl(f: Frame, x: number, y: number, z: number, r: number, h: number, col: THREE.ColorRepresentation, seg: Seg = 8, b: Batch = this.s, ry = 0) {
    b.add(CYL[seg], col, f.mat(x, y + h / 2, z, ry, r, h, r));
  }
  cone(f: Frame, x: number, y: number, z: number, r: number, h: number, col: THREE.ColorRepresentation, seg: 4 | 8 | 12 = 8, ry = 0) {
    this.s.add(seg === 4 ? G.cone4 : seg === 8 ? G.cone8 : G.cone12, col, f.mat(x, y + h / 2, z, ry + (seg === 4 ? Math.PI / 4 : 0), r, h, r));
  }
  ball(f: Frame, x: number, y: number, z: number, r: number, col: THREE.ColorRepresentation, b: Batch = this.s, sy = 1) {
    b.add(G.sphL, col, f.mat(x, y, z, 0, r, r * sy, r));
  }
  // Box between two world points.
  seg(a: THREE.Vector3, b: THREE.Vector3, w: number, col: THREE.ColorRepresentation, batch: Batch = this.s, h = w) {
    batch.add(G.box, col, segMat(a, b, w, h));
  }
  // Glowing line between two world points (with a soft halo copy).
  neonSeg(a: THREE.Vector3, b: THREE.Vector3, col: THREE.ColorRepresentation, t = 0.05, halo = 1) {
    this.glow.add(G.box, col, segMat(a, b, t));
    if (halo > 0) this.halo.add(G.box, col, segMat(a, b, t + 0.16 * halo));
  }
  // Neon bar (with a soft halo copy).
  neonBar(f: Frame, x: number, y: number, z: number, w: number, h: number, d: number, col: THREE.ColorRepresentation, ry = 0, halo = 1) {
    this.glow.add(G.box, col, f.mat(x, y, z, ry, w, h, d));
    if (halo > 0) {
      const p = 0.16 * halo;
      this.halo.add(G.box, col, f.mat(x, y, z, ry, w + (w > d ? 0.05 : p), h + p, d + (d > w ? 0.05 : p)));
    }
  }
  // Neon outline around a w x d rectangle at height y.
  neonRect(f: Frame, x: number, y: number, z: number, w: number, d: number, col: THREE.ColorRepresentation, t = 0.06, halo = 1) {
    this.neonBar(f, x, y, z + d / 2, w + t, t, t, col, 0, halo);
    this.neonBar(f, x, y, z - d / 2, w + t, t, t, col, 0, halo);
    this.neonBar(f, x + w / 2, y, z, t, t, d + t, col, 0, halo);
    this.neonBar(f, x - w / 2, y, z, t, t, d + t, col, 0, halo);
  }
  // Neon ring.
  neonRing(f: Frame, x: number, y: number, z: number, r: number, col: THREE.ColorRepresentation, t = 0.05) {
    this.glow.add(G.torus, col, f.mat(x, y, z, 0, r, r, r * (t / 0.06), Math.PI / 2));
    this.halo.add(G.torus, col, f.mat(x, y, z, 0, r, r, r * ((t * 3.2) / 0.06), Math.PI / 2));
  }
  // Window quad on a face; (x, y, z) is the centre, ry the face direction.
  window(f: Frame, x: number, y: number, z: number, w: number, h: number, ry: number, lit: boolean, col: string = WIN_WARM) {
    if (lit) this.win.add(f.mat(x, y, z, ry, w, h, 1), col);
    else this.s.add(G.box, C.glassOff, f.mat(x, y, z, ry, w, h, 0.02));
  }
  // Paper lattice window: warm panel with a dark wooden grid in front.
  lattice(f: Frame, x: number, y: number, z: number, w: number, h: number, lit = true, col: string = WIN_WARM, bars = 2) {
    this.window(f, x, y, z, w, h, 0, lit, col);
    const t = 0.035;
    const zz = z + 0.012;
    for (let i = 1; i <= bars; i++) this.win.add(f.mat(x - w / 2 + (w * i) / (bars + 1), y, zz, 0, t, h, 1), C.body3);
    this.win.add(f.mat(x, y + h * 0.12, zz, 0, w, t, 1), C.body3);
    this.win.add(f.mat(x, y - h / 2, zz, 0, w + 0.08, 0.05, 1), C.body3);
    this.win.add(f.mat(x, y + h / 2, zz, 0, w + 0.08, 0.05, 1), C.body3);
  }
  // Flat line / patch on the ground in a local frame.
  mark(f: Frame, x: number, y: number, z: number, w: number, d: number, col: THREE.ColorRepresentation) {
    this.marks.add(f.mat(x, y, z, 0, w, d, 1, -Math.PI / 2), col);
  }
  // Lantern on a wooden post with a little tiled cap; a light pool below.
  lamp(f: Frame, x: number, z: number, ry = 0, h = 1.7) {
    const lf = f.sub(x, 0, z, ry);
    this.box(lf, 0, 0, 0, 0.18, 0.12, 0.18, C.marble2);
    this.box(lf, 0, 0.12, 0, 0.08, h - 0.12, 0.08, C.woodD);
    this.box(lf, 0, h - 0.02, 0, 0.26, 0.04, 0.26, C.woodD);
    this.box(lf, 0, h + 0.02, 0, 0.2, 0.3, 0.2, '#ffffff', 0, this.lan);
    this.cone(lf, 0, h + 0.3, 0, 0.26, 0.2, C.ridge, 4);
    this.ball(lf, 0, h + 0.52, 0, 0.035, C.gold);
    const p = lf.pt(0, h + 0.17, 0);
    this.lights.push(p);
    const g = f.pt(x, 0, z);
    this.pools.ground(g.x, g.y + 0.04, g.z, 4.2, 4.2, '#ffffff');
  }
  // Stone lantern (garden).
  stoneLantern(f: Frame, x: number, z: number, y = 0) {
    this.box(f, x, y, z, 0.3, 0.08, 0.3, C.rock2);
    this.cyl(f, x, y + 0.08, z, 0.06, 0.32, C.rock, 6);
    this.box(f, x, y + 0.4, z, 0.26, 0.04, 0.26, C.rock);
    this.box(f, x, y + 0.44, z, 0.18, 0.16, 0.18, '#ffffff', 0, this.lan);
    this.cone(f, x, y + 0.6, z, 0.24, 0.16, C.rock2, 4);
    this.lights.push(f.pt(x, y + 0.52, z));
  }
  // Red paper lantern (hanging), glowing.
  redLantern(f: Frame, x: number, y: number, z: number, s = 1, col: string = C.lanternR, light = true) {
    this.box(f, x, y - 0.02 * s, z, 0.012, 0.08 * s, 0.012, C.metal);
    this.glow.add(G.sphL, col, f.mat(x, y - 0.18 * s, z, 0, 0.12 * s, 0.15 * s, 0.12 * s));
    this.box(f, x, y - 0.06 * s, z, 0.1 * s, 0.03 * s, 0.1 * s, C.goldD);
    this.box(f, x, y - 0.33 * s, z, 0.1 * s, 0.03 * s, 0.1 * s, C.goldD);
    if (light) this.lights.push(f.pt(x, y - 0.18 * s, z));
  }
  // Pine with flat cloud-like foliage pads.
  pine(f: Frame, x: number, z: number, s: number, r: () => number, y = 0) {
    const lean = (r() - 0.5) * 0.3;
    this.box(f, x, y, z, 0.13 * s, 0.9 * s, 0.13 * s, C.trunk, 0, this.s, 0, lean);
    const pads = 2;
    for (let i = 0; i < pads; i++) {
      const py = y + (0.6 + i * 0.42) * s;
      const ox = (r() - 0.5) * 0.5 * s + lean * i * 0.4 * s;
      const oz = (r() - 0.5) * 0.5 * s;
      const pr = (0.66 - i * 0.16) * s;
      this.s.add(G.sphL, i % 2 ? C.pine : C.pine2, f.mat(x + ox, py, z + oz, r() * 3, pr, pr * 0.42, pr * 0.85));
    }
  }
  // Cherry / plum blossom tree.
  blossom(f: Frame, x: number, z: number, s: number, r: () => number, y = 0) {
    this.cyl(f, x, y, z, 0.08 * s, 0.6 * s, C.trunk, 6);
    const cols = [C.blossom, C.blossom2, C.blossom3];
    this.ball(f, x, y + 0.95 * s, z, 0.5 * s, cols[Math.floor(r() * 3)], this.s, 0.9);
    this.ball(f, x + 0.28 * s, y + 0.8 * s, z + 0.12 * s, 0.33 * s, cols[Math.floor(r() * 3)]);
  }
  // Willow by the water.
  willow(f: Frame, x: number, z: number, s: number, y = 0) {
    this.cyl(f, x, y, z, 0.08 * s, 1.0 * s, C.trunk, 6);
    this.ball(f, x, y + 1.2 * s, z, 0.5 * s, '#a7d36a', this.s, 0.65);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      this.s.add(G.sphL, i % 2 ? '#9ccb5f' : '#b3da78', f.mat(x + Math.sin(a) * 0.36 * s, y + 0.85 * s, z + Math.cos(a) * 0.36 * s, a, 0.13 * s, 0.42 * s, 0.13 * s, 0, 0));
    }
  }
  // Mixed garden tree: pine, blossom or round.
  tree(f: Frame, x: number, z: number, s: number, r: () => number, y = 0) {
    const kind = r();
    if (kind < 0.3) return this.pine(f, x, z, s, r, y);
    if (kind < 0.55) return this.blossom(f, x, z, s, r, y);
    this.cyl(f, x, y, z, 0.08 * s, 0.55 * s, C.trunk, 6);
    const c = kind < 0.75 ? C.leaf : kind < 0.9 ? C.leaf2 : C.leaf3;
    this.ball(f, x, y + 0.95 * s, z, 0.55 * s, c, this.s, 1.05);
    if (kind > 0.8) this.ball(f, x + 0.22 * s, y + 0.75 * s, z + 0.18 * s, 0.36 * s, C.leaf3);
  }
  rock(f: Frame, x: number, z: number, s: number, r: () => number, y = 0) {
    this.s.add(G.ico0, r() < 0.5 ? C.rock : C.rock2, f.mat(x, y + 0.25 * s, z, r() * 6, 0.45 * s, 0.6 * s, 0.38 * s, r() * 0.4));
  }
  // Small hanging lamp.
  hang(f: Frame, x: number, y: number, z: number) {
    this.redLantern(f, x, y, z, 0.8);
  }
  // Clipped hedge.
  hedge(f: Frame, x: number, z: number, w: number, d: number, y = 0) {
    this.box(f, x, y, z, w, 0.38, d, C.leaf3);
  }
}
