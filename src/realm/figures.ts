// Chibi citizens in dynasty costume, built from separate body parts so they can
// be animated with one InstancedMesh per part: a body (flared robe, crossed
// collar, sash), a big head with a face (eyes with highlights, brows, blush) and
// hair (topknot or twin buns), sleeves with hands, legs with shoes, plus role
// headwear, hand props and body accessories.
//
// Vertex colours are baked; the per-vertex `fx` code marks which parts take the
// per-instance robe colour (1) or accent colour (2) - see people.ts.
import * as THREE from 'three';
import type { Role } from '../../shared/realm';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Batch, C, Frame, G } from './kit';

const ROBE = 1; // tinted with the instance robe colour
const ACC = 2; // tinted with the instance accent colour

const GOLD = '#f2c14e';
const GOLD_D = '#c9962e';
const SKIN = '#f6d7bd';
const HAIR = '#221d26';
const INK = '#16141a';
const CREAM = '#f7eedb';
const WHITE = '#ffffff';
const STRAW = '#dcb56c';
const BRONZE = '#a07a3c';
const BLUSH = '#f3a3a0';

// Body anchor points (figure local, ground at y = 0, facing +z).
export const SHOULDER = { x: 0.145, y: 0.405, z: 0 };
export const HIP = { x: 0.066, y: 0.21, z: 0 };
export const NECK_Y = 0.45;
export const HEAD_Y = 0.2; // head centre above the neck
export const HR = 0.2; // head radius
export const ARM_LEN = 0.26; // shoulder -> hand

const sph = new THREE.SphereGeometry(1, 12, 8);
const sphM = new THREE.SphereGeometry(1, 10, 7);
const sphS = new THREE.SphereGeometry(1, 6, 4);
const dome = new THREE.SphereGeometry(1, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2);
const ring8 = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
const cyl = new THREE.CylinderGeometry(1, 1, 1, 10);
const cylS = new THREE.CylinderGeometry(1, 1, 1, 6);
const ring = new THREE.CylinderGeometry(1, 1, 1, 14, 1, true);
const cone = new THREE.ConeGeometry(1, 1, 12);
const coneS = new THREE.ConeGeometry(1, 1, 6);
const torus = new THREE.TorusGeometry(1, 0.16, 5, 14);
const lathe = (pts: number[][], seg = 10) =>
  new THREE.LatheGeometry(
    pts.map(([x, y]) => new THREE.Vector2(x, y)),
    seg,
  );

const robeGeo = lathe(
  [
  [0.0, 0.055],
  [0.205, 0.055],
  [0.21, 0.085],
  [0.185, 0.16],
  [0.15, 0.24],
  [0.128, 0.3],
  [0.142, 0.4],
  [0.11, 0.44],
  [0.055, 0.465],
  [0.0, 0.47],
],
  10,
);
const sleeveGeo = lathe([
  [0.0, 0.03],
  [0.05, 0.03],
  [0.056, -0.02],
  [0.07, -0.13],
  [0.088, -0.21],
  [0.08, -0.225],
  [0.0, -0.225],
]);

export type Hair = 'm' | 'f';
export type HatKind = 'none' | 'crown' | 'futou' | 'futouL' | 'scholar' | 'straw' | 'helmet' | 'beret' | 'flower' | 'cap' | 'band' | 'scarf';
export type PropKind = 'none' | 'spear' | 'pennant' | 'scroll' | 'abacus' | 'hammer' | 'brush' | 'book' | 'tablet' | 'fan' | 'lantern' | 'rod';
export type AccKind = 'none' | 'cape' | 'apron' | 'pipa' | 'pouch' | 'satchel' | 'armor' | 'keys' | 'jade' | 'palette' | 'books' | 'baskets' | 'buckets' | 'broom';

export const HATS: HatKind[] = ['none', 'crown', 'futou', 'futouL', 'scholar', 'straw', 'helmet', 'beret', 'flower', 'cap', 'band', 'scarf'];
export const PROPS: PropKind[] = ['none', 'spear', 'pennant', 'scroll', 'abacus', 'hammer', 'brush', 'book', 'tablet', 'fan', 'lantern', 'rod'];
export const ACCS: AccKind[] = ['none', 'cape', 'apron', 'pipa', 'pouch', 'satchel', 'armor', 'keys', 'jade', 'palette', 'books', 'baskets', 'buckets', 'broom'];

export interface Costume {
  hair: Hair;
  hat: HatKind;
  prop: PropKind;
  acc: AccKind;
  robe: string; // base robe colour
}

