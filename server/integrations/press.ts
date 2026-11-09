// The Guardian Open Platform and The New York Times APIs (developer keys, non-commercial).
// Rule for both: only headline, a short trail/abstract and the link back. Never the article body.
// Keys go in `api-key` (stripped from logs).
import { clip, fetchJson, qs, stripHtml, type CallContext } from './http';
import { requireKey } from './keys';

export interface PressArticle {
  title: string;
  trail: string | null; // short standfirst/abstract only
  url: string;
  section: string | null;
  byline: string | null;
  published: string | null;
}
export interface PressList {
  outlet: 'The Guardian' | 'The New York Times';
  kind: string; // search / top / popular
  query: string | null;
  results: PressArticle[];
  note: string;
  sourceUrl: string;
  fetchedAt: string;
}
const NOTE = 'Headline, short summary and link only. Read the full article on the publisher’s site.';

// ---------------- The Guardian ----------------
/** Guardian articles matching words (newest first), or the latest in a section when no query. */
export async function guardianSearch(ctx: CallContext, opts: { query?: string; section?: string; limit?: number } = {}): Promise<PressList> {
  const key = requireKey('guardian');
  const q = opts.query?.trim() || undefined;
  const section = opts.section?.trim().toLowerCase() || undefined;
  if (section && !/^[a-z0-9-]{2,40}$/.test(section)) throw new Error('section must be a Guardian section id, e.g. world, technology, sport.');
  const url = 'https://content.guardianapis.com/search' + qs({ q, section, 'page-size': Math.min(10, Math.max(1, opts.limit ?? 8)), 'order-by': 'newest', 'show-fields': 'trailText,byline', 'api-key': key });
  const r = await fetchJson<any>(url, { provider: 'guardian', ctx, ttlMs: 15 * 60_000, timeoutMs: 15_000 });
  const rows = (r.data?.response?.results ?? []) as any[];
  return {
    outlet: 'The Guardian',
    kind: q ? 'search' : 'latest',
    query: q ?? null,
    results: rows.map((a) => ({
      title: clip(a.webTitle ?? '', 260),
      trail: a.fields?.trailText ? clip(stripHtml(a.fields.trailText), 280) : null,
      url: String(a.webUrl),
      section: a.sectionName ?? null,
      byline: a.fields?.byline ? clip(a.fields.byline, 120) : null,
      published: a.webPublicationDate ?? null,
    })),
    note: NOTE,
    sourceUrl: q ? 'https://www.theguardian.com/search' + qs({ q }) : `https://www.theguardian.com/${section ?? 'international'}`,
    fetchedAt: r.fetchedAt,
  };
}

// ---------------- The New York Times ----------------
export const NYT_SECTIONS = ['home', 'world', 'us', 'politics', 'business', 'technology', 'science', 'health', 'sports', 'arts', 'books', 'movies', 'climate', 'opinion', 'travel', 'food'] as const;
export type NytSection = (typeof NYT_SECTIONS)[number];
const nytKey = () => requireKey('nyt');
const mapNyt = (a: any): PressArticle => ({
  title: clip(a.title ?? a.headline?.main ?? '', 260),
  trail: clip(a.abstract ?? a.snippet ?? '', 280) || null,
  url: String(a.url ?? a.web_url ?? ''),
  section: a.section ?? a.section_name ?? null,
  byline: clip(typeof a.byline === 'string' ? a.byline : a.byline?.original ?? '', 120) || null,
  published: a.published_date ?? a.pub_date ?? null,
});

