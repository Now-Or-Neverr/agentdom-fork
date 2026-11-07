import * as THREE from 'three';

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const span = (p: number, a: number, b: number) => clamp01((p - a) / (b - a));
export const smooth = (x: number) => x * x * (3 - 2 * x);
export const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
export const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export interface Orbit {
  tx: number;
  ty: number;
  tz: number;
  dist: number;
  pitch: number;
  yaw: number;
}

export function mixOrbit(a: Orbit, b: Orbit, t: number): Orbit {
  return {
    tx: lerp(a.tx, b.tx, t),
    ty: lerp(a.ty, b.ty, t),
    tz: lerp(a.tz, b.tz, t),
    dist: lerp(a.dist, b.dist, t),
    pitch: lerp(a.pitch, b.pitch, t),
    yaw: lerp(a.yaw, b.yaw, t),
  };
}

const _look = new THREE.Vector3();
export function placeOrbit(cam: THREE.PerspectiveCamera, o: Orbit) {
  _look.set(o.tx, o.ty, o.tz);
  cam.position.set(o.tx + Math.sin(o.yaw) * Math.cos(o.pitch) * o.dist, o.ty + Math.sin(o.pitch) * o.dist, o.tz + Math.cos(o.yaw) * Math.cos(o.pitch) * o.dist);
  cam.lookAt(_look);
  cam.userData.look = _look.clone();
}

/** Project a world point to CSS pixels of a w x h viewport; z > 1 means behind the camera. */
export function project(cam: THREE.Camera, p: THREE.Vector3, w: number, h: number, out = new THREE.Vector3()) {
  out.copy(p).project(cam);
  const z = out.z;
  out.set((out.x + 1) * 0.5 * w, (1 - out.y) * 0.5 * h, z);
  return out;
}
