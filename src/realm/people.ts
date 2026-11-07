// Citizens of the realm: chibi figures assembled from instanced body parts
// (body, head, hat, sleeves, legs, prop, accessory, blob shadow). Every frame
// each visible citizen writes its part matrices: a real walk cycle (stepping
// legs, swinging sleeves, sway and head bob), idle looks, chats, sweeping,
// hammering, guards at attention, groups walking together, porters with
// shoulder poles. Off-screen citizens keep moving but are not drawn; when
// zoomed out the small parts (limbs, props) are skipped.
import * as THREE from 'three';
import { PROVINCES, type ProvinceId, type Role } from '../../shared/realm';
import { rng } from './kit';
import { softDot } from './tex';
import { enhance, type Look } from './look';
import {
  ACCENTS,
  ACCS,
  GUARD,
  HATS,
  HEAD_Y,
  HIP,
  NECK_Y,
  PROPS,
  ROBES,
  ROLE_COSTUME,
  SHOULDER,
  figureParts,
  type AccKind,
  type Costume,
  type HatKind,
  type PropKind,
} from './figures';

export interface WalkGraph {
  nodes: THREE.Vector3[];
  adj: number[][];
  homes: Partial<Record<ProvinceId, number[]>>;
  ring: number[];
}

export type Act = 'guard' | 'vendor' | 'sweep' | 'hammer' | 'chat' | 'fish' | 'perform' | 'watch';
export interface Station {
  x: number;
  z: number;
  y?: number;
  ry: number;
  act: Act;
  role?: Role;
  costume?: Costume;
  accent?: string;
}

interface W {
  hair: 0 | 1;
  hat: number;
  prop: number;
  acc: number;
  robe: THREE.Color;
  accent: THREE.Color;
  kind: 0 | 1 | 2; // road, station, follower
  // road
  from: number;
  to: number;
  t: number;
  len: number;
  speed: number;
  off: number;
  pause: number;
  look: number;
  // station
  st: Station | null;
  // follower
  lead: W | null;
  back: number;
  side: number;
  // pose state
  x: number;
  y: number;
  z: number;
  h: number;
  ph: number;
  seed: number;
  moving: boolean;
  headYaw: number;
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
const ONE = new THREE.Vector3(1, 1, 1);
const SH_COL = new THREE.Color(0, 0, 0);

function local(x: number, y: number, z: number, rx: number, ry: number, rz: number, order: THREE.EulerOrder) {
  _e.set(rx, ry, rz, order);
  _q.setFromEuler(_e);
  return _L.compose(_p.set(x, y, z), _q, ONE);
}

// One instanced part with per-instance robe colour (instanceColor) and accent colour (aAcc).
export class Part {
  im: THREE.InstancedMesh;
  private accA: THREE.InstancedBufferAttribute;
  n = 0;
  constructor(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    private cap: number,
    shadow = true,
  ) {
    const g = geo.clone();
    this.accA = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.accA.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aAcc', this.accA);
    this.im = new THREE.InstancedMesh(g, mat, cap);
    this.im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    this.im.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.im.frustumCulled = false;
    this.im.castShadow = false;
    this.im.receiveShadow = shadow;
    this.im.count = 0;
  }
  push(m: THREE.Matrix4, robe: THREE.Color, acc: THREE.Color) {
    if (this.n >= this.cap) return;
    m.toArray(this.im.instanceMatrix.array as Float32Array, this.n * 16);
    robe.toArray(this.im.instanceColor!.array as Float32Array, this.n * 3);
    acc.toArray(this.accA.array as Float32Array, this.n * 3);
    this.n++;
  }
  end() {
    this.im.count = this.n;
    if (this.n) {
      this.im.instanceMatrix.needsUpdate = true;
      this.im.instanceColor!.needsUpdate = true;
      this.accA.needsUpdate = true;
    }
    this.n = 0;
  }
  dispose() {
    this.im.geometry.dispose();
    this.im.dispose();
  }
}

// Lambert with two tint channels driven by the `fx` vertex code.
export function figureMaterial(look?: Look) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  if (look) enhance(m, look, { cloud: true, grade: true, lamp: true });
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float fx;\nattribute vec3 aAcc;')
      .replace(
        '#include <color_vertex>',
        /* glsl */ `
vColor = vec3(1.0);
#ifdef USE_COLOR
vColor *= color;
#endif
#ifdef USE_INSTANCING_COLOR
float tm1 = step(0.5, fx) * step(fx, 1.5);
float tm2 = step(1.5, fx);
vColor *= mix(vec3(1.0), instanceColor, tm1) * mix(vec3(1.0), aAcc, tm2);
#endif
`,
      );
  };
  const key = m.customProgramCacheKey();
  m.customProgramCacheKey = () => 'figure:' + key;
  return m;
}

