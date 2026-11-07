// Natural-material buildings for the bay realm: timber houses with tiled hip
// roofs, round multi-tier temples, palisades, stone walls, wooden watchtowers,
// piers on stilts, market stalls, an opera stage, flags and banners.
// Local frames: +z is the front.
import * as THREE from 'three';
import { C, FX, Frame, G, Kit, WIN_SOFT, WIN_WARM, type FxFn } from './kit';
import { ROUND_TILES, roof } from './arch';

type Col = THREE.ColorRepresentation;

const paintLight = (c: Col) => '#' + new THREE.Color(c).lerp(new THREE.Color('#f6e7c0'), 0.55).getHexString();
type HFn = (x: number, z: number) => number;

export const WALLS = ['#cbb595', '#d8c8a6', '#a27b55', '#b48c62', '#c9b089', '#9a7450'];
export const ROOFS = ['#55504c', '#5e5853', '#4a4643', '#5a4e45', '#615a52'];
export const STONE = '#a39a8b';
export const STONE2 = '#8e867a';
export const PLANK = '#8f6a48';
export const PLANK2 = '#7a5a3d';

export interface HouseOpt {
  wall?: Col;
  roof?: Col;
  h?: number;
  acc?: Col | null; // ridge ornaments
  lit?: number;
  stilts?: number; // raise on posts (fishing huts)
}

// Small timber / plaster house with a tiled hip roof. Returns roof top y.
export function house(k: Kit, f: Frame, x: number, z: number, w: number, d: number, ry: number, r: () => number, o: HouseOpt = {}): number {
  const hf = f.sub(x, 0, z, ry);
  let y0 = 0;
  if (o.stilts) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(hf, (sx * w) / 2.2, -1.6, (sz * d) / 2.2, 0.14, o.stilts + 1.6, 0.14, PLANK2);
    k.box(hf, 0, o.stilts - 0.12, 0, w + 0.5, 0.12, d + 0.5, PLANK);
    y0 = o.stilts;
  } else k.box(hf, 0, -0.3, 0, w + 0.24, 0.52, d + 0.24, STONE);
  const H = o.h ?? 1.0 + r() * 0.25;
  const wall = o.wall ?? WALLS[Math.floor(r() * WALLS.length)];
  k.box(hf, 0, y0 + 0.22, 0, w, H, d, wall);
  // timber frame
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(hf, (sx * w) / 2, y0 + 0.22, (sz * d) / 2, 0.12, H, 0.12, C.woodD);
  k.box(hf, 0, y0 + 0.22 + H - 0.1, 0, w + 0.05, 0.1, d + 0.05, C.woodD);
  k.box(hf, 0, y0 + 0.22, 0, w + 0.05, 0.08, d + 0.05, C.woodD);
  // door + windows
  k.box(hf, -w * 0.12, y0 + 0.22, d / 2 + 0.005, 0.46, Math.min(0.78, H * 0.75), 0.04, '#4a3424');
  const lit = o.lit ?? 0.7;
  k.lattice(hf, w * 0.25, y0 + 0.22 + H * 0.55, d / 2 + 0.012, 0.42, 0.3, r() < lit, r() < 0.5 ? WIN_WARM : WIN_SOFT, 1);
  const sf = hf.sub(w / 2 + 0.012, 0, 0, Math.PI / 2);
  k.lattice(sf, 0, y0 + 0.22 + H * 0.55, 0, 0.36, 0.28, r() < lit * 0.6, WIN_WARM, 1);
  const eaveY = y0 + 0.22 + H;
  const top = roof(k, hf, 0, eaveY, 0, w + 0.75, d + 0.75, { h: (Math.min(w, d) + 0.75) * 0.46, col: o.roof ?? ROOFS[Math.floor(r() * ROOFS.length)], lift: 0.14, flare: 0.1, nu: 4, ends: o.acc ?? undefined });
  if (o.stilts) {
    // fishing nets drying on a pole frame
    if (r() < 0.6) {
      const sx = r() < 0.5 ? -1 : 1;
      for (const sz of [-0.5, 0.5]) k.box(hf, sx * (w / 2 + 0.45), y0, sz, 0.05, 0.9, 0.05, PLANK2);
      k.s.add(G.box, '#4a4a40', hf.mat(sx * (w / 2 + 0.45), y0 + 0.62, 0, 0, 0.02, 0.5, 1.0), FX.cloth + 0.25);
    }
  } else yard(k, hf, w, d, eaveY, top, r);
  return top;
}

