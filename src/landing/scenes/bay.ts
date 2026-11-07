// One shared WebGL renderer + one living bay (the realm world) for the landing's
// cinematic sections. The Zoom and Gates sections never share the screen, so
// instead of building the world twice, the single canvas moves into whichever
// registered view is on screen. Rendering stops when no view is visible.
import * as THREE from 'three';
import { buildWorld, makeMats, type Mats, type World } from '../../realm/world';
import * as Life from '../../realm/life';
import { WATER_DAY, WATER_NIGHT } from '../../realm/terrain';

export interface Mood {
  hemiSky: string;
  hemiGround: string;
  hemi: number;
  sun: string;
  sunI: number;
  sunPos: [number, number, number];
  win: number; // window brightness 0..1
  lan: string; // lamp head colour
  halo: number;
  pools: number;
  glows: number;
  water: number; // 0 = day water, 1 = night water
  fog: string;
  fogNear: number;
  fogFar: number;
  skyTop: string;
  skyMid: string;
  skyLow: string;
  sunGlow: string; // glow around the sun in the sky dome
  fill: string; // soft front fill light (no shadows)
  fillI: number;
}

export const DAY: Mood = {
  hemiSky: '#e4ecf7',
  hemiGround: '#a08a62',
  hemi: 1.5,
  sun: '#fff0d4',
  sunI: 2.55,
  sunPos: [-60, 90, 45],
  win: 0.55,
  lan: '#d8c49a',
  halo: 0.1,
  pools: 0,
  glows: 0,
  water: 0,
  fog: '#dfe7f2',
  fogNear: 260,
  fogFar: 700,
  skyTop: '#9cc3f0',
  skyMid: '#cfe0f6',
  skyLow: '#eef1f4',
  sunGlow: '#000000',
  fill: '#ffffff',
  fillI: 0,
};

export const DUSK: Mood = {
  hemiSky: '#9a8cc8',
  hemiGround: '#3a2a3a',
  hemi: 1.25,
  sun: '#ffb27a',
  sunI: 1.9,
  sunPos: [-110, 34, -60],
  win: 1,
  lan: '#ffd98c',
  halo: 0.42,
  pools: 0.55,
  glows: 1,
  water: 0.62,
  fog: '#c58fa0',
  fogNear: 70,
  fogFar: 330,
  skyTop: '#2a2158',
  skyMid: '#7a4f9a',
  skyLow: '#f2a07a',
  sunGlow: '#ffb27a',
  fill: '#ffc9a0',
  fillI: 1.15,
};

interface LifeLike {
  group?: THREE.Object3D;
  mesh?: THREE.Object3D;
  points?: THREE.Points;
  update?: (...a: number[]) => void;
  setPpu?: (ppu: number) => void;
  setNight?: (n: number) => void;
  setOpacity?: (o: number) => void;
  setView?: (cam: THREE.Camera | null, detail: boolean) => void;
  setOnline?: (o: undefined) => void;
  setStations?: (s: unknown) => void;
  dispose?: () => void;
}

export interface BayView {
  el: HTMLElement;
  mood: Mood;
  extras?: THREE.Object3D;
  /** Place the camera for this frame. */
  frame(cam: THREE.PerspectiveCamera, t: number, dt: number, w: number, h: number): void;
  /** After render: project overlay anchors, etc. */
  after?(cam: THREE.PerspectiveCamera, w: number, h: number): void;
}

const SKY_VS = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const SKY_FS = /* glsl */ `
uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uLow; uniform vec3 uFog; uniform vec3 uSun; uniform vec3 uSunC;
varying vec3 vDir;
void main() {
  float e = vDir.y;
  vec3 c = mix(uLow, uMid, smoothstep(0.0, 0.16, e));
  c = mix(c, uTop, smoothstep(0.14, 0.62, e));
  float sd = max(dot(vDir, normalize(uSun)), 0.0);
  c += uSunC * (pow(sd, 6.0) * 0.3 + pow(sd, 60.0) * 0.55 + pow(sd, 1400.0) * 1.4);
  c = mix(c, uFog, smoothstep(0.02, -0.06, e));
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`;

const _c0 = new THREE.Color();
const _c1 = new THREE.Color();

