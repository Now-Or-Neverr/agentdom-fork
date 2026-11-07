// Rentable banners: hanging silk standards on poles (pennant) and lacquered
// plaques on small gate frames (banner), placed in each province courtyard.
import * as THREE from 'three';
import type { Banner } from '../../shared/types';
import { PROVINCES, PROVINCE, type ProvinceId } from '../../shared/realm';
import { SITE, height } from './layout';
import { C, Frame, Kit } from './kit';
import { roof } from './arch';
import type { Mats } from './world';

const FACE = 0; // face the viewer (camera looks north)

interface Cloth {
  mesh: THREE.Mesh;
  base: Float32Array;
  kind: Banner['kind'];
  phase: number;
}

// Banner slots ring the front of each settlement (towards the viewer), just
// outside its buildings; further slots form a second, wider ring.
const ANG = [0.42, -0.42, 0.9, -0.9, 1.38, -1.38, 1.86, -1.86, 2.3, -2.3, 2.75, -2.75];
export function slotPos(p: ProvinceId, i: number): [number, number] {
  const s = SITE[p];
  const a = ANG[i % ANG.length] + Math.floor(i / ANG.length) * 0.2;
  let R = s.r + 0.7 + Math.floor(i / ANG.length) * 1.7;
  let x = s.x + Math.sin(a) * R;
  let z = s.z + Math.cos(a) * R;
  for (let k = 0; k < 8 && height(x, z) < 0.25; k++) {
    R -= 0.6;
    x = s.x + Math.sin(a) * R;
    z = s.z + Math.cos(a) * R;
  }
  return [x, z];
}

function wrapText(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number) {
  const words = text.split(' ');
  let line = '';
  const lines: string[] = [];
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (g.measureText(t).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = t;
  }
  if (line) lines.push(line);
  lines.slice(0, 3).forEach((l, i) => g.fillText(l, x, y + (i - (Math.min(3, lines.length) - 1) / 2) * lh));
}

