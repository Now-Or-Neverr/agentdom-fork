// README banner (1280x400) and GitHub social preview (1280x640), rendered at 2x.
// The right side is a real render of the 3D realm (realm-still.png from render-realm.mjs).
// Run from the project root: node docs/media/banner.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, '../..');
const realm = 'data:image/png;base64,' + fs.readFileSync(path.join(dir, 'realm-still.png')).toString('base64');
const logo = fs.readFileSync(path.join(root, 'public/logo.svg'), 'utf8').replace(/width="512" height="512"/, 'width="100%" height="100%"');

const FONTS = `<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist:wght@400;500;600&family=Geist+Mono:wght@500&display=swap" rel="stylesheet">`;
const css = (W, H, panelW) => `*{box-sizing:border-box;margin:0}html,body{width:${W}px;height:${H}px;overflow:hidden}
body{background:radial-gradient(90% 120% at 0% 0%,#fffbf5,#f6eee2 55%,#efe3d0);color:#241a13;font-family:Geist,sans-serif;-webkit-font-smoothing:antialiased;position:relative}
.panel{position:absolute;top:28px;right:28px;bottom:28px;width:${panelW}px;border-radius:28px;overflow:hidden;background:url(${realm}) 55% 45%/cover;box-shadow:0 30px 60px rgba(107,66,38,.22),0 0 0 1px rgba(107,66,38,.12)}
.panel:after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,rgba(246,238,226,.18),rgba(246,238,226,0) 30%)}
.tag{position:absolute;left:18px;bottom:16px;display:flex;align-items:center;gap:8px;padding:7px 12px;border-radius:999px;background:rgba(36,26,19,.72);color:#f6eee2;font:500 12px 'Geist Mono',monospace;letter-spacing:.12em;text-transform:uppercase;backdrop-filter:blur(6px)}
.tag i{width:7px;height:7px;border-radius:50%;background:#5fd38d;box-shadow:0 0 0 3px rgba(95,211,141,.25)}
.left{position:absolute;left:56px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center}
.brand{display:flex;align-items:center;gap:16px}.logo{width:58px;height:58px;border-radius:16px;overflow:hidden;box-shadow:0 8px 20px rgba(107,66,38,.25)}
.name{font-family:'Instrument Serif',serif;font-size:64px;line-height:1}
h1{font-family:'Instrument Serif',serif;font-weight:400;letter-spacing:-.01em}
h1 em{color:#6b4226}
.kick{font:500 12px 'Geist Mono',monospace;letter-spacing:.22em;text-transform:uppercase;color:#7a5410;display:flex;align-items:center;gap:10px}.kick:before{content:"";width:28px;height:2px;background:#e0a93e}
.pills{display:flex;flex-wrap:wrap;gap:8px}.pills span{padding:6px 12px;border-radius:999px;background:#fffbf5;border:1px solid #e6d8c4;font-size:13px;font-weight:500;color:#4a3a2c}`;

const left = (big) => `<div class="left" style="gap:${big ? 26 : 18}px;width:${big ? 560 : 520}px">
  <div class="brand"><span class="logo">${logo}</span><span class="name">Agentdom</span></div>
  <span class="kick">Open source · MIT licensed</span>
  <h1 style="font-size:${big ? 54 : 40}px;line-height:1.04">A kingdom of <em>AI agents</em><br>that do real work.</h1>
  <div class="pills"><span>9 guilds</span><span>Real tools &amp; sources</span><span>You approve every result</span>${big ? '<span>Self-hostable</span>' : ''}</div>
</div>`;

const SHOTS = [
  { file: 'banner.png', W: 1280, H: 400, panel: 620, big: false },
  { file: 'social-preview.png', W: 1280, H: 640, panel: 600, big: true },
];
const b = await chromium.launch();
for (const s of SHOTS) {
  const p = await b.newPage({ viewport: { width: s.W, height: s.H }, deviceScaleFactor: 2 });
  await p.setContent(`<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>${css(s.W, s.H, s.panel)}</style></head><body>
${left(s.big)}<div class="panel"><span class="tag"><i></i>The 3D realm</span></div></body></html>`, { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(dir, s.file) });
  await p.close();
  console.log(s.file);
}
await b.close();
