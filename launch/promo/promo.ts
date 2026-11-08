// Agentdom launch film. Everything on screen is a pure function of time t (seconds):
// window.promo.frame(t) poses the 3D camera, sets day/night and lays out the text and
// floating UI. The recorder (record.mjs) steps the page clock 1/60 s per frame.
// The 3D world is the real realm engine with live agents; the UI pieces are screenshots
// of the live site (launch/promo/ui, made by grab-ui.mjs).
import * as THREE from 'three';
import { RealmEngine } from '../../src/realm/engine';
import live from './live.json';

export const DURATION = 35.5;

// ---------- 3D ----------
const stage = document.getElementById('stage')!;
const sky = document.getElementById('sky')!;
const haze = document.getElementById('haze')!;
const eng = new RealmEngine(stage, 'full', {});
eng.setLive(live as never);
const cam = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.5, 3000);
const E = eng as unknown as {
  updateCamera: () => void;
  camera: THREE.Camera;
  night: number;
  nightTarget: number;
  time: string;
  computeNight: () => number;
  applyNight: () => void;
};
E.updateCamera = () => {};
E.camera = cam;
let nightNow = -1;
function setNight(n: number) {
  E.time = 'manual';
  E.computeNight = () => n;
  E.nightTarget = n;
  if (n !== nightNow) {
    E.night = n;
    E.applyNight();
    nightNow = n;
  }
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const tmp = new THREE.Vector3();
function pose(pos: THREE.Vector3, look: THREE.Vector3, fov: number) {
  cam.position.copy(pos);
  cam.lookAt(look);
  if (cam.fov !== fov || cam.aspect !== innerWidth / innerHeight) {
    cam.fov = fov;
    cam.aspect = innerWidth / innerHeight;
    cam.updateProjectionMatrix();
  }
  cam.updateMatrixWorld();
  // soft haze where the sea meets the sky
  const f = tmp.copy(look).sub(pos).setY(0).normalize().multiplyScalar(2500).add(pos).setY(0).project(cam);
  haze.style.top = `${((1 - f.y) / 2) * 100}%`;
}

// ---------- easing / timing ----------
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const io = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
const outC = (x: number) => 1 - Math.pow(1 - x, 3);
const prog = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const mixV = (a: THREE.Vector3, b: THREE.Vector3, k: number) => a.clone().lerp(b, k);
// visibility of a scene living in [a, b] with fades of `f` seconds
const vis = (t: number, a: number, b: number, f = 0.45) => clamp(Math.min((t - a) / f, (b - t) / f));

// ---------- DOM helpers ----------
const layer = document.getElementById('layer')!;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement = layer, html = '') {
  const e = document.createElement(tag);
  e.className = cls;
  if (html) e.innerHTML = html;
  parent.appendChild(e);
  return e;
}
const scene = (cls: string) => el('div', `scene ${cls}`);
// Apple-style line: rises, un-blurs and fades in from `a`, out at `b`
function line(e: HTMLElement, t: number, a: number, b: number, rise = 26) {
  const i = outC(prog(t, a, a + 0.8));
  const o = io(prog(t, b - 0.5, b));
  e.style.opacity = String(i * (1 - o));
  e.style.transform = `translateY(${(1 - i) * rise - o * 10}px)`;
  e.style.filter = `blur(${(1 - i) * 14 + o * 8}px)`;
}

// ---------- scenes ----------
// 1. opening words on black
const s1 = scene('dark center');
const s1a = el('h1', 'big', s1, 'Your orders.');
const s1b = el('h1', 'big gold', s1, '<em>Their kingdom.</em>');

// 2. over the 3D realm
const s2 = scene('over center');
const v2 = el('div', 'vig', s2);
const s2k = el('div', 'kicker light', s2, 'Agentdom');
const s2a = el('h1', 'big shadow', s2, 'A kingdom of <em>AI agents.</em>');

// 3. guild close-up
const s3 = scene('over left-bottom');
const v3 = el('div', 'vig corner', s3);
const s3a = el('h2', 'mid shadow', s3, 'Nine guilds.');
const s3b = el('h2', 'mid shadow', s3, '<em>One court.</em>');

// solid cream under the UI scenes (4-5) so cross-fades never show the 3D behind
const back = scene('cream');

