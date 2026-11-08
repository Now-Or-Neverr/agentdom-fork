// App Builder: anyone describes a page, app or file; a model on OpenRouter writes it as ONE
// self-contained file; we host it at /p/<slug> right away. Every generation is costed from the
// numbers OpenRouter returns, and limits switch on by date (free-for-all during launch days).
import fs from 'node:fs';
import path from 'node:path';
import { UPLOAD_DIR, db, now, tx, uid } from './db';
import { HttpError } from './core';
import { OR_ASPECTS, designImage, orImageToday, orImageTotal, type OrAspect } from './integrations/orimage';

export const BUILDER_MODEL = process.env.BUILDER_MODEL || 'anthropic/claude-sonnet-5.5';
const MAX_TOKENS = Number(process.env.BUILDER_MAX_TOKENS) || 20000;
const MAX_FILE = 300_000; // characters
const TIMEOUT_MS = 6 * 60_000;

// Limits: always-on anti-bot pacing, plus daily caps that start on BUILDER_LIMITS_FROM.
const LIMITS_FROM = process.env.BUILDER_LIMITS_FROM || '2026-11-11T00:00:00Z';
const COOLDOWN_S = Number(process.env.BUILDER_COOLDOWN_S) || 60;
const MAX_CONCURRENT = Number(process.env.BUILDER_MAX_CONCURRENT) || 6;
const PER_USER_NEW = Number(process.env.BUILDER_PER_USER) || 3;
const PER_USER_REVISE = Number(process.env.BUILDER_REVISIONS_PER_USER) || 6;
const GLOBAL_DAY = Number(process.env.BUILDER_GLOBAL) || 40;
const DAILY_USD = Number(process.env.BUILDER_DAILY_USD) || 1.5;
const MAX_IMAGES = 2; // AI images per generation (HTML only)
export const PUBLIC_BASE = () => (process.env.PUBLIC_URL || 'https://agentdom.world').replace(/\/$/, '');

db.exec(`
CREATE TABLE IF NOT EXISTS builds (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  user_id TEXT,
  ip TEXT,
  title TEXT NOT NULL,
  filename TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  prompt TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  content TEXT,
  views INTEGER NOT NULL DEFAULT 0,
  reports INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS builds_user ON builds(user_id, created_at);
CREATE TABLE IF NOT EXISTS build_versions (
  id TEXT PRIMARY KEY,
  build_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  filename TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS build_versions_b ON build_versions(build_id, version);
CREATE TABLE IF NOT EXISTS build_runs (
  id TEXT PRIMARY KEY,
  build_id TEXT NOT NULL,
  user_id TEXT,
  ip TEXT,
  kind TEXT NOT NULL,
  model TEXT NOT NULL,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  ok INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS build_runs_at ON build_runs(at);
CREATE TABLE IF NOT EXISTS build_aliases (
  slug TEXT PRIMARY KEY,
  build_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS build_aliases_b ON build_aliases(build_id);
`);
{
  const cols = new Set((db.prepare('PRAGMA table_info(builds)').all() as { name: string }[]).map((c) => c.name));
  if (!cols.has('is_public')) db.exec('ALTER TABLE builds ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0');
  if (!cols.has('remixed_from')) db.exec('ALTER TABLE builds ADD COLUMN remixed_from TEXT');
  const runCols = new Set((db.prepare('PRAGMA table_info(build_runs)').all() as { name: string }[]).map((c) => c.name));
  if (!runCols.has('images')) db.exec('ALTER TABLE build_runs ADD COLUMN images INTEGER NOT NULL DEFAULT 0');
  if (!runCols.has('images_cost')) db.exec('ALTER TABLE build_runs ADD COLUMN images_cost REAL NOT NULL DEFAULT 0');
  db.exec('CREATE INDEX IF NOT EXISTS builds_public ON builds(is_public, created_at)');
}
// A restart kills in-flight generations: mark them failed so nobody waits forever.
db.prepare("UPDATE builds SET status = 'failed', error = 'The server restarted while building. Please try again.' WHERE status = 'building' AND version = 0").run();
db.prepare("UPDATE builds SET status = 'live' WHERE status = 'building' AND version > 0").run();

export type BuildFormat = 'auto' | 'web' | 'md' | 'txt' | 'csv' | 'json' | 'svg';
export const FORMATS: BuildFormat[] = ['auto', 'web', 'md', 'txt', 'csv', 'json', 'svg'];
const EXT_OK = ['html', 'md', 'txt', 'csv', 'json', 'svg'];

export const extOf = (filename: string) => (filename.split('.').pop() || '').toLowerCase();

