// Small procedural textures: soft dot, radial fade and the province icon atlas.
import * as THREE from 'three';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PROVINCES, type ProvinceId } from '../../shared/realm';
import { provinceIcon } from '../components/ProvinceIcon';
import { neon } from './kit';

let dotTex: THREE.Texture | null = null;
// Soft round sprite used by Points and light pools (shared, never disposed).
export function softDot() {
  if (dotTex) return dotTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  dotTex = new THREE.CanvasTexture(c);
  return dotTex;
}

// Alpha map that fades a disc to transparent at its rim (sea edge).
export function radialFade(inner = 0.55) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, '#fff');
  grd.addColorStop(inner, '#fff');
  grd.addColorStop(1, '#000');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

const CELL = 128;
export const ATLAS_N = PROVINCES.length;

// UV rect of a province icon in the sign atlas.
export function signUV(id: ProvinceId): [number, number, number, number] {
  const i = PROVINCES.findIndex((p) => p.id === id);
  return [i / ATLAS_N, 0, (i + 1) / ATLAS_N, 1];
}

// Dark rounded sign plate with a neon border and the province icon, one cell per province.
export function signAtlas() {
  const c = document.createElement('canvas');
  c.width = CELL * ATLAS_N;
  c.height = CELL;
  const g = c.getContext('2d')!;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  let alive = true;
  PROVINCES.forEach((p, i) => {
    const col = '#' + neon(p.color).getHexString();
    const x = i * CELL;
    g.fillStyle = '#15161c';
    g.beginPath();
    g.roundRect(x + 6, 6, CELL - 12, CELL - 12, 22);
    g.fill();
    g.strokeStyle = col;
    g.lineWidth = 7;
    g.beginPath();
    g.roundRect(x + 10, 10, CELL - 20, CELL - 20, 19);
    g.stroke();
    try {
      const svg = renderToStaticMarkup(createElement(provinceIcon(p.id), { size: 72, color: col, strokeWidth: 2.4 }));
      const img = new Image();
      img.onload = () => {
        if (!alive) return;
        g.shadowColor = col;
        g.shadowBlur = 10;
        g.drawImage(img, x + (CELL - 72) / 2, (CELL - 72) / 2, 72, 72);
        g.shadowBlur = 0;
        tex.needsUpdate = true;
      };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    } catch {
      /* plate without icon */
    }
  });
  return {
    tex,
    dispose() {
      alive = false;
      tex.dispose();
    },
  };
}
