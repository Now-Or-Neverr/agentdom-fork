// Brandfetch Brand API: logos, colours and fonts for a company domain.
// The account has only 100 lifetime credits that never reset, so:
// - every answer (found or "no brand") is cached in sqlite forever, keyed by domain
// - a domain is never requested twice (also not concurrently)
// - a hard lifetime cap (BRANDFETCH_MAX_CALLS, default 90) counts every real request in the DB
// The key goes in the Authorization header (Bearer).
import { db, now, uid } from '../db';
import { fetchJson, UpstreamError, type CallContext } from './http';
import { requireKey } from './keys';
import { QuotaError } from './media-common';

const P = 'brandfetch';

db.exec(`
CREATE TABLE IF NOT EXISTS brand_cache (
  domain TEXT PRIMARY KEY,
  found INTEGER NOT NULL,
  data TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS brandfetch_calls (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  status INTEGER NOT NULL,
  at TEXT NOT NULL
);
`);

export const brandMaxCalls = () => {
  const n = Number(process.env.BRANDFETCH_MAX_CALLS);
  return Number.isFinite(n) && n >= 0 ? Math.min(100, Math.floor(n)) : 90;
};
export function brandCallsUsed(): number {
  return Number((db.prepare('SELECT COUNT(*) AS n FROM brandfetch_calls').get() as { n: number }).n) || 0;
}

export interface BrandLogo {
  type: string;
  theme: string | null;
  formats: { format: string; src: string; width: number | null; height: number | null; background: string | null }[];
}
export interface Brand {
  domain: string;
  found: boolean;
  name: string | null;
  description: string | null;
  logos: BrandLogo[];
  colors: { hex: string; type: string | null; brightness: number | null }[];
  fonts: { name: string; type: string | null; origin: string | null }[];
  links: { name: string; url: string }[];
  /** true when the answer came from our permanent cache (no credit used) */
  cached: boolean;
  callsLeft: number;
  sourceUrl: string;
  fetchedAt: string;
}

/** "https://www.Stripe.com/pricing" → "stripe.com". */
export function normalizeDomain(input: string): string {
  let s = input.trim().toLowerCase();
  s = s.replace(/^[a-z]+:\/\//, '').split(/[/?#]/)[0].replace(/:\d+$/, '').replace(/^www\./, '');
  if (!/^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(s)) throw new Error('domain must be a company website domain, e.g. stripe.com.');
  return s;
}

function mapBrand(domain: string, d: any): Omit<Brand, 'cached' | 'callsLeft' | 'fetchedAt'> {
  const str = (x: unknown) => (typeof x === 'string' && x ? x : null);
  const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  return {
    domain,
    found: true,
    name: str(d?.name),
    description: str(d?.description) ? String(d.description).slice(0, 400) : null,
    logos: ((d?.logos ?? []) as any[]).slice(0, 8).map((l) => ({
      type: String(l?.type ?? 'logo'),
      theme: str(l?.theme),
      formats: ((l?.formats ?? []) as any[])
        .filter((f) => typeof f?.src === 'string' && /^https:\/\//.test(f.src))
        .slice(0, 4)
        .map((f) => ({ format: String(f.format ?? ''), src: f.src, width: n(f.width), height: n(f.height), background: str(f.background) })),
    })),
    colors: ((d?.colors ?? []) as any[]).filter((c) => typeof c?.hex === 'string').slice(0, 10).map((c) => ({ hex: c.hex, type: str(c.type), brightness: n(c.brightness) })),
    fonts: ((d?.fonts ?? []) as any[]).filter((f) => typeof f?.name === 'string').slice(0, 6).map((f) => ({ name: f.name, type: str(f.type), origin: str(f.origin) })),
    links: ((d?.links ?? []) as any[]).filter((l) => typeof l?.url === 'string').slice(0, 8).map((l) => ({ name: String(l.name ?? ''), url: l.url })),
    sourceUrl: `https://brandfetch.com/${domain}`,
  };
}

const inflight = new Map<string, Promise<Brand>>();

export async function brandLookup(input: string, ctx: CallContext): Promise<Brand> {
  const domain = normalizeDomain(input);
  const row = db.prepare('SELECT * FROM brand_cache WHERE domain = ?').get(domain) as { found: number; data: string; fetched_at: string } | undefined;
  if (row) return { ...(JSON.parse(row.data) as Omit<Brand, 'cached' | 'callsLeft'>), cached: true, callsLeft: Math.max(0, brandMaxCalls() - brandCallsUsed()) };
  const fly = inflight.get(domain);
  if (fly) return fly;
  const run = (async (): Promise<Brand> => {
    const key = requireKey(P);
    if (brandCallsUsed() >= brandMaxCalls()) throw new QuotaError('The realm’s Brandfetch lookup budget is used up (it is a one-time allowance that does not renew). Work from the company website instead.');
    // Count the call before it leaves, so a crash can never let us exceed the cap.
    const callId = uid('bfc');
    db.prepare('INSERT INTO brandfetch_calls (id, domain, status, at) VALUES (?,?,?,?)').run(callId, domain, 0, now());
    let r;
    try {
      r = await fetchJson<any>(`https://api.brandfetch.io/v2/brands/${encodeURIComponent(domain)}`, {
        provider: P,
        ctx,
        ttlMs: 0,
        retries: 0,
        timeoutMs: 20_000,
        headers: { authorization: `Bearer ${key}` },
        okStatuses: [404],
      });
    } catch (e) {
      if (e instanceof UpstreamError) db.prepare('UPDATE brandfetch_calls SET status = ? WHERE id = ?').run(e.status, callId);
      throw e;
    }
    db.prepare('UPDATE brandfetch_calls SET status = ? WHERE id = ?').run(r.status, callId);
    const base =
      r.status === 404 || !r.data
        ? { domain, found: false, name: null, description: null, logos: [], colors: [], fonts: [], links: [], sourceUrl: `https://brandfetch.com/${domain}` }
        : mapBrand(domain, r.data);
    const stored = { ...base, fetchedAt: r.fetchedAt };
    db.prepare('INSERT OR REPLACE INTO brand_cache (domain, found, data, fetched_at) VALUES (?,?,?,?)').run(domain, base.found ? 1 : 0, JSON.stringify(stored), r.fetchedAt);
    return { ...stored, cached: false, callsLeft: Math.max(0, brandMaxCalls() - brandCallsUsed()) };
  })();
  inflight.set(domain, run);
  try {
    return await run;
  } finally {
    inflight.delete(domain);
  }
}