// Costume of each province role (the agents).
export const ROLE_COSTUME: Record<Role, Omit<Costume, 'robe'> & { robe?: string }> = {
  vizier: { hair: 'm', hat: 'crown', prop: 'fan', acc: 'cape', robe: '#b8862e' },
  smith: { hair: 'm', hat: 'band', prop: 'hammer', acc: 'apron', robe: '#6b5444' },
  scribe: { hair: 'm', hat: 'futou', prop: 'brush', acc: 'satchel', robe: '#4f6a86' },
  painter: { hair: 'f', hat: 'beret', prop: 'brush', acc: 'palette', robe: '#e8dcc0' },
  bard: { hair: 'f', hat: 'flower', prop: 'none', acc: 'pipa', robe: '#b3473c' },
  archivist: { hair: 'm', hat: 'scholar', prop: 'book', acc: 'books', robe: '#4f5a4a' },
  herald: { hair: 'm', hat: 'helmet', prop: 'pennant', acc: 'none', robe: '#9a3b2c' },
  merchant: { hair: 'm', hat: 'straw', prop: 'abacus', acc: 'pouch', robe: '#9a7a50' },
  steward: { hair: 'f', hat: 'cap', prop: 'lantern', acc: 'keys', robe: '#6a5a7a' },
  magistrate: { hair: 'm', hat: 'futouL', prop: 'tablet', acc: 'jade', robe: '#2f3a52' },
};

export const GUARD: Costume = { hair: 'm', hat: 'helmet', prop: 'spear', acc: 'armor', robe: '#a2342a' };

// Plain robe colours for commoners.
export const ROBES = ['#3d5a6c', '#5b4a3a', '#6d5a3c', '#4a4f5a', '#7a6248', '#3f5a44', '#8a7350', '#5a3e34', '#6e7f8c', '#a28a64', '#8c4a3c', '#46606a'];
export const ACCENTS = ['#c0473a', '#d9a441', '#3f7a8c', '#7c8b4a', '#b0603a', '#8a5aa0', '#e8d9b0', '#4a6aa0'];

// ---------- part builders ----------
// Low-detail geometry for distant citizens.
const sphLo = new THREE.SphereGeometry(1, 8, 6);
const domeLo = new THREE.SphereGeometry(1, 8, 3, 0, Math.PI * 2, 0, Math.PI / 2);
const sphT = new THREE.SphereGeometry(1, 5, 3);
const robeLo = lathe(
  [
    [0.0, 0.055],
    [0.205, 0.055],
    [0.175, 0.18],
    [0.13, 0.3],
    [0.14, 0.4],
    [0.06, 0.465],
    [0.0, 0.47],
  ],
  8,
);

function head(b: Batch, f: Frame, hair: Hair, hi = true) {
  const S = hi ? sph : sphLo;
  const D = hi ? dome : domeLo;
  const R = hi ? sphS : sphT;
  // face
  b.add(S, SKIN, f.mat(0, 0, 0, 0, HR * 1.04, HR * 0.95, HR * 0.98));
  // hair cap swept back and the back of the head
  b.add(D, HAIR, f.mat(0, 0.008, -0.016, 0, HR * 1.08, HR * 1.04, HR * 1.08, -0.5));
  b.add(R, HAIR, f.mat(0, -0.015, -0.055, 0, HR * 1.0, HR * 0.93, HR * 0.86));
  if (hi) {
    for (const sx of [-1, 1]) b.add(G.box, HAIR, f.mat(sx * 0.17, -0.04, 0.035, 0, 0.05, 0.15, 0.06, 0.1, -sx * 0.1));
    b.add(sphS, HAIR, f.mat(0, 0.125, 0.11, 0, 0.13, 0.05, 0.07, 0.5));
    // eyes: dark ovals with a white catch light, brows, blush and a small mouth
    for (const sx of [-1, 1]) {
      b.add(sphS, INK, f.mat(sx * 0.07, -0.018, 0.176, 0, 0.026, 0.036, 0.016, 0, -sx * 0.08));
      b.add(G.box, WHITE, f.mat(sx * 0.07 + 0.009, -0.004, 0.19, 0, 0.012, 0.012, 0.006));
      b.add(G.box, '#3a2a26', f.mat(sx * 0.072, 0.04, 0.176, 0, 0.042, 0.009, 0.01, 0, -sx * 0.12));
      b.add(G.box, BLUSH, f.mat(sx * 0.115, -0.07, 0.15, sx * 0.55, 0.04, 0.02, 0.008));
    }
    b.add(G.box, '#a8524a', f.mat(0, -0.085, 0.178, 0, 0.026, 0.008, 0.008));
  } else {
    for (const sx of [-1, 1]) b.add(G.box, INK, f.mat(sx * 0.07, -0.018, 0.18, 0, 0.04, 0.05, 0.02));
  }
  if (hair === 'm') {
    // topknot with a ribbon (accent)
    b.add(R, HAIR, f.mat(0, HR + 0.035, -0.035, 0, 0.068, 0.064, 0.068));
    if (hi) {
      b.add(ring8, WHITE, f.mat(0, HR + 0.0, -0.035, 0, 0.056, 0.026, 0.056), ACC);
      b.add(G.box, GOLD, f.mat(0, HR + 0.045, -0.035, 0, 0.16, 0.012, 0.012));
    }
  } else {
    // twin buns with ribbons and a hairpin
    for (const sx of [-1, 1]) {
      b.add(R, HAIR, f.mat(sx * 0.13, HR * 0.78, -0.035, 0, 0.068, 0.068, 0.068));
      if (hi) {
        b.add(ring8, WHITE, f.mat(sx * 0.11, HR * 0.68, -0.035, 0, 0.05, 0.022, 0.05, 0, sx * 0.7), ACC);
        b.add(G.box, WHITE, f.mat(sx * 0.17, HR * 0.45, -0.06, 0, 0.022, 0.12, 0.012, 0, sx * 0.25), ACC);
      }
    }
    if (hi) b.add(G.box, GOLD, f.mat(0.06, HR * 0.95, 0.07, 0.6, 0.03, 0.03, 0.03));
  }
}

