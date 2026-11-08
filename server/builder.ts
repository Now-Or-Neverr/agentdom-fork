// App Builder: anyone describes a page, app or file; a model on OpenRouter writes it as ONE
// self-contained file; we host it at /p/<slug> right away. Every generation is costed from the
// numbers OpenRouter returns, and limits switch on by date (free-for-all during launch days).
import { db, now, uid } from './db';
import { HttpError } from './core';
import { orImageToday, orImageTotal } from './integrations/orimage';

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
`);
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

const inflight = new Map<string, { chars: number; ip: string; started: number }>();
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

// ---------------- jobs ----------------
function record(buildId: string, userId: string, ip: string, kind: 'new' | 'revise', r: Partial<GenResult>, ok: boolean, error: string | null) {
  db.prepare('INSERT INTO build_runs (id, build_id, user_id, ip, kind, model, tokens_in, tokens_out, cost, ok, error, at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(
    uid('brn'),
    buildId,
    userId,
    ip,
    kind,
    BUILDER_MODEL,
    r.tokensIn ?? 0,
    r.tokensOut ?? 0,
    r.cost ?? 0,
    ok ? 1 : 0,
    error,
    now(),
  );
}

export function startBuild(userId: string, ip: string, prompt: string, format: BuildFormat) {
  gate('new', userId, ip);
  const id = uid('bld');
  const slug = `${slugify(prompt.split(/\s+/).slice(0, 6).join(' '))}-${rand()}`;
  const t = now();
  db.prepare('INSERT INTO builds (id, slug, user_id, ip, title, filename, status, prompt, version, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
    id,
    slug,
    userId,
    ip,
    'Building…',
    'index.html',
    'building',
    prompt,
    0,
    t,
    t,
  );
  inflight.set(id, { chars: 0, ip, started: Date.now() });
  void (async () => {
    let r: GenResult | null = null;
    try {
      r = await generate(
        [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: userMessage(prompt, format) },
        ],
        (c) => {
          const f = inflight.get(id);
          if (f) f.chars = c;
        },
      );
      const p = parse(r.text);
      const newSlug = `${slugify(p.title)}-${slug.slice(-4)}`;
      const free = !db.prepare('SELECT 1 FROM builds WHERE slug = ? AND id != ?').get(newSlug, id);
      db.prepare("UPDATE builds SET status = 'live', error = NULL, title = ?, filename = ?, content = ?, version = 1, slug = ?, updated_at = ? WHERE id = ?").run(
        p.title,
        p.filename,
        p.content,
        free ? newSlug : slug,
        now(),
        id,
      );
      db.prepare('INSERT INTO build_versions (id, build_id, version, prompt, filename, content, created_at) VALUES (?,?,?,?,?,?,?)').run(uid('bv'), id, 1, prompt, p.filename, p.content, now());
      record(id, userId, ip, 'new', r, true, null);
    } catch (e) {
      const msg = (e as Error).message || 'The build failed.';
      db.prepare("UPDATE builds SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").run(msg.slice(0, 300), now(), id);
      record(id, userId, ip, 'new', r ?? {}, false, msg.slice(0, 300));
      console.error('[builder]', msg);
    } finally {
      inflight.delete(id);
    }
  })();
  return { id, slug };
}

export function startRevision(userId: string, ip: string, buildId: string, prompt: string) {
  const b = db.prepare('SELECT * FROM builds WHERE id = ?').get(buildId) as any;
  if (!b || b.status === 'removed') throw new HttpError(404, 'Build not found.');
  if (b.user_id !== userId) throw new HttpError(403, 'Only the person who made this build can change it.');
  if (b.status === 'building' || inflight.has(buildId)) throw new HttpError(409, 'This build is still working. Wait for it to finish.');
  if (!b.content) throw new HttpError(400, 'This build has no file yet. Start a new build instead.');
  gate('revise', userId, ip);
  db.prepare("UPDATE builds SET status = 'building', error = NULL, updated_at = ? WHERE id = ?").run(now(), buildId);
  inflight.set(buildId, { chars: 0, ip, started: Date.now() });
  void (async () => {
    let r: GenResult | null = null;
    try {
      r = await generate(
        [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: reviseMessage(prompt, b.filename, b.content) },
        ],
        (c) => {
          const f = inflight.get(buildId);
          if (f) f.chars = c;
        },
      );
      const p = parse(r.text);
      const v = Number(b.version) + 1;
      db.prepare("UPDATE builds SET status = 'live', error = NULL, filename = ?, content = ?, version = ?, updated_at = ? WHERE id = ?").run(p.filename, p.content, v, now(), buildId);
      db.prepare('INSERT INTO build_versions (id, build_id, version, prompt, filename, content, created_at) VALUES (?,?,?,?,?,?,?)').run(uid('bv'), buildId, v, prompt, p.filename, p.content, now());
      record(buildId, userId, ip, 'revise', r, true, null);
    } catch (e) {
      const msg = (e as Error).message || 'The change failed.';
      // the previous version stays live; the error is shown once
      db.prepare("UPDATE builds SET status = 'live', error = ?, updated_at = ? WHERE id = ?").run(msg.slice(0, 300), now(), buildId);
      record(buildId, userId, ip, 'revise', r ?? {}, false, msg.slice(0, 300));
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
    progress: f ? { chars: f.chars, seconds: Math.round((Date.now() - f.started) / 1000) } : null,
    prompt: mine ? b.prompt : null,
    mine,
    size: b.content ? b.content.length : 0,
    views: Number(b.views),
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
    recent: (db.prepare("SELECT id, slug, title, filename, status, reports, views, created_at FROM builds ORDER BY created_at DESC LIMIT 40").all() as any[]),
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
  const base = (process.env.PUBLIC_URL || 'https://agentdom.world').replace(/\/$/, '');
  return { slug, url: `${base}/p/${slug}` };
}
