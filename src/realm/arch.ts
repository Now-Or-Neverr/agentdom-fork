// Dynasty architecture kit: sweeping hip roofs with upturned eaves, halls on
// stone platforms with red columns and paper lattices, pagodas, gate arches,
// tiled compound walls and city gate towers. Dark tiles and timber, cream
// stone, glowing province-colour trims along eaves and ridges.
import * as THREE from 'three';
import type { ProvinceId } from '../../shared/realm';
import { C, FX, Frame, G, Kit, WIN_SOFT, WIN_WARM } from './kit';
import { signUV } from './tex';

type Col = THREE.ColorRepresentation;

export interface RoofOpt {
  h?: number; // rise from eave to ridge
  lift?: number; // corner upturn
  flare?: number; // corner outward flare
  ridge?: number; // main ridge length (0 = pyramid)
  thick?: number;
  col?: Col;
  under?: Col;
  trim?: Col | null; // glowing eave line
  ridgeTrim?: boolean;
  ends?: Col; // ridge-end / corner ornaments
  finial?: boolean; // gold finial (pyramids)
  finialCol?: Col;
  nu?: number;
}

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

type V3 = THREE.Vector3;

// One roof face as a curved grid. Returns the eave points (local).
function face(
  pos: number[],
  under: number[],
  fascia: number[],
  S: V3,
  T: V3,
  RS: V3,
  RT: V3,
  axis: 'x' | 'z',
  sign: number,
  half: number,
  o: Required<Pick<RoofOpt, 'h' | 'lift' | 'flare' | 'thick'>>,
  nu: number,
  nv: number,
  hip: V3[],
) {
  const grid: V3[][] = [];
  const eave: V3[] = [];
  for (let i = 0; i <= nu; i++) {
    const u = i / nu;
    const s = Math.abs(2 * u - 1);
    const s3 = s * s * s;
    const e = new THREE.Vector3().lerpVectors(S, T, u);
    e[axis] = sign * (half + o.flare * s3);
    e.y = o.lift * s3;
    eave.push(e);
    const r = new THREE.Vector3().lerpVectors(RS, RT, u);
    const col: V3[] = [];
    for (let j = 0; j <= nv; j++) {
      const v = j / nv;
      const p = new THREE.Vector3(e.x + (r.x - e.x) * v, 0, e.z + (r.z - e.z) * v);
      p.y = e.y + (o.h - e.y) * Math.pow(v, 1.55);
      col.push(p);
    }
    grid.push(col);
  }
  for (let j = 0; j <= nv; j++) hip.push(grid[0][j].clone());
  const tri = (out: number[], a: V3, b: V3, c: V3, wantUp: boolean, dy = 0) => {
    _a.subVectors(b, a);
    _b.subVectors(c, a);
    _n.crossVectors(_a, _b);
    if (_n.lengthSq() < 1e-10) return;
    const up = _n.y > 0;
    const [p, q] = up === wantUp ? [b, c] : [c, b];
    out.push(a.x, a.y + dy, a.z, p.x, p.y + dy, p.z, q.x, q.y + dy, q.z);
  };
  for (let i = 0; i < nu; i++)
    for (let j = 0; j < nv; j++) {
      const a = grid[i][j];
      const b = grid[i + 1][j];
      const c = grid[i + 1][j + 1];
      const d = grid[i][j + 1];
      tri(pos, a, b, c, true);
      tri(pos, a, c, d, true);
      if (j === 0) {
        tri(under, a, b, c, false, -o.thick);
        tri(under, a, c, d, false, -o.thick);
      }
    }
  // fascia: vertical strip under the eave line, facing outwards
  for (let i = 0; i < nu; i++) {
    const a = eave[i];
    const b = eave[i + 1];
    const a2 = a.clone().setY(a.y - o.thick);
    const b2 = b.clone().setY(b.y - o.thick);
    const out = new THREE.Vector3(axis === 'x' ? sign : 0, 0, axis === 'z' ? sign : 0);
    _a.subVectors(b, a);
    _b.subVectors(a2, a);
    _n.crossVectors(_a, _b);
    const ok = _n.dot(out) > 0;
    const push = (p: V3, q: V3, r: V3) => fascia.push(p.x, p.y, p.z, q.x, q.y, q.z, r.x, r.y, r.z);
    if (ok) {
      push(a, b, a2);
      push(b, b2, a2);
    } else {
      push(a, a2, b);
      push(b, a2, b2);
    }
  }
  return eave;
}

function geoFrom(arr: number[]) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
  g.computeVertexNormals();
  return g;
}