function hat(b: Batch, f: Frame, kind: HatKind) {
  const T = HR; // top of head
  switch (kind) {
    case 'crown':
      b.add(cyl, GOLD, f.mat(0, T - 0.005, -0.02, 0, 0.12, 0.07, 0.12));
      b.add(cyl, GOLD_D, f.mat(0, T - 0.04, -0.02, 0, 0.125, 0.014, 0.125));
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        b.add(coneS, GOLD, f.mat(Math.sin(a) * 0.1, T + 0.065, -0.02 + Math.cos(a) * 0.1, 0, 0.026, 0.075, 0.026));
      }
      b.add(coneS, GOLD, f.mat(0, T + 0.1, -0.02, 0, 0.03, 0.12, 0.03));
      b.add(sphS, '#e8423a', f.mat(0, T - 0.005, 0.105, 0, 0.022, 0.022, 0.012));
      for (const sx of [-1, 1]) b.add(sphS, '#3ab0a0', f.mat(sx * 0.085, T - 0.005, 0.07, 0, 0.014, 0.014, 0.01));
      break;
    case 'futou':
    case 'futouL': {
      const wing = kind === 'futouL' ? 0.3 : 0.12;
      b.add(cyl, INK, f.mat(0, T - 0.035, -0.012, 0, 0.18, 0.1, 0.175, -0.25));
      b.add(G.box, INK, f.mat(0, T + 0.05, -0.05, 0, 0.17, 0.13, 0.13, -0.15));
      b.add(G.box, '#c9a64a', f.mat(0, T - 0.07, 0.14, 0, 0.12, 0.012, 0.01, -0.25));
      for (const sx of [-1, 1]) b.add(G.box, INK, f.mat(sx * (0.09 + wing / 2), T + 0.04, -0.075, 0, wing, 0.018, 0.05, 0, sx * 0.05));
      break;
    }
    case 'scholar':
      b.add(G.box, INK, f.mat(0, T + 0.0, -0.02, 0, 0.22, 0.1, 0.22, -0.2));
      b.add(G.box, INK, f.mat(0, T + 0.065, -0.03, 0, 0.3, 0.02, 0.3, -0.2));
      b.add(G.box, WHITE, f.mat(0.11, T + 0.0, 0.08, 0, 0.012, 0.12, 0.012), ACC);
      for (const sx of [-1, 1]) b.add(torus, GOLD, f.mat(sx * 0.07, -0.018, 0.19, 0, 0.042, 0.042, 0.03));
      b.add(G.box, GOLD, f.mat(0, -0.012, 0.195, 0, 0.04, 0.006, 0.006));
      break;
    case 'straw':
      b.add(cone, STRAW, f.mat(0, T + 0.04, -0.02, 0, 0.27, 0.15, 0.27, -0.25));
      b.add(cyl, '#b88d47', f.mat(0, T - 0.03, -0.0, 0, 0.275, 0.012, 0.275, -0.25));
      b.add(ring, '#8a6a3a', f.mat(0, T - 0.0, -0.02, 0, 0.13, 0.03, 0.13, -0.25));
      b.add(sphS, '#8a6a3a', f.mat(0, T + 0.12, -0.05, 0, 0.03, 0.03, 0.03));
      for (const sx of [-1, 1]) b.add(G.box, '#5a4030', f.mat(sx * 0.15, -0.06, 0.04, 0, 0.008, 0.2, 0.008, 0, sx * 0.2));
      break;
    case 'helmet':
      b.add(dome, BRONZE, f.mat(0, 0.03, -0.01, 0, HR * 1.12, HR * 1.1, HR * 1.12, -0.12));
      b.add(cyl, '#7a5a2c', f.mat(0, 0.03, -0.01, 0, HR * 1.16, 0.022, HR * 1.16));
      b.add(G.box, GOLD, f.mat(0, 0.13, 0.19, 0, 0.05, 0.08, 0.02, -0.4));
      b.add(cylS, GOLD_D, f.mat(0, T + 0.09, -0.02, 0, 0.012, 0.1, 0.012));
      b.add(coneS, '#d2382c', f.mat(0, T + 0.2, -0.04, 0, 0.05, 0.16, 0.05, Math.PI));
      b.add(sphM, '#d2382c', f.mat(0, T + 0.14, -0.04, 0, 0.055, 0.04, 0.055));
      for (const sx of [-1, 1]) b.add(G.box, BRONZE, f.mat(sx * 0.18, -0.06, -0.03, 0, 0.03, 0.12, 0.12, 0, sx * 0.15));
      b.add(G.box, BRONZE, f.mat(0, -0.06, -0.19, 0, 0.26, 0.12, 0.03, 0.25));
      break;
    case 'beret':
      b.add(sphM, WHITE, f.mat(0.03, T - 0.01, -0.02, 0, 0.2, 0.075, 0.19, 0, -0.25), ACC);
      b.add(cylS, INK, f.mat(0.06, T + 0.06, -0.02, 0, 0.01, 0.04, 0.01));
      break;
    case 'flower':
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        b.add(sphS, '#ff9fc0', f.mat(0.15 + Math.sin(a) * 0.035, 0.12 + Math.cos(a) * 0.035, 0.06, 0, 0.03, 0.03, 0.02));
      }
      b.add(sphS, GOLD, f.mat(0.15, 0.12, 0.075, 0, 0.018, 0.018, 0.015));
      b.add(ring, WHITE, f.mat(0, 0.09, -0.01, 0, HR * 1.04, 0.03, HR * 1.0, -0.4), ACC);
      break;
    case 'cap':
      b.add(cyl, INK, f.mat(0, T - 0.02, -0.02, 0, 0.13, 0.09, 0.13, -0.2));
      b.add(sphS, GOLD, f.mat(0, T + 0.0, 0.11, 0, 0.022, 0.022, 0.012));
      for (const sx of [-1, 1]) b.add(G.box, WHITE, f.mat(sx * 0.12, T - 0.08, -0.08, 0, 0.012, 0.12, 0.03, 0, sx * 0.2), ACC);
      break;
    case 'band':
      b.add(ring, WHITE, f.mat(0, 0.085, -0.01, 0, HR * 1.06, 0.045, HR * 1.04, -0.2), ACC);
      for (const sx of [-1, 1]) b.add(G.box, WHITE, f.mat(sx * 0.03, 0.02, -0.22, 0, 0.03, 0.14, 0.012, 0.3, sx * 0.3), ACC);
      break;
    case 'scarf':
      b.add(dome, WHITE, f.mat(0, 0.02, -0.02, 0, HR * 1.13, HR * 1.12, HR * 1.13, -0.35), ACC);
      b.add(G.box, WHITE, f.mat(0, -0.06, -0.2, 0, 0.2, 0.16, 0.03, 0.2), ACC);
      break;
    case 'none':
      break;
  }
}

