// NASA (api.nasa.gov): Astronomy Picture of the Day and near-Earth asteroids (NeoWs).
// The key goes in `api_key` (stripped from logs). The NASA Image and Video Library needs no key.
// APOD sometimes answers 500 or a placeholder page instead of the picture: both throw.
import { clip, fetchJson, qs, UpstreamError, type CallContext } from './http';
import { requireKey } from './keys';

const P = 'nasa';
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

export interface Apod {
  date: string;
  title: string;
  explanation: string;
  mediaType: 'image' | 'video' | string;
  url: string;
  hdUrl: string | null;
  copyright: string | null;
  /** The APOD page for that day on apod.nasa.gov. */
  sourceUrl: string;
  fetchedAt: string;
}

/** Astronomy Picture of the Day (today, or a YYYY-MM-DD date since 1995-06-16). */
export async function nasaApod(ctx: CallContext, date?: string): Promise<Apod> {
  const key = requireKey(P);
  if (date && !isDate(date)) throw new Error('date must be YYYY-MM-DD.');
  const url = 'https://api.nasa.gov/planetary/apod' + qs({ date, thumbs: true, api_key: key });
  const r = await fetchJson<any>(url, { provider: P, ctx, ttlMs: 60 * 60_000, timeoutMs: 20_000, retries: 2 });
  const d = r.data ?? {};
  const pic = String(d.url ?? '');
  // Seen in Nov 2026: the API returned title "NASA Science" with the NASA logo as the image.
  if (!d.title || !pic || /\/themes\/nasa-child\//.test(pic) || d.title === 'NASA Science')
    throw new UpstreamError(P, 200, 'NASA APOD returned a placeholder instead of the picture of the day (upstream issue).');
  const day = String(d.date ?? date ?? ymd(new Date()));
  return {
    date: day,
    title: clip(d.title, 200),
    explanation: clip(d.explanation ?? '', 1500),
    mediaType: d.media_type ?? 'image',
    url: d.media_type === 'video' && d.thumbnail_url ? d.thumbnail_url : pic,
    hdUrl: d.hdurl ?? null,
    copyright: d.copyright ? String(d.copyright).replace(/\s+/g, ' ').trim() : null,
    sourceUrl: `https://apod.nasa.gov/apod/ap${day.slice(2, 4)}${day.slice(5, 7)}${day.slice(8, 10)}.html`,
    fetchedAt: r.fetchedAt,
  };
}

export interface Asteroid {
  id: string;
  name: string;
  closeApproach: string; // UTC time of closest approach
  missKm: number;
  missLunar: number; // in Earth-Moon distances
  speedKmh: number;
  diameterM: { min: number; max: number };
  hazardous: boolean;
  url: string; // JPL Small-Body Database page
}
export interface AsteroidFeed {
  start: string;
  end: string;
  count: number;
  asteroids: Asteroid[]; // closest first
  sourceUrl: string;
  fetchedAt: string;
}

/** Asteroids passing Earth between two dates (max 7 days apart; default today). */
export async function nasaAsteroids(ctx: CallContext, start?: string, end?: string, limit = 10): Promise<AsteroidFeed> {
  const key = requireKey(P);
  const s = start ?? ymd(new Date());
  const e = end ?? s;
  if (!isDate(s) || !isDate(e)) throw new Error('dates must be YYYY-MM-DD.');
  const span = (Date.parse(e) - Date.parse(s)) / 86400_000;
  if (span < 0 || span > 7) throw new Error('end must be 0-7 days after start.');
  const url = 'https://api.nasa.gov/neo/rest/v1/feed' + qs({ start_date: s, end_date: e, api_key: key });
  const r = await fetchJson<any>(url, { provider: P, ctx, ttlMs: 60 * 60_000, timeoutMs: 20_000 });
  const days = (r.data?.near_earth_objects ?? {}) as Record<string, any[]>;
  const all: Asteroid[] = [];
  for (const list of Object.values(days))
    for (const a of list ?? []) {
      const ca = (a.close_approach_data ?? [])[0];
      if (!ca) continue;
      const dm = a.estimated_diameter?.meters ?? {};
      all.push({
        id: String(a.id),
        name: String(a.name ?? '').replace(/[()]/g, '').trim(),
        closeApproach: ca.epoch_date_close_approach ? new Date(Number(ca.epoch_date_close_approach)).toISOString() : String(ca.close_approach_date_full ?? ca.close_approach_date ?? ''),
        missKm: Math.round(Number(ca.miss_distance?.kilometers ?? 0)),
        missLunar: Math.round(Number(ca.miss_distance?.lunar ?? 0) * 10) / 10,
        speedKmh: Math.round(Number(ca.relative_velocity?.kilometers_per_hour ?? 0)),
        diameterM: { min: Math.round(Number(dm.estimated_diameter_min ?? 0)), max: Math.round(Number(dm.estimated_diameter_max ?? 0)) },
        hazardous: !!a.is_potentially_hazardous_asteroid,
        url: String(a.nasa_jpl_url ?? `https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=${a.id}`).replace(/^http:/, 'https:'),
      });
    }
  all.sort((a, b) => a.missKm - b.missKm);
  return { start: s, end: e, count: Number(r.data?.element_count ?? all.length), asteroids: all.slice(0, Math.min(25, limit)), sourceUrl: 'https://cneos.jpl.nasa.gov/ca/', fetchedAt: r.fetchedAt };
}

export interface NasaImage {
  nasaId: string;
  title: string;
  description: string;
  date: string;
  center: string | null;
  credit: string | null;
  thumb: string | null;
  url: string; // images.nasa.gov page
}
export interface NasaImageSearch {
  query: string;
  total: number;
  results: NasaImage[];
  sourceUrl: string;
  fetchedAt: string;
}

/** Search the NASA Image and Video Library (images only). */
export async function nasaImages(query: string, ctx: CallContext, limit = 8): Promise<NasaImageSearch> {
  const q = query.trim();
  if (!q) throw new Error('query is required.');
  const url = 'https://images-api.nasa.gov/search' + qs({ q, media_type: 'image', page_size: Math.min(20, Math.max(1, limit)) });
  const r = await fetchJson<any>(url, { provider: 'nasaimages', ctx, ttlMs: 60 * 60_000, timeoutMs: 15_000 });
  const items = (r.data?.collection?.items ?? []) as any[];
  return {
    query: q,
    total: Number(r.data?.collection?.metadata?.total_hits ?? items.length),
    results: items.slice(0, limit).map((it) => {
      const d = it.data?.[0] ?? {};
      return {
        nasaId: String(d.nasa_id ?? ''),
        title: clip(d.title ?? '(untitled)', 200),
        description: clip(String(d.description ?? '').replace(/<[^>]*>/g, ''), 400),
        date: String(d.date_created ?? '').slice(0, 10),
        center: d.center ?? null,
        credit: d.secondary_creator ?? d.photographer ?? null,
        thumb: it.links?.[0]?.href ?? null,
        url: `https://images.nasa.gov/details/${encodeURIComponent(d.nasa_id ?? '')}`,
      };
    }),
    sourceUrl: 'https://images.nasa.gov/search?q=' + encodeURIComponent(q),
    fetchedAt: r.fetchedAt,
  };
}
