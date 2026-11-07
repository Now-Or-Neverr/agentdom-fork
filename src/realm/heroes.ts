// The realm's real agents ("heroes"): one larger chibi figure per active agent
// from GET /api/realm/live, living in its own guild. What a hero does on the map
// follows its real state only:
//   working - walks to its workshop and plays its role's work loop; the speech
//             bubble shows the real decree title.
//   duty    - carries a scroll to the guild notice board and reads it; the
//             bubble shows the real duty result.
//   idle    - strolls between the open spots of its guild and does small idle
//             actions (no bubble: an idle agent never claims work).
// Figures use the same instanced chibi parts as the citizens (people.ts); the
// workshop furniture is merged static geometry; names and bubbles are a pooled
// DOM overlay positioned every frame.
import * as THREE from 'three';
import type { AgentState, LiveAgent } from '../../shared/live';
import { PROVINCE, type ProvinceId, type Role } from '../../shared/realm';
import { ACCS, HATS, HEAD_Y, HIP, NECK_Y, PROPS, ROLE_COSTUME, SHOULDER, figureParts, type PropKind } from './figures';
import { Part, figureMaterial, type WalkGraph } from './people';
import { Batch, C, Frame, G, M, mix, rng } from './kit';
import { SITE } from './layout';
import { softDot } from './tex';
import type { Look } from './look';

export const HERO_SCALE = 1.35 * 1.42;
const FURN = 1.42 / 1.3; // furniture was laid out for a 1.3x figure
const MAX = 96;

// Which looks are women, per role (same cast as the 2D portraits in chibi.tsx).
const FEM: Record<Role, number[]> = {
  vizier: [1, 3],
  smith: [2, 3],
  scribe: [1, 3],
  painter: [0, 3],
  bard: [0, 1],
  archivist: [1, 3],
  herald: [1, 3],
  merchant: [0, 3],
  steward: [1, 3],
  magistrate: [0, 3],
};
// Robe variation per look (mixed towards the agent colour).
const LOOK_MIX = [0.12, 0.3, 0.0, 0.42];

const PI = Math.PI;
const prop = (k: PropKind) => PROPS.indexOf(k);
const P_NONE = prop('none');

type Mode = 'walk' | 'work' | 'idle' | 'post' | 'read';
type IdleAct = 'look' | 'stretch' | 'tidy' | 'bow' | 'tool';

interface Hero {
  a: LiveAgent;
  state: AgentState;
  slot: number;
  hair: 0 | 1;
  hat: number;
  prop: number;
  acc: number;
  robe: THREE.Color;
  accent: THREE.Color;
  x: number;
  y: number;
  z: number;
  h: number;
  ph: number;
  seed: number;
  node: number; // node the hero stands on / walks from
  to: number; // node walked towards (-1 = straight line to tx, tz)
  path: number[];
  t: number;
  len: number;
  mode: Mode;
  timer: number;
  act: IdleAct;
  goal: number; // node the current walk ends at
  face: number;
  replan: boolean;
  vis: boolean;
  sx: number; // screen position (px) of the head, for picking and labels
  sy: number;
}

interface Spot {
  node: number;
  face: number;
}

interface PoseOut {
  legA: number;
  armL: number;
  armR: number;
  armZ: number;
  bob: number;
  roll: number;
  lean: number;
  headYaw: number;
  headPitch: number;
  prop: number;
  spark: number; // 0 none, 1 gentle motes, 2 hammer sparks burst
}

const _B = new THREE.Matrix4();
const _L = new THREE.Matrix4();
const _M = new THREE.Matrix4();
const _H = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();
const _c = new THREE.Color();
const ONE = new THREE.Vector3(1, 1, 1);
const SH = new THREE.Color(0, 0, 0);

function local(x: number, y: number, z: number, rx: number, ry: number, rz: number, order: THREE.EulerOrder) {
  _e.set(rx, ry, rz, order);
  _q.setFromEuler(_e);
  return _L.compose(_p.set(x, y, z), _q, ONE);
}