function badge(g: CanvasRenderingContext2D, cx: number, cy: number, s: number, text: string, bg = '#1a171c', fg = '#f6d064') {
  // lacquer seal with the slot number
  g.save();
  g.translate(cx, cy);
  g.fillStyle = bg;
  g.beginPath();
  g.roundRect(-s / 2, -s / 2, s, s, s * 0.2);
  g.fill();
  g.strokeStyle = fg;
  g.lineWidth = s * 0.05;
  g.beginPath();
  g.roundRect(-s / 2 + s * 0.09, -s / 2 + s * 0.09, s * 0.82, s * 0.82, s * 0.14);
  g.stroke();
  g.fillStyle = fg;
  g.font = `800 ${s * 0.34}px Inter, system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 0, s * 0.03);
  g.restore();
}

// Cloud-scroll corner ornament.
function corners(g: CanvasRenderingContext2D, w: number, h: number, m: number, col: string) {
  g.strokeStyle = col;
  g.lineWidth = 5;
  for (const [x, y, sx, sy] of [
    [m, m, 1, 1],
    [w - m, m, -1, 1],
    [m, h - m, 1, -1],
    [w - m, h - m, -1, -1],
  ]) {
    g.beginPath();
    g.moveTo(x, y + sy * 46);
    g.lineTo(x, y);
    g.lineTo(x + sx * 46, y);
    g.stroke();
    g.beginPath();
    g.arc(x + sx * 16, y + sy * 16, 8, 0, Math.PI * 2);
    g.stroke();
  }
}

// Silk standard (tall, province colour with gold border) or lacquered plaque
// (wide, dark with gold frame and lettering).
function clothTexture(kind: Banner['kind'], opt: { accent: string; title?: string; no?: number }) {
  const c = document.createElement('canvas');
  const tall = kind === 'pennant';
  c.width = tall ? 256 : 640;
  c.height = tall ? 736 : 360;
  const g = c.getContext('2d')!;
  const gold = '#f2c96a';
  if (tall) {
    // silk: province colour with a soft sheen
    const grd = g.createLinearGradient(0, 0, c.width, 0);
    grd.addColorStop(0, opt.accent);
    grd.addColorStop(0.5, '#ffffff33');
    grd.addColorStop(1, opt.accent);
    g.fillStyle = opt.accent;
    g.fillRect(0, 0, c.width, c.height);
    g.globalAlpha = 0.18;
    g.fillStyle = grd;
    g.fillRect(0, 0, c.width, c.height);
    g.globalAlpha = 1;
    g.strokeStyle = gold;
    g.lineWidth = 12;
    g.strokeRect(14, 14, c.width - 28, c.height - 28);
    g.lineWidth = 3;
    g.strokeRect(32, 32, c.width - 64, c.height - 64);
    // swallow-tail cut at the bottom
    g.globalCompositeOperation = 'destination-out';
    g.beginPath();
    g.moveTo(c.width / 2 - 70, c.height);
    g.lineTo(c.width / 2, c.height - 70);
    g.lineTo(c.width / 2 + 70, c.height);
    g.closePath();
    g.fill();
    g.globalCompositeOperation = 'source-over';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (opt.title) {
      g.fillStyle = '#fff6e0';
      g.save();
      g.translate(c.width / 2, c.height / 2 - 70);
      g.rotate(-Math.PI / 2);
      g.font = '800 48px Inter, system-ui, sans-serif';
      let t = opt.title.toUpperCase();
      while (g.measureText(t).width > 470 && t.length > 4) t = t.slice(0, -2);
      if (t !== opt.title.toUpperCase()) t = t.trimEnd() + '…';
      g.fillText(t, 0, 0);
      g.restore();
      if (opt.no != null) badge(g, c.width / 2, c.height - 170, 96, `#${opt.no}`);
    } else {
      // decorative: gold diamond and a crown dot
      g.fillStyle = gold;
      g.save();
      g.translate(c.width / 2, c.height / 2 - 40);
      g.rotate(Math.PI / 4);
      g.fillRect(-46, -46, 92, 92);
      g.fillStyle = opt.accent;
      g.fillRect(-26, -26, 52, 52);
      g.restore();
    }
  } else {
    g.fillStyle = '#1d1a20';
    g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = gold;
    g.lineWidth = 14;
    g.strokeRect(8, 8, c.width - 16, c.height - 16);
    g.strokeStyle = opt.accent;
    g.lineWidth = 6;
    g.strokeRect(26, 26, c.width - 52, c.height - 52);
    corners(g, c.width, c.height, 44, gold);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (opt.title) {
      g.fillStyle = gold;
      g.font = '800 52px Inter, system-ui, sans-serif';
      wrapText(g, opt.title.toUpperCase(), c.width / 2 - 55, c.height / 2 + 6, c.width - 250, 58);
      if (opt.no != null) badge(g, c.width - 108, c.height / 2 + 4, 104, `#${opt.no}`, opt.accent, '#fff6e0');
    } else {
      g.fillStyle = gold;
      g.save();
      g.translate(c.width / 2, c.height / 2);
      g.rotate(Math.PI / 4);
      g.fillRect(-44, -44, 88, 88);
      g.restore();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class BannerLayer {
  group = new THREE.Group();
  pickables: THREE.Mesh[] = [];
  private cloths: Cloth[] = [];
  private frames: THREE.Mesh[] = [];
  private disposables: { dispose(): void }[] = [];
  private loader = new THREE.TextureLoader();
  private night = 0;
  private alive = true;
  private uTime = { value: 0 };

  constructor(private mats: Mats) {}

  set(list: Banner[] | undefined) {
    this.clear();
    const items: { p: ProvinceId; i: number; kind: Banner['kind']; b: Banner | null }[] = [];
    if (list && list.length) {
      const counter = new Map<ProvinceId, number>();
      [...list]
        .sort((a, b) => a.no - b.no)
        .forEach((b) => {
          if (!PROVINCE[b.province]) return;
          const i = counter.get(b.province) ?? 0;
          counter.set(b.province, i + 1);
          items.push({ p: b.province, i, kind: b.kind, b });
        });
    } else {
      // no data: one decorative, non-clickable cloth per province
      PROVINCES.forEach((p, idx) => items.push({ p: p.id, i: 0, kind: idx % 2 ? 'pennant' : 'banner', b: null }));
    }
    const k = new Kit();
    for (const it of items) {
      const [x, z] = slotPos(it.p, it.i);
      // seat the frame on the lowest ground under its feet (posts sink into the slope)
      const feet: [number, number][] = it.kind === 'pennant' ? [[0, 0], [-0.21, -0.21], [0.21, -0.21], [-0.21, 0.21], [0.21, 0.21]] : [[0, 0], [-1.42, -0.05], [1.42, -0.05], [-1.57, -0.2], [1.57, 0.1], [-1.27, 0.1], [1.27, -0.2]];
      const base = Math.min(...feet.map(([dx, dz]) => height(x + dx, z + dz)));
      const f = Frame.at(x, base - 0.04, z, FACE);
      const prov = PROVINCE[it.p];
      let geo: THREE.PlaneGeometry;
      let cy: number;
      let cx = 0;
      if (it.kind === 'pennant') {
        // standard: pole with a crossbar, silk hanging from it
        k.box(f, 0, -0.5, 0, 0.42, 0.68, 0.42, C.marble2);
        k.cyl(f, 0, 0.18, 0, 0.045, 3.75, C.woodD, 6);
        k.box(f, 0.45, 3.62, 0, 1.1, 0.07, 0.07, C.woodD);
        for (const ex of [-0.08, 0.98]) k.ball(f, ex, 3.655, 0, 0.07, C.gold);
        k.cone(f, 0, 3.92, 0, 0.08, 0.3, C.gold, 8);
        k.redLantern(f, -0.02, 3.5, 0.12, 0.6);
        geo = new THREE.PlaneGeometry(0.86, 2.47, 1, 10);
        cy = 3.58 - 2.47 / 2;
        cx = 0.47;
      } else {
        // plaque on a small gate frame with a curved roof
        for (const sx of [-1, 1]) {
          k.box(f, sx * 1.42, -0.6, -0.05, 0.3, 0.76, 0.3, C.marble2);
          k.box(f, sx * 1.42, -0.6, -0.05, 0.13, 0.8, 0.13, C.col);
          k.box(f, sx * 1.42, 0.16, -0.05, 0.13, 2.7, 0.13, C.col);
        }
        k.box(f, 0, 2.72, -0.05, 3.2, 0.14, 0.18, C.colD);
        k.box(f, 0, 1.18, -0.05, 2.84, 0.08, 0.1, C.colD);
        k.box(f, 0, 2.86, -0.05, 2.9, 0.12, 0.22, C.bracket);
        k.box(f, 0, 2.0, -0.07, 2.74, 1.58, 0.06, '#1d1a20');
        roof(k, f, 0, 2.98, -0.05, 3.5, 0.7, { h: 0.42, ridge: 3.0, lift: 0.18, flare: 0.12, trim: prov.color, ridgeTrim: false, nu: 6 });
        geo = new THREE.PlaneGeometry(2.6, 1.46, 10, 1);
        cy = 2.0;
      }
      const b = it.b;
      let tex: THREE.Texture;
      if (b) {
        const rented = !!b.renterId && !!b.until && new Date(b.until).getTime() > Date.now();
        tex = clothTexture(it.kind, rented ? { title: b.title || 'Reserved', no: b.no, accent: prov.color } : { title: 'Rent this banner', no: b.no, accent: prov.color });
      } else tex = clothTexture(it.kind, { accent: prov.color });
      // opaque cut-out (no transparent double pass); the silk flutters in the vertex shader
      const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, alphaTest: 0.5 });
      if (it.kind === 'pennant') {
        const phase = { value: x * 0.7 + z };
        mat.onBeforeCompile = (sh) => {
          sh.uniforms.uTime = this.uTime;
          sh.uniforms.uPhase = phase;
          sh.vertexShader = sh.vertexShader
            .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uPhase;')
            .replace(
              '#include <begin_vertex>',
              '#include <begin_vertex>\nfloat hang = (1.235 - position.y) / 2.47;\ntransformed.z += sin(position.y * 2.4 - uTime * 2.6 + uPhase) * 0.09 * hang + sin(position.x * 5.0 - uTime * 3.1) * 0.02 * hang;',
            );
        };
        mat.customProgramCacheKey = () => 'pennant';
      }
      const mesh = new THREE.Mesh(geo, mat);
      mesh.applyMatrix4(f.mat(cx, cy, it.kind === 'pennant' ? 0.04 : 0.0));
      this.group.add(mesh);
      this.disposables.push(geo, mat, tex);
      this.cloths.push({ mesh, base: Float32Array.from(geo.attributes.position.array as Float32Array), kind: it.kind, phase: x * 0.7 + z });
      if (b) {
        mesh.userData.bannerId = b.id;
        this.pickables.push(mesh);
        if (b.imageUrl && b.renterId) {
          this.loader.load(
            b.imageUrl,
            (img) => {
              if (!this.alive || !this.disposables.includes(mat)) {
                img.dispose();
                return;
              }
              img.colorSpace = THREE.SRGBColorSpace;
              img.anisotropy = 4;
              mat.map = img;
              mat.transparent = false;
              mat.needsUpdate = true;
              this.disposables.push(img);
            },
            undefined,
            () => {
              /* keep the text cloth if the image fails */
            },
          );
        }
      }
    }
    const solid = k.s.build(this.mats.s);
    if (solid) {
      solid.castShadow = true;
      this.frames.push(solid);
    }
    const glow = k.glow.build(this.mats.glow);
    if (glow) this.frames.push(glow);
    const halo = k.halo.build(this.mats.halo);
    if (halo) {
      halo.renderOrder = 2;
      this.frames.push(halo);
    }
    this.frames.forEach((m) => this.group.add(m));
    this.setNight(this.night);
  }

  setNight(n: number) {
    this.night = n;
    const v = 1 - n * 0.12;
    for (const c of this.cloths) (c.mesh.material as THREE.MeshBasicMaterial).color.setRGB(v, v, v);
  }

  update(t: number) {
    this.uTime.value = t;
  }

  clear() {
    this.group.clear();
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
    this.cloths = [];
    this.pickables = [];
    this.frames.forEach((m) => m.geometry.dispose());
    this.frames = [];
  }

  dispose() {
    this.alive = false;
    this.clear();
  }
}
