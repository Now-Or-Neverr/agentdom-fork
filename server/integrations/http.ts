// HTTP core for every outbound call to a public API.
// - timeout (AbortController), in-memory TTL cache keyed by URL (+ body for POST)
// - per-provider throttle (min interval between calls + max concurrent)
// - 1 retry on 5xx / network errors
// - every REAL outbound request is logged to the `api_calls` table.
//   Cache hits are NOT logged: one row = one request that actually left this server.
import { db, now, uid } from '../db';

export type CallContextKind = 'decree' | 'duty' | 'workshop' | 'realm';
/** What a call is for. `ref` is e.g. a decree id, duty kind or user id. */
export interface CallContext {
  context: CallContextKind;
  ref?: string | null;
}

/** A parsed response plus when it was really fetched (cache hits keep the original time). */
export interface Fetched<T> {
  data: T;
  fetchedAt: string;
  cached: boolean;
  status: number;
}

/** Thrown when an upstream API fails (non-2xx, timeout, bad body). */
export class UpstreamError extends Error {
  constructor(
    public provider: string,
    public status: number, // 0 = network error / timeout
    msg: string,
  ) {
    super(msg);
    this.name = 'UpstreamError';
  }
}

export const USER_AGENT = 'Agentdom/0.1 (+https://github.com/agentdom)';

db.exec(`
CREATE TABLE IF NOT EXISTS api_calls (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  status INTEGER NOT NULL,
  ok INTEGER NOT NULL,
  ms INTEGER NOT NULL,
  context TEXT NOT NULL,
  ref TEXT,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS api_calls_at ON api_calls(at);
CREATE INDEX IF NOT EXISTS api_calls_provider ON api_calls(provider, at);
`);

const MAX_ROWS = 5000;
let inserts = 0;
const SECRET_PARAM = /(key|token|secret|auth|password|passwd|signature|sig|session|access|appid|app_id)/i;

/** URL path + query with anything that looks like a credential removed. */
export function safeEndpoint(url: string): string {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (SECRET_PARAM.test(k)) u.searchParams.set(k, '***');
    let s = decodeURIComponent(u.pathname) + (u.search ? decodeURIComponent(u.search.replace(/\+/g, ' ')) : '');
    // Strip any configured secret value that might sit inside the path.
    for (const [k, v] of Object.entries(process.env)) if (v && v.length >= 12 && /KEY|TOKEN|SECRET/.test(k) && s.includes(v)) s = s.split(v).join('***');
    return s.slice(0, 400);
  } catch {
    return '(invalid url)';
  }
}

function logCall(provider: string, url: string, status: number, ok: boolean, ms: number, ctx: CallContext, label?: string) {
  try {
    db.prepare('INSERT INTO api_calls (id, provider, endpoint, status, ok, ms, context, ref, at) VALUES (?,?,?,?,?,?,?,?,?)').run(
      uid('api'),
      provider,
      label ? label.slice(0, 400) : safeEndpoint(url),
      status,
      ok ? 1 : 0,
      Math.round(ms),
      ctx.context,
      ctx.ref ? String(ctx.ref).slice(0, 120) : null,
      now(),
    );
    if (++inserts % 100 === 0) {
      db.prepare(`DELETE FROM api_calls WHERE at < (SELECT at FROM api_calls ORDER BY at DESC LIMIT 1 OFFSET ?)`).run(MAX_ROWS - 1);
    }
  } catch (e) {
    console.error('[integrations] could not log api call', (e as Error).message);
  }
}

// ---------------- throttle ----------------
export interface Throttle {
  minIntervalMs: number;
  maxConcurrent: number;
}
const DEFAULT_THROTTLE: Throttle = { minIntervalMs: 200, maxConcurrent: 3 };
const throttles = new Map<string, Throttle>();
const state = new Map<string, { active: number; last: number; queue: (() => void)[] }>();

/** Set the throttle for one provider (registry does this at load). */
export function setThrottle(provider: string, t: Throttle) {
  throttles.set(provider, t);
}
/** Milliseconds until this provider's next call could start (ignores calls still queued). */
export function nextSlotIn(provider: string): number {
  const t = throttles.get(provider) ?? DEFAULT_THROTTLE;
  const s = state.get(provider);
  return s ? Math.max(0, s.last + t.minIntervalMs - Date.now()) : 0;
}
const labels = new Map<string, string>();
/** Display name used in error messages (registry does this at load). */
export function setLabel(provider: string, name: string) {
  labels.set(provider, name);
}
const label = (p: string) => labels.get(p) ?? p;

function slot(provider: string) {
  let s = state.get(provider);
  if (!s) state.set(provider, (s = { active: 0, last: 0, queue: [] }));
  return s;
}
async function acquire(provider: string): Promise<void> {
  const t = throttles.get(provider) ?? DEFAULT_THROTTLE;
  const s = slot(provider);
  while (s.active >= t.maxConcurrent) await new Promise<void>((r) => s.queue.push(r));
  s.active++;
  const wait = s.last + t.minIntervalMs - Date.now();
  s.last = Math.max(Date.now(), s.last + t.minIntervalMs);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}
function release(provider: string) {
  const s = slot(provider);
  s.active--;
  s.queue.shift()?.();
}

// ---------------- cache ----------------
const cache = new Map<string, { exp: number; value: Fetched<unknown> }>();
const inflight = new Map<string, Promise<Fetched<unknown>>>();
const MAX_CACHE = 800;
function cacheGet<T>(key: string): Fetched<T> | null {
  const c = cache.get(key);
  if (!c) return null;
  if (c.exp < Date.now()) {
    cache.delete(key);
    return null;
  }
  return { ...(c.value as Fetched<T>), cached: true };
}
function cacheSet(key: string, value: Fetched<unknown>, ttlMs: number) {
  if (ttlMs <= 0) return;
  if (cache.size >= MAX_CACHE) {
    const t = Date.now();
    for (const [k, v] of cache) if (v.exp < t) cache.delete(k);
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value as string);
  }
  cache.set(key, { exp: Date.now() + ttlMs, value });
}