// fx code for straight tiled roof faces: 1 + eave angle (0..PI) packed into 0..0.45.
export const tileFx = (a: number) => FX.tiles + (a / Math.PI) * 0.45;
// fx code for round (lathe) roofs: tile rows follow the normal's azimuth.
export const ROUND_TILES = 0.75;

// Smooth normals for a triangle soup by averaging normals at shared positions.
function smoothNormals(g: THREE.BufferGeometry) {
  const p = g.attributes.position.array as Float32Array;
  const n = g.attributes.normal.array as Float32Array;
  const map = new Map<string, number[]>();
  for (let i = 0; i < p.length; i += 3) {
    const key = `${p[i].toFixed(3)},${p[i + 1].toFixed(3)},${p[i + 2].toFixed(3)}`;
    const l = map.get(key);
    if (l) l.push(i);
    else map.set(key, [i]);
  }
  for (const idx of map.values()) {
    if (idx.length < 2) continue;
    let x = 0;
    let y = 0;
    let z = 0;
    for (const i of idx) {
      x += n[i];
      y += n[i + 1];
      z += n[i + 2];
    }
    const l = Math.hypot(x, y, z) || 1;
    for (const i of idx) {
      // keep hip creases: only blend normals that roughly agree
      if (n[i] * x + n[i + 1] * y + n[i + 2] * z < 0.85 * l) continue;
      n[i] = x / l;
      n[i + 1] = y / l;
      n[i + 2] = z / l;
    }
  }
  g.attributes.normal.needsUpdate = true;
}