// Props in the right hand, built in arm-local space (shoulder at the origin,
// the arm hangs along -y, forward is +z).
const HAND_Y = -ARM_LEN;
function prop(b: Batch, f: Frame, kind: PropKind) {
  const h = HAND_Y;
  switch (kind) {
    case 'spear':
    case 'pennant': {
      b.add(cylS, C.woodD, f.mat(0, h + 0.5, 0.03, 0, 0.014, 1.3, 0.014));
      b.add(coneS, '#cfd3da', f.mat(0, h + 1.21, 0.03, 0, 0.026, 0.14, 0.012));
      b.add(sphS, '#d2382c', f.mat(0, h + 1.1, 0.03, 0, 0.032, 0.04, 0.032));
      if (kind === 'pennant') {
        b.add(G.box, WHITE, f.mat(0, h + 0.98, -0.1, 0, 0.012, 0.18, 0.24), ACC);
        b.add(G.box, GOLD, f.mat(0, h + 0.885, -0.1, 0, 0.014, 0.02, 0.24));
      }
      break;
    }
    case 'scroll':
      b.add(cylS, CREAM, f.mat(0, h - 0.01, 0.06, 0, 0.03, 0.2, 0.03, 0, Math.PI / 2));
      for (const sx of [-1, 1]) b.add(cylS, C.woodD, f.mat(sx * 0.11, h - 0.01, 0.06, 0, 0.012, 0.03, 0.012, 0, Math.PI / 2));
      break;
    case 'abacus':
      b.add(G.box, '#6b3f26', f.mat(0, h, 0.07, 0, 0.17, 0.11, 0.02, -0.3));
      for (let i = 0; i < 3; i++) b.add(G.box, i === 1 ? GOLD : '#d9c49a', f.mat(0, h - 0.03 + i * 0.03, 0.08, 0, 0.14, 0.016, 0.026, -0.3));
      break;
    case 'hammer':
      b.add(cylS, C.wood, f.mat(0, h - 0.02, 0.08, 0, 0.013, 0.2, 0.013, Math.PI / 2 - 0.2));
      b.add(G.box, '#4a4c55', f.mat(0, h - 0.0, 0.18, 0, 0.05, 0.11, 0.05, -0.2));
      break;
    case 'brush':
      b.add(cylS, C.woodD, f.mat(0, h - 0.01, 0.08, 0, 0.008, 0.2, 0.008, Math.PI / 2 - 0.5));
      b.add(coneS, INK, f.mat(0, h - 0.06, 0.17, 0, 0.012, 0.04, 0.012, Math.PI / 2 - 0.5 + Math.PI));
      break;
    case 'book':
      b.add(G.box, '#2e5e9e', f.mat(0.0, h - 0.02, 0.06, 0, 0.03, 0.15, 0.12));
      b.add(G.box, CREAM, f.mat(0.004, h - 0.02, 0.06, 0, 0.026, 0.14, 0.11));
      break;
    case 'tablet':
      b.add(G.box, '#efe6d2', f.mat(0, h + 0.05, 0.07, 0, 0.045, 0.2, 0.012, -0.25));
      break;
    case 'fan':
      b.add(new THREE.CylinderGeometry(1, 1, 1, 10, 1, false, -Math.PI / 2, Math.PI), GOLD, f.mat(0, h + 0.04, 0.06, 0, 0.12, 0.01, 0.12, Math.PI / 2 - 0.2));
      b.add(cylS, '#8a2a20', f.mat(0, h - 0.0, 0.06, 0, 0.01, 0.06, 0.01));
      break;
    case 'lantern':
      b.add(cylS, C.woodD, f.mat(0, h, 0.16, 0, 0.008, 0.32, 0.008, Math.PI / 2 - 0.35));
      b.add(cylS, INK, f.mat(0, h + 0.02, 0.31, 0, 0.004, 0.08, 0.004));
      b.add(sphM, '#ff6a3a', f.mat(0, h - 0.07, 0.31, 0, 0.06, 0.075, 0.06));
      b.add(cylS, GOLD_D, f.mat(0, h - 0.07, 0.31, 0, 0.045, 0.17, 0.045));
      break;
    case 'rod':
      b.add(cylS, '#9a7a4a', f.mat(0, h + 0.25, 0.45, 0, 0.008, 1.2, 0.008, 0.95));
      b.add(cylS, '#e8e0cc', f.mat(0, h + 0.18, 0.95, 0, 0.0025, 0.75, 0.0025));
      break;
    case 'none':
      break;
  }
}