function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// ---------- workshop furniture (static, in hero-local space: hero at the
// origin facing +z, ground at y = 0) ----------
function workshop(b: Batch, f: Frame, role: Role, accent: string, r: () => number) {
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, c: string, ry = 0, rx = 0, rz = 0) => b.add(G.box, c, f.mat(x, y + h / 2, z, ry, w, h, d, rx, rz));
  const cyl = (x: number, y: number, z: number, rr: number, h: number, c: string, seg = G.cyl12, rx = 0, rz = 0) => b.add(seg, c, f.mat(x, y + h / 2, z, 0, rr, h, rr, rx, rz));
  const table = (z: number, w: number, d: number, h: number, top: string, legs = C.woodD) => {
    box(0, h - 0.05, z, w, 0.05, d, top);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(sx * (w / 2 - 0.05), 0, z + sz * (d / 2 - 0.05), 0.05, h - 0.05, 0.05, legs);
  };
  switch (role) {
    case 'smith': {
      // anvil on a stump, a glowing ingot, quench bucket and a small brazier
      cyl(0, 0, 0.55, 0.16, 0.24, C.trunk);
      box(0, 0.24, 0.55, 0.16, 0.1, 0.12, '#3c3d44');
      box(0, 0.34, 0.55, 0.34, 0.08, 0.14, '#4a4c55');
      b.add(G.cone8, '#4a4c55', f.mat(0.24, 0.38, 0.55, 0, 0.06, 0.16, 0.06, 0, PI / 2));
      box(0.02, 0.42, 0.55, 0.12, 0.025, 0.04, '#ff8a3a');
      cyl(-0.45, 0, 0.4, 0.11, 0.16, '#6b4a33');
      cyl(-0.45, 0.16, 0.4, 0.095, 0.005, '#5aa8c8');
      cyl(0.5, 0, 0.15, 0.14, 0.22, '#3a3036', G.cyl8);
      cyl(0.5, 0.22, 0.15, 0.1, 0.03, '#ff6a2a', G.cyl8);
      break;
    }
    case 'scribe': {
      table(0.5, 0.62, 0.32, 0.4, C.wood);
      box(0.05, 0.4, 0.5, 0.34, 0.006, 0.22, '#f7eedb', 0.12);
      box(-0.22, 0.4, 0.45, 0.08, 0.02, 0.12, '#2a2630');
      for (let i = 0; i < 3; i++) cyl(0.22 + i * 0.02, 0.4 + i * 0.05, 0.6, 0.025, 0.2, '#efe3c6', G.cyl6, 0, PI / 2);
      box(0, 0, 0.08 - 0.25, 0.32, 0.18, 0.22, C.woodD);
      break;
    }
    case 'painter': {
      // easel with a half-finished painting, a pot of brushes
      for (const sx of [-1, 1]) box(sx * 0.2, 0, 0.62, 0.035, 1.05, 0.035, C.woodD, 0, -0.12, sx * 0.08);
      box(0, 0, 0.78, 0.035, 0.95, 0.035, C.woodD, 0, 0.3);
      box(0, 0.42, 0.6, 0.5, 0.03, 0.06, C.woodD);
      box(0, 0.46, 0.62, 0.48, 0.42, 0.02, '#f7eedb', 0, -0.12);
      const blobs = [accent, '#4fb8e0', '#ffd34d', '#5fbf6a', '#ff5f7e'];
      for (let i = 0; i < 6; i++) b.add(G.sphL, blobs[i % blobs.length], f.mat(-0.16 + r() * 0.32, 0.55 + r() * 0.28, 0.6, 0, 0.05 + r() * 0.05, 0.035 + r() * 0.04, 0.012));
      box(0, 0.56, 0.605, 0.4, 0.02, 0.01, '#3f7a8c', 0, -0.12);
      cyl(-0.42, 0, 0.35, 0.07, 0.14, '#7a4a3a');
      for (let i = 0; i < 3; i++) box(-0.42 + (i - 1) * 0.025, 0.12, 0.35, 0.01, 0.16, 0.01, C.woodD, 0, 0, (i - 1) * 0.2);
      break;
    }
    case 'bard': {
      // music stand with a score and a low stool
      box(0, 0, 0.55, 0.03, 0.62, 0.03, C.woodD);
      box(0, 0.6, 0.55, 0.38, 0.26, 0.02, C.wood, 0, -0.35);
      box(0, 0.62, 0.545, 0.32, 0.2, 0.01, '#f7eedb', 0, -0.35);
      cyl(0, 0, 0.55, 0.12, 0.02, C.woodD);
      cyl(-0.5, 0, 0.2, 0.15, 0.26, '#7a3a28');
      break;
    }
    case 'herald': {
      // big barrel drum on a frame, facing the herald
      for (const sx of [-1, 1]) box(sx * 0.36, 0, 0.6, 0.05, 0.85, 0.05, C.col);
      box(0, 0.8, 0.6, 0.8, 0.05, 0.06, C.col);
      cyl(0, 0.27, 0.6, 0.3, 0.32, '#a2342a', G.cyl16, PI / 2);
      for (const dz of [-0.17, 0.17]) cyl(0, 0.27, 0.6 + dz, 0.31, 0.03, C.gold, G.cyl16, PI / 2);
      b.add(G.cyl16, '#e8d9b0', f.mat(0, 0.57, 0.43, 0, 0.27, 0.01, 0.27, PI / 2));
      break;
    }
    case 'archivist': {
      // scroll shelf beside the archivist and a reading lectern
      const sx = 0.48;
      box(sx, 0, 0.42, 0.5, 0.06, 0.26, C.woodD);
      for (const ex of [-0.23, 0.23]) box(sx + ex, 0, 0.42, 0.04, 1.0, 0.26, C.woodD);
      for (let s = 0; s < 3; s++) {
        box(sx, 0.32 + s * 0.3, 0.42, 0.5, 0.03, 0.26, C.wood);
        for (let i = 0; i < 5; i++) cyl(sx - 0.18 + i * 0.09, 0.36 + s * 0.3, 0.42, 0.035, 0.22, i % 2 ? '#efe3c6' : '#e2cf9e', G.cyl6, PI / 2);
      }
      box(-0.12, 0, 0.55, 0.05, 0.5, 0.05, C.woodD);
      box(-0.12, 0.5, 0.55, 0.3, 0.03, 0.22, C.wood, 0, -0.4);
      break;
    }
    case 'merchant': {
      // stall counter with goods, an awning post and coin trays
      table(0.55, 0.9, 0.36, 0.42, '#8a6446');
      box(0, 0.42, 0.55, 0.92, 0.012, 0.38, accent);
      for (let i = 0; i < 4; i++) cyl(-0.32 + i * 0.2, 0.43, 0.6, 0.07, 0.08, ['#b88d4a', '#c9a14a', '#8a5a34', '#b0603a'][i]);
      for (let i = 0; i < 5; i++) b.add(G.sphL, i % 2 ? '#e08a3a' : '#8ab85a', f.mat(-0.3 + i * 0.13, 0.53, 0.48, 0, 0.05, 0.05, 0.05));
      for (const sx of [-1, 1]) box(sx * 0.45, 0, 0.72, 0.04, 1.3, 0.04, C.woodD);
      box(0, 1.3, 0.62, 1.0, 0.03, 0.4, accent, 0, 0.25);
      break;
    }
    case 'steward': {
      // counting table: coin stacks, an abacus and an open ledger; a strongbox
      table(0.5, 0.7, 0.34, 0.4, C.body3);
      for (let i = 0; i < 4; i++) cyl(-0.25 + i * 0.06, 0.4, 0.58, 0.035, 0.03 + i * 0.03, C.gold, G.cyl8);
      box(0.08, 0.4, 0.46, 0.3, 0.01, 0.2, '#f7eedb', 0.1);
      box(0.08, 0.402, 0.46, 0.008, 0.012, 0.2, '#3a2a26', 0.1);
      box(0.25, 0.4, 0.6, 0.2, 0.08, 0.02, '#6b3f26', 0, -0.4);
      box(-0.55, 0, 0.3, 0.3, 0.22, 0.22, '#5a3e34');
      box(-0.55, 0.22, 0.3, 0.32, 0.04, 0.24, C.goldD);
      break;
    }
    case 'magistrate': {
      // judge's bench with a red cloth, seal box and gavel block
      table(0.52, 0.8, 0.34, 0.46, C.colD);
      box(0, 0.12, 0.69, 0.8, 0.32, 0.012, '#a2342a');
      box(0, 0.46, 0.52, 0.82, 0.012, 0.36, '#a2342a');
      box(-0.22, 0.46, 0.5, 0.12, 0.08, 0.1, C.gold);
      box(0.2, 0.46, 0.55, 0.14, 0.05, 0.06, '#2a2630');
      for (let i = 0; i < 3; i++) cyl(0.05 + i * 0.05, 0.46, 0.42, 0.012, 0.18, C.woodD, G.cyl6);
      break;
    }
    case 'vizier':
    default: {
      // lectern with an imperial scroll, flanked by a small incense stand
      box(0, 0, 0.55, 0.08, 0.6, 0.08, C.col);
      box(0, 0.6, 0.55, 0.42, 0.04, 0.3, C.colD, 0, -0.35);
      cyl(0, 0.66, 0.5, 0.04, 0.4, '#f7eedb', G.cyl8, 0, PI / 2);
      for (const sx of [-1, 1]) cyl(sx * 0.21, 0.66, 0.5, 0.05, 0.03, C.gold, G.cyl8, 0, PI / 2);
      cyl(0.5, 0, 0.2, 0.08, 0.3, C.bronze);
      cyl(0.5, 0.3, 0.2, 0.12, 0.08, C.goldD);
      break;
    }
  }
}