// Curved hip roof over a w x d eave rectangle; eave base at (x, y, z).
// Returns the ridge height (local y of the frame).
export function roof(k: Kit, f: Frame, x: number, y: number, z: number, w: number, d: number, opt: RoofOpt = {}, ry = 0): number {
  if (d > w) return roof(k, f, x, y, z, d, w, opt, ry + Math.PI / 2);
  const o = {
    h: opt.h ?? d * 0.42,
    lift: opt.lift ?? Math.min(0.45, 0.1 + d * 0.06),
    flare: opt.flare ?? Math.min(0.4, 0.08 + d * 0.05),
    thick: opt.thick ?? 0.1,
  };
  const rl = Math.max(0, Math.min(w - 0.01, opt.ridge ?? Math.max(0, w - d * 0.95)));
  const nu = opt.nu ?? 6;
  const nv = 4;
  const W = w / 2;
  const D = d / 2;
  const A = new THREE.Vector3(-W - o.flare, 0, D + o.flare);
  const B = new THREE.Vector3(W + o.flare, 0, D + o.flare);
  const Cc = new THREE.Vector3(W + o.flare, 0, -D - o.flare);
  const Dd = new THREE.Vector3(-W - o.flare, 0, -D - o.flare);
  const R0 = new THREE.Vector3(-rl / 2, o.h, 0);
  const R1 = new THREE.Vector3(rl / 2, o.h, 0);
  const pos: number[] = [];
  const cut: number[] = []; // where each face starts in pos
  const under: number[] = [];
  const fascia: number[] = [];
  const hips: V3[][] = [[], [], [], []];
  const eaves = [
    (cut.push(pos.length), face(pos, under, fascia, A, B, R0, R1, 'z', 1, D, o, nu, nv, hips[0])),
    (cut.push(pos.length), face(pos, under, fascia, B, Cc, R1, R1, 'x', 1, W, o, Math.max(4, Math.round(nu * 0.67)), nv, hips[1])),
    (cut.push(pos.length), face(pos, under, fascia, Cc, Dd, R1, R0, 'z', -1, D, o, nu, nv, hips[2])),
    (cut.push(pos.length), face(pos, under, fascia, Dd, A, R0, R0, 'x', -1, W, o, Math.max(4, Math.round(nu * 0.67)), nv, hips[3])),
  ];
  cut.push(pos.length);
  const ends = opt.ends ?? opt.trim ?? undefined;
  const m = f.mat(x, y, z, ry);
  // each face carries its eave direction in the fx code so the tile rows run straight down it
  const rot = new THREE.Matrix3().setFromMatrix4(m);
  for (let i = 0; i < 4; i++) {
    const part = pos.slice(cut[i], cut[i + 1]);
    if (!part.length) continue;
    const top = geoFrom(part);
    smoothNormals(top);
    const dir = new THREE.Vector3(i % 2 ? 0 : 1, 0, i % 2 ? 1 : 0).applyMatrix3(rot);
    let a = Math.atan2(dir.z, dir.x);
    if (a < 0) a += Math.PI;
    if (a >= Math.PI) a -= Math.PI;
    k.s.add(top, opt.col ?? C.roof, m, tileFx(a));
    top.dispose();
  }
  const ug = geoFrom(under);
  k.s.add(ug, opt.under ?? C.roofU, m);
  ug.dispose();
  const fg = geoFrom(fascia);
  k.s.add(fg, C.ridge, m);
  fg.dispose();
  const W2 = (p: V3) => p.clone().applyMatrix4(m);
  // hip ridges and corner ornaments
  const ridgeCol = C.ridge;
  for (const h of hips) {
    for (let j = 0; j < h.length - 1; j += 2) {
      const j2 = Math.min(h.length - 1, j + 2);
      k.seg(W2(_v.copy(h[j]).setY(h[j].y + 0.04)), W2(h[j2].clone().setY(h[j2].y + 0.04)), 0.09, ridgeCol);
    }
    if (ends) {
      const c = h[0];
      k.seg(W2(c.clone().setY(c.y + 0.02)), W2(c.clone().multiplyScalar(1.04).setY(c.y + 0.2)), 0.06, ends);
    }
    // little guardian beasts walking up the hip from the corner
    if (d > 1.8 && h.length > 3) {
      const bs = Math.min(1.4, d / 3.2);
      for (let q = 1; q <= 3; q++) {
        const p = new THREE.Vector3().lerpVectors(h[0], h[1], q / 3.2);
        k.s.add(G.sphL, q === 1 ? (ends ?? C.goldD) : '#3f3a37', m.clone().multiply(new THREE.Matrix4().compose(p.setY(p.y + 0.07 * bs), new THREE.Quaternion(), new THREE.Vector3(0.05 * bs, 0.065 * bs, 0.05 * bs))));
      }
    }
  }
  // main ridge with end ornaments
  const rh = 0.16;
  if (rl > 0.05) {
    const sc = Math.min(1.6, Math.max(0.6, d / 3));
    k.seg(W2(R0.clone().setY(o.h + rh / 2 - 0.03)), W2(R1.clone().setY(o.h + rh / 2 - 0.03)), 0.15 * sc + 0.02, ridgeCol, k.s, rh);
    k.seg(W2(R0.clone().setY(o.h + rh - 0.02)), W2(R1.clone().setY(o.h + rh - 0.02)), 0.09 * sc, '#4a4542', k.s, 0.05);
    for (const R of [R0, R1]) {
      const sx = Math.sign(R.x) || 1;
      // chiwen: a tall ridge-end beast with a tail curling inwards
      const base = R.clone().setY(o.h - 0.02);
      const top = R.clone().add(new THREE.Vector3(sx * 0.04 * sc, 0.38 * sc, 0));
      k.seg(W2(base), W2(top), 0.13 * sc, ridgeCol, k.s, 0.22 * sc);
      const curl = top.clone().add(new THREE.Vector3(-sx * 0.16 * sc, 0.08 * sc, 0));
      k.seg(W2(top), W2(curl), 0.08 * sc, ends ?? ridgeCol, k.s, 0.1 * sc);
      k.s.add(G.sphL, ends ?? C.goldD, m.clone().multiply(new THREE.Matrix4().compose(curl, new THREE.Quaternion(), new THREE.Vector3(0.06 * sc, 0.06 * sc, 0.06 * sc))));
      k.s.add(G.box, '#3a3532', m.clone().multiply(new THREE.Matrix4().compose(base.clone().add(new THREE.Vector3(sx * 0.1 * sc, 0.16 * sc, 0)), new THREE.Quaternion(), new THREE.Vector3(0.06 * sc, 0.12 * sc, 0.2 * sc))));
    }
  }
  if (opt.finial || rl <= 0.05) {
    const fc = opt.finialCol ?? C.goldD;
    k.cyl(f, x, y + o.h - 0.05, z, 0.11, 0.18, fc, 8);
    k.ball(f, x, y + o.h + 0.25, z, 0.12, fc);
    if (opt.finial) {
      k.cyl(f, x, y + o.h + 0.3, z, 0.035, 0.6, fc, 6);
      k.ball(f, x, y + o.h + 0.95, z, 0.07, fc);
    }
  }
  return y + o.h + (rl > 0.05 ? rh + 0.3 : opt.finial ? 1.0 : 0.35);
}

export interface HallOpt {
  w: number;
  d: number;
  acc: Col;
  ch?: number; // column height
  plat?: number; // platform height
  roof?: Col;
  ends?: Col;
  tiers?: 1 | 2;
  open?: boolean; // pavilion (no walls)
  lit?: number;
  stairs?: boolean;
  rail?: boolean;
  rh?: number;
  ridge?: number;
  y0?: number;
  colCol?: Col;
  walls?: Col;
  trimLintel?: boolean;
  shelves?: boolean; // open front bays showing book shelves
  band?: Col; // painted bracket band
}

