// Wikipedia: search (Action API), page summary and "On this day" (REST API).
import { clip, fetchJson, qs, stripHtml, type CallContext } from './http';

const P = 'wikipedia';
const wikiUrl = (title: string) => 'https://en.wikipedia.org/wiki/' + encodeURIComponent(title.replace(/ /g, '_'));

export interface WikiHit {
  title: string;
  snippet: string;
  url: string;
}
export interface WikiSearch {
  query: string;
  total: number;
  results: WikiHit[];
  sourceUrl: string;
  fetchedAt: string;
}

/** Full-text search on English Wikipedia. */
export async function wikiSearch(query: string, ctx: CallContext, limit = 5): Promise<WikiSearch> {
  const url = 'https://en.wikipedia.org/w/api.php' + qs({ action: 'query', list: 'search', srsearch: query, srlimit: Math.min(limit, 20), format: 'json', formatversion: 2 });
  const r = await fetchJson<any>(url, { provider: P, ctx, ttlMs: 30 * 60_000 });
  const hits = (r.data?.query?.search ?? []) as any[];
  return {
    query,
    total: Number(r.data?.query?.searchinfo?.totalhits ?? hits.length),
    results: hits.map((s) => ({ title: s.title, snippet: clip(stripHtml(s.snippet ?? ''), 220), url: wikiUrl(s.title) })),
    sourceUrl: 'https://en.wikipedia.org/w/index.php' + qs({ search: query, fulltext: 1 }),
    fetchedAt: r.fetchedAt,
  };
}

export interface WikiSummary {
  title: string;
  description: string | null;
  extract: string;
  thumbnail: string | null;
  url: string;
  sourceUrl: string;
  fetchedAt: string;
}

/** Lead summary of one page. Returns null if the page does not exist. */
export async function wikiSummary(title: string, ctx: CallContext): Promise<WikiSummary | null> {
  const url = 'https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(title.replace(/ /g, '_'));
  const r = await fetchJson<any>(url, { provider: P, ctx, ttlMs: 60 * 60_000, okStatuses: [404] });
  if (r.status === 404 || !r.data?.title) return null;
  const page = r.data.content_urls?.desktop?.page ?? wikiUrl(r.data.title);
  return {
    title: r.data.title,
    description: r.data.description ?? null,
    extract: clip(r.data.extract ?? '', 900),
    thumbnail: r.data.thumbnail?.source ?? null,
    url: page,
    sourceUrl: page,
    fetchedAt: r.fetchedAt,
  };
}

export interface OnThisDayEvent {
  year: number;
  text: string;
  pageTitle: string | null;
  url: string | null;
}
export interface OnThisDay {
  month: number;
  day: number;
  events: OnThisDayEvent[];
  sourceUrl: string;
  fetchedAt: string;
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Historical events on a calendar day (defaults to today, UTC). */
export async function wikiOnThisDay(ctx: CallContext, month?: number, day?: number, limit = 8): Promise<OnThisDay> {
  const d = new Date();
  const m = month ?? d.getUTCMonth() + 1;
  const dd = day ?? d.getUTCDate();
  const url = `https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/${String(m).padStart(2, '0')}/${String(dd).padStart(2, '0')}`;
  const r = await fetchJson<any>(url, { provider: P, ctx, ttlMs: 6 * 60 * 60_000 });
  const events = ((r.data?.events ?? []) as any[]).slice(0, limit).map((e) => {
    const pg = (e.pages ?? [])[0];
    return { year: Number(e.year), text: clip(e.text ?? '', 300), pageTitle: pg?.titles?.normalized ?? pg?.title ?? null, url: pg?.content_urls?.desktop?.page ?? null };
  });
  return { month: m, day: dd, events, sourceUrl: `https://en.wikipedia.org/wiki/${MONTHS[m - 1]}_${dd}`, fetchedAt: r.fetchedAt };
}