// Guild notice board (duties are posted here).
function noticeBoard(b: Batch, f: Frame, accent: string, r: () => number) {
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, c: string, rz = 0) => b.add(G.box, c, f.mat(x, y + h / 2, z, 0, w, h, d, 0, rz));
  for (const sx of [-1, 1]) box(sx * 0.5, 0, 0, 0.07, 1.25, 0.07, C.col);
  box(0, 0.45, 0, 0.92, 0.66, 0.05, C.wood);
  box(0, 1.2, 0, 1.25, 0.06, 0.3, C.roof);
  b.add(G.cone4, C.roof, f.mat(0, 1.33, 0, PI / 4, 0.78, 0.18, 0.26));
  box(0, 1.12, 0.03, 1.0, 0.07, 0.02, accent);
  for (let i = 0; i < 4; i++) {
    const x = -0.3 + i * 0.2 + (r() - 0.5) * 0.05;
    box(x, 0.55 + (i % 2) * 0.14, 0.03, 0.16, 0.22, 0.008, i === 2 ? '#f3e6c4' : '#f7eedb', (r() - 0.5) * 0.15);
    box(x, 0.74 + (i % 2) * 0.14, 0.04, 0.03, 0.03, 0.01, '#c0392b');
  }
}

// ---------- pooled DOM labels: name pill + speech bubble ----------
interface Label {
  el: HTMLButtonElement;
  name: HTMLSpanElement;
  bubble: HTMLSpanElement;
  txt: HTMLSpanElement;
  key: string;
  shown: boolean;
  pill: boolean;
  talk: boolean;
}

export class Heroes {
  group = new THREE.Group();
  selected: string | null = null;
  private list: Hero[] = [];
  private byId = new Map<string, Hero>();
  private work = new Map<string, Spot>(); // `${province}:${slot}`
  private post = new Map<ProvinceId, Spot>();
  private homes = new Map<ProvinceId, number[]>();
  private parts: { body: Part; arm: Part; leg: Part; shadow: Part; head: Part[]; hats: (Part | null)[]; props: (Part | null)[]; accs: (Part | null)[] };
  private all: Part[] = [];
  private mats: THREE.Material[] = [];
  private ring: THREE.InstancedMesh;
  private ringTex: THREE.CanvasTexture;
  private sparks: THREE.Points;
  private sparkMat: THREE.ShaderMaterial;
  private sparkPos: THREE.BufferAttribute;
  private furniture: THREE.Mesh | null = null;
  private labels = new Map<string, Label>();
  private layer: HTMLElement | null = null;
  private r = rng(97);
  private time = 0;
  onPick?: (id: string) => void;

