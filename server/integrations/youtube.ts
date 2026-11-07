// YouTube Data API v3: most popular videos by region, and video search.
// Quota = 10,000 units/day: search.list costs 100 units, videos.list 1 unit, so search
// results are cached for 12 h and trending for 1 h. The key goes in `key` (stripped from logs).
import { clip, fetchJson, qs, type CallContext } from './http';
import { requireKey } from './keys';

const P = 'youtube';
const BASE = 'https://www.googleapis.com/youtube/v3';

export interface YtVideo {
  id: string;
  title: string;
  channel: string;
  channelUrl: string;
  publishedAt: string;
  description: string;
  thumbnail: string | null;
  duration: string | null; // ISO 8601, e.g. PT4M13S
  views: number | null;
  likes: number | null;
  comments: number | null;
  url: string;
}
export interface YtVideoList {
  kind: 'trending' | 'search';
  query: string | null;
  region: string;
  results: YtVideo[];
  sourceUrl: string;
  fetchedAt: string;
}

const n = (x: unknown) => (x === undefined || x === null || x === '' ? null : Number.isFinite(Number(x)) ? Number(x) : null);
function mapVideo(v: any): YtVideo {
  const s = v.snippet ?? {};
  const st = v.statistics ?? {};
  const th = s.thumbnails ?? {};
  return {
    id: v.id,
    title: clip(s.title ?? '', 200),
    channel: s.channelTitle ?? '',
    channelUrl: `https://www.youtube.com/channel/${encodeURIComponent(s.channelId ?? '')}`,
    publishedAt: s.publishedAt ?? '',
    description: clip(String(s.description ?? '').replace(/\s+/g, ' '), 240),
    thumbnail: (th.medium ?? th.high ?? th.default)?.url ?? null,
    duration: v.contentDetails?.duration ?? null,
    views: n(st.viewCount),
    likes: n(st.likeCount),
    comments: n(st.commentCount),
    url: `https://www.youtube.com/watch?v=${encodeURIComponent(v.id)}`,
  };
}
const region = (r?: string) => {
  const v = (r || 'US').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(v)) throw new Error('region must be a 2-letter country code (e.g. US, ID).');
  return v;
};

/** Most popular videos right now in a region (1 quota unit). */
export async function youtubeTrending(ctx: CallContext, regionCode = 'US', max = 10): Promise<YtVideoList> {
  const key = requireKey(P);
  const rc = region(regionCode);
  const url = `${BASE}/videos` + qs({ part: 'snippet,statistics,contentDetails', chart: 'mostPopular', regionCode: rc, maxResults: Math.min(25, Math.max(1, max)), key });
  const r = await fetchJson<any>(url, { provider: P, ctx, ttlMs: 3600_000, timeoutMs: 15_000 });
  const results = ((r.data?.items ?? []) as any[]).map(mapVideo);
  return { kind: 'trending', query: null, region: rc, results, sourceUrl: results[0]?.url ?? 'https://www.youtube.com', fetchedAt: r.fetchedAt };
}

/** Search videos (100 + 1 quota units), with view/like counts from videos.list. */
export async function youtubeSearch(query: string, ctx: CallContext, regionCode = 'US', max = 8): Promise<YtVideoList> {
  const key = requireKey(P);
  const q = query.trim();
  if (!q) throw new Error('query is required.');
  if (q.length > 150) throw new Error('query is too long (max 150 characters).');
  const rc = region(regionCode);
  const s = await fetchJson<any>(`${BASE}/search` + qs({ part: 'snippet', type: 'video', q, regionCode: rc, maxResults: Math.min(15, Math.max(1, max)), safeSearch: 'moderate', key }), {
    provider: P,
    ctx,
    ttlMs: 12 * 3600_000,
    timeoutMs: 15_000,
  });
  const ids = ((s.data?.items ?? []) as any[]).map((i) => i?.id?.videoId).filter((x): x is string => typeof x === 'string');
  let results: YtVideo[] = [];
  let fetchedAt = s.fetchedAt;
  if (ids.length) {
    const v = await fetchJson<any>(`${BASE}/videos` + qs({ part: 'snippet,statistics,contentDetails', id: ids.join(','), key }), { provider: P, ctx, ttlMs: 12 * 3600_000, timeoutMs: 15_000 });
    const byId = new Map(((v.data?.items ?? []) as any[]).map((x) => [x.id, x]));
    results = ids.filter((id) => byId.has(id)).map((id) => mapVideo(byId.get(id)));
    fetchedAt = v.fetchedAt;
  }
  return { kind: 'search', query: q, region: rc, results, sourceUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`, fetchedAt };
}
