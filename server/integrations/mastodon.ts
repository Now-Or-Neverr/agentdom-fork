// Mastodon (mastodon.social) public trends.
import { clip, fetchJson, qs, type CallContext } from './http';

const BASE = 'https://mastodon.social';
const sum = (h: any[] | undefined, k: 'uses' | 'accounts', days = 2) => (h ?? []).slice(0, days).reduce((n, d) => n + Number(d?.[k] ?? 0), 0);

export interface TrendTag {
  name: string;
  url: string;
  uses: number; // posts in the last 2 days
  accounts: number; // distinct accounts in the last 2 days
}
export interface TrendTags {
  results: TrendTag[];
  sourceUrl: string;
  fetchedAt: string;
}

/** Hashtags trending on mastodon.social. */
export async function mastodonTrendingTags(ctx: CallContext, limit = 10): Promise<TrendTags> {
  const r = await fetchJson<any[]>(`${BASE}/api/v1/trends/tags` + qs({ limit: Math.min(limit, 20) }), { provider: 'mastodon', ctx, ttlMs: 10 * 60_000 });
  return {
    results: (r.data ?? []).map((t) => ({ name: t.name, url: t.url ?? `${BASE}/tags/${t.name}`, uses: sum(t.history, 'uses'), accounts: sum(t.history, 'accounts') })),
    sourceUrl: `${BASE}/explore/tags`,
    fetchedAt: r.fetchedAt,
  };
}

export interface TrendLink {
  title: string;
  url: string;
  site: string;
  description: string;
  uses: number; // shares in the last 2 days
}
export interface TrendLinks {
  results: TrendLink[];
  sourceUrl: string;
  fetchedAt: string;
}

const host = (u: string) => {
  try {
    return new URL(u).hostname;
  } catch {
    return '';
  }
};

/** News links trending on mastodon.social. */
export async function mastodonTrendingLinks(ctx: CallContext, limit = 8): Promise<TrendLinks> {
  const r = await fetchJson<any[]>(`${BASE}/api/v1/trends/links` + qs({ limit: Math.min(limit, 20) }), { provider: 'mastodon', ctx, ttlMs: 10 * 60_000 });
  return {
    results: (r.data ?? []).map((l) => ({
      title: clip(l.title || l.url, 200),
      url: l.url,
      site: l.provider_name || host(l.url),
      description: clip(l.description ?? '', 200),
      uses: sum(l.history, 'uses'),
    })),
    sourceUrl: `${BASE}/explore/links`,
    fetchedAt: r.fetchedAt,
  };
}