  constructor(
    private graph: WalkGraph,
    private ground: (x: number, z: number) => number,
    solid: THREE.Material,
    look?: Look,
  ) {
    const P = figureParts();
    const mat = figureMaterial(look);
    const shMat = new THREE.MeshBasicMaterial({ map: softDot(), color: '#1c1408', transparent: true, opacity: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.mats.push(mat, shMat);
    const mk = (g: THREE.BufferGeometry | undefined, n = MAX) => {
      if (!g) return null;
      const p = new Part(g, mat, n);
      p.im.castShadow = false;
      this.group.add(p.im);
      this.all.push(p);
      return p;
    };
    const shadow = new Part(P.shadow, shMat, MAX, false);
    shadow.im.renderOrder = 2;
    this.group.add(shadow.im);
    this.all.push(shadow);
    this.parts = {
      body: mk(P.body)!,
      arm: mk(P.arm, MAX * 2)!,
      leg: mk(P.leg, MAX * 2)!,
      shadow,
      head: [mk(P.head.m)!, mk(P.head.f)!],
      hats: HATS.map((h) => mk(P.hat[h])),
      props: PROPS.map((p) => mk(P.prop[p])),
      accs: ACCS.map((a) => mk(P.acc[a])),
    };

    // status ring on the ground (instanced, additive)
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(64, 64, 18, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,0)');
    grd.addColorStop(0.55, 'rgba(255,255,255,0.12)');
    grd.addColorStop(0.78, 'rgba(255,255,255,1)');
    grd.addColorStop(0.88, 'rgba(255,255,255,0.5)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    this.ringTex = new THREE.CanvasTexture(c);
    const rg = new THREE.PlaneGeometry(1, 1);
    rg.rotateX(-PI / 2);
    const rm = new THREE.MeshBasicMaterial({ map: this.ringTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    this.mats.push(rm);
    this.ring = new THREE.InstancedMesh(rg, rm, MAX);
    this.ring.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.ring.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.ring.frustumCulled = false;
    this.ring.renderOrder = 3;
    this.ring.count = 0;
    this.group.add(this.ring);

    // tool sparks / golden motes over working agents (GPU animated)
    const PER = 10;
    const n = MAX * PER;
    const pos = new Float32Array(n * 3).fill(-999);
    const ph = new Float32Array(n);
    const kind = new Float32Array(n);
    for (let i = 0; i < n; i++) ph[i] = (i % PER) / PER + Math.floor(i / PER) * 0.173;
    const sg = new THREE.BufferGeometry();
    this.sparkPos = new THREE.BufferAttribute(pos, 3);
    this.sparkPos.setUsage(THREE.DynamicDrawUsage);
    sg.setAttribute('position', this.sparkPos);
    sg.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    sg.setAttribute('aKind', new THREE.BufferAttribute(kind, 1).setUsage(THREE.DynamicDrawUsage));
    sg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
    this.sparkMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPpu: { value: 30 } },
      vertexShader: /* glsl */ `
uniform float uTime;
uniform float uPpu;
attribute float aPhase;
attribute float aKind;
varying float vA;
varying float vK;
float h1(float n) { return fract(sin(n * 91.345) * 47453.13); }
void main() {
  float rate = aKind > 1.5 ? 1.15 : 0.45;
  float life = fract(uTime * rate + aPhase);
  float id = floor(uTime * rate + aPhase) + aPhase * 37.0;
  float a = h1(id) * 6.2831;
  float sp = 0.35 + h1(id + 3.1) * 0.5;
  vec3 p = position;
  if (aKind > 1.5) {
    // hammer sparks: burst outward, fall with gravity
    p += vec3(cos(a) * sp * life * 1.2, life * 1.1 - life * life * 1.6, sin(a) * sp * life * 1.2);
    vA = (1.0 - life) * step(position.y, 900.0);
  } else {
    // golden motes rising from the work
    p += vec3(cos(a) * 0.18 * life + sin(uTime * 2.0 + a) * 0.05, life * 1.1, sin(a) * 0.18 * life);
    vA = smoothstep(0.0, 0.15, life) * (1.0 - smoothstep(0.65, 1.0, life)) * step(position.y, 900.0);
  }
  vK = aKind;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = (aKind > 1.5 ? 0.11 : 0.13) * uPpu * (1.0 - life * 0.4) + 1.5;
}`,
      fragmentShader: /* glsl */ `
varying float vA;
varying float vK;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = pow(max(0.0, 1.0 - d), 1.6) * vA;
  if (a < 0.02) discard;
  vec3 c = vK > 1.5 ? vec3(1.0, 0.62, 0.22) : vec3(1.0, 0.86, 0.45);
  gl_FragColor = vec4(c * a * 1.4, a);
}`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mats.push(this.sparkMat);
    this.sparks = new THREE.Points(sg, this.sparkMat);
    this.sparks.frustumCulled = false;
    this.sparks.renderOrder = 4;
    this.group.add(this.sparks);

    this.planSpots(solid);
  }

  // Work spots: one per (guild, slot) on the guild's open plaza spots, with the
  // role's workshop furniture; one notice board per guild.
  private planSpots(solid: THREE.Material) {
    const { nodes, adj, homes } = this.graph;
    const b = new Batch();
    const r = rng(4242);
    for (const id of Object.keys(SITE) as ProvinceId[]) {
      const hs = (homes[id] ?? []).filter((i) => adj[i]?.length);
      this.homes.set(id, hs);
      if (!hs.length) continue;
      const p = PROVINCE[id];
      const site = SITE[id];
      const slots = id === 'throne' ? 2 : Math.min(4, Math.max(1, hs.length - 1));
      for (let s = 0; s < slots; s++) {
        let node = hs[s];
        let n = nodes[node];
        // face the viewer, turned a little towards the settlement centre
        const toC = Math.atan2(site.x - n.x, site.z - n.z);
        let face = (s % 2 ? 0.45 : -0.45) + Math.sign(Math.sin(toC)) * 0.2;
        if (id === 'throne') {
          // the Vizier works up on the palace terrace, before the great hall
          // (an extra spot outside the citizens' road graph: reached on foot
          // in a straight line from the gate)
          face = s % 2 ? 0.35 : -0.35;
          const tf = Frame.at(site.x, site.h, site.z, site.ry);
          const v = tf.pt((s % 2 ? 1 : -1) * (1.7 + Math.floor(s / 2) * 1.6), 0.53, 4.1);
          nodes.push(v);
          adj.push([]);
          node = nodes.length - 1;
          let best = hs[0];
          for (const h of hs) if (nodes[h].distanceTo(v) < nodes[best].distanceTo(v)) best = h;
          this.entry.set(node, best);
          n = v;
        }
        this.work.set(`${id}:${s}`, { node, face });
        const y = id === 'throne' ? n.y : this.ground(n.x, n.z) - 0.01;
        workshop(b, new Frame(M(n.x, y, n.z, face, FURN, FURN, FURN)), p.role, p.color, r);
      }
      // notice board beside the last open spot, its face turned to the viewer
      // and the reader; the agent pins the duty result, then reads it out
      const pn = hs[hs.length - 1];
      const q = nodes[pn];
      const bx = q.x + 0.85;
      const bz = q.z - 0.15;
      this.post.set(id, { node: pn, face: Math.atan2(0.85, -0.15) });
      noticeBoard(b, new Frame(M(bx, this.ground(bx, bz) - 0.02, bz, -0.5, FURN, FURN, FURN)), p.color, r);
    }
    const m = b.build(solid);
    if (m) {
      m.castShadow = true;
      m.receiveShadow = true;
      this.furniture = m;
      this.group.add(m);
    }
  }

  // ---------- data ----------
  set(agents: LiveAgent[]) {
    const seen = new Set<string>();
    const per = new Map<ProvinceId, number>();
    const sorted = [...agents].sort((a, b) => (a.id < b.id ? -1 : 1));
    for (const a of sorted.slice(0, MAX)) {
      if (!SITE[a.province]) continue;
      seen.add(a.id);
      const slot = per.get(a.province) ?? 0;
      per.set(a.province, slot + 1);
      let h = this.byId.get(a.id);
      if (!h) {
        h = this.spawn(a, slot);
        this.byId.set(a.id, h);
        this.list.push(h);
      }
      const changed = h.state !== a.state || h.a.province !== a.province || h.a.task !== a.task;
      h.slot = slot;
      if (h.a.role !== a.role || h.a.look !== a.look || h.a.color !== a.color) this.dress(h, a);
      h.a = a;
      if (changed) {
        h.state = a.state;
        h.replan = true;
      }
    }
    for (const h of [...this.list])
      if (!seen.has(h.a.id)) {
        this.byId.delete(h.a.id);
        this.list.splice(this.list.indexOf(h), 1);
        const l = this.labels.get(h.a.id);
        if (l) {
          l.el.remove();
          this.labels.delete(h.a.id);
        }
      }
  }

  private dress(h: Hero, a: LiveAgent) {
    const role = (ROLE_COSTUME[a.role] ? a.role : 'scribe') as Role;
    const c = ROLE_COSTUME[role];
    const lk = ((a.look % 4) + 4) % 4;
    h.hair = FEM[role].includes(lk) ? 1 : 0;
    h.hat = HATS.indexOf(c.hat);
    h.prop = PROPS.indexOf(c.prop);
    h.acc = ACCS.indexOf(c.acc);
    h.robe = mix(c.robe ?? '#8a7a5a', a.color, LOOK_MIX[lk]);
    h.accent = new THREE.Color(a.color);
  }

  private spawn(a: LiveAgent, slot: number): Hero {
    const seed = hashStr(a.id);
    const hs = this.homes.get(a.province) ?? [];
    const node = hs.length ? hs[seed % hs.length] : -1;
    const site = SITE[a.province];
    const n = node >= 0 ? this.graph.nodes[node] : new THREE.Vector3(site.x, site.h, site.z);
    const h: Hero = {
      a,
      state: a.state,
      slot,
      hair: 0,
      hat: 0,
      prop: 0,
      acc: 0,
      robe: new THREE.Color(),
      accent: new THREE.Color(),
      x: n.x + ((seed % 7) - 3) * 0.12,
      y: n.y,
      z: n.z + ((seed % 5) - 2) * 0.12,
      h: ((seed % 628) / 100) - PI,
      ph: (seed % 100) / 10,
      seed: (seed % 1000) / 10,
      node,
      to: -1,
      path: [],
      t: 0,
      len: 1,
      mode: 'idle',
      timer: 1 + (seed % 40) / 10,
      act: 'look',
      goal: node,
      face: 0,
      replan: true,
      vis: false,
      sx: -1e4,
      sy: -1e4,
    };
    this.dress(h, a);
    return h;
  }

  // ---------- behaviour ----------
  private bfs(from: number, to: number): number[] | null {
    if (from < 0 || to < 0) return null;
    if (from === to) return [];
    const { adj } = this.graph;
    const prev = new Map<number, number>([[from, -1]]);
    const q = [from];
    for (let qi = 0; qi < q.length && qi < 4000; qi++) {
      const u = q[qi];
      for (const v of adj[u]) {
        if (prev.has(v)) continue;
        prev.set(v, u);
        if (v === to) {
          const out: number[] = [];
          for (let c = to; c !== from; c = prev.get(c)!) out.push(c);
          return out.reverse();
        }
        q.push(v);
      }
    }
    return null;
  }

  private walkTo(h: Hero, goal: number) {
    h.goal = goal;
    // extra spots off the road graph are reached through their entry node
    const fromE = this.entry.get(h.node);
    const toE = this.entry.get(goal);
    let path: number[] | null;
    if (h.node === goal) path = [];
    else {
      const a = fromE ?? h.node;
      const b = toE ?? goal;
      const mid = a === b ? [] : this.bfs(a, b);
      path = mid ? [...(fromE !== undefined ? [a] : []), ...mid, ...(toE !== undefined ? [goal] : [])] : null;
      if (path && fromE !== undefined && toE !== undefined && a === b && fromE === toE) path = [a, goal];
    }
    h.mode = 'walk';
    if (path && path.length) {
      h.path = path;
      this.nextSeg(h);
    } else {
      // no road (or already there): step straight onto the spot
      h.path = [];
      h.to = goal;
      const g = this.graph.nodes[goal];
      h.t = 0;
      h.len = Math.max(0.01, Math.hypot(g.x - h.x, g.z - h.z));
      this.segFrom.set(h.a.id, [h.x, h.y, h.z]);
    }
  }
  private segFrom = new Map<string, [number, number, number]>();
  private entry = new Map<number, number>();
  private nextSeg(h: Hero) {
    const to = h.path.shift()!;
    h.to = to;
    h.t = 0;
    const g = this.graph.nodes[to];
    h.len = Math.max(0.01, Math.hypot(g.x - h.x, g.z - h.z));
    this.segFrom.set(h.a.id, [h.x, h.y, h.z]);
  }

  private think(h: Hero) {
    h.replan = false;
    const hs = this.homes.get(h.a.province) ?? [];
    if (!hs.length) {
      h.mode = h.state === 'working' ? 'work' : 'idle';
      h.timer = 5;
      return;
    }
    if (h.state === 'working') {
      const spot = this.work.get(`${h.a.province}:${h.slot % this.slots(h.a.province)}`) ?? this.work.get(`${h.a.province}:0`);
      if (!spot) return;
      h.face = spot.face;
      if (h.node === spot.node && h.mode !== 'walk' && this.near(h, spot.node)) h.mode = 'work';
      else this.walkTo(h, spot.node);
      return;
    }
    if (h.state === 'duty') {
      const spot = this.post.get(h.a.province);
      if (!spot) return;
      h.face = spot.face;
      if (h.node === spot.node && h.mode !== 'walk' && this.near(h, spot.node)) {
        h.mode = 'post';
        h.timer = 3.5;
      } else this.walkTo(h, spot.node);
      return;
    }
    // idle: stroll to another open spot of the guild
    const r = this.r;
    let goal = hs[Math.floor(r() * hs.length)];
    if (goal === h.node && hs.length > 1) goal = hs[(hs.indexOf(goal) + 1) % hs.length];
    this.walkTo(h, goal);
  }
  private slots(id: ProvinceId) {
    let n = 0;
    while (this.work.has(`${id}:${n}`)) n++;
    return Math.max(1, n);
  }
  private near(h: Hero, node: number) {
    const n = this.graph.nodes[node];
    return Math.hypot(n.x - h.x, n.z - h.z) < 0.05;
  }

  private arrive(h: Hero) {
    h.node = h.goal;
    if (h.replan) return this.think(h);
    const r = this.r;
    if (h.state === 'working') h.mode = 'work';
    else if (h.state === 'duty') {
      h.mode = 'post';
      h.timer = 3.5;
    } else {
      h.mode = 'idle';
      h.timer = 4 + r() * 7;
      const acts: IdleAct[] = ['look', 'look', 'stretch', 'tidy', 'bow', 'tool'];
      h.act = acts[Math.floor(r() * acts.length)];
      h.face = h.h + (r() - 0.5) * 1.2;
    }
  }

  private step(h: Hero, dt: number) {
    if (h.replan && h.mode !== 'walk') this.think(h);
    if (h.mode === 'walk') {
      const speed = h.state === 'working' ? 1.35 : h.state === 'duty' ? 1.1 : 0.75;
      const g = this.graph.nodes[h.to];
      if (!g) {
        h.mode = 'idle';
        return;
      }
      const f = this.segFrom.get(h.a.id) ?? [h.x, h.y, h.z];
      h.t = Math.min(1, h.t + (speed * dt) / h.len);
      h.x = f[0] + (g.x - f[0]) * h.t;
      h.z = f[2] + (g.z - f[2]) * h.t;
      h.y = Math.max(f[1] + (g.y - f[1]) * h.t, this.ground(h.x, h.z));
      h.ph += speed * dt * 7.5;
      const dx = g.x - f[0];
      const dz = g.z - f[2];
      if (dx * dx + dz * dz > 1e-4) this.turn(h, Math.atan2(dx, dz), dt * 7);
      if (h.t >= 1) {
        h.node = h.to;
        if (h.replan) {
          this.think(h);
          return;
        }
        if (h.path.length) this.nextSeg(h);
        else this.arrive(h);
      }
      return;
    }
    // standing: turn towards the work direction
    this.turn(h, h.face, dt * 4);
    if (h.mode === 'idle') {
      h.timer -= dt;
      if (h.timer <= 0) this.think(h);
    } else if (h.mode === 'post') {
      h.timer -= dt;
      if (h.timer <= 0) {
        h.mode = 'read';
        h.face = -0.35;
      }
    }
  }
  private turn(h: Hero, to: number, k: number) {
    let d = to - h.h;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    h.h += d * Math.min(1, k);
  }

  // ---------- poses ----------
  private pose(h: Hero, t: number, o: PoseOut) {
    const s = h.seed;
    const c = t + s;
    o.legA = 0;
    o.armL = 0.03 * Math.sin(t * 1.4 + s);
    o.armR = -o.armL;
    o.armZ = 0.13;
    o.bob = Math.sin(t * 1.6 + s) * 0.004;
    o.roll = 0;
    o.lean = 0;
    o.headYaw = 0;
    o.headPitch = -0.16;
    o.prop = h.prop;
    o.spark = 0;
    const long = h.prop === prop('pennant') || h.prop === prop('spear');
    if (h.mode === 'walk') {
      const sp = Math.sin(h.ph);
      o.legA = sp * 0.62;
      o.armL = -sp * 0.55;
      o.armR = sp * (long ? 0.12 : 0.55);
      o.bob = Math.abs(Math.cos(h.ph)) * 0.032;
      o.roll = sp * 0.05;
      o.lean = h.state === 'working' ? 0.1 : 0.05;
      o.headPitch += Math.sin(h.ph * 2) * 0.03;
      if (h.state === 'duty') {
        o.prop = prop('scroll');
        o.armR = -0.75 + sp * 0.08;
      }
      return;
    }
    if (h.mode === 'post') {
      // pinning the duty notice to the board
      o.prop = prop('scroll');
      o.armR = -2.3 + Math.sin(c * 6) * 0.12;
      o.armL = -2.1 + Math.cos(c * 6) * 0.1;
      o.headPitch -= 0.25;
      o.bob = Math.abs(Math.sin(c * 6)) * 0.008;
      return;
    }
    if (h.mode === 'read') {
      // reading the result aloud, glancing up now and then
      o.prop = prop('scroll');
      o.armR = -1.05;
      o.armL = -1.0;
      o.armZ = 0.05;
      const up = Math.sin(c * 0.5) > 0.6;
      o.headPitch += up ? -0.05 : 0.28;
      o.headYaw = up ? Math.sin(c * 0.9) * 0.4 : 0;
      o.spark = 1;
      return;
    }
    if (h.mode === 'idle') {
      switch (h.act) {
        case 'look':
          o.headYaw = Math.sin(c * 0.6) * 0.7;
          break;
        case 'stretch': {
          const k = Math.max(0, Math.sin(c * 0.7));
          o.armR = -k * 2.7;
          o.armL = -k * 2.7;
          o.armZ = 0.13 + k * 0.2;
          o.headPitch -= k * 0.25;
          o.bob = k * 0.02;
          break;
        }
        case 'tidy':
          o.lean = 0.22;
          o.armR = -0.7 + Math.sin(c * 3.1) * 0.25;
          o.armL = -0.6 + Math.cos(c * 3.1) * 0.2;
          o.headPitch += 0.25;
          break;
        case 'bow': {
          const k = Math.max(0, Math.sin(c * 1.2)) ** 2;
          o.lean = k * 0.45;
          o.armR = -0.35 * k;
          o.armL = -0.35 * k;
          o.headPitch += k * 0.2;
          break;
        }
        case 'tool':
          // turning the role's tool over in the hands
          o.armR = -0.9 + Math.sin(c * 1.3) * 0.15;
          o.armL = -0.6;
          o.headPitch += 0.3;
          o.headYaw = Math.sin(c * 0.4) * 0.2;
          break;
      }
      return;
    }
    // ---- work loops (mode 'work') ----
    const role = h.a.role;
    switch (role) {
      case 'smith': {
        const k = (c * 1.1) % 1;
        o.armR = k < 0.62 ? -0.4 - (k / 0.62) * 2.1 : k < 0.7 ? -2.5 + ((k - 0.62) / 0.08) * 1.6 : -0.9;
        o.armL = -0.75;
        o.lean = 0.2;
        o.headPitch += 0.3;
        o.bob = k > 0.62 && k < 0.74 ? -0.012 : 0;
        o.prop = prop('hammer');
        o.spark = 2;
        break;
      }
      case 'scribe':
      case 'steward': {
        const pause = Math.sin(c * 0.4) > 0.75;
        o.lean = 0.28;
        o.headPitch += pause ? 0.05 : 0.4;
        o.headYaw = pause ? Math.sin(c * 0.8) * 0.3 : 0;
        o.armR = pause ? -0.8 : -1.05 + Math.sin(c * 9) * 0.07;
        o.armZ = pause ? 0.13 : 0.13 + Math.sin(c * 4.5) * 0.08;
        o.armL = -0.95;
        o.prop = prop('brush');
        o.spark = 1;
        break;
      }
      case 'painter': {
        const back = Math.sin(c * 0.33) > 0.7; // steps back to look at the painting
        o.armR = back ? -0.6 : -1.5 + Math.sin(c * 3.2) * 0.3;
        o.armZ = back ? 0.13 : 0.13 + Math.sin(c * 2.1) * 0.15;
        o.armL = -0.55;
        o.roll = back ? Math.sin(c) * 0.08 : 0;
        o.headPitch += back ? -0.05 : 0.1;
        o.prop = prop('brush');
        o.spark = 1;
        break;
      }
      case 'bard': {
        const strum = Math.sin(c * 0.5) > -0.6;
        o.armR = -0.55 + (strum ? Math.sin(c * 13) * 0.16 : 0);
        o.armL = -1.0;
        o.roll = Math.sin(c * 2.2) * 0.06;
        o.bob = Math.abs(Math.sin(c * 2.2)) * 0.018;
        o.headYaw = Math.sin(c * 1.1) * 0.25;
        o.headPitch += 0.08;
        o.prop = P_NONE;
        o.spark = 1;
        break;
      }
      case 'herald': {
        const k = (c * 1.6) % 1;
        const hit = (x: number) => (x < 0.5 ? -1.0 - x * 1.4 : -1.7 + (x - 0.5) * 1.4);
        o.armR = hit(k);
        o.armL = hit((k + 0.5) % 1);
        o.lean = 0.1;
        o.bob = Math.abs(Math.sin(c * 1.6 * PI * 2)) * 0.012;
        o.prop = prop('hammer');
        o.spark = 1;
        break;
      }
      case 'archivist': {
        const reach = Math.sin(c * 0.45) > 0.55;
        o.armR = reach ? -2.4 : -1.0;
        o.armZ = reach ? -0.3 : 0.1;
        o.armL = -0.95;
        o.headYaw = reach ? 0.6 : Math.sin(c * 0.7) * 0.1;
        o.headPitch += reach ? -0.25 : 0.32;
        o.prop = prop('book');
        o.spark = 1;
        break;
      }
      case 'merchant': {
        const call = Math.sin(c * 0.5) > 0.6;
        o.armR = -1.0 + Math.sin(c * 14) * 0.05;
        o.armL = call ? -1.7 + Math.sin(c * 6) * 0.3 : -0.9;
        o.headYaw = call ? Math.sin(c * 0.9) * 0.6 : 0;
        o.headPitch += call ? 0 : 0.3;
        o.prop = prop('abacus');
        o.spark = 1;
        break;
      }
      case 'magistrate': {
        const k = (c * 0.35) % 1;
        const stamp = k > 0.85;
        o.armR = -1.1;
        o.armL = stamp ? -1.9 + ((k - 0.85) / 0.15) * 1.0 : -0.85;
        o.headPitch += 0.3;
        o.bob = stamp && k > 0.95 ? -0.008 : 0;
        o.prop = prop('tablet');
        o.spark = 1;
        break;
      }
      case 'vizier':
      default: {
        const speak = Math.sin(c * 0.4) > 0.3;
        o.armR = speak ? -1.4 + Math.sin(c * 2.4) * 0.35 : -0.95;
        o.armL = -0.8;
        o.headYaw = speak ? Math.sin(c * 0.7) * 0.5 : 0;
        o.headPitch += speak ? 0 : 0.3;
        o.prop = prop('fan');
        o.spark = 1;
        break;
      }
    }
  }

  private write(h: Hero, o: PoseOut) {
    const S = HERO_SCALE;
    const P = this.parts;
    _e.set(o.lean, h.h, o.roll, 'YXZ');
    _q.setFromEuler(_e);
    _B.compose(_p.set(h.x, h.y + o.bob * S, h.z), _q, _s.setScalar(S));
    P.body.push(_B, h.robe, h.accent);
    _H.multiplyMatrices(_B, local(0, NECK_Y, 0, o.headPitch, o.headYaw, 0, 'YXZ'));
    _H.multiply(_M.makeTranslation(0, HEAD_Y, 0));
    P.head[h.hair].push(_H, h.robe, h.accent);
    P.hats[h.hat]?.push(_H, h.robe, h.accent);
    P.accs[h.acc]?.push(_B, h.robe, h.accent);
    _M.makeScale(0.55 * S, 1, 0.55 * S);
    _M.setPosition(h.x, h.y + 0.014, h.z);
    P.shadow.push(_M, SH, SH);
    for (let k = 0; k < 2; k++) {
      const sx = k ? 1 : -1;
      _M.multiplyMatrices(_B, local(sx * SHOULDER.x, SHOULDER.y, SHOULDER.z, k ? o.armR : o.armL, 0, sx * o.armZ, 'XYZ'));
      P.arm.push(_M, h.robe, h.accent);
      if (k) P.props[o.prop]?.push(_M, h.robe, h.accent);
    }
    for (let k = 0; k < 2; k++) {
      const sx = k ? 1 : -1;
      _M.multiplyMatrices(_B, local(sx * HIP.x, HIP.y, 0, k ? -o.legA : o.legA, 0, 0, 'XYZ'));
      P.leg.push(_M, h.robe, h.accent);
    }
  }

  private po: PoseOut = { legA: 0, armL: 0, armR: 0, armZ: 0, bob: 0, roll: 0, lean: 0, headYaw: 0, headPitch: 0, prop: 0, spark: 0 };

  update(dt: number, t: number, cam: THREE.Camera, w: number, hh: number, ppu: number) {
    this.time = t;
    this.sparkMat.uniforms.uTime.value = t;
    this.sparkMat.uniforms.uPpu.value = ppu;
    const sp = this.sparkPos.array as Float32Array;
    const kindA = this.sparks.geometry.getAttribute('aKind') as THREE.BufferAttribute;
    const ka = kindA.array as Float32Array;
    let ri = 0;
    const rc = this.ring.instanceColor!.array as Float32Array;
    for (let i = 0; i < this.list.length; i++) {
      const h = this.list[i];
      this.step(h, dt);
      _v.set(h.x, h.y + 0.75 * HERO_SCALE, h.z).project(cam);
      h.vis = _v.x > -1.1 && _v.x < 1.1 && _v.y > -1.15 && _v.y < 1.2 && _v.z < 1;
      h.sx = (_v.x + 1) * 0.5 * w;
      h.sy = (1 - _v.y) * 0.5 * hh;
      const base = i * 10;
      if (!h.vis) {
        for (let k = 0; k < 10; k++) sp[(base + k) * 3 + 1] = -999;
        continue;
      }
      const o = this.po;
      this.pose(h, t, o);
      this.write(h, o);
      // tool / reading position for sparks (in front of the hero)
      const sh = Math.sin(h.h);
      const ch = Math.cos(h.h);
      const on = o.spark > 0 && (h.mode === 'work' || h.mode === 'read');
      const fx = h.x + sh * 0.5;
      const fz = h.z + ch * 0.5;
      const fy = h.y + (h.a.role === 'smith' ? 0.45 : h.mode === 'read' ? 0.7 : 0.55);
      for (let k = 0; k < 10; k++) {
        const j = (base + k) * 3;
        // motes: only a few per hero; smith: all ten as sparks
        const use = on && (o.spark === 2 || k < 5);
        sp[j] = fx;
        sp[j + 1] = use ? fy : -999;
        sp[j + 2] = fz;
        ka[base + k] = o.spark;
      }
      // status ring
      const sel = this.selected === h.a.id;
      const pulse = 0.5 + 0.5 * Math.sin(t * 3 + h.seed);
      let sc = 1.25;
      if (h.state === 'working') {
        _c.set('#ffc94d').multiplyScalar(0.75 + pulse * 0.35);
        sc = 1.35 + pulse * 0.12;
      } else if (h.state === 'duty') _c.set('#f3dfa2').multiplyScalar(0.55);
      else _c.copy(h.accent).multiplyScalar(0.32);
      if (sel) {
        _c.set('#fff1c4').multiplyScalar(0.9 + pulse * 0.3);
        sc = 1.6;
      }
      _M.makeScale(sc, 1, sc);
      _M.setPosition(h.x, h.y + 0.02, h.z);
      this.ring.setMatrixAt(ri, _M);
      _c.toArray(rc, ri * 3);
      ri++;
    }
    for (let i = this.list.length; i < MAX; i++) for (let k = 0; k < 10; k++) sp[(i * 10 + k) * 3 + 1] = -999;
    this.sparkPos.needsUpdate = true;
    kindA.needsUpdate = true;
    this.ring.count = ri;
    this.ring.instanceMatrix.needsUpdate = true;
    this.ring.instanceColor!.needsUpdate = true;
    for (const p of this.all) {
      p.end();
      p.im.visible = p.im.count > 0;
    }
  }

  // ---------- picking ----------
  // Agent under a screen point (px), nearest within a radius that grows with zoom.
  pick(x: number, y: number, ppu: number): string | null {
    const R = Math.max(14, ppu * 0.9);
    let best: string | null = null;
    let bd = R * R;
    for (const h of this.list) {
      if (!h.vis) continue;
      const dx = h.sx - x;
      const dy = h.sy - y;
      const d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = h.a.id;
      }
    }
    return best;
  }
  position(id: string): THREE.Vector3 | null {
    const h = this.byId.get(id);
    return h ? new THREE.Vector3(h.x, h.y, h.z) : null;
  }
  has(id: string) {
    return this.byId.has(id);
  }

  // ---------- DOM labels ----------
  setLayer(el: HTMLElement | null) {
    if (this.layer === el) return;
    for (const l of this.labels.values()) l.el.remove();
    this.labels.clear();
    this.layer = el;
  }
  private label(h: Hero): Label {
    let l = this.labels.get(h.a.id);
    if (l) return l;
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'realm-agent';
    const bubble = document.createElement('span');
    bubble.className = 'realm-agent-bubble';
    const txt = document.createElement('span');
    bubble.appendChild(txt);
    const pill = document.createElement('span');
    pill.className = 'realm-agent-pill';
    const dot = document.createElement('i');
    const name = document.createElement('span');
    name.className = 'realm-agent-name';
    pill.append(dot, name);
    el.append(bubble, pill);
    const id = h.a.id;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onPick?.(id);
    });
    el.style.visibility = 'hidden';
    this.layer!.appendChild(el);
    l = { el, name, bubble, txt, key: '', shown: false, pill: false, talk: false };
    this.labels.set(id, l);
    return l;
  }

  // Busy agents always show their name; everyone does when zoomed in. Speech
  // bubbles (real task text) only when close enough to read, or when selected.
  layout(ppu: number, w: number, hh: number) {
    if (!this.layer) return;
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
    const order = this.list
      .filter((h) => h.vis)
      .sort((a, b) => this.prio(b) - this.prio(a) || b.sy - a.sy);
    const lift = Math.max(4, ppu * 0.22);
    for (const h of this.list) if (!h.vis) this.hide(h);
    for (const h of order) {
      const busy = h.state !== 'idle';
      const sel = this.selected === h.a.id;
      const showPill = h.vis && (sel || busy || ppu >= 20);
      const talk = showPill && !!h.a.task && busy && (sel || ppu >= 30);
      const l = this.labels.get(h.a.id) ?? (showPill ? this.label(h) : null);
      if (!l) continue;
      const inView = h.sx > -160 && h.sx < w + 160 && h.sy > -80 && h.sy < hh + 120;
      const on = showPill && inView;
      if (on !== l.shown) {
        l.el.style.visibility = on ? 'visible' : 'hidden';
        l.shown = on;
      }
      if (!on) continue;
      const key = `${h.a.name}|${h.state}|${h.a.task ?? ''}|${sel ? 1 : 0}|${talk ? 1 : 0}|${ppu < 20 ? 1 : 0}|${h.a.color}`;
      if (key !== l.key) {
        l.key = key;
        l.name.textContent = h.a.name;
        l.txt.textContent = talk ? h.a.task! : '';
        l.el.dataset.state = h.state;
        l.el.classList.toggle('is-sel', sel);
        l.el.classList.toggle('is-talk', talk);
        l.el.classList.toggle('is-far', ppu < 20 && !sel);
        l.el.style.setProperty('--accent', h.a.color);
        l.el.setAttribute('aria-label', `${h.a.name}, ${h.state === 'working' ? 'working on a decree' : h.state === 'duty' ? 'royal duty' : 'idle'}`);
      }
      // anchor above the head; nudge up past labels already placed nearby
      const far = ppu < 20 && !sel;
      const pw = h.a.name.length * (far ? 6 : 6.8) + (far ? 22 : 28);
      const tw = talk ? Math.min(222, h.a.task!.length * 6.3 + 22) : 0;
      const bw = Math.max(pw, tw);
      const bh = (far ? 17 : 20) + (talk ? (h.a.task!.length * 6.3 > 200 ? 50 : 34) : 0);
      let y = h.sy - lift;
      for (let k = 0; k < 6; k++) {
        const hit = placed.find((r) => h.sx - bw / 2 < r.x1 && h.sx + bw / 2 > r.x0 && y - bh < r.y1 && y > r.y0);
        if (!hit) break;
        y = hit.y0 - 2;
      }
      placed.push({ x0: h.sx - bw / 2, x1: h.sx + bw / 2, y0: y - bh, y1: y });
      l.el.style.transform = `translate(${h.sx.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    }
  }
  private prio(h: Hero) {
    return (this.selected === h.a.id ? 4 : 0) + (h.state === 'working' ? 2 : h.state === 'duty' ? 1 : 0);
  }
  private hide(h: Hero) {
    const l = this.labels.get(h.a.id);
    if (l && l.shown) {
      l.el.style.visibility = 'hidden';
      l.shown = false;
    }
  }

  dispose() {
    for (const l of this.labels.values()) l.el.remove();
    this.labels.clear();
    this.all.forEach((p) => p.dispose());
    this.mats.forEach((m) => m.dispose());
    this.ring.geometry.dispose();
    this.ring.dispose();
    this.ringTex.dispose();
    this.sparks.geometry.dispose();
    this.furniture?.geometry.dispose();
  }
}