// Household clutter around a house: chimney with smoke, washing line, barrels
// and crates, a woodpile, a fenced vegetable patch or a well.
export function yard(k: Kit, hf: Frame, w: number, d: number, eaveY: number, top: number, r: () => number) {
  if (r() < 0.42) {
    const cx = w * 0.26 * (r() < 0.5 ? -1 : 1);
    const cz = -d * 0.12;
    const ch = top - eaveY + 0.25;
    k.box(hf, cx, eaveY - 0.2, cz, 0.24, ch, 0.24, '#8a6a5a');
    k.box(hf, cx, eaveY - 0.2 + ch, cz, 0.32, 0.07, 0.32, '#4a4040');
    k.smoke.push(hf.pt(cx, eaveY + ch + 0.05, cz));
  }
  const side = r() < 0.5 ? -1 : 1;
  const q = r();
  if (q < 0.3) {
    // washing line with fluttering laundry
    const x0 = side * (w / 2 + 0.55);
    for (const sz of [-d / 2, d / 2 + 0.2]) k.box(hf, x0, 0, sz, 0.05, 1.05, 0.05, C.woodD);
    k.box(hf, x0, 0.99, (d / 2 + 0.2 - d / 2) / 2, 0.015, 0.015, d + 0.2, '#e8e0cc');
    const cloth = ['#e9e2d0', '#7aa0c0', '#c0473a', '#d9b46a', '#8aa86a'];
    const n = 2 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const zz = -d / 2 + 0.25 + ((d - 0.3) * (i + 0.5)) / n;
      const hgt = 0.22 + r() * 0.18;
      const lineY = 0.98;
      const g = hf.pt(0, lineY, 0).y;
      k.s.add(G.box, cloth[Math.floor(r() * cloth.length)], hf.mat(x0, lineY - hgt / 2, zz, 0, 0.02, hgt, 0.26), (_x, y) => FX.cloth + Math.min(0.9, Math.max(0, (g - y) / 0.45)) * 0.7);
    }
  } else if (q < 0.5) {
    // woodpile against the side wall
    const x0 = side * (w / 2 + 0.22);
    for (let row = 0; row < 3; row++)
      for (let i = 0; i < 4 - row; i++) k.s.add(G.cyl6, i % 2 ? '#9a7048' : '#a87c52', hf.mat(x0, 0.08 + row * 0.13, -d / 4 + (i + row * 0.5) * 0.15 - 0.2, 0, 0.065, 0.42, 0.065, 0, Math.PI / 2));
    k.box(hf, x0, 0.0, -d / 4, 0.46, 0.04, 0.7, C.woodD);
  } else if (q < 0.68) {
    // fenced vegetable patch
    const gx = side * (w / 2 + 0.8);
    k.box(hf, gx, -0.02, 0, 0.9, 0.06, d + 0.2, '#6e5236');
    for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) k.ball(hf, gx - 0.28 + i * 0.28, 0.1, -d / 2 + 0.2 + j * ((d - 0.2) / 3), 0.09, j % 2 ? '#6f9a45' : '#86ad4f', k.s, 0.7);
    const fx0 = gx - 0.5;
    const fx1 = gx + 0.5;
    const fz0 = -d / 2 - 0.15;
    const fz1 = d / 2 + 0.15;
    for (const [ax, az, bx, bz] of [
      [fx0, fz0, fx1, fz0],
      [fx0, fz1, fx1, fz1],
      [side > 0 ? fx1 : fx0, fz0, side > 0 ? fx1 : fx0, fz1],
    ]) {
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(2, Math.round(len / 0.3));
      for (let i = 0; i <= n; i++) k.box(hf, ax + ((bx - ax) * i) / n, 0, az + ((bz - az) * i) / n, 0.04, 0.32, 0.04, '#9a7a52');
      k.seg(hf.pt(ax, 0.25, az), hf.pt(bx, 0.25, bz), 0.025, '#8a6a46');
    }
  } else if (q < 0.76) {
    // stone well with a little roof
    const wx = side * (w / 2 + 0.75);
    const wz = d / 2 + 0.2;
    k.cyl(hf, wx, 0, wz, 0.26, 0.3, STONE, 12);
    k.cyl(hf, wx, 0.29, wz, 0.2, 0.02, '#3a6a7a', 12);
    for (const sx of [-1, 1]) k.box(hf, wx + sx * 0.24, 0.3, wz, 0.04, 0.5, 0.04, C.woodD);
    k.box(hf, wx, 0.78, wz, 0.56, 0.03, 0.03, C.woodD);
    k.s.add(G.tri, '#55504c', hf.mat(wx, 0.8, wz, Math.PI / 2, 0.6, 0.2, 0.62), FX.tiles);
    k.cyl(hf, wx, 0.5, wz, 0.05, 0.08, '#7a5a3d', 8);
  }
  // barrels, crates and sacks by the door
  if (r() < 0.55) {
    const bx = -side * (w / 2 + 0.05);
    const bz = d / 2 + 0.3;
    k.cyl(hf, bx, 0, bz, 0.15, 0.36, '#7a5236', 12);
    k.cyl(hf, bx, 0.08, bz, 0.155, 0.03, '#3a3036', 12);
    k.cyl(hf, bx, 0.26, bz, 0.155, 0.03, '#3a3036', 12);
    if (r() < 0.6) k.box(hf, bx - side * 0.36, 0, bz + 0.05, 0.3, 0.26, 0.3, '#9a7650', r());
    if (r() < 0.5) k.ball(hf, bx - side * 0.15, 0.12, bz + 0.32, 0.14, '#d2bf92', k.s, 0.75);
  }
}

