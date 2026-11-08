// Realm engine (plain Three.js): a natural bay seen from a high strategy-map
// angle. Warm daylight or a cool moonlit night with lantern light.
import * as THREE from 'three';
import type { Banner } from '../../shared/types';
import type { ProvinceId } from '../../shared/realm';
import { Aura, Birds, Fireflies, Glows, Movers, Petals, Smoke, Walkers } from './life';
import { VIEW_X, VIEW_Z, provincePos } from './layout';
import { WATER_DAY, WATER_NIGHT } from './terrain';
import { BannerLayer } from './banners';
import { buildWorld, makeMats, type Mats, type World } from './world';
import type { AgentState, Festival, LiveAgent, RealmLive, Weather, WeatherKind } from '../../shared/live';
import { Heroes } from './heroes';
import { WEATHER_LOOK, WeatherFx, type WeatherLook } from './weather';
import { Champion, Festive } from './festival';
import { FrameProbe, Throttle, maxDpr, onQuality, quality } from './quality';

export type TimeMode = 'auto' | 'day' | 'night';
export type Pick = { kind: 'hall'; province: ProvinceId } | { kind: 'banner'; bannerId: string } | { kind: 'agent'; agentId: string } | { kind: 'none' };

const lerpLook = (a: WeatherLook, b: WeatherLook, k: number) => {
  let d = 0;
  for (const key of Object.keys(a) as (keyof WeatherLook)[]) {
    const v = a[key] + (b[key] - a[key]) * k;
    d += Math.abs(b[key] - v);
    a[key] = Math.abs(b[key] - v) < 0.002 ? b[key] : v;
  }
  return d;
};

export interface EngineCb {
  onPick?: (p: Pick) => void;
  onZoom?: (pct: number) => void;
  onReady?: () => void;
  onNight?: (n: number) => void;
}

interface CamState {
  t: THREE.Vector3;
  z: number;
}

const MIN_Z = 0.55;
const MAX_Z = 4;
const FULL_HALF = 30;
const PITCH = 0.78;
const DIST = 160;
const YAW = 0;

const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const clampZ = (z: number) => Math.min(MAX_Z, Math.max(MIN_Z, z));

// day / night palettes: warm natural sunlight; cool moonlight with lanterns
const DAY = {
  hemiSky: new THREE.Color('#e4ecf7'),
  hemiGround: new THREE.Color('#a08a62'),
  hemi: 1.45,
  sun: new THREE.Color('#fff0d4'),
  sunI: 2.55,
  win: 0.55,
  lan: new THREE.Color('#d8c49a'),
  water: WATER_DAY,
};
const NIGHT = {
  hemiSky: new THREE.Color('#5d74a8'),
  hemiGround: new THREE.Color('#1c2236'),
  hemi: 0.95,
  sun: new THREE.Color('#a9bcff'),
  sunI: 1.05,
  win: 1,
  lan: new THREE.Color('#ffd98c'),
  water: WATER_NIGHT,
};
const _w0 = new THREE.Color();
const _w1 = new THREE.Color();

// Phones and small tablets: touch-first or a small screen.
export function isMobileDevice() {
  try {
    return window.matchMedia('(pointer: coarse)').matches || Math.min(window.screen.width, window.screen.height) < 768;
  } catch {
    return false;
  }
}

// Night between 18:00 and 06:00 local time (with a one-hour dusk / dawn fade).
export function nightFromClock(d = new Date()) {
  const h = d.getHours() + d.getMinutes() / 60;
  if (h >= 18.5 || h < 5.5) return 1;
  if (h >= 17.5 && h < 18.5) return h - 17.5;
  if (h >= 5.5 && h < 6.5) return 1 - (h - 5.5);
  return 0;
}
/** @deprecated kept for older imports; the realm now follows local time. */
export const nightFromUTC = nightFromClock;

export class RealmEngine {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
  mats: Mats;
  world: World;
  walkers: Walkers;
  movers: Movers;
  smoke: Smoke;
  glows: Glows;
  incense: Smoke;
  fireflies: Fireflies;
  petals: Petals;
  birds: Birds;
  highlight = new Aura();
  banners: BannerLayer;
  heroes: Heroes | null = null;
  weather: WeatherFx | null = null;
  festive: Festive | null = null;
  champion: Champion | null = null;
  private festGlow: Glows | null = null;
  private wx: WeatherLook = { ...WEATHER_LOOK.none };
  private wxTo: WeatherLook = { ...WEATHER_LOOK.none };
  private reduced = false;
  // real data from the server, and (dev builds only) forced looks for testing
  private real: { live: RealmLive | null; weather: Weather | null; festival: Festival | null } = {
    live: null,
    weather: null,
    festival: null,
  };
  private dev: { weather?: WeatherKind | null; festival?: boolean; agents: Map<string, { state: AgentState; task: string | null }>; champion?: ProvinceId | null } = { agents: new Map() };
  hemi: THREE.HemisphereLight;
  sun: THREE.DirectionalLight;

