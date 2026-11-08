// Adaptive quality tier shared by every 3D scene (the realm, the landing bay, guild dioramas).
//
// 'low' is picked up front on weak or small devices (few CPU cores, little memory, phone-sized
// screen) and can also be reached later when the first ~2 s of frames run slow (FrameProbe).
// Low tier: pixel ratio 1, no MSAA, smaller / no shadows, fewer ambient figures and particles,
// life animated at ~30 fps while nobody is touching the view.
// For testing: ?quality=low|high in the URL (remembered for the tab in sessionStorage).

export type Tier = 'low' | 'high';

export interface Quality {
  tier: Tier;
  /** why the tier was picked (shown in window.__realmQuality for debugging) */
  reason: string;
  /** prefers-reduced-motion */
  reduced: boolean;
  /** set once frames were measured slow: scenes should drop shadows too */
  slow: boolean;
}

const KEY = 'agentdom.quality';
let cur: Quality | null = null;
const subs = new Set<(q: Quality) => void>();

function forced(): Tier | null {
  try {
    const q = new URLSearchParams(window.location.search).get('quality');
    if (q === 'low' || q === 'high') {
      sessionStorage.setItem(KEY, q);
      return q;
    }
    const s = sessionStorage.getItem(KEY);
    return s === 'low' || s === 'high' ? s : null;
  } catch {
    return null;
  }
}

function detect(): Quality {
  let reduced = false;
  try {
    reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    /* ignore */
  }
  const f = forced();
  if (f) return { tier: f, reason: 'forced', reduced, slow: false };
  const nav = navigator as Navigator & { deviceMemory?: number };
  const why: string[] = [];
  const cores = nav.hardwareConcurrency || 0;
  if (cores > 0 && cores <= 4) why.push(`cores=${cores}`);
  if (typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 4) why.push(`memory=${nav.deviceMemory}GB`);
  // Screen size alone does not mark a device as weak: modern phones handle the realm well, and
  // the frame probe still drops a slow phone to "low" within the first two seconds.
  return { tier: why.length ? 'low' : 'high', reason: why.join(',') || 'capable', reduced, slow: false };
}

function publish(q: Quality) {
  try {
    (window as unknown as { __realmQuality?: Quality }).__realmQuality = { ...q };
  } catch {
    /* ignore */
  }
}

export function quality(): Quality {
  if (!cur) {
    cur = detect();
    publish(cur);
  }
  return cur;
}

/** Highest pixel ratio a scene may use on this tier (scenes may cap lower). */
export function maxDpr(q = quality()) {
  return Math.min(window.devicePixelRatio || 1, q.tier === 'low' ? 1 : 1.75);
}

/** Switch to the low tier for the rest of the visit (frames measured slow). */
export function demote(reason: string) {
  const q = quality();
  if (q.tier === 'low' && q.slow) return;
  if (forced() === 'high') return;
  cur = { ...q, tier: 'low', slow: true, reason: q.reason === 'capable' ? reason : `${q.reason},${reason}` };
  publish(cur);
  for (const f of subs) f(cur);
}

export function onQuality(f: (q: Quality) => void) {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
}

/**
 * Measures the frame time over the first ~2 s of rendering and demotes the tier
 * when frames average slower than ~36 fps. Feed it every rendered frame's dt (seconds).
 */
export class FrameProbe {
  private n = 0;
  private sum = 0;
  private skip = 30; // the first frames include shader compiles and late page work
  done = false;
  constructor(private name: string, private limitMs = 28, private windowS = 2) {}
  sample(dt: number) {
    if (this.done) return;
    if (this.skip > 0) {
      this.skip--;
      return;
    }
    this.n++;
    this.sum += dt;
    if (this.sum < this.windowS) return;
    this.done = true;
    const avg = (this.sum / this.n) * 1000;
    if (avg > this.limitMs) demote(`${this.name}:${avg.toFixed(0)}ms`);
  }
}

/**
 * Frame skipping for the low tier: returns true when this rAF tick should be skipped,
 * holding the scene to ~30 fps. `busy` keeps full rate (e.g. while the user drags).
 * `sinceRenderMs` is the time since the scene last rendered.
 */
export class Throttle {
  skip(sinceRenderMs: number, busy: boolean, q = quality()) {
    if (busy || (q.tier !== 'low' && !q.reduced)) return false;
    return sinceRenderMs < 28;
  }
}