// ---------------- limits ----------------
const dayStart = () => new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z';
const n = (sql: string, ...a: (string | number)[]) => Number((db.prepare(sql).get(...a) as { n: number }).n);
export const limitsActive = () => Date.now() >= Date.parse(LIMITS_FROM);
export const spentToday = () => Number((db.prepare('SELECT COALESCE(SUM(cost),0) AS n FROM build_runs WHERE at >= ?').get(dayStart()) as { n: number }).n);

type Stage = 'writing' | 'images';
const inflight = new Map<string, { chars: number; ip: string; started: number; stage: Stage; images: number }>();
const lastStart = new Map<string, number>();

export function builderStatus(userId: string | null) {
  const active = limitsActive();
  const today = dayStart();
  const usedNew = userId ? n("SELECT COUNT(*) AS n FROM build_runs WHERE user_id = ? AND kind = 'new' AND at >= ?", userId, today) : 0;
  const usedRev = userId ? n("SELECT COUNT(*) AS n FROM build_runs WHERE user_id = ? AND kind = 'revise' AND at >= ?", userId, today) : 0;
  const global = n('SELECT COUNT(*) AS n FROM build_runs WHERE at >= ?', today);
  const configured = !!process.env.OPENROUTER_API_KEY;
  const capped = active && (global >= GLOBAL_DAY || spentToday() >= DAILY_USD);
  return {
    open: configured && !capped && !resting(),
    reason: !configured ? 'The builder is not configured yet.' : resting() ? 'The builder is resting. Please come back later.' : capped ? 'Today’s builds are used up. The builder opens again tomorrow.' : null,
    limitsActive: active,
    limitsFrom: LIMITS_FROM,
    perUser: active ? { builds: PER_USER_NEW, revisions: PER_USER_REVISE, buildsLeft: Math.max(0, PER_USER_NEW - usedNew), revisionsLeft: Math.max(0, PER_USER_REVISE - usedRev) } : null,
    cooldownSeconds: COOLDOWN_S,
    model: BUILDER_MODEL,
  };
}

// When OpenRouter says the credit is gone, rest for an hour instead of failing every request.
let restUntil = 0;
const resting = () => Date.now() < restUntil;

function gate(kind: 'new' | 'revise', userId: string, ip: string) {
  if (!process.env.OPENROUTER_API_KEY) throw new HttpError(503, 'The builder is not configured yet.');
  if (resting()) throw new HttpError(503, 'The builder is resting. Please come back later.');
  for (const v of inflight.values()) if (v.ip === ip) throw new HttpError(429, 'You already have a build in progress. Wait for it to finish.');
  if (inflight.size >= MAX_CONCURRENT) throw new HttpError(429, 'The builder is busy right now. Try again in a minute.');
  const t = Date.now();
  for (const k of [`u:${userId}`, `i:${ip}`]) {
    const last = lastStart.get(k) ?? 0;
    const wait = Math.ceil((last + COOLDOWN_S * 1000 - t) / 1000);
    if (wait > 0) throw new HttpError(429, `One build per minute. Try again in ${wait}s.`);
  }
  if (limitsActive()) {
    const today = dayStart();
    if (spentToday() >= DAILY_USD || n('SELECT COUNT(*) AS n FROM build_runs WHERE at >= ?', today) >= GLOBAL_DAY)
      throw new HttpError(429, 'Today’s builds are used up. The builder opens again tomorrow.');
    const used = n('SELECT COUNT(*) AS n FROM build_runs WHERE kind = ? AND at >= ? AND (user_id = ? OR ip = ?)', kind, today, userId, ip);
    const cap = kind === 'new' ? PER_USER_NEW : PER_USER_REVISE;
    if (used >= cap) throw new HttpError(429, kind === 'new' ? `You have made ${cap} builds today. Come back tomorrow, or keep improving the ones you have.` : `You have used today’s ${cap} revisions. Come back tomorrow.`);
  }
  lastStart.set(`u:${userId}`, t);
  lastStart.set(`i:${ip}`, t);
}