// Accessories in body-local space.
function acc(b: Batch, f: Frame, kind: AccKind) {
  switch (kind) {
    case 'cape':
      b.add(G.box, WHITE, f.mat(0, 0.25, -0.15, 0, 0.3, 0.36, 0.02, 0.18), ACC);
      b.add(cyl, GOLD, f.mat(0, 0.425, 0, 0, 0.155, 0.03, 0.15));
      for (const sx of [-1, 1]) b.add(sphS, GOLD, f.mat(sx * 0.06, 0.4, 0.13, 0, 0.022, 0.022, 0.015));
      break;
    case 'apron':
      b.add(G.box, '#5a3a2a', f.mat(0, 0.2, 0.15, 0, 0.2, 0.26, 0.02, -0.12));
      b.add(G.box, '#3a2a20', f.mat(0, 0.33, 0.14, 0, 0.22, 0.02, 0.02));
      break;
    case 'pipa':
      b.add(sphM, '#c48d5c', f.mat(0.04, 0.24, 0.17, 0, 0.09, 0.12, 0.03, 0, 0.55));
      b.add(G.box, C.woodD, f.mat(0.13, 0.37, 0.18, 0, 0.022, 0.18, 0.018, 0, 0.55));
      b.add(G.box, '#3a2a20', f.mat(0.18, 0.45, 0.18, 0, 0.04, 0.05, 0.03, 0, 0.55));
      break;
    case 'pouch':
      b.add(sphM, '#8a5a34', f.mat(0.12, 0.22, 0.09, 0, 0.055, 0.065, 0.045));
      for (let i = 0; i < 4; i++) b.add(cylS, GOLD, f.mat(-0.1 + i * 0.012, 0.15 - i * 0.025, 0.14, 0, 0.022, 0.008, 0.022, 1.2));
      break;
    case 'satchel':
      b.add(G.box, '#7a5a3a', f.mat(-0.15, 0.22, 0.02, 0, 0.06, 0.12, 0.14));
      b.add(G.box, '#5a4030', f.mat(0.0, 0.33, 0.0, 0, 0.025, 0.3, 0.29, 0, 0.75));
      break;
    case 'armor':
      b.add(lathe([[0.0, 0.24], [0.148, 0.24], [0.138, 0.3], [0.146, 0.36], [0.158, 0.41], [0.12, 0.44], [0.0, 0.44]], 12), '#8a6a3a', f.mat(0, 0, 0));
      for (let i = 0; i < 3; i++) b.add(ring, '#5e4626', f.mat(0, 0.27 + i * 0.055, 0, 0, 0.15, 0.012, 0.15));
      for (const sx of [-1, 1]) b.add(sphM, '#9a7a44', f.mat(sx * 0.15, 0.415, 0, 0, 0.07, 0.045, 0.075));
      b.add(sphS, GOLD, f.mat(0, 0.36, 0.15, 0, 0.03, 0.03, 0.015));
      break;
    case 'keys':
      for (let i = 0; i < 3; i++) b.add(torus, GOLD, f.mat(0.1 + i * 0.02, 0.2 - i * 0.01, 0.11, 0, 0.022, 0.022, 0.02));
      break;
    case 'jade':
      b.add(cyl, '#5fb08a', f.mat(0, 0.27, 0.142, 0, 0.035, 0.012, 0.035, Math.PI / 2));
      b.add(G.box, '#c9a64a', f.mat(0, 0.2, 0.145, 0, 0.012, 0.1, 0.008));
      break;
    case 'palette':
      b.add(cyl, '#e2bf8c', f.mat(-0.2, 0.17, 0.1, 0, 0.09, 0.012, 0.07, Math.PI / 2.3));
      ['#ff5f7e', '#4fb8e0', '#ffd34d', '#5fbf6a'].forEach((c, i) => b.add(sphS, c, f.mat(-0.205 + (i % 2) * 0.05 - 0.02, 0.19 + Math.floor(i / 2) * -0.04, 0.115, 0, 0.016, 0.016, 0.01)));
      break;
    case 'books':
      ['#8a2f2a', '#2e5e9e', '#3d7a4a'].forEach((c, i) => b.add(G.box, c, f.mat(-0.19, 0.2 + i * 0.035, 0.05, 0, 0.07, 0.032, 0.15, 0, 0.1 * (i - 1))));
      break;
    case 'baskets':
    case 'buckets': {
      // shoulder pole with a load at each end
      b.add(G.box, '#a0784a', f.mat(0.12, 0.47, 0, 0, 0.022, 0.022, 1.15));
      for (const sz of [-1, 1]) {
        for (const sx of [-1, 1]) b.add(G.box, '#5a4030', f.mat(0.12 + sx * 0.06, 0.35, sz * 0.52, 0, 0.006, 0.24, 0.006, 0, sx * 0.25));
        if (kind === 'baskets') {
          b.add(new THREE.CylinderGeometry(0.13, 0.095, 0.16, 10), '#b88d4a', f.mat(0.12, 0.17, sz * 0.52));
          b.add(ring, '#8a6434', f.mat(0.12, 0.25, sz * 0.52, 0, 0.133, 0.02, 0.133));
          const crop = sz > 0 ? ['#7aa64a', '#8ab85a', '#6a9a3a'] : ['#e08a3a', '#e8a64a', '#d9733a'];
          for (let i = 0; i < 3; i++) b.add(sphS, crop[i], f.mat(0.12 + (i - 1) * 0.05, 0.255, sz * 0.52 + (i % 2) * 0.04 - 0.02, 0, 0.05, 0.04, 0.05));
        } else {
          b.add(new THREE.CylinderGeometry(0.1, 0.085, 0.17, 10), '#7a5a3d', f.mat(0.12, 0.17, sz * 0.52));
          b.add(ring, '#3a3036', f.mat(0.12, 0.13, sz * 0.52, 0, 0.096, 0.02, 0.096));
          b.add(ring, '#3a3036', f.mat(0.12, 0.22, sz * 0.52, 0, 0.1, 0.02, 0.1));
          b.add(cyl, '#5aa8c8', f.mat(0.12, 0.245, sz * 0.52, 0, 0.09, 0.008, 0.09));
        }
      }
      break;
    }
    case 'broom': {
      b.add(cylS, '#a0784a', f.mat(0.02, 0.2, 0.36, 0, 0.012, 0.6, 0.012, 1.0));
      b.add(new THREE.CylinderGeometry(0.03, 0.09, 0.2, 8), STRAW, f.mat(0.02, 0.06, 0.62, 0, 1, 1, 1, 1.25));
      break;
    }
    case 'none':
      break;
  }
}

