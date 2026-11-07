// Closing scene: a timber-and-tile sea gate on the shore of the bay at dusk.
// Scrolling swings its doors open and carries the camera through, up over the
// palace, while sky lanterns rise from the city into the evening.
import * as THREE from 'three';
import { C, Frame, Kit, rng } from '../../realm/kit';
import { hall, roof, watchtower } from '../../realm/arch';
import { flag } from '../../realm/buildings';
import { buildKit } from '../../realm/world';
import { softDot } from '../../realm/tex';
import { accent } from '../../components/character/color';
import { acquireBay, releaseBay, DUSK, type Bay, type BayView } from './bay';
import { easeInOut, easeOut, lerp, span } from './cam';

export interface GateOpts {
  el: HTMLElement;
  progress: () => number;
  onReady?: () => void;
}

const GZ = 57; // gate line (z)
const GY = 0.9; // threshold height
const OPEN_W = 5.4; // opening width
const OPEN_H = 5.3;
const LACQUER = '#8a2c20';
const LACQUER_D = '#5e1c15';
const GOLD = '#e8b443';

function buildGate(bay: Bay) {
  const group = new THREE.Group();
  const k = new Kit();
  const r = rng(77);
  const f = Frame.at(0, 0, GZ);
  const hw = OPEN_W / 2;
  const TW = 16; // tower width
  const TD = 4.4;
  const base = -2.5;
  const top = 8.2;
  // tower body: two piers + lintel (a real opening)
  const pierW = TW / 2 - hw;
  for (const s of [-1, 1]) {
    k.box(f, s * (hw + pierW / 2), base, 0, pierW, top - base, TD, C.cwall);
    k.box(f, s * (hw + pierW / 2), base, 0, pierW + 0.14, 0.5 + (GY - base), TD + 0.14, C.marble2);
    // brick courses
    for (let y = GY + 0.9; y < top - 0.4; y += 0.9) k.box(f, s * (hw + pierW / 2), y, TD / 2 + 0.005, pierW, 0.06, 0.02, C.cwall2);
  }
  k.box(f, 0, GY + OPEN_H + 0.55, 0, OPEN_W + 0.02, top - (GY + OPEN_H + 0.55), TD, C.cwall);
  // rounded arch shoulders inside the opening
  for (const s of [-1, 1])
    for (let i = 0; i < 4; i++) {
      const w = 0.7 - i * 0.17;
      k.box(f, s * (hw - w / 2), GY + OPEN_H + 0.55 - 0.16 * (i + 1), 0, w, 0.16, TD, C.cwall);
    }
  // passage floor + threshold
  k.box(f, 0, base, 0, OPEN_W, GY - base, TD + 0.2, C.marble2);
  k.box(f, 0, GY, TD / 2 - 0.35, OPEN_W, 0.12, 0.5, C.marble);
  // gold frame around the opening (front face)
  const fz = TD / 2 + 0.03;
  k.box(f, -hw - 0.1, GY, fz, 0.16, OPEN_H + 0.5, 0.08, GOLD);
  k.box(f, hw + 0.1, GY, fz, 0.16, OPEN_H + 0.5, 0.08, GOLD);
  k.box(f, 0, GY + OPEN_H + 0.5, fz, OPEN_W + 0.36, 0.16, 0.08, GOLD);
  // name board above the opening
  k.box(f, 0, GY + OPEN_H + 0.85, fz + 0.02, 3.4, 1.15, 0.12, C.base);
  k.box(f, 0, GY + OPEN_H + 0.85, fz + 0.05, 3.6, 0.1, 0.12, GOLD);
  k.box(f, 0, GY + OPEN_H + 1.9, fz + 0.05, 3.6, 0.1, 0.12, GOLD);
  for (let i = 0; i < 3; i++) k.box(f, -0.9 + i * 0.9, GY + OPEN_H + 1.15, fz + 0.1, 0.5, 0.5, 0.04, GOLD);
  // parapet
  k.box(f, 0, top - 0.2, 0, TW + 0.2, 0.2, TD + 0.2, C.cwall2);
  const n = 22;
  for (let i = 0; i < n; i++) k.box(f, -TW / 2 + 0.25 + (i * (TW - 0.5)) / (n - 1), top, TD / 2 - 0.12, 0.34, 0.4, 0.26, C.cwall2);
  // gate hall on top (two eaves)
  const hOut = hall(k, f, 0, -0.1, { w: 11.2, d: 3.3, acc: GOLD, ch: 1.55, plat: 0, y0: top, tiers: 2, rail: true, stairs: false, band: '#4f6b5c' }, r);
  // hanging red lanterns under the lower eave
  for (const x of [-4.6, -1.6, 1.6, 4.6]) k.redLantern(f, x, top + 1.7, 2.05, 1.6);
  // two big lanterns flanking the opening
  for (const s of [-1, 1]) k.redLantern(f, s * (hw + 0.9), GY + OPEN_H - 0.2, fz + 0.45, 2.6);

  // sea wall to both sides, with watchtowers
  const WH = 5.2;
  for (const s of [-1, 1]) {
    const x0 = s * (TW / 2);
    const x1 = s * 70;
    const len = Math.abs(x1 - x0);
    const cx = (x0 + x1) / 2;
    k.box(f, cx, base, -0.3, len, WH - base, 2.6, C.cwall);
    k.box(f, cx, WH - 0.15, -0.3, len, 0.15, 2.8, C.cwall2);
    k.box(f, cx, base, -0.3, len, GY + 0.3 - base, 2.75, C.marble2);
    const m = Math.floor(len / 0.75);
    for (let i = 0; i < m; i++) k.box(f, x0 + s * (0.4 + i * 0.75), WH, 0.85, 0.36, 0.42, 0.28, C.cwall2);
    for (const tx of [22, 46]) {
      const tf = Frame.at(s * tx, base, GZ - 0.3);
      watchtower(k, tf, 0, 0, 4.2, WH - base + 0.9, GOLD, r);
      k.redLantern(tf, 0, WH - base + 0.9 + 1.2, 1.7, 1.3);
    }
    // banners on the wall
    for (const bx of [12, 17, 30, 36]) flag(k, Frame.at(s * bx, WH, GZ + 0.6), 0, 0, 3.2, s < 0 ? accent() : '#c9932a', 0, true);
  }

  // stone quay leading to the gate (over the shallows)
  const qz0 = TD / 2;
  const qLen = 11;
  k.box(f, 0, base, qz0 + qLen / 2, 9, GY - base, qLen, C.marble2);
  k.box(f, 0, GY - 0.02, qz0 + qLen / 2, 8.4, 0.06, qLen - 0.4, C.marble);
  for (let i = 0; i < 4; i++) k.box(f, 0, GY - 0.25 * (i + 1), qz0 + qLen + 0.35 * i + 0.2, 9, 0.25, 0.4, C.marble2);
  for (const s of [-1, 1]) {
    k.box(f, s * 4.35, GY, qz0 + qLen / 2, 0.3, 0.45, qLen, C.marble2);
    for (let i = 0; i < 4; i++) k.stoneLantern(f, s * 4.35, qz0 + 1.6 + i * 2.8, GY + 0.45);
    // gate guardian plinths
    k.box(f, s * (hw + 1.4), GY, qz0 + 0.9, 1.2, 1.0, 1.2, C.marble2);
    k.ball(f, s * (hw + 1.4), GY + 1.45, qz0 + 0.9, 0.5, C.rock2, k.s, 0.9);
    k.box(f, s * (hw + 1.4), GY + 1.0, qz0 + 0.9, 1.0, 0.18, 1.0, C.marble);
  }
  const meshes = buildKit(k, bay.mats, group);

  // doors: two lacquered leaves with gold studs, hinged at the opening edges
  const leaves: THREE.Group[] = [];
  const leafMeshes: THREE.Mesh[] = [];
  for (const s of [-1, 1]) {
    const lk = new Kit();
    const lf = Frame.at(0, 0, 0);
    const w = hw;
    const cx = -s * (w / 2); // extends from hinge towards the centre
    lk.box(lf, cx, 0, 0, w - 0.02, OPEN_H, 0.32, LACQUER);
    lk.box(lf, cx, 0, 0.17, w - 0.02, 0.18, 0.04, LACQUER_D);
    lk.box(lf, cx, OPEN_H - 0.18, 0.17, w - 0.02, 0.18, 0.04, LACQUER_D);
    lk.box(lf, cx, OPEN_H * 0.5, 0.17, w - 0.02, 0.12, 0.04, '#6b4a2a');
    for (let row = 0; row < 7; row++)
      for (let col = 0; col < 5; col++) {
        const x = -s * (0.32 + col * ((w - 0.64) / 4));
        const y = 0.5 + row * ((OPEN_H - 1.0) / 6);
        lk.ball(lf, x, y, 0.2, 0.075, GOLD);
      }
    // knocker
    lk.ball(lf, -s * (w - 0.45), OPEN_H * 0.47, 0.22, 0.17, '#b8862c');
    lk.s.add(new THREE.TorusGeometry(0.22, 0.04, 6, 18), '#d6a640', lf.mat(-s * (w - 0.45), OPEN_H * 0.4, 0.24));
    const g = new THREE.Group();
    const ms = buildKit(lk, bay.mats, g);
    ms.forEach((m) => {
      m.castShadow = false;
      leafMeshes.push(m);
    });
    g.position.set(s * hw, GY + 0.02, GZ + TD / 2 - 0.55);
    g.userData.side = s;
    group.add(g);
    leaves.push(g);
  }
  // light leaking through the seam while the doors are shut
  const seamMat = new THREE.MeshBasicMaterial({ color: '#ffd68a', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, map: softDot(), fog: false });
  const seam = new THREE.Mesh(new THREE.PlaneGeometry(1.4, OPEN_H * 1.3), seamMat);
  seam.position.set(0, GY + OPEN_H / 2, GZ + TD / 2 - 0.32);
  group.add(seam);

  return {
    group,
    leaves,
    seam,
    top: hOut.top,
    dispose() {
      meshes.forEach((m) => m.geometry.dispose());
      leafMeshes.forEach((m) => m.geometry.dispose());
      seam.geometry.dispose();
      seamMat.dispose();
    },
  };
}

