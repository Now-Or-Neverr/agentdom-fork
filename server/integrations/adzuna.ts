// Adzuna: live job listings in 19 countries. Free developer tier (rate-limited),
// so answers are cached for 30 minutes. app_id / app_key travel in the query string
// and are masked by safeEndpoint() before anything is logged.
import { clip, fetchJson, qs, type CallContext } from './http';
import { requireKey } from './keys';

const P = 'adzuna';
const BASE = 'https://api.adzuna.com/v1/api/jobs';
const TTL = 30 * 60_000;

export const ADZUNA_COUNTRIES = ['gb', 'us', 'au', 'at', 'be', 'br', 'ca', 'ch', 'de', 'es', 'fr', 'in', 'it', 'mx', 'nl', 'nz', 'pl', 'sg', 'za'] as const;
export type AdzunaCountry = (typeof ADZUNA_COUNTRIES)[number];

export interface JobListing {
  title: string;
  company: string | null;
  location: string | null;
  category: string | null;
  contract: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  /** true when Adzuna estimated the salary instead of reading it from the ad */
  salaryEstimated: boolean;
  posted: string | null;
  snippet: string;
  url: string;
}
export interface JobSearch {
  query: string;
  where: string | null;
  country: AdzunaCountry;
  total: number;
  jobs: JobListing[];
  sourceUrl: string;
  fetchedAt: string;
}

const plain = (s: unknown) => (typeof s === 'string' ? s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '');
const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x) : null);

/** Search live job ads. `where` is a city or region; `remote` adds "remote" to the keywords. */
export async function jobSearch(
  query: string,
  ctx: CallContext,
  opts: { country?: string; where?: string; max?: number; salaryMin?: number; fullTime?: boolean } = {},
): Promise<JobSearch> {
  const key = requireKey(P);
  const id = process.env.ADZUNA_APP_ID;
  if (!id) throw new Error('Adzuna is not configured on this server (missing ADZUNA_APP_ID).');
  const what = query.trim();
  if (!what) throw new Error('query is required.');
  if (what.length > 120) throw new Error('query is too long (max 120 characters).');
  const country = (opts.country ?? 'gb').trim().toLowerCase() as AdzunaCountry;
  if (!ADZUNA_COUNTRIES.includes(country)) throw new Error(`country must be one of: ${ADZUNA_COUNTRIES.join(', ')}.`);
  const where = opts.where?.trim() ? clip(opts.where.trim(), 80) : undefined;
  const max = Math.min(15, Math.max(1, opts.max ?? 10));
  const url =
    `${BASE}/${country}/search/1` +
    qs({
      app_id: id,
      app_key: key,
      what,
      where,
      results_per_page: max,
      salary_min: opts.salaryMin && opts.salaryMin > 0 ? Math.round(opts.salaryMin) : undefined,
      full_time: opts.fullTime ? 1 : undefined,
      sort_by: 'relevance',
      'content-type': 'application/json',
    });
  const r = await fetchJson<any>(url, { provider: P, ctx, ttlMs: TTL, timeoutMs: 15_000 });
  const jobs: JobListing[] = ((r.data?.results ?? []) as any[])
    .filter((j) => typeof j?.redirect_url === 'string')
    .map((j) => ({
      title: clip(plain(j.title), 160),
      company: plain(j.company?.display_name) || null,
      location: plain(j.location?.display_name) || null,
      category: plain(j.category?.label) || null,
      contract: [j.contract_time, j.contract_type].filter((x) => typeof x === 'string').join(', ').replace(/_/g, ' ') || null,
      salaryMin: num(j.salary_min),
      salaryMax: num(j.salary_max),
      salaryEstimated: j.salary_is_predicted === '1' || j.salary_is_predicted === 1,
      posted: typeof j.created === 'string' ? j.created.slice(0, 10) : null,
      snippet: clip(plain(j.description), 300),
      url: j.redirect_url,
    }));
  const site = country === 'gb' ? 'www.adzuna.co.uk' : country === 'us' ? 'www.adzuna.com' : `www.adzuna.${country === 'au' ? 'com.au' : country}`;
  return {
    query: what,
    where: where ?? null,
    country,
    total: Number(r.data?.count ?? jobs.length),
    jobs,
    sourceUrl: jobs[0]?.url ?? `https://${site}`,
    fetchedAt: r.fetchedAt,
  };
}
