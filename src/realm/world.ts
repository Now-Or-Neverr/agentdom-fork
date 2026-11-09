// Assembles the realm: a natural bay with an archipelago. Heightfield terrain
// (sand -> ochre earth -> grass, dirt roads, farmland), animated water with
// shoreline foam, province settlements, hamlets, fishing huts, piers,
// bridges, and thousands of instanced trees and rocks.
import * as THREE from 'three';
import { type ProvinceId } from '../../shared/realm';
import { C, Frame, Kit, rng } from './kit';
import { FARMS, MAP_X, MAP_Z, ROADS, SITES, fbm, height, inFarm, sampleRoad, shoreFrom, vnoise, type Site } from './layout';
import { buildSettlement } from './settlements';
import { boat, house, pier, PLANK, PLANK2 } from './buildings';
import { Nature, type Plant, type TreeKind } from './nature';
import { depthTexture, grain, terrainGeometry, waterMaterial, type Bounds } from './terrain';
import { signAtlas, softDot } from './tex';
import { enhance, heightTexture, lightMap, makeLook, type Look } from './look';
import type { Station } from './people';

export interface Mats {
  s: THREE.MeshLambertMaterial;
  glow: THREE.MeshBasicMaterial;
  halo: THREE.MeshBasicMaterial;
  lan: THREE.MeshBasicMaterial;
  win: THREE.MeshBasicMaterial;
  marks: THREE.MeshBasicMaterial;
  pools: THREE.MeshBasicMaterial;
  signs: THREE.MeshBasicMaterial;
  water: THREE.MeshLambertMaterial;
  ground: THREE.MeshLambertMaterial;
  pick: THREE.MeshBasicMaterial;
  look: Look;
  dispose(): void;
}

export function makeMats(): Mats {
  const atlas = signAtlas();
  const look = makeLook();
  const m = {
    s: enhance(new THREE.MeshLambertMaterial({ vertexColors: true }), look, { fx: true, ao: true, cloud: true, grade: true, lamp: true }) as THREE.MeshLambertMaterial,
    glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
    halo: new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false }),
    lan: new THREE.MeshBasicMaterial({ color: '#e6d3a6' }),
    win: new THREE.MeshBasicMaterial({ vertexColors: true }),
    marks: new THREE.MeshBasicMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    pools: new THREE.MeshBasicMaterial({ map: softDot(), color: '#ffcf80', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    signs: new THREE.MeshBasicMaterial({ map: atlas.tex, transparent: true, alphaTest: 0.1 }),
    water: new THREE.MeshLambertMaterial({ color: '#6cb9b2', emissive: '#1d5f6a', emissiveIntensity: 0.25 }),
    ground: enhance(new THREE.MeshLambertMaterial({ vertexColors: true, map: grain() }), look, { cloud: true, grade: true, lamp: true }) as THREE.MeshLambertMaterial,
    pick: new THREE.MeshBasicMaterial({ visible: false }),
  };
  return {
    ...m,
    look,
    dispose() {
      Object.values(m).forEach((x) => x.dispose());
      atlas.dispose();
    },
  };
}

export interface Graph {
  nodes: THREE.Vector3[];
  adj: number[][];
  homes: Partial<Record<ProvinceId, number[]>>;
  ring: number[];
}

export interface World {
  group: THREE.Group;
  pickBoxes: THREE.Mesh[];
  labelPos: Map<ProvinceId, THREE.Vector3>;
  topY: Map<ProvinceId, number>;
  graph: Graph;
  lights: THREE.Vector3[];
  smoke: THREE.Vector3[];
  lanes: { pts: THREE.Vector2[]; fishing: boolean }[];
  carts: THREE.Vector3[][];
  water: THREE.ShaderMaterial;
  ground: (x: number, z: number) => number;
  stations: Station[];
  blossoms: THREE.Vector3[]; // crowns of blossom trees (petals)
  meadow: THREE.Vector3[]; // firefly spots
  incense: THREE.Vector3[];
  dispose(): void;
}

// Build the merged meshes of a Kit into a group (shared by world and preview).
export function buildKit(k: Kit, mats: Mats, group: THREE.Object3D) {
  const list: [THREE.Mesh | null, 'solid' | 'flat' | 'over'][] = [
    [k.s.build(mats.s), 'solid'],
    [k.water.build(mats.water), 'flat'],
    [k.glow.build(mats.glow), 'flat'],
    [k.lan.build(mats.lan), 'flat'],
    [k.win.build(mats.win), 'flat'],
    [k.marks.build(mats.marks), 'flat'],
    [k.signs.build(mats.signs), 'flat'],
    [k.halo.build(mats.halo), 'over'],
    [k.pools.build(mats.pools), 'over'],
  ];
  const out: THREE.Mesh[] = [];
  for (const [m, kind] of list) {
    if (!m) continue;
    if (kind === 'solid') {
      m.castShadow = true;
      m.receiveShadow = true;
    }
    if (m.material === mats.water) m.receiveShadow = true;
    if (kind === 'over') m.renderOrder = 2;
    group.add(m);
    out.push(m);
  }
  return out;
}

// Bake the terrain grid heights into the look's height texture (contact shading).
export function bindHeight(look: Look, tg: THREE.BufferGeometry, b: Bounds, step: number, extra: { dispose(): void }[]) {
  const nx = Math.ceil((b.x1 - b.x0) / step);
  const nz = Math.ceil((b.z1 - b.z0) / step);
  const W = nx + 1;
  const H = nz + 1;
  const pa = tg.attributes.position.array as Float32Array;
  const ys = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) ys[i] = pa[i * 3 + 1];
  const tex = heightTexture(ys, W, H);
  extra.push(tex);
  const sx = b.x1 - b.x0;
  const sz = b.z1 - b.z0;
  look.uHeight.value = tex;
  look.uHB.value.set(b.x0 - (0.5 * sx) / nx, b.z0 - (0.5 * sz) / nz, (sx * W) / nx, (sz * H) / nz);
  look.uAO.value = 1;
}