// Concave round roof (lathe) from eave radius ro down to ri at height h.
function roundRoof(k: Kit, f: Frame, x: number, y: number, z: number, ro: number, ri: number, h: number, col: Col) {
  const pts: THREE.Vector2[] = [];
  const n = 7;
  pts.push(new THREE.Vector2(ro * 0.96, -0.12));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const rr = ro + (ri - ro) * t;
    const yy = h * Math.pow(t, 1.45) + 0.06 * Math.pow(1 - t, 6);
    pts.push(new THREE.Vector2(Math.max(0.001, rr), yy));
  }
  const g = new THREE.LatheGeometry(pts, 28);
  k.s.add(g, col, f.mat(x, y, z), ROUND_TILES);
  g.dispose();
  // eave edge band and soffit
  k.cyl(f, x, y - 0.14, z, ro * 0.97, 0.1, '#3a2c24', 24);
}

// Round multi-tier temple (Temple-of-Heaven-like) on three stone terraces.
export function roundTemple(k: Kit, f: Frame, x: number, z: number, s: number, r: () => number, acc: Col = C.goldD, terraces = 3): number {
  let y = 0;
  const T: [number, number][] = [
    [3.7, 0.4],
    [3.05, 0.38],
    [2.45, 0.36],
  ].slice(3 - terraces) as [number, number][];
  for (const [tr, th] of T) {
    const R = tr * s;
    const H = th * s;
    k.cyl(f, x, y, z, R, H, C.marble, 24);
    k.cyl(f, x, y + H - 0.06, z, R + 0.05, 0.08, C.marble2, 24);
    // balustrade
    const n = Math.max(12, Math.round((Math.PI * 2 * R) / 0.55));
    let prev: THREE.Vector3 | null = null;
    let first: THREE.Vector3 | null = null;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const px = x + Math.sin(a) * (R - 0.1);
      const pz = z + Math.cos(a) * (R - 0.1);
      if (Math.abs(Math.sin(a)) < 0.16 && Math.cos(a) > 0) {
        prev = null;
        continue; // stairs gap at the front
      }
      if (i < n) k.box(f, px, y + H, pz, 0.07, 0.24 * s, 0.07, C.marble);
      const p = f.pt(px, y + H + 0.2 * s, pz);
      if (prev) k.seg(prev, p, 0.05, C.marble);
      prev = p;
      if (!first) first = p;
    }
    // front stairs
    const steps = 3;
    for (let i = 0; i < steps; i++) k.box(f, x, y, z + R + (steps - i) * 0.18 - 0.1, 0.9 * s, (H * (i + 1)) / steps, 0.2, i % 2 ? C.marble2 : C.marble);
    y += H;
  }
  // tiers: drum + round roof
  const tiers: [number, number, number, number, number][] = [
    // drum radius, drum h, roof outer, roof inner, roof h
    [1.75, 1.25, 2.55, 1.35, 0.85],
    [1.32, 0.8, 2.05, 0.98, 0.72],
    [0.95, 0.72, 1.62, 0, 1.25],
  ];
  let top = y;
  tiers.forEach(([dr, dh, ro, ri, rh], i) => {
    const R = dr * s;
    const H = dh * s;
    k.cyl(f, x, y, z, R, H, i === 0 ? C.col : '#7d4030', 24);
    // columns around the first drum
    if (i === 0) {
      for (let q = 0; q < 12; q++) {
        const a = (q / 12) * Math.PI * 2 + Math.PI / 12;
        k.s.add(G.col6, '#6e2f22', f.mat(x + Math.sin(a) * (R + 0.12), y + H / 2, z + Math.cos(a) * (R + 0.12), 0, 0.08, H, 0.08));
      }
    }
    // lattice band (lit at night)
    const nw = i === 0 ? 12 : 10;
    for (let q = 0; q < nw; q++) {
      const a = (q / nw) * Math.PI * 2;
      const wf = f.sub(x + Math.sin(a) * (R + 0.012), 0, z + Math.cos(a) * (R + 0.012), a);
      k.lattice(wf, 0, y + H * 0.52, 0, Math.min(0.6, (Math.PI * 2 * R) / nw - 0.2), H * 0.55, r() < 0.85, WIN_WARM, 1);
    }
    y += H;
    // bracket band in the accent colour (painted), then the roof
    k.cyl(f, x, y, z, R + 0.08, 0.14 * s, acc, 24);
    y += 0.14 * s;
    roundRoof(k, f, x, y + 0.05, z, ro * s, ri * s, rh * s, i === 2 ? '#4f4a47' : C.roof);
    top = y + rh * s;
    y += rh * s * (i === 2 ? 1 : 0.92);
  });
  // gilded finial
  k.cyl(f, x, top - 0.05, z, 0.14 * s, 0.2 * s, C.goldD, 8);
  k.ball(f, x, top + 0.32 * s, z, 0.2 * s, '#d9a53a');
  k.cyl(f, x, top + 0.45 * s, z, 0.04 * s, 0.5 * s, C.goldD, 6);
  return top + 1.0 * s;
}

// Pointed log palisade along a world-space polyline (follows the ground).
export function palisade(k: Kit, pts: [number, number][], h: HFn, ht = 1.25, gap: [number, number] | null = null) {
  const root = new Frame();
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / 0.3));
    for (let j = 0; j < n; j++) {
      const t = (j + 0.5) / n;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      acc += len / n;
      if (gap && acc > gap[0] && acc < gap[1]) continue;
      const y = h(x, z);
      const lh = ht * (0.88 + ((j * 37) % 7) * 0.035);
      k.cyl(root, x, y - 0.3, z, 0.15, lh + 0.3, j % 2 ? PLANK : PLANK2, 6);
      k.cone(root, x, y + lh, z, 0.15, 0.28, PLANK2, 4);
    }
    // cross rail
    const ya = h(ax, az) + ht * 0.6;
    const yb = h(bx, bz) + ht * 0.6;
    k.seg(new THREE.Vector3(ax, ya, az), new THREE.Vector3(bx, yb, bz), 0.08, C.woodD);
  }
}