  target = new THREE.Vector3();
  zoom = 1;
  yaw = YAW;
  baseHalf = FULL_HALF;
  night = 0;
  nightTarget = 0;
  time: TimeMode = 'auto';
  paused = false;

  private home: CamState = { t: new THREE.Vector3(), z: 1 };
  private hist: CamState[] = [];
  private hi = -1;
  private anim: { from: CamState; to: CamState; start: number; dur: number } | null = null;
  private vel = new THREE.Vector2();
  private inertia = false;
  private labels: { id: ProvinceId; el: HTMLElement; p: THREE.Vector3 }[] = [];
  private raf = 0;
  private last = 0;
  private clock = 0;
  private inView = true;
  private ready = false;
  private mobile = false;
  private dpr = 1;
  private perf = { frames: 0, time: 0, checks: 0, buildMs: 0 };
  private lastZoomPct = -1;
  private nightCheck = 0;
  private io: IntersectionObserver;
  private ro: ResizeObserver;
  private w = 1;
  private h = 1;
  private ray = new THREE.Raycaster();
  private plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private ptrs = new Map<number, { x: number; y: number }>();
  private down = { x: 0, y: 0, t: 0, moved: false };
  private pinch = { d: 0, z: 1 };
  private lastMoveT = 0;
  private hoverT = 0;
  private wheelTimer = 0;
  private tmp = new THREE.Vector3();
  private disposed = false;
  private probe = new FrameProbe('realm');
  private throttle = new Throttle();
  private lastWheel = 0;
  private offQuality: () => void = () => {};
  // element that receives CSS variables (--night, --px, --py) for the painted backdrop
  private get vars(): HTMLElement {
    return (this.container.closest('.realm-wrap') as HTMLElement | null) ?? this.container;
  }

