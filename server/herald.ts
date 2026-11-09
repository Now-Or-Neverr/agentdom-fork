// Herald queue: every Bluesky post is a draft until an admin approves it.
// pending → (approve) → posted | failed      pending → (reject) → rejected
// A failed post can be approved again (retry). Only approval calls Bluesky.
// Admin endpoints check `x-admin-key` against ADMIN_KEY; when ADMIN_KEY is not set, a random key
// is generated once into data/admin-key.txt (gitignored). The key itself is never printed.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { DATA_DIR, db, now, uid, type Row } from './db';
import { bskyPost, checkPostText, buildPostRecord } from './integrations/bluesky';
import { resolveUpload } from './integrations/media-common';
import type { CallContext } from './integrations/http';
import { checkXText, xAutopost, xDailyLimit, xLength, xPost, xStatus, X_MAX_CHARS } from './integrations/x';

db.exec(`
CREATE TABLE IF NOT EXISTS herald_posts (
  id TEXT PRIMARY KEY,
  decree_id TEXT,
  text TEXT NOT NULL,
  image TEXT,
  alt TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','approved','posted','rejected','failed')),
  uri TEXT,
  url TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  posted_at TEXT
);
CREATE INDEX IF NOT EXISTS herald_posts_status ON herald_posts(status, created_at);
`);
{
  // network: where the post goes. source: 'decree' (an agent drafted it, always needs approval) or 'admin'.
  const cols = new Set((db.prepare('PRAGMA table_info(herald_posts)').all() as Row[]).map((c) => c.name as string));
  if (!cols.has('network')) db.exec("ALTER TABLE herald_posts ADD COLUMN network TEXT NOT NULL DEFAULT 'bluesky'");
  if (!cols.has('source')) db.exec("ALTER TABLE herald_posts ADD COLUMN source TEXT NOT NULL DEFAULT 'decree'");
  if (!cols.has('scheduled_at')) db.exec('ALTER TABLE herald_posts ADD COLUMN scheduled_at TEXT');
}

// ---------------- admin key ----------------
const KEY_FILE = path.join(DATA_DIR, 'admin-key.txt');
let cachedKey: string | null = null;
export function adminKey(): string {
  if (process.env.ADMIN_KEY && process.env.ADMIN_KEY.length >= 16) return process.env.ADMIN_KEY;
  if (cachedKey) return cachedKey;
  if (fs.existsSync(KEY_FILE)) {
    const k = fs.readFileSync(KEY_FILE, 'utf8').trim();
    if (k.length >= 16) return (cachedKey = k);
  }
  const k = randomBytes(24).toString('base64url');
  fs.writeFileSync(KEY_FILE, k + '\n', { encoding: 'utf8', mode: 0o600 });
  console.log(`[admin] No ADMIN_KEY set: generated one in ${KEY_FILE} (paste it on /admin/herald).`);
  return (cachedKey = k);
}
adminKey(); // create on first boot so the console line appears once

