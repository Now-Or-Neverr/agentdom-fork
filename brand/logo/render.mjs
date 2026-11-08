// Renders every NN-name.svg in this folder to a 1024x1024 PNG next to it. Run: node brand/logo/render.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = path.dirname(fileURLToPath(import.meta.url));
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1024, height: 1024 } });
for (const f of fs.readdirSync(dir).filter((f) => /^\d\d-.*\.svg$/.test(f))) {
  await p.setContent(`<body style="margin:0">${fs.readFileSync(path.join(dir, f), "utf8").replace(/width="512" height="512"/, `width="1024" height="1024" style="display:block"`)}</body>`);
  await p.waitForTimeout(150);
  await p.screenshot({ path: path.join(dir, f.replace('.svg', '.png')), clip: { x: 0, y: 0, width: 1024, height: 1024 } });
}
await b.close();
console.log('rendered PNGs');
