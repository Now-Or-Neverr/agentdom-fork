// Federal Register (US): rules, proposed rules and notices.
import { clip, fetchJson, type CallContext } from './http';

export interface FrDocument {
  number: string;
  title: string;
  type: string; // Rule, Proposed Rule, Notice, Presidential Document
  abstract: string | null;
  agencies: string[];
  published: string;
  url: string;
}
export interface FrSearch {
  query: string | null;
  total: number;
  results: FrDocument[];
  sourceUrl: string;
  fetchedAt: string;
}

const FIELDS = ['title', 'type', 'abstract', 'document_number', 'html_url', 'publication_date', 'agencies'];

/** Newest documents, optionally matching a search term. `type`: RULE | PRORULE | NOTICE | PRESDOCU. */
export async function federalRegister(ctx: CallContext, query?: string, limit = 8, type?: 'RULE' | 'PRORULE' | 'NOTICE' | 'PRESDOCU'): Promise<FrSearch> {
  const p = new URLSearchParams();
  p.set('per_page', String(Math.min(limit, 20)));
  p.set('order', query ? 'relevance' : 'newest');
  for (const f of FIELDS) p.append('fields[]', f);
  if (query) p.set('conditions[term]', query);
  if (type) p.append('conditions[type][]', type);
  const url = 'https://www.federalregister.gov/api/v1/documents.json?' + p.toString();
  const r = await fetchJson<any>(url, { provider: 'federalregister', ctx, ttlMs: 30 * 60_000, timeoutMs: 15_000 });
  const human = new URLSearchParams();
  if (query) human.set('conditions[term]', query);
  return {
    query: query ?? null,
    total: Number(r.data?.count ?? 0),
    results: ((r.data?.results ?? []) as any[]).map((d) => ({
      number: d.document_number,
      title: clip(d.title ?? '', 260),
      type: d.type ?? '',
      abstract: d.abstract ? clip(d.abstract, 400) : null,
      agencies: ((d.agencies ?? []) as any[]).map((a) => a.name ?? a.raw_name).filter(Boolean).slice(0, 3),
      published: d.publication_date ?? '',
      url: d.html_url,
    })),
    sourceUrl: 'https://www.federalregister.gov/documents/search' + (query ? '?' + human.toString() : ''),
    fetchedAt: r.fetchedAt,
  };
}