// Fast bilinear terrain height from the terrain grid (no noise evaluation).
export function gridSampler(tg: THREE.BufferGeometry, b: Bounds, step: number) {
  const nx = Math.ceil((b.x1 - b.x0) / step);
  const nz = Math.ceil((b.z1 - b.z0) / step);
  const W = nx + 1;
  const pa = tg.attributes.position.array as Float32Array;
  const sx = (b.x1 - b.x0) / nx;
  const sz = (b.z1 - b.z0) / nz;
  return (x: number, z: number) => {
    const fx = Math.min(nx - 1e-4, Math.max(0, (x - b.x0) / sx));
    const fz = Math.min(nz - 1e-4, Math.max(0, (z - b.z0) / sz));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const k = j * W + i;
    const a = pa[k * 3 + 1];
    const b2 = pa[(k + 1) * 3 + 1];
    const c = pa[(k + W) * 3 + 1];
    const d = pa[(k + W + 1) * 3 + 1];
    return (a * (1 - tx) + b2 * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  };
}

// Raster of everything a walker would bump into (walls, platforms, posts,
// tree trunks): triangles of the static solid mesh that reach into the band
// 0.2 .. 1.05 above the local ground, plus plant trunks.
export function obstacleGrid(geo: THREE.BufferGeometry | null, gh: (x: number, z: number) => number, plants: Plant[], b: Bounds, res = 0.25) {
  const W = Math.ceil((b.x1 - b.x0) / res);
  const H = Math.ceil((b.z1 - b.z0) / res);
  const grid = new Uint8Array(W * H);
  const mark = (x: number, z: number) => {
    const i = Math.floor((x - b.x0) / res);
    const j = Math.floor((z - b.z0) / res);
    if (i >= 0 && j >= 0 && i < W && j < H) grid[j * W + i] = 1;
  };
  if (geo) {
    const p = geo.attributes.position.array as Float32Array;
    for (let t = 0; t < p.length; t += 9) {
      const ax = p[t], ay = p[t + 1], az = p[t + 2];
      const bx = p[t + 3], by = p[t + 4], bz = p[t + 5];
      const cx = p[t + 6], cy = p[t + 7], cz = p[t + 8];
      const y0 = Math.min(ay, by, cy);
      const y1 = Math.max(ay, by, cy);
      const g = gh((ax + bx + cx) / 3, (az + bz + cz) / 3);
      if (y1 < g + 0.2 || y0 > g + 1.05) continue;
      const L = Math.max(Math.hypot(bx - ax, bz - az), Math.hypot(cx - bx, cz - bz), Math.hypot(ax - cx, az - cz));
      const n = Math.min(48, Math.max(1, Math.ceil(L / 0.2)));
      for (let i = 0; i <= n; i++)
        for (let j = 0; j <= n - i; j++) {
          const u = i / n;
          const v = j / n;
          const y = ay + (by - ay) * u + (cy - ay) * v;
          if (y < g + 0.2 || y > g + 1.05) continue;
          mark(ax + (bx - ax) * u + (cx - ax) * v, az + (bz - az) * u + (cz - az) * v);
        }
    }
  }
  for (const pl of plants) {
    if (pl.kind === 'bush') continue;
    const r = (pl.kind === 'rock' ? 0.45 : 0.22) * pl.s;
    for (let dz = -r; dz <= r; dz += res * 0.7) for (let dx = -r; dx <= r; dx += res * 0.7) if (dx * dx + dz * dz <= r * r) mark(pl.x + dx, pl.z + dz);
  }
  const blocked = (x: number, z: number) => {
    const i = Math.floor((x - b.x0) / res);
    const j = Math.floor((z - b.z0) / res);
    if (i < 0 || j < 0 || i >= W || j >= H) return true;
    return grid[j * W + i] === 1;
  };
  return {
    blocked,
    // segment walkable (ends may touch obstacles; dry land only)
    clear(ax: number, az: number, bx: number, bz: number, ground: (x: number, z: number) => number) {
      const L = Math.hypot(bx - ax, bz - az);
      const n = Math.max(2, Math.ceil(L / 0.12));
      const px = -(bz - az) / (L || 1);
      const pz = (bx - ax) / (L || 1);
      for (let i = 0; i <= n; i++) {
        const d = (i / n) * L;
        if (d < 0.3 || d > L - 0.3) continue;
        const x = ax + ((bx - ax) * i) / n;
        const z = az + ((bz - az) * i) / n;
        if (ground(x, z) < 0.05) return false;
        for (const o of [-0.18, 0, 0.18]) if (blocked(x + px * o, z + pz * o)) return false;
      }
      return true;
    },
    // nearest free dry spot around (x, z)
    free(x: number, z: number, ground: (x: number, z: number) => number, maxR = 1.6): [number, number] | null {
      for (let r = 0; r <= maxR; r += res)
        for (let k = 0; k < Math.max(1, Math.round((r * Math.PI * 2) / res)); k++) {
          const a = (k / Math.max(1, Math.round((r * Math.PI * 2) / res))) * Math.PI * 2;
          const qx = x + Math.sin(a) * r;
          const qz = z + Math.cos(a) * r;
          if (blocked(qx, qz) || blocked(qx + 0.2, qz) || blocked(qx - 0.2, qz) || blocked(qx, qz + 0.2) || blocked(qx, qz - 0.2)) continue;
          if (ground(qx, qz) < 0.1) continue;
          return [qx, qz];
        }
      return null;
    },
  };
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// ---------- ground colours ----------
const COL = {
  bed: new THREE.Color('#d6c08a'),
  bedDeep: new THREE.Color('#7f9f94'),
  sand: new THREE.Color('#e9d6a2'),
  wetSand: new THREE.Color('#cdb27c'),
  earth: new THREE.Color('#c99c5e'),
  earth2: new THREE.Color('#b9874e'),
  grass: new THREE.Color('#8aa24c'),
  grass2: new THREE.Color('#6e8f3c'),
  lush: new THREE.Color('#5d8237'),
  rock: new THREE.Color('#8f877a'),
  road: new THREE.Color('#ead8ae'),
  court: new THREE.Color('#ccb084'),
  paved: new THREE.Color('#bfb196'),
  furrow: new THREE.Color('#a4834a'),
  crop: new THREE.Color('#9caf4c'),
  crop2: new THREE.Color('#c9b25a'),
};
const _a = new THREE.Color();
const _b = new THREE.Color();

export interface GroundCtx {
  road: (x: number, z: number) => number;
  sites: Site[];
}

export function groundColor(ctx: GroundCtx, x: number, z: number, h: number, slope: number, out: THREE.Color) {
  const n1 = fbm(x * 0.07, z * 0.07, 3, 21);
  const n2 = vnoise(x * 0.9, z * 0.9, 5);
  const n3 = fbm(x * 0.22, z * 0.22, 2, 41);
  if (h < 0.05) {
    out.copy(COL.bed).lerp(COL.bedDeep, smooth(0.2, 3.5, -h));
    out.lerp(COL.wetSand, smooth(-0.25, 0.05, h) * 0.6);
  } else {
    // earth / grass patches, greener inland and on hills
    const grassK = smooth(-0.22, 0.18, n1 + (h - 0.9) * 0.12 + n3 * 0.15);
    _a.copy(COL.earth).lerp(COL.earth2, smooth(-0.3, 0.4, n3));
    _b.copy(COL.grass).lerp(COL.grass2, smooth(-0.2, 0.5, n3));
    if (h > 2.2) _b.lerp(COL.lush, smooth(2.2, 4.5, h));
    out.copy(_a).lerp(_b, grassK);
    // beach
    out.lerp(COL.sand, 1 - smooth(0.12, 0.5, h + (n2 - 0.5) * 0.12));
    // rocky slopes
    out.lerp(COL.rock, smooth(0.6, 1.3, slope) * 0.85);
    // settlements: trampled earth / paving
    for (const s of ctx.sites) {
      const d = Math.hypot(x - s.x, z - s.z);
      if (d > s.r + 2) continue;
      const w = 1 - smooth(s.r * 0.55, s.r + 1.2 + n2, d);
      if (s.id === 'throne') {
        const lx = x - s.x;
        const lz = z - s.z;
        if (Math.abs(lx) < 11.2 && lz > -10.2 && lz < 8.3) out.lerp(COL.paved, 0.9);
        else out.lerp(COL.court, w * 0.7);
      } else out.lerp(COL.court, w * 0.75);
    }
    // farmland
    const fm = inFarm(x, z);
    if (fm) {
      const edge = Math.min(fm.w / 2 - Math.abs(fm.u), fm.d / 2 - Math.abs(fm.v));
      const row = Math.sin(fm.u * 3.4) > 0;
      const field = Math.floor((fm.v + fm.d / 2) / (fm.d / 2)) % 2 === 0;
      _a.copy(row ? COL.furrow : field ? COL.crop : COL.crop2);
      out.lerp(_a, smooth(0, 0.5, edge) * 0.9);
    }
    // roads
    const rd = ctx.road(x, z);
    if (rd > 0) out.lerp(COL.road, rd * 0.92);
  }
  out.multiplyScalar(0.93 + n2 * 0.14);
}

// Road raster: soft mask of all dirt roads (not bridges).
export function roadMask(b: Bounds, res = 0.5) {
  const W = Math.ceil((b.x1 - b.x0) / res) + 1;
  const H = Math.ceil((b.z1 - b.z0) / res) + 1;
  const grid = new Float32Array(W * H);
  for (const rd of ROADS) {
    if (rd.bridge) continue;
    const rw = rd.main ? 1.05 : 0.8;
    for (const [x, z] of sampleRoad(rd.pts, 0.35)) {
      const s = SITES.find((q) => Math.hypot(x - q.x, z - q.z) < q.r * 0.5);
      if (s) continue;
      const i0 = Math.floor((x - rw - 0.6 - b.x0) / res);
      const i1 = Math.ceil((x + rw + 0.6 - b.x0) / res);
      const j0 = Math.floor((z - rw - 0.6 - b.z0) / res);
      const j1 = Math.ceil((z + rw + 0.6 - b.z0) / res);
      for (let j = Math.max(0, j0); j <= Math.min(H - 1, j1); j++)
        for (let i = Math.max(0, i0); i <= Math.min(W - 1, i1); i++) {
          const gx = b.x0 + i * res;
          const gz = b.z0 + j * res;
          const d = Math.hypot(gx - x, gz - z);
          const v = 1 - smooth(rw * 0.55, rw + 0.35, d + (vnoise(gx * 1.3, gz * 1.3, 77) - 0.5) * 0.5);
          const k = j * W + i;
          if (v > grid[k]) grid[k] = v;
        }
    }
  }
  return (x: number, z: number) => {
    const fx = (x - b.x0) / res;
    const fz = (z - b.z0) / res;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    if (i < 0 || j < 0 || i >= W - 1 || j >= H - 1) return 0;
    const tx = fx - i;
    const tz = fz - j;
    const a = grid[j * W + i];
    const b2 = grid[j * W + i + 1];
    const c = grid[(j + 1) * W + i];
    const d = grid[(j + 1) * W + i + 1];
    return (a * (1 - tx) + b2 * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  };
}

// Wooden trestle bridge along a road polyline.
function bridge(k: Kit, pts: [number, number][]) {
  const s = sampleRoad(pts, 0.5);
  const ya = Math.max(0.5, height(s[0][0], s[0][1]));
  const yb = Math.max(0.5, height(s[s.length - 1][0], s[s.length - 1][1]));
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < s.length; i++) {
    const t = i / (s.length - 1);
    out.push(new THREE.Vector3(s[i][0], ya + (yb - ya) * t + Math.sin(Math.PI * t) * 0.9 + 0.12, s[i][1]));
  }
  for (let i = 0; i < out.length - 1; i++) {
    const a = out[i];
    const b = out[i + 1];
    k.seg(a, b, 1.5, i % 2 ? PLANK : PLANK2, k.s, 0.14);
    const d = new THREE.Vector3().subVectors(b, a).setY(0).normalize();
    const side = new THREE.Vector3(-d.z, 0, d.x);
    for (const sx of [-1, 1]) {
      const o = side.clone().multiplyScalar(sx * 0.7);
      k.seg(a.clone().add(o).setY(a.y + 0.5), b.clone().add(o).setY(b.y + 0.5), 0.07, C.woodD);
      if (i % 3 === 0) {
        k.seg(a.clone().add(o).setY(a.y), a.clone().add(o).setY(a.y + 0.55), 0.09, C.woodD);
        k.seg(a.clone().add(o).setY(-2.4), a.clone().add(o).setY(a.y), 0.14, PLANK2);
      }
    }
  }
  return out;
}

// ---------- sailing lanes ----------
// A lane is a closed loop through open water. Every point ALONG the loop (not just its corners)
// must be deep enough for the hull, keep the hull's half-width off the shore, and stay clear of
// piers, moored boats, stilt huts and bridges. Lanes also keep apart from each other, so boats on
// different lanes never sail through one another.
type Circle = [number, number, number]; // x, z, radius
interface LaneSpec {
  cx: number;
  cz: number;
  rx: number;
  rz: number;
  n: number;
  depth: number;
  rev: boolean;
  fishing: boolean;
}

function waterClear(x: number, z: number, depth: number, rad: number, obs: Circle[]) {
  if (height(x, z) > -depth) return false;
  for (let q = 0; q < 8; q++) {
    const a = (q / 8) * Math.PI * 2;
    if (height(x + Math.sin(a) * rad, z + Math.cos(a) * rad) > -depth * 0.45) return false;
  }
  for (const [ox, oz, or] of obs) if (Math.hypot(x - ox, z - oz) < or + rad) return false;
  return true;
}

function segClear(a: THREE.Vector2, b: THREE.Vector2, depth: number, rad: number, obs: Circle[]) {
  const steps = Math.max(1, Math.ceil(a.distanceTo(b) / 0.6));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    if (!waterClear(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, depth, rad, obs)) return false;
  }
  return true;
}

// Moves a point towards the lane centre until it is clear (or gives up).
function pullIn(x: number, z: number, cx: number, cz: number, depth: number, rad: number, obs: Circle[]) {
  for (let s = 0; s < 50; s++) {
    if (waterClear(x, z, depth, rad, obs)) return new THREE.Vector2(x, z);
    x += (cx - x) * 0.05;
    z += (cz - z) * 0.05;
  }
  return null;
}

function buildLane(sp: LaneSpec, rad: number, obs: Circle[]): THREE.Vector2[] | null {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < sp.n; i++) {
    const a = ((sp.rev ? -1 : 1) * i * Math.PI * 2) / sp.n;
    const p = pullIn(sp.cx + Math.sin(a) * sp.rx, sp.cz + Math.cos(a) * sp.rz, sp.cx, sp.cz, sp.depth, rad, obs);
    if (p) pts.push(p);
  }
  if (pts.length < 8) return null;
  // smooth the corners where it stays clear
  for (let it = 0; it < 3; it++)
    for (let i = 0; i < pts.length; i++) {
      const p = pts[(i + pts.length - 1) % pts.length];
      const q = pts[(i + 1) % pts.length];
      const m = new THREE.Vector2((p.x + q.x) / 2, (p.y + q.y) / 2).lerp(pts[i], 0.5);
      if (waterClear(m.x, m.y, sp.depth, rad, obs)) pts[i].copy(m);
    }
  // repair segments that cut a corner of land: add a pulled-in point in the middle
  for (let pass = 0; pass < 5; pass++) {
    let fixed = true;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if (segClear(a, b, sp.depth, rad, obs)) continue;
      fixed = false;
      const mid = pullIn((a.x + b.x) / 2, (a.y + b.y) / 2, sp.cx, sp.cz, sp.depth, rad, obs);
      if (!mid) return null;
      pts.splice(i + 1, 0, mid);
      i++;
    }
    if (fixed) break;
  }
  for (let i = 0; i < pts.length; i++) if (!segClear(pts[i], pts[(i + 1) % pts.length], sp.depth, rad, obs)) return null;
  return pts;
}