function body(b: Batch, f: Frame, hi = true) {
  if (!hi) {
    b.add(robeLo, WHITE, f.mat(0, 0, 0), ROBE);
    b.add(ring8, WHITE, f.mat(0, 0.28, 0, 0, 0.138, 0.062, 0.138), ACC);
    return;
  }
  b.add(robeGeo, WHITE, f.mat(0, 0, 0), ROBE);
  // hem trim, crossed collar (right over left), sash with knot and tails
  b.add(ring, WHITE, f.mat(0, 0.072, 0, 0, 0.211, 0.035, 0.211), ACC);
  b.add(cylS, '#e9dcc4', f.mat(0, 0.455, 0, 0, 0.06, 0.04, 0.06));
  for (const sx of [-1, 1]) {
    b.add(G.box, CREAM, f.mat(sx * 0.032, 0.39, 0.118, 0, 0.032, 0.12, 0.02, -0.25, sx * 0.62));
    b.add(G.box, WHITE, f.mat(sx * 0.047, 0.392, 0.124, 0, 0.012, 0.125, 0.01, -0.25, sx * 0.62), ACC);
  }
  b.add(cyl, WHITE, f.mat(0, 0.28, 0, 0, 0.137, 0.062, 0.137), ACC);
  b.add(G.box, '#c8c8c8', f.mat(0.0, 0.28, 0.138, 0, 0.06, 0.05, 0.03), ACC);
  for (const sx of [-1, 1]) b.add(G.box, '#d8d8d8', f.mat(sx * 0.03, 0.19, 0.15, 0, 0.03, 0.15, 0.012, -0.12, sx * 0.12), ACC);
}