// Crenellated stone wall along a world-space polyline (follows the ground).
export function stoneWall(k: Kit, pts: [number, number][], h: HFn, ht = 1.5, t = 0.8, gaps: [number, number][] = []) {
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const ry = Math.atan2(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / 1.6));
    const sl = len / n;
    for (let j = 0; j < n; j++) {
      const tt = (j + 0.5) / n;
      const x = ax + (bx - ax) * tt;
      const z = az + (bz - az) * tt;
      const mid = acc + sl / 2;
      acc += sl;
      if (gaps.some(([g0, g1]) => mid > g0 && mid < g1)) continue;
      const y = Math.min(h(x - Math.sin(ry) * sl * 0.5, z - Math.cos(ry) * sl * 0.5), h(x, z), h(x + Math.sin(ry) * sl * 0.5, z + Math.cos(ry) * sl * 0.5));
      const wf = Frame.at(x, y, z, ry);
      k.box(wf, 0, -0.5, 0, t, ht + 0.5, sl + 0.04, (i + j) % 3 ? C.cwall : '#958f84');
      k.box(wf, 0, ht - 0.1, 0, t + 0.1, 0.12, sl + 0.06, C.cwall2);
      for (let m = 0; m < 2; m++) k.box(wf, t / 2 - 0.12, ht, -sl / 4 + (m * sl) / 2, 0.22, 0.28, sl * 0.28, C.cwall2);
    }
  }
}

// Square stone tower with a small two-eave pavilion on top.
export function stoneTower(k: Kit, x: number, y: number, z: number, s: number, ht: number, ry: number, r: () => number, acc?: Col) {
  const f = Frame.at(x, y, z, ry);
  k.box(f, 0, -0.6, 0, s, ht + 0.6, s, C.cwall);
  k.box(f, 0, ht - 0.14, 0, s + 0.16, 0.16, s + 0.16, C.cwall2);
  for (let q = 0; q < 4; q++) {
    const sf = f.sub(0, 0, 0, (q * Math.PI) / 2);
    for (let i = 0; i < 3; i++) k.box(sf, -s / 2 + 0.2 + (i * (s - 0.4)) / 2, ht, s / 2 - 0.12, 0.24, 0.26, 0.22, C.cwall2);
  }
  const pw = s * 0.62;
  k.box(f, 0, ht, 0, pw, 0.9, pw, C.body2);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(f, (sx * pw) / 2, ht, (sz * pw) / 2, 0.1, 0.9, 0.1, C.woodD);
  k.lattice(f, 0, ht + 0.5, pw / 2 + 0.01, pw * 0.5, 0.36, r() < 0.8, WIN_WARM, 1);
  return roof(k, f, 0, ht + 0.9, 0, pw + 0.8, pw + 0.8, { h: 0.75, ridge: 0, lift: 0.18, flare: 0.14, nu: 4, ends: acc });
}

// Tall wooden watchtower on four braced legs.
export function woodTower(k: Kit, f: Frame, x: number, z: number, ht: number, s: number, r: () => number, acc?: Col): number {
  const tf = f.sub(x, 0, z, 0);
  const L = s / 2;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    k.seg(tf.pt(sx * L * 1.25, 0, sz * L * 1.25), tf.pt(sx * L, ht, sz * L), 0.16, PLANK2);
  }
  // braces
  for (let lv = 0; lv < 2; lv++) {
    const y0 = lv * (ht / 2) + 0.3;
    const y1 = y0 + ht / 2 - 0.5;
    const w0 = L * (1.25 - (0.25 * y0) / ht);
    const w1 = L * (1.25 - (0.25 * y1) / ht);
    for (let q = 0; q < 4; q++) {
      const sf = tf.sub(0, 0, 0, (q * Math.PI) / 2);
      k.seg(sf.pt(-w0, y0, w0), sf.pt(w1, y1, w1), 0.07, C.woodD);
      k.seg(sf.pt(-w1, y1, w1), sf.pt(w1, y1, w1), 0.08, C.woodD);
    }
  }
  // platform, railing, little roof
  k.box(tf, 0, ht, 0, s + 0.6, 0.16, s + 0.6, PLANK);
  for (let q = 0; q < 4; q++) {
    const sf = tf.sub(0, 0, 0, (q * Math.PI) / 2);
    k.box(sf, 0, ht + 0.16, (s + 0.5) / 2, s + 0.6, 0.45, 0.08, PLANK2);
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(tf, sx * (s / 2 + 0.2), ht + 0.16, sz * (s / 2 + 0.2), 0.1, 1.1, 0.1, C.woodD);
  return roof(k, tf, 0, ht + 1.26, 0, s + 1.3, s + 1.3, { h: 0.85, ridge: 0, lift: 0.2, flare: 0.16, nu: 4, ends: acc, col: ROOFS[Math.floor(r() * ROOFS.length)] });
}

