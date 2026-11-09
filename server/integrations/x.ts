// X (Twitter) for the realm account, over OAuth 2.0 with PKCE.
//
// Safety rules:
// - Posts only ever go out as X_HANDLE (default "agentdomworld"). The connect callback asks X who
//   authorized the app and throws the tokens away if it is any other account, so the developer
//   account that owns the app (or anyone else) can never be connected by mistake. Every post checks
//   the stored account again before it is sent.
// - Posting is only triggered from the Herald queue (server/herald.ts): an admin pressing Approve,
//   or, when X_AUTOPOST=1, the scheduler sending admin-written drafts at their scheduled time.
// - Tokens live only in the server database and never leave this module or reach a client.
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { db, now } from '../db';
import { MIME, resolveUpload, sniff } from './media-common';

const API = 'https://api.x.com/2';
const AUTHORIZE = 'https://x.com/i/oauth2/authorize';
const SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'offline.access', 'media.write'];
export const X_MAX_CHARS = 280;
const IMAGE_MAX = 5_000_000; // X image limit is 5 MB

db.exec(`
CREATE TABLE IF NOT EXISTS x_auth (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at INTEGER NOT NULL,
  scope TEXT,
  connected_at TEXT NOT NULL
);
`);

export const xHandle = () => (process.env.X_HANDLE || 'agentdomworld').replace(/^@/, '').trim().toLowerCase();
export const xConfigured = () => Boolean(process.env.X_CLIENT_ID && process.env.X_CLIENT_SECRET && process.env.X_REDIRECT_URI);
export const xAutopost = () => process.env.X_AUTOPOST === '1';
export const xDailyLimit = () => Math.max(0, Number(process.env.X_DAILY_LIMIT ?? 5) || 0);

export class XError extends Error {}

interface Auth {
  user_id: string;
  username: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: number;
}
const readAuth = () => db.prepare('SELECT * FROM x_auth WHERE id = 1').get() as Auth | undefined;

/** Public status only (no tokens). */
export function xStatus() {
  const a = readAuth();
  return {
    configured: xConfigured(),
    connected: Boolean(a),
    username: a?.username ?? null,
    allowedHandle: xHandle(),
    autopost: xAutopost(),
    dailyLimit: xDailyLimit(),
  };
}

// ---------------- OAuth 2.0 (PKCE) ----------------
const pending = new Map<string, { verifier: string; at: number }>();
const b64url = (b: Buffer) => b.toString('base64url');

/** Start a connect: returns the X authorize URL. The state is single use and lives 10 minutes. */
export function xConnectUrl(): string {
  if (!xConfigured()) throw new XError('X is not configured on this server (X_CLIENT_ID, X_CLIENT_SECRET, X_REDIRECT_URI).');
  for (const [k, v] of pending) if (Date.now() - v.at > 10 * 60_000) pending.delete(k);
  const state = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(48));
  pending.set(state, { verifier, at: Date.now() });
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  const p = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.X_CLIENT_ID!,
    redirect_uri: process.env.X_REDIRECT_URI!,
    scope: SCOPES.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return `${AUTHORIZE}?${p}`;
}

