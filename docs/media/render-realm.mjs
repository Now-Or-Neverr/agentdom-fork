// Renders a still of the live 3D realm (perspective camera) for the README banner.
// Needs: npx vite --port 5174 (project root). Run: node docs/media/render-realm.mjs
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
const OUT = fileURLToPath(new URL('./realm-still.png', import.meta.url));
const b = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2 });
await p.goto('http://localhost:5174/launch/promo/index.html?quality=high', { waitUntil: 'load' });
await p.waitForFunction(() => window.promo, null, { timeout: 60000 });
await p.addStyleTag({ content: '#layer{display:none}' });
await p.evaluate(() => { promo.setNight(0); document.getElementById('sky').style.background = 'linear-gradient(#8fbde6 0%, #cfe2f0 45%, #eef0ec 70%, #f6ecd9 100%)'; });
await p.evaluate(() => promo.setCam(22, 30, 40, 0, 0, -6, 34));
await p.waitForTimeout(5000);
await p.screenshot({ path: OUT });
await b.close();
console.log(OUT);
