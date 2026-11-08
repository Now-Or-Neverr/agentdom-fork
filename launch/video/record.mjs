// Launch video for X: 1920x1080, 60 fps, recorded from the live site frame by frame.
// The page clock is paused and advanced exactly 1/60 s per frame (rAF, timers, CSS animations),
// so the 3D scenes come out perfectly smooth no matter how slow this machine renders them.
// Run from the project root: node launch/video/record.mjs        (STEP=6 for a quick 10 fps draft)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpeg from 'ffmpeg-static';

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, '../..');
const TMP = process.env.TMP_DIR || path.join(dir, 'tmp');
const SITE = 'https://agentdom.world';
const FPS = 60;
const DT = 1000 / FPS;
const STEP = Number(process.env.STEP || 1); // capture every Nth frame (draft mode)
const ONLY = process.env.ONLY?.split(',');
const W = 1440, H = 810, DSF = 4 / 3; // 1920x1080 output, desktop layout
fs.mkdirSync(TMP, { recursive: true });

const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
// keyframes [[seconds, value], ...] -> value at t, eased between neighbours
const track = (keys) => (t) => {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i];
    const [t0, v0] = keys[i - 1];
    if (t <= t1) return v0 + (v1 - v0) * ease((t - t0) / (t1 - t0 || 1));
  }
  return keys[keys.length - 1][1];
};

// The Turnstile box only shows for automated browsers; visitors never see it.
const HIDE = `body > div[style*="2147483000"]{display:none!important}`;

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars'] });

async function openPage(url) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DSF });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await p.clock.install({ time: Date.now() });
  await p.goto(url, { waitUntil: 'domcontentloaded' });
  await p.clock.pauseAt((await p.evaluate(() => Date.now())) + 50);
  await p.addStyleTag({ content: HIDE });
  const cdp = await ctx.newCDPSession(p);
  return { p, cdp, ctx };
}

// advance one frame: scroll, CSS/WAAPI animations, then the page clock (rAF + timers)
async function tick(p, y, ms) {
  await p.evaluate(
    ({ y, ms }) => {
      if (y != null) window.scrollTo({ top: y, behavior: 'instant' });
      for (const a of document.getAnimations()) {
        if (a.__v === undefined) {
          a.pause();
          a.__v = Number(a.currentTime) || 0;
        } else a.__v += ms;
        a.currentTime = a.__v;
      }
    },
    { y, ms },
  );
  await p.clock.runFor(ms);
}

async function warm(p, y, seconds) {
  const n = Math.round((seconds * 1000) / DT);
  for (let i = 0; i < n; i++) {
    await tick(p, y, DT);
    await p.waitForTimeout(12); // real time for network, images, shader compiles
  }
}

function encoder(file) {
  const ff = spawn(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS / STEP), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '12', '-pix_fmt', 'yuv420p', '-r', String(FPS), file]);
  ff.stderr.on('data', (d) => process.stderr.write(d));
  const done = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg ' + c)))));
  return {
    write: (buf) => new Promise((res) => (ff.stdin.write(buf) ? res() : ff.stdin.once('drain', res))),
    end: () => (ff.stdin.end(), done),
  };
}

async function capture(cdp) {
  // clip is in page coordinates, so follow the scroll; scale gives the full 1920x1080
  const { cssVisualViewport: v } = await cdp.send('Page.getLayoutMetrics');
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 95, optimizeForSpeed: true, clip: { x: v.pageX, y: v.pageY, width: W, height: H, scale: DSF } });
  return Buffer.from(data, 'base64');
}

