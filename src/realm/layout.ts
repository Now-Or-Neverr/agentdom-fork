// Plan of the realm: a natural bay with an archipelago. Pure data + math (no
// three.js) so it can be sampled anywhere: land blobs, hills, settlement sites
// (one per province), roads, farmland, and the terrain height function.
// World axes: x to the right, z towards the viewer (south), y up; sea level 0.
import type { ProvinceId } from '../../shared/realm';

export const MAP_X = 82; // half extent of the terrain mesh
export const MAP_Z = 68;
export const VIEW_X = 64; // camera target clamp
export const VIEW_Z = 46;

// ---------- noise ----------
function hash(ix: number, iz: number, seed: number) {
  let h = (ix * 374761393 + iz * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function vnoise(x: number, z: number, seed = 1) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz, seed);
  const b = hash(ix + 1, iz, seed);
  const c = hash(ix, iz + 1, seed);
  const d = hash(ix + 1, iz + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
// fractal noise in [-1, 1]
export function fbm(x: number, z: number, oct = 4, seed = 1) {
  let s = 0;
  let a = 0.5;
  let f = 1;
  let n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * (vnoise(x * f, z * f, seed + i * 17) * 2 - 1);
    n += a;
    a *= 0.5;
    f *= 2.03;
  }
  return s / n;
}
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// ---------- land ----------
// [cx, cz, rx, rz, weight]
const LAND: [number, number, number, number, number][] = [
  [0, 46, 82, 31, 1], // southern mainland
  [57, 12, 24, 36, 1], // eastern land
  [-55, 10, 25, 31, 1], // western land
  [26, 22, 18, 13, 1], // south-east shore (theatre)
  [-31, -29, 14, 11, 0.9], // north-west island (archive)
  [26, -31, 12, 9, 0.9], // north-east island (atelier)
  [41, -6, 8, 7, 1], // heralds headland
  // islets
  [-14, -12, 2.8, 2.1, 0.7],
  [15, -15, 3.2, 2.3, 0.7],
  [-3, -44, 4.2, 3.0, 0.8],
  [-61, -31, 5.5, 4, 0.8],
  [62, -35, 5.5, 4.2, 0.8],
  [5, -60, 6, 3.5, 0.8],
  [-46, -50, 4, 3, 0.7],
  [44, -52, 3.5, 2.6, 0.7],
];
// hills on land: [cx, cz, rx, rz, height]
const HILLS: [number, number, number, number, number][] = [
  [-66, 30, 11, 10, 6],
  [-62, 46, 10, 7, 4],
  [66, 30, 12, 10, 5.5],
  [62, -12, 8, 9, 3.5],
  [-22, 50, 14, 6, 2.2],
  [26, 52, 14, 6, 2.4],
  [-36, -36, 6, 5, 2.2],
  [32, -36, 5, 4, 1.8],
  [-4, -45, 3, 2.2, 1.2],
];

export interface Site {
  id: ProvinceId;
  x: number;
  z: number;
  r: number; // plateau radius
  h: number; // plateau height
  ry: number; // facing of the main building (0 = towards the viewer)
}

export const SITES: Site[] = [
  { id: 'throne', x: 0, z: 27, r: 12.5, h: 2.2, ry: 0 },
  { id: 'bazaar', x: -16, z: 15, r: 7, h: 0.75, ry: 0.35 },
  { id: 'court', x: -27, z: 33, r: 7.5, h: 1.3, ry: 0.25 },
  { id: 'treasury', x: 22, z: 35, r: 7.5, h: 1.4, ry: -0.3 },
  { id: 'theatre', x: 29, z: 14, r: 7.5, h: 0.95, ry: -0.5 },
  { id: 'heralds', x: 41, z: -6, r: 6, h: 2.8, ry: -0.6 },
  { id: 'atelier', x: 25, z: -31, r: 7.5, h: 1.0, ry: -0.2 },
  { id: 'archive', x: -31, z: -29, r: 8, h: 1.1, ry: 0.25 },
  { id: 'scriptorium', x: -46, z: 2, r: 7.5, h: 1.2, ry: 0.55 },
  { id: 'forge', x: -50, z: 26, r: 7.5, h: 1.6, ry: 0.4 },
  { id: 'observatory', x: 46, z: 27, r: 7, h: 2.0, ry: -0.45 },
  { id: 'apothecary', x: -51, z: -18, r: 7, h: 1.2, ry: 0.7 },
  { id: 'arena', x: -46, z: 44, r: 8, h: 1.0, ry: 0.35 },
  { id: 'mint', x: 50, z: 44, r: 7, h: 1.3, ry: -0.4 },
];
export const SITE = Object.fromEntries(SITES.map((s) => [s.id, s])) as Record<ProvinceId, Site>;

export function provincePos(id: ProvinceId): [number, number] {
  const s = SITE[id];
  return [s.x, s.z];
}

// Roads between settlements: polylines; `bridge` spans water on a wooden deck.
export interface Road {
  pts: [number, number][];
  bridge?: boolean;
  main?: boolean;
}
export const ROADS: Road[] = [
  { pts: [[0, 27], [-6, 21], [-11, 17.5], [-16, 15]], main: true },
  { pts: [[0, 27], [-9, 31], [-18, 34], [-27, 33]], main: true },
  { pts: [[0, 27], [8, 32], [15, 35], [22, 35]], main: true },
  { pts: [[0, 27], [9, 22.5], [19, 18], [29, 14]], main: true },
  { pts: [[29, 14], [35, 9], [38.5, 2], [41, -6]] },
  { pts: [[-27, 33], [-34, 31], [-42, 28.5], [-50, 26]] },
  { pts: [[-50, 26], [-51, 17], [-48.5, 9], [-46, 2]] },
  { pts: [[-46, 2], [-38, 6], [-28, 11.5], [-16, 15]] },
  { pts: [[-46, 2], [-43, -5], [-39.5, -10.5]] },
  { pts: [[-39.5, -10.5], [-35, -19.5]], bridge: true },
  { pts: [[-35, -19.5], [-31, -29]] },
  { pts: [[41, -6], [41.5, -11.5]] },
  { pts: [[41.5, -11.5], [32, -23.5]], bridge: true },
  { pts: [[32, -23.5], [25, -31]] },
  // country lanes towards the southern farms
  { pts: [[0, 27], [-3, 38], [-8, 46]] },
  { pts: [[22, 35], [30, 40], [40, 36]] },
  { pts: [[-27, 33], [-33, 42]] },
  // roads to the newer provinces
  { pts: [[40, 36], [43.5, 31.5], [46, 27]] },
  { pts: [[-46, 2], [-49, -7], [-51, -18]] },
  { pts: [[-33, 42], [-40, 44], [-46, 44]] },
  { pts: [[30, 40], [36, 44.2], [43, 45.4], [50, 44]] },
];

// Farmland patches: [cx, cz, w, d, angle]
export const FARMS: [number, number, number, number, number][] = [
  [-11, 47, 11, 6, 0.15],
  [11, 46, 10, 6, -0.1],
  [38, 38, 8, 6, 0.35],
  [-36, 43, 8, 5.5, -0.3],
  [-58, 12, 6, 7, 0.5],
  [58, 6, 7, 6, -0.4],
];

// Raw land field: >0 on land.
function landField(x: number, z: number) {
  let v = -1;
  for (const [cx, cz, rx, rz, w] of LAND) {
    const q = Math.sqrt(((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2);
    v = Math.max(v, (1 - q) * w);
  }
  // ragged coast: big bays and capes plus small wiggles
  v += fbm(x * 0.035, z * 0.035, 4, 11) * 0.22 + fbm(x * 0.12, z * 0.12, 3, 5) * 0.06;
  // always sea at the map border
  v -= smooth(MAP_X - 18, MAP_X - 4, Math.abs(x)) * 0.8 + smooth(MAP_Z - 14, MAP_Z - 3, Math.abs(z)) * 0.8;
  return v;
}

function hillField(x: number, z: number) {
  let h = 0;
  for (const [cx, cz, rx, rz, hh] of HILLS) {
    const q = ((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2;
    if (q < 1) h = Math.max(h, hh * (1 - q) * (1 - q) * (1 + fbm(x * 0.2, z * 0.2, 2, 3) * 0.35));
  }
  return h;
}

/** Terrain height at (x, z) (sea level 0). Deterministic. */
export function height(x: number, z: number) {
  const v = landField(x, z);
  let h: number;
  if (v < 0) h = Math.max(-5.5, v > -0.1 ? v * 7 : -0.7 + (v + 0.1) * 20);
  else {
    // sandy beach then gentle rolling land
    const inland = smooth(0.05, 0.2, v);
    h = Math.min(v, 0.08) * 3.2 + inland * (0.6 + fbm(x * 0.08, z * 0.08, 3, 7) * 0.35);
    h += hillField(x, z) * smooth(0.03, 0.18, v);
  }
  // settlement plateaus (with a soft rim)
  for (const s of SITES) {
    const d = Math.hypot(x - s.x, z - s.z) + fbm(x * 0.3, z * 0.3, 2, 9) * 0.8;
    const w = smooth(s.r + 5.5, s.r - 0.5, d);
    if (w > 0) h = h + (s.h - h) * w;
  }
  return h;
}

/** Signed distance-ish helper: is (x, z) sea deeper than d? */
export function isWater(x: number, z: number, depth = 0.6) {
  return height(x, z) < -depth;
}

// ---------- helpers ----------
export function sampleRoad(pts: [number, number][], step = 1): [number, number][] {
  // Catmull-Rom through the points, sampled every ~step units
  const out: [number, number][] = [];
  const P = (i: number) => pts[Math.max(0, Math.min(pts.length - 1, i))];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = P(i - 1);
    const p1 = P(i);
    const p2 = P(i + 1);
    const p3 = P(i + 2);
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(1, Math.ceil(len / step));
    for (let j = 0; j < n; j++) {
      const t = j / n;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

export function inFarm(x: number, z: number, pad = 0) {
  for (const [cx, cz, w, d, a] of FARMS) {
    const dx = x - cx;
    const dz = z - cz;
    const u = dx * Math.cos(a) - dz * Math.sin(a);
    const v = dx * Math.sin(a) + dz * Math.cos(a);
    if (Math.abs(u) < w / 2 + pad && Math.abs(v) < d / 2 + pad) return { u, v, w, d };
  }
  return null;
}

export function nearSite(x: number, z: number, pad = 0) {
  for (const s of SITES) if (Math.hypot(x - s.x, z - s.z) < s.r + pad) return s;
  return null;
}

// Walk outwards from (x, z) along angle a until the sea is deeper than `depth`.
export function shoreFrom(x: number, z: number, a: number, depth = 0.2, max = 30) {
  const dx = Math.sin(a);
  const dz = Math.cos(a);
  for (let t = 0; t < max; t += 0.25) {
    if (height(x + dx * t, z + dz * t) < -depth) return t;
  }
  return -1;
}