// ---------------- prompt ----------------
const SYSTEM = `You are the App Builder of Agentdom. You turn one request into ONE complete, polished, self-contained file that is hosted at a public link the moment you finish.

Output format (nothing before or after):
<title>Short title, max 60 characters</title>
<file name="NAME.EXT">
...the whole file...
</file>

Choosing the file:
- Web pages, landing pages, apps, tools, games, calculators, dashboards, quizzes, invitations, portfolios, résumés-as-web, anything interactive or visual: one HTML file named index.html.
- Documents or data when the request asks for them (README, notes, plan, article, CSV template, JSON data, SVG graphic): .md, .txt, .csv, .json or .svg with a sensible lowercase file name.
- If a format is required by the request header, use it.

Rules for HTML:
- Start with <!doctype html>, end with </html>. Inline <style> and <script>. Include <meta name="viewport" content="width=device-width, initial-scale=1">.
- Make it genuinely good: a clear visual direction that suits the subject, strong typography (Google Fonts allowed), generous spacing, responsive down to 360 px wide, accessible contrast, focus states, real working interactivity. No lorem ipsum: write real, specific copy that fits the request. Keep the page in the language of the request.
- Allowed external resources only: Google Fonts, and scripts/styles from cdnjs.cloudflare.com, cdn.jsdelivr.net, unpkg.com or cdn.tailwindcss.com with exact versions. Images: prefer inline SVG, CSS art or gradients; https image URLs are allowed but may fail, so never depend on them.
- AI images: when the page would clearly benefit from real imagery (a hero photo, a product shot, an illustration of the subject), you may request up to ${MAX_IMAGES} generated images with placeholders exactly like:
  <img data-ai-image="detailed visual prompt: subject, setting, composition, lighting, style, colour palette" data-aspect="16:9" alt="short description" class="...">
  data-aspect is one of 1:1, 4:5, 9:16, 16:9, 3:2. Leave out src; it is filled in after you finish. Describe the picture only, never text, logos or lettering inside it. Style the image with CSS (width:100%; height:auto or object-fit:cover with a fixed aspect-ratio) so the layout works while it loads. Use none for tools, games, calculators and dashboards unless imagery is central. Never more than ${MAX_IMAGES}. Keep existing images (img tags with an src under /uploads/) exactly as they are when changing a page.
- The page runs in a strict sandbox: network requests (fetch, XHR, WebSocket) and form submissions are blocked, and localStorage/sessionStorage/cookies may throw. Keep all data in memory, wrap any storage access in try/catch, and make forms work client-side (show a confirmation instead of submitting).
- Never ask for passwords, card numbers, bank details, seed phrases or government IDs, and never imitate a real company's login or payment page.
- Be efficient: aim for roughly 25-45 KB. Reuse CSS classes and small JS helpers instead of repeating markup, keep inline SVG simple, and never pad with filler sections. Quality beats length.

Rules for other files: complete and well structured; Markdown with headings and lists; CSV with a header row; JSON valid; SVG valid with a viewBox and no scripts.

Never invent facts presented as real (statistics, reviews, quotes from real people); use clearly illustrative content or placeholders the user can replace.

Refuse with <refuse>one short reason</refuse> instead of a file when the request is for phishing, impersonating a real person or company, malware, scams, sexual content, hate, harassment of a real person, or anything illegal.`;

function userMessage(prompt: string, format: BuildFormat) {
  const head = format === 'auto' ? '' : format === 'web' ? 'Required format: one HTML file (index.html).\n\n' : `Required format: a .${format} file.\n\n`;
  return head + 'Request:\n' + prompt;
}

function reviseMessage(prompt: string, filename: string, content: string) {
  return `Here is the current file ${filename}:\n<current>\n${content}\n</current>\n\nChange request:\n${prompt}\n\nReturn the COMPLETE updated file in the same format (same file type unless the request clearly asks for another), keeping everything that was not asked to change.`;
}

function remixMessage(prompt: string, filename: string, content: string) {
  return `This is a remix: someone is starting a NEW build from a page another person shared. Use the file below as the starting point and make it theirs. Give it a fitting new title.\n\n${reviseMessage(prompt, filename, content)}`;
}

// ---------------- OpenRouter ----------------
interface GenResult {
  text: string;
  tokensIn: number;
  tokensOut: number;
  cost: number;
}

