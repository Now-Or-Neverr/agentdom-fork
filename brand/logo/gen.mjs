// Agentdom logo options v2: ten single-colour marks, one square image each (used for X, token and
// favicon alike). Writes NN-name.svg and index.html. PNGs are rendered by render.mjs.
// Run: node brand/logo/gen.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
// Same tokens as the site: --brand-accent (brown, the header logo tile and primary buttons) and --gold.
const BG = '#6b4226';
const FG = '#e0a93e';

const STAR = (cx, cy, r) =>
  `M${cx} ${cy - r} C${cx + r * 0.12} ${cy - r * 0.3} ${cx + r * 0.3} ${cy - r * 0.12} ${cx + r} ${cy} C${cx + r * 0.3} ${cy + r * 0.12} ${cx + r * 0.12} ${cy + r * 0.3} ${cx} ${cy + r} ` +
  `C${cx - r * 0.12} ${cy + r * 0.3} ${cx - r * 0.3} ${cy + r * 0.12} ${cx - r} ${cy} C${cx - r * 0.3} ${cy - r * 0.12} ${cx - r * 0.12} ${cy - r * 0.3} ${cx} ${cy - r} Z`;
// one agent: round head over a pill body (s = scale)
const AGENT = (cx, top, s = 1) =>
  `<circle cx="${cx}" cy="${top + 34 * s}" r="${34 * s}"/><path d="M${cx - 58 * s} ${top + 170 * s} V${top + 128 * s} Q${cx - 58 * s} ${top + 78 * s} ${cx} ${top + 78 * s} Q${cx + 58 * s} ${top + 78 * s} ${cx + 58 * s} ${top + 128 * s} V${top + 170 * s} Z"/>`;

const LOGOS = [
  {
    id: '01-agent-wall',
    name: 'Agent Wall',
    idea: 'A castle wall whose battlements are three agents, the middle one taller: the crown and the castle in one.',
    svg: `<circle cx="144" cy="146" r="32"/><circle cx="256" cy="106" r="36"/><circle cx="368" cy="146" r="32"/>
          <path d="M96 446 V262 H112 V194 H176 V262 H220 V158 H292 V262 H336 V194 H400 V262 H416 V446 H296 V378 Q256 330 216 378 V446 Z"/>`,
  },
  {
    id: '02-agent-crown',
    name: 'Agent Crown',
    idea: 'Three agents standing shoulder to shoulder, the middle one taller: together they form a crown.',
    svg: `<circle cx="164" cy="178" r="36"/><circle cx="256" cy="116" r="40"/><circle cx="348" cy="178" r="36"/>
          <rect x="128" y="232" width="72" height="150" rx="36"/><rect x="216" y="174" width="80" height="208" rx="40"/><rect x="312" y="232" width="72" height="150" rx="36"/>
          <rect x="112" y="396" width="288" height="40" rx="20"/>`,
  },
  {
    id: '03-twin-towers',
    name: 'Twin Towers',
    idea: 'Two pointed towers guarding an open gate: the realm, drawn like a storybook castle.',
    svg: `<path d="M94 210 L156 82 L218 210 Z"/><rect x="110" y="214" width="92" height="232"/>
          <path d="M294 210 L356 82 L418 210 Z"/><rect x="310" y="214" width="92" height="232"/>
          <path d="M196 446 V262 H222 V236 H246 V262 H266 V236 H290 V262 H316 V446 H284 V388 Q256 350 228 388 V446 Z"/>`,
  },
  {
    id: '04-gate-agent',
    name: 'Gate Agent',
    idea: 'An agent standing in the palace archway, ready to take your order.',
    svg: `<path fill-rule="evenodd" d="M106 446 V238 Q106 88 256 88 Q406 88 406 238 V446 Z M162 446 V246 Q162 148 256 148 Q350 148 350 246 V446 Z"/>
          <circle cx="256" cy="246" r="42"/><path d="M184 446 Q184 310 256 310 Q328 310 328 446 Z"/>`,
  },
  {
    id: '05-keyhole-keep',
    name: 'Keyhole Keep',
    idea: 'A castle keep with a keyhole door: your work stays locked inside the realm until you open it.',
    svg: `<path fill-rule="evenodd" d="M116 446 V166 H170 V214 H228 V166 H284 V214 H342 V166 H396 V446 Z M256 262 A36 36 0 0 1 278 326 L292 404 H220 L234 326 A36 36 0 0 1 256 262 Z"/>`,
  },
  {
    id: '06-flag-tower',
    name: 'Flag Tower',
    idea: 'One tower flying the realm flag: the place your agents report to.',
    svg: `<rect x="248" y="58" width="14" height="128"/><path d="M262 62 H372 L344 98 L372 134 H262 Z"/>
          <path d="M156 446 V186 H196 V218 H234 V186 H278 V218 H316 V186 H356 V446 H286 V366 Q256 326 226 366 V446 Z"/>`,
  },
  {
    id: '07-crest-agents',
    name: 'Crest of Agents',
    idea: 'The royal crest with three agents cut into it, the middle one taller, like the court on a coat of arms.',
    svg: `<path fill-rule="evenodd" d="M256 60 L420 112 V244 Q420 384 256 456 Q92 384 92 244 V112 Z
          M186 186 a30 30 0 1 0 0.01 0 Z M256 150 a34 34 0 1 0 0.01 0 Z M326 186 a30 30 0 1 0 0.01 0 Z
          M156 340 V290 Q156 258 186 258 Q216 258 216 290 V340 Z M222 340 V258 Q222 224 256 224 Q290 224 290 258 V340 Z M296 340 V290 Q296 258 326 258 Q356 258 356 290 V340 Z"/>`,
  },
  {
    id: '08-castle',
    name: 'Castle',
    idea: 'A castle whose battlements form a crown, with the gate open: come in, the realm is working.',
    svg: `<path d="M104 446 V180 H164 V234 H218 V136 H294 V234 H348 V180 H408 V446 H296 V372 Q256 322 216 372 V446 Z"/>`,
  },
  {
    id: '09-castle-bubble',
    name: 'Castle Bubble',
    idea: 'A chat bubble with battlements on top: you talk, the castle answers.',
    svg: `<path d="M98 196 H136 V150 H192 V196 H228 V150 H284 V196 H320 V150 H376 V196 H414 V362 Q414 396 380 396 H226 L150 458 L162 396 H132 Q98 396 98 362 Z"/>`,
  },
  {
    id: '10-building-blocks',
    name: 'Building Blocks',
    idea: 'Six blocks stacked into a pyramid with a crown on top: a kingdom built piece by piece, by agents.',
    svg: `<path d="M212 142 L218 78 L240 104 L256 64 L272 104 L294 78 L300 142 Z"/>
          <rect x="214" y="158" width="84" height="84" rx="18"/>
          <rect x="166" y="254" width="84" height="84" rx="18"/><rect x="262" y="254" width="84" height="84" rx="18"/>
          <rect x="118" y="350" width="84" height="84" rx="18"/><rect x="214" y="350" width="84" height="84" rx="18"/><rect x="310" y="350" width="84" height="84" rx="18"/>`,
  },
];

