// Province settlements: an organic cluster of buildings around a distinctive
// main building, in natural materials. Province identity comes from cloth
// (flags, awnings, banners), painted bracket bands and ridge ornaments.
import * as THREE from 'three';
import { PROVINCE, type ProvinceId } from '../../shared/realm';
import { C, Frame, G, Kit, mix } from './kit';
import { cwall, gatehouse, hall, pagoda, paifang } from './arch';
import { balustrade, carpet, ding, drum, flag, goods, house, kiln, palisade, roundTemple, spouts, stage, stall, stoneLion, stoneTower, stoneWall, vault, woodTower } from './buildings';
import type { Act, Station } from './people';
import type { Role } from '../../shared/realm';

type HFn = (x: number, z: number) => number;

export interface SettlementSite {
  id: ProvinceId;
  x: number;
  z: number;
  h: number;
  r: number;
  ry: number;
}

export interface SettlementOut {
  top: number; // world y of the main building's top
  label: THREE.Vector3;
  walk: [number, number][]; // world xz of open spots (walkers)
  spots: Station[]; // townsfolk at work (world space)
}

// Muted paint version of a province colour (bracket bands, cloth in shade).
export function paint(col: string, k = 0.25) {
  return '#' + mix(col, '#6b5a48', k).getHexString();
}