// Closest distance between two closed polylines (sampled).
function laneGap(a: THREE.Vector2[], b: THREE.Vector2[]) {
  // far apart bounding boxes: no need to compare every sample
  const box = (pts: THREE.Vector2[]) => pts.reduce((o, p) => [Math.min(o[0], p.x), Math.min(o[1], p.y), Math.max(o[2], p.x), Math.max(o[3], p.y)], [Infinity, Infinity, -Infinity, -Infinity]);
  const [ax0, az0, ax1, az1] = box(a);
  const [bx0, bz0, bx1, bz1] = box(b);
  const boxGap = Math.hypot(Math.max(0, bx0 - ax1, ax0 - bx1), Math.max(0, bz0 - az1, az0 - bz1));
  if (boxGap > 6) return boxGap;
  let best = Infinity;
  const sample = (pts: THREE.Vector2[]) => {
    const out: THREE.Vector2[] = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      const n = Math.max(1, Math.ceil(p.distanceTo(q) / 0.8));
      for (let s = 0; s < n; s++) out.push(p.clone().lerp(q, s / n));
    }
    return out;
  };
  const sa = sample(a);
  const sb = sample(b);
  for (const p of sa) for (const q of sb) best = Math.min(best, p.distanceTo(q));
  return best;
}

// Builds every lane; one that cannot fit (land, obstacles or another lane too close) is tried a
// little smaller or larger, and left out if nothing fits.
function planLanes(specs: LaneSpec[], obs: Circle[]) {
  const JUNK_R = 1.9; // half-width of a junk plus a margin
  const SAMPAN_R = 1.0;
  const out: { pts: THREE.Vector2[]; fishing: boolean }[] = [];
  for (const sp of specs) {
    const rad = sp.fishing ? SAMPAN_R : JUNK_R;
    for (const f of [1, 0.88, 1.12, 0.76, 1.24, 0.64]) {
      const pts = buildLane({ ...sp, rx: sp.rx * f, rz: sp.rz * f }, rad, obs);
      if (!pts) continue;
      const ok = out.every((o) => laneGap(pts, o.pts) > rad + (o.fishing ? SAMPAN_R : JUNK_R) + 0.6);
      if (!ok) continue;
      out.push({ pts, fishing: sp.fishing });
      break;
    }
  }
  return out;
}