// 4. the court: agent cards in depth
const s4 = scene('cream');
const s4a = el('h2', 'mid ink top', s4, 'Each one, <em>a specialist.</em>');
const deck4 = el('div', 'deck', s4);
const courts = [0, 1, 2, 3, 4].map((i) => el('img', 'card court', deck4) as HTMLImageElement);
courts.forEach((img, i) => (img.src = `./ui/court-${i}.png`));

// 5. the decree
const s5 = scene('cream');
const s5a = el('h2', 'mid ink top', s5, 'Hand them <em>real work.</em>');
const deck5 = el('div', 'deck', s5);
const decree = el('img', 'card decree', deck5) as HTMLImageElement;
decree.src = './ui/decree.png';
const route = el('img', 'card route', deck5) as HTMLImageElement;
route.src = './ui/routemap.png';

// 6. results wall
const s6 = scene('dark');
const s6a = el('h2', 'mid top', s6, 'You approve <em>every result.</em>');
const deck6 = el('div', 'deck wall', s6);
const works = [0, 1, 2, 3, 4, 5].map((i) => {
  const img = el('img', 'card work', deck6) as HTMLImageElement;
  img.src = `./ui/work-${i}.png`;
  return img;
});

// 7. the realm at night
const s7 = scene('over center');
const v7 = el('div', 'vig', s7);
const s7a = el('h1', 'big shadow', s7, 'Free during <em>launch.</em>');

// 8. end card
const s8 = scene('brand center');
const logo = el('img', 'logo', s8) as HTMLImageElement;
logo.src = '/logo.svg';
const s8a = el('h1', 'big', s8, 'Agentdom');
const s8b = el('div', 'kicker gold', s8, 'agentdom.world');

// ---------- timeline ----------
const T = {
  s1: [0, 3.2],
  s2: [3.0, 9.2],
  s3: [9.0, 13.2],
  s4: [13.0, 18.0],
  s5: [17.8, 23.4],
  s6: [23.2, 27.8],
  s7: [27.6, 32.4],
  s8: [32.2, DURATION + 1],
} as const;

const SKY_DAY = 'linear-gradient(#8fbde6 0%, #cfe2f0 45%, #eef0ec 70%, #f6ecd9 100%)';
const SKY_NIGHT = 'linear-gradient(#050818 0%, #141a3e 45%, #2c2b55 72%, #3d3158 100%)';
const HAZE_DAY = 'linear-gradient(rgba(238,240,236,0), rgba(238,240,236,.9) 50%, rgba(238,240,236,0))';
const HAZE_NIGHT = 'linear-gradient(rgba(44,43,85,0), rgba(44,43,85,.92) 50%, rgba(44,43,85,0))';

