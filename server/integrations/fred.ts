// FRED (Federal Reserve Bank of St. Louis): US economic series search and observations.
// The key goes in `api_key` (stripped from logs). Every result links to the public series page.
import { clip, fetchJson, qs, type CallContext } from './http';
import { requireKey } from './keys';

const P = 'fred';
const BASE = 'https://api.stlouisfed.org/fred';
export const FRED_POPULAR: Record<string, string> = {
  CPIAUCSL: 'Consumer Price Index (all urban consumers)',
  UNRATE: 'Unemployment rate',
  FEDFUNDS: 'Federal funds effective rate',
  GDP: 'Gross domestic product',
  DGS10: '10-year Treasury yield',
  PAYEMS: 'Total nonfarm payrolls',
  MORTGAGE30US: '30-year fixed mortgage rate',
  M2SL: 'M2 money supply',
};
export const isSeriesId = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_.]{1,40}$/.test(s.trim());
export const seriesPage = (id: string) => `https://fred.stlouisfed.org/series/${encodeURIComponent(id)}`;

export interface FredSeriesInfo {
  id: string;
  title: string;
  frequency: string;
  units: string;
  seasonalAdjustment: string | null;
  start: string;
  end: string;
  lastUpdated: string;
  popularity: number | null;
  url: string;
}
export interface FredSearch {
  query: string;
  total: number;
  results: FredSeriesInfo[];
  sourceUrl: string;
  fetchedAt: string;
}
export interface FredObservations {
  series: FredSeriesInfo;
  /** Oldest first. Missing values (".") are dropped. */
  points: { date: string; value: number }[];
  sourceUrl: string;
  fetchedAt: string;
}

const key = () => requireKey(P);
function info(s: any): FredSeriesInfo {
  return {
    id: s.id,
    title: clip(s.title ?? s.id, 200),
    frequency: s.frequency ?? '',
    units: s.units ?? '',
    seasonalAdjustment: s.seasonal_adjustment_short ?? null,
    start: s.observation_start ?? '',
    end: s.observation_end ?? '',
    lastUpdated: s.last_updated ?? '',
    popularity: typeof s.popularity === 'number' ? s.popularity : null,
    url: seriesPage(s.id),
  };
}

/** Search series by keywords (FRED relevance order). */
export async function fredSearch(query: string, ctx: CallContext, limit = 10): Promise<FredSearch> {
  const q = query.trim();
  if (!q) throw new Error('query is required.');
  if (q.length > 120) throw new Error('query is too long (max 120 characters).');
  const url = `${BASE}/series/search` + qs({ search_text: q, file_type: 'json', limit: Math.min(25, Math.max(1, limit)), api_key: key() });
  const r = await fetchJson<any>(url, { provider: P, ctx, ttlMs: 6 * 3600_000, timeoutMs: 15_000 });
  return {
    query: q,
    total: Number(r.data?.count ?? 0),
    results: ((r.data?.seriess ?? []) as any[]).map(info),
    sourceUrl: `https://fred.stlouisfed.org/searchresults/?st=${encodeURIComponent(q)}`,
    fetchedAt: r.fetchedAt,
  };
}

/** The latest `limit` observations (default 60, max 500) of one series, e.g. CPIAUCSL. */
export async function fredSeries(seriesId: string, ctx: CallContext, limit = 60): Promise<FredObservations> {
  if (!isSeriesId(seriesId)) throw new Error('series must be a FRED series id, e.g. CPIAUCSL or UNRATE.');
  const id = seriesId.trim().toUpperCase();
  const k = key();
  const meta = await fetchJson<any>(`${BASE}/series` + qs({ series_id: id, file_type: 'json', api_key: k }), { provider: P, ctx, ttlMs: 6 * 3600_000, timeoutMs: 15_000, okStatuses: [400, 404] });
  const s = meta.data?.seriess?.[0];
  if (!s) throw new Error(`FRED has no series called “${id}”.`);
  const obs = await fetchJson<any>(
    `${BASE}/series/observations` + qs({ series_id: id, file_type: 'json', sort_order: 'desc', limit: Math.min(500, Math.max(2, limit)), api_key: k }),
    { provider: P, ctx, ttlMs: 3 * 3600_000, timeoutMs: 15_000 },
  );
  const points = ((obs.data?.observations ?? []) as any[])
    .map((o) => ({ date: String(o.date), value: Number(o.value) }))
    .filter((p) => p.date && Number.isFinite(p.value))
    .reverse();
  return { series: info(s), points, sourceUrl: seriesPage(id), fetchedAt: obs.fetchedAt };
}
