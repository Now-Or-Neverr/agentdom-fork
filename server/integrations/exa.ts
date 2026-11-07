// Exa: meaning-based web search and "find similar" (e.g. companies like X).
// Free credits are small (~$10/month), so result counts stay low and text is short.
import { clip, fetchJson, type CallContext } from './http';
import { publicUrl, requireKey } from './keys';

const P = 'exa';
const MAX = 8;

export interface ExaHit {
  title: string;
  url: string;
  published: string | null;
  author: string | null;
  snippet: string;
}
export interface ExaResults {
  mode: 'search' | 'similar';
  query: string; // the query text, or the URL for find-similar
  category: string | null;
  results: ExaHit[];
  /** For find-similar: the page you started from; for search: the top hit. */
  sourceUrl: string;
  fetchedAt: string;
}
export const EXA_CATEGORIES = ['company', 'research paper', 'news', 'pdf', 'github', 'personal site', 'financial report', 'people'] as const;
export type ExaCategory = (typeof EXA_CATEGORIES)[number];

function mapHits(data: any): ExaHit[] {
  return ((data?.results ?? []) as any[])
    .filter((x) => typeof x?.url === 'string')
    .map((x) => ({
      title: clip(x.title || x.url, 200),
      url: x.url,
      published: x.publishedDate ? String(x.publishedDate).slice(0, 10) : null,
      author: x.author ? clip(x.author, 80) : null,
      snippet: clip(String(x.text ?? '').replace(/\s+/g, ' '), 300),
    }));
}
async function call(path: 'search' | 'findSimilar', payload: Record<string, unknown>, ctx: CallContext) {
  const key = requireKey(P);
  return fetchJson<any>(`https://api.exa.ai/${path}`, {
    provider: P,
    ctx,
    method: 'POST',
    body: JSON.stringify({ ...payload, contents: { text: { maxCharacters: 300 } } }),
    headers: { 'content-type': 'application/json', 'x-api-key': key },
    ttlMs: 24 * 3600_000,
    timeoutMs: 25_000,
  });
}

/** Neural web search. `category` narrows to e.g. 'company' or 'research paper'. 1..8 results. */
export async function exaSearch(query: string, ctx: CallContext, opts: { num?: number; category?: ExaCategory } = {}): Promise<ExaResults> {
  const q = query.trim();
  if (!q) throw new Error('query is required.');
  if (q.length > 300) throw new Error('query is too long (max 300 characters).');
  if (opts.category && !EXA_CATEGORIES.includes(opts.category)) throw new Error(`category must be one of: ${EXA_CATEGORIES.join(', ')}.`);
  const r = await call('search', { query: q, type: 'auto', numResults: Math.min(MAX, Math.max(1, Math.round(opts.num ?? 5))), ...(opts.category ? { category: opts.category } : {}) }, ctx);
  const results = mapHits(r.data);
  return { mode: 'search', query: q, category: opts.category ?? null, results, sourceUrl: results[0]?.url ?? 'https://exa.ai', fetchedAt: r.fetchedAt };
}

/** Pages similar to `url` on other domains, e.g. competitors of a company site. 1..8 results. */
export async function exaFindSimilar(url: string, ctx: CallContext, opts: { num?: number } = {}): Promise<ExaResults> {
  const u = publicUrl(url);
  const r = await call('findSimilar', { url: u, numResults: Math.min(MAX, Math.max(1, Math.round(opts.num ?? 5))), excludeSourceDomain: true }, ctx);
  return { mode: 'similar', query: u, category: null, results: mapHits(r.data), sourceUrl: u, fetchedAt: r.fetchedAt };
}