function arm(b: Batch, f: Frame) {
  b.add(sleeveGeo, WHITE, f.mat(0, 0, 0), ROBE);
  b.add(ring, WHITE, f.mat(0, -0.205, 0, 0, 0.09, 0.026, 0.09), ACC);
  b.add(sphM, SKIN, f.mat(0, HAND_Y, 0.008, 0, 0.042, 0.046, 0.042));
}

function leg(b: Batch, f: Frame) {
  b.add(cylS, '#2e2a30', f.mat(0, -0.09, 0, 0, 0.04, 0.17, 0.04));
  b.add(sphM, '#1b1a1f', f.mat(0, -0.185, 0.022, 0, 0.044, 0.035, 0.07));
  b.add(G.box, '#e8e0d0', f.mat(0, -0.205, 0.02, 0, 0.07, 0.012, 0.12));
}

function make(fn: (b: Batch, f: Frame) => void) {
  const b = new Batch();
  fn(b, new Frame());
  if (!b.parts.length) return null;
  const m = b.build(new THREE.MeshBasicMaterial());
  if (!m) return null;
  (m.material as THREE.Material).dispose();
  const g = mergeVertices(m.geometry, 1e-4);
  m.geometry.dispose();
  g.computeBoundingSphere();
  return g;
}

export interface FigureParts {
  body: THREE.BufferGeometry;
  arm: THREE.BufferGeometry;
  leg: THREE.BufferGeometry;
  head: Record<Hair, THREE.BufferGeometry>;
  headLo: Record<Hair, THREE.BufferGeometry>;
  bodyLo: THREE.BufferGeometry;
  hat: Partial<Record<HatKind, THREE.BufferGeometry>>;
  prop: Partial<Record<PropKind, THREE.BufferGeometry>>;
  acc: Partial<Record<AccKind, THREE.BufferGeometry>>;
  shadow: THREE.BufferGeometry;
}