// Sky lanterns: little glowing paper lanterns that drift up from the city.
class SkyLanterns {
  group = new THREE.Group();
  private body: THREE.InstancedMesh;
  private glow: THREE.Points;
  private n: number;
  private seed: { x: number; z: number; v: number; ph: number; sw: number; rel: number; s: number }[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private sc = new THREE.Vector3();
  constructor(n: number) {
    this.n = n;
    const r = rng(9);
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2;
      const d = Math.sqrt(r()) * 46;
      this.seed.push({ x: Math.sin(a) * d * 1.1, z: 12 + Math.cos(a) * d * 0.7 - 6, v: 1.1 + r() * 1.3, ph: r() * 90, sw: 0.4 + r() * 0.9, rel: 0.38 + r() * 0.5, s: 0.8 + r() * 0.5 });
    }
    const g = new THREE.CylinderGeometry(0.34, 0.26, 0.62, 8, 1, true);
    const cols = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < g.attributes.position.count; i++) {
      const y = g.attributes.position.getY(i);
      const c = new THREE.Color(y < 0 ? '#ffe2a2' : '#ff9a4a');
      cols.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: true });
    this.body = new THREE.InstancedMesh(g, mat, n);
    this.body.frustumCulled = false;
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const pm = new THREE.PointsMaterial({ color: '#ffb35c', map: softDot(), size: 3.4, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true });
    this.glow = new THREE.Points(pg, pm);
    this.glow.frustumCulled = false;
    this.group.add(this.body, this.glow);
  }
  update(t: number, p: number) {
    const pos = this.glow.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < this.n; i++) {
      const s = this.seed[i];
      const k = Math.min(1, Math.max(0, (p - s.rel) / 0.08));
      const H = 80;
      const y = 3 + ((t * s.v + s.ph) % H);
      const fade = Math.min(1, (H - (y - 3)) / 14) * Math.min(1, (y - 3) / 3);
      const sc = k * fade * s.s;
      const x = s.x + Math.sin(t * 0.35 + s.ph) * s.sw * 1.6;
      const z = s.z + Math.cos(t * 0.28 + s.ph) * s.sw;
      this.q.setFromAxisAngle(this.v.set(0, 0, 1), Math.sin(t * 0.8 + s.ph) * 0.12);
      this.m.compose(this.v.set(x, y, z), this.q, this.sc.setScalar(Math.max(0.0001, sc)));
      this.body.setMatrixAt(i, this.m);
      pos.setXYZ(i, x, sc > 0.02 ? y : -500, z);
    }
    this.body.instanceMatrix.needsUpdate = true;
    pos.needsUpdate = true;
  }
  dispose() {
    this.body.geometry.dispose();
    (this.body.material as THREE.Material).dispose();
    this.glow.geometry.dispose();
    (this.glow.material as THREE.Material).dispose();
  }
}