async function tokenCall(body: Record<string, string>) {
  const basic = Buffer.from(`${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`).toString('base64');
  const r = await fetch(`${API}/oauth2/token`, {
    method: 'POST',
    headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error_description?: string; error?: string };
  if (!r.ok || !j.access_token) throw new XError(`X token request failed (${r.status}): ${j.error_description || j.error || 'no token'}`);
  return { access: j.access_token, refresh: j.refresh_token ?? null, expiresAt: Date.now() + (j.expires_in ?? 7200) * 1000, scope: j.scope ?? null };
}

async function me(access: string): Promise<{ id: string; username: string }> {
  const r = await fetch(`${API}/users/me`, { headers: { authorization: `Bearer ${access}` }, signal: AbortSignal.timeout(20_000) });
  const j = (await r.json().catch(() => ({}))) as { data?: { id: string; username: string } };
  if (!r.ok || !j.data) throw new XError(`X did not say which account this is (${r.status}).`);
  return j.data;
}

async function revoke(token: string) {
  const basic = Buffer.from(`${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`).toString('base64');
  await fetch(`${API}/oauth2/revoke`, {
    method: 'POST',
    headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token, token_type_hint: 'access_token' }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => undefined);
}

/** Finish a connect. Refuses (and revokes) any account other than X_HANDLE. */
export async function xCallback(code: string, state: string): Promise<{ username: string }> {
  const p = pending.get(state);
  pending.delete(state);
  if (!p || Date.now() - p.at > 10 * 60_000) throw new XError('This connect link expired. Press Connect X again.');
  const t = await tokenCall({ grant_type: 'authorization_code', code, redirect_uri: process.env.X_REDIRECT_URI!, code_verifier: p.verifier, client_id: process.env.X_CLIENT_ID! });
  const u = await me(t.access);
  if (u.username.toLowerCase() !== xHandle()) {
    await revoke(t.access);
    throw new XError(`You authorized @${u.username}, but only @${xHandle()} may be connected. Log in to X as @${xHandle()} and try again. Nothing was saved.`);
  }
  db.prepare(
    `INSERT INTO x_auth (id, user_id, username, access_token, refresh_token, expires_at, scope, connected_at) VALUES (1,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id, username=excluded.username, access_token=excluded.access_token,
       refresh_token=excluded.refresh_token, expires_at=excluded.expires_at, scope=excluded.scope, connected_at=excluded.connected_at`,
  ).run(u.id, u.username, t.access, t.refresh, t.expiresAt, t.scope, now());
  return { username: u.username };
}

export async function xDisconnect() {
  const a = readAuth();
  db.prepare('DELETE FROM x_auth WHERE id = 1').run();
  if (a) await revoke(a.access_token);
}

/** A valid access token for the allowed account, refreshing it when it is about to expire. */
async function token(): Promise<Auth> {
  const a = readAuth();
  if (!a) throw new XError('X is not connected. Open /admin/herald and press Connect X while logged in as @' + xHandle() + '.');
  if (a.username.toLowerCase() !== xHandle()) throw new XError(`The connected account @${a.username} is not @${xHandle()}. Disconnect it first.`);
  if (a.expires_at - Date.now() > 120_000) return a;
  if (!a.refresh_token) throw new XError('The X session expired. Press Connect X again.');
  const t = await tokenCall({ grant_type: 'refresh_token', refresh_token: a.refresh_token, client_id: process.env.X_CLIENT_ID! });
  db.prepare('UPDATE x_auth SET access_token = ?, refresh_token = COALESCE(?, refresh_token), expires_at = ? WHERE id = 1').run(t.access, t.refresh, t.expiresAt);
  return readAuth()!;
}

// ---------------- posting ----------------
/** X's weighted length: most Latin text counts 1, CJK and emoji count 2, every link counts 23. */
export function xLength(text: string): number {
  let n = 0;
  const rest = text.replace(/https?:\/\/\S+/gi, () => {
    n += 23;
    return '';
  });
  for (const ch of rest) {
    const c = ch.codePointAt(0)!;
    const light = c <= 4351 || (c >= 8192 && c <= 8205) || (c >= 8208 && c <= 8223) || (c >= 8242 && c <= 8247);
    n += light ? 1 : 2;
  }
  return n;
}

export function checkXText(raw: string): string {
  const text = String(raw ?? '').replace(/\r\n/g, '\n').trim();
  if (!text) throw new XError('The post is empty.');
  const len = xLength(text);
  if (len > X_MAX_CHARS) throw new XError(`Too long for X: ${len}/${X_MAX_CHARS} characters.`);
  return text;
}

async function uploadImage(access: string, src: string): Promise<string> {
  const file = resolveUpload(src);
  const buf = fs.readFileSync(file);
  if (buf.length > IMAGE_MAX) throw new XError('The image is over 5 MB.');
  const ext = sniff(buf);
  if (!ext || !['jpg', 'png', 'webp', 'gif'].includes(ext)) throw new XError('Only JPG, PNG, WEBP or GIF images can be posted.');
  const form = new FormData();
  form.append('media', new Blob([new Uint8Array(buf)], { type: MIME[ext] }), `image.${ext}`);
  form.append('media_category', 'tweet_image');
  const r = await fetch(`${API}/media/upload`, { method: 'POST', headers: { authorization: `Bearer ${access}` }, body: form, signal: AbortSignal.timeout(60_000) });
  const j = (await r.json().catch(() => ({}))) as { data?: { id?: string }; detail?: string; title?: string };
  if (!r.ok || !j.data?.id) throw new XError(`X image upload failed (${r.status}): ${j.detail || j.title || 'no media id'}`);
  return j.data.id;
}

async function addAlt(access: string, mediaId: string, alt: string) {
  await fetch(`${API}/media/metadata`, {
    method: 'POST',
    headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' },
    body: JSON.stringify({ id: mediaId, metadata: { alt_text: { text: alt.slice(0, 1000) } } }),
    signal: AbortSignal.timeout(20_000),
  }).catch(() => undefined); // alt text is best effort; the post still goes out
}

/** Post as the connected realm account. Only server/herald.ts calls this. */
export async function xPost(text: string, opts: { image?: string | null; alt?: string } = {}): Promise<{ id: string; url: string; postedAt: string }> {
  const body = checkXText(text);
  const a = await token();
  const payload: { text: string; media?: { media_ids: string[] } } = { text: body };
  if (opts.image) {
    const id = await uploadImage(a.access_token, opts.image);
    if (opts.alt) await addAlt(a.access_token, id, opts.alt);
    payload.media = { media_ids: [id] };
  }
  const r = await fetch(`${API}/tweets`, {
    method: 'POST',
    headers: { authorization: `Bearer ${a.access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });
  const j = (await r.json().catch(() => ({}))) as { data?: { id?: string }; detail?: string; title?: string };
  if (!r.ok || !j.data?.id) throw new XError(`X did not publish it (${r.status}): ${j.detail || j.title || 'no post id'}`);
  return { id: j.data.id, url: `https://x.com/${a.username}/status/${j.data.id}`, postedAt: now() };
}
