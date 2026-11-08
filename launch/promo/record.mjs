// Renders the promo film (launch/promo) to launch/promo/agentdom-promo.mp4, 1920x1080 at 60 fps.
// Needs the vite dev server: npx vite --port 5174 (from the project root).
// The page clock is paused and stepped 1/60 s per frame, so the 3D is perfectly smooth.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpeg from 'ffmpeg-static';

const dir = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.env.OUT || path.join(dir, 'agentdom-promo.mp4');
const FPS = 60, DT = 1000 / FPS, STEP = Number(process.env.STEP || 1);
const W = 1440, H = 810, DSF = 4 / 3;

const b = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DSF });
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.clock.install({ time: Date.now() });
await p.goto('http://localhost:5174/launch/promo/index.html?quality=high', { waitUntil: 'load' });
await p.clock.pauseAt((await p.evaluate(() => Date.now())) + 50);
// let the world build, fonts and images load (stepping the paused clock keeps measured fps at 60)
for (let i = 0; i < 400; i++) {
  await p.clock.runFor(DT);
  await p.waitForTimeout(10);
  if (i > 120 && (await p.evaluate(() => !!window.promo && document.fonts.status === 'loaded' && [...document.images].every((im) => im.complete)))) break;
}
const duration = await p.evaluate(() => promo.duration);
// warm every shot once so shaders are compiled before recording
for (const t of [1, 5, 11, 15, 20, 25, 30, 34]) { await p.evaluate((t) => promo.frame(t), t); for (let i = 0; i < 20; i++) await p.clock.runFor(DT); await p.waitForTimeout(150); }
const cdp = await ctx.newCDPSession(p);

const ff = spawn(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS / STEP), '-c:v', 'mjpeg', '-i', '-',
  '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
  '-map', '0:v', '-map', '1:a', '-shortest',
  '-c:v', 'libx264', '-profile:v', 'high', '-preset', 'slow', '-crf', '16', '-maxrate', '24M', '-bufsize', '48M', '-pix_fmt', 'yuv420p', '-r', String(FPS),
  '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', OUT]);
ff.stderr.on('data', (d) => process.stderr.write(d));
const done = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg ' + c)))));
const write = (buf) => new Promise((res) => (ff.stdin.write(buf) ? res() : ff.stdin.once('drain', res)));

const frames = Math.round(duration * FPS);
const t0 = Date.now();
for (let i = 0; i < frames; i += STEP) {
  await p.evaluate((t) => promo.frame(t), i / FPS);
  await p.clock.runFor(DT * STEP);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 95, optimizeForSpeed: true, clip: { x: 0, y: 0, width: W, height: H, scale: DSF } });
  await write(Buffer.from(data, 'base64'));
  if (i % 600 === 0) console.log(`${(i / FPS).toFixed(0)}s / ${duration}s  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}
ff.stdin.end();
await done;
await b.close();
console.log('done', OUT);
