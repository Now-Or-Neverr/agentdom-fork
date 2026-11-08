// Grabs real UI pieces from the live site (2x) for the floating screens in the promo.
import { chromium } from 'playwright';
const OUT = 'launch/promo/ui';
const b = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await p.goto('https://agentdom.world/?quality=high', { waitUntil: 'networkidle' });
await p.addStyleTag({ content: 'body > div[style*="2147483000"]{display:none!important} .reveal{opacity:1!important;transform:none!important}' });
await p.locator('#speak').scrollIntoViewIfNeeded();
await p.locator('#speak textarea').first().fill('Write a SQL query for my top 5 customers last month');
await p.waitForTimeout(5000);
await p.locator('.ld-parchment').first().screenshot({ path: `${OUT}/decree.png` });
await p.locator('.ld-routemap').first().screenshot({ path: `${OUT}/routemap.png`, omitBackground: true });
const cards = p.locator('.ld-work-card');
for (let i = 0; i < 6; i++) { await cards.nth(i).scrollIntoViewIfNeeded(); await p.waitForTimeout(300); await cards.nth(i).screenshot({ path: `${OUT}/work-${i}.png` }); }
const court = p.locator('.ld-court-row > *');
for (let i = 0; i < 5; i++) { await court.nth(i).scrollIntoViewIfNeeded(); await p.waitForTimeout(300); await court.nth(i).screenshot({ path: `${OUT}/court-${i}.png` }); }
await b.close();
