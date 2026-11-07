// Tiny color helpers for the citizen / creature characters.

function rgb(c: string): [number, number, number] {
  let m = c.replace('#', '').trim();
  if (m.length === 3) m = m.split('').map((x) => x + x).join('');
  const n = parseInt(m.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const hex2 = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');

export function mix(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  return '#' + hex2(x[0] + (y[0] - x[0]) * t) + hex2(x[1] + (y[1] - x[1]) * t) + hex2(x[2] + (y[2] - x[2]) * t);
}

export const lighten = (c: string, t: number) => mix(c, '#ffffff', t);
export const darken = (c: string, t: number) => mix(c, '#1b1530', t);

function toHsl(c: string): [number, number, number] {
  const [r, g, b] = rgb(c).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return [h, s, l];
}

function fromHsl(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return '#' + hex2(f(0) * 255) + hex2(f(8) * 255) + hex2(f(4) * 255);
}

// Saturated "clay toy" version of a colour, optionally hue-shifted.
export function vivid(c: string, shift = 0, light = 0.55): string {
  const [h, s, l] = toHsl(c);
  return fromHsl(h + shift, Math.max(0.62, Math.min(0.9, s * 1.15)), Math.max(light - 0.07, Math.min(light + 0.05, l)));
}

export const PURPLE = '#6C3FD1';
export const GOLD = '#F2B53A';
export const INK = '#1B1530';

// Muted costume tone: keeps the hue, clamps saturation, sets lightness (flat illustration palette).
export function tone(c: string, light: number, sMin = 0.3, sMax = 0.6): string {
  const [h, s] = toHsl(c);
  return fromHsl(h, Math.max(sMin, Math.min(sMax, s)), light);
}