export interface WalkersOpt {
  ground?: (x: number, z: number) => number;
  look?: Look;
  ambient?: number;
}

const FIG_SCALE = 1.35;

export class Walkers {
  group = new THREE.Group();
  private list: W[] = [];
  private stations: W[] = [];
  private mats: THREE.Material[] = [];
  private r = rng(7);
  private body: Part;
  private arm: Part;
  private leg: Part;
  private shadow: Part;
  private head: Part[];
  private headLo: Part[];
  private bodyLo: Part;
  private hats: (Part | null)[];
  private props: (Part | null)[];
  private accs: (Part | null)[];
  private cam: THREE.Camera | null = null;
  private detail = true;
  private cap: number;
  private ambient: number;
  private time = 0;

  constructor(
    private graph: WalkGraph,
    perRole = 24,
    private scale = FIG_SCALE,
    private opt: WalkersOpt = {},
  ) {
    this.cap = perRole * 10 + 90;
    this.ambient = opt.ambient ?? 34;
    const P = figureParts();
    const mat = figureMaterial(opt.look);
    const shMat = new THREE.MeshBasicMaterial({ map: softDot(), color: '#1c1408', transparent: true, opacity: 0.42, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.mats.push(mat, shMat);
    const cap = this.cap;
    const mk = (g: THREE.BufferGeometry | undefined, n = cap) => {
      if (!g) return null;
      const p = new Part(g, mat, n);
      this.group.add(p.im);
      return p;
    };
    this.body = mk(P.body)!;
    this.arm = mk(P.arm, cap * 2)!;
    this.leg = mk(P.leg, cap * 2)!;
    this.head = [mk(P.head.m)!, mk(P.head.f)!];
    this.headLo = [mk(P.headLo.m)!, mk(P.headLo.f)!];
    this.bodyLo = mk(P.bodyLo)!;
    this.hats = HATS.map((h) => mk(P.hat[h]));
    this.props = PROPS.map((p) => mk(P.prop[p]));
    this.accs = ACCS.map((a) => mk(P.acc[a]));
    this.shadow = new Part(P.shadow, shMat, cap, false);
    this.shadow.im.renderOrder = 2;
    this.group.add(this.shadow.im);
  }

  // Camera for culling, and level of detail (limbs and props only when close).
  setView(cam: THREE.Camera | null, detail: boolean) {
    this.cam = cam;
    this.detail = detail;
  }

  private make(c: Costume, accent: string, kind: 0 | 1 | 2): W {
    const r = this.r;
    return {
      hair: c.hair === 'f' ? 1 : 0,
      hat: HATS.indexOf(c.hat),
      prop: PROPS.indexOf(c.prop),
      acc: ACCS.indexOf(c.acc),
      robe: new THREE.Color(c.robe),
      accent: new THREE.Color(accent),
      kind,
      from: 0,
      to: 0,
      t: 0,
      len: 1,
      speed: 0.5 + r() * 0.3,
      off: (r() - 0.5) * 0.5,
      pause: 0,
      look: 0,
      st: null,
      lead: null,
      back: 0,
      side: 0,
      x: 0,
      y: 0,
      z: 0,
      h: 0,
      ph: r() * 10,
      seed: r() * 100,
      moving: false,
      headYaw: 0,
    };
  }

  private commoner(): Costume {
    const r = this.r;
    const f = r() < 0.45;
    const q = r();
    const hat: HatKind = f ? (q < 0.45 ? 'none' : q < 0.75 ? 'scarf' : 'straw') : q < 0.4 ? 'straw' : q < 0.62 ? 'none' : q < 0.78 ? 'band' : q < 0.9 ? 'cap' : 'futou';
    const a = r();
    const acc: AccKind = a < 0.13 ? 'baskets' : a < 0.21 ? 'buckets' : a < 0.3 ? 'pouch' : a < 0.37 ? 'satchel' : a < 0.42 ? 'books' : 'none';
    const pq = r();
    const prop: PropKind = acc === 'baskets' || acc === 'buckets' ? 'none' : pq < 0.07 ? 'scroll' : pq < 0.12 ? 'fan' : pq < 0.16 ? 'lantern' : pq < 0.2 ? 'book' : 'none';
    return { hair: f ? 'f' : 'm', hat, prop, acc, robe: ROBES[Math.floor(r() * ROBES.length)] };
  }

  private place(w: W, start: number) {
    const nb = this.graph.adj[start];
    w.from = start;
    w.to = nb[Math.floor(this.r() * nb.length)];
    w.t = this.r();
    w.len = this.graph.nodes[w.from].distanceTo(this.graph.nodes[w.to]) || 1;
  }

  setOnline(online: Partial<Record<ProvinceId, number>> | undefined, ambient = this.ambient) {
    const r = this.r;
    const list: W[] = [];
    const room = () => list.length + this.stations.length < this.cap;
    const spawn = (start: number, c: Costume, accent: string) => {
      const nb = this.graph.adj[start];
      if (!nb || !nb.length || !room()) return null;
      const w = this.make(c, accent, 0);
      this.place(w, start);
      w.pause = r() < 0.5 ? r() * 5 : 0;
      w.look = (r() - 0.5) * 2;
      list.push(w);
      return w;
    };
    for (const p of PROVINCES) {
      const homes = (this.graph.homes[p.id] ?? []).filter((i) => this.graph.adj[i]?.length);
      if (!homes.length) continue;
      const n = Math.min(7, (ambient ? 2 : 0) + Math.max(0, Math.round(online?.[p.id] ?? 0)));
      const base = ROLE_COSTUME[p.role];
      for (let i = 0; i < n; i++) spawn(homes[Math.floor(r() * homes.length)], { ...base, robe: base.robe ?? '#8a7a5a' }, p.color);
    }
    const starts = this.graph.ring.filter((i) => this.graph.adj[i]?.length);
    const homeAll = Object.values(this.graph.homes).flat().filter((i) => this.graph.adj[i!]?.length) as number[];
    for (let i = 0; i < ambient && starts.length; i++) {
      const pool = r() < 0.7 ? starts : homeAll.length ? homeAll : starts;
      const start = pool[Math.floor(r() * pool.length)];
      const q = r();
      let c: Costume;
      let acc = ACCENTS[Math.floor(r() * ACCENTS.length)];
      if (q < 0.06) c = { ...GUARD };
      else if (q < 0.16) {
        const p = PROVINCES[Math.floor(r() * PROVINCES.length)];
        const base = ROLE_COSTUME[p.role];
        c = { ...base, robe: base.robe ?? '#8a7a5a' };
        acc = p.color;
      } else c = this.commoner();
      const lead = spawn(start, c, acc);
      if (!lead) continue;
      // some walk together (couples, families, patrols)
      if (r() < 0.2) {
        const n = 1 + (r() < 0.35 ? 1 : 0);
        for (let k = 0; k < n && room(); k++) {
          const fc = c.hat === 'helmet' ? { ...GUARD } : this.commoner();
          const fw = this.make(fc, ACCENTS[Math.floor(r() * ACCENTS.length)], 2);
          fw.lead = lead;
          fw.back = 0.45 + k * 0.5;
          fw.side = (k % 2 ? -1 : 1) * 0.32;
          fw.speed = lead.speed;
          list.push(fw);
        }
        lead.speed = Math.min(lead.speed, 0.55);
      }
    }
    this.list = list;
  }

  setStations(st: Station[]) {
    const r = this.r;
    this.stations = st.slice(0, Math.max(0, this.cap - 40)).map((s) => {
      let c: Costume;
      let acc = s.accent ?? ACCENTS[Math.floor(r() * ACCENTS.length)];
      if (s.costume) c = s.costume;
      else if (s.role) {
        const base = ROLE_COSTUME[s.role];
        c = { ...base, robe: base.robe ?? '#8a7a5a' };
        acc = s.accent ?? PROVINCES.find((p) => p.role === s.role)?.color ?? acc;
      } else c = this.commoner();
      if (s.act === 'sweep') c = { ...c, acc: 'broom', prop: 'none' };
      if (s.act === 'fish') c = { ...c, prop: 'rod', acc: 'none' };
      if (s.act === 'guard') c = { ...GUARD, robe: s.accent ? GUARD.robe : GUARD.robe };
      if (s.act === 'hammer') c = { ...c, prop: 'hammer' };
      const w = this.make(c, acc, 1);
      w.st = s;
      w.x = s.x;
      w.z = s.z;
      w.h = s.ry;
      w.y = s.y ?? (this.opt.ground ? this.opt.ground(s.x, s.z) : 0);
      return w;
    });
  }

  private step(w: W, dt: number) {
    const { nodes, adj } = this.graph;
    const r = this.r;
    if (w.kind === 2) {
      const L = w.lead!;
      const sh = Math.sin(L.h);
      const ch = Math.cos(L.h);
      const tx = L.x - sh * w.back + ch * w.side;
      const tz = L.z - ch * w.back - sh * w.side;
      const d = Math.hypot(tx - w.x, tz - w.z);
      if (d > 3) {
        w.x = tx;
        w.z = tz;
      } else {
        const k = Math.min(1, dt * 4);
        w.x += (tx - w.x) * k;
        w.z += (tz - w.z) * k;
      }
      w.y = L.y;
      w.moving = L.moving;
      if (d > 0.05 && L.moving) {
        let dh = Math.atan2(tx - w.x + sh * 0.3, tz - w.z + ch * 0.3) - w.h;
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        w.h += dh * Math.min(1, dt * 6);
      }
      if (w.moving) w.ph += L.speed * dt * 9;
      return;
    }
    if (w.kind === 1) return;
    if (w.pause > 0) {
      w.pause -= dt;
      w.moving = false;
    } else {
      w.moving = true;
      w.t += (w.speed * dt) / w.len;
      w.ph += w.speed * dt * 9;
      if (w.t >= 1) {
        const nb = adj[w.to];
        let next = nb[Math.floor(r() * nb.length)];
        const dead = nb.length === 1;
        if (nb.length > 1 && next === w.from) next = nb[(nb.indexOf(next) + 1) % nb.length];
        w.from = w.to;
        w.to = next;
        w.t = 0;
        w.len = nodes[w.from].distanceTo(nodes[w.to]) || 1;
        if (dead || r() < 0.08) {
          w.pause = 1.2 + r() * 2.8;
          w.look = (r() - 0.5) * 2.2;
        }
      }
    }
    const a = nodes[w.from];
    const b = nodes[w.to];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    // ease the lateral lane offset towards 0 near nodes so turns cut corners less
    const off = w.off * Math.min(1, Math.min(w.t, 1 - w.t) * 6 + 0.35);
    w.x = a.x + dx * w.t + (dz / l) * off;
    w.z = a.z + dz * w.t - (dx / l) * off;
    let y = a.y + (b.y - a.y) * w.t;
    if (this.opt.ground) y = Math.max(y, this.opt.ground(w.x, w.z));
    w.y = y;
    if (w.moving) {
      let dh = Math.atan2(dx, dz) - w.h;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      w.h += dh * Math.min(1, dt * 7);
    }
  }

  update(dt: number, time: number) {
    this.time = time;
    for (const w of this.list) this.step(w, dt);
    const cam = this.cam;
    const all = this.stations.length ? this.list.concat(this.stations) : this.list;
    for (const w of all) {
      if (cam) {
        _v.set(w.x, w.y + 0.4, w.z).project(cam);
        if (_v.x < -1.1 || _v.x > 1.1 || _v.y < -1.15 || _v.y > 1.2) continue;
      }
      this.pose(w, time);
    }
    this.body.end();
    this.bodyLo.end();
    this.headLo.forEach((p) => p.end());
    this.arm.end();
    this.leg.end();
    this.shadow.end();
    this.head.forEach((p) => p.end());
    for (const l of [this.hats, this.props, this.accs]) for (const p of l) p?.end();
  }

  private pose(w: W, t: number) {
    const S = this.scale;
    const s = w.seed;
    let legA = 0;
    let armL = 0.03 * Math.sin(t * 1.4 + s);
    let armR = -armL;
    let armZ = 0.13;
    let bob = 0;
    let roll = 0;
    let lean = 0;
    let headYaw = 0;
    let headPitch = -0.16; // chin up a little so faces read from the high camera
    let accYaw = 0;
    let accY = 0;
    const long = w.prop === 1 || w.prop === 2; // spear / pennant
    if (w.moving) {
      const sp = Math.sin(w.ph);
      legA = sp * 0.62;
      armL = -sp * 0.55;
      armR = sp * (long ? 0.12 : 0.55);
      bob = Math.abs(Math.cos(w.ph)) * 0.032;
      roll = sp * 0.055;
      headPitch += Math.sin(w.ph * 2) * 0.03;
      accY = Math.abs(Math.cos(w.ph)) * 0.02;
      lean = 0.05;
    } else if (w.kind === 0 || w.kind === 2) {
      // looking around while waiting
      bob = Math.sin(t * 1.6 + s) * 0.004;
      w.headYaw += (w.look * (0.6 + 0.4 * Math.sin(t * 0.9 + s)) - w.headYaw) * 0.05;
      headYaw = w.headYaw;
    }
    if (w.acc === 11 || w.acc === 12) armR = -0.55 + (w.moving ? Math.sin(w.ph) * 0.06 : 0); // hands on the pole
    if (long && !w.moving) armR = -0.2;
    const st = w.st;
    if (st) {
      const c = t + s;
      switch (st.act) {
        case 'guard':
          armR = -0.28;
          armL = 0.04;
          headYaw = Math.sin(c * 0.25) > 0.75 ? Math.sin(c * 0.8) * 0.5 : 0;
          bob = Math.sin(c * 1.3) * 0.003;
          break;
        case 'vendor': {
          const g = Math.max(0, Math.sin(c * 0.7));
          armR = -0.5 - g * 0.6 * (0.6 + 0.4 * Math.sin(c * 6));
          armL = -0.35;
          headYaw = Math.sin(c * 0.45) * 0.6;
          bob = Math.sin(c * 1.5) * 0.004;
          break;
        }
        case 'sweep':
          lean = 0.3;
          armL = -0.95;
          armR = -0.8;
          accYaw = Math.sin(c * 2.6) * 0.38;
          roll = Math.sin(c * 2.6) * 0.04;
          legA = Math.sin(c * 1.3) * 0.12;
          headPitch += 0.15;
          break;
        case 'hammer': {
          const k = (c * 0.85) % 1;
          armR = k < 0.62 ? -0.3 - (k / 0.62) * 2.2 : k < 0.7 ? -2.5 + ((k - 0.62) / 0.08) * 2.3 : -0.2;
          armL = -0.5;
          lean = 0.18;
          headPitch += 0.2;
          bob = k > 0.62 && k < 0.72 ? -0.01 : 0;
          break;
        }
        case 'chat': {
          const talk = Math.sin(c * 0.45) > 0;
          armR = talk ? -0.55 + Math.sin(c * 5.0) * 0.28 : 0.05;
          armL = talk ? -0.2 : -0.1;
          headPitch += talk ? Math.sin(c * 4.2) * 0.05 : 0.04;
          headYaw = talk ? 0 : Math.sin(c * 0.3) * 0.2;
          roll = talk ? Math.sin(c * 2.0) * 0.03 : 0;
          bob = Math.sin(c * 1.5) * 0.004;
          break;
        }
        case 'fish':
          armR = -0.75 + Math.sin(c * 0.5) * 0.05;
          armL = -0.65;
          headPitch += 0.12;
          break;
        case 'perform':
          armR = -1.6 + Math.sin(c * 2.2) * 0.6;
          armL = -1.2 + Math.cos(c * 2.2) * 0.6;
          armZ = 0.35;
          roll = Math.sin(c * 2.2) * 0.09;
          bob = Math.abs(Math.sin(c * 2.2)) * 0.03;
          headYaw = Math.sin(c * 1.1) * 0.4;
          break;
        case 'watch':
          headYaw = Math.sin(c * 0.4) * 0.8;
          bob = Math.sin(c * 1.5) * 0.004;
          break;
      }
    }
    // body
    _e.set(lean, w.h, roll, 'YXZ');
    _q.setFromEuler(_e);
    _B.compose(_p.set(w.x, w.y + bob * S, w.z), _q, _s.setScalar(S));
    (this.detail ? this.body : this.bodyLo).push(_B, w.robe, w.accent);
    // head (+ hat)
    _H.multiplyMatrices(_B, local(0, NECK_Y, 0, headPitch, headYaw, 0, 'YXZ'));
    _H.multiply(_M.makeTranslation(0, HEAD_Y, 0));
    (this.detail ? this.head : this.headLo)[w.hair].push(_H, w.robe, w.accent);
    this.hats[w.hat]?.push(_H, w.robe, w.accent);
    // accessory (on the body; porters' loads bounce, brooms swing)
    const ap = this.accs[w.acc];
    if (ap) {
      if (accYaw || accY) _M.multiplyMatrices(_B, local(0, accY, 0, 0, accYaw, 0, 'YXZ'));
      else _M.copy(_B);
      ap.push(_M, w.robe, w.accent);
    }
    // shadow on the ground
    const sr = (w.acc === 11 || w.acc === 12 ? 0.62 : 0.5) * S;
    _M.makeScale(sr, 1, sr);
    _M.setPosition(w.x, w.y + 0.012, w.z);
    this.shadow.push(_M, SH_COL, SH_COL);
    if (!this.detail) return;
    // sleeves (+ prop in the right hand)
    for (let k = 0; k < 2; k++) {
      const sx = k ? 1 : -1;
      _M.multiplyMatrices(_B, local(sx * SHOULDER.x, SHOULDER.y, SHOULDER.z, k ? armR : armL, 0, sx * armZ, 'XYZ'));
      this.arm.push(_M, w.robe, w.accent);
      if (k) this.props[w.prop]?.push(_M, w.robe, w.accent);
    }
    // legs
    for (let k = 0; k < 2; k++) {
      const sx = k ? 1 : -1;
      _M.multiplyMatrices(_B, local(sx * HIP.x, HIP.y, 0, k ? -legA : legA, 0, 0, 'XYZ'));
      this.leg.push(_M, w.robe, w.accent);
    }
  }

  dispose() {
    this.mats.forEach((m) => m.dispose());
    const parts = [this.body, this.bodyLo, this.arm, this.leg, this.shadow, ...this.head, ...this.headLo, ...this.hats, ...this.props, ...this.accs];
    parts.forEach((p) => p?.dispose());
  }
}
