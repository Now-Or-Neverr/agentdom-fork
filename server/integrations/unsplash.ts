// Unsplash photo search (demo tier: 50 requests an hour for the whole app).
// The key goes in the Authorization header (Client-ID). Unsplash rules: hotlink the image urls,
// credit the photographer with links (utm params), and call download_location when a photo is used.
import { clip, fetchJson, qs, type CallContext } from './http';
import { requireKey } from './keys';
import { QuotaError, recordUsage, usage } from './media-common';

const P = 'unsplash';
const HOURLY = Math.min(50, Number(process.env.UNSPLASH_PER_HOUR) || 40); // leave headroom under 50/h
const UTM = 'utm_source=agentdom&utm_medium=referral';
const withUtm = (u: string) => u + (u.includes('?') ? '&' : '?') + UTM;

function checkQuota() {
  const since = new Date(Date.now() - 3600_000).toISOString();
  if (usage(P, since) >= HOURLY) throw new QuotaError(`The realm's Unsplash allowance (${HOURLY} calls an hour) is used up. Try again later or use Pixabay.`);
}
function spend() {
  checkQuota();
  recordUsage(P, 1);
}
const headers = () => ({ Authorization: `Client-ID ${requireKey(P)}`, 'Accept-Version': 'v1' });

export interface UnsplashPhoto {
  id: string;
  description: string;
  width: number;
  height: number;
  color: string | null;
  /** Hotlinked image urls (Unsplash requires hotlinking). */
  small: string;
  regular: string;
  pageUrl: string; // photo page, with utm
  photographer: string;
  photographerUrl: string; // profile, with utm
  /** Call unsplashTrackDownload with this when the photo is actually used. */
  downloadLocation: string;
  credit: string; // "Photo by X on Unsplash"
}
export interface UnsplashSearch {
  query: string;
  total: number;
  results: UnsplashPhoto[];
  sourceUrl: string;
  fetchedAt: string;
}

/** Search Unsplash photos (cached for an hour to save the small allowance). */
export async function unsplashSearch(query: string, ctx: CallContext, opts: { perPage?: number; orientation?: 'landscape' | 'portrait' | 'squarish' } = {}): Promise<UnsplashSearch> {
  const q = query.trim();
  if (!q) throw new Error('query is required.');
  if (q.length > 100) throw new Error('query is too long (max 100 characters).');
  const url = 'https://api.unsplash.com/search/photos' + qs({ query: q, per_page: Math.min(12, Math.max(1, opts.perPage ?? 8)), orientation: opts.orientation, content_filter: 'high' });
  const h = headers();
  checkQuota();
  const r = await fetchJson<any>(url, { provider: P, ctx, headers: h, ttlMs: 60 * 60_000, timeoutMs: 15_000, retries: 0 });
  // Only count calls that really left the server: a cached answer costs nothing.
  if (!r.cached) recordUsage(P, 1);
  const rows = (r.data?.results ?? []) as any[];
  return {
    query: q,
    total: Number(r.data?.total ?? rows.length),
    results: rows.map((p) => {
      const who = String(p.user?.name ?? p.user?.username ?? 'Unknown');
      return {
        id: String(p.id),
        description: clip(p.alt_description ?? p.description ?? '', 200),
        width: Number(p.width ?? 0),
        height: Number(p.height ?? 0),
        color: p.color ?? null,
        small: String(p.urls?.small ?? ''),
        regular: String(p.urls?.regular ?? ''),
        pageUrl: withUtm(String(p.links?.html ?? `https://unsplash.com/photos/${p.id}`)),
        photographer: who,
        photographerUrl: withUtm(String(p.user?.links?.html ?? 'https://unsplash.com')),
        downloadLocation: String(p.links?.download_location ?? ''),
        credit: `Photo by ${who} on Unsplash`,
      };
    }),
    sourceUrl: withUtm('https://unsplash.com/s/photos/' + encodeURIComponent(q)),
    fetchedAt: r.fetchedAt,
  };
}

/** Tell Unsplash a photo was used (required by their API guidelines). Counts against the allowance. */
export async function unsplashTrackDownload(downloadLocation: string, ctx: CallContext): Promise<void> {
  if (!/^https:\/\/api\.unsplash\.com\/photos\/[A-Za-z0-9_-]+\/download/.test(downloadLocation)) throw new Error('Not an Unsplash download_location url.');
  spend();
  await fetchJson<any>(downloadLocation, { provider: P, ctx, headers: headers(), ttlMs: 0, timeoutMs: 15_000, retries: 0 });
}
