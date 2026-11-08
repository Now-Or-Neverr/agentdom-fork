// Stills at given times: OUT=dir node launch/promo/stills.mjs 1,5,10
import { chromium } from 'playwright';
const ts = process.argv[2].split(',').map(Number);
const b = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 0.667 });
p.on('pageerror', (e) => console.log('[pageerror]', e.message));
await p.goto('http://localhost:5174/launch/promo/index.html?quality=high', { waitUntil: 'load' });
await p.waitForFunction(() => window.promo, null, { timeout: 60000 });
await p.evaluate(() => document.fonts.ready);
await p.waitForTimeout(3000);
for (const t of ts) {
  await p.evaluate((t) => promo.frame(t), t);
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${process.env.OUT}/t${String(t).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 80 });
}
await b.close();
