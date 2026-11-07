// GNews: top headlines and news search. Free tier = 100 requests/day, max 10 articles each,
// so every answer is cached for at least 20 minutes. The key goes in `apikey` (stripped from logs).
import { clip, fetchJson, qs, type CallContext } from './http';
import { requireKey } from './keys';

const P = 'gnews';
const BASE = 'https://gnews.io/api/v4';
const TTL = 20 * 60_000;

export const GNEWS_CATEGORIES = ['general', 'world', 'nation', 'business', 'technology', 'entertainment', 'sports', 'science', 'health'] as const;
export type GnewsCategory = (typeof GNEWS_CATEGORIES)[number];

export interface NewsArticle {
  title: string;
  description: string | null;
  url: string;
  image: string | null;
  publishedAt: string;
  source: string;
  sourceSite: string | null;
}
export interface NewsList {
  kind: 'top' | 'search';
  query: string | null;
  category: string | null;
  country: string | null;
  lang: string;
  total: number;
  articles: NewsArticle[];
  /** The first article (GNews has no public results page); every article carries its own url. */
  sourceUrl: string;
  fetchedAt: string;
}

const lc2 = (s: string | undefined, name: string) => {
  if (!s) return undefined;
  const v = s.trim().toLowerCase();
  if (!/^[a-z]{2}$/.test(v)) throw new Error(`${name} must be a 2-letter code (e.g. us, id, en).`);
  return v;
};
function map(d: any): NewsArticle[] {
  return ((d?.articles ?? []) as any[])
    .filter((a) => typeof a?.url === 'string')
    .map((a) => ({
      title: clip(a.title ?? '', 260),
      description: a.description ? clip(a.description, 400) : null,
      url: a.url,
      image: typeof a.image === 'string' && /^https:\/\//.test(a.image) ? a.image : null,
      publishedAt: a.publishedAt ?? '',
      source: a.source?.name ?? '',
      sourceSite: a.source?.url ?? null,
    }));
}

/** Top headlines. `country` and `lang` are 2-letter codes (e.g. 'us', 'en'). Max 10 articles. */
export async function newsTop(ctx: CallContext, opts: { category?: GnewsCategory; country?: string; lang?: string; max?: number } = {}): Promise<NewsList> {
  const key = requireKey(P);
  const category = opts.category ?? 'general';
  if (!GNEWS_CATEGORIES.includes(category)) throw new Error(`category must be one of: ${GNEWS_CATEGORIES.join(', ')}.`);
  const country = lc2(opts.country, 'country');
  const lang = lc2(opts.lang, 'lang') ?? 'en';
  const url = `${BASE}/top-headlines` + qs({ category, lang, country, max: Math.min(10, Math.max(1, opts.max ?? 10)), apikey: key });
  const r = await fetchJson<any>(url, { provider: P, ctx, ttlMs: TTL, timeoutMs: 15_000 });
  const articles = map(r.data);
  return { kind: 'top', query: null, category, country: country ?? null, lang, total: Number(r.data?.totalArticles ?? articles.length), articles, sourceUrl: articles[0]?.url ?? 'https://gnews.io', fetchedAt: r.fetchedAt };
}

/** Search recent news. Supports GNews query syntax (quotes, AND, OR, NOT). Max 10 articles. */
export async function newsSearch(query: string, ctx: CallContext, opts: { country?: string; lang?: string; max?: number } = {}): Promise<NewsList> {
  const key = requireKey(P);
  const q = query.trim();
  if (!q) throw new Error('query is required.');
  if (q.length > 200) throw new Error('query is too long (max 200 characters).');
  const country = lc2(opts.country, 'country');
  const lang = lc2(opts.lang, 'lang') ?? 'en';
  const url = `${BASE}/search` + qs({ q, lang, country, max: Math.min(10, Math.max(1, opts.max ?? 10)), sortby: 'publishedAt', apikey: key });
  const r = await fetchJson<any>(url, { provider: P, ctx, ttlMs: TTL, timeoutMs: 15_000 });
  const articles = map(r.data);
  return { kind: 'search', query: q, category: null, country: country ?? null, lang, total: Number(r.data?.totalArticles ?? articles.length), articles, sourceUrl: articles[0]?.url ?? 'https://gnews.io', fetchedAt: r.fetchedAt };
}
