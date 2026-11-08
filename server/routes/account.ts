// Account without an account: a secret recovery key that moves a guest to another device,
// plus a light "what is still working" feed the client uses for finish notifications.
// Mounted under /api by server/index.ts. Plain keys are never stored or logged, only sha256.
import { Router, type Request } from 'express';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { db, now, type Row } from '../db';
import { HttpError, currentUser, h, optionalUser, toUser } from '../core';

export const router = Router();

db.exec(`
CREATE TABLE IF NOT EXISTS recovery_keys (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  key_hash TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL
);
`);

// 32 symbols without look-alikes (no 0/O, 1/I), 16 of them = 80 random bits.
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const PREFIX = 'AGNT';

function newKey() {
  const groups: string[] = [];
  for (let g = 0; g < 4; g++) {
    let s = '';
    for (let i = 0; i < 4; i++) s += ALPHABET[randomInt(ALPHABET.length)];
    groups.push(s);
  }
  return [PREFIX, ...groups].join('-');
}

/** Canonical form of whatever the user typed or pasted, or null when it cannot be a key. */
function normalize(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 200) return null;
  let s = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.startsWith(PREFIX) && s.length === PREFIX.length + 16) s = s.slice(PREFIX.length);
  if (s.length !== 16) return null;
  return [PREFIX, s.slice(0, 4), s.slice(4, 8), s.slice(8, 12), s.slice(12)].join('-');
}

const hashOf = (key: string) =>
  createHash('sha256')
    .update('agentdom-recovery:' + key)
    .digest('hex');

// Create (or replace) the current user's key. The plain key is returned once and never again.
router.post(
  '/me/recovery',
  h((req, res) => {
    const u = currentUser(req);
    const key = newKey();
    db.prepare(
      'INSERT INTO recovery_keys (user_id, key_hash, created_at) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET key_hash = excluded.key_hash, created_at = excluded.created_at',
    ).run(u.id, hashOf(key), now());
    res.setHeader('Cache-Control', 'no-store');
    res.json({ key, createdAt: now() });
  }),
);

// Whether a key exists (never the key itself).
router.get(
  '/me/recovery',
  h((req, res) => {
    const u = currentUser(req);
    const r = db.prepare('SELECT created_at FROM recovery_keys WHERE user_id = ?').get(u.id) as Row | undefined;
    res.json({ hasKey: !!r, createdAt: r?.created_at ?? null });
  }),
);

// Failed restore attempts per IP: 5 per hour.
const TRIES = 5;
const WINDOW = 60 * 60 * 1000;
const fails = new Map<string, { n: number; reset: number }>();
const ipOf = (req: Request) => req.ip || req.socket.remoteAddress || 'unknown';
setInterval(
  () => {
    const t = Date.now();
    for (const [k, v] of fails) if (v.reset <= t) fails.delete(k);
  },
  10 * 60 * 1000,
).unref();

router.post(
  '/me/restore',
  h((req, res) => {
    const ip = ipOf(req);
    const t = Date.now();
    let f = fails.get(ip);
    if (f && f.reset <= t) {
      fails.delete(ip);
      f = undefined;
    }
    if (f && f.n >= TRIES) {
      const mins = Math.max(1, Math.ceil((f.reset - t) / 60000));
      throw new HttpError(429, `Too many tries. Please wait ${mins} minute${mins === 1 ? '' : 's'} and try again.`);
    }
    const fail = (msg: string): never => {
      const cur = fails.get(ip);
      if (cur) cur.n++;
      else fails.set(ip, { n: 1, reset: t + WINDOW });
      throw new HttpError(400, msg);
    };
    const key = normalize(req.body?.key ?? req.body?.code);
    if (!key) fail('That does not look like a key. It looks like AGNT-XXXX-XXXX-XXXX-XXXX.');
    const want = Buffer.from(hashOf(key!), 'hex');
    const row = db.prepare('SELECT user_id, key_hash FROM recovery_keys WHERE key_hash = ?').get(want.toString('hex')) as Row | undefined;
    const got = Buffer.from(row ? String(row.key_hash) : '0'.repeat(64), 'hex');
    const ok = !!row && got.length === want.length && timingSafeEqual(got, want);
    const user = ok ? optionalUser(String(row!.user_id)) : undefined;
    if (!user) fail('That key did not match. Check it and try again.');
    fails.delete(ip);
    res.setHeader('Cache-Control', 'no-store');
    res.json(toUser(user!));
  }),
);

// Light status feed for finish notifications: everything of mine that is still working,
// plus the current state of the ids the client is already watching (?d=..&b=.., comma lists).
const ids = (x: unknown) =>
  (typeof x === 'string' ? x : '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[A-Za-z0-9_-]{1,64}$/.test(s))
    .slice(0, 30);

router.get(
  '/me/work',
  h((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const u = optionalUser(req.header('x-user'));
    if (!u) return res.json({ decrees: [], builds: [] });
    const d = ids(req.query.d);
    const b = ids(req.query.b);
    const marks = (n: number) => Array(n).fill('?').join(',');
    const decrees = db
      .prepare(
        `SELECT id, title, status FROM decrees WHERE user_id = ? AND (status IN ('queued','working')${d.length ? ` OR id IN (${marks(d.length)})` : ''}) ORDER BY created_at DESC LIMIT 60`,
      )
      .all(u.id, ...d) as Row[];
    let builds: Row[] = [];
    try {
      builds = db
        .prepare(
          `SELECT id, slug, title, status, error, version FROM builds WHERE user_id = ? AND (status = 'building'${b.length ? ` OR id IN (${marks(b.length)})` : ''}) ORDER BY created_at DESC LIMIT 60`,
        )
        .all(u.id, ...b) as Row[];
    } catch {
      /* builder table missing: no builds */
    }
    res.json({
      decrees: decrees.map((r) => ({ id: String(r.id), title: String(r.title), status: String(r.status) })),
      builds: builds.map((r) => ({
        id: String(r.id),
        slug: String(r.slug),
        title: String(r.title),
        status: String(r.status),
        failed: !!r.error,
        version: Number(r.version),
      })),
    });
  }),
);