export class Bay {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(32, 1, 0.5, 2400);
  mats: Mats;
  world: World;
  /** living layers from the realm (walkers, boats, smoke, lamp glow...), duck-typed on purpose */
  private life: { name: string; x: LifeLike }[] = [];
  hemi: THREE.HemisphereLight;
  sun: THREE.DirectionalLight;
  fill: THREE.DirectionalLight;
  sky: THREE.Mesh;
  still = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  private views: { v: BayView; ratio: number }[] = [];
  private active: BayView | null = null;
  private io: IntersectionObserver;
  private ro: ResizeObserver;
  private raf = 0;
  private last = 0;
  private t = 0;
  private w = 1;
  private h = 1;
  private disposed = false;
  private fogU = { c: { value: new THREE.Color() }, r: { value: new THREE.Vector2(1e4, 2e4) } };
  private skyMat: THREE.ShaderMaterial;
  private dirty = true;

  constructor() {
    const mobile = window.matchMedia('(max-width: 760px)').matches;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    const cv = this.renderer.domElement;
    Object.assign(cv.style, { display: 'block', width: '100%', height: '100%', position: 'absolute', inset: '0', pointerEvents: 'none' });

    this.mats = makeMats();
    this.world = buildWorld('hero', this.mats);
    this.scene.add(this.world.group);
    this.scene.fog = new THREE.Fog('#dfe7f2', 200, 700);

    // the realm's water is a custom shader: give it the same distance fog
    const water = this.world.water;
    const fogU = this.fogU;
    water.onBeforeCompile = (sh) => {
      if (!sh.fragmentShader.includes('#include <colorspace_fragment>') || !sh.fragmentShader.includes('vW')) return;
      sh.uniforms.uFogC = fogU.c;
      sh.uniforms.uFogR = fogU.r;
      sh.fragmentShader =
        'uniform vec3 uFogC;\nuniform vec2 uFogR;\n' +
        sh.fragmentShader.replace(
          '#include <colorspace_fragment>',
          'float fogK = smoothstep(uFogR.x, uFogR.y, distance(vW, cameraPosition));\n  gl_FragColor = vec4(mix(gl_FragColor.rgb, uFogC, fogK), mix(gl_FragColor.a, 1.0, fogK));\n  #include <colorspace_fragment>',
        );
    };
    water.customProgramCacheKey = () => 'landing-fog';
    water.needsUpdate = true;

    this.hemi = new THREE.HemisphereLight(DAY.hemiSky, DAY.hemiGround, DAY.hemi);
    this.sun = new THREE.DirectionalLight(DAY.sun, DAY.sunI);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(mobile ? 1536 : 2048, mobile ? 1536 : 2048);
    Object.assign(this.sun.shadow.camera, { left: -95, right: 95, top: 85, bottom: -85, near: 10, far: 320 });
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.05;
    this.fill = new THREE.DirectionalLight('#ffffff', 0);
    this.fill.position.set(25, 30, 140);
    this.scene.add(this.hemi, this.sun, this.sun.target, this.fill);

    // life (the realm module is maintained separately: everything optional)
    const L = Life as unknown as Record<string, (new (...a: unknown[]) => LifeLike) | undefined>;
    const Wd = this.world as unknown as Record<string, unknown>;
    const add = (name: string, make: () => LifeLike | undefined) => {
      try {
        const x = make();
        if (!x) return;
        const o = x.group ?? x.mesh ?? x.points;
        if (o) this.scene.add(o);
        this.life.push({ name, x });
        return x;
      } catch {
        return undefined;
      }
    };
    const walk = add('walkers', () => (L.Walkers ? new L.Walkers(Wd.graph, mobile ? 10 : 14, 1.0, { ground: Wd.ground, look: (this.mats as unknown as Record<string, unknown>).look, ambient: mobile ? 40 : 70 }) : undefined));
    if (walk) {
      if (Wd.stations) walk.setStations?.(Wd.stations);
      walk.setOnline?.(undefined);
    }
    add('movers', () => (L.Movers ? new L.Movers(this.mats, Wd.lanes, Wd.carts, 11, 7) : undefined));
    add('smoke', () => (L.Smoke && Wd.smoke ? new L.Smoke(Wd.smoke) : undefined));
    add('glows', () => (L.Glows && Wd.lights ? new L.Glows(Wd.lights) : undefined));
    if (Wd.incense) add('incense', () => (L.Smoke ? new L.Smoke(Wd.incense, { per: 7, rise: 2.2, size: 0.45, rate: 0.12, color: '#f6f2ea' }) : undefined));
    if (Wd.meadow) add('fireflies', () => (L.Fireflies ? new L.Fireflies(Wd.meadow) : undefined));
    if (Wd.blossoms) add('petals', () => (L.Petals ? new L.Petals(Wd.blossoms, 3) : undefined));
    add('birds', () => (L.Birds ? new L.Birds() : undefined));

    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VS,
      fragmentShader: SKY_FS,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: new THREE.Color() },
        uMid: { value: new THREE.Color() },
        uLow: { value: new THREE.Color() },
        uFog: { value: new THREE.Color() },
        uSun: { value: new THREE.Vector3(0, 1, 0) },
        uSunC: { value: new THREE.Color(0, 0, 0) },
      },
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1800, 32, 16), this.skyMat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    // warm up the pose of walkers / boats so a paused frame looks alive
    this.stepLife(0.016, 0, 30);

    this.io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const it = this.views.find((x) => x.v.el === e.target);
          if (it) it.ratio = e.isIntersecting ? Math.max(0.0001, e.intersectionRatio) : 0;
        }
        this.pick();
      },
      { threshold: [0, 0.01, 0.25, 0.5, 0.75, 1] },
    );
    this.ro = new ResizeObserver(() => {
      this.resize();
      this.invalidate();
    });
    document.addEventListener('visibilitychange', this.onVis);
  }

  register(v: BayView) {
    this.views.push({ v, ratio: 0 });
    this.io.observe(v.el);
    return () => {
      this.views = this.views.filter((x) => x.v !== v);
      if (!this.views.some((x) => x.v.el === v.el)) this.io.unobserve(v.el);
      else {
        // re-observe so the remaining view gets a fresh intersection entry
        this.io.unobserve(v.el);
        this.io.observe(v.el);
      }
      if (this.active === v) this.setActive(null);
      this.pick();
    };
  }

  /** Request a frame (used in reduced-motion mode where nothing animates by itself). */
  invalidate() {
    this.dirty = true;
    this.loop();
  }

  private pick() {
    let best: { v: BayView; ratio: number } | null = null;
    for (const x of this.views) if (x.ratio > 0 && (!best || x.ratio > best.ratio)) best = x;
    this.setActive(best?.v ?? null);
  }

  private setActive(v: BayView | null) {
    if (v === this.active) return this.loop();
    const prev = this.active;
    if (prev?.extras) this.scene.remove(prev.extras);
    this.ro.disconnect();
    this.active = v;
    if (v) {
      v.el.appendChild(this.renderer.domElement);
      if (v.extras) this.scene.add(v.extras);
      this.applyMood(v.mood);
      this.ro.observe(v.el);
      this.resize();
      this.renderer.shadowMap.needsUpdate = true;
      this.dirty = true;
    }
    this.loop();
  }

  applyMood(m: Mood) {
    this.hemi.color.set(m.hemiSky);
    this.hemi.groundColor.set(m.hemiGround);
    this.hemi.intensity = m.hemi;
    this.sun.color.set(m.sun);
    this.sun.intensity = m.sunI;
    this.sun.position.set(...m.sunPos);
    this.fill.color.set(m.fill);
    this.fill.intensity = m.fillI;
    const ms = this.mats;
    ms.win.color.setScalar(m.win);
    ms.lan.color.set(m.lan);
    ms.halo.opacity = m.halo;
    ms.pools.opacity = m.pools;
    ms.water.color.set('#6cb9b2').lerp(_c0.set('#1f4a66'), m.water);
    ms.water.emissive.set('#1d5f6a').lerp(_c0.set('#0b1f38'), m.water);
    const u = this.world.water.uniforms;
    const W = (k: keyof typeof WATER_DAY) => _c0.set(WATER_DAY[k]).lerp(_c1.set(WATER_NIGHT[k]), m.water);
    (u.uShallow.value as THREE.Color).copy(W('shallow'));
    (u.uMid.value as THREE.Color).copy(W('mid'));
    (u.uDeep.value as THREE.Color).copy(W('deep'));
    (u.uFoam.value as THREE.Color).copy(W('foam'));
    (u.uGlint.value as THREE.Color).copy(m.water > 0.3 ? _c0.set('#ffcf9a') : W('glint'));
    u.uFoamK.value = 1 - m.water * 0.45;
    const n = m.water; // how far towards night the realm looks
    const look = (this.mats as unknown as { look?: Record<string, { value: number }> }).look;
    if (look?.uNight) look.uNight.value = n;
    if (look?.uCloud) look.uCloud.value = 0.2 * (1 - n);
    if (u.uNight) u.uNight.value = n;
    if (u.uCloud) u.uCloud.value = 0.2 * (1 - n);
    for (const { name, x } of this.life) {
      x.setNight?.(n);
      if (name === 'glows') {
        if (x.setOpacity) x.setOpacity(m.glows);
        else if (x.points) (x.points.material as THREE.PointsMaterial).opacity = m.glows;
      } else if (name === 'fireflies') x.setOpacity?.(Math.max(0, n * 1.2 - 0.2));
      else if (name === 'petals') x.setOpacity?.(1 - n * 0.5);
    }
    const fog = this.scene.fog as THREE.Fog;
    fog.color.set(m.fog);
    fog.near = m.fogNear;
    fog.far = m.fogFar;
    this.fogU.c.value.set(m.fog);
    this.fogU.r.value.set(m.fogNear, m.fogFar);
    const su = this.skyMat.uniforms;
    (su.uTop.value as THREE.Color).set(m.skyTop);
    (su.uMid.value as THREE.Color).set(m.skyMid);
    (su.uLow.value as THREE.Color).set(m.skyLow);
    (su.uFog.value as THREE.Color).set(m.fog);
    (su.uSun.value as THREE.Vector3).set(...m.sunPos).normalize();
    (su.uSunC.value as THREE.Color).set(m.sunGlow);
    this.renderer.shadowMap.needsUpdate = true;
  }

  private resize() {
    const el = this.active?.el;
    if (!el) return;
    const r = el.getBoundingClientRect();
    this.w = Math.max(1, Math.round(r.width));
    this.h = Math.max(1, Math.round(r.height));
    this.renderer.setSize(this.w, this.h, false);
    this.camera.aspect = this.w / this.h;
    this.camera.updateProjectionMatrix();
  }

  private onVis = () => this.loop();
  private shouldRun() {
    return !this.disposed && !!this.active && !document.hidden && (!this.still || this.dirty);
  }
  private loop() {
    if (this.raf || !this.shouldRun()) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }
  private tick = (now: number) => {
    this.raf = 0;
    if (!this.shouldRun()) return;
    const dt = this.still ? 0 : Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.t += dt;
    this.dirty = false;
    this.render(dt);
    this.raf = requestAnimationFrame(this.tick);
  };

  private render(dt: number) {
    const v = this.active;
    if (!v) return;
    const cam = this.camera;
    v.frame(cam, this.t, dt, this.w, this.h);
    cam.updateMatrixWorld();
    this.sky.position.copy(cam.position);
    // glow sprites keep a world size: scale by distance to the look target
    const dist = cam.position.length() > 0 ? Math.max(8, cam.position.distanceTo(cam.userData.look ?? new THREE.Vector3())) : 60;
    const ppu = this.h / (2 * dist * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)));
    for (const { x } of this.life) x.setView?.(cam, false);
    if (dt > 0) this.stepLife(dt, this.t, ppu);
    else for (const { x } of this.life) x.setPpu?.(Math.min(40, ppu));
    this.world.water.uniforms.uTime.value = this.t;
    const look = (this.mats as unknown as { look?: Record<string, { value: number }> }).look;
    if (look?.uTime) look.uTime.value = this.t;
    this.renderer.render(this.scene, cam);
    v.after?.(cam, this.w, this.h);
  }

  private stepLife(dt: number, t: number, ppu: number) {
    for (const { name, x } of this.life) {
      try {
        x.setPpu?.(Math.min(40, ppu));
        if (!x.update) continue;
        // walkers / boats take (dt, t); sprites and smoke take (t)
        if (name === 'walkers' || name === 'movers' || x.update.length >= 2) x.update(dt, t);
        else x.update(t);
      } catch {
        /* a layer that fails to animate just stays still */
      }
    }
  }

  get time() {
    return this.t;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.io.disconnect();
    this.ro.disconnect();
    document.removeEventListener('visibilitychange', this.onVis);
    this.world.dispose();
    for (const { x } of this.life) {
      try {
        x.dispose?.();
      } catch {
        /* ignore */
      }
    }
    this.life = [];
    this.sky.geometry.dispose();
    this.skyMat.dispose();
    this.mats.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}

// ---- shared instance (ref counted) ----
let shared: Bay | null = null;
let refs = 0;
let pending: Promise<Bay> | null = null;

/** Build the bay when the browser is idle (or after `timeout` ms at the latest). */
export function acquireBay(timeout = 1200): Promise<Bay> {
  refs++;
  if (shared) return Promise.resolve(shared);
  if (pending) return pending;
  pending = new Promise<Bay>((resolve, reject) => {
    const go = () => {
      try {
        if (refs <= 0) {
          pending = null;
          return reject(new Error('released'));
        }
        shared = new Bay();
        pending = null;
        resolve(shared);
      } catch (e) {
        pending = null;
        reject(e);
      }
    };
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (ric) ric(go, { timeout });
    else window.setTimeout(go, 60);
  });
  return pending;
}

export function releaseBay() {
  refs = Math.max(0, refs - 1);
  if (refs === 0 && shared) {
    const s = shared;
    shared = null;
    s.dispose();
  }
}

export function webglOK() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}