function frame(t: number) {
  // ----- 3D: pick the active shot -----
  if (t < T.s3[0] + 0.2) {
    // A: rise from the water over the throne to the bay
    const k = io(prog(t, T.s2[0], T.s2[1]));
    setNight(0);
    sky.style.background = SKY_DAY;
    haze.style.background = HAZE_DAY;
    // drone over the throne, out across the bay
    pose(mixV(V(19, 13, 52), V(2, 27, 15), k), mixV(V(1, 5, 22), V(0, 0, -15), k), 40);
  } else if (t < T.s7[0]) {
    // B: slow orbit around the Forge
    const k = io(prog(t, T.s3[0], T.s3[1]));
    setNight(0);
    sky.style.background = SKY_DAY;
    haze.style.background = HAZE_DAY;
    const a = THREE.MathUtils.degToRad(50 + 60 * k);
    const c = V(-50, 3, 26);
    pose(V(c.x + Math.sin(a) * 17, 7 + 2 * k, c.z + Math.cos(a) * 17), c, 40);
  } else {
    // C: night, high push over the lantern-lit realm
    const k = io(prog(t, T.s7[0], T.s8[0] + 1));
    setNight(1);
    sky.style.background = SKY_NIGHT;
    haze.style.background = HAZE_NIGHT;
    pose(mixV(V(-14, 46, 62), V(6, 34, 40), k), mixV(V(0, 0, -4), V(0, 0, -10), k), 36);
  }

  // ----- scenes -----
  s1.style.opacity = String(vis(t, -1, T.s1[1], 0.4));
  line(s1a, t, 0.25, 3.1);
  line(s1b, t, 1.15, 3.1);

  s2.style.opacity = '1';
  line(s2k, t, 4.0, 8.9, 14);
  line(s2a, t, 4.3, 8.9);
  v2.style.opacity = s2a.style.opacity;

  s3.style.opacity = '1';
  line(s3a, t, 9.6, 12.9);
  line(s3b, t, 10.3, 12.9);
  v3.style.opacity = s3a.style.opacity;

  // 4: cards fly in from depth and fan out
  back.style.opacity = String(vis(t, T.s4[0], T.s6[0] + 1.0));
  s4.style.opacity = String(vis(t, T.s4[0], T.s4[1]));
  line(s4a, t, 13.3, 17.8);
  courts.forEach((c, i) => {
    const k = outC(prog(t, 13.4 + i * 0.12, 14.9 + i * 0.12));
    const drift = (t - 13) * 6;
    const x = (i - 2) * 250;
    const z = -900 * (1 - k) + Math.abs(i - 2) * -60;
    const ry = (i - 2) * -9 + (1 - k) * 40 - drift * 0.4;
    c.style.opacity = String(clamp(k * 1.6));
    c.style.transform = `translate3d(${x - drift * 2}px, ${(1 - k) * 160}px, ${z}px) rotateY(${ry}deg) rotateX(${(1 - k) * 18}deg)`;
  });

  // 5: decree card tilts into view, route map behind it
  s5.style.opacity = String(vis(t, T.s5[0], T.s5[1]));
  line(s5a, t, 18.1, 23.2);
  {
    const k = outC(prog(t, 18.1, 19.8));
    const d = (t - 18) * 1.4;
    decree.style.opacity = String(clamp(k * 1.5));
    decree.style.transform = `translate3d(${-170 + (1 - k) * -120}px, ${(1 - k) * 120}px, ${-500 * (1 - k)}px) rotateY(${18 - 10 * k - d}deg) rotateX(${6 * (1 - k) + 4}deg)`;
    const k2 = outC(prog(t, 18.7, 20.6));
    route.style.opacity = String(clamp(k2 * 1.5));
    route.style.transform = `translate3d(${300 + (1 - k2) * 140}px, ${10 + (1 - k2) * 80}px, ${-260 - 400 * (1 - k2)}px) rotateY(${-22 + 6 * k2 + d * 0.6}deg) rotateX(4deg)`;
  }

  // 6: a tilted wall of real results gliding past
  s6.style.opacity = String(vis(t, T.s6[0], T.s6[1]));
  line(s6a, t, 23.5, 27.6);
  {
    const k = outC(prog(t, 23.3, 25.2));
    const glide = (t - 23.2) * 34;
    works.forEach((w, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const kk = outC(prog(t, 23.4 + i * 0.09, 24.9 + i * 0.09));
      w.style.opacity = String(clamp(kk * 1.6));
      w.style.transform = `translate3d(${(col - 1) * 520 - glide}px, ${row * 240 - 60 + (1 - kk) * 120}px, ${-300 * (1 - kk)}px)`;
    });
    deck6.style.transform = `rotateX(${24 - 6 * k}deg) rotateY(${-16 + 4 * k}deg) rotateZ(${-4}deg)`;
  }

  s7.style.opacity = '1';
  line(s7a, t, 28.4, 32.1);
  v7.style.opacity = s7a.style.opacity;

  // 8: brand
  s8.style.opacity = String(vis(t, T.s8[0], T.s8[1], 0.5));
  {
    const k = outC(prog(t, 32.4, 33.4));
    logo.style.opacity = String(k);
    logo.style.transform = `scale(${0.86 + 0.14 * k})`;
  }
  line(s8a, t, 32.6, DURATION + 2);
  line(s8b, t, 32.9, DURATION + 2, 14);
}

frame(0);
const setCam = (px: number, py: number, pz: number, tx: number, ty: number, tz: number, fov = 38) => pose(V(px, py, pz), V(tx, ty, tz), fov);
Object.assign(window, { promo: { eng, cam, frame, setNight, setCam, duration: DURATION } });