export interface HallOut {
  top: number;
  floor: number; // floor height
  eave: number; // first eave height
}

// Stone platform with front stairs (and optional marble balustrade).
export function platform(k: Kit, f: Frame, x: number, z: number, w: number, d: number, h: number, y0 = 0, stairs = true, rail = false, col: Col = C.marble) {
  k.box(f, x, y0, z, w, h, d, col);
  k.box(f, x, y0, z, w + 0.08, Math.min(0.12, h * 0.4), d + 0.08, C.marble2);
  if (stairs) {
    const n = Math.max(2, Math.round(h / 0.14));
    const sw = Math.min(1.8, w * 0.32);
    for (let i = 0; i < n; i++) {
      const sh = h * ((i + 1) / n);
      k.box(f, x, y0, z + d / 2 + (n - i) * 0.17 - 0.08, sw, sh, 0.18, i % 2 ? C.marble2 : col);
    }
    // carved ramp in the middle (imperial way)
    k.box(f, x, y0, z + d / 2 + n * 0.085, sw * 0.32, h * 0.5, n * 0.17, C.marble2, 0, k.s, -Math.atan2(h, n * 0.17) * 0.5);
  }
  if (rail) {
    const t = 0.07;
    const ry = y0 + h;
    const posts = (len: number) => Math.max(2, Math.round(len / 0.55));
    const run = (ax: number, az: number, bx: number, bz: number) => {
      const n = posts(Math.hypot(bx - ax, bz - az));
      for (let i = 0; i <= n; i++) {
        const px = ax + ((bx - ax) * i) / n;
        const pz = az + ((bz - az) * i) / n;
        k.box(f, px, ry, pz, t, 0.26, t, C.marble);
      }
      k.seg(f.pt(ax, ry + 0.2, az), f.pt(bx, ry + 0.2, bz), 0.05, C.marble);
    };
    const hw = w / 2 - 0.06;
    const hd = d / 2 - 0.06;
    const gap = stairs ? Math.min(1.8, w * 0.32) / 2 + 0.05 : 0;
    run(x - hw, z - hd, x + hw, z - hd);
    run(x - hw, z - hd, x - hw, z + hd);
    run(x + hw, z - hd, x + hw, z + hd);
    if (gap) {
      run(x - hw, z + hd, x - gap, z + hd);
      run(x + gap, z + hd, x + hw, z + hd);
    } else run(x - hw, z + hd, x + hw, z + hd);
  }
}

// Painted lintel with a row of dougong bracket sets carrying the eaves.
// Returns the height of the top plate (where the roof starts).
export function brackets(k: Kit, f: Frame, x: number, y: number, z: number, w: number, d: number, band: Col, s = 1) {
  const lh = 0.15 * s;
  k.box(f, x, y, z, w + 0.14, lh, d + 0.14, C.colD);
  // painted frieze on the lintel (band colour with a gold line)
  k.box(f, x, y + lh * 0.25, z, w + 0.17, lh * 0.5, d + 0.17, band);
  k.box(f, x, y + lh * 0.82, z, w + 0.175, 0.025, d + 0.175, C.goldD);
  y += lh;
  const bh = 0.14 * s;
  const step = 0.3 * s;
  for (const [len, ox, oz, ry] of [
    [w, 0, d / 2, 0],
    [w, 0, -d / 2, Math.PI],
    [d, w / 2, 0, Math.PI / 2],
    [d, -w / 2, 0, -Math.PI / 2],
  ] as const) {
    const n = Math.max(2, Math.round(len / step));
    const sf = f.sub(x + ox, 0, z + oz, ry);
    for (let i = 0; i <= n; i++) {
      const px = -len / 2 + (len * i) / n;
      // bearing block, crossed arm reaching out, and a small cap block
      k.box(sf, px, y, 0.04, 0.09 * s, bh * 0.45, 0.09 * s, i % 2 ? band : C.bracket);
      k.box(sf, px, y + bh * 0.45, 0.1, 0.07 * s, bh * 0.3, 0.26 * s, C.colD);
      k.box(sf, px, y + bh * 0.75, 0.2, 0.08 * s, bh * 0.25, 0.08 * s, i % 2 ? C.bracket : band);
    }
  }
  y += bh;
  k.box(f, x, y, z, w + 0.5 * s, 0.07 * s, d + 0.5 * s, C.colD);
  return y + 0.07 * s;
}

