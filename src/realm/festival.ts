// Festival dressing for real public holidays (Nager.Date via /api/festival):
// strings of red lanterns across every guild, red and gold banners along the
// imperial way, and fireworks over the bay at night. Built only when a holiday
// is on. Also the champion standard: a tall banner at the Throne in the colour
// of the guild that leads this week's rivalry (from /api/realm/live).
import * as THREE from 'three';
import { PROVINCE, type ProvinceId } from '../../shared/realm';
import { Batch, C, FX, Frame, G, rng } from './kit';
import { SITE, SITES, height } from './layout';

const PI = Math.PI;

function lanternGeo(ground: (x: number, z: number) => number) {
  const poles = new Batch();
  const lamps = new Batch();
  const glow: THREE.Vector3[] = [];
  const r = rng(808);
  for (const s of SITES) {
    const R = s.id === 'throne' ? 13.6 : s.r + 0.5;
    const strings = s.id === 'throne' ? 4 : 2;
    for (let k = 0; k < strings; k++) {
      // front arc of the settlement (towards the viewer)
      const a0 = -1.05 + (k / strings) * 2.1 + 0.08;
      const a1 = a0 + 2.1 / strings - 0.16;
      const ends = [a0, a1].map((a) => {
        const x = s.x + Math.sin(a) * R;
        const z = s.z + Math.cos(a) * R;
        return new THREE.Vector3(x, Math.max(0.3, ground(x, z)) + 2.3, z);
      });
      for (const e of ends) {
        poles.add(G.cyl6, C.col, new Frame().mat(e.x, e.y - 1.2, e.z, 0, 0.06, 2.4, 0.06));
        poles.add(G.sphL, C.gold, new Frame().mat(e.x, e.y + 0.05, e.z, 0, 0.09, 0.09, 0.09));
      }
      const [A, B] = ends;
      const len = A.distanceTo(B);
      const n = Math.max(3, Math.floor(len / 0.75));
      const sag = Math.min(0.9, len * 0.08);
      let prev = A.clone();
      for (let i = 1; i <= n + 1; i++) {
        const t = i / (n + 1);
        const p = new THREE.Vector3().lerpVectors(A, B, t);
        p.y -= Math.sin(t * PI) * sag;
        // rope segment
        const mid = prev.clone().add(p).multiplyScalar(0.5);
        const d = p.clone().sub(prev);
        const m = new THREE.Matrix4().lookAt(prev, p, new THREE.Vector3(0, 1, 0));
        m.setPosition(mid);
        m.multiply(new THREE.Matrix4().makeScale(0.02, 0.02, d.length()));
        poles.add(G.box, '#3a2a20', m);
        prev = p;
        if (i <= n) {
          const col = r() < 0.18 ? '#ffb43a' : '#e8402e';
          lamps.add(G.sph, col, new Frame().mat(p.x, p.y - 0.24, p.z, 0, 0.15, 0.19, 0.15));
          lamps.add(G.cyl8, '#ffd36b', new Frame().mat(p.x, p.y - 0.06, p.z, 0, 0.07, 0.05, 0.07));
          lamps.add(G.cyl8, '#ffd36b', new Frame().mat(p.x, p.y - 0.43, p.z, 0, 0.07, 0.04, 0.07));
          poles.add(G.box, '#c99a2e', new Frame().mat(p.x, p.y - 0.55, p.z, 0, 0.015, 0.16, 0.015));
          glow.push(new THREE.Vector3(p.x, p.y - 0.24, p.z));
        }
      }
    }
  }
  // red and gold banners along the imperial way at the Throne
  const t = SITE.throne;
  const f = Frame.at(t.x, t.h, t.z, t.ry);
  for (const sx of [-1, 1])
    for (let i = 0; i < 3; i++) {
      const lx = sx * (2.6 + i * 0.1);
      const lz = 6.4 + i * 1.6;
      const w = f.pt(lx, 0, lz);
      const y = height(w.x, w.z) - t.h;
      const col = i % 2 ? C.gold : '#c0392b';
      poles.add(G.cyl6, C.woodD, f.mat(lx, y + 1.6, lz, 0, 0.05, 3.2, 0.05));
      poles.add(G.box, C.gold, f.mat(lx, y + 3.12, lz + 0.0, 0, 0.75, 0.05, 0.05));
      const cloth = (x: number, yy: number) => FX.cloth + Math.min(0.99, Math.abs(yy - (y + 3.1)) / 2.2) * 0.5 + x * 0;
      poles.add(G.box, col, f.mat(lx, y + 2.05, lz + 0.03, 0, 0.62, 2.0, 0.02), cloth);
      poles.add(G.box, i % 2 ? '#c0392b' : C.gold, f.mat(lx, y + 2.05, lz + 0.045, 0, 0.5, 1.75, 0.01), cloth);
    }
  return { poles, lamps, glow };
}