/** NYT top stories for a section. */
export async function nytTopStories(ctx: CallContext, section: NytSection = 'home', limit = 8): Promise<PressList> {
  if (!NYT_SECTIONS.includes(section)) throw new Error(`section must be one of: ${NYT_SECTIONS.join(', ')}.`);
  const url = `https://api.nytimes.com/svc/topstories/v2/${section}.json` + qs({ 'api-key': nytKey() });
  const r = await fetchJson<any>(url, { provider: 'nyt', ctx, ttlMs: 30 * 60_000, timeoutMs: 15_000 });
  const rows = ((r.data?.results ?? []) as any[]).filter((a) => a.title && /^https:\/\//.test(String(a.url ?? '')));
  return { outlet: 'The New York Times', kind: 'top', query: null, results: rows.slice(0, limit).map(mapNyt), note: NOTE, sourceUrl: section === 'home' ? 'https://www.nytimes.com' : `https://www.nytimes.com/section/${section}`, fetchedAt: r.fetchedAt };
}

/** NYT article search, newest first. */
export async function nytSearch(query: string, ctx: CallContext, limit = 8): Promise<PressList> {
  const q = query.trim();
  if (!q) throw new Error('query is required.');
  const url = 'https://api.nytimes.com/svc/search/v2/articlesearch.json' + qs({ q, sort: 'newest', 'api-key': nytKey() });
  const r = await fetchJson<any>(url, { provider: 'nyt', ctx, ttlMs: 30 * 60_000, timeoutMs: 15_000 });
  const rows = ((r.data?.response?.docs ?? []) as any[]).filter((a) => a.web_url);
  return { outlet: 'The New York Times', kind: 'search', query: q, results: rows.slice(0, limit).map(mapNyt), note: NOTE, sourceUrl: 'https://www.nytimes.com/search' + qs({ query: q, sort: 'newest' }), fetchedAt: r.fetchedAt };
}

/** Most viewed NYT articles over the last 1, 7 or 30 days. */
export async function nytMostPopular(ctx: CallContext, days: 1 | 7 | 30 = 1, limit = 8): Promise<PressList> {
  if (![1, 7, 30].includes(days)) throw new Error('days must be 1, 7 or 30.');
  const url = `https://api.nytimes.com/svc/mostpopular/v2/viewed/${days}.json` + qs({ 'api-key': nytKey() });
  const r = await fetchJson<any>(url, { provider: 'nyt', ctx, ttlMs: 60 * 60_000, timeoutMs: 15_000 });
  const rows = ((r.data?.results ?? []) as any[]).filter((a) => a.title && /^https:\/\//.test(String(a.url ?? '')));
  return { outlet: 'The New York Times', kind: 'popular', query: null, results: rows.slice(0, limit).map(mapNyt), note: NOTE, sourceUrl: 'https://www.nytimes.com/trending/', fetchedAt: r.fetchedAt };
}

export interface Bestseller {
  rank: number;
  weeksOnList: number;
  title: string;
  author: string;
  description: string;
  publisher: string | null;
  url: string; // the list page on nytimes.com
}
export interface Bestsellers {
  list: string;
  listName: string;
  published: string | null;
  books: Bestseller[];
  sourceUrl: string;
  fetchedAt: string;
}

/** Current NYT bestseller list, e.g. "hardcover-fiction", "hardcover-nonfiction", "young-adult-hardcover". */
export async function nytBestsellers(ctx: CallContext, list = 'hardcover-fiction', limit = 10): Promise<Bestsellers> {
  const l = list.trim().toLowerCase();
  if (!/^[a-z0-9-]{3,60}$/.test(l)) throw new Error('list must be a NYT list name such as hardcover-fiction.');
  const url = `https://api.nytimes.com/svc/books/v3/lists/current/${l}.json` + qs({ 'api-key': nytKey() });
  const r = await fetchJson<any>(url, { provider: 'nyt', ctx, ttlMs: 6 * 60 * 60_000, timeoutMs: 15_000 });
  const res = r.data?.results ?? {};
  const page = `https://www.nytimes.com/books/best-sellers/${l}/`;
  return {
    list: l,
    listName: String(res.display_name ?? res.list_name ?? l),
    published: res.published_date ?? null,
    books: ((res.books ?? []) as any[]).slice(0, limit).map((b) => ({
      rank: Number(b.rank),
      weeksOnList: Number(b.weeks_on_list ?? 0),
      title: String(b.title ?? ''),
      author: String(b.author ?? ''),
      description: clip(b.description ?? '', 240),
      publisher: b.publisher ?? null,
      url: page,
    })),
    sourceUrl: page,
    fetchedAt: r.fetchedAt,
  };
}
