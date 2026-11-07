// Single-province diorama (landing cards): the province's settlement on a small
// natural island tile (sand, earth, grass, trees) in turquoise water, with a
// citizen or two. One WebGL context; switching provinces swaps the content
// with a shrink / pop transition.
import * as THREE from 'three';
import type { ProvinceId } from '../../shared/realm';
import { Kit, rng } from './kit';
import { SITE, fbm } from './layout';
import { buildSettlement } from './settlements';
import { Nature, type Plant } from './nature';
import { Smoke, Walkers } from './life';
import { depthTexture, terrainGeometry, waterMaterial, type Bounds } from './terrain';
import { buildKit, groundColor, makeMats, type Graph, type Mats } from './world';

interface Slot {
  id: ProvinceId;
  group: THREE.Group;
  walkers: Walkers;
  smoke: Smoke;
  water: THREE.ShaderMaterial;
  disposables: { dispose(): void }[];
  meshes: THREE.Mesh[];
  born: number;
  dying: number | null;
  tile: number;
}

const easeBack = (x: number) => {
  const c1 = 1.5;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

const PITCH = 0.62;
const H0 = 0.9;

export class PreviewEngine {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 300);
  mats: Mats;
  slots: Slot[] = [];
  paused = false;
  private yaw = 0;
  private t = 0;
  private raf = 0;
  private last = 0;
  private inView = true;
  private disposed = false;
  private io: IntersectionObserver;
  private ro: ResizeObserver;
  private w = 1;
  private h = 1;
  private lookY = 3;
  private fitTop = 8;
  private tile = 11;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const cv = this.renderer.domElement;
    cv.style.display = 'block';
    cv.style.width = '100%';
    cv.style.height = '100%';
    container.appendChild(cv);
    this.mats = makeMats();
    // warm natural daylight
    this.scene.add(new THREE.HemisphereLight('#e4ecf7', '#a08a62', 1.5));
    const sun = new THREE.DirectionalLight('#fff0d4', 2.5);
    sun.position.set(-14, 26, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.radius = 3;
    Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 80 });
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.04;
    this.scene.add(sun);
    this.mats.win.color.setScalar(0.6);
    this.mats.pools.opacity = 0;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.io = new IntersectionObserver((e) => {
      this.inView = e[0]?.isIntersecting ?? true;
      this.loop();
    });
    this.io.observe(container);
    document.addEventListener('visibilitychange', this.onVis);
    this.resize();
  }

  setPaused(p: boolean) {
    this.paused = p;
    this.loop();
  }

  show(id: ProvinceId) {
    const cur = this.slots.find((s) => s.dying === null);
    if (cur?.id === id) return;
    if (cur) cur.dying = this.t;
    this.slots.push(this.build(id));
    this.loop();
    if (this.paused) this.render();
  }

  private build(id: ProvinceId): Slot {
    const k = new Kit();
    const r = rng(id.length * 977 + id.charCodeAt(0));
    const base = SITE[id];
    const site = { id, x: 0, z: 0, h: H0, r: base.r, ry: 0 };
    const T = id === 'throne' ? base.r + 5.2 : base.r + 3.6; // island radius
    const hp = (x: number, z: number) => {
      const d = Math.hypot(x * 0.96, z) + fbm(x * 0.22 + 7, z * 0.22, 3, 3) * 1.6;
      if (d < base.r) return H0;
      const fall = smooth(T - 2.4, T + 2.2, d);
      return H0 - fall * (H0 + 5.6) + fbm(x * 0.3, z * 0.3, 2, 5) * 0.12 * (1 - fall);
    };
    const B: Bounds = { x0: -T - 6, z0: -T - 6, x1: T + 6, z1: T + 6 };
    const group = new THREE.Group();
    const disposables: { dispose(): void }[] = [];
    // terrain + water
    const tg = terrainGeometry(B, id === 'throne' ? 0.45 : 0.32, hp, (x, z, h, sl, out) => groundColor({ road: () => 0, sites: [site] }, x, z, h, sl, out), 0.16, T + 4.4);
    const terrain = new THREE.Mesh(tg, this.mats.ground);
    terrain.receiveShadow = true;
    group.add(terrain);
    const dt = depthTexture(B, 256, hp);
    const water = waterMaterial(dt, B);
    water.uniforms.uFadeR.value.set(T + 4.3, T + 6.5);
    const wg = new THREE.CircleGeometry(T + 6.5, 64);
    wg.rotateX(-Math.PI / 2);
    const wm = new THREE.Mesh(wg, water);
    wm.renderOrder = 1;
    group.add(wm);
    disposables.push(tg, dt, water, wg);
    // settlement
    const out = buildSettlement(k, site, r, hp, false);
    // trees around the rim
    const plants: Plant[] = [];
    for (let i = 0; i < 70; i++) {
      const a = r() * Math.PI * 2;
      const d = base.r + 0.6 + r() * (T - base.r - 1.2);
      const x = Math.sin(a) * d;
      const z = Math.cos(a) * d;
      const h = hp(x, z);
      if (h < 0.35) continue;
      if (Math.cos(a) > 0.55 && d < base.r + 2.5) continue; // keep the front open
      const q = r();
      plants.push({ kind: q < 0.35 ? 'pine' : q < 0.6 ? 'oak' : q < 0.75 ? 'round' : q < 0.87 ? 'fir' : q < 0.94 ? 'blossom' : 'autumn', x, y: h - 0.05, z, s: 0.75 + r() * 0.4, ry: r() * 6, tint: 0.88 + r() * 0.2 });
    }
    for (let i = 0; i < 26; i++) {
      const a = r() * Math.PI * 2;
      const d = T - 1.2 + r() * 2.2;
      const x = Math.sin(a) * d;
      const z = Math.cos(a) * d;
      const h = hp(x, z);
      if (h > 0.4 || h < -0.6) continue;
      plants.push({ kind: 'rock', x, y: h - 0.1, z, s: 0.3 + r() * 0.6, ry: r() * 6, tint: 0.85 + r() * 0.3 });
    }
    const nature = new Nature(plants, this.mats.s, true);
    group.add(nature.group);
    disposables.push(nature);
    const meshes = buildKit(k, this.mats, group);
    // citizens pacing between open spots
    const nodes = out.walk.slice(0, 4).map(([x, z]) => new THREE.Vector3(x, hp(x, z) + 0.02, z));
    const adj = nodes.map((_, i) => (nodes.length === 1 ? [] : i === 0 ? [1] : i === nodes.length - 1 ? [i - 1] : [i - 1, i + 1]));
    const graph: Graph = { nodes, adj, homes: { [id]: nodes.map((_, i) => i) }, ring: [] };
    const walkers = new Walkers(graph, 3, 1.5, { ground: hp, look: this.mats.look });
    walkers.setStations(out.spots.slice(0, 10));
    walkers.setOnline({ [id]: 2 }, 0);
    group.add(walkers.group);
    const smoke = new Smoke(k.smoke);
    group.add(smoke.mesh);
    group.scale.setScalar(0.001);
    this.scene.add(group);
    this.tile = T;
    this.fitTop = out.top + (k.smoke.length ? 2.4 : 1.4);
    this.resize();
    return { id, group, walkers, smoke, water, disposables, meshes, born: this.t, dying: null, tile: T };
  }

  private resize() {
    const r = this.container.getBoundingClientRect();
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.renderer.setSize(this.w, this.h, false);
    const aspect = this.w / this.h;
    const cp = Math.cos(PITCH);
    const sp = Math.sin(PITCH);
    const T = this.tile;
    const bottom = -(T + 0.5) * sp;
    const top = Math.max((T - 1) * sp, this.fitTop * cp + T * 0.35 * sp);
    this.lookY = (top + bottom) / 2 / cp;
    const half = Math.max((top - bottom) / 2 + 0.6, (T + 0.8) / aspect);
    Object.assign(this.camera, { left: -half * aspect, right: half * aspect, top: half, bottom: -half });
    this.camera.updateProjectionMatrix();
    this.placeCamera();
    this.render();
  }

  private placeCamera() {
    const d = 90;
    this.camera.position.set(Math.sin(this.yaw) * Math.cos(PITCH) * d, Math.sin(PITCH) * d + this.lookY, Math.cos(this.yaw) * Math.cos(PITCH) * d);
    this.camera.lookAt(0, this.lookY, 0);
  }

  private onVis = () => this.loop();
  private shouldRun() {
    return !this.disposed && !this.paused && this.inView && !document.hidden;
  }
  private loop() {
    if (this.raf || !this.shouldRun()) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }
  private tick = (now: number) => {
    this.raf = 0;
    if (!this.shouldRun()) return;
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.t += dt;
    // gentle turntable sway around the front view
    this.yaw = Math.sin(this.t * 0.3) * 0.38 - 0.2;
    this.placeCamera();
    for (const s of [...this.slots]) {
      if (s.dying !== null) {
        const k = Math.min(1, (this.t - s.dying) / 0.3);
        s.group.scale.setScalar(Math.max(0.001, 1 - k * k));
        if (k >= 1) this.drop(s);
      } else {
        const k = Math.min(1, (this.t - s.born - 0.18) / 0.65);
        s.group.scale.setScalar(Math.max(0.001, k <= 0 ? 0.001 : easeBack(k)));
      }
      s.walkers.update(dt, this.t);
      s.smoke.setPpu(this.h / Math.max(1e-3, this.camera.top - this.camera.bottom));
      s.smoke.update(this.t);
      s.water.uniforms.uTime.value = this.t;
    }
    this.render();
    this.raf = requestAnimationFrame(this.tick);
  };

  private drop(s: Slot) {
    this.scene.remove(s.group);
    s.meshes.forEach((m) => m.geometry.dispose());
    s.disposables.forEach((d) => d.dispose());
    s.walkers.dispose();
    s.smoke.dispose();
    this.slots = this.slots.filter((x) => x !== s);
  }

  private render() {
    // when paused, show the newest slot at full size (and pose its citizens once)
    if (this.paused)
      for (const s of [...this.slots]) {
        if (s.dying === null) {
          s.group.scale.setScalar(1);
          s.walkers.update(0, this.t);
        } else this.drop(s);
      }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.io.disconnect();
    this.ro.disconnect();
    document.removeEventListener('visibilitychange', this.onVis);
    [...this.slots].forEach((s) => this.drop(s));
    this.mats.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
