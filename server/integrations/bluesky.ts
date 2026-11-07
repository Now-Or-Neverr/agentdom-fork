// Bluesky (AT Protocol) for the realm account: createSession + app.bsky.feed.post with link
// and hashtag facets and an optional image (uploadBlob). Posting is only ever triggered by an
// admin approving a draft in the Herald queue (server/herald.ts). The password and session
// tokens never leave this module (request bodies are not logged; only paths are).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { fetchJson, UpstreamError, type CallContext } from './http';
import { MIME, resolveUpload, sniff } from './media-common';

const PDS = () => (process.env.BLUESKY_SERVICE || 'https://bsky.social').replace(/\/$/, '');
export const BSKY_MAX_GRAPHEMES = 300;
const BLOB_MAX = 950_000; // Bluesky image limit is ~976 KB

export const bskyEnabled = () => Boolean(process.env.BLUESKY_HANDLE && process.env.BLUESKY_APP_PASSWORD);

interface Session {
  did: string;
  handle: string;
  accessJwt: string;
  exp: number;
}
let session: Session | null = null;

/** Log in (or reuse a session < 90 min old). Returns only public identity fields. */
export async function bskySession(ctx: CallContext, fresh = false): Promise<{ did: string; handle: string }> {
  if (!fresh && session && session.exp > Date.now()) return { did: session.did, handle: session.handle };
  const identifier = process.env.BLUESKY_HANDLE;
  const password = process.env.BLUESKY_APP_PASSWORD;
  if (!identifier || !password) throw new UpstreamError('bluesky', 0, 'Bluesky is not configured on this server.');
  const r = await fetchJson<{ did?: string; handle?: string; accessJwt?: string; error?: string; message?: string }>(`${PDS()}/xrpc/com.atproto.server.createSession`, {
    provider: 'bluesky',
    ctx,
    method: 'POST',
    ttlMs: 0,
    retries: 0,
    timeoutMs: 20_000,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
    okStatuses: [400, 401],
  });
  if (r.status !== 200 || !r.data?.accessJwt || !r.data.did) throw new UpstreamError('bluesky', r.status, 'Bluesky rejected the login (check BLUESKY_HANDLE and the app password).');
  session = { did: r.data.did, handle: r.data.handle ?? identifier, accessJwt: r.data.accessJwt, exp: Date.now() + 90 * 60_000 };
  return { did: session.did, handle: session.handle };
}
/** Forget the cached session (used by tests that only prove credentials). */
export function bskyForgetSession() {
  session = null;
}

// ---------------- record building (pure) ----------------
export interface Facet {
  index: { byteStart: number; byteEnd: number };
  features: ({ $type: 'app.bsky.richtext.facet#link'; uri: string } | { $type: 'app.bsky.richtext.facet#tag'; tag: string })[];
}
export interface BlobRef {
  $type: 'blob';
  ref: { $link: string };
  mimeType: string;
  size: number;
}
export interface PostRecord {
  $type: 'app.bsky.feed.post';
  text: string;
  createdAt: string;
  langs: string[];
  facets?: Facet[];
  embed?: { $type: 'app.bsky.embed.images'; images: { alt: string; image: BlobRef }[] };
}

export function graphemes(s: string): number {
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(s: string): Iterable<unknown> } }).Segmenter;
  return Seg ? [...new Seg(undefined, { granularity: 'grapheme' }).segment(s)].length : [...s].length;
}

/** Link + hashtag facets with UTF-8 byte offsets (what the AT Protocol requires). */
export function detectFacets(text: string): Facet[] {
  const facets: Facet[] = [];
  const bytes = (s: string) => Buffer.byteLength(s, 'utf8');
  const urlRe = /https?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:!?]/g;
  for (const m of text.matchAll(urlRe)) {
    const start = bytes(text.slice(0, m.index));
    facets.push({ index: { byteStart: start, byteEnd: start + bytes(m[0]) }, features: [{ $type: 'app.bsky.richtext.facet#link', uri: m[0] }] });
  }
  const tagRe = /(^|\s)#([\p{L}\p{N}_]{1,64})/gu;
  for (const m of text.matchAll(tagRe)) {
    if (/^\d+$/.test(m[2])) continue;
    const at = (m.index ?? 0) + m[1].length;
    const start = bytes(text.slice(0, at));
    facets.push({ index: { byteStart: start, byteEnd: start + bytes('#' + m[2]) }, features: [{ $type: 'app.bsky.richtext.facet#tag', tag: m[2] }] });
  }
  return facets.sort((a, b) => a.index.byteStart - b.index.byteStart);
}

export function checkPostText(text: string): string {
  const t = String(text ?? '').replace(/\r\n/g, '\n').trim();
  if (!t) throw new Error('Post text is empty.');
  const n = graphemes(t);
  if (n > BSKY_MAX_GRAPHEMES) throw new Error(`A Bluesky post can have at most ${BSKY_MAX_GRAPHEMES} characters (this one has ${n}).`);
  return t;
}