async function generate(messages: { role: string; content: string }[], onChars: (n: number) => void): Promise<GenResult> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: ctl.signal,
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://agentdom.world',
        'X-Title': 'Agentdom App Builder',
      },
      body: JSON.stringify({ model: BUILDER_MODEL, messages, max_tokens: MAX_TOKENS, stream: true, usage: { include: true } }),
    });
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => '');
      if (res.status === 402) restUntil = Date.now() + 60 * 60_000;
      throw new Error(res.status === 402 ? 'The builder is resting. Please come back later.' : `The model service answered ${res.status}. ${body.slice(0, 160)}`);
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let text = '';
    let usage: any = null;
    let lastTick = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const j = JSON.parse(data);
          if (j.error) throw new Error(j.error.message || 'The model stopped with an error.');
          const d = j.choices?.[0]?.delta?.content;
          if (typeof d === 'string') text += d;
          if (j.usage) usage = j.usage;
        } catch (e) {
          if (e instanceof SyntaxError) continue;
          throw e;
        }
        if (Date.now() - lastTick > 400) {
          lastTick = Date.now();
          onChars(text.length);
        }
      }
    }
    onChars(text.length);
    return { text, tokensIn: Number(usage?.prompt_tokens) || 0, tokensOut: Number(usage?.completion_tokens) || 0, cost: Number(usage?.cost) || 0 };
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error('The build took too long and was stopped. Try a smaller request.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function parse(text: string): { title: string; filename: string; content: string } {
  const refuse = text.match(/<refuse>([\s\S]*?)<\/refuse>/i);
  if (refuse && !/<file\s/i.test(text)) throw new Error(`The builder declined: ${refuse[1].trim().slice(0, 200)}`);
  const title = (text.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Untitled build';
  const open = text.match(/<file\s+name="([^"]+)"\s*>/i);
  if (!open || open.index === undefined) throw new Error('The model did not return a file. Please try again.');
  const start = open.index + open[0].length;
  const end = text.lastIndexOf('</file>');
  let content = (end > start ? text.slice(start, end) : text.slice(start)).replace(/^\s*\n/, '').replace(/\s+$/, '') + '\n';
  // strip a stray Markdown fence around the whole file
  content = content.replace(/^```[a-z]*\n([\s\S]*?)\n```\n?$/i, '$1\n');
  let filename = open[1].trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(0, 60) || 'index.html';
  let ext = extOf(filename);
  if (ext === 'htm') ext = 'html';
  if (!EXT_OK.includes(ext)) {
    filename = /<html[\s>]/i.test(content) ? 'index.html' : filename.replace(/\.[^.]*$/, '') + '.txt';
    ext = extOf(filename);
  }
  if (ext === 'html' && !/<\/html>\s*$/i.test(content)) {
    if (end < 0) throw new Error('The page was cut off before it finished. Try a smaller request.');
  }
  if (ext === 'json') {
    try {
      JSON.parse(content);
    } catch {
      throw new Error('The model returned invalid JSON. Please try again.');
    }
  }
  if (ext === 'svg') content = content.replace(/<script[\s\S]*?<\/script>/gi, '');
  if (content.length > MAX_FILE) throw new Error('The file came out too large. Try a smaller request.');
  if (content.trim().length < 20) throw new Error('The model returned an empty file. Please try again.');
  return { title, filename, content };
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36) || 'build';
const rand = () => Math.random().toString(36).slice(2, 6);