// Wooden pier on stilts from (x, z) going out along angle a, with a T-head.
export function pier(k: Kit, x: number, z: number, a: number, len: number, deck = 0.38, w = 1.3) {
  const f = Frame.at(x, 0, z, a);
  const n = Math.max(2, Math.round(len / 0.42));
  for (let i = 0; i < n; i++) {
    const pz = (i + 0.5) * (len / n);
    k.box(f, 0, deck - 0.1, pz, w, 0.1, len / n - 0.04, i % 3 ? PLANK : PLANK2, (i % 2 ? 0.01 : -0.01));
  }
  for (let pz = 0.4; pz <= len; pz += 1.6) for (const sx of [-1, 1]) k.cyl(f, sx * (w / 2 + 0.04), -2.2, pz, 0.08, deck + 2.4, PLANK2, 6);
  // T head
  k.box(f, 0, deck - 0.1, len + 0.6, w * 2.8, 0.1, 1.2, PLANK);
  for (const sx of [-1.3, 1.3]) for (const sz of [0.15, 1.05]) k.cyl(f, sx * w, -2.2, len + sz, 0.08, deck + 2.4, PLANK2, 6);
  for (const sx of [-1, 1]) k.cyl(f, sx * w * 1.2, deck, len + 1.0, 0.07, 0.3, C.woodD, 6);
  k.lamp(f.sub(0, deck, 0), w * 1.2, len + 0.3, 0, 1.3);
  return f.pt(0, deck, len + 0.6);
}

// Market stall: four posts, a counter, a sloping cloth awning and goods.
export function stall(k: Kit, f: Frame, x: number, z: number, ry: number, col: Col, r: () => number) {
  const sf = f.sub(x, 0, z, ry);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(sf, sx * 0.7, 0, sz * 0.5, 0.07, sz > 0 ? 1.15 : 1.45, 0.07, C.woodD);
  k.box(sf, 0, 0, 0.35, 1.5, 0.6, 0.4, PLANK);
  // striped cloth awning with a scalloped valance (flutters a little)
  const N = 6;
  const sw = 1.75 / N;
  const cream = '#f1e6cc';
  for (let i = 0; i < N; i++) {
    const c = i % 2 ? cream : col;
    const px = -1.75 / 2 + sw * (i + 0.5);
    k.s.add(G.box, c, sf.mat(px, 1.2, 0, 0, sw + 0.003, 0.04, 1.35, -0.22));
    k.s.add(G.box, c, sf.mat(px, 1.1, 0.67, 0, sw + 0.003, 0.16, 0.03), FX.cloth + 0.12);
    k.s.add(G.box, c, sf.mat(px, 1.0, 0.67, 0, sw * 0.62, sw * 0.62, 0.028, 0, Math.PI / 4), FX.cloth + 0.25);
  }
  const goods = ['#c9a14a', '#9a5b3a', '#7c8b4a', '#d8c6a0', '#b0453a', '#6d7f99'];
  for (let i = 0; i < 4; i++) k.box(sf, -0.55 + i * 0.36, 0.6, 0.35, 0.26, 0.12 + r() * 0.12, 0.26, goods[Math.floor(r() * goods.length)]);
  // paper lanterns under the awning, a basket and jars in front
  k.redLantern(sf, 0.72, 1.14, 0.64, 0.62);
  if (r() < 0.5) k.redLantern(sf, -0.72, 1.14, 0.64, 0.62, '#ffb347');
  k.cyl(sf, 0.9, 0, 0.8, 0.18, 0.24, '#b08a52', 8);
  const crop = ['#e08a3a', '#7aa64a', '#d9473a', '#e8c25a'][Math.floor(r() * 4)];
  for (let i = 0; i < 4; i++) k.ball(sf, 0.84 + (i % 2) * 0.12, 0.27, 0.74 + Math.floor(i / 2) * 0.12, 0.07, crop);
  k.cyl(sf, -0.95, 0, 0.75, 0.13, 0.32, '#8a5a3a', 8);
  k.cyl(sf, -0.95, 0.32, 0.75, 0.08, 0.06, '#6a4430', 8);
  // hanging goods under the awning
  for (let i = 0; i < 3; i++) k.box(sf, -0.45 + i * 0.3, 0.86, 0.5, 0.06, 0.16, 0.06, ['#b5653c', '#d8c6a0', '#7c8b4a'][i]);
}