// ---------------- request ----------------
export interface RequestOpts {
  provider: string; // registry id, used for throttle + log
  ctx: CallContext;
  ttlMs?: number; // cache lifetime; 0 = no cache (default 5 min)
  timeoutMs?: number; // default 12 s
  retries?: number; // default 1 (only on 5xx / network)
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Binary / multipart bodies are never cached. */
  body?: string | URLSearchParams | FormData | Blob | Uint8Array;
  /** Logged instead of the URL, for APIs with a secret or account id in the path (e.g. "telegram:sendMessage"). */
  logEndpoint?: string;
  headers?: Record<string, string>;
  accept?: string;
  /** Treat these HTTP statuses as a valid answer (e.g. 404 = "word not found"). */
  okStatuses?: number[];
}

type Kind = 'json' | 'text' | 'buffer';

async function request<T>(url: string, kind: Kind, o: RequestOpts): Promise<Fetched<T>> {
  const method = o.method ?? 'GET';
  const textBody = o.body === undefined || typeof o.body === 'string' || o.body instanceof URLSearchParams;
  const bodyStr = textBody ? (o.body === undefined ? '' : String(o.body)) : '';
  const key = `${kind} ${method} ${url} ${bodyStr}`;
  const ttl = textBody ? (o.ttlMs ?? 5 * 60_000) : 0;
  if (ttl > 0) {
    const hit = cacheGet<T>(key);
    if (hit) return hit;
    const fly = inflight.get(key);
    if (fly) return (await fly) as Fetched<T>;
  }
  const run = (async () => {
    const retries = o.retries ?? 1;
    let lastErr: UpstreamError | null = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 600 * attempt));
      await acquire(o.provider);
      const t0 = performance.now();
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), o.timeoutMs ?? 12_000);
      let status = 0;
      try {
        const res = await fetch(url, {
          method,
          body: o.body as BodyInit | undefined,
          signal: ac.signal,
          redirect: 'follow',
          headers: {
            'user-agent': USER_AGENT,
            accept: o.accept ?? (kind === 'json' ? 'application/json' : '*/*'),
            ...(o.headers ?? {}),
          },
        });
        status = res.status;
        const accepted = res.ok || (o.okStatuses ?? []).includes(res.status);
        let data: unknown;
        if (kind === 'buffer') data = { buf: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get('content-type') ?? '', headers: Object.fromEntries(res.headers.entries()) };
        else {
          const txt = await res.text();
          if (kind === 'json' && accepted) {
            try {
              data = txt ? JSON.parse(txt) : null;
            } catch {
              if (!res.ok) data = null; // e.g. an HTML 404 page we chose to accept
              else {
              logCall(o.provider, url, status, false, performance.now() - t0, o.ctx, o.logEndpoint);
              throw new UpstreamError(o.provider, status, `${label(o.provider)} sent a response that is not valid JSON.`);
              }
            }
          } else data = txt;
        }
        const ms = performance.now() - t0;
        logCall(o.provider, url, status, accepted, ms, o.ctx, o.logEndpoint);
        if (!accepted) {
          lastErr = new UpstreamError(o.provider, status, `${label(o.provider)} returned HTTP ${status}.`);
          if (status >= 500 && attempt < retries) continue;
          throw lastErr;
        }
        const value: Fetched<T> = { data: data as T, fetchedAt: now(), cached: false, status };
        if (res.ok) cacheSet(key, value, ttl);
        return value;
      } catch (e) {
        if (e instanceof UpstreamError) {
          if (e === lastErr && status >= 500 && attempt < retries) continue;
          throw e;
        }
        const aborted = (e as Error).name === 'AbortError';
        logCall(o.provider, url, 0, false, performance.now() - t0, o.ctx, o.logEndpoint);
        lastErr = new UpstreamError(o.provider, 0, aborted ? `${label(o.provider)} did not answer in time.` : `Could not reach ${label(o.provider)}.`);
        if (attempt < retries) continue;
        throw lastErr;
      } finally {
        clearTimeout(timer);
        release(o.provider);
      }
    }
    throw lastErr ?? new UpstreamError(o.provider, 0, `Could not reach ${label(o.provider)}.`);
  })();
  if (ttl > 0) inflight.set(key, run as Promise<Fetched<unknown>>);
  try {
    return await run;
  } finally {
    inflight.delete(key);
  }
}

/** GET/POST and parse JSON. */
export const fetchJson = <T = unknown>(url: string, o: RequestOpts) => request<T>(url, 'json', o);
/** GET/POST and return the body as text (e.g. Atom XML). */
export const fetchText = (url: string, o: RequestOpts) => request<string>(url, 'text', o);
/** GET raw bytes (e.g. an image). Not cached unless ttlMs is given. */
export const fetchBuffer = (url: string, o: RequestOpts) => request<{ buf: Buffer; contentType: string; headers?: Record<string, string> }>(url, 'buffer', { ttlMs: 0, ...o });

/** Build a query string from an object (skips undefined/empty). */
export function qs(o: Record<string, string | number | boolean | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? '?' + s : '';
}

/** Remove HTML tags and decode the few entities public APIs send. */
export function stripHtml(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}
export function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}
export const clip = (s: string | null | undefined, n: number) => {
  const t = (s ?? '').trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
};