const TREE_KINDS: TreeKind[] = ['pine', 'fir', 'oak', 'round', 'blossom', 'autumn'];
void TREE_KINDS;

export function buildWorld(mode: 'hero' | 'full', mats: Mats): World {
  const hero = mode === 'hero';
  const k = new Kit();
  const r = rng(20261105);
  const group = new THREE.Group();
  const extra: { dispose(): void }[] = [];
  const B: Bounds = { x0: -MAP_X, x1: MAP_X, z0: -MAP_Z, z1: MAP_Z };

  // --- terrain ---
  const road = roadMask(B, 0.5);
  const ctx: GroundCtx = { road, sites: SITES };
  const tg = terrainGeometry(B, hero ? 0.85 : 0.75, height, (x, z, h, sl, out) => groundColor(ctx, x, z, h, sl, out), 0.11);
  extra.push(tg);
  const terrain = new THREE.Mesh(tg, mats.ground);
  terrain.receiveShadow = true;
  terrain.castShadow = true;
  group.add(terrain);
  bindHeight(mats.look, tg, B, hero ? 0.85 : 0.75, extra);

  // --- water ---
  const depth = depthTexture(B, hero ? 420 : 640, height);
  const water = waterMaterial(depth, B);
  const wg = new THREE.PlaneGeometry(1200, 1200);
  wg.rotateX(-Math.PI / 2);
  const wm = new THREE.Mesh(wg, water);
  wm.renderOrder = 1;
  wm.frustumCulled = false;
  group.add(wm);
  extra.push(depth, water, wg);

  // --- settlements ---
  const labelPos = new Map<ProvinceId, THREE.Vector3>();
  const topY = new Map<ProvinceId, number>();
  const walkBy = new Map<ProvinceId, [number, number][]>();
  const spotList: Station[] = [];
  const blocked: [number, number, number][] = []; // x, z, radius (no trees / huts)
  for (const s of SITES) {
    const out = buildSettlement(k, s, r, height);
    labelPos.set(s.id, out.label);
    topY.set(s.id, out.top);
    walkBy.set(s.id, out.walk);
    spotList.push(...out.spots);
    blocked.push([s.x, s.z, s.id === 'throne' ? 16 : s.r + 0.6]);
  }

  // --- bridges and piers ---
  const bridgeDecks: THREE.Vector3[][] = [];
  for (const rd of ROADS) if (rd.bridge) bridgeDecks.push(bridge(k, rd.pts));
  const piers: [number, number, number, number][] = [
    // x, z (start on land), angle, length
    [-18.5, 11.5, Math.PI, 6],
    [-11.5, 13, Math.PI - 0.3, 4.5],
    [-24, 13, Math.PI + 0.35, 4.5],
    [7, 18, Math.PI - 0.15, 5],
    [23, 10, Math.PI + 0.7, 5],
    [-25, -24, Math.PI / 2 + 0.4, 4.5],
    [17, -28, -Math.PI / 2 - 0.3, 4.5],
    [-39, -4, Math.PI * 0.8, 4],
    [-56, -6, Math.PI, 4],
    [52, -24, Math.PI + 0.3, 4],
    [36, 24, Math.PI + 1.2, 4],
  ];
  const moored: [number, number, number][] = [];
  const pierList: [number, number, number, number][] = [];
  for (const [x, z, a, len] of piers) {
    const t = shoreFrom(x, z, a, 0.2);
    if (t < 0) continue;
    const rx = x + Math.sin(a) * (t - 1.4);
    const rz = z + Math.cos(a) * (t - 1.4);
    pier(k, rx, rz, a, len);
    pierList.push([rx, rz, a, len]);
    blocked.push([rx, rz, 1.5]);
    const ex = rx + Math.sin(a) * (len * 0.6);
    const ez = rz + Math.cos(a) * (len * 0.6);
    moored.push([ex + Math.cos(a) * 1.5, ez - Math.sin(a) * 1.5, a + 0.1]);
    if (r() < 0.6) moored.push([ex - Math.cos(a) * 1.5, ez + Math.sin(a) * 1.5, a - 0.15]);
  }
  for (const [x, z, a] of moored) boat(k, x, z, a, 1);

  const near = (x: number, z: number, pad: number) => blocked.some(([bx, bz, br]) => Math.hypot(x - bx, z - bz) < br + pad);
  const flatAt = (x: number, z: number, s: number) => {
    const hs = [height(x - s, z - s), height(x + s, z - s), height(x - s, z + s), height(x + s, z + s), height(x, z)];
    return { min: Math.min(...hs), max: Math.max(...hs) };
  };

  // --- hamlets along the roads ---
  let side = 1;
  for (const rd of ROADS) {
    if (rd.bridge) continue;
    const s = sampleRoad(rd.pts, 1);
    for (let i = 3; i < s.length - 2; i += 3) {
      if (r() > 0.55) continue;
      const [x0, z0] = s[i];
      const [x1, z1] = s[i + 1];
      const dx = x1 - x0;
      const dz = z1 - z0;
      const l = Math.hypot(dx, dz) || 1;
      side = -side;
      const off = 2.7 + r() * 1.2;
      const x = x0 + (-dz / l) * off * side;
      const z = z0 + (dx / l) * off * side;
      if (near(x, z, 1.8) || inFarm(x, z, 1) || road(x, z) > 0.05) continue;
      const fl = flatAt(x, z, 1.2);
      if (fl.min < 0.3 || fl.max - fl.min > 0.7) continue;
      const w = 1.8 + r() * 0.8;
      const d = 1.4 + r() * 0.5;
      house(k, Frame.at(x, fl.min, z, 0), 0, 0, w, d, Math.atan2(dx, dz) + (side > 0 ? Math.PI / 2 : -Math.PI / 2), r);
      blocked.push([x, z, 1.7]);
      if (r() < 0.35) k.lamp(Frame.at(x, fl.min, z), 1.6 * side, 0.4, 0, 1.3);
    }
  }
  // outlying houses around each settlement (organic village ring)
  for (const s of SITES) {
    const inner = s.id === 'throne' ? 16.5 : s.r + 1.6;
    const want = s.id === 'throne' ? 9 : 5;
    let got = 0;
    for (let t = 0; t < 60 && got < want; t++) {
      const a = r() * Math.PI * 2;
      const d = inner + r() * 3.2;
      const x = s.x + Math.sin(a) * d;
      const z = s.z + Math.cos(a) * d;
      if (near(x, z, 1.7) || inFarm(x, z, 1) || road(x, z) > 0.05) continue;
      const fl = flatAt(x, z, 1.2);
      if (fl.min < 0.35 || fl.max - fl.min > 0.6) continue;
      const w = 1.8 + r() * 0.9;
      house(k, Frame.at(x, fl.min, z, 0), 0, 0, w, 1.4 + r() * 0.5, Math.atan2(s.x - x, s.z - z) + (r() - 0.5) * 0.6, r);
      blocked.push([x, z, 1.8]);
      got++;
    }
  }
  // lanterns along the main roads
  for (const rd of ROADS) {
    if (rd.bridge) continue;
    const s2 = sampleRoad(rd.pts, 1);
    for (let i = 4; i < s2.length - 2; i += rd.main ? 5 : 8) {
      const [x0, z0] = s2[i];
      const [x1, z1] = s2[i + 1];
      const l = Math.hypot(x1 - x0, z1 - z0) || 1;
      const sd = i % 2 ? 1 : -1;
      const x = x0 + (-(z1 - z0) / l) * 1.45 * sd;
      const z = z0 + ((x1 - x0) / l) * 1.45 * sd;
      const h = height(x, z);
      if (h < 0.3 || near(x, z, 0.6)) continue;
      k.lamp(Frame.at(x, h - 0.05, z), 0, 0, 0, 1.45);
      blocked.push([x, z, 0.6]);
    }
  }
  // farmhouses beside the fields
  for (const [cx, cz, w, d, a] of FARMS) {
    const x = cx + Math.cos(a) * (w / 2 + 2.2);
    const z = cz - Math.sin(a) * (w / 2 + 2.2);
    if (near(x, z, 1)) continue;
    const fl = flatAt(x, z, 1.1);
    if (fl.min < 0.3) continue;
    house(k, Frame.at(x, fl.min, z, 0), 0, 0, 2.0, 1.5, a + Math.PI / 2, r);
    blocked.push([x, z, 1.8]);
    void d;
  }
  // fishing huts on stilts along the shores
  let huts = 0;
  const hutObs: Circle[] = [];
  for (let tries = 0; tries < 900 && huts < (hero ? 6 : 10); tries++) {
    const x = (r() * 2 - 1) * (MAP_X - 16);
    const z = (r() * 2 - 1) * (MAP_Z - 14);
    const h = height(x, z);
    if (h > -0.25 || h < -0.7) continue;
    if (near(x, z, 3)) continue;
    // must have land within 2.5 units
    let land = -1;
    for (let q = 0; q < 8; q++) {
      const a = (q / 8) * Math.PI * 2;
      if (height(x + Math.sin(a) * 2.5, z + Math.cos(a) * 2.5) > 0.3) land = a;
    }
    if (land < 0) continue;
    house(k, Frame.at(x, 0, z, 0), 0, 0, 1.8, 1.5, land + Math.PI, r, { stilts: 0.7, wall: '#a27b55' });
    blocked.push([x, z, 2.2]);
    hutObs.push([x, z, 1.8]);
    if (r() < 0.7) {
      const bx = x + Math.sin(land + Math.PI) * 2.0;
      const bz = z + Math.cos(land + Math.PI) * 2.0;
      boat(k, bx, bz, land + Math.PI / 2, 0.9);
      hutObs.push([bx, bz, 1.4]);
    }
    huts++;
  }

  // --- vegetation ---
  const plants: Plant[] = [];
  const step = hero ? 2.0 : 1.55;
  for (let z = -MAP_Z + 6; z < MAP_Z - 4; z += step)
    for (let x = -MAP_X + 6; x < MAP_X - 6; x += step) {
      const px = x + (r() - 0.5) * step * 0.9;
      const pz = z + (r() - 0.5) * step * 0.9;
      const h = height(px, pz);
      if (h < 0.32) continue;
      if (road(px, pz) > 0.04 || inFarm(px, pz, 0.6) || near(px, pz, 0.4)) continue;
      const forest = fbm(px * 0.045, pz * 0.045, 3, 31);
      const fl = flatAt(px, pz, 0.5);
      if (fl.max - fl.min > 1.1) continue;
      let p = smooth(-0.12, 0.28, forest) * 0.85 + 0.07;
      if (h > 2.4) p += 0.25;
      if (h < 0.65) p *= 0.45;
      if (r() > p) continue;
      let kind: TreeKind;
      const q = r();
      const autumn = vnoise(px * 0.07, pz * 0.07, 91) > 0.74;
      const bloom = vnoise(px * 0.08, pz * 0.08, 93) > 0.8;
      if (h > 2.4 || forest > 0.32) kind = q < 0.55 ? 'pine' : q < 0.85 ? 'fir' : 'oak';
      else if (autumn && q < 0.6) kind = 'autumn';
      else if (bloom && q < 0.5) kind = 'blossom';
      else kind = q < 0.4 ? 'oak' : q < 0.65 ? 'round' : q < 0.85 ? 'pine' : 'fir';
      const s = (kind === 'pine' ? 1.05 : 1.0) * (0.85 + r() * 0.5);
      plants.push({ kind, x: px, y: fl.min - 0.05, z: pz, s, ry: r() * 6.28, tint: 0.86 + r() * 0.24 });
      if (r() < 0.12) plants.push({ kind: 'bush', x: px + 0.9, y: height(px + 0.9, pz + 0.4), z: pz + 0.4, s: 0.7 + r() * 0.5, ry: r() * 6, tint: 0.85 + r() * 0.25 });
    }
  // trees inside / around settlements (along the rim)
  for (const s of SITES) {
    if (s.id === 'throne') continue;
    const n = 7 + Math.floor(r() * 4);
    for (let i = 0; i < n; i++) {
      const a = Math.PI * 0.55 + (i / n) * Math.PI * 0.9 + (r() - 0.5) * 0.2; // back half
      const d = s.r + 0.2 + r() * 1.6;
      const x = s.x + Math.sin(a + s.ry) * d;
      const z = s.z + Math.cos(a + s.ry) * d;
      const h = height(x, z);
      if (h < 0.35 || road(x, z) > 0.05) continue;
      plants.push({ kind: r() < 0.5 ? 'pine' : r() < 0.5 ? 'oak' : 'blossom', x, y: h - 0.05, z, s: 0.9 + r() * 0.4, ry: r() * 6, tint: 0.88 + r() * 0.2 });
    }
  }
  // rocks along the shores and on slopes
  const rstep = hero ? 1.6 : 1.1;
  for (let z = -MAP_Z + 4; z < MAP_Z - 4; z += rstep)
    for (let x = -MAP_X + 4; x < MAP_X - 4; x += rstep) {
      const px = x + (r() - 0.5) * rstep;
      const pz = z + (r() - 0.5) * rstep;
      const h = height(px, pz);
      const shore = h > -0.55 && h < 0.3;
      const cl = vnoise(px * 0.18, pz * 0.18, 61);
      if (shore && cl > 0.58 && r() < 0.45 && !near(px, pz, 0.5) && road(px, pz) < 0.05) {
        plants.push({ kind: 'rock', x: px, y: h - 0.1, z: pz, s: 0.35 + r() * 0.75, ry: r() * 6, tint: 0.85 + r() * 0.3 });
      } else if (h > 0.6) {
        const fl = flatAt(px, pz, 0.6);
        if (fl.max - fl.min > 0.7 && r() < 0.25 && !near(px, pz, 0.3)) plants.push({ kind: 'rock', x: px, y: fl.min - 0.05, z: pz, s: 0.5 + r() * 0.8, ry: r() * 6, tint: 0.85 + r() * 0.3 });
      }
    }
  const nature = new Nature(plants, mats.s, true);
  group.add(nature.group);
  extra.push(nature);

  // --- province pick boxes (main building bounds) ---
  const pickBoxes: THREE.Mesh[] = [];
  for (const s of SITES) {
    const bb = k.s.boxes.get(s.id);
    if (!bb) continue;
    const size = bb.getSize(new THREE.Vector3()).addScalar(0.4);
    const c = bb.getCenter(new THREE.Vector3());
    const pg = new THREE.BoxGeometry(size.x, size.y, size.z);
    extra.push(pg);
    const pm = new THREE.Mesh(pg, mats.pick);
    pm.position.copy(c);
    pm.userData.province = s.id;
    pickBoxes.push(pm);
    group.add(pm);
  }

  const meshes = buildKit(k, mats, group);

  // --- walking graph: road polylines + settlement plazas + piers, checked
  // against an obstacle raster so nobody walks through walls or into the sea ---
  const ground = gridSampler(tg, B, hero ? 0.85 : 0.75);
  const solid = meshes.find((m) => m.material === mats.s);
  const occ = obstacleGrid(solid?.geometry ?? null, ground, plants, B);
  const nodes: THREE.Vector3[] = [];
  const adj: number[][] = [];
  const keyMap = new Map<string, number>();
  const add = (x: number, y: number, z: number) => {
    nodes.push(new THREE.Vector3(x, y, z));
    adj.push([]);
    return nodes.length - 1;
  };
  const link = (a: number, b: number) => {
    if (a === b || adj[a].includes(b)) return;
    adj[a].push(b);
    adj[b].push(a);
  };
  const clearXZ = (ax: number, az: number, bx: number, bz: number) => occ.clear(ax, az, bx, bz, ground);
  const homes: Partial<Record<ProvinceId, number[]>> = {};
  for (const s of SITES) {
    const ids: number[] = [];
    for (const [x0, z0] of walkBy.get(s.id) ?? []) {
      const p = occ.free(x0, z0, ground);
      if (p) ids.push(add(p[0], ground(p[0], p[1]) + 0.01, p[1]));
    }
    homes[s.id] = ids;
    // link plaza spots that can see each other
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const a = nodes[ids[i]];
        const b = nodes[ids[j]];
        if (a.distanceTo(b) < 8 && clearXZ(a.x, a.z, b.x, b.z)) link(ids[i], ids[j]);
      }
  }
  const nearestClear = (x: number, z: number, maxD: number, skip = -1) => {
    const cand: { id: number; d: number }[] = [];
    nodes.forEach((n, id) => {
      if (id === skip) return;
      const d = Math.hypot(n.x - x, n.z - z);
      if (d < maxD) cand.push({ id, d });
    });
    cand.sort((a, b) => a.d - b.d);
    for (const c of cand.slice(0, 12)) if (clearXZ(x, z, nodes[c.id].x, nodes[c.id].z)) return c.id;
    return -1;
  };
  const ring: number[] = [];
  const carts: THREE.Vector3[][] = [];
  let bi = 0;
  for (const rd of ROADS) {
    const deck = rd.bridge ? bridgeDecks[bi++] : null;
    const s = deck ? deck.map((v) => [v.x, v.z] as [number, number]) : sampleRoad(rd.pts, 1.6);
    const keep: { x: number; z: number; y: number }[] = [];
    s.forEach(([x, z], i) => {
      const site = SITES.find((q) => Math.hypot(x - q.x, z - q.z) < q.r * 0.75);
      if (site) return;
      keep.push({ x, z, y: deck ? deck[i].y + 0.08 : ground(x, z) + 0.01 });
    });
    if (deck && keep.length > 6) keep.splice(1, keep.length - 2, ...keep.slice(1, -1).filter((_, i) => i % 3 === 0));
    let prev = -1;
    const path: THREE.Vector3[] = [];
    keep.forEach((p, i) => {
      const end = i === 0 || i === keep.length - 1;
      const key = `${Math.round(p.x)},${Math.round(p.z)}`;
      let id = end ? keyMap.get(key) : undefined;
      if (id === undefined) {
        id = add(p.x, p.y, p.z);
        if (end) keyMap.set(key, id);
        ring.push(id);
      }
      if (prev >= 0) {
        const a = nodes[prev];
        if (deck || clearXZ(a.x, a.z, p.x, p.z)) link(prev, id);
      }
      prev = id;
      path.push(nodes[id]);
    });
    // connect both ends to a settlement plaza if one is in clear sight
    for (const e of [keep[0], keep[keep.length - 1]]) {
      if (!e) continue;
      const id = keyMap.get(`${Math.round(e.x)},${Math.round(e.z)}`);
      if (id === undefined) continue;
      let best = -1;
      let bd = 10;
      for (const ids of Object.values(homes))
        for (const h of ids!) {
          const d = Math.hypot(nodes[h].x - e.x, nodes[h].z - e.z);
          if (d < bd && clearXZ(e.x, e.z, nodes[h].x, nodes[h].z)) {
            bd = d;
            best = h;
          }
        }
      if (best >= 0) link(id, best);
    }
    if (!rd.bridge && path.length > 4) carts.push(path.map((v) => v.clone()));
  }
  // piers: a short walk out to the T-head, fishermen at the end
  const stations: Station[] = [];
  for (const [rx, rz, a, len] of pierList) {
    const f = Frame.at(rx, 0, rz, a);
    const p0 = f.pt(0, 0.4, 0.4);
    const p1 = f.pt(0, 0.4, len * 0.5);
    const p2 = f.pt(0, 0.4, len + 0.5);
    const i0 = add(p0.x, Math.max(0.4, ground(p0.x, p0.z) + 0.01), p0.z);
    const i1 = add(p1.x, 0.4, p1.z);
    const i2 = add(p2.x, 0.4, p2.z);
    link(i0, i1);
    link(i1, i2);
    const on = nearestClear(p0.x, p0.z, 8, i0);
    if (on >= 0 && !(on === i1 || on === i2)) link(i0, on);
    for (const sx of [-0.85, 0.55]) {
      const q = f.pt(sx, 0.38, len + 1.02);
      stations.push({ x: q.x, z: q.z, y: 0.38, ry: a + (sx < 0 ? -0.25 : 0.2), act: 'fish' });
    }
  }
  for (const s of spotList) {
    if (s.y === undefined && occ.blocked(s.x, s.z)) {
      const p = occ.free(s.x, s.z, ground, 0.8);
      if (!p) continue;
      s.x = p[0];
      s.z = p[1];
    }
    stations.push(s);
  }
  const ringOk = ring.filter((i) => adj[i].length > 0);
  // lantern light pools (night)
  const lm = lightMap(k.lights, B.x0, B.z0, B.x1 - B.x0, B.z1 - B.z0, hero ? 420 : 720);
  extra.push(lm);
  mats.look.uLightMap.value = lm;
  mats.look.uLB.value.set(B.x0, B.z0, B.x1 - B.x0, B.z1 - B.z0);
  water.uniforms.uLightMap.value = lm;
  water.uniforms.uLB.value.set(B.x0, B.z0, B.x1 - B.x0, B.z1 - B.z0);

  // petals from blossom crowns; fireflies over meadows near water and villages
  const blossoms = plants.filter((p) => p.kind === 'blossom').map((p) => new THREE.Vector3(p.x, p.y + 1.35 * p.s, p.z));
  const meadow: THREE.Vector3[] = [];
  for (let i = 0; i < plants.length && meadow.length < (hero ? 120 : 260); i += 3) {
    const p = plants[i];
    if (p.kind === 'rock' || p.y > 2.2) continue;
    const fx = p.x + (r() - 0.5) * 3;
    const fz = p.z + (r() - 0.5) * 3;
    const g = ground(fx, fz);
    if (g < 0.15 || occ.blocked(fx, fz)) continue;
    meadow.push(new THREE.Vector3(fx, g, fz));
  }

  // --- sailing lanes ---
  // everything a hull must not touch on the water
  const waterObs: Circle[] = [...hutObs];
  for (const [px, pz, a, len] of pierList) {
    for (let t = 0; t <= len; t += 0.8) waterObs.push([px + Math.sin(a) * t, pz + Math.cos(a) * t, 1.0]);
    waterObs.push([px + Math.sin(a) * (len + 0.6), pz + Math.cos(a) * (len + 0.6), 2.1]); // T head
  }
  for (const [mx, mz] of moored) waterObs.push([mx, mz, 1.6]);
  for (const rd of ROADS) if (rd.bridge) for (const [bx, bz] of sampleRoad(rd.pts, 0.8)) waterObs.push([bx, bz, 1.3]);
  const L = (cx: number, cz: number, rx: number, rz: number, n = 36, depth = 1.6, rev = false, fishing = false): LaneSpec => ({ cx, cz, rx, rz, n, depth, rev, fishing });
  // big junk lanes first (they need the most room), then fishing boats
  const lanes = planLanes(
    [
      // junks: each lane has its own stretch of water (the bay, the strait between the two
      // northern islands, the open sea to the north, east and west)
      L(11, -3, 13, 5.5, 40),
      L(0, -31, 5, 9, 28, 1.8, true),
      L(-20, -60, 24, 4, 40, 1.8),
      L(36, -61, 15, 3.5, 32, 1.8, true),
      L(54, -44, 8, 3, 24, 1.6, true),
      L(-58, -44, 10, 3, 24, 1.6),
      // fishing boats close to the shores
      L(-6, 7, 6, 2.6, 20, 0.8, false, true),
      L(-20, -20, 4, 3, 18, 0.8, false, true),
      L(30, -16, 4, 2.5, 18, 0.8, true, true),
      L(-60, -22, 4, 3, 18, 0.8, false, true),
      L(8, -44, 4, 2.4, 18, 0.8, true, true),
    ],
    waterObs,
  );

  return {
    group,
    pickBoxes,
    labelPos,
    topY,
    graph: { nodes, adj, homes, ring: ringOk },
    ground,
    stations,
    blossoms,
    meadow,
    incense: k.incense,
    lights: k.lights,
    smoke: k.smoke,
    lanes,
    carts,
    water,
    dispose() {
      meshes.forEach((m) => m.geometry.dispose());
      extra.forEach((g) => g.dispose());
    },
  };
}
