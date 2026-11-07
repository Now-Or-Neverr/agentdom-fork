// CourtListener (Free Law Project): US court opinion / case law search, REST API v4.
// The token goes in the Authorization header.
import { clip, fetchJson, qs, stripHtml, type CallContext } from './http';
import { requireKey } from './keys';

const P = 'courtlistener';
const SITE = 'https://www.courtlistener.com';

export interface CaseHit {
  caseName: string;
  court: string;
  courtId: string | null;
  dateFiled: string | null;
  docketNumber: string | null;
  citations: string[];
  status: string | null; // Published / Unpublished…
  snippet: string | null;
  citedBy: number | null;
  url: string; // absolute courtlistener.com link
}
export interface CaseSearch {
  query: string;
  total: number;
  results: CaseHit[];
  sourceUrl: string;
  fetchedAt: string;
}

/** Search opinions. `order`: 'score desc' (relevance, default) or 'dateFiled desc'. `court` e.g. 'scotus'. */
export async function caseLawSearch(
  query: string,
  ctx: CallContext,
  opts: { limit?: number; order?: 'score desc' | 'dateFiled desc'; court?: string; filedAfter?: string } = {},
): Promise<CaseSearch> {
  const key = requireKey(P);
  const q = query.trim();
  if (!q) throw new Error('query is required.');
  if (q.length > 300) throw new Error('query is too long (max 300 characters).');
  if (opts.court && !/^[a-z0-9 ]{2,80}$/.test(opts.court)) throw new Error('court must be CourtListener court ids, e.g. scotus or "ca9 cadc".');
  if (opts.filedAfter && !/^\d{4}-\d{2}-\d{2}$/.test(opts.filedAfter)) throw new Error('filedAfter must be YYYY-MM-DD.');
  const order = opts.order === 'dateFiled desc' ? 'dateFiled desc' : 'score desc';
  const params = { q, type: 'o', order_by: order, court: opts.court, filed_after: opts.filedAfter };
  const r = await fetchJson<any>(`${SITE}/api/rest/v4/search/` + qs(params), {
    provider: P,
    ctx,
    headers: { authorization: `Token ${key}` },
    ttlMs: 6 * 3600_000,
    timeoutMs: 20_000,
  });
  const limit = Math.min(20, Math.max(1, opts.limit ?? 10));
  const results: CaseHit[] = ((r.data?.results ?? []) as any[]).slice(0, limit).map((x) => {
    const snip = (x.opinions ?? []).map((o: any) => o?.snippet).find((s: unknown) => typeof s === 'string' && s.trim());
    return {
      caseName: clip(x.caseName || x.caseNameFull || '(untitled case)', 240),
      court: x.court ?? '',
      courtId: x.court_id ?? null,
      dateFiled: x.dateFiled ?? null,
      docketNumber: x.docketNumber ?? null,
      citations: Array.isArray(x.citation) ? x.citation.slice(0, 4) : [],
      status: x.status ?? null,
      snippet: snip ? clip(stripHtml(snip), 400) : null,
      citedBy: typeof x.citeCount === 'number' ? x.citeCount : null,
      url: SITE + (typeof x.absolute_url === 'string' ? x.absolute_url : '/'),
    };
  });
  return { query: q, total: Number(r.data?.count ?? results.length), results, sourceUrl: `${SITE}/` + qs({ q, type: 'o', order_by: order, court: opts.court }), fetchedAt: r.fetchedAt };
}