// Static cloth flag on a pole (province colour). `tall` = vertical silk banner.
export function flag(k: Kit, f: Frame, x: number, z: number, h: number, col: Col, ry = 0, tall = false) {
  const ff = f.sub(x, 0, z, ry);
  k.cyl(ff, 0, 0, 0, 0.05, h, C.woodD, 6);
  k.ball(ff, 0, h + 0.05, 0, 0.07, C.goldD);
  const top = ff.pt(0, h - 0.12, 0);
  const pole = ff.pt(0, 0, 0);
  // cloth flutters more towards its free edge (vertex animation, see look.ts)
  const hang: FxFn = (_x, y) => FX.cloth + Math.min(0.99, Math.max(0, (top.y - y) / 1.45)) * 0.8;
  const fly: FxFn = (x, _y, z) => FX.cloth + Math.min(0.99, Math.hypot(x - pole.x, z - pole.z) / 0.9);
  if (tall) {
    k.box(ff, 0.32, h - 0.12, 0, 0.7, 0.05, 0.05, C.woodD);
    k.s.add(G.box, col, ff.mat(0.32, h - 1.45 + 0.65, 0, 0, 0.5, 1.3, 0.03), hang);
    k.s.add(G.box, '#e8d9b0', ff.mat(0.32, h - 1.5 + 0.04, 0, 0, 0.5, 0.08, 0.035), hang);
    // tassel weight and a painted emblem disc
    k.s.add(G.box, paintLight(col), ff.mat(0.32, h - 0.75, 0.0, 0, 0.26, 0.26, 0.04, 0, Math.PI / 4), hang);
  } else {
    k.s.add(G.box, col, ff.mat(0.42, h - 0.6 + 0.26, 0, 0, 0.8, 0.52, 0.03, 0, 0.04), fly);
    k.s.add(G.box, '#e8d9b0', ff.mat(0.84, h - 0.6 + 0.26, 0, 0, 0.06, 0.52, 0.035), fly);
  }
}

// Opera stage: raised platform, open front, dramatic roof, red lanterns.
export function stage(k: Kit, f: Frame, x: number, z: number, acc: Col, r: () => number) {
  const sf = f.sub(x, 0, z, 0);
  const W = 5.2;
  const D = 3.6;
  k.box(sf, 0, 0, 0, W + 0.4, 1.05, D + 0.4, STONE);
  k.box(sf, 0, 1.05, 0, W + 0.2, 0.08, D + 0.2, PLANK);
  // back wall with painted curtain
  k.box(sf, 0, 1.13, -D / 2 + 0.1, W, 2.1, 0.18, C.col);
  k.box(sf, 0, 1.4, -D / 2 + 0.2, W * 0.7, 1.5, 0.04, '#9b2d24');
  k.box(sf, 0, 2.6, -D / 2 + 0.2, W * 0.8, 0.22, 0.05, acc);
  for (const sx of [-1, 1]) {
    k.box(sf, sx * (W / 2 - 0.1), 1.13, -0.2, 0.14, 2.1, D - 0.6, C.col);
    k.s.add(G.col6, C.col, sf.mat(sx * (W / 2 - 0.1), 1.13 + 1.05, D / 2 - 0.15, 0, 0.12, 2.1, 0.12));
  }
  k.box(sf, 0, 3.2, 0.1, W + 0.3, 0.2, D, C.colD);
  k.box(sf, 0, 3.4, 0.1, W + 0.6, 0.18, D + 0.3, acc);
  const top = roof(k, sf, 0, 3.58, 0.1, W + 1.6, D + 1.4, { h: 1.6, lift: 0.5, flare: 0.4, ridge: W * 0.55, nu: 6, ends: C.goldD });
  // lantern strings across the front
  for (let i = 0; i < 5; i++) k.redLantern(sf, -W / 2 + 0.6 + i * ((W - 1.2) / 4), 3.18, D / 2 + 0.2, 1.1);
  // steps and benches for the audience
  k.box(sf, 0, 0, D / 2 + 0.4, 1.6, 0.5, 0.5, STONE2);
  for (let row = 0; row < 3; row++)
    for (const sx of [-1, 1]) k.box(sf, sx * 1.4, 0, D / 2 + 2.2 + row * 0.9, 2.0, 0.35, 0.3, PLANK2);
  void r;
  return top;
}

// Stone vault hall: thick stone walls, small barred windows, heavy roof.
export function vault(k: Kit, f: Frame, x: number, z: number, acc: Col, r: () => number) {
  const vf = f.sub(x, 0, z, 0);
  const W = 5.4;
  const D = 3.8;
  k.box(vf, 0, 0, 0, W + 1.0, 0.5, D + 1.0, STONE2);
  for (let i = 0; i < 4; i++) k.box(vf, 0, 0, D / 2 + 0.6 + i * 0.16, 1.6, 0.5 - i * 0.12, 0.18, STONE);
  k.box(vf, 0, 0.5, 0, W, 2.0, D, '#9c9488');
  // stone courses
  for (let y = 0.9; y < 2.5; y += 0.45) k.box(vf, 0, y, 0, W + 0.04, 0.05, D + 0.04, '#8a8276');
  // iron-bound door
  k.box(vf, 0, 0.5, D / 2 + 0.01, 1.0, 1.4, 0.06, '#3b2f28');
  for (const yy of [0.8, 1.3, 1.7]) k.box(vf, 0, yy, D / 2 + 0.05, 1.04, 0.06, 0.03, '#2a2622');
  k.box(vf, 0, 1.95, D / 2 + 0.02, 1.3, 0.3, 0.06, acc);
  for (const sx of [-1, 1]) {
    k.window(vf, sx * 1.7, 1.6, D / 2 + 0.01, 0.4, 0.3, 0, r() < 0.8, WIN_WARM);
    for (let b = -1; b <= 1; b++) k.box(vf, sx * 1.7 + b * 0.1, 1.45, D / 2 + 0.03, 0.025, 0.3, 0.025, '#2a2622');
  }
  k.box(vf, 0, 2.5, 0, W + 0.3, 0.2, D + 0.3, C.colD);
  return roof(k, vf, 0, 2.7, 0, W + 1.4, D + 1.4, { h: 1.7, col: '#4a4643', lift: 0.3, flare: 0.22, ends: acc, nu: 6 });
}