let parts: FigureParts | null = null;
// Shared part geometries (built once, never disposed).
export function figureParts(): FigureParts {
  if (parts) return parts;
  const hatG: FigureParts['hat'] = {};
  for (const h of HATS) {
    const g = make((b, f) => hat(b, f, h));
    if (g) hatG[h] = g;
  }
  const propG: FigureParts['prop'] = {};
  for (const p of PROPS) {
    const g = make((b, f) => prop(b, f, p));
    if (g) propG[p] = g;
  }
  const accG: FigureParts['acc'] = {};
  for (const a of ACCS) {
    const g = make((b, f) => acc(b, f, a));
    if (g) accG[a] = g;
  }
  const shadow = new THREE.PlaneGeometry(1, 1);
  shadow.rotateX(-Math.PI / 2);
  parts = {
    body: make(body)!,
    arm: make(arm)!,
    leg: make(leg)!,
    head: { m: make((b, f) => head(b, f, 'm'))!, f: make((b, f) => head(b, f, 'f'))! },
    headLo: { m: make((b, f) => head(b, f, 'm', false))!, f: make((b, f) => head(b, f, 'f', false))! },
    bodyLo: make((b, f) => body(b, f, false))!,
    hat: hatG,
    prop: propG,
    acc: accG,
    shadow,
  };
  return parts;
}

// Static figure baked into a Kit batch (boat crews, stage actors far away).
export function bakeFigure(b: Batch, f: Frame, c: Costume, accent: string, pose: { armL?: number; armR?: number } = {}) {
  const robe = new THREE.Color(c.robe);
  const ac = new THREE.Color(accent);
  const sub = new Batch();
  const fr = new Frame();
  body(sub, fr);
  acc(sub, fr, c.acc);
  for (const sx of [-1, 1]) {
    const af = fr.sub(sx * SHOULDER.x, SHOULDER.y, SHOULDER.z);
    const am = new Frame(af.m.clone().multiply(new THREE.Matrix4().makeRotationX(sx < 0 ? (pose.armL ?? 0) : (pose.armR ?? 0))));
    arm(sub, new Frame(am.m.clone().multiply(new THREE.Matrix4().makeRotationZ(sx * 0.14))));
    if (sx > 0) prop(sub, new Frame(am.m.clone().multiply(new THREE.Matrix4().makeRotationZ(0.14))), c.prop);
    leg(sub, fr.sub(sx * HIP.x, HIP.y, 0));
  }
  const hf = fr.sub(0, NECK_Y + HEAD_Y, 0);
  head(sub, hf, c.hair);
  hat(sub, hf, c.hat);
  // resolve tints into plain vertex colours and append to the target batch
  for (const g of sub.parts) {
    const col = g.attributes.color as THREE.BufferAttribute;
    const fx = g.attributes.fx as THREE.BufferAttribute;
    for (let i = 0; i < col.count; i++) {
      const k = fx.getX(i);
      if (k > 0.5 && k < 1.5) col.setXYZ(i, col.getX(i) * robe.r, col.getY(i) * robe.g, col.getZ(i) * robe.b);
      else if (k > 1.5) col.setXYZ(i, col.getX(i) * ac.r, col.getY(i) * ac.g, col.getZ(i) * ac.b);
      fx.setX(i, 0);
    }
    g.applyMatrix4(f.m);
    b.parts.push(g);
  }
}

// ---------- compatibility ----------
export const ROLES: Role[] = ['vizier', 'smith', 'scribe', 'painter', 'bard', 'archivist', 'herald', 'merchant', 'steward', 'magistrate'];