// Record `seconds` of one page. `y(t)` gives the scroll position, `at` maps seconds -> actions.
async function record(name, { p, cdp }, seconds, { y = () => null, at = {}, onFrame } = {}) {
  const out = path.join(TMP, `${name}.mp4`);
  const enc = encoder(out);
  const frames = Math.round(seconds * FPS);
  const acts = Object.entries(at).map(([s, f]) => [Math.round(Number(s) * FPS), f]);
  const t0 = Date.now();
  for (let i = 0; i < frames; i += STEP) {
    for (const [f, fn] of acts) if (f > i - STEP && f <= i) await fn();
    if (onFrame) await onFrame(i / FPS, i);
    await tick(p, y(i / FPS), DT * STEP);
    await enc.write(await capture(cdp));
  }
  await enc.end();
  console.log(`${name}: ${seconds}s in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  return out;
}

const SEGS = {};

// ---- landing: one page, several takes ----
async function landing() {
  const L = await openPage(SITE + '/?quality=high');
  const { p } = L;
  await warm(p, 0, 3);
  // load every lazy 3D scene once so later takes start ready
  const H0 = await p.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < H0; y += 600) await warm(p, y, 0.25);
  const sec = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll('main > section, main > *')].map((s) => [s.className.split(' ')[0], { top: Math.round(s.getBoundingClientRect().top + scrollY), h: s.offsetHeight }])));
  console.log(sec);
  const zoomEnd = sec['ld-zoom'].top + sec['ld-zoom'].h - H;
  const guilds = sec['ld-guilds'];
  const gRange = guilds.h - H;
  const gates = sec['ld-gates'];

  // 1. hero title, then down through the bay as the camera dives to the throne
  if (!ONLY || ONLY.includes('hero')) {
    await warm(p, 0, 1.5);
    await p.evaluate(() => document.getAnimations().forEach((a) => (a.__v = 0))); // replay the title intro
    SEGS.hero = await record('1-hero', L, 11.5, { y: track([[0, 0], [2.0, 0], [11.2, zoomEnd]]) });
  }
  // 2. guilds: the diorama switches guild by guild
  if (!ONLY || ONLY.includes('guilds')) {
    const a = guilds.top + gRange * 0.13, b = guilds.top + gRange * 0.56;
    await warm(p, a, 3.5);
    SEGS.guilds = await record('2-guilds', L, 5, { y: track([[0, a], [0.3, a], [4.8, b]]) });
  }
  // 3. real work feed
  if (!ONLY || ONLY.includes('work')) {
    const w = sec['ld-work'];
    const a = w.top - 60, b = w.top + w.h - H - 10;
    await warm(p, a, 1.5);
    SEGS.work = await record('3-work', L, 3.2, { y: track([[0, a], [3.2, b]]) });
  }
  // 4. type a decree, the vizier picks a guild
  if (!ONLY || ONLY.includes('speak')) {
    const s = sec['ld-speak'];
    const y0 = s.top + Math.round((s.h - H) / 2) - 70;
    await warm(p, y0, 1.5);
    const box = p.locator('#speak textarea').first();
    const text = 'Write a SQL query for my top 5 customers last month';
    const per = 2.6 / text.length;
    const at = { 0.3: () => box.focus() };
    [...text].forEach((ch, i) => (at[(0.5 + i * per).toFixed(3)] = () => p.keyboard.type(ch)));
    SEGS.speak = await record('4-speak', L, 5.6, { y: track([[0, y0], [3.9, y0], [5.4, y0 + 150]]), at });
  }
  // 5. the court
  if (!ONLY || ONLY.includes('court')) {
    const c = sec['ld-court'];
    const a = c.top - 30, b = c.top + 90;
    await warm(p, a, 1.5);
    SEGS.court = await record('5-court', L, 2.8, { y: track([[0, a], [2.8, b]]) });
  }
  // 7. the sea gate opens at dusk
  if (!ONLY || ONLY.includes('gates')) {
    const a = gates.top - 40, b = gates.top + gates.h - H;
    await warm(p, a, 2);
    SEGS.gates = await record('7-gates', L, 8, { y: track([[0, a], [6.6, b]]) });
  }
  await L.ctx.close();
}

// ---- the live realm: pan, then zoom toward the throne ----
async function realm() {
  if (ONLY && !ONLY.includes('realm')) return;
  const R = await openPage(SITE + '/realm?quality=high');
  const { p } = R;
  await warm(p, null, 5);
  console.log('realm perf', await p.evaluate(() => JSON.stringify(window.__realmPerf)));
  const cx = W / 2, cy = H / 2;
  const pan = track([[0.6, 0], [3.2, 1]]);
  const zoom = track([[3.0, 0], [6.4, 1]]);
  let down = false, lastZ = 0;
  SEGS.realm = await record('6-realm', R, 7, {
    onFrame: async (t) => {
      const k = pan(t);
      if (t >= 0.6 && t <= 3.2) {
        const x = cx + 230 - 470 * k, y = cy + 90 - 170 * k;
        if (!down) { await p.mouse.move(cx + 230, cy + 90); await p.mouse.down(); down = true; }
        await p.mouse.move(x, y);
      } else if (down && t > 3.2) { await p.mouse.up(); down = false; }
      const z = zoom(t);
      if (z > lastZ) {
        // ~2.2x zoom toward the throne, spread evenly over the frames
        await p.mouse.move(cx + 20, cy + 70);
        await p.mouse.wheel(0, -((z - lastZ) * 1150));
        lastZ = z;
      }
    },
  });
  await R.ctx.close();
}

// ---- end card ----
async function endCard() {
  if (ONLY && !ONLY.includes('end')) return;
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DSF });
  const p = await ctx.newPage();
  const logo = fs.readFileSync(path.join(root, 'public/logo.svg'), 'utf8').replace(/width="512" height="512"/, 'width="100%" height="100%"');
  await p.setContent(`<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist:wght@400;500&family=Geist+Mono:wght@500&display=swap" rel="stylesheet">
<style>*{margin:0;box-sizing:border-box}html,body{width:${W}px;height:${H}px;overflow:hidden}
body{background:radial-gradient(70% 90% at 50% 40%, #7d4f2f, #6b4226 55%, #3e2414);color:#f6eee2;font-family:Geist,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:26px}
.logo{width:150px;height:150px;border-radius:34px;overflow:hidden;box-shadow:0 0 0 2px rgba(224,169,62,.4),0 30px 60px rgba(0,0,0,.3);animation:pop .9s cubic-bezier(.2,.8,.2,1) both}
h1{font-family:'Instrument Serif',serif;font-weight:400;font-size:96px;line-height:1;animation:rise .9s .15s cubic-bezier(.2,.8,.2,1) both}
p{font-family:'Geist Mono',monospace;letter-spacing:.2em;text-transform:uppercase;font-size:20px;color:#e0a93e;animation:rise .9s .3s cubic-bezier(.2,.8,.2,1) both}
@keyframes pop{from{opacity:0;transform:scale(.85)}}@keyframes rise{from{opacity:0;transform:translateY(18px)}}</style></head>
<body><div class="logo">${logo}</div><h1>Agentdom</h1><p>agentdom.world</p></body></html>`, { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  const cdp = await ctx.newCDPSession(p);
  await p.clock.install();
  await p.clock.pauseAt(Date.now() + 1000);
  await p.evaluate(() => document.getAnimations().forEach((a) => { a.pause(); a.currentTime = 0; a.__v = 0; }));
  SEGS.end = await record('8-end', { p, cdp }, 3.2);
  await ctx.close();
}

await landing();
await realm();
await endCard();
await browser.close();
console.log('segments', SEGS);