// ---------------- AI images inside built pages ----------------
// The model may leave up to MAX_IMAGES <img data-ai-image="prompt" data-aspect="16:9"> placeholders.
// After the file parses we paint them with designImage() and point src at an absolute
// ${PUBLIC_URL}/uploads/<file> URL (the /p/ CSP allows https images). Anything that cannot be
// painted becomes a soft gradient picture, so images never fail a build.
const IMG_TAG = /<img\b[^>]*\bdata-ai-image\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>/gi;
const unent = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
function attrOf(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return m ? unent(m[1] ?? m[2] ?? '') : null;
}
const aspectOf = (tag: string): OrAspect => {
  const a = (attrOf(tag, 'data-aspect') ?? '').trim() as OrAspect;
  return OR_ASPECTS.includes(a) ? a : '16:9';
};
function withSrc(tag: string, src: string) {
  const t = tag.replace(/\s(?:data-ai-image|src)\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');
  return t.replace(/^<img\b/i, `<img src="${escAttr(src)}"`);
}
const FALLBACKS = [
  ['#efe1cc', '#c9a27a', '#7a5338'],
  ['#e8e4f2', '#a99bc9', '#4d3f73'],
  ['#e3efe6', '#93b8a0', '#3f6550'],
];
function fallbackSrc(aspect: OrAspect, i: number) {
  const [w, h] = aspect.split(':').map(Number);
  const [a, b, c] = FALLBACKS[i % FALLBACKS.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w * 100} ${h * 100}" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset=".55" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient><radialGradient id="r" cx=".75" cy=".2" r=".6"><stop offset="0" stop-color="#fff" stop-opacity=".45"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><rect width="100%" height="100%" fill="url(#r)"/></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

async function paintImages(buildId: string, html: string, spentSoFar: number): Promise<{ html: string; cost: number; made: number }> {
  const tags = [...html.matchAll(IMG_TAG)].map((m) => m[0]);
  if (!tags.length) return { html, cost: 0, made: 0 };
  const f = inflight.get(buildId);
  if (f) f.stage = 'images';
  // respect the builder's daily USD cap once limits are on; designImage() enforces its own daily image cap
  const allowed = !limitsActive() || spentToday() + spentSoFar < DAILY_USD;
  const results = await Promise.allSettled(
    tags.slice(0, MAX_IMAGES).map(async (tag) => {
      if (!allowed) throw new Error('builder daily budget reached');
      const prompt = (attrOf(tag, 'data-ai-image') ?? '').replace(/\s+/g, ' ').trim().slice(0, 1200);
      if (prompt.length < 8) throw new Error('empty image prompt');
      const img = await designImage(`A picture for a web page. ${prompt}`, { context: 'realm', ref: `build:${buildId}` }, { aspect: aspectOf(tag) });
      if (f) f.images += 1;
      return img;
    }),
  );
  let cost = 0;
  let made = 0;
  let i = 0;
  const out = html.replace(IMG_TAG, (tag) => {
    const k = i++;
    const r = results[k];
    if (r && r.status === 'fulfilled') {
      cost += r.value.cost;
      made += 1;
      return withSrc(tag, `${PUBLIC_BASE()}${r.value.url}`);
    }
    if (r && r.status === 'rejected') console.warn('[builder] image skipped:', (r.reason as Error)?.message);
    return withSrc(tag, fallbackSrc(aspectOf(tag), k));
  });
  return { html: out, cost, made };
}

/** For local dev (no https): inline our own /uploads images as data: URLs so the CSP still lets them load. */
export function inlineLocalImages(html: string): string {
  const base = PUBLIC_BASE().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return html.replace(new RegExp(`${base}/uploads/(orimg-[A-Za-z0-9_-]+\\.(png|jpg|webp))`, 'g'), (all, name: string, ext: string) => {
    try {
      const file = path.join(UPLOAD_DIR, path.basename(name));
      if (!fs.existsSync(file)) return all;
      return `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${fs.readFileSync(file).toString('base64')}`;
    } catch {
      return all;
    }
  });
}

// ---------------- slugs ----------------
const RESERVED = new Set(
  'admin administrator api app apps build builds builder p agentdom login logout signin signup sign-in sign-up register account accounts settings auth oauth uploads upload static assets www mail help support official verify verification security secure password reset decree decrees hall gallery remix new edit null undefined root system staff moderator team billing payment pay checkout'.split(
    ' ',
  ),
);
// brand names often abused for phishing: blocked as a word, the long distinctive ones anywhere
const BRAND_WORDS = ['paypal', 'apple', 'google', 'microsoft', 'bank', 'wallet', 'metamask', 'coinbase', 'binance', 'facebook', 'instagram', 'whatsapp', 'netflix', 'amazon', 'dana', 'ovo', 'gopay', 'bca', 'bri', 'mandiri', 'bni'];
const BRAND_ANYWHERE = ['paypal', 'microsoft', 'metamask', 'coinbase', 'binance', 'facebook', 'instagram', 'whatsapp', 'netflix', 'gopay', 'mandiri', 'wallet', 'bank'];

export function slugTaken(slug: string, exceptBuild?: string): boolean {
  const b = db.prepare('SELECT id FROM builds WHERE slug = ?').get(slug) as { id: string } | undefined;
  if (b && b.id !== exceptBuild) return true;
  const a = db.prepare('SELECT build_id FROM build_aliases WHERE slug = ?').get(slug) as { build_id: string } | undefined;
  return !!a && a.build_id !== exceptBuild;
}

export function checkCustomSlug(raw: unknown): string {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s.length < 3 || s.length > 40) throw new HttpError(400, 'The link name must be 3 to 40 characters.');
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(s) || s.includes('--')) throw new HttpError(400, 'Use lowercase letters, numbers and single dashes only (no dash at the start or end).');
  if (RESERVED.has(s)) throw new HttpError(400, 'That link name is reserved. Pick another.');
  const words = s.split('-');
  if (words.some((w) => BRAND_WORDS.includes(w)) || BRAND_ANYWHERE.some((w) => s.includes(w)))
    throw new HttpError(400, 'Link names with bank, wallet or big-brand names are not allowed, to keep visitors safe from look-alike pages.');
  return s;
}

export function renameSlug(userId: string, buildId: string, raw: unknown) {
  const b = db.prepare('SELECT * FROM builds WHERE id = ?').get(buildId) as any;
  if (!b || b.status === 'removed') throw new HttpError(404, 'Build not found.');
  if (b.user_id !== userId) throw new HttpError(403, 'Only the person who made this build can change it.');
  if (!b.content) throw new HttpError(400, 'Wait until the build is live.');
  const s = checkCustomSlug(raw);
  if (s === b.slug) return { slug: s };
  if (slugTaken(s, buildId)) throw new HttpError(409, 'That link name is taken. Try another.');
  const aliases = n('SELECT COUNT(*) AS n FROM build_aliases WHERE build_id = ?', buildId);
  if (aliases >= 10) throw new HttpError(429, 'This build has been renamed many times already.');
  tx(() => {
    // reclaiming one of this build's own old names: it stops being an alias
    db.prepare('DELETE FROM build_aliases WHERE slug = ? AND build_id = ?').run(s, buildId);
    db.prepare('INSERT OR IGNORE INTO build_aliases (slug, build_id, created_at) VALUES (?,?,?)').run(b.slug, buildId, now());
    db.prepare('UPDATE builds SET slug = ?, updated_at = ? WHERE id = ?').run(s, now(), buildId);
  });
  return { slug: s };
}