// Red paper lanterns hanging at the front corners (and centre) of a roof.
export function eaveLanterns(k: Kit, f: Frame, x: number, y: number, z: number, w: number, d: number, lit: number, centre = true) {
  if (lit < 0.8) return;
  for (const sx of [-1, 1]) k.redLantern(f, x + sx * (w / 2 - 0.35), y - 0.02, z + d / 2 - 0.3, 0.85);
  if (centre && w > 4) for (const sx of [-1, 1]) k.redLantern(f, x + sx * 0.9, y - 0.02, z + d / 2 - 0.42, 0.75);
}

// Columns along the perimeter of a w x d rectangle.
function columns(k: Kit, f: Frame, x: number, z: number, w: number, d: number, y: number, h: number, col: Col) {
  const nx = Math.max(2, Math.round(w / 1.05) + 1);
  const nz = Math.max(2, Math.round(d / 1.05) + 1);
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++) {
      if (i > 0 && i < nx - 1 && j > 0 && j < nz - 1) continue;
      const px = x - w / 2 + (w * i) / (nx - 1);
      const pz = z - d / 2 + (d * j) / (nz - 1);
      k.s.add(G.col6, col, f.mat(px, y + h / 2, pz, 0, 0.085, h, 0.085));
    }
  return { nx, nz };
}

