// arXiv API (Atom XML, parsed minimally without dependencies).
import { clip, decodeEntities, fetchText, qs, type CallContext } from './http';

export interface Preprint {
  id: string;
  title: string;
  summary: string;
  authors: string[];
  published: string;
  url: string;
}
export interface PreprintSearch {
  query: string;
  total: number;
  results: Preprint[];
  sourceUrl: string;
  fetchedAt: string;
}

const tag = (xml: string, name: string) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim() : '';
};

/** Search arXiv preprints by keyword (relevance order). */
export async function arxivSearch(query: string, ctx: CallContext, limit = 5): Promise<PreprintSearch> {
  const url = 'https://export.arxiv.org/api/query' + qs({ search_query: `all:${query}`, start: 0, max_results: Math.min(limit, 20), sortBy: 'relevance' });
  // arXiv is slow and asks callers not to hammer it: wait longer, never retry on our own.
  const r = await fetchText(url, { provider: 'arxiv', ctx, ttlMs: 60 * 60_000, accept: 'application/atom+xml', timeoutMs: 30_000, retries: 0 });
  const xml = r.data;
  const entries = xml
    .split('<entry>')
    .slice(1)
    .map((e) => e.split('</entry>')[0]);
  const total = Number(tag(xml, 'opensearch:totalResults') || entries.length);
  return {
    query,
    total,
    results: entries.map((e) => {
      const id = tag(e, 'id');
      return {
        id: id.replace(/^https?:\/\/arxiv\.org\/abs\//, ''),
        title: clip(tag(e, 'title'), 240),
        summary: clip(tag(e, 'summary'), 400),
        authors: [...e.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)].slice(0, 4).map((m) => decodeEntities(m[1]).trim()),
        published: tag(e, 'published').slice(0, 10),
        url: id.replace(/^http:/, 'https:'),
      };
    }),
    sourceUrl: 'https://arxiv.org/search/' + qs({ query, searchtype: 'all' }),
    fetchedAt: r.fetchedAt,
  };
}