// Big drum on a wooden stand.
export function drum(k: Kit, f: Frame, x: number, z: number, s = 1, ry = 0) {
  const df = f.sub(x, 0, z, ry);
  for (const sx of [-1, 1]) k.box(df, sx * 0.55 * s, 0, 0, 0.1 * s, 1.5 * s, 0.1 * s, C.woodD);
  k.box(df, 0, 1.45 * s, 0, 1.2 * s, 0.1 * s, 0.12 * s, C.woodD);
  k.s.add(G.cyl16, '#9b2d24', df.mat(0, 1.05 * s, 0, 0, 0.5 * s, 0.45 * s, 0.5 * s, Math.PI / 2));
  k.s.add(G.cyl16, '#e6d6b0', df.mat(0, 1.05 * s, 0, 0, 0.44 * s, 0.47 * s, 0.44 * s, Math.PI / 2));
}

// Kiln dome with a short chimney (forge).
export function kiln(k: Kit, f: Frame, x: number, z: number, s = 1) {
  k.s.add(G.dome, '#9a6248', f.mat(x, 0, z, 0, 1.2 * s, 1.0 * s, 1.2 * s));
  k.box(f, x, 0, z + 1.0 * s, 0.6 * s, 0.6 * s, 0.4 * s, '#7a4a3c');
  k.box(f, x, 0.05, z + 1.21 * s, 0.38 * s, 0.4 * s, 0.02, '#ff8a3d', 0, k.glow);
  k.cyl(f, x + 0.5 * s, 0.6 * s, z - 0.4 * s, 0.26 * s, 1.9 * s, '#86533f', 8);
  k.cyl(f, x + 0.5 * s, 2.5 * s, z - 0.4 * s, 0.32 * s, 0.14 * s, '#5f382e', 8);
  k.smoke.push(f.pt(x + 0.5 * s, 2.8 * s, z - 0.4 * s));
  k.lights.push(f.pt(x, 0.35, z + 1.25 * s));
}

// Moored sampan (static).
export function boat(k: Kit, x: number, z: number, a: number, s = 1) {
  const f = Frame.at(x, -0.05, z, a);
  // tapered hull with raised bow and stern, plank seats, a woven canopy, oar
  k.box(f, 0, 0, 0, 0.7 * s, 0.28, 1.7 * s, '#5a4232');
  for (const sz of [-1, 1]) {
    k.box(f, 0, 0.04, sz * 0.95 * s, 0.5 * s, 0.26, 0.36 * s, '#5a4232', 0, k.s, sz * -0.35);
    k.box(f, 0, 0.16, sz * 1.12 * s, 0.32 * s, 0.2, 0.2 * s, '#4a3628', 0, k.s, sz * -0.55);
  }
  k.box(f, 0, 0.27, 0, 0.74 * s, 0.05, 1.72 * s, '#6b4a33');
  k.box(f, 0, 0.22, 0, 0.58 * s, 0.03, 1.6 * s, PLANK);
  for (const sz of [-0.5, 0.45]) k.box(f, 0, 0.25, sz * s, 0.6 * s, 0.04, 0.12, PLANK2);
  k.s.add(new THREE.CylinderGeometry(1, 1, 1, 10, 1, true, -Math.PI / 2, Math.PI), '#8a7650', f.mat(0, 0.28, -0.15 * s, 0, 0.3 * s, 0.75 * s, 0.33 * s, -Math.PI / 2));
  for (const sz of [-0.5, -0.15, 0.2]) k.s.add(G.torus, '#5a4a30', f.mat(0, 0.28, sz * s, 0, 0.31 * s, 0.31 * s, 0.4, 0, 0));
  k.box(f, 0.3 * s, 0.3, -0.6 * s, 0.04, 0.04, 1.3 * s, C.woodD, 0.25, k.s, -0.15);
}

// Small crates / barrels / sacks pile.
export function goods(k: Kit, f: Frame, x: number, z: number, r: () => number) {
  for (let i = 0; i < 4; i++) {
    const gx = x + (r() - 0.5) * 1.2;
    const gz = z + (r() - 0.5) * 1.0;
    const t = r();
    if (t < 0.4) k.box(f, gx, 0, gz, 0.42, 0.36, 0.42, '#8c6a46', r() * 3);
    else if (t < 0.75) k.cyl(f, gx, 0, gz, 0.2, 0.46, '#6e4f34', 8);
    else k.ball(f, gx, 0.16, gz, 0.24, '#cdb98e', k.s, 0.7);
  }
}