// Hall on a platform: red columns, lattice walls, bracket band and a curved roof
// (single or double eave). Front faces +z.
export function hall(k: Kit, f: Frame, x: number, z: number, o: HallOpt, r: () => number = Math.random): HallOut {
  const y0 = o.y0 ?? 0;
  const plat = o.plat ?? 0.45;
  const ch = o.ch ?? 1.35;
  const lit = o.lit ?? 0.85;
  const colc = o.colCol ?? C.col;
  if (plat > 0) platform(k, f, x, z, o.w + 1.0, o.d + 1.0, plat, y0, o.stairs !== false, !!o.rail);
  let y = y0 + plat;
  const floor = y;
  const { nx, nz } = columns(k, f, x, z, o.w, o.d, y, ch, colc);
  if (!o.open) {
    const iw = o.w - 0.32;
    const id = o.d - 0.32;
    k.box(f, x, y, z, iw, ch, id, o.walls ?? C.body);
    const bay = o.w / (nx - 1);
    // front lattices (centre bay is the door, brightest)
    for (let i = 0; i < nx - 1; i++) {
      const bx = x - o.w / 2 + bay * (i + 0.5);
      const door = Math.abs(bx - x) < bay * 0.6;
      const hh = door ? ch * 0.82 : ch * 0.62;
      if (o.shelves && !door) {
        const bw = bay * 0.8;
        const by = y + 0.12;
        const bh = ch * 0.8;
        k.window(f, bx, by + bh / 2, z + id / 2 + 0.004, bw, bh, 0, true, WIN_SOFT);
        const books = ['#c0392b', '#2e5e9e', '#d9a441', '#3d8b5a', '#6b3fa0', '#e8e0cc'];
        for (let row = 0; row < 3; row++) {
          const ry2 = by + 0.1 + row * (bh / 3);
          k.box(f, bx, ry2 - 0.04, z + id / 2 + 0.05, bw, 0.04, 0.1, C.woodD);
          let px = bx - bw / 2 + 0.04;
          while (px < bx + bw / 2 - 0.08) {
            const bwid = 0.05 + r() * 0.05;
            k.box(f, px + bwid / 2, ry2, z + id / 2 + 0.05, bwid, bh / 3 - 0.1 - r() * 0.06, 0.08, books[Math.floor(r() * books.length)]);
            px += bwid + 0.01;
          }
        }
        continue;
      }
      k.lattice(f, bx, y + (door ? hh / 2 + 0.02 : ch * 0.48), z + id / 2 + 0.006, bay * 0.74, hh, door || r() < lit, door ? WIN_WARM : r() < 0.6 ? WIN_WARM : WIN_SOFT, door ? 3 : 2);
    }
    // side and back windows
    const bayZ = o.d / (nz - 1);
    for (const sx of [-1, 1])
      for (let j = 0; j < nz - 1; j++) {
        const sf = f.sub(x + sx * (iw / 2 + 0.006), 0, z - o.d / 2 + bayZ * (j + 0.5), (sx * Math.PI) / 2);
        k.lattice(sf, 0, y + ch * 0.52, 0, bayZ * 0.6, ch * 0.42, r() < lit, WIN_WARM, 1);
      }
    const bf = f.sub(x, 0, z - id / 2 - 0.006, Math.PI);
    for (let i = 0; i < nx - 1; i += 2) k.lattice(bf, -o.w / 2 + bay * (i + 0.5), y + ch * 0.52, 0, bay * 0.6, ch * 0.42, r() < lit * 0.8, WIN_WARM, 1);
  } else {
    // open pavilion: low railing between columns
    k.box(f, x, y, z - o.d / 2, o.w, 0.28, 0.06, C.colD);
    for (const sx of [-1, 1]) k.box(f, x + (sx * o.w) / 2, y, z, 0.06, 0.28, o.d, C.colD);
  }
  y += ch;
  // lintel + painted bracket band
  y = brackets(k, f, x, y, z, o.w, o.d, o.band ?? C.bracket);
  const eave = y;
  const ov = 0.65;
  if ((o.tiers ?? 1) === 2) {
    // lower skirt roof, then an upper storey and the main roof
    roof(k, f, x, y, z, o.w + ov * 2, o.d + ov * 2, { h: 0.75, col: o.roof, trim: o.acc, ends: o.ends, ridgeTrim: false });
    const uw = o.w * 0.72;
    const ud = Math.max(1.2, o.d * 0.62);
    const uh = 1.25;
    k.box(f, x, y, z, uw, uh, ud, C.body2);
    // clerestory lattice band
    for (const s of [0, Math.PI]) {
      const sf = f.sub(x, 0, z, s);
      const n = Math.max(2, Math.round(uw / 0.9));
      for (let i = 0; i < n; i++) k.lattice(sf, -uw / 2 + (uw * (i + 0.5)) / n, y + 0.85, ud / 2 + 0.006, (uw / n) * 0.7, 0.42, r() < lit, WIN_WARM, 1);
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.s.add(G.col6, colc, f.mat(x + (sx * uw) / 2, y + 0.4 + (uh - 0.4) / 2, z + (sz * ud) / 2, 0, 0.07, uh - 0.4, 0.07));
    y += uh;
    y = brackets(k, f, x, y, z, uw, ud, o.band ?? C.bracket, 0.85);
    const top = roof(k, f, x, y, z, uw + ov * 2, ud + ov * 2, { h: o.rh ?? (ud + ov * 2) * 0.48, col: o.roof, trim: o.acc, ends: o.ends, ridge: o.ridge });
    eaveLanterns(k, f, x, eave, z, o.w + ov * 2, o.d + ov * 2, lit, !o.open);
    return { top, floor, eave };
  }
  const top = roof(k, f, x, y, z, o.w + ov * 2, o.d + ov * 2, { h: o.rh ?? (o.d + ov * 2) * 0.42, col: o.roof, trim: o.acc, ends: o.ends, ridge: o.ridge });
  eaveLanterns(k, f, x, eave, z, o.w + ov * 2, o.d + ov * 2, lit, !o.open);
  return { top, floor, eave };
}

export interface PagodaOpt {
  base: number; // first storey width
  tiers: number;
  th?: number; // storey height
  acc: Col;
  roof?: Col;
  ends?: Col;
  shrink?: number;
  y0?: number;
  plinth?: number;
  lit?: number;
}

// Multi-storey pagoda, square plan, one flared roof per storey and a gold finial.
export function pagoda(k: Kit, f: Frame, x: number, z: number, o: PagodaOpt, r: () => number = Math.random): number {
  const th = o.th ?? 1.05;
  const shrink = o.shrink ?? 0.12;
  let y = o.y0 ?? 0;
  const plinth = o.plinth ?? 0.4;
  if (plinth > 0) {
    platform(k, f, x, z, o.base + 1.3, o.base + 1.3, plinth, y, true, false);
    y += plinth;
  }
  let top = y;
  for (let i = 0; i < o.tiers; i++) {
    const s = o.base * Math.max(0.35, 1 - i * shrink);
    const hh = i === 0 ? th * 1.2 : th;
    k.box(f, x, y, z, s, hh, s, i % 2 ? C.body2 : C.body);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.s.add(G.col6, C.col, f.mat(x + (sx * s) / 2, y + hh / 2, z + (sz * s) / 2, 0, 0.07, hh, 0.07));
    // windows / door on each face
    for (let q = 0; q < 4; q++) {
      const sf = f.sub(x, 0, z, (q * Math.PI) / 2);
      const n = s > 1.9 ? 2 : 1;
      for (let j = 0; j < n; j++) {
        const wx = n === 1 ? 0 : (j - 0.5) * s * 0.42;
        const door = i === 0 && q === 0 && n === 1;
        k.lattice(sf, wx, y + hh * (door ? 0.4 : 0.55), s / 2 + 0.006, s * (n === 1 ? 0.4 : 0.28), hh * (door ? 0.72 : 0.42), door || r() < (o.lit ?? 0.85), WIN_WARM, 1);
      }
    }
    y += hh;
    k.box(f, x, y, z, s + 0.12, 0.12, s + 0.12, C.colD);
    k.box(f, x, y + 0.12, z, s + 0.32, 0.12, s + 0.32, C.bracket);
    y += 0.24;
    const last = i === o.tiers - 1;
    const rs = s + 1.15;
    top = roof(k, f, x, y, z, rs, rs, { h: last ? rs * 0.55 : 0.62, col: o.roof, trim: o.acc, ends: o.ends, ridge: 0, finial: last, lift: 0.3, flare: 0.25 });
    if (!last) y += 0.05;
  }
  return top;
}

// Ceremonial gate arch (paifang): posts, beams, small curved roofs and a plaque.
export function paifang(k: Kit, f: Frame, x: number, z: number, w: number, h: number, acc: Col, plaque: ProvinceId | null = null, ry = 0, roofCol: Col = C.roof) {
  const gf = f.sub(x, 0, z, ry);
  const bays = w > 3 ? 3 : 1;
  const xs = bays === 3 ? [-w / 2, -w / 6, w / 6, w / 2] : [-w / 2, w / 2];
  for (const px of xs) {
    k.box(gf, px, 0, 0, 0.36, 0.3, 0.42, C.marble);
    const ph = Math.abs(px) < w / 3 ? h : h * 0.8;
    k.box(gf, px, 0.3, 0, 0.18, ph - 0.3, 0.18, C.col);
  }
  // beams
  k.box(gf, 0, h - 0.35, 0, w + 0.3, 0.16, 0.2, C.colD);
  k.box(gf, 0, h - 0.06, 0, w * (bays === 3 ? 0.36 : 1) + 0.2, 0.18, 0.22, C.bracket);
  // roofs
  if (bays === 3) {
    roof(k, gf, 0, h + 0.12, 0, w / 3 + 0.7, 0.75, { h: 0.42, col: roofCol, trim: acc, ridge: w / 3, lift: 0.2, flare: 0.15, nu: 6 });
    for (const sx of [-1, 1]) {
      k.box(gf, (sx * w) / 3, h * 0.8 - 0.3, 0, w / 3 + 0.1, 0.16, 0.2, C.bracket);
      roof(k, gf, (sx * w) / 3, h * 0.8 - 0.12, 0, w / 3 + 0.5, 0.65, { h: 0.34, col: roofCol, trim: acc, ridge: w / 3 - 0.2, lift: 0.16, flare: 0.12, nu: 6 });
    }
  } else {
    roof(k, gf, 0, h + 0.12, 0, w + 0.8, 0.8, { h: 0.42, col: roofCol, trim: acc, ridge: w, lift: 0.2, flare: 0.15, nu: 6 });
  }
  // plaque
  if (plaque) {
    k.box(gf, 0, h - 0.95, 0, 0.62, 0.6, 0.06, C.base);
    for (const s of [1, -1]) k.signs.add(gf.mat(0, h - 0.65, s * 0.035, s > 0 ? 0 : Math.PI, 0.52, 0.52, 1), '#ffffff', signUV(plaque));
  }
}

// Straight compound wall with a tiled cap, from (ax, az) to (bx, bz).
export function cwall(k: Kit, f: Frame, ax: number, az: number, bx: number, bz: number, h = 0.95, t = 0.28, col: Col = C.rwall, cap: Col = C.roof) {
  const len = Math.hypot(bx - ax, bz - az);
  if (len < 0.05) return;
  const ry = Math.atan2(bx - ax, bz - az);
  const wf = f.sub((ax + bx) / 2, 0, (az + bz) / 2, ry);
  k.box(wf, 0, 0, 0, t, h, len, col);
  k.box(wf, 0, 0, 0, t + 0.04, 0.12, len, C.marble2);
  k.s.add(G.tri, cap, wf.mat(0, h, 0, 0, t + 0.26, 0.2, len + 0.06));
  k.box(wf, 0, h + 0.17, 0, 0.06, 0.05, len + 0.06, C.ridge);
}

// Small gatehouse with a curved roof over an opening (compound gates).
export function gatehouse(k: Kit, f: Frame, x: number, z: number, w: number, acc: Col, ry = 0, h = 1.2, roofCol: Col = C.roof) {
  const gf = f.sub(x, 0, z, ry);
  for (const sx of [-1, 1]) {
    k.box(gf, (sx * w) / 2, 0, 0, 0.32, h, 0.5, C.rwall);
    k.cyl(gf, (sx * (w - 0.4)) / 2, 0, 0.18, 0.07, h, C.col, 8);
  }
  k.box(gf, 0, h, 0, w + 0.32, 0.14, 0.6, C.colD);
  k.box(gf, 0, h + 0.14, 0, w + 0.5, 0.12, 0.7, C.bracket);
  // doors (open, warm light inside)
  k.window(gf, 0, h * 0.45, -0.05, w - 0.5, h * 0.9, 0, true, WIN_SOFT);
  return roof(k, gf, 0, h + 0.26, 0, w + 1.0, 1.1, { h: 0.5, col: roofCol, trim: acc, ridge: w + 0.2, lift: 0.2, flare: 0.14, nu: 6 });
}

// City gate tower: massive brick base with arched openings and a two-eave
// tower hall on top. Front (+z) faces outwards.
export function gateTower(k: Kit, f: Frame, x: number, z: number, w: number, d: number, h: number, acc: Col, ry = 0, arches = 3, roofCol: Col = C.roof, r: () => number = Math.random): number {
  const gf = f.sub(x, 0, z, ry);
  k.box(gf, 0, 0, 0, w, h, d, C.cwall);
  k.box(gf, 0, h - 0.18, 0, w + 0.12, 0.18, d + 0.12, C.cwall2);
  k.box(gf, 0, 0, 0, w + 0.1, 0.3, d + 0.1, C.marble2);
  const step = w / (arches + 1);
  for (let i = 0; i < arches; i++) {
    const ax = arches === 1 ? 0 : -w / 2 + step * (i + 1);
    const big = arches === 1 || i === Math.floor(arches / 2);
    const aw = big ? 1.1 : 0.8;
    const ah = big ? h * 0.62 : h * 0.5;
    for (const s of [1, -1]) {
      const sf = gf.sub(0, 0, 0, s > 0 ? 0 : Math.PI);
      const fx = s > 0 ? ax : -ax;
      k.box(sf, fx, 0, d / 2 - 0.04, aw, ah, 0.1, C.base);
      k.cyl(sf, fx, ah - aw * 0.1, d / 2 - 0.04, aw / 2, 0.1, C.base, 16);
      k.window(sf, fx, ah * 0.42, d / 2 + 0.02, aw * 0.8, ah * 0.84, 0, true, WIN_WARM);
    }
  }
  // crenellated parapet on the outer edge
  const n = Math.max(3, Math.round(w / 0.55));
  for (let i = 0; i < n; i++) k.box(gf, -w / 2 + 0.2 + (i * (w - 0.4)) / (n - 1), h, d / 2 - 0.12, 0.26, 0.26, 0.24, C.cwall2);
  // tower hall
  const hw = w * 0.74;
  const hd = Math.max(1.4, d * 0.62);
  const out = hall(k, gf, 0, -0.05, { w: hw, d: hd, acc, ch: 1.0, plat: 0, y0: h, tiers: 2, roof: roofCol, rail: false, stairs: false }, r);
  return out.top;
}

// Corner watchtower on the city wall.
export function watchtower(k: Kit, f: Frame, x: number, z: number, s: number, h: number, acc: Col, r: () => number = Math.random): number {
  k.box(f, x, 0, z, s, h, s, C.cwall);
  k.box(f, x, h - 0.18, z, s + 0.12, 0.18, s + 0.12, C.cwall2);
  const n = Math.max(3, Math.round(s / 0.55));
  for (let q = 0; q < 4; q++) {
    const sf = f.sub(x, 0, z, (q * Math.PI) / 2);
    for (let i = 0; i < n; i++) k.box(sf, -s / 2 + 0.15 + (i * (s - 0.3)) / (n - 1), h, s / 2 - 0.12, 0.22, 0.24, 0.22, C.cwall2);
  }
  const out = hall(k, f, x, z, { w: s * 0.62, d: s * 0.62, acc, ch: 0.85, plat: 0, y0: h, tiers: 2, stairs: false, rh: 0.9, ridge: 0 }, r);
  return out.top;
}

// Brick kiln / round chimney.
export function chimney(k: Kit, f: Frame, x: number, z: number, rad: number, h: number, col: Col = '#7a4a3c'): V3 {
  k.cyl(f, x, 0, z, rad + 0.12, 0.4, C.cwall, 12);
  k.cyl(f, x, 0.4, z, rad, h - 0.4, col, 12);
  for (let y = 1.0; y < h - 0.2; y += 0.9) k.cyl(f, x, y, z, rad + 0.03, 0.06, '#5f382e', 12);
  k.cyl(f, x, h, z, rad + 0.12, 0.2, C.ridge, 12);
  k.cyl(f, x, h + 0.2, z, rad * 0.8, 0.04, '#ff8a3d', 12, k.glow);
  return f.pt(x, h + 0.3, z);
}