/** Constant-time check of a presented admin key. */
export function isAdmin(presented: unknown): boolean {
  if (typeof presented !== 'string' || !presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(adminKey());
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------------- queue ----------------
export type HeraldStatus = 'pending' | 'approved' | 'posted' | 'rejected' | 'failed';
export type HeraldNetwork = 'bluesky' | 'x';
export interface HeraldPost {
  id: string;
  network: HeraldNetwork;
  source: 'decree' | 'admin';
  /** Admin X drafts with a time are sent by the scheduler when X_AUTOPOST=1. */
  scheduledAt: string | null;
  decreeId: string | null;
  text: string;
  image: string | null; // '/uploads/…'
  alt: string | null;
  status: HeraldStatus;
  uri: string | null;
  url: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  postedAt: string | null;
  /** Characters in Bluesky terms (graphemes) and the facets that will be attached. */
  preview: { chars: number; links: number; tags: number };
}

function toPost(r: Row): HeraldPost {
  let preview = { chars: 0, links: 0, tags: 0 };
  if (r.network === 'x') {
    preview = { chars: xLength(r.text), links: (r.text.match(/https?:\/\/\S+/gi) ?? []).length, tags: (r.text.match(/(^|\s)#\w+/g) ?? []).length };
  } else try {
    const rec = buildPostRecord(r.text);
    preview = {
      chars: [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(rec.text)].length,
      links: (rec.facets ?? []).filter((f) => f.features[0].$type.endsWith('#link')).length,
      tags: (rec.facets ?? []).filter((f) => f.features[0].$type.endsWith('#tag')).length,
    };
  } catch {
    /* invalid text is shown with zero preview */
  }
  return {
    id: r.id,
    network: r.network === 'x' ? 'x' : 'bluesky',
    source: r.source === 'admin' ? 'admin' : 'decree',
    scheduledAt: r.scheduled_at ?? null,
    decreeId: r.decree_id ?? null,
    text: r.text,
    image: r.image ?? null,
    alt: r.alt ?? null,
    status: r.status,
    uri: r.uri ?? null,
    url: r.url ?? null,
    error: r.error ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    postedAt: r.posted_at ?? null,
    preview,
  };
}
const get = (id: string) => db.prepare('SELECT * FROM herald_posts WHERE id = ?').get(id) as Row | undefined;

/** Add a draft (status 'pending'). Validates length and image now so approval can't fail on input. */
export function queueHeraldDraft(d: {
  text: string;
  image?: string | null;
  alt?: string | null;
  decreeId?: string | null;
  network?: HeraldNetwork;
  /** Only admin routes pass 'admin'. Agent drafts are always 'decree' and never auto-posted. */
  source?: 'decree' | 'admin';
  scheduledAt?: string | null;
}): HeraldPost {
  const network: HeraldNetwork = d.network === 'x' ? 'x' : 'bluesky';
  const source = d.source === 'admin' ? 'admin' : 'decree';
  if (network === 'x' && source !== 'admin') throw new Error('Only the admin can queue X posts.');
  const text = network === 'x' ? checkXText(d.text) : checkPostText(d.text);
  let scheduledAt: string | null = null;
  if (d.scheduledAt) {
    const t = Date.parse(d.scheduledAt);
    if (Number.isNaN(t)) throw new Error('Scheduled time is not a valid date.');
    scheduledAt = new Date(t).toISOString();
  }
  let image: string | null = null;
  if (d.image) {
    if (!String(d.image).startsWith('/uploads/')) throw new Error('Image must be an /uploads/ URL.');
    resolveUpload(d.image);
    image = String(d.image).split('?')[0];
  }
  const alt = d.alt ? String(d.alt).replace(/\s+/g, ' ').trim().slice(0, 1000) : null;
  if (image && !alt) throw new Error('Add alt text for the image.');
  const id = uid('hrl');
  const t = now();
  db.prepare("INSERT INTO herald_posts (id, decree_id, text, image, alt, status, created_at, updated_at, network, source, scheduled_at) VALUES (?,?,?,?,?,'pending',?,?,?,?,?)").run(
    id,
    d.decreeId ?? null,
    text,
    image,
    alt,
    t,
    t,
    network,
    source,
    scheduledAt,
  );
  return toPost(get(id)!);
}

export function listHerald(status?: HeraldStatus, limit = 100): HeraldPost[] {
  const rows = (
    status
      ? db.prepare('SELECT * FROM herald_posts WHERE status = ? ORDER BY created_at DESC LIMIT ?').all(status, limit)
      : db.prepare('SELECT * FROM herald_posts ORDER BY created_at DESC LIMIT ?').all(limit)
  ) as Row[];
  return rows.map(toPost);
}
export const heraldPost = (id: string) => {
  const r = get(id);
  return r ? toPost(r) : null;
};

/** Approve → post to Bluesky now. Atomic claim so a double click posts once. */
export async function approveHerald(id: string, ctx: CallContext = { context: 'realm', ref: 'herald' }): Promise<HeraldPost> {
  const before = get(id);
  if (before?.network === 'x') {
    if (before.source !== 'admin') throw new Error('Agent drafts cannot be posted to X.');
    if (xPostedToday() >= xDailyLimit()) throw new Error(`Daily X limit reached (${xDailyLimit()} posts). Raise X_DAILY_LIMIT or try tomorrow.`);
  }
  const claim = db.prepare("UPDATE herald_posts SET status = 'approved', error = NULL, updated_at = ? WHERE id = ? AND status IN ('pending','failed')").run(now(), id);
  if (Number(claim.changes) !== 1) {
    const r = get(id);
    if (!r) throw new Error('Draft not found.');
    throw new Error(`This draft is already ${r.status}.`);
  }
  const r = get(id)!;
  try {
    if (r.network === 'x') {
      const p = await xPost(r.text, { image: r.image, alt: r.alt ?? '' });
      db.prepare("UPDATE herald_posts SET status = 'posted', uri = ?, url = ?, posted_at = ?, updated_at = ? WHERE id = ?").run(p.id, p.url, p.postedAt, now(), id);
    } else {
      const p = await bskyPost(r.text, ctx, { image: r.image, alt: r.alt ?? '' });
      db.prepare("UPDATE herald_posts SET status = 'posted', uri = ?, url = ?, posted_at = ?, updated_at = ? WHERE id = ?").run(p.uri, p.url, p.postedAt, now(), id);
    }
  } catch (e) {
    db.prepare("UPDATE herald_posts SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").run(((e as Error).message || 'failed').slice(0, 300), now(), id);
  }
  return toPost(get(id)!);
}

export function rejectHerald(id: string, reason?: string): HeraldPost {
  const res = db.prepare("UPDATE herald_posts SET status = 'rejected', error = ?, updated_at = ? WHERE id = ? AND status IN ('pending','failed')").run(reason ? String(reason).slice(0, 300) : null, now(), id);
  if (Number(res.changes) !== 1) {
    const r = get(id);
    if (!r) throw new Error('Draft not found.');
    throw new Error(`This draft is already ${r.status}.`);
  }
  return toPost(get(id)!);
}

// ---------------- X: daily cap and auto-post ----------------
const dayStartUtc = () => new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z';
/** X posts sent (or being sent) since 00:00 UTC. Counts toward X_DAILY_LIMIT. */
export function xPostedToday(): number {
  const r = db.prepare("SELECT COUNT(*) AS n FROM herald_posts WHERE network = 'x' AND ((status = 'posted' AND posted_at >= ?) OR status = 'approved')").get(dayStartUtc()) as Row;
  return Number(r.n) || 0;
}
export const xInfo = () => ({ ...xStatus(), postedToday: xPostedToday(), maxChars: X_MAX_CHARS });

/**
 * With X_AUTOPOST=1, sends admin-written X drafts whose scheduled time has passed, one per minute,
 * oldest first, within the daily cap. Drafts without a time, agent drafts and Bluesky drafts are
 * never touched: they still wait for Approve. A failed post is not retried automatically.
 */
let autoBusy = false;
export function startXAutopost() {
  const tick = async () => {
    if (autoBusy || !xAutopost() || !xStatus().connected) return;
    if (xPostedToday() >= xDailyLimit()) return;
    const r = db
      .prepare("SELECT id FROM herald_posts WHERE network = 'x' AND source = 'admin' AND status = 'pending' AND scheduled_at IS NOT NULL AND scheduled_at <= ? ORDER BY scheduled_at LIMIT 1")
      .get(now()) as Row | undefined;
    if (!r) return;
    autoBusy = true;
    try {
      const p = await approveHerald(r.id as string, { context: 'realm', ref: 'x-autopost' });
      console.log(`[x] auto-post ${p.id}: ${p.status}${p.error ? ' (' + p.error + ')' : ''}`);
    } catch (e) {
      console.log(`[x] auto-post skipped: ${(e as Error).message}`);
    } finally {
      autoBusy = false;
    }
  };
  setInterval(() => void tick(), 60_000).unref();
}