/** The build an old (renamed) slug points at, if any. */
export function aliasTarget(slug: string): any | undefined {
  const a = db.prepare('SELECT build_id FROM build_aliases WHERE slug = ?').get(slug) as { build_id: string } | undefined;
  return a ? db.prepare('SELECT * FROM builds WHERE id = ?').get(a.build_id) : undefined;
}

// ---------------- gallery ----------------
export function setPublic(userId: string, buildId: string, on: boolean) {
  const b = db.prepare('SELECT * FROM builds WHERE id = ?').get(buildId) as any;
  if (!b || b.status === 'removed') throw new HttpError(404, 'Build not found.');
  if (b.user_id !== userId) throw new HttpError(403, 'Only the person who made this build can change it.');
  if (on && !b.content) throw new HttpError(400, 'Wait until the build is live.');
  db.prepare('UPDATE builds SET is_public = ? WHERE id = ?').run(on ? 1 : 0, buildId);
}

export function gallery(offset: number, limit: number, hideAt: number) {
  const rows = db
    .prepare(
      "SELECT b.id, b.slug, b.title, b.filename, b.views, b.created_at, b.updated_at, (SELECT COUNT(*) FROM builds r WHERE r.remixed_from = b.id AND r.status = 'live') AS remixes FROM builds b WHERE b.is_public = 1 AND b.status = 'live' AND b.content IS NOT NULL AND b.reports < ? ORDER BY b.created_at DESC LIMIT ? OFFSET ?",
    )
    .all(hideAt, limit + 1, offset) as any[];
  return {
    items: rows.slice(0, limit).map((b) => ({ slug: b.slug, title: b.title, ext: extOf(b.filename), views: Number(b.views), remixes: Number(b.remixes), createdAt: b.created_at })),
    more: rows.length > limit,
  };
}
export type GalleryPage = ReturnType<typeof gallery>;

// ---------------- jobs ----------------
function record(buildId: string, userId: string, ip: string, kind: 'new' | 'revise', r: Partial<GenResult>, ok: boolean, error: string | null, img = { cost: 0, made: 0 }) {
  db.prepare('INSERT INTO build_runs (id, build_id, user_id, ip, kind, model, tokens_in, tokens_out, cost, ok, error, at, images, images_cost) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
    uid('brn'),
    buildId,
    userId,
    ip,
    kind,
    BUILDER_MODEL,
    r.tokensIn ?? 0,
    r.tokensOut ?? 0,
    (r.cost ?? 0) + img.cost,
    ok ? 1 : 0,
    error,
    now(),
    img.made,
    img.cost,
  );
}

/** Parse the model's answer and, for HTML, paint its image placeholders. */
async function finishFile(buildId: string, r: GenResult) {
  const p = parse(r.text);
  let img = { cost: 0, made: 0 };
  if (extOf(p.filename) === 'html' && /data-ai-image\s*=/i.test(p.content)) {
    try {
      const painted = await paintImages(buildId, p.content, r.cost);
      p.content = painted.html;
      img = { cost: painted.cost, made: painted.made };
    } catch (e) {
      console.warn('[builder] images failed:', (e as Error).message);
      p.content = p.content.replace(IMG_TAG, (tag) => withSrc(tag, fallbackSrc(aspectOf(tag), 0)));
    }
  }
  return { p, img };
}

const progressOf = (id: string) => (c: number) => {
  const f = inflight.get(id);
  if (f) f.chars = c;
};

