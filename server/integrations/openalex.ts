// OpenAlex: scholarly works search.
import { clip, fetchJson, qs, type CallContext } from './http';

export interface Work {
  title: string;
  year: number | null;
  citations: number;
  authors: string[];
  venue: string | null;
  doi: string | null;
  url: string;
}
export interface WorksSearch {
  query: string;
  total: number;
  results: Work[];
  sourceUrl: string;
  fetchedAt: string;
}

/** Search scholarly works by keyword, most relevant first. */
export async function openAlexWorks(query: string, ctx: CallContext, limit = 5): Promise<WorksSearch> {
  const url =
    'https://api.openalex.org/works' +
    qs({ search: query, 'per-page': Math.min(limit, 25), select: 'id,display_name,publication_year,cited_by_count,doi,authorships,primary_location' });
  const r = await fetchJson<any>(url, { provider: 'openalex', ctx, ttlMs: 60 * 60_000 });
  const rows = (r.data?.results ?? []) as any[];
  return {
    query,
    total: Number(r.data?.meta?.count ?? rows.length),
    results: rows.map((w) => ({
      title: clip(w.display_name ?? '(untitled)', 240),
      year: w.publication_year ?? null,
      citations: Number(w.cited_by_count ?? 0),
      authors: ((w.authorships ?? []) as any[])
        .slice(0, 4)
        .map((a) => a.author?.display_name)
        .filter(Boolean),
      venue: w.primary_location?.source?.display_name ?? null,
      doi: w.doi ?? null,
      url: w.doi ?? w.primary_location?.landing_page_url ?? String(w.id ?? ''),
    })),
    sourceUrl: 'https://openalex.org/works' + qs({ search: query }),
    fetchedAt: r.fetchedAt,
  };
}