export function buildSettlement(k: Kit, s: SettlementSite, r: () => number, ground: HFn, full = true): SettlementOut {
  const f = Frame.at(s.x, s.h, s.z, s.ry);
  const p = PROVINCE[s.id];
  const acc = p.color;
  const band = paint(acc, 0.2);
  const W = (lx: number, lz: number): [number, number] => {
    const v = f.pt(lx, 0, lz);
    return [v.x, v.z];
  };
  // world polyline helper for walls around the site
  const arc = (rad: number, a0: number, a1: number, n: number, cx = 0, cz = 0): [number, number][] => {
    const out: [number, number][] = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      out.push(W(cx + Math.sin(a) * rad, cz + Math.cos(a) * rad));
    }
    return out;
  };
  const walkL: [number, number][] = [];
  const spots: Station[] = [];
  // a citizen at work at local (lx, lz), facing local angle lry; y is local height above the plateau
  const spot = (lx: number, lz: number, lry: number, act: Act, role?: Role, y?: number) => {
    const v = f.pt(lx, y ?? 0, lz);
    spots.push({ x: v.x, z: v.z, y: y === undefined ? undefined : v.y, ry: s.ry + lry, act, role, accent: role ? acc : undefined });
  };
  // two citizens chatting, facing each other
  const pair = (lx: number, lz: number, a: number, role?: Role, y?: number) => {
    spot(lx, lz, a, 'chat', role, y);
    spot(lx + Math.sin(a) * 0.58, lz + Math.cos(a) * 0.58, a + Math.PI, 'chat', undefined, y);
  };
  let top = 0;
  let labelL = new THREE.Vector3(0, 0, 0);

  const tagged = (fn: () => number) => {
    k.setTag(s.id);
    const t = fn();
    k.setTag(null);
    return t;
  };

  switch (s.id) {
    case 'throne': {
      // stone terrace (two levels) with the round temple and the grand hall
      k.box(f, 0, -0.3, -1.6, 16, 0.8, 12.6, C.marble2);
      k.box(f, 0, 0.42, -1.6, 16.1, 0.1, 12.7, C.marble);
      k.box(f, 0, 0.5, -4.2, 10.4, 0.55, 6.6, C.marble2);
      k.box(f, 0, 1.0, -4.2, 10.5, 0.08, 6.7, C.marble);
      for (let i = 0; i < 4; i++) k.box(f, 0, -0.3, 4.75 + (4 - i) * 0.2, 3.4, 0.8 * ((i + 1) / 4), 0.22, i % 2 ? C.marble : C.marble2);
      for (let i = 0; i < 3; i++) k.box(f, 0, 0.5, -0.9 + (3 - i) * 0.2, 2.4, 0.55 * ((i + 1) / 3) + 0.0, 0.22, C.marble);
      // carved balustrades, dragon spouts and paving joints on the terraces
      const lower: [number, number][] = [[-7.9, 4.6], [-7.9, -7.8], [7.9, -7.8], [7.9, 4.6], [-7.9, 4.6]];
      balustrade(k, f, lower, 0.52, [[46.6, 50.4]]);
      spouts(k, f, lower, 0.22, 1.7);
      const upper: [number, number][] = [[-5.15, -0.95], [-5.15, -7.45], [5.15, -7.45], [5.15, -0.95], [-5.15, -0.95]];
      balustrade(k, f, upper, 1.08, [[27.0, 29.9]]);
      spouts(k, f, upper, 0.82, 1.5);
      for (let x = -7.2; x <= 7.3; x += 1.2) k.box(f, x, 0.52, -1.6, 0.035, 0.008, 12.4, '#ada18b');
      for (let z = -7.2; z <= 4.4; z += 1.2) k.box(f, 0, 0.52, z, 15.7, 0.008, 0.035, '#ada18b');
      // imperial way: dragon ramp up the front stairs and a red carpet to the gate
      k.box(f, 0, 0.0, 5.12, 1.05, 0.08, 1.05, C.marble2, 0, k.s, Math.atan2(0.5, 0.85));
      for (let i = 0; i < 4; i++) k.s.add(G.sphL, i % 2 ? '#d8c9a8' : C.marble, f.mat((i % 2 ? 0.18 : -0.18), 0.12 + i * 0.1, 5.45 - i * 0.2, 0, 0.2, 0.05, 0.14));
      carpet(k, f, 0, 5.75, 8.9, 0.0, 1.25);
      // potted pines and stone lanterns dress the terraces
      const pot = (x: number, z: number, y: number, s = 1) => {
        k.cyl(f, x, y, z, 0.32 * s, 0.34 * s, '#7a4a3a', 12);
        k.cyl(f, x, y + 0.32 * s, z, 0.35 * s, 0.05 * s, '#5e3a2e', 12);
        k.pine(f, x, z, 0.62 * s, r, y + 0.3 * s);
      };
      for (const sx of [-1, 1]) {
        pot(sx * 4.6, -1.5, 1.08);
        pot(sx * 4.6, -7.0, 1.08);
        pot(sx * 7.3, -0.6, 0.52, 1.1);
        pot(sx * 7.3, -7.3, 0.52, 1.1);
        k.stoneLantern(f, sx * 3.0, -1.35, 1.08);
        k.stoneLantern(f, sx * 7.4, 1.2, 0.52);
        ding(k, f, sx * 4.2, -4.4, 0.75, 1.08);
      }
      carpet(k, f, 0, 3.75, 4.7, 0.52, 1.25);
      // bronze incense burners, guardian lions at the gate, lanterns along the way
      for (const sx of [-1, 1]) {
        ding(k, f, sx * 2.7, 4.05, 0.9, 0.52);
        stoneLion(k, f, sx * 3.35, 9.75, sx * -0.15, 0.95);
        k.lamp(f, sx * 1.5, 6.35, 0, 1.5);
        flag(k, f, sx * 10.2, 2.6, 4.8, acc, 0, true);
        flag(k, f, sx * 10.2, -5.2, 4.8, sx > 0 ? '#c0392b' : acc, 0, true);
      }
      top = tagged(() => {
        const t1 = roundTemple(k, f.sub(0, 1.08, -4.4), 0, 0, 0.95, r, '#b8862e');
        hall(k, f.sub(0, 0.5, 0), 0, 1.9, { w: 7.0, d: 2.6, acc, tiers: 2, plat: 0.3, ch: 1.3, band, ends: C.goldD, roof: '#524c48', lit: 0.9 }, r);
        return t1 + 1.08;
      });
      labelL = new THREE.Vector3(0, top + 0.6, -4.4);
      // flanking small round temples and pavilions
      for (const sx of [-1, 1]) {
        roundTemple(k, f.sub(0, 0.5, 0), sx * 6.4, -4.6, 0.52, r, '#9a7a3a', 1);
        hall(k, f.sub(0, 0.5, 0), sx * 6.0, 2.2, { w: 2.2, d: 1.8, acc, plat: 0.2, ch: 1.0, band, ridge: 0, lit: 0.8 }, r);
        flag(k, f.sub(0, 0.5, 0), sx * 3.0, 4.4, 4.2, acc, 0, true);
        flag(k, f.sub(0, 0.5, 0), sx * 7.3, 4.1, 3.6, acc, 0, true);
        k.lamp(f.sub(0, 0.5, 0), sx * 1.9, 4.6, 0, 1.4);
      }
      // courtyard trees
      k.pine(f, -9.6, 6.4, 1.1, r);
      k.pine(f, 9.4, 6.6, 1.05, r);
      k.blossom(f, -9.4, -8.6, 1.0, r);
      k.blossom(f, 9.6, -8.4, 1.0, r);
      k.pine(f, -9.8, -2.0, 1.0, r);
      k.pine(f, 9.8, -1.6, 1.0, r);
      // palace wall with a gatehouse and corner towers
      const hx = 11.6;
      const z0 = -10.6;
      const z1 = 8.6;
      const ring: [number, number][] = [W(-hx, z1), W(-hx, z0), W(hx, z0), W(hx, z1), W(-hx, z1)];
      const frontStart = 2 * (z1 - z0) + 2 * hx * 2 - 0; // length before front segment
      void frontStart;
      stoneWall(k, ring.slice(0, 4), ground, 1.5, 0.8);
      stoneWall(k, [W(hx, z1), W(-hx, z1)], ground, 1.5, 0.8, [[hx - 2.4, hx + 2.4]]);
      gatehouse(k, f, 0, z1, 3.4, acc, 0, 1.7);
      for (const [cx, cz] of [
        [-hx, z0],
        [hx, z0],
        [-hx, z1],
        [hx, z1],
      ])
        {
          const w = W(cx, cz);
          stoneTower(k, w[0], ground(w[0], w[1]), w[1], 1.9, 2.4, s.ry, r, acc);
        }
      walkL.push([0, 6.6], [-3.2, 6.8], [3.2, 6.8], [-8.4, 4.6], [8.4, 4.6], [-8.6, -3], [8.6, -3], [0, 10.6], [-5, 10.4], [5, 10.4]);
      // honour guard at the gate and along the imperial way, the vizier on the terrace
      for (const sx of [-1, 1]) {
        spot(sx * 2.25, 9.35, 0, 'guard');
        spot(sx * 1.35, 7.4, sx * 0.0, 'guard');
        spot(sx * 2.3, 5.3, 0, 'guard');
        spot(sx * 4.2, -0.2, 0, 'guard', undefined, 0.5);
      }
      spot(0.0, 3.85, 0, 'watch', 'vizier', 0.8);
      spot(-6.4, 6.9, 0.6, 'sweep');
      pair(5.6, 6.2, -2.4);
      break;
    }
    case 'forge': {
      top = tagged(() => {
        const t = hall(k, f, -1.0, -0.8, { w: 3.6, d: 2.6, acc, open: true, plat: 0.22, ch: 1.25, band, lit: 0.6, roof: '#4e4844' }, r).top;
        kiln(k, f, 2.6, -1.6, 1.0);
        return t;
      });
      // anvils and forge hearth under the open hall
      k.box(f, -1.6, 0.22, -0.6, 0.5, 0.45, 0.3, '#3a3a3e');
      k.box(f, -1.6, 0.67, -0.6, 0.7, 0.14, 0.3, '#2c2c30');
      k.box(f, -0.2, 0.22, -1.3, 1.0, 0.55, 0.8, '#6e4a3a');
      k.box(f, -0.2, 0.77, -1.3, 0.7, 0.04, 0.5, '#ff8a3d', 0, k.glow);
      k.lights.push(f.pt(-0.2, 1.0, -1.3));
      k.smoke.push(f.pt(-0.2, 2.6, -1.3));
      house(k, f, -4.4, 2.6, 2.2, 1.6, 0.3, r, { acc });
      house(k, f, 3.8, 3.4, 2.0, 1.6, -0.4, r, { acc });
      house(k, f, -4.8, -3.6, 2.2, 1.7, 0.6, r);
      goods(k, f, 1.4, 1.6, r);
      for (let i = 0; i < 5; i++) k.rock(f, 4.4 + r() * 1.6, -3 + r() * 2, 0.7 + r() * 0.5, r);
      palisade(k, arc(s.r - 0.4, Math.PI * 0.55, Math.PI * 1.45, 12), ground, 1.3);
      flag(k, f, 0.6, 2.9, 3.4, acc, 0.2, true);
      flag(k, f, -2.8, 3.6, 3.0, acc, 0.2);
      k.lamp(f, 1.2, 3.6, 0, 1.4);
      labelL = new THREE.Vector3(0.6, top + 0.6, -1.2);
      walkL.push([0, 2.6], [2.2, 1.2], [-2.6, 0.8], [1.0, 5.0], [-2, 5.2]);
      spot(-1.6, -0.05, Math.PI, 'hammer', 'smith', 0.22);
      spot(0.75, -1.3, -Math.PI / 2, 'vendor', 'smith', 0.22);
      pair(2.2, 2.4, 0.4);
      break;
    }
    case 'scriptorium': {
      top = tagged(() => {
        const a = hall(k, f, -1.4, -0.6, { w: 4.6, d: 2.6, acc, plat: 0.35, ch: 1.3, band, lit: 0.85 }, r).top;
        const b = pagoda(k, f, 3.4, -2.4, { base: 1.7, tiers: 5, acc, th: 0.95, plinth: 0.3, lit: 0.8 }, r);
        return Math.max(a, b);
      });
      house(k, f, -4.6, 3.2, 2.2, 1.6, 0.25, r, { acc });
      house(k, f, 3.4, 3.6, 2.0, 1.5, -0.3, r);
      cwall(k, f, -5.6, -3.8, 1.2, -4.6, 0.9, 0.26, '#d8c8a6');
      cwall(k, f, -5.6, -3.8, -5.9, 1.2, 0.9, 0.26, '#d8c8a6');
      k.blossom(f, 0.8, 2.6, 0.95, r);
      k.blossom(f, -3.0, 1.6, 0.85, r);
      k.stoneLantern(f, 1.6, 1.4);
      k.stoneLantern(f, -0.2, 1.6);
      flag(k, f, 5.4, 0.6, 3.4, acc, 0, true);
      flag(k, f, -5.4, 0.4, 3.0, acc, 0);
      labelL = new THREE.Vector3(3.4, top + 0.4, -2.4);
      walkL.push([0.4, 2.0], [-2, 2.8], [2.4, 1.8], [0, 5], [-3, 5]);
      spot(-1.4, 1.75, 0, 'watch', 'scribe');
      spot(1.9, 0.5, -0.8, 'sweep');
      pair(-3.2, 3.0, 0.3, 'scribe');
      break;
    }
    case 'atelier': {
      // pond with a pavilion and a zig-zag bridge
      k.water.add(new THREE.CylinderGeometry(1, 1, 1, 28), '#ffffff', f.mat(0.4, -0.02, -0.4, 0, 3.2, 0.06, 2.4));
      for (let i = 0; i < 22; i++) {
        const a = (i / 22) * Math.PI * 2;
        k.rock(f, 0.4 + Math.sin(a) * 3.3, -0.4 + Math.cos(a) * 2.5, 0.35 + r() * 0.25, r, -0.08);
      }
      top = tagged(() => hall(k, f, 0.6, -1.0, { w: 2.4, d: 2.4, acc, open: true, plat: 0.3, ch: 1.15, band, ridge: 0, lit: 0.8 }, r).top);
      // lily pads and lotus flowers on the pond, easels with paintings on the bank
      for (let i = 0; i < 11; i++) {
        const a = r() * Math.PI * 2;
        const rr = 1.7 + r() * 1.1;
        const lx = 0.4 + Math.sin(a) * rr * 1.25;
        const lz = -0.4 + Math.cos(a) * rr * 0.85;
        k.cyl(f, lx, 0.045, lz, 0.17 + r() * 0.08, 0.015, i % 3 ? '#5f8f45' : '#6fa34f', 12);
        if (i % 3 === 0) k.ball(f, lx + 0.05, 0.1, lz, 0.07, '#f4b6c8', k.s, 0.7);
      }
      for (const [ex, ez, ery] of [
        [-1.2, 2.45, 0.35],
        [2.3, 2.3, -0.4],
        [-3.0, 1.2, 0.8],
      ]) {
        const ef = f.sub(ex, 0, ez, ery);
        for (const sx of [-1, 1]) k.seg(ef.pt(sx * 0.22, 0, 0.12), ef.pt(sx * 0.05, 1.05, -0.02), 0.035, C.woodD);
        k.seg(ef.pt(0, 0, -0.3), ef.pt(0, 1.0, -0.04), 0.035, C.woodD);
        k.box(ef, 0, 0.5, 0.02, 0.62, 0.48, 0.03, '#f4ecd8', 0, k.s, -0.18);
        const paint = ['#7ab0d8', '#e8a0b8', '#8cc06a', '#f2c14e', '#d9734a'];
        for (let q = 0; q < 4; q++) k.box(ef, -0.16 + (q % 2) * 0.3, 0.6 + Math.floor(q / 2) * 0.17, 0.045, 0.24, 0.14, 0.012, paint[(q + Math.round(Math.abs(ex) * 3)) % 5], 0, k.s, -0.18);
      }
      for (let i = 0; i < 4; i++) k.box(f, 0.6 + (i % 2 ? 0.3 : -0.3), 0.1, 0.9 + i * 0.6, 0.5, 0.1, 0.62, '#8f6a48');
      house(k, f, -4.6, 2.4, 2.2, 1.6, 0.3, r, { acc });
      house(k, f, 4.6, 2.8, 2.0, 1.6, -0.35, r);
      house(k, f, -4.4, -3.4, 2.0, 1.5, 0.7, r);
      k.willow(f, 3.9, -2.8, 1.1);
      k.willow(f, -3.0, 0.2, 1.0);
      k.blossom(f, 3.6, 0.8, 0.9, r);
      flag(k, f, 2.4, 3.6, 3.2, acc, 0, true);
      flag(k, f, -1.6, 3.8, 3.0, acc, 0);
      k.lamp(f, 0.2, 3.4, 0, 1.3);
      labelL = new THREE.Vector3(0.6, top + 0.6, -1.0);
      walkL.push([0.6, 3.2], [-2.4, 3.0], [2.6, 3.4], [-1.8, -3.6], [3, -4]);
      spot(-1.9, 1.9, 0.5, 'vendor', 'painter');
      spot(3.3, 1.9, -0.4, 'watch', 'painter');
      pair(-0.6, 4.6, 0.2);
      break;
    }
    case 'theatre': {
      top = tagged(() => stage(k, f, 0, -1.8, acc, r));
      house(k, f, -4.6, -2.4, 2.0, 1.6, 0.5, r, { acc });
      house(k, f, 4.6, -2.2, 2.0, 1.6, -0.5, r);
      house(k, f, 4.8, 2.8, 1.8, 1.5, -0.2, r);
      for (const sx of [-1, 1]) {
        k.box(f, sx * 3.4, 0, 2.6, 0.08, 2.4, 0.08, C.woodD);
        k.redLantern(f, sx * 3.4, 2.4, 2.75, 1.2);
        flag(k, f, sx * 3.0, 4.6, 3.6, acc, 0, true);
      }
      k.blossom(f, -5.2, 1.6, 0.9, r);
      labelL = new THREE.Vector3(0, top + 0.5, -1.8);
      walkL.push([0, 2.6], [-1.6, 3.4], [1.6, 3.4], [0, 5.2], [-3.6, 1], [3.6, 1]);
      // a performer on the stage, an audience on the benches
      spot(0, -1.0, 0, 'perform', 'bard', 1.13);
      spot(-1.2, -1.6, 0.3, 'perform', 'bard', 1.13);
      for (let i = 0; i < 6; i++) spot((i % 2 ? 1 : -1) * (0.9 + (i % 3) * 0.45), 1.95 + Math.floor(i / 2) * 0.9 - 1.8 + 0.42, Math.PI, 'watch');
      break;
    }
    case 'archive': {
      top = tagged(() => hall(k, f, 0, -1.0, { w: 6.4, d: 3.4, acc, tiers: 2, plat: 0.45, ch: 1.45, band, shelves: true, lit: 0.85, roof: '#4f4a46' }, r).top);
      house(k, f, -5.0, 2.4, 2.2, 1.7, 0.4, r, { acc });
      house(k, f, 5.0, 2.2, 2.2, 1.7, -0.4, r);
      house(k, f, 4.8, -4.2, 2.0, 1.6, -0.2, r);
      stoneWall(k, arc(s.r - 0.2, Math.PI * 0.6, Math.PI * 1.4, 10), ground, 1.2, 0.6);
      k.pine(f, -5.6, -2.6, 1.1, r);
      k.pine(f, -3.2, 3.6, 0.9, r);
      flag(k, f, 2.6, 3.6, 3.6, acc, 0, true);
      flag(k, f, -2.6, 3.6, 3.6, acc, 0, true);
      k.lamp(f, 1.2, 3.0, 0, 1.4);
      k.lamp(f, -1.2, 3.0, 0, 1.4);
      labelL = new THREE.Vector3(0, top + 0.6, -1.0);
      walkL.push([0, 2.8], [-2.6, 2.4], [2.6, 2.6], [0, 5.2], [-1, 6]);
      spot(-1.5, 1.6, 0.2, 'watch', 'archivist');
      spot(2.0, 1.4, -0.6, 'sweep');
      pair(-3.4, 3.6, 0.6, 'archivist');
      break;
    }
    case 'heralds': {
      const tt = 6.4;
      top = tagged(() => {
        const t = woodTower(k, f, 0, -0.6, tt, 2.0, r, acc);
        drum(k, f.sub(0, tt + 0.16, -0.6), 0, 0, 0.7);
        return t;
      });
      flag(k, f.sub(0, tt + 0.16, -0.6), 1.3, 1.3, 2.2, acc, 0);
      house(k, f, -3.4, 2.2, 2.2, 1.6, 0.3, r, { acc });
      house(k, f, 3.2, 2.4, 1.8, 1.5, -0.4, r);
      palisade(k, arc(s.r - 0.3, Math.PI * 0.35, Math.PI * 1.65, 14), ground, 1.3);
      for (const [x, z] of [
        [-1.8, 3.6],
        [1.8, 3.8],
        [4.2, -0.4],
        [-4.2, -0.6],
      ])
        flag(k, f, x, z, 3.2, acc, 0, x < 0);
      k.lamp(f, 0, 3.0, 0, 1.4);
      labelL = new THREE.Vector3(0, top + 0.4, -0.6);
      walkL.push([0, 2.4], [-1.6, 1.0], [1.6, 1.0], [0, 4.6]);
      // drummer on the watch platform
      spot(0.0, -0.05, Math.PI, 'hammer', 'herald', tt + 0.24);
      spot(-0.7, -1.2, -0.6, 'watch', 'herald', tt + 0.24);
      spot(1.4, 2.6, 0.3, 'guard');
      break;
    }
    case 'bazaar': {
      const awn = [acc, '#c9a14a', '#b5653c', '#d8c8a6', acc, '#7c8b5a', '#c9a14a', acc];
      top = tagged(() => {
        const t = hall(k, f, 1.8, -2.8, { w: 3.6, d: 2.2, acc, open: true, plat: 0.25, ch: 1.2, band, lit: 0.8 }, r).top;
        for (let i = 0; i < 4; i++) stall(k, f, -4.2 + i * 2.2, 0.8, 0, awn[i], r);
        return t;
      });
      for (let i = 0; i < 3; i++) stall(k, f, -3.1 + i * 2.2, 3.2, Math.PI, awn[4 + i], r);
      house(k, f, -4.6, -2.8, 2.8, 2.0, 0.1, r, { acc, wall: '#a27b55' });
      house(k, f, 4.8, 3.2, 2.0, 1.6, -0.5, r);
      goods(k, f, -1.4, -1.6, r);
      goods(k, f, 4.2, -0.4, r);
      flag(k, f, -5.6, 1.2, 3.4, acc, 0, true);
      flag(k, f, 5.4, 0.8, 3.4, acc, 0, true);
      k.lamp(f, -1.0, 2.0, 0, 1.4);
      k.lamp(f, 2.4, 2.0, 0, 1.4);
      labelL = new THREE.Vector3(0, top + 1.4, -1.0);
      walkL.push([-3, 2.0], [-0.8, 2.0], [1.4, 2.0], [3.6, 2.0], [0, 4.8], [-2.6, -1.0], [3.4, -1.0]);
      // stall keepers and haggling customers
      for (let i = 0; i < 4; i++) {
        spot(-4.2 + i * 2.2 + 0.95, 1.05, -0.5, 'vendor', i % 2 ? 'merchant' : undefined);
        if (i % 2 === 0) spot(-4.2 + i * 2.2 + 0.2, 1.7, Math.PI + 0.2, 'watch');
      }
      for (let i = 0; i < 3; i++) spot(-3.1 + i * 2.2 - 0.95, 2.95, Math.PI - 0.5, 'vendor', i === 1 ? 'merchant' : undefined);
      spot(0.4, -1.3, 0.2, 'sweep');
      break;
    }
    case 'treasury': {
      top = tagged(() => vault(k, f, 0, -1.0, acc, r));
      house(k, f, -4.4, 2.6, 1.8, 1.5, 0.2, r, { acc, wall: '#b8ab95' });
      house(k, f, 4.4, 2.8, 1.8, 1.5, -0.2, r, { wall: '#b8ab95' });
      const hx = 5.6;
      stoneWall(k, [W(-hx, 4.6), W(-hx, -5.0), W(hx, -5.0), W(hx, 4.6)], ground, 1.4, 0.7);
      stoneWall(k, [W(-hx, 4.6), W(hx, 4.6)], ground, 1.4, 0.7, [[hx - 1.6, hx + 1.6]]);
      {
        const w = W(-hx, -5.0);
        stoneTower(k, w[0], ground(w[0], w[1]), w[1], 1.7, 2.6, s.ry, r, acc);
      }
      flag(k, f, -1.4, 4.0, 3.4, acc, 0, true);
      flag(k, f, 1.4, 4.0, 3.4, acc, 0, true);
      k.lamp(f, -2.2, 2.0, 0, 1.4);
      k.lamp(f, 2.2, 2.0, 0, 1.4);
      labelL = new THREE.Vector3(0, top + 0.6, -1.0);
      walkL.push([0, 2.8], [-2.4, 3.6], [2.4, 3.6], [0, 6.2]);
      for (const sx of [-1, 1]) spot(sx * 0.95, 1.55, 0, 'guard');
      spot(1.3, 4.3, 0.2, 'guard');
      spot(-1.0, 3.0, 0.4, 'watch', 'steward');
      break;
    }
    case 'court': {
      top = tagged(() => {
        const t = hall(k, f, 0, -1.4, { w: 5.6, d: 3.0, acc, tiers: 2, plat: 0.5, ch: 1.35, band, rail: true, lit: 0.85 }, r).top;
        drum(k, f, 3.0, 2.2, 1.0, -0.5);
        return t;
      });
      paifang(k, f, 0, 5.0, 3.2, 2.6, acc, null, 0, '#524c48');
      house(k, f, -4.6, 2.2, 2.0, 1.6, 0.4, r, { acc });
      house(k, f, 4.8, -2.6, 2.0, 1.6, -0.5, r);
      cwall(k, f, -5.4, -4.6, 5.4, -4.6, 1.0, 0.28, '#cbb595');
      cwall(k, f, -5.4, -4.6, -5.4, 0.4, 1.0, 0.28, '#cbb595');
      k.pine(f, -2.8, 3.4, 0.9, r);
      flag(k, f, -1.6, 4.2, 3.4, acc, 0, true);
      flag(k, f, 1.6, 4.2, 3.4, acc, 0, true);
      k.lamp(f, -1.2, 2.6, 0, 1.4);
      labelL = new THREE.Vector3(0, top + 0.6, -1.4);
      walkL.push([0, 2.6], [-2.2, 2.2], [1.6, 3.6], [0, 6.2], [-3.4, 4.4]);
      spot(0, 1.1, 0, 'watch', 'magistrate', 0.5);
      for (const sx of [-1, 1]) spot(sx * 1.25, 5.5, 0, 'guard');
      pair(2.3, 2.9, 0.9, 'magistrate');
      break;
    }
    case 'observatory': {
      // round stone star tower with a dome and a telescope pointing at the sky
      const tx = 0;
      const tz = -1.2;
      top = tagged(() => {
        k.cyl(f, tx, 0, tz, 2.0, 0.5, '#bdb3a2', 12);
        k.cyl(f, tx, 0.5, tz, 1.6, 3.4, '#d6ccb8', 12);
        k.cyl(f, tx, 3.9, tz, 1.75, 0.25, '#8a7e6c', 12);
        k.ball(f, tx, 4.15, tz, 1.45, '#e9e4da', k.s, 0.8);
        k.box(f, tx + 0.15, 5.1, tz + 0.35, 0.34, 0.34, 2.4, '#3d3f52', 0, k.s, -0.75);
        k.cyl(f, tx + 0.15, 5.75, tz + 1.15, 0.24, 0.12, '#c9a14a', 8);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          k.window(f, tx + Math.sin(a) * 1.61, 2.6, tz + Math.cos(a) * 1.61, 0.3, 0.55, a, i % 2 === 0);
        }
        return 5.8;
      });
      // a glowing ring band in the province colour
      k.neonRing(f, tx, 3.95, tz, 1.78, acc, 0.05);
      k.lights.push(f.pt(tx, 4.6, tz));
      house(k, f, -4.4, 2.4, 2.2, 1.6, 0.3, r, { acc });
      house(k, f, 4.2, 2.6, 2.0, 1.6, -0.35, r);
      // small sundial and star charts on stands
      k.cyl(f, 2.4, 0, 1.4, 0.5, 0.35, '#cfc6b4', 12);
      k.box(f, 2.4, 0.35, 1.4, 0.06, 0.45, 0.5, '#6b5a48', 0.6);
      k.box(f, -2.2, 0, 0.9, 0.9, 0.9, 0.08, acc, 0.2);
      k.pine(f, -5.2, -2.6, 1.0, r);
      k.pine(f, 5.0, -2.8, 0.9, r);
      stoneWall(k, arc(s.r - 0.3, Math.PI * 0.62, Math.PI * 1.38, 10), ground, 1.1, 0.55);
      flag(k, f, -1.8, 3.8, 3.4, acc, 0, true);
      flag(k, f, 1.8, 3.8, 3.4, acc, 0, true);
      k.lamp(f, 0, 3.0, 0, 1.4);
      labelL = new THREE.Vector3(tx, top + 0.6, tz);
      walkL.push([0, 2.4], [-2.4, 2.6], [2.6, 3.0], [0, 5.0], [-1.6, 5.4]);
      spot(1.2, 0.6, Math.PI * 0.8, 'watch', 'archivist');
      spot(-2.2, 1.5, Math.PI, 'watch', 'archivist');
      pair(-1.0, 3.4, 0.4);
      break;
    }
    case 'apothecary': {
      // herb house with a walled physic garden: raised beds, drying racks and a brewing stove
      top = tagged(() => {
        const t = hall(k, f, 0, -2.0, { w: 4.4, d: 2.6, acc, plat: 0.3, ch: 1.25, band, lit: 0.8, roof: '#55604a' }, r).top;
        kiln(k, f, 3.4, -2.2, 0.8);
        return t;
      });
      const herbs = ['#5f8f3a', '#7aa04a', '#8c6fb0', '#5c8a52', '#b3a03c', '#6e9a3a'];
      for (let i = 0; i < 6; i++) {
        const bx = -3.3 + (i % 3) * 2.2;
        const bz = 1.0 + Math.floor(i / 3) * 1.8;
        k.box(f, bx, 0, bz, 1.7, 0.28, 1.0, '#7a5a3c');
        k.box(f, bx, 0.28, bz, 1.5, 0.16, 0.8, herbs[i]);
        for (let j = 0; j < 3; j++) k.ball(f, bx - 0.5 + j * 0.5, 0.5, bz, 0.2, herbs[(i + j) % herbs.length]);
      }
      // drying rack with hanging bundles
      for (const sx of [-1, 1]) k.box(f, -5.0 + sx * 0.8, 0, -1.2, 0.08, 1.5, 0.08, '#6b4a30');
      k.box(f, -5.0, 1.5, -1.2, 1.8, 0.07, 0.07, '#6b4a30');
      for (let j = 0; j < 5; j++) k.box(f, -5.7 + j * 0.35, 1.2, -1.2, 0.14, 0.4, 0.14, herbs[j]);
      k.smoke.push(f.pt(3.4, 1.8, -2.2));
      k.lights.push(f.pt(0, 1.2, -1.0));
      house(k, f, 4.6, 2.4, 2.0, 1.6, -0.3, r, { acc });
      k.blossom(f, -4.8, 3.6, 0.9, r);
      k.blossom(f, 2.0, 4.6, 0.8, r);
      k.hedge(f, 0, 5.2, 7.2, 0.5);
      cwall(k, f, -5.8, -3.8, 5.8, -3.8, 0.9, 0.26, '#d8c8a6');
      flag(k, f, -2.4, 4.2, 3.2, acc, 0, true);
      flag(k, f, 2.4, 4.2, 3.2, acc, 0, true);
      k.lamp(f, -1.0, 3.6, 0, 1.4);
      k.lamp(f, 1.0, 3.6, 0, 1.4);
      labelL = new THREE.Vector3(0, top + 0.6, -2.0);
      walkL.push([0, 3.8], [-2.2, 3.6], [2.2, 3.6], [0, 6.0], [-4, 0]);
      spot(-1.1, 1.0, Math.PI, 'sweep', 'scribe');
      spot(1.1, 2.8, 0, 'watch', 'scribe');
      spot(3.0, -1.0, -0.6, 'hammer');
      pair(4.0, 4.4, 0.5);
      break;
    }
    case 'arena': {
      // oval stadium: stepped stands around a green pitch, banners on the rim
      const RX = 5.0;
      const RZ = 3.8;
      const N = 28;
      top = tagged(() => {
        k.box(f, 0, 0, 0, RX * 1.2, 0.08, RZ * 1.15, '#5f9a48');
        k.mark(f, 0, 0.09, 0, 0.06, RZ * 1.1, '#e8efe0');
        k.neonRing(f, 0, 0.1, 0, 0.6, '#e8efe0', 0.03);
        for (let i = 0; i < N; i++) {
          const a = (i / N) * Math.PI * 2;
          // leave a gate open towards the viewer
          if (Math.abs(Math.sin(a / 2 - Math.PI / 2)) > 0.985) continue;
          const sx = Math.sin(a);
          const cz = Math.cos(a);
          for (let t = 0; t < 3; t++) {
            const rx = RX + t * 0.62;
            const rz = RZ + t * 0.62;
            const col = t === 2 ? '#bfae90' : t === 1 ? '#d2c3a6' : '#e2d6be';
            k.box(f, sx * rx, 0, cz * rz, 1.3, 0.55 + t * 0.55, 0.6, col, a);
          }
          if (i % 4 === 0) flag(k, f, sx * (RX + 2.0), cz * (RZ + 2.0), 2.4, acc, a);
        }
        return 2.2;
      });
      gatehouse(k, f, 0, RZ + 1.4, 2.2, acc, 0, 1.4);
      for (const [x, z] of [
        [-RX - 1.6, -RZ - 0.6],
        [RX + 1.6, -RZ - 0.6],
      ])
        k.lamp(f, x, z, 0, 2.6);
      k.lights.push(f.pt(0, 2.4, 0));
      stall(k, f, -4.6, RZ + 3.0, 0, acc, r);
      stall(k, f, 4.6, RZ + 3.0, 0, '#c9a14a', r);
      labelL = new THREE.Vector3(0, top + 1.6, -RZ);
      walkL.push([0, RZ + 3.2], [-2.6, RZ + 3.4], [2.6, RZ + 3.4], [-1.5, 0.5], [1.5, -0.5]);
      // players on the pitch and fans by the gate
      spot(-1.6, 0.4, 0.9, 'chat', 'herald', 0.08);
      spot(1.4, -0.6, -2.2, 'chat', undefined, 0.08);
      spot(0, -2.2, 0, 'watch', 'herald', 0.08);
      pair(-3.0, RZ + 3.6, 0.3);
      spot(3.0, RZ + 3.4, Math.PI, 'vendor');
      break;
    }
  }
  void full;
  const lw = f.pt(labelL.x, 0, labelL.z);
  return {
    top: s.h + top,
    label: new THREE.Vector3(lw.x, s.h + labelL.y, lw.z),
    walk: walkL.map(([x, z]) => W(x, z)),
    spots,
  };
}
