// Firecrawl: scrape one URL to markdown, or crawl a few pages of a site.
// Free tier = 1,000 credits/month (1 credit per page), so crawls are capped at 5 pages.
import { clip, fetchJson, type CallContext } from './http';
import { publicUrl, requireKey } from './keys';
import { capText } from './jina';

const P = 'firecrawl';
const BASE = 'https://api.firecrawl.dev/v2';
export const CRAWL_MAX_PAGES = 5;

export interface ScrapedPage {
  url: string;
  title: string;
  description: string | null;
  status: number | null; // HTTP status the site returned to Firecrawl
  markdown: string; // capped
  chars: number;
  truncated: boolean;
  sourceUrl: string;
  fetchedAt: string;
}
export interface Crawl {
  start: string;
  status: string; // completed | scraping | failed | timeout
  total: number;
  pages: ScrapedPage[];
  sourceUrl: string;
  fetchedAt: string;
}

const auth = () => ({ authorization: `Bearer ${requireKey(P)}`, 'content-type': 'application/json' });
function page(d: any, fallback: string, cap: number, fetchedAt: string): ScrapedPage {
  const md = String(d?.markdown ?? '').trim();
  const m = d?.metadata ?? {};
  const url = typeof (m.sourceURL || m.url) === 'string' ? m.sourceURL || m.url : fallback;
  const title = Array.isArray(m.title) ? m.title[0] : m.title || m.ogTitle;
  const desc = Array.isArray(m.description) ? m.description[0] : m.description;
  return {
    url,
    title: clip(title || url, 200),
    description: desc ? clip(String(desc), 300) : null,
    status: typeof m.statusCode === 'number' ? m.statusCode : null,
    markdown: capText(md, cap),
    chars: md.length,
    truncated: md.length > cap,
    sourceUrl: url,
    fetchedAt,
  };
}

/** Scrape one page (main content only) to markdown. 1 credit. */
export async function scrapeUrl(url: string, ctx: CallContext, maxChars = 8000): Promise<ScrapedPage> {
  const u = publicUrl(url);
  const r = await fetchJson<any>(`${BASE}/scrape`, {
    provider: P,
    ctx,
    method: 'POST',
    body: JSON.stringify({ url: u, formats: ['markdown'], onlyMainContent: true }),
    headers: auth(),
    ttlMs: 6 * 3600_000,
    timeoutMs: 60_000,
    retries: 0,
  });
  if (!r.data?.success) throw new Error(`Firecrawl could not scrape that page${r.data?.error ? ': ' + clip(String(r.data.error), 200) : '.'}`);
  return page(r.data.data, u, Math.min(20_000, Math.max(500, maxChars)), r.fetchedAt);
}

/** Crawl up to `limit` (1..5) pages of a site, waiting up to ~75 s for the job. 1 credit per page. */
export async function crawlSite(url: string, ctx: CallContext, limit = 3, maxCharsPerPage = 3000): Promise<Crawl> {
  const u = publicUrl(url);
  const n = Math.min(CRAWL_MAX_PAGES, Math.max(1, Math.round(limit)));
  const start = await fetchJson<any>(`${BASE}/crawl`, {
    provider: P,
    ctx,
    method: 'POST',
    body: JSON.stringify({ url: u, limit: n, scrapeOptions: { formats: ['markdown'], onlyMainContent: true } }),
    headers: auth(),
    ttlMs: 0,
    timeoutMs: 30_000,
    retries: 0,
  });
  const id = start.data?.id;
  if (!start.data?.success || typeof id !== 'string' || !/^[A-Za-z0-9-]{8,80}$/.test(id)) throw new Error('Firecrawl did not start the crawl.');
  const cap = Math.min(10_000, Math.max(500, maxCharsPerPage));
  const deadline = Date.now() + 75_000;
  let last: any = null;
  let fetchedAt = start.fetchedAt;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 4000));
    const s = await fetchJson<any>(`${BASE}/crawl/${id}`, { provider: P, ctx, headers: auth(), ttlMs: 0, timeoutMs: 30_000 });
    last = s.data;
    fetchedAt = s.fetchedAt;
    if (last?.status === 'completed' || last?.status === 'failed') break;
  }
  if (last?.status === 'failed') throw new Error('Firecrawl reported that the crawl failed.');
  const pages = ((last?.data ?? []) as any[]).slice(0, n).map((d) => page(d, u, cap, fetchedAt));
  return {
    start: u,
    status: last?.status === 'completed' ? 'completed' : last ? String(last.status) : 'timeout',
    total: Number(last?.total ?? pages.length),
    pages,
    sourceUrl: u,
    fetchedAt,
  };
}