/** A new build, or a remix (a new build that starts from someone's shared file). */
export function startBuild(userId: string, ip: string, prompt: string, format: BuildFormat, remixOf?: { id: string; filename: string; content: string } | null) {
  gate('new', userId, ip);
  const id = uid('bld');
  const slug = `${slugify(prompt.split(/\s+/).slice(0, 6).join(' '))}-${rand()}`;
  const t = now();
  db.prepare('INSERT INTO builds (id, slug, user_id, ip, title, filename, status, prompt, version, remixed_from, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(
    id,
    slug,
    userId,
    ip,
    'Building…',
    remixOf ? remixOf.filename : 'index.html',
    'building',
    prompt,
    0,
    remixOf ? remixOf.id : null,
    t,
    t,
  );
  inflight.set(id, { chars: 0, ip, started: Date.now(), stage: 'writing', images: 0 });
  void (async () => {
    let r: GenResult | null = null;
    let img = { cost: 0, made: 0 };
    try {
      r = await generate(
        [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: remixOf ? remixMessage(prompt, remixOf.filename, remixOf.content) : userMessage(prompt, format) },
        ],
        progressOf(id),
      );
      const done = await finishFile(id, r);
      const p = done.p;
      img = done.img;
      const newSlug = `${slugify(p.title)}-${slug.slice(-4)}`;
      const free = !slugTaken(newSlug, id);
      db.prepare("UPDATE builds SET status = 'live', error = NULL, title = ?, filename = ?, content = ?, version = 1, slug = ?, updated_at = ? WHERE id = ?").run(
        p.title,
        p.filename,
        p.content,
        free ? newSlug : slug,
        now(),
        id,
      );
      db.prepare('INSERT INTO build_versions (id, build_id, version, prompt, filename, content, created_at) VALUES (?,?,?,?,?,?,?)').run(uid('bv'), id, 1, prompt, p.filename, p.content, now());
      record(id, userId, ip, 'new', r, true, null, img);
    } catch (e) {
      const msg = (e as Error).message || 'The build failed.';
      db.prepare("UPDATE builds SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").run(msg.slice(0, 300), now(), id);
      record(id, userId, ip, 'new', r ?? {}, false, msg.slice(0, 300), img);
      console.error('[builder]', msg);
    } finally {
      inflight.delete(id);
    }
  })();
  return { id, slug };
}

export function startRemix(userId: string, ip: string, source: any, prompt: string) {
  if (!source || source.status !== 'live' || !source.content) throw new HttpError(404, 'That page cannot be remixed.');
  return startBuild(userId, ip, prompt, 'auto', { id: source.id, filename: source.filename, content: source.content });
}

export function startRevision(userId: string, ip: string, buildId: string, prompt: string) {
  const b = db.prepare('SELECT * FROM builds WHERE id = ?').get(buildId) as any;
  if (!b || b.status === 'removed') throw new HttpError(404, 'Build not found.');
  if (b.user_id !== userId) throw new HttpError(403, 'Only the person who made this build can change it.');
  if (b.status === 'building' || inflight.has(buildId)) throw new HttpError(409, 'This build is still working. Wait for it to finish.');
  if (!b.content) throw new HttpError(400, 'This build has no file yet. Start a new build instead.');
  gate('revise', userId, ip);
  db.prepare("UPDATE builds SET status = 'building', error = NULL, updated_at = ? WHERE id = ?").run(now(), buildId);
  inflight.set(buildId, { chars: 0, ip, started: Date.now(), stage: 'writing', images: 0 });
  void (async () => {
    let r: GenResult | null = null;
    let img = { cost: 0, made: 0 };
    try {
      r = await generate(
        [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: reviseMessage(prompt, b.filename, b.content) },
        ],
        progressOf(buildId),
      );
      const done = await finishFile(buildId, r);
      const p = done.p;
      img = done.img;
      const v = Number(b.version) + 1;
      db.prepare("UPDATE builds SET status = 'live', error = NULL, filename = ?, content = ?, version = ?, updated_at = ? WHERE id = ?").run(p.filename, p.content, v, now(), buildId);
      db.prepare('INSERT INTO build_versions (id, build_id, version, prompt, filename, content, created_at) VALUES (?,?,?,?,?,?,?)').run(uid('bv'), buildId, v, prompt, p.filename, p.content, now());
      record(buildId, userId, ip, 'revise', r, true, null, img);
    } catch (e) {
      const msg = (e as Error).message || 'The change failed.';
      // the previous version stays live; the error is shown once
      db.prepare("UPDATE builds SET status = 'live', error = ?, updated_at = ? WHERE id = ?").run(msg.slice(0, 300), now(), buildId);
      record(buildId, userId, ip, 'revise', r ?? {}, false, msg.slice(0, 300), img);
      console.error('[builder]', msg);
    } finally {
      inflight.delete(buildId);
    }
  })();
  return { id: buildId, slug: b.slug };
}


export function restoreVersion(userId: string, buildId: string, version: number) {
  const b = db.prepare('SELECT * FROM builds WHERE id = ?').get(buildId) as any;
  if (!b || b.status === 'removed') throw new HttpError(404, 'Build not found.');
  if (b.user_id !== userId) throw new HttpError(403, 'Only the person who made this build can change it.');
  if (b.status === 'building') throw new HttpError(409, 'This build is still working.');
  const v = db.prepare('SELECT * FROM build_versions WHERE build_id = ? AND version = ?').get(buildId, version) as any;
  if (!v) throw new HttpError(404, 'Version not found.');
  const nv = Number(b.version) + 1;
  db.prepare('UPDATE builds SET filename = ?, content = ?, version = ?, error = NULL, updated_at = ? WHERE id = ?').run(v.filename, v.content, nv, now(), buildId);
  db.prepare('INSERT INTO build_versions (id, build_id, version, prompt, filename, content, created_at) VALUES (?,?,?,?,?,?,?)').run(uid('bv'), buildId, nv, `Restored version ${version}`, v.filename, v.content, now());
}

