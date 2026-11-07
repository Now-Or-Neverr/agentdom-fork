// Tavily: web search with a short extracted answer. Free tier = 1,000 credits/month
// (basic depth = 1 credit, advanced = 2), so basic is the default.
import { clip, fetchJson, type CallContext } from './http';
import { requireKey } from './keys';

const P = 'tavily';

export interface WebHit {
  title: string;
  url: string;
  snippet: string;
  score: number | null;
}
export interface WebSearch {
  query: string;
  answer: string | null;
  results: WebHit[];
  /** The top result (Tavily has no public results page); every hit carries its own url. */
  sourceUrl: string;
  fetchedAt: string;
}

/** Search the web. `max` 1..10 results; `depth` 'advanced' costs 2 credits. */
export async function tavilySearch(
  query: string,
  ctx: CallContext,
  opts: { max?: number; depth?: 'basic' | 'advanced'; answer?: boolean; topic?: 'general' | 'news' } = {},
): Promise<WebSearch> {
  const key = requireKey(P);
  const q = query.trim();
  if (!q) throw new Error('query is required.');
  if (q.length > 400) throw new Error('query is too long (max 400 characters).');
  const body = JSON.stringify({
    query: q,
    search_depth: opts.depth === 'advanced' ? 'advanced' : 'basic',
    topic: opts.topic === 'news' ? 'news' : 'general',
    include_answer: opts.answer ?? true,
    max_results: Math.min(10, Math.max(1, Math.round(opts.max ?? 6))),
  });
  const r = await fetchJson<any>('https://api.tavily.com/search', {
    provider: P,
    ctx,
    method: 'POST',
    body,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    ttlMs: 6 * 3600_000,
    timeoutMs: 25_000,
  });
  const results: WebHit[] = ((r.data?.results ?? []) as any[])
    .filter((x) => typeof x?.url === 'string')
    .map((x) => ({ title: clip(x.title || x.url, 200), url: x.url, snippet: clip(x.content ?? '', 400), score: typeof x.score === 'number' ? Math.round(x.score * 1000) / 1000 : null }));
  return { query: q, answer: r.data?.answer ? clip(String(r.data.answer), 1500) : null, results, sourceUrl: results[0]?.url ?? 'https://tavily.com', fetchedAt: r.fetchedAt };
}