  constructor(
    private container: HTMLElement,
    public mode: 'hero' | 'full',
    private cb: EngineCb = {},
  ) {
    const hero = mode === 'hero';
    const t0 = performance.now();
    this.mobile = isMobileDevice();
    const q = quality();
    const low = q.tier === 'low';
    this.renderer = new THREE.WebGLRenderer({ antialias: !low, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    // Phones get a lower render scale (1 on the low tier); it drops further on its own if frames run slow.
    this.dpr = Math.min(maxDpr(q), this.mobile ? 1.5 : hero ? 1.5 : 2);
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.shadowMap.enabled = !q.slow;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    const cv = this.renderer.domElement;
    cv.style.display = 'block';
    cv.style.width = '100%';
    cv.style.height = '100%';
    cv.style.touchAction = hero ? 'auto' : 'none';
    cv.style.pointerEvents = hero ? 'none' : 'auto';
    if (!hero) cv.style.cursor = 'grab';
    container.appendChild(cv);

    this.mats = makeMats();
    this.world = buildWorld(mode, this.mats);
    this.scene.add(this.world.group);
    this.perf.buildMs = Math.round(performance.now() - t0);

    // light
    this.hemi = new THREE.HemisphereLight(DAY.hemiSky, DAY.hemiGround, 1.6);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(DAY.sun, 2.4);
    this.sun.position.set(-60, 90, 45);
    this.sun.castShadow = !q.slow;
    // low tier: a smaller (softer) shadow map; dropped entirely once frames were measured slow
    const shadow = low ? 1024 : this.mobile ? (hero ? 1024 : 2048) : hero ? 2048 : 4096;
    this.sun.shadow.mapSize.set(shadow, shadow);
    Object.assign(this.sun.shadow.camera, { left: -95, right: 95, top: 85, bottom: -85, near: 10, far: 280 });
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.05;
    this.scene.add(this.sun, this.sun.target);

    // life
    this.walkers = new Walkers(this.world.graph, hero ? 14 : 32, 1.0, { ground: this.world.ground, look: this.mats.look, ambient: hero ? (low ? 24 : this.mobile ? 40 : 70) : low ? 60 : this.mobile ? 110 : 190 });
    this.walkers.setStations(this.world.stations);
    this.walkers.setOnline(undefined);
    this.scene.add(this.walkers.group);
    this.movers = new Movers(this.mats, this.world.lanes, this.world.carts, hero ? 10 : 14, hero ? 6 : 10);
    this.scene.add(this.movers.group);
    this.smoke = new Smoke(this.world.smoke);
    this.scene.add(this.smoke.mesh);
    this.glows = new Glows(this.world.lights);
    this.scene.add(this.glows.points);
    this.incense = new Smoke(this.world.incense, { per: 7, rise: 2.2, size: 0.45, rate: 0.12, color: '#f6f2ea' });
    this.scene.add(this.incense.mesh);
    this.fireflies = new Fireflies(this.world.meadow);
    this.scene.add(this.fireflies.points);
    this.petals = new Petals(this.world.blossoms, low ? (hero ? 2 : 3) : hero ? 3 : 6);
    this.scene.add(this.petals.points);
    this.birds = new Birds();
    this.scene.add(this.birds.mesh);
    this.scene.add(this.highlight.mesh);
    this.banners = new BannerLayer(this.mats);
    this.banners.set(undefined);
    this.scene.add(this.banners.group);
    if (!hero) {
      this.heroes = new Heroes(this.world.graph, this.world.ground, this.mats.s, this.mats.look);
      this.heroes.onPick = (id) => this.pickAgent(id);
      this.scene.add(this.heroes.group);
      this.weather = new WeatherFx();
      this.reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      this.weather.reduced = this.reduced;
      this.scene.add(this.weather.group);
      this.festive = new Festive(this.world.ground, this.mats.s);
      this.scene.add(this.festive.group);
      this.champion = new Champion(this.mats.s);
      this.scene.add(this.champion.group);
    }

    if (hero) this.target.set(0, 0, 4);
    else this.bindInput();

    this.night = this.nightTarget = this.computeNight();
    this.applyNight();

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.io = new IntersectionObserver((e) => {
      this.inView = e[0]?.isIntersecting ?? true;
      this.loop();
    });
    this.io.observe(container);
    document.addEventListener('visibilitychange', this.onVis);
    this.offQuality = onQuality((nq) => {
      if (this.disposed) return;
      if (this.dpr > 1) {
        this.dpr = 1;
        this.renderer.setPixelRatio(1);
        this.renderer.setSize(this.w, this.h, false);
      }
      if (nq.slow && this.sun.castShadow) {
        this.sun.castShadow = false;
        this.renderer.shadowMap.enabled = false;
      }
    });
    this.resize(true);
    this.renderer.shadowMap.needsUpdate = true;
    if (import.meta.env.DEV && !hero) (window as unknown as { __realm?: RealmEngine }).__realm = this;
    this.loop();
  }

  // ---------- public ----------
  setPaused(p: boolean) {
    this.paused = p;
    this.loop();
  }
  setTime(t: TimeMode) {
    this.time = t;
    this.nightTarget = this.computeNight();
    this.loop();
  }
  setOnline(o: Partial<Record<ProvinceId, number>> | undefined) {
    this.walkers.setOnline(o);
  }
  setBanners(list: Banner[] | undefined, rentOpen = false) {
    this.banners.set(list, rentOpen);
    this.renderer.shadowMap.needsUpdate = true;
  }
  setLabels(map: Map<ProvinceId, HTMLElement>) {
    this.labels = [...map].map(([id, el]) => ({ id, el, p: this.world.labelPos.get(id) ?? new THREE.Vector3(provincePos(id)[0], 6, provincePos(id)[1]) }));
  }
  // ---------- live realm (real server data) ----------
  setAgentLayer(el: HTMLElement | null) {
    this.heroes?.setLayer(el);
  }
  setLive(live: RealmLive | null | undefined) {
    this.real.live = live ?? null;
    this.applyLive();
  }
  setWeather(w: Weather | null | undefined) {
    this.real.weather = w ?? null;
    this.applyWeather();
  }
  setFestival(f: Festival | null | undefined) {
    this.real.festival = f ?? null;
    this.applyFestival();
  }
  // SVG markup of a guild's icon (drawn on the champion standard).
  setIconSource(fn: ((id: ProvinceId) => string | undefined) | null) {
    this.iconSvg = fn;
    if (this.champion?.id) this.champion.set(this.champion.id, fn?.(this.champion.id));
  }
  private iconSvg: ((id: ProvinceId) => string | undefined) | null = null;
  selectAgent(id: string | null) {
    if (!this.heroes) return;
    this.heroes.selected = id;
    this.loop();
  }
  // Centre the camera on an agent (zooming in enough to see the figure).
  focusAgent(id: string) {
    const p = this.heroes?.position(id);
    if (!p) return;
    this.selectAgent(id);
    const z = clampZ(Math.max(this.zoom, this.w < 900 ? 1.8 : 2.4));
    const ppu = (this.h / (2 * this.baseHalf)) * z;
    const t = new THREE.Vector3(p.x, 0, p.z);
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    if (this.w >= 900) t.addScaledVector(right, 210 / ppu);
    else t.addScaledVector(fwd, -((this.h * 0.25) / ppu) / Math.sin(PITCH));
    this.tweenTo({ t, z }, 0.8);
  }
  private pickAgent(id: string) {
    this.selectAgent(id);
    this.cb.onPick?.({ kind: 'agent', agentId: id });
  }
  private applyLive() {
    if (!this.heroes) return;
    const agents: LiveAgent[] = (this.real.live?.agents ?? []).map((a) => {
      const f = this.dev.agents.get(a.id);
      return f ? { ...a, state: f.state, task: f.task, decreeId: f.state === 'working' ? a.decreeId : null } : a;
    });
    this.heroes.set(agents);
    if (this.dev.champion === undefined) this.applyChampion();
    this.loop();
  }
  private applyWeather() {
    if (!this.weather) return;
    const w = this.real.weather;
    const kind = this.dev.weather !== undefined ? this.dev.weather : (w?.kind ?? null);
    if (kind !== this.weather.kind) this.weather.set(kind, w?.windKmh ?? 10);
    this.wxTo = { ...WEATHER_LOOK[kind ?? 'none'] };
    this.loop();
  }
  private applyFestival() {
    if (!this.festive) return;
    const on = this.dev.festival !== undefined ? this.dev.festival : !!this.real.festival;
    this.festive.set(on);
    if (on && !this.festGlow && this.festive.glowPts.length) {
      this.festGlow = new Glows(this.festive.glowPts, '#ff8a5a');
      this.festive.group.add(this.festGlow.points);
    }
    this.festive.setNight(this.night);
    this.festGlow?.setOpacity(Math.max(0, this.night * 1.1 - 0.1));
    this.renderer.shadowMap.needsUpdate = true;
  }
  private applyChampion() {
    if (!this.champion) return;
    const id = this.dev.champion !== undefined ? this.dev.champion : (this.real.live?.champion ?? null);
    if (id !== this.champion.id) {
      this.champion.set(id, id ? this.iconSvg?.(id) : undefined);
      this.renderer.shadowMap.needsUpdate = true;
    }
  }

  // ---------- dev-only test hooks (window.__realm in `vite dev`) ----------
  // They only change what this engine draws, for screenshots; the page UI
  // (chips, cards) keeps showing the real data.
  devWeather(kind: WeatherKind | null | 'real') {
    if (!import.meta.env.DEV) return;
    if (kind === 'real') delete this.dev.weather;
    else this.dev.weather = kind;
    this.applyWeather();
  }
  devFestival(on: boolean | 'real') {
    if (!import.meta.env.DEV) return;
    if (on === 'real') delete this.dev.festival;
    else this.dev.festival = on;
    this.applyFestival();
  }
  devChampion(id: ProvinceId | null | 'real') {
    if (!import.meta.env.DEV) return;
    if (id === 'real') delete this.dev.champion;
    else this.dev.champion = id;
    this.applyChampion();
  }
  devAgent(idOrName: string, state: AgentState | 'real', task: string | null = null) {
    if (!import.meta.env.DEV) return;
    const a = this.real.live?.agents.find((x) => x.id === idOrName || x.name === idOrName);
    if (!a) return 'no such agent';
    if (state === 'real') this.dev.agents.delete(a.id);
    else this.dev.agents.set(a.id, { state, task });
    this.applyLive();
    return a.id;
  }
  devAgents() {
    return this.real.live?.agents.map((a) => `${a.name} (${a.province}) ${a.state}`) ?? [];
  }
  devFocus(idOrName: string) {
    const a = this.real.live?.agents.find((x) => x.id === idOrName || x.name === idOrName);
    if (a) this.focusAgent(a.id);
  }
  // frames per second over `ms` (counts real rAF ticks of the engine)
  devFps(ms = 3000): Promise<number> {
    return new Promise((res) => {
      let n = 0;
      const t0 = performance.now();
      const f = () => {
        n++;
        if (performance.now() - t0 < ms) requestAnimationFrame(f);
        else res(Math.round((n * 1000) / (performance.now() - t0)));
      };
      requestAnimationFrame(f);
    });
  }

  zoomBy(f: number) {
    this.tweenTo({ t: this.target.clone(), z: clampZ(this.zoom * f) }, 0.35);
  }
  recenter() {
    this.highlight.show(null);
    this.tweenTo({ t: this.home.t.clone(), z: this.home.z }, 0.8);
  }
  undo() {
    if (this.hi <= 0) return;
    this.hi--;
    this.tweenTo(this.hist[this.hi], 0.6, false);
  }
  redo() {
    if (this.hi >= this.hist.length - 1) return;
    this.hi++;
    this.tweenTo(this.hist[this.hi], 0.6, false);
  }
  focusProvince(id: ProvinceId) {
    this.highlight.show(id);
    const narrow = this.w < 900 ? 0.6 : 1;
    this.frameOn(id, Math.max(this.zoom, (id === 'throne' ? 1.5 : 2.0) * narrow), 1.0);
  }
  pickProvince(id: ProvinceId) {
    this.highlight.show(id);
    this.frameOn(id, Math.max(this.zoom, this.w < 900 ? 1.1 : 1.4), 0.8);
    this.cb.onPick?.({ kind: 'hall', province: id });
  }
  clearHighlight() {
    this.highlight.show(null);
  }
  toggleFullscreen() {
    const el = (this.container.closest('[data-realm-root]') as HTMLElement | null) ?? this.container;
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else el.requestFullscreen?.().catch(() => {});
  }

  // Move the camera so the province sits in the area not covered by the side panel.
  private frameOn(id: ProvinceId, z: number, dur: number) {
    const [px, pz] = provincePos(id);
    const zz = clampZ(z);
    const ppu = (this.h / (2 * this.baseHalf)) * zz;
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const t = new THREE.Vector3(px, 0, pz);
    if (this.w >= 900) t.addScaledVector(right, 210 / ppu); // right-hand panel (~420px)
    else t.addScaledVector(fwd, -((this.h * 0.25) / ppu) / Math.sin(PITCH)); // bottom sheet
    this.tweenTo({ t, z: zz }, dur);
  }

  // ---------- camera ----------
  private computeNight() {
    if (this.time === 'day') return 0;
    if (this.time === 'night') return 1;
    return nightFromClock();
  }

  private resize(first = false) {
    const r = this.container.getBoundingClientRect();
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.renderer.setSize(this.w, this.h, false);
    const aspect = this.w / this.h;
    if (this.mode === 'hero') {
      // the whole bay in the frame
      this.baseHalf = Math.max(50 / aspect, 30);
      this.zoom = 1;
    } else if (first) {
      // show ~56 units each side on wide screens; never more than ~40 units high
      this.zoom = clampZ(Math.max((FULL_HALF * aspect) / 56, FULL_HALF / 40));
      this.home = { t: new THREE.Vector3(0, 0, aspect < 1 ? 10 : -1), z: this.zoom };
      this.target.copy(this.home.t);
      this.hist = [{ t: this.home.t.clone(), z: this.home.z }];
      this.hi = 0;
    }
    this.updateCamera();
    if (!first) this.render();
  }

  private updateCamera() {
    const aspect = this.w / this.h;
    const h = this.baseHalf;
    const c = this.camera;
    c.left = -h * aspect;
    c.right = h * aspect;
    c.top = h;
    c.bottom = -h;
    c.zoom = this.zoom;
    c.position.set(
      this.target.x + Math.sin(this.yaw) * Math.cos(PITCH) * DIST,
      this.target.y + Math.sin(PITCH) * DIST,
      this.target.z + Math.cos(this.yaw) * Math.cos(PITCH) * DIST,
    );
    c.lookAt(this.target);
    c.updateProjectionMatrix();
    if (this.mode === 'full') {
      // parallax hint for the painted backdrop
      const right = this.target.x * Math.cos(this.yaw) - this.target.z * Math.sin(this.yaw);
      const fwd = -this.target.x * Math.sin(this.yaw) - this.target.z * Math.cos(this.yaw);
      this.vars.style.setProperty('--px', (-right * 1.4).toFixed(1) + 'px');
      this.vars.style.setProperty('--py', (fwd * 0.9).toFixed(1) + 'px');
    }
  }

  private state(): CamState {
    return { t: this.target.clone(), z: this.zoom };
  }
  private push(s: CamState = this.state()) {
    const cur = this.hist[this.hi];
    if (cur && cur.t.distanceTo(s.t) < 0.05 && Math.abs(cur.z - s.z) < 0.005) return;
    this.hist = this.hist.slice(0, this.hi + 1);
    this.hist.push({ t: s.t.clone(), z: s.z });
    if (this.hist.length > 60) this.hist.shift();
    this.hi = this.hist.length - 1;
  }
  private tweenTo(to: CamState, dur: number, record = true) {
    this.inertia = false;
    const t = to.t.clone();
    this.clampTarget(t);
    const dest = { t, z: clampZ(to.z) };
    this.anim = { from: this.state(), to: dest, start: this.clock, dur };
    if (record) this.push(dest);
    this.loop();
  }
  private clampTarget(v: THREE.Vector3) {
    v.x = Math.max(-VIEW_X, Math.min(VIEW_X, v.x));
    v.z = Math.max(-VIEW_Z, Math.min(VIEW_Z, v.z));
    v.y = 0;
  }

  // ---------- input ----------
  private bindInput() {
    const cv = this.renderer.domElement;
    cv.addEventListener('pointerdown', this.onDown);
    cv.addEventListener('pointermove', this.onMove);
    cv.addEventListener('pointerup', this.onUp);
    cv.addEventListener('pointercancel', this.onUp);
    cv.addEventListener('pointerleave', this.onLeave);
    cv.addEventListener('wheel', this.onWheel, { passive: false });
  }
  private unbindInput() {
    const cv = this.renderer.domElement;
    cv.removeEventListener('pointerdown', this.onDown);
    cv.removeEventListener('pointermove', this.onMove);
    cv.removeEventListener('pointerup', this.onUp);
    cv.removeEventListener('pointercancel', this.onUp);
    cv.removeEventListener('pointerleave', this.onLeave);
    cv.removeEventListener('wheel', this.onWheel);
  }
  private local(e: { clientX: number; clientY: number }) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  private ground(x: number, y: number, out = new THREE.Vector3()) {
    const ndc = new THREE.Vector2((x / this.w) * 2 - 1, -(y / this.h) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    return this.ray.ray.intersectPlane(this.plane, out) ?? out.copy(this.target);
  }
  private onDown = (e: PointerEvent) => {
    const p = this.local(e);
    this.renderer.domElement.setPointerCapture?.(e.pointerId);
    this.ptrs.set(e.pointerId, p);
    this.anim = null;
    this.inertia = false;
    this.vel.set(0, 0);
    if (this.ptrs.size === 1) {
      this.down = { x: p.x, y: p.y, t: performance.now(), moved: false };
      this.renderer.domElement.style.cursor = 'grabbing';
    } else if (this.ptrs.size === 2) {
      const [a, b] = [...this.ptrs.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: this.zoom };
      this.down.moved = true;
    }
    this.container.dispatchEvent(new CustomEvent('realm-interact', { bubbles: true }));
  };
  private onMove = (e: PointerEvent) => {
    const p = this.local(e);
    const prev = this.ptrs.get(e.pointerId);
    if (!prev) {
      const now = performance.now();
      if (now - this.hoverT > 90) {
        this.hoverT = now;
        const hit = this.hitTest(p.x, p.y);
        this.renderer.domElement.style.cursor = hit.kind === 'none' ? 'grab' : 'pointer';
      }
      return;
    }
    this.ptrs.set(e.pointerId, p);
    if (this.ptrs.size === 1) {
      if (!this.down.moved && Math.hypot(p.x - this.down.x, p.y - this.down.y) > 6) this.down.moved = true;
      if (!this.down.moved) return;
      const g0 = this.ground(prev.x, prev.y, new THREE.Vector3());
      const g1 = this.ground(p.x, p.y, new THREE.Vector3());
      const dx = g0.x - g1.x;
      const dz = g0.z - g1.z;
      this.target.x += dx;
      this.target.z += dz;
      this.clampTarget(this.target);
      const now = performance.now();
      const dt = Math.max(1, now - this.lastMoveT) / 1000;
      this.lastMoveT = now;
      this.vel.lerp(new THREE.Vector2(dx / dt, dz / dt), 0.5);
      this.updateCamera();
      this.loop();
    } else if (this.ptrs.size === 2) {
      const [a, b] = [...this.ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      this.zoomAt(clampZ((this.pinch.z * d) / this.pinch.d), (a.x + b.x) / 2, (a.y + b.y) / 2);
    }
  };
  private onUp = (e: PointerEvent) => {
    const had = this.ptrs.get(e.pointerId);
    const single = this.ptrs.size === 1;
    this.ptrs.delete(e.pointerId);
    this.renderer.domElement.releasePointerCapture?.(e.pointerId);
    if (!had) return;
    this.renderer.domElement.style.cursor = 'grab';
    if (single && !this.down.moved && performance.now() - this.down.t < 650) {
      const p = this.local(e);
      const hit = this.hitTest(p.x, p.y);
      if (hit.kind === 'hall') {
        this.highlight.show(hit.province);
        this.frameOn(hit.province, this.zoom, 0.7);
      } else if (hit.kind === 'none') this.highlight.show(null);
      this.selectAgent(hit.kind === 'agent' ? hit.agentId : null);
      this.cb.onPick?.(hit);
      this.loop();
      return;
    }
    if (this.ptrs.size === 0 && this.down.moved) {
      if (performance.now() - this.lastMoveT < 80 && this.vel.length() > 2) this.inertia = true;
      else this.push();
      this.loop();
    }
  };
  private onLeave = () => {
    if (!this.ptrs.size) this.renderer.domElement.style.cursor = 'grab';
  };
  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const p = this.local(e);
    this.anim = null;
    // gentler than raw deltaY: ~1.1x per mouse notch
    const d = Math.max(-120, Math.min(120, e.deltaY));
    this.zoomAt(clampZ(this.zoom * Math.exp(-d * 0.0009)), p.x, p.y);
    window.clearTimeout(this.wheelTimer);
    this.wheelTimer = window.setTimeout(() => this.push(), 280);
    this.lastWheel = performance.now();
    this.container.dispatchEvent(new CustomEvent('realm-interact', { bubbles: true }));
  };
  private zoomAt(z: number, x: number, y: number) {
    const before = this.ground(x, y, new THREE.Vector3());
    this.zoom = z;
    this.updateCamera();
    const after = this.ground(x, y, new THREE.Vector3());
    this.target.x += before.x - after.x;
    this.target.z += before.z - after.z;
    this.clampTarget(this.target);
    this.updateCamera();
    this.loop();
  }
  private hitTest(x: number, y: number): Pick {
    // real agents first: small figures standing in front of the halls
    const agent = this.heroes?.pick(x, y, this.ppu());
    if (agent) return { kind: 'agent', agentId: agent };
    const ndc = new THREE.Vector2((x / this.w) * 2 - 1, -(y / this.h) * 2 + 1);
    this.ray.setFromCamera(ndc, this.camera);
    const hits = this.ray.intersectObjects([...this.banners.pickables, ...this.world.pickBoxes], false);
    // banners are small and sit inside province pick boxes, so they win
    const bn = hits.find((h) => h.object.userData.bannerId);
    if (bn) return { kind: 'banner', bannerId: bn.object.userData.bannerId as string };
    const pr = hits.find((h) => h.object.userData.province);
    if (pr) return { kind: 'hall', province: pr.object.userData.province as ProvinceId };
    return { kind: 'none' };
  }

  // ---------- loop ----------
  private prevTick = 0;
  private onVis = () => this.loop();
  // Adaptive quality: every ~2 s of rendering, if the average frame rate is below
  // ~40 fps, render at a lower pixel ratio (down to 1). Never raises it again.
  private adapt(dt: number) {
    const p = this.perf;
    p.frames++;
    p.time += dt;
    if (p.time < 2) return;
    const fps = p.frames / p.time;
    p.frames = 0;
    p.time = 0;
    p.checks++;
    (window as unknown as { __realmPerf?: unknown }).__realmPerf = { fps: Math.round(fps), dpr: this.dpr, buildMs: p.buildMs, mobile: this.mobile, tier: quality().tier };
    // the low tier / reduced motion run at ~30 fps on purpose
    const q = quality();
    if (fps < (q.tier === 'low' || q.reduced ? 24 : 40) && this.dpr > 1) {
      this.dpr = Math.max(1, Math.round((this.dpr - 0.25) * 100) / 100);
      this.renderer.setPixelRatio(this.dpr);
      this.renderer.setSize(this.w, this.h, false);
    }
  }

  private shouldRun() {
    return !this.disposed && !this.paused && this.inView && !document.hidden;
  }
  private loop() {
    if (this.raf || !this.shouldRun()) return;
    this.last = performance.now();
    this.prevTick = 0;
    this.raf = requestAnimationFrame(this.tick);
  }
  private tick = (now: number) => {
    this.raf = 0;
    if (!this.shouldRun()) return;
    if (this.ready) this.probe.sample(Math.min(0.1, Math.max(0, now - (this.prevTick || now)) / 1000));
    this.prevTick = now;
    // low tier / reduced motion: ~30 fps unless the view is being moved
    const busy = this.mode === 'full' && (this.ptrs.size > 0 || !!this.anim || this.inertia || now - this.lastWheel < 300);
    if (this.ready && this.throttle.skip(now - this.last, busy)) {
      this.raf = requestAnimationFrame(this.tick);
      return;
    }
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.update(dt);
    this.render();
    if (!this.ready) {
      this.ready = true;
      this.cb.onReady?.();
    } else this.adapt(dt);

    this.raf = requestAnimationFrame(this.tick);
  };

  private update(dt: number) {
    this.clock += dt;
    const t = this.clock;
    this.nightCheck -= dt;
    if (this.nightCheck <= 0) {
      this.nightCheck = 5;
      this.nightTarget = this.computeNight();
    }
    if (Math.abs(this.night - this.nightTarget) > 0.001) {
      this.night += (this.nightTarget - this.night) * Math.min(1, dt * 1.8);
      if (Math.abs(this.night - this.nightTarget) <= 0.002) this.night = this.nightTarget;
      this.applyNight();
    }
    if (this.mode === 'hero') {
      if (!quality().reduced) this.yaw = Math.sin(t * 0.07) * 0.42;
    } else if (this.anim) {
      const a = this.anim;
      const k = Math.min(1, (t - a.start) / a.dur);
      const e = ease(k);
      this.target.lerpVectors(a.from.t, a.to.t, e);
      this.zoom = a.from.z + (a.to.z - a.from.z) * e;
      if (k >= 1) this.anim = null;
    } else if (this.inertia) {
      this.target.x += this.vel.x * dt;
      this.target.z += this.vel.y * dt;
      this.clampTarget(this.target);
      this.vel.multiplyScalar(Math.exp(-dt * 5));
      if (this.vel.length() < 0.15) {
        this.inertia = false;
        this.push();
      }
    }
    this.updateCamera();
    const pct = Math.round(this.zoom * 100);
    if (pct !== this.lastZoomPct) {
      this.lastZoomPct = pct;
      this.cb.onZoom?.(pct);
    }
    // Points do not scale with an orthographic camera, so scale them by hand
    const ppu = (this.h / (2 * this.baseHalf)) * this.zoom;
    for (const s of [this.glows, this.smoke, this.incense, this.fireflies, this.petals]) s.setPpu(ppu);
    this.walkers.setView(this.camera, this.mode === 'full' && this.zoom > 1.25);
    this.walkers.update(dt, t);
    this.movers.update(dt, t);
    this.smoke.update(t);
    this.incense.update(t);
    this.glows.update(t);
    this.fireflies.update(t);
    this.petals.update(t);
    this.birds.mesh.visible = this.zoom > 1.3 && this.night < 0.6;
    if (this.birds.mesh.visible) this.birds.update(t);
    this.highlight.update(t);
    this.banners.update(t);
    this.world.water.uniforms.uTime.value = t;
    this.mats.look.uTime.value = t;
    // live realm: real agents, weather, festival, champion
    if (this.heroes) this.heroes.update(dt, t, this.camera, this.w, this.h, ppu);
    if (this.weather) {
      const halfW = (this.baseHalf * (this.w / this.h)) / this.zoom;
      const halfD = this.baseHalf / this.zoom / Math.sin(PITCH);
      this.camRight.setFromMatrixColumn(this.camera.matrixWorld, 0);
      const flash0 = this.weather.flash;
      this.weather.update(dt, t, this.target, halfW, halfD, this.zoom, this.camRight, this.renderer.getPixelRatio(), this.night);
      const moving = lerpLook(this.wx, this.wxTo, Math.min(1, dt * 1.5)) > 0.001;
      if (moving || this.weather.flash > 0 || flash0 > 0) this.applyNight();
    }
    if (this.festive?.on) {
      this.festive.update(t, ppu);
      if (this.festGlow) {
        this.festGlow.setPpu(ppu);
        this.festGlow.update(t);
      }
    }
    this.champion?.update(t);
  }
  private camRight = new THREE.Vector3();
  private ppu() {
    return (this.h / (2 * this.baseHalf)) * this.zoom;
  }

  private applyNight() {
    const n = this.night;
    const m = this.mats;
    this.hemi.color.copy(DAY.hemiSky).lerp(NIGHT.hemiSky, n);
    this.hemi.groundColor.copy(DAY.hemiGround).lerp(NIGHT.hemiGround, n);
    this.hemi.intensity = DAY.hemi + (NIGHT.hemi - DAY.hemi) * n;
    this.sun.color.copy(DAY.sun).lerp(NIGHT.sun, n);
    this.sun.intensity = DAY.sunI + (NIGHT.sunI - DAY.sunI) * n;
    m.win.color.setScalar(DAY.win + (NIGHT.win - DAY.win) * n);
    m.lan.color.copy(DAY.lan).lerp(NIGHT.lan, n);
    m.halo.opacity = 0.1 + n * 0.45;
    m.pools.opacity = n * 0.6;
    m.water.color.set('#6cb9b2').lerp(_w0.set('#1f4a66'), n);
    m.water.emissive.set('#1d5f6a').lerp(_w0.set('#0b1f38'), n);
    const u = this.world.water.uniforms;
    const W = (k: keyof typeof WATER_DAY) => _w0.set(DAY.water[k]).lerp(_w1.set(NIGHT.water[k]), n);
    (u.uShallow.value as THREE.Color).copy(W('shallow'));
    (u.uMid.value as THREE.Color).copy(W('mid'));
    (u.uDeep.value as THREE.Color).copy(W('deep'));
    (u.uFoam.value as THREE.Color).copy(W('foam'));
    (u.uGlint.value as THREE.Color).copy(W('glint'));
    u.uFoamK.value = 1 - n * 0.45;
    u.uNight.value = n;
    u.uCloud.value = 0.2 * (1 - n);
    this.mats.look.uNight.value = n;
    this.mats.look.uCloud.value = 0.2 * (1 - n);
    this.mats.look.uLamp.value = n;
    u.uLamp.value = n;
    // weather on top of day / night: dimmer sun, more cloud shadow, flashes
    const wx = this.wx;
    const fl = this.weather?.flash ?? 0;
    this.hemi.intensity = this.hemi.intensity * wx.hemi + fl * 1.6;
    this.sun.intensity = this.sun.intensity * wx.sun + fl * 1.2;
    const cl = 0.2 * (1 - n) + wx.cloud * (1 - n * 0.6);
    u.uCloud.value = cl;
    this.mats.look.uCloud.value = cl;
    if (this.mode === 'full') {
      const st = this.vars.style;
      st.setProperty('--overcast', wx.overcast.toFixed(3));
      st.setProperty('--fog', wx.fog.toFixed(3));
      st.setProperty('--wet', wx.wet.toFixed(3));
      st.setProperty('--flash', fl.toFixed(3));
    }
    this.festive?.setNight(n);
    this.festGlow?.setOpacity(Math.max(0, n * 1.1 - 0.1));
    this.glows.setOpacity(Math.max(0, n * 1.1 - 0.1));
    this.fireflies.setOpacity(Math.max(0, n * 1.2 - 0.2));
    this.petals.setOpacity(1 - n * 0.5);
    this.smoke.setNight(n);
    this.incense.setNight(n);
    this.birds.setNight(n);
    this.movers.setNight(n);
    this.banners.setNight(n);
    this.vars.style.setProperty('--night', n.toFixed(3));
    this.cb.onNight?.(n);
  }

  private render() {
    this.renderer.render(this.scene, this.camera);
    for (const l of this.labels) {
      const v = this.tmp.copy(l.p).project(this.camera);
      const x = (v.x + 1) * 0.5 * this.w;
      const y = (1 - v.y) * 0.5 * this.h;
      const vis = x > -90 && x < this.w + 90 && y > -40 && y < this.h + 70;
      l.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
      l.el.style.visibility = vis ? 'visible' : 'hidden';
    }
    this.heroes?.layout(this.ppu(), this.w, this.h);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    window.clearTimeout(this.wheelTimer);
    this.io.disconnect();
    this.ro.disconnect();
    document.removeEventListener('visibilitychange', this.onVis);
    this.offQuality();
    if (this.mode === 'full') this.unbindInput();
    this.world.dispose();
    this.walkers.dispose();
    this.movers.dispose();
    this.smoke.dispose();
    this.glows.dispose();
    this.incense.dispose();
    this.fireflies.dispose();
    this.petals.dispose();
    this.birds.dispose();
    this.highlight.dispose();
    this.banners.dispose();
    this.heroes?.dispose();
    this.weather?.dispose();
    this.festive?.dispose();
    this.festGlow?.dispose();
    this.champion?.dispose();
    this.mats.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