export function buildView(b: any, userId: string | null) {
  const f = inflight.get(b.id);
  const mine = !!userId && b.user_id === userId;
  return {
    id: b.id,
    slug: b.slug,
    title: b.title,
    filename: b.filename,
    ext: extOf(b.filename),
    status: b.status as 'building' | 'live' | 'failed' | 'removed',
    error: mine ? b.error : null,
    version: Number(b.version),
    progress: f ? { chars: f.chars, seconds: Math.round((Date.now() - f.started) / 1000), stage: f.stage, images: f.images } : null,
    prompt: mine ? b.prompt : null,
    mine,
    size: b.content ? b.content.length : 0,
    views: Number(b.views),
    isPublic: !!Number(b.is_public),
    remixedFrom: b.remixed_from ? remixSource(b.remixed_from) : null,
    createdAt: b.created_at,
    updatedAt: b.updated_at,
    versions: mine
      ? (db.prepare('SELECT version, prompt, created_at FROM build_versions WHERE build_id = ? ORDER BY version DESC LIMIT 30').all(b.id) as any[]).map((v) => ({
          version: Number(v.version),
          prompt: String(v.prompt).slice(0, 200),
          createdAt: v.created_at,
        }))
      : [],
  };
}
function remixSource(id: string) {
  const s = db.prepare('SELECT slug, title, status FROM builds WHERE id = ?').get(id) as any;
  return s && s.status !== 'removed' ? { slug: String(s.slug), title: String(s.title) } : null;
}
export type BuildView = ReturnType<typeof buildView>;
export type BuilderStatus = ReturnType<typeof builderStatus>;

export async function openRouterCredits(): Promise<{ total: number; used: number; left: number } | null> {
  if (!process.env.OPENROUTER_API_KEY) return null;
  try {
    const r = await fetch('https://openrouter.ai/api/v1/credits', { headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` } });
    const j = (await r.json()) as any;
    const total = Number(j?.data?.total_credits);
    const used = Number(j?.data?.total_usage);
    if (!Number.isFinite(total)) return null;
    return { total, used, left: Math.round((total - used) * 100) / 100 };
  } catch {
    return null;
  }
}

export function adminStats() {
  const today = dayStart();
  const sum = (since: string) => db.prepare('SELECT COUNT(*) AS runs, COALESCE(SUM(cost),0) AS cost, COALESCE(SUM(ok),0) AS ok FROM build_runs WHERE at >= ?').get(since) as any;
  const days = db
    .prepare("SELECT substr(at,1,10) AS day, COUNT(*) AS runs, COALESCE(SUM(cost),0) AS cost FROM build_runs GROUP BY day ORDER BY day DESC LIMIT 14")
    .all() as any[];
  return {
    today: sum(today),
    total: sum('0000'),
    days,
    limitsActive: limitsActive(),
    limitsFrom: LIMITS_FROM,
    dailyUsd: DAILY_USD,
    model: BUILDER_MODEL,
    inflight: inflight.size,
    images: { today: orImageToday(), total: orImageTotal() },
    builderImages: db.prepare('SELECT COALESCE(SUM(images),0) AS n, COALESCE(SUM(images_cost),0) AS cost FROM build_runs').get() as { n: number; cost: number },
    recent: (db.prepare("SELECT id, slug, title, filename, status, reports, views, is_public, remixed_from, created_at FROM builds ORDER BY created_at DESC LIMIT 40").all() as any[]),
  };
}

/** Host a page an agent made inside a decree at /p/<slug> (live right away, owned by the requester). */
export function hostPage(userId: string | null, title: string, html: string, ref: string): { slug: string; url: string } {
  const id = uid('bld');
  const slug = `${slugify(title)}-${rand()}`;
  const t = now();
  db.prepare('INSERT INTO builds (id, slug, user_id, ip, title, filename, status, prompt, version, content, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(
    id,
    slug,
    userId,
    null,
    title.slice(0, 80) || 'Web page',
    'index.html',
    'live',
    `Made by an agent for decree ${ref}`,
    1,
    html,
    t,
    t,
  );
  db.prepare('INSERT INTO build_versions (id, build_id, version, prompt, filename, content, created_at) VALUES (?,?,?,?,?,?,?)').run(uid('bv'), id, 1, `Decree ${ref}`, 'index.html', html, t);
  return { slug, url: `${PUBLIC_BASE()}/p/${slug}` };
}