const svg = (l, size = 512) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}"><rect width="512" height="512" fill="${BG}"/><g fill="${FG}" color="${FG}" transform="translate(51.2 51.2) scale(.8)">${l.svg}</g></svg>`;

for (const f of fs.readdirSync(dir)) if (/^\d\d-.*\.(svg|png)$/.test(f)) fs.rmSync(path.join(dir, f));
for (const l of LOGOS) fs.writeFileSync(path.join(dir, `${l.id}.svg`), svg(l));

const cards = LOGOS.map(
  (l, i) => `<figure><img src="${l.id}.svg" alt="${l.name}"><div class="lk"><img src="${l.id}.svg" alt=""><span>Agentdom</span></div><figcaption><b>${String(i + 1).padStart(2, '0')} · ${l.name}</b><span>${l.idea}</span></figcaption></figure>`,
).join('\n');
fs.writeFileSync(
  path.join(dir, 'index.html'),
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Agentdom Logo Options</title><link href="https://fonts.googleapis.com/css2?family=Instrument+Serif&display=swap" rel="stylesheet">
<style>body{margin:0;background:#f6eee2;color:#241a13;font:14px/1.45 system-ui,sans-serif;padding:28px 16px 60px}
h1{font:600 24px system-ui;margin:0 0 4px}p{margin:0 0 22px;color:#7a6a5c}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:22px;max-width:1240px}
figure{margin:0}.lk{display:flex;align-items:center;gap:10px;margin-top:10px;padding:8px 12px;background:#fffbf5;border:1px solid #e6d8c4;border-radius:12px}.lk img{width:34px;border-radius:9px}.lk span{font:400 22px 'Instrument Serif',Georgia,serif}img{width:100%;aspect-ratio:1;display:block;border-radius:6px}
figcaption{margin-top:8px}figcaption b{display:block}figcaption span{color:#7a6a5c;font-size:13px}</style></head><body>
<h1>Agentdom logo options</h1><p>One colour, one square image each, in the site colours (brand brown and gold). The same file is used for the X avatar, the token and the favicon. Under each: how it sits in the site header.</p>
<div class="grid">${cards}</div></body></html>`,
);
console.log('wrote', LOGOS.length, 'logos');
