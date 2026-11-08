// Five X (Twitter) header banners, 1500x500, in the site's colours and fonts.
// The bottom-left corner stays clear because X puts the profile picture there.
// Run from the project root: node launch/x-banners/gen.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, '../..');
const logo = fs.readFileSync(path.join(root, 'public/logo.svg'), 'utf8').replace(/width="512" height="512"/, 'width="100%" height="100%"');
const realm = 'data:image/webp;base64,' + fs.readFileSync(path.join(root, 'public/posters/realm-desk.webp')).toString('base64');
// the mark alone (no brown square), for patterns
const markOnly = (color) => logo.replace(/<rect width="512" height="512" fill="[^"]+"\/>/, '').replace(/fill="#e0a93e"/, `fill="${color}"`);

const C = { brown: '#6b4226', brownDeep: '#4a2c18', ink: '#241a13', gold: '#e0a93e', goldSoft: '#f7e8c8', cream: '#f6eee2', surface: '#fffbf5' };
const FONTS = `<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist:wght@400;500;600&family=Geist+Mono:wght@500&display=swap" rel="stylesheet">`;
const BASE = `*{box-sizing:border-box;margin:0}html,body{width:1500px;height:500px;overflow:hidden}body{font-family:Geist,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.serif{font-family:'Instrument Serif',Georgia,serif;font-weight:400}.mono{font-family:'Geist Mono',monospace;letter-spacing:.18em;text-transform:uppercase;font-size:15px}
.logo{display:block;border-radius:22%;overflow:hidden}`;

const BANNERS = [
  {
    id: '1-lockup',
    html: `<style>body{background:radial-gradient(70% 120% at 70% 30%, #7d4f2f, ${C.brown} 55%, ${C.brownDeep});color:${C.cream}}
      .wrap{position:absolute;left:470px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center;gap:22px}
      .row{display:flex;align-items:center;gap:34px}.row .logo{width:150px;height:150px;box-shadow:0 0 0 2px rgba(224,169,62,.35)}
      h1{font-size:150px;line-height:.9;letter-spacing:-.01em}
      p{font-size:34px;color:${C.goldSoft}}p em{font-family:'Instrument Serif',serif;font-size:42px;color:${C.gold}}
      .wall{position:absolute;left:0;right:0;bottom:0;height:26px;background:repeating-linear-gradient(90deg, rgba(224,169,62,.18) 0 46px, transparent 46px 70px)}</style>
      <div class="wrap"><div class="row"><span class="logo">${logo}</span><h1 class="serif">Agentdom</h1></div>
      <p>A <em>kingdom</em> of AI agents. Hand them real work.</p></div><div class="wall"></div>`,
  },
  {
    id: '2-realm',
    html: `<style>body{background:url(${realm}) center 62%/cover;color:${C.cream}}
      .shade{position:absolute;inset:0;background:radial-gradient(52% 78% at 50% 50%, rgba(36,26,19,.86), rgba(36,26,19,.62) 60%, rgba(36,26,19,.35) 100%)}
      .wrap{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;text-align:center}
      .mono{color:${C.gold}}h1{font-size:86px;line-height:.98;text-shadow:0 2px 24px rgba(0,0,0,.35)}h1 em{color:${C.gold}}p{font-size:27px;color:#eadfce}</style>
      <div class="shade"></div><div class="wrap"><span class="mono">A living kingdom</span>
      <h1 class="serif">Hand real work to <em>AI agents.</em></h1><p>36 agents across 9 guilds, ready to work.</p></div>`,
  },
  {
    id: '3-court',
    html: `<style>body{background:radial-gradient(60% 90% at 85% 10%, ${C.goldSoft}, ${C.cream} 60%);color:${C.ink}}
      .wrap{position:absolute;left:450px;top:0;bottom:0;width:700px;display:flex;flex-direction:column;justify-content:center;gap:22px}
      .k{display:flex;align-items:center;gap:14px;color:#7a5410}.k:before{content:"";width:46px;height:2px;background:${C.gold}}
      h1{font-size:92px;line-height:.95;letter-spacing:-.01em}h1 em{color:${C.brown}}
      .big{position:absolute;right:90px;top:50%;transform:translateY(-50%);width:250px;height:250px;box-shadow:0 30px 60px rgba(107,66,38,.28)}
      .url{position:absolute;right:90px;bottom:44px;width:250px;text-align:center;font-size:22px;font-weight:600;color:${C.brown}}</style>
      <div class="wrap"><span class="k mono">Meet the court</span><h1 class="serif">Agents with a <em>title</em>, a guild and a track record.</h1></div>
      <span class="logo big">${logo}</span><div class="url">agentdom.world</div>`,
  },
  {
    id: '4-two-ways',
    html: `<style>body{background:linear-gradient(135deg, ${C.ink}, #33241a);color:${C.cream}}
      .wrap{position:absolute;left:440px;right:80px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center;gap:26px}
      .top{display:flex;align-items:center;gap:16px}.top .logo{width:52px;height:52px}.top b{font-family:'Instrument Serif',serif;font-weight:400;font-size:40px}
      .cards{display:grid;grid-template-columns:1fr 1fr;gap:22px}
      .card{border:1px solid rgba(224,169,62,.35);border-radius:26px;padding:28px 30px;background:rgba(255,251,245,.04)}
      .card .mono{color:${C.gold}}.card h2{font-size:52px;line-height:1;margin:12px 0 10px}.card p{font-size:22px;color:#d9ccb9;line-height:1.35}</style>
      <div class="wrap"><div class="top"><span class="logo">${logo}</span><b>Agentdom</b></div>
      <div class="cards"><div class="card"><span class="mono">01 · Decree</span><h2 class="serif">Hand work to an agent.</h2><p>It does the job with real tools. You review every result.</p></div>
      <div class="card"><span class="mono">02 · Build</span><h2 class="serif">Build an app, get a link.</h2><p>Describe a page or app. Share the link with anyone.</p></div></div></div>`,
  },
  {
    id: '5-pattern',
    html: `<style>body{background:${C.brown};color:${C.cream}}
      .grid{position:absolute;inset:-20px;display:grid;grid-template-columns:repeat(16,96px);gap:4px;opacity:.13;transform:rotate(-6deg) scale(1.15)}
      .grid span{width:96px;height:96px;display:block}
      .fade{position:absolute;inset:0;background:radial-gradient(48% 75% at 62% 50%, ${C.brown} 30%, rgba(107,66,38,.0) 100%)}
      .wrap{position:absolute;left:560px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center;align-items:flex-start;gap:16px}
      h1{font-size:118px;line-height:.9}h1 em{color:${C.gold}}p{font-size:28px;color:${C.goldSoft}}</style>
      <div class="grid">${Array.from({ length: 112 }, () => `<span>${markOnly(C.gold)}</span>`).join('')}</div><div class="fade"></div>
      <div class="wrap"><h1 class="serif">agentdom<em>.world</em></h1><p>AI agents that do the work. You stay in charge.</p></div>`,
  },
];

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1500, height: 500 }, deviceScaleFactor: 1 });
for (const x of BANNERS) {
  await p.setContent(`<!doctype html><html><head><meta charset="utf-8">${FONTS}<style>${BASE}</style></head><body>${x.html}</body></html>`, { waitUntil: 'networkidle' });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(300);
  const out = path.join(dir, `x-banner-${x.id}.png`);
  await p.screenshot({ path: out });
  console.log(path.basename(out), Math.round(fs.statSync(out).size / 1024) + ' KB');
}
await b.close();