/** Build the post record exactly as it would be sent. */
export function buildPostRecord(text: string, opts: { image?: { blob: BlobRef; alt: string } | null; lang?: string; createdAt?: string } = {}): PostRecord {
  const t = checkPostText(text);
  const rec: PostRecord = { $type: 'app.bsky.feed.post', text: t, createdAt: opts.createdAt ?? new Date().toISOString(), langs: [opts.lang ?? 'en'] };
  const facets = detectFacets(t);
  if (facets.length) rec.facets = facets;
  if (opts.image) rec.embed = { $type: 'app.bsky.embed.images', images: [{ alt: opts.image.alt.slice(0, 1000), image: opts.image.blob }] };
  return rec;
}

// ---------------- image upload ----------------
function shrinkToJpeg(file: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error('ffmpeg is not available to shrink the image.'));
    const out = path.join(os.tmpdir(), `bsky-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`);
    const p = spawn(ffmpegPath as unknown as string, ['-y', '-loglevel', 'error', '-i', file, '-vf', "scale='min(1600,iw)':-2", '-q:v', '5', '-frames:v', '1', out], { windowsHide: true });
    p.on('error', reject);
    p.on('close', (code) => {
      try {
        if (code !== 0 || !fs.existsSync(out)) return reject(new Error('Could not shrink the image for Bluesky.'));
        resolve(fs.readFileSync(out));
      } finally {
        fs.rmSync(out, { force: true });
      }
    });
  });
}

/** Read a local image and make sure it fits Bluesky's blob limit. Pure-ish (no network). */
export async function prepareImage(src: string): Promise<{ buf: Buffer; mime: string }> {
  const file = resolveUpload(src);
  let buf = fs.readFileSync(file);
  let ext = sniff(buf);
  if (!ext || !['jpg', 'png', 'webp'].includes(ext)) throw new Error('Bluesky images must be JPG, PNG or WebP.');
  if (buf.length > BLOB_MAX) {
    buf = await shrinkToJpeg(file);
    ext = 'jpg';
    if (buf.length > BLOB_MAX) throw new Error('The image is too large for Bluesky even after shrinking.');
  }
  return { buf, mime: MIME[ext] };
}

async function uploadBlob(buf: Buffer, mime: string, ctx: CallContext): Promise<BlobRef> {
  if (!session) throw new Error('No Bluesky session.');
  const r = await fetchJson<{ blob?: BlobRef }>(`${PDS()}/xrpc/com.atproto.repo.uploadBlob`, {
    provider: 'bluesky',
    ctx,
    method: 'POST',
    retries: 0,
    timeoutMs: 45_000,
    headers: { authorization: `Bearer ${session.accessJwt}`, 'content-type': mime },
    body: new Uint8Array(buf),
  });
  if (!r.data?.blob?.ref) throw new UpstreamError('bluesky', r.status, 'Bluesky did not accept the image.');
  return r.data.blob;
}

export interface BskyPosted {
  uri: string;
  cid: string;
  url: string; // https://bsky.app/profile/<handle>/post/<rkey>
  handle: string;
  postedAt: string;
}

/** Really publish one post on the realm account. Only call this from an admin approval. */
export async function bskyPost(text: string, ctx: CallContext, opts: { image?: string | null; alt?: string; lang?: string } = {}): Promise<BskyPosted> {
  checkPostText(text);
  const prepared = opts.image ? await prepareImage(opts.image) : null;
  let who = await bskySession(ctx);
  const send = async () => {
    const blob = prepared ? await uploadBlob(prepared.buf, prepared.mime, ctx) : null;
    const record = buildPostRecord(text, { image: blob ? { blob, alt: opts.alt ?? '' } : null, lang: opts.lang });
    return fetchJson<{ uri?: string; cid?: string; error?: string; message?: string }>(`${PDS()}/xrpc/com.atproto.repo.createRecord`, {
      provider: 'bluesky',
      ctx,
      method: 'POST',
      ttlMs: 0,
      retries: 0,
      timeoutMs: 30_000,
      headers: { authorization: `Bearer ${session!.accessJwt}`, 'content-type': 'application/json' },
      body: JSON.stringify({ repo: session!.did, collection: 'app.bsky.feed.post', record }),
      okStatuses: [400, 401],
    });
  };
  let r = await send();
  if (r.status === 401 || r.data?.error === 'ExpiredToken') {
    who = await bskySession(ctx, true);
    r = await send();
  }
  if (r.status !== 200 || !r.data?.uri) throw new UpstreamError('bluesky', r.status, `Bluesky did not publish the post${r.data?.message ? `: ${r.data.message.slice(0, 160)}` : '.'}`);
  const rkey = r.data.uri.split('/').pop();
  return { uri: r.data.uri, cid: r.data.cid ?? '', url: `https://bsky.app/profile/${who.handle}/post/${rkey}`, handle: who.handle, postedAt: new Date().toISOString() };
}
