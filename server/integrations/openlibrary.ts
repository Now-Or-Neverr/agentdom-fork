// Open Library: book search.
import { clip, fetchJson, qs, type CallContext } from './http';

export interface Book {
  title: string;
  authors: string[];
  firstPublished: number | null;
  editions: number;
  cover: string | null;
  url: string;
}
export interface BookSearch {
  query: string;
  total: number;
  results: Book[];
  sourceUrl: string;
  fetchedAt: string;
}

/** Search books by title/author/keyword. */
export async function openLibrarySearch(query: string, ctx: CallContext, limit = 5): Promise<BookSearch> {
  const url = 'https://openlibrary.org/search.json' + qs({ q: query, limit: Math.min(limit, 20), fields: 'key,title,author_name,first_publish_year,edition_count,cover_i' });
  const r = await fetchJson<any>(url, { provider: 'openlibrary', ctx, ttlMs: 60 * 60_000, timeoutMs: 15_000 });
  const docs = (r.data?.docs ?? []) as any[];
  return {
    query,
    total: Number(r.data?.numFound ?? docs.length),
    results: docs.map((d) => ({
      title: clip(d.title ?? '(untitled)', 200),
      authors: (d.author_name ?? []).slice(0, 3),
      firstPublished: d.first_publish_year ?? null,
      editions: Number(d.edition_count ?? 0),
      cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null,
      url: 'https://openlibrary.org' + d.key,
    })),
    sourceUrl: 'https://openlibrary.org/search' + qs({ q: query }),
    fetchedAt: r.fetchedAt,
  };
}