// Faint stars on the dusk sky.
function stars(n: number) {
  const r = rng(5);
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2;
    const e = 0.12 + Math.pow(r(), 0.7) * 1.3;
    pos.set([Math.cos(a) * Math.cos(e) * 1500, Math.sin(e) * 1500, Math.sin(a) * Math.cos(e) * 1500], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.PointsMaterial({ color: '#fff4dc', size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.75, fog: false, depthWrite: false });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  p.renderOrder = -9;
  return p;
}

const _look = new THREE.Vector3();

// Hide instanced trees / rocks standing in the camera's path through the gate
// (and on the quay). Returns a function that puts them back.
let corridor: { refs: number; restore: () => void } | null = null;
function clearCorridor(root: THREE.Object3D) {
  if (corridor) {
    corridor.refs++;
  } else corridor = { refs: 1, restore: hideCorridor(root) };
  let done = false;
  return () => {
    if (done || !corridor) return;
    done = true;
    if (--corridor.refs <= 0) {
      corridor.restore();
      corridor = null;
    }
  };
}
function hideCorridor(root: THREE.Object3D) {
  const saved: { im: THREE.InstancedMesh; i: number; m: THREE.Matrix4 }[] = [];
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  root.traverse((o) => {
    const im = o as THREE.InstancedMesh;
    if (!im.isInstancedMesh) return;
    let hit = false;
    for (let i = 0; i < im.count; i++) {
      im.getMatrixAt(i, m);
      p.setFromMatrixPosition(m);
      const half = p.z > GZ - 3 ? 9 : lerp(4.5, 9, (p.z - (GZ - 14)) / 11);
      if (p.z > GZ - 14 && p.z < GZ + 16 && Math.abs(p.x) < Math.max(4.5, half)) {
        saved.push({ im, i, m: m.clone() });
        im.setMatrixAt(i, zero);
        hit = true;
      }
    }
    if (hit) im.instanceMatrix.needsUpdate = true;
  });
  return () => {
    for (const s of saved) {
      s.im.setMatrixAt(s.i, s.m);
      s.im.instanceMatrix.needsUpdate = true;
    }
  };
}

export async function mountGate(o: GateOpts) {
  let bay: Bay;
  try {
    bay = await acquireBay(1500);
  } catch {
    return () => {};
  }
  const gate = buildGate(bay);
  const restore = clearCorridor(bay.world.group);
  const extras = new THREE.Group();
  extras.add(gate.group);
  const mobile = window.matchMedia('(max-width: 760px)').matches;
  const lanterns = new SkyLanterns(mobile ? 110 : 200);
  extras.add(lanterns.group);
  const sky = stars(mobile ? 220 : 380);
  extras.add(sky);
  let readySent = false;

  const view: BayView = {
    el: o.el,
    mood: DUSK,
    extras,
    frame(cam, t, _dt, w, h) {
      const p = bay.still ? 1 : o.progress();
      const aspect = w / h;
      // doors
      const open = easeInOut(span(p, 0.08, 0.46));
      for (const g of gate.leaves) g.rotation.y = g.userData.side * -open * 1.78;
      (gate.seam.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - open * 6) * (0.75 + Math.sin(t * 2.2) * 0.1);
      // camera: approach, pass through the gate, rise over the palace
      const push = easeInOut(span(p, 0.16, 0.72));
      const back = aspect < 1 ? 16 : 0; // phones: start further back to fit the gate
      const z0 = GZ + 40 + back;
      const z1 = GZ - 9;
      const z = lerp(z0, z1, push);
      // low over the water, through the opening, then up over the roofs
      const inside = Math.max(0, GZ + 1.5 - z);
      const y = lerp(3.4 + back * 0.15, 2.9, span(p, 0.16, 0.45)) + Math.min(1, inside / 10.5) ** 1.4 * (aspect < 1 ? 17 : 13);
      const sway = Math.sin(t * 0.18) * 0.35 * (1 - push * 0.6);
      cam.position.set(sway, y, z);
      const lift = Math.min(1, inside / 10.5);
      const ly = lerp(7.2, 4.2, push) - lift * 0.5;
      const lz = lerp(GZ, -8, easeOut(span(p, 0.3, 0.85)));
      _look.set(sway * 0.4, ly, lz);
      cam.fov = aspect < 1 ? 54 : 38;
      cam.near = 0.3;
      cam.updateProjectionMatrix();
      cam.lookAt(_look);
      cam.userData.look = _look.clone();
      sky.position.copy(cam.position);
      lanterns.update(t, p);
      if (!readySent) {
        readySent = true;
        o.onReady?.();
      }
    },
  };
  const off = bay.register(view);
  const onScroll = () => bay.still && bay.invalidate();
  window.addEventListener('scroll', onScroll, { passive: true });
  let alive = true;
  return () => {
    if (!alive) return;
    alive = false;
    window.removeEventListener('scroll', onScroll);
    off();
    restore();
    gate.dispose();
    lanterns.dispose();
    sky.geometry.dispose();
    (sky.material as THREE.Material).dispose();
    releaseBay();
  };
}
