// Hacker News via the Algolia search API.
import { clip, fetchJson, qs, type CallContext } from './http';

export interface Story {
  id: string;
  title: string;
  url: string; // the linked article (or the HN thread for Ask/Show posts)
  hnUrl: string;
  points: number;
  comments: number;
  author: string;
  at: string;
}
export interface Stories {
  query: string | null;
  results: Story[];
  sourceUrl: string;
  fetchedAt: string;
}

const map = (h: any): Story => {
  const hnUrl = `https://news.ycombinator.com/item?id=${h.objectID}`;
  return {
    id: String(h.objectID),
    title: clip(h.title ?? h.story_title ?? '', 200),
    url: h.url || hnUrl,
    hnUrl,
    points: Number(h.points ?? 0),
    comments: Number(h.num_comments ?? 0),
    author: h.author ?? '',
    at: h.created_at ?? '',
  };
};

/** Stories on the HN front page right now. */
export async function hnFrontPage(ctx: CallContext, limit = 10): Promise<Stories> {
  const url = 'https://hn.algolia.com/api/v1/search' + qs({ tags: 'front_page', hitsPerPage: Math.min(limit, 30) });
  const r = await fetchJson<any>(url, { provider: 'hackernews', ctx, ttlMs: 5 * 60_000 });
  return { query: null, results: ((r.data?.hits ?? []) as any[]).map(map), sourceUrl: 'https://news.ycombinator.com/', fetchedAt: r.fetchedAt };
}

/** Search HN stories by keyword (most relevant). */
export async function hnSearch(query: string, ctx: CallContext, limit = 10): Promise<Stories> {
  const url = 'https://hn.algolia.com/api/v1/search' + qs({ query, tags: 'story', hitsPerPage: Math.min(limit, 30) });
  const r = await fetchJson<any>(url, { provider: 'hackernews', ctx, ttlMs: 10 * 60_000 });
  return { query, results: ((r.data?.hits ?? []) as any[]).map(map), sourceUrl: 'https://hn.algolia.com/' + qs({ q: query, type: 'story' }), fetchedAt: r.fetchedAt };
}
