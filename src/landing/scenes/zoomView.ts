// "Built around guilds": the camera starts on the Imperial Throne palace, then
// rises and swings around the bay while the guild settlements are revealed.
import * as THREE from 'three';
import type { ProvinceId } from '../../../shared/realm';
import { acquireBay, releaseBay, DAY, type Bay, type BayView } from './bay';
import { easeInOut, mixOrbit, placeOrbit, project, span, type Orbit } from './cam';

export interface Anchor {
  id: ProvinceId;
  x: number;
  y: number;
  z: number; // >1 when behind the camera
}

export interface ZoomOpts {
  el: HTMLElement;
  progress: () => number;
  onFrame: (anchors: Anchor[], w: number, h: number) => void;
}

// wide screens: start on the palace, end on the whole bay
const START: Orbit = { tx: 0, ty: 3.2, tz: 27, dist: 52, pitch: 0.66, yaw: 0.32 };
const MID: Orbit = { tx: -1, ty: 2.2, tz: 22, dist: 78, pitch: 0.78, yaw: 0.08 };
const END: Orbit = { tx: -24, ty: 0, tz: -8, dist: 185, pitch: 0.8, yaw: -0.15 };
// phones (portrait): a steeper, centred view with room for the scroll on top
const END_P: Orbit = { tx: -5, ty: 0, tz: -20, dist: 300, pitch: 1.12, yaw: 0 };

export async function mountZoom(o: ZoomOpts) {
  let bay: Bay;
  try {
    bay = await acquireBay(2000);
  } catch {
    return () => {};
  }
  let alive = true;
  const ids = [...bay.world.labelPos.keys()];
  const pts = ids.map((id) => bay.world.labelPos.get(id)!.clone());
  const tmp = new THREE.Vector3();
  const anchors: Anchor[] = ids.map((id) => ({ id, x: 0, y: 0, z: 0 }));

  const view: BayView = {
    el: o.el,
    mood: DAY,
    frame(cam, t, _dt, w, h) {
      const p = bay.still ? 1 : o.progress();
      const a = easeInOut(span(p, 0, 0.42));
      const b = easeInOut(span(p, 0.3, 0.92));
      const aspect = w / h;
      const portrait = aspect < 1;
      // narrow screens: pull back so the frame still holds the palace / kingdom
      const fit = portrait ? 1.9 : aspect < 1.5 ? Math.min(1.6, Math.pow(1.5 / aspect, 0.75)) : 1;
      const S = { ...START, dist: START.dist * fit };
      const Mi = { ...MID, dist: MID.dist * fit };
      const E: Orbit = (portrait ? END_P : { ...END, dist: END.dist * fit });
      let orb = mixOrbit(mixOrbit(S, Mi, a), mixOrbit(Mi, E, b), b);
      // a slow breathing drift keeps the frame alive between scrolls
      orb.yaw += Math.sin(t * 0.12) * 0.025;
      cam.fov = aspect < 1 ? 38 : 32;
      cam.updateProjectionMatrix();
      placeOrbit(cam, orb);
    },
    after(cam, w, h) {
      for (let i = 0; i < pts.length; i++) {
        project(cam, pts[i], w, h, tmp);
        anchors[i].x = tmp.x;
        anchors[i].y = tmp.y;
        anchors[i].z = tmp.z;
      }
      o.onFrame(anchors, w, h);
    },
  };
  const off = bay.register(view);
  const onScroll = () => bay.still && bay.invalidate();
  window.addEventListener('scroll', onScroll, { passive: true });
  return () => {
    if (!alive) return;
    alive = false;
    window.removeEventListener('scroll', onScroll);
    off();
    releaseBay();
  };
}