// Fireworks: shells launched from around the bay, each a burst of sparks that
// expands, falls and fades (all on the GPU).
function fireworks() {
  const SHELLS = 9;
  const PER = 130;
  const n = SHELLS * PER;
  const pos = new Float32Array(n * 3);
  const shell = new Float32Array(n);
  const idx = new Float32Array(n);
  const r = rng(5150);
  for (let i = 0; i < n; i++) {
    // random unit direction
    const u = r() * 2 - 1;
    const a = r() * PI * 2;
    const q = Math.sqrt(1 - u * u);
    pos.set([Math.cos(a) * q, u, Math.sin(a) * q], i * 3);
    shell[i] = Math.floor(i / PER);
    idx[i] = i % PER;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aShell', new THREE.BufferAttribute(shell, 1));
  g.setAttribute('aIdx', new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPpu: { value: 20 }, uOpacity: { value: 0 } },
    vertexShader: /* glsl */ `
uniform float uTime;
uniform float uPpu;
uniform float uOpacity;
attribute float aShell;
attribute float aIdx;
varying float vA;
varying vec3 vC;
float h1(float n) { return fract(sin(n * 78.233) * 43758.5453); }
void main() {
  float period = 4.2 + h1(aShell * 3.7) * 1.6;
  float tt = uTime + aShell * 1.37;
  float cyc = floor(tt / period);
  float life = fract(tt / period);
  float s = cyc * 17.0 + aShell * 5.0;
  vec3 launch = vec3((h1(s) - 0.5) * 64.0, 0.0, -14.0 + (h1(s + 1.0) - 0.5) * 30.0);
  float peak = 13.0 + h1(s + 2.0) * 7.0;
  float R = 5.5 + h1(s + 3.0) * 3.5;
  float hue = h1(s + 4.0);
  vec3 col = hue < 0.3 ? vec3(1.0, 0.78, 0.32) : hue < 0.55 ? vec3(1.0, 0.35, 0.28) : hue < 0.75 ? vec3(0.45, 1.0, 0.75) : vec3(1.0, 0.55, 0.85);
  vec3 p;
  float sz;
  if (life < 0.2) {
    float k = life / 0.2;
    p = launch + vec3(0.0, peak * (1.0 - (1.0 - k) * (1.0 - k)), 0.0) - vec3(0.0, aIdx * 0.05, 0.0);
    vA = aIdx < 6.0 ? (1.0 - aIdx / 6.0) : 0.0;
    vC = vec3(1.0, 0.85, 0.55);
    sz = 0.45;
  } else {
    float k = (life - 0.2) / 0.8;
    float e = 1.0 - pow(1.0 - k, 3.0);
    p = launch + vec3(0.0, peak, 0.0) + position * R * e * (0.85 + h1(aIdx + s) * 0.3) - vec3(0.0, k * k * 3.5, 0.0);
    vA = (1.0 - k) * (0.6 + 0.4 * step(0.5, fract(uTime * 9.0 + aIdx * 0.37)));
    vC = mix(vec3(1.0, 0.95, 0.8), col, smoothstep(0.0, 0.25, k));
    sz = 0.75 * (1.0 - k * 0.45);
  }
  vA *= uOpacity;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = sz * uPpu + 4.0;
}`,
    fragmentShader: /* glsl */ `
varying float vA;
varying vec3 vC;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = (pow(max(0.0, 1.0 - d), 2.0) + smoothstep(0.3, 0.0, d)) * vA;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vC * a * 1.6, a);
}`,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 7;
  return { pts, mat };
}

export class Festive {
  group = new THREE.Group();
  on = false;
  glowPts: THREE.Vector3[] = [];
  private built = false;
  private lampMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  private meshes: THREE.Mesh[] = [];
  private fw: { pts: THREE.Points; mat: THREE.ShaderMaterial } | null = null;
  private night = 0;

  constructor(
    private ground: (x: number, z: number) => number,
    private solid: THREE.Material,
  ) {
    this.group.visible = false;
  }

  set(on: boolean) {
    this.on = on;
    if (on && !this.built) this.build();
    this.group.visible = on;
  }
  private build() {
    this.built = true;
    const { poles, lamps, glow } = lanternGeo(this.ground);
    const pm = poles.build(this.solid);
    const lm = lamps.build(this.lampMat);
    for (const m of [pm, lm]) {
      if (!m) continue;
      m.castShadow = false;
      this.meshes.push(m);
      this.group.add(m);
    }
    this.glowPts = glow;
    this.fw = fireworks();
    this.group.add(this.fw.pts);
    this.setNight(this.night);
  }
  setNight(n: number) {
    this.night = n;
    this.lampMat.color.setScalar(0.9 + n * 0.9);
    if (this.fw) {
      this.fw.mat.uniforms.uOpacity.value = Math.max(0, (n - 0.35) / 0.65);
      this.fw.pts.visible = n > 0.36;
    }
  }
  update(t: number, ppu: number) {
    if (!this.on || !this.fw) return;
    this.fw.mat.uniforms.uTime.value = t;
    this.fw.mat.uniforms.uPpu.value = ppu;
  }
  dispose() {
    this.meshes.forEach((m) => m.geometry.dispose());
    this.lampMat.dispose();
    if (this.fw) {
      this.fw.pts.geometry.dispose();
      this.fw.mat.dispose();
    }
  }
}

// ---------- champion standard ----------
function drawStandard(id: ProvinceId, icon: HTMLImageElement | null) {
  const p = PROVINCE[id];
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 512;
  const g = c.getContext('2d')!;
  // swallowtail silk in the guild colour with a gold trim
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(256, 0);
  g.lineTo(256, 512);
  g.lineTo(128, 440);
  g.lineTo(0, 512);
  g.closePath();
  const grd = g.createLinearGradient(0, 0, 256, 0);
  grd.addColorStop(0, p.color);
  grd.addColorStop(0.5, '#' + new THREE.Color(p.color).lerp(new THREE.Color('#ffffff'), 0.12).getHexString());
  grd.addColorStop(1, p.color);
  g.fillStyle = grd;
  g.fill();
  g.save();
  g.clip();
  g.lineWidth = 14;
  g.strokeStyle = '#f2c14e';
  g.stroke();
  g.restore();
  g.strokeStyle = 'rgba(255,240,200,0.75)';
  g.lineWidth = 3;
  g.strokeRect(22, 22, 212, 380);
  // title
  g.fillStyle = '#fff6dc';
  g.textAlign = 'center';
  g.font = '700 22px Georgia, serif';
  g.fillText('CHAMPION', 128, 66);
  g.font = '600 15px Georgia, serif';
  g.fillText('OF THE WEEK', 128, 88);
  // emblem
  g.fillStyle = 'rgba(20,16,24,0.82)';
  g.beginPath();
  g.arc(128, 200, 74, 0, PI * 2);
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = '#f2c14e';
  g.stroke();
  if (icon) g.drawImage(icon, 128 - 50, 200 - 50, 100, 100);
  // guild name
  g.fillStyle = '#fff6dc';
  g.font = '700 30px Georgia, serif';
  const words = p.name.replace(/^The /, '').split(' ');
  words.slice(0, 2).forEach((w, i) => g.fillText(w.toUpperCase(), 128, 320 + i * 36 - (words.length > 1 ? 0 : -18)));
  return c;
}

export class Champion {
  group = new THREE.Group();
  id: ProvinceId | null = null;
  private tex: THREE.CanvasTexture | null = null;
  private cloth: THREE.Mesh;
  private clothMat: THREE.MeshLambertMaterial;
  private pole: THREE.Mesh | null = null;
  private base: Float32Array;
  constructor(solid: THREE.Material) {
    const t = SITE.throne;
    const f = Frame.at(t.x, t.h, t.z, t.ry);
    // tall lacquered pole with a gold finial, on a stone plinth, beside the gate
    const lx = -5.6;
    const lz = 12.6;
    const w = f.pt(lx, 0, lz);
    const y = height(w.x, w.z);
    const b = new Batch();
    b.add(G.box, C.marble2, new Frame().mat(w.x, y + 0.25, w.z, 0, 1.1, 0.5, 1.1));
    b.add(G.box, C.marble, new Frame().mat(w.x, y + 0.55, w.z, 0, 0.8, 0.2, 0.8));
    b.add(G.cyl8, C.col, new Frame().mat(w.x, y + 5.6, w.z, 0, 0.12, 10.4, 0.12));
    b.add(G.box, C.gold, new Frame().mat(w.x + 1.3, y + 10.5, w.z, 0, 2.8, 0.1, 0.1));
    b.add(G.sph, C.gold, new Frame().mat(w.x, y + 10.85, w.z, 0, 0.26, 0.32, 0.26));
    b.add(G.cone8, C.gold, new Frame().mat(w.x, y + 11.3, w.z, 0, 0.13, 0.5, 0.13));
    this.pole = b.build(solid);
    if (this.pole) {
      this.pole.castShadow = true;
      this.group.add(this.pole);
    }
    const cg = new THREE.PlaneGeometry(2.6, 5.2, 6, 12);
    cg.translate(1.3, -2.6, 0);
    this.base = (cg.attributes.position.array as Float32Array).slice();
    this.clothMat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, transparent: true, alphaTest: 0.5 });
    this.cloth = new THREE.Mesh(cg, this.clothMat);
    this.cloth.position.set(w.x + 0.07, y + 10.45, w.z + 0.08);
    this.cloth.castShadow = true;
    this.group.add(this.cloth);
    this.group.visible = false;
  }
  set(id: ProvinceId | null, iconSvg?: string) {
    this.id = id;
    this.group.visible = !!id;
    if (!id) return;
    const apply = (img: HTMLImageElement | null) => {
      if (this.id !== id) return;
      this.tex?.dispose();
      this.tex = new THREE.CanvasTexture(drawStandard(id, img));
      this.tex.colorSpace = THREE.SRGBColorSpace;
      this.tex.anisotropy = 4;
      this.clothMat.map = this.tex;
      this.clothMat.needsUpdate = true;
    };
    apply(null);
    if (iconSvg) {
      const img = new Image();
      img.onload = () => apply(img);
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(iconSvg);
    }
  }
  update(t: number) {
    if (!this.group.visible) return;
    // silk ripples in the wind, more towards the free edge
    const pos = this.cloth.geometry.attributes.position as THREE.BufferAttribute;
    const a = pos.array as Float32Array;
    for (let i = 0; i < a.length; i += 3) {
      const x = this.base[i];
      const yy = this.base[i + 1];
      const k = x / 2.6;
      a[i + 2] = this.base[i + 2] + Math.sin(t * 2.2 + x * 2.4 + yy * 0.6) * 0.16 * k + Math.sin(t * 1.3 + yy) * 0.05 * k;
    }
    pos.needsUpdate = true;
  }
  dispose() {
    this.tex?.dispose();
    this.cloth.geometry.dispose();
    this.clothMat.dispose();
    this.pole?.geometry.dispose();
  }
}