// Carved marble balustrade along a local polyline at height y (posts with
// capitals, a rail and a low base rail). Gaps are [from, to] distances.
export function balustrade(k: Kit, f: Frame, pts: [number, number][], y: number, gaps: [number, number][] = [], col: Col = C.marble) {
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / 0.48));
    let runStart: number | null = null;
    for (let j = 0; j <= n; j++) {
      const d = acc + (len * j) / n;
      const open = gaps.some(([g0, g1]) => d > g0 && d < g1);
      const x = ax + ((bx - ax) * j) / n;
      const z = az + ((bz - az) * j) / n;
      if (!open) {
        k.box(f, x, y, z, 0.1, 0.34, 0.1, col);
        k.ball(f, x, y + 0.38, z, 0.06, col);
      }
      if (open || j === n) {
        if (runStart !== null) {
          const t1 = open ? (j - 1) / n : 1;
          const p0 = f.pt(ax + (bx - ax) * runStart, y + 0.27, az + (bz - az) * runStart);
          const p1 = f.pt(ax + (bx - ax) * t1, y + 0.27, az + (bz - az) * t1);
          k.seg(p0, p1, 0.06, col);
          k.seg(p0.clone().setY(p0.y - 0.2), p1.clone().setY(p1.y - 0.2), 0.05, C.marble2);
        }
        runStart = null;
      } else if (runStart === null) runStart = j / n;
    }
    acc += len;
  }
}

// Dragon-head rain spouts sticking out under a terrace edge.
export function spouts(k: Kit, f: Frame, pts: [number, number][], y: number, every = 1.6) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const ry = Math.atan2(bx - ax, bz - az) + Math.PI / 2;
    const n = Math.max(1, Math.round(len / every));
    for (let j = 0; j <= n; j++) {
      const x = ax + ((bx - ax) * j) / n;
      const z = az + ((bz - az) * j) / n;
      const sf = f.sub(x, 0, z, ry);
      k.box(sf, 0, y, 0.12, 0.13, 0.12, 0.34, C.marble2);
      k.ball(sf, 0, y + 0.06, 0.3, 0.08, C.marble);
    }
  }
}

// Bronze tripod incense burner (ding); returns the incense smoke point.
export function ding(k: Kit, f: Frame, x: number, z: number, s = 1, y = 0) {
  const B = '#6e5a3a';
  const B2 = '#8a7244';
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    k.box(f, x + Math.sin(a) * 0.28 * s, y, z + Math.cos(a) * 0.28 * s, 0.08 * s, 0.32 * s, 0.08 * s, B);
  }
  k.s.add(G.sphL, B, f.mat(x, y + 0.5 * s, z, 0, 0.42 * s, 0.3 * s, 0.42 * s));
  k.cyl(f, x, y + 0.48 * s, z, 0.44 * s, 0.1 * s, B2, 16);
  for (const sx of [-1, 1]) k.s.add(G.torus, B2, f.mat(x + sx * 0.34 * s, y + 0.66 * s, z, Math.PI / 2, 0.11 * s, 0.11 * s, 0.6 * s));
  k.cyl(f, x, y + 0.58 * s, z, 0.36 * s, 0.03, '#3a3030', 16);
  // lid with a little pagoda knob
  k.s.add(G.dome, B, f.mat(x, y + 0.62 * s, z, 0, 0.3 * s, 0.2 * s, 0.3 * s));
  k.cone(f, x, y + 0.8 * s, z, 0.12 * s, 0.16 * s, B2, 8);
  k.ball(f, x, y + 0.99 * s, z, 0.05 * s, C.gold);
  const p = f.pt(x, y + 0.95 * s, z);
  k.incense.push(p);
  return p;
}

// Guardian stone lion on a plinth (faces local +z after ry).
export function stoneLion(k: Kit, f: Frame, x: number, z: number, ry = 0, s = 1) {
  const lf = f.sub(x, 0, z, ry);
  const S1 = '#a69d8e';
  const S2 = '#8e867a';
  k.box(lf, 0, 0, 0, 0.62 * s, 0.42 * s, 0.82 * s, S2);
  k.box(lf, 0, 0.42 * s, 0, 0.7 * s, 0.06 * s, 0.9 * s, S1);
  k.s.add(G.sphL, S1, lf.mat(0, 0.75 * s, -0.12 * s, 0, 0.24 * s, 0.26 * s, 0.32 * s));
  k.s.add(G.sphL, S1, lf.mat(0, 0.98 * s, 0.12 * s, 0, 0.26 * s, 0.25 * s, 0.24 * s));
  k.s.add(G.sphL, S2, lf.mat(0, 1.02 * s, 0.05 * s, 0, 0.31 * s, 0.24 * s, 0.24 * s));
  for (const sx of [-1, 1]) {
    k.box(lf, sx * 0.13 * s, 0.48 * s, 0.18 * s, 0.1 * s, 0.4 * s, 0.12 * s, S1);
    k.ball(lf, sx * 0.08 * s, 1.05 * s, 0.33 * s, 0.035 * s, '#2a2626');
  }
  k.ball(lf, 0.18 * s, 0.55 * s, 0.36 * s, 0.1 * s, S2);
}

// Red ceremonial carpet with gold borders along local z from z0 to z1.
export function carpet(k: Kit, f: Frame, x: number, z0: number, z1: number, y: number, w = 1.3) {
  const len = Math.abs(z1 - z0);
  const zc = (z0 + z1) / 2;
  k.box(f, x, y, zc, w, 0.02, len, '#8e2a22');
  for (const sx of [-1, 1]) k.box(f, x + sx * (w / 2 - 0.06), y + 0.005, zc, 0.07, 0.02, len, C.goldD);
}
