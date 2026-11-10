// Heralds' Tower, no-key sources: Wikimedia pageviews (most-read Wikipedia articles),
// DEV Community (dev.to) articles and Lobsters hottest stories.
import { clip, fetchJson, qs, type CallContext } from './http';

// ---------------- Wikimedia pageviews ----------------
export interface ReadArticle {
  rank: number;
  title: string;
  views: number;
  url: string;
}
export interface MostRead {
  project: string; // e.g. en.wikipedia
  date: string; // YYYY-MM-DD (UTC day counted)
  articles: ReadArticle[];
  sourceUrl: string;
  fetchedAt: string;
}
export const WIKI_LANGS = ['en', 'id', 'de', 'fr', 'es', 'ja', 'pt', 'it', 'ru', 'zh', 'ar', 'nl', 'pl', 'ko', 'tr'] as const;
// Pages that are always near the top and say nothing about what people are curious about.
const NOISE = /^(Main_Page|Special:|Wikipedia:|Portal:|File:|Help:|Talk:|User:|Template:|Category:|Wikipédia:|Spécial:|Spezial:|Especial:|Halaman_Utama|Pagina_principale|Página_principal|Accueil_principal|Hauptseite|Strona_główna|Заглавная_страница|メインページ|-$)/i;

/** The most-read Wikipedia articles on the latest full day Wikimedia has published (usually yesterday). */
export async function mostRead(ctx: CallContext, lang = 'en', limit = 15): Promise<MostRead> {
  if (!(WIKI_LANGS as readonly string[]).includes(lang)) throw new Error(`language must be one of: ${WIKI_LANGS.join(', ')}.`);
  const project = `${lang}.wikipedia`;
  // Yesterday's numbers appear a few hours after midnight UTC; fall back one more day if not ready.
  for (const back of [1, 2, 3]) {
    const d = new Date(Date.now() - back * 86400_000);
    const [y, m, dd] = [d.getUTCFullYear(), String(d.getUTCMonth() + 1).padStart(2, '0'), String(d.getUTCDate()).padStart(2, '0')];
    const r = await fetchJson<any>(`https://wikimedia.org/api/rest_v1/metrics/pageviews/top/${project}/all-access/${y}/${m}/${dd}`, { provider: 'wikimedia', ctx, ttlMs: 3 * 3600_000, timeoutMs: 15_000, okStatuses: [404] });
    const arts = (r.data?.items?.[0]?.articles ?? []) as any[];
    if (r.status === 404 || !arts.length) continue;
    // A namespace prefix ("Special:Search", "Istimewa:Pencarian") has no underscore around its colon;
    // article titles with a colon ("Ramayana:_Part_1") do.
    const list = arts.filter((a) => !NOISE.test(String(a.article)) && !/^[^:_]+:[^_]/.test(String(a.article))).slice(0, Math.min(30, Math.max(1, limit)));
    return {
      project,
      date: `${y}-${m}-${dd}`,
      articles: list.map((a, i) => ({ rank: i + 1, title: String(a.article).replace(/_/g, ' '), views: Number(a.views ?? 0), url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(String(a.article))}` })),
      sourceUrl: `https://pageviews.wmcloud.org/topviews/?project=${project}.org&platform=all-access&date=${y}-${m}-${dd}`,
      fetchedAt: r.fetchedAt,
    };
  }
  throw new Error('Wikimedia has not published pageviews for the last few days yet.');
}

// ---------------- DEV Community ----------------
export interface DevArticle {
  id: number;
  title: string;
  author: string;
  tags: string[];
  reactions: number;
  comments: number;
  readingMinutes: number | null;
  published: string;
  url: string;
}
export interface DevArticles {
  tag: string | null;
  articles: DevArticle[];
  sourceUrl: string;
  fetchedAt: string;
}
export const TAG_RE = /^[a-z0-9]{1,30}$/;

/** Top DEV Community articles of the past week, optionally for one tag. */
export async function devArticles(ctx: CallContext, tag?: string, limit = 10): Promise<DevArticles> {
  const t = tag?.trim().toLowerCase() || undefined;
  if (t && !TAG_RE.test(t)) throw new Error('tag must be letters and digits only, e.g. javascript or ai.');
  const r = await fetchJson<any>('https://dev.to/api/articles' + qs({ top: 7, per_page: Math.min(20, Math.max(1, limit)), tag: t }), { provider: 'devto', ctx, ttlMs: 30 * 60_000, timeoutMs: 15_000 });
  return {
    tag: t ?? null,
    articles: ((r.data ?? []) as any[]).map((a) => ({
      id: Number(a.id),
      title: clip(a.title ?? '', 200),
      author: String(a.user?.name ?? a.user?.username ?? ''),
      tags: (a.tag_list ?? []) as string[],
      reactions: Number(a.public_reactions_count ?? a.positive_reactions_count ?? 0),
      comments: Number(a.comments_count ?? 0),
      readingMinutes: a.reading_time_minutes ?? null,
      published: String(a.published_at ?? ''),
      url: String(a.url ?? ''),
    })),
    sourceUrl: t ? `https://dev.to/t/${t}/top/week` : 'https://dev.to/top/week',
    fetchedAt: r.fetchedAt,
  };
}

// ---------------- Lobsters ----------------
export interface LobsterStory {
  id: string;
  title: string;
  link: string | null; // the article (null for text posts)
  score: number;
  comments: number;
  tags: string[];
  submitter: string;
  created: string;
  url: string; // discussion page
}
export interface LobsterStories {
  tag: string | null;
  stories: LobsterStory[];
  sourceUrl: string;
  fetchedAt: string;
}

/** Hottest Lobsters stories (computing-focused link community), optionally for one tag. */
export async function lobsters(ctx: CallContext, tag?: string, limit = 10): Promise<LobsterStories> {
  const t = tag?.trim().toLowerCase() || undefined;
  if (t && !TAG_RE.test(t)) throw new Error('tag must be letters and digits only, e.g. rust or security.');
  const r = await fetchJson<any>(t ? `https://lobste.rs/t/${t}.json` : 'https://lobste.rs/hottest.json', { provider: 'lobsters', ctx, ttlMs: 20 * 60_000, timeoutMs: 15_000, okStatuses: [404] });
  if (r.status === 404) throw new Error(`Lobsters has no tag "${t}".`);
  return {
    tag: t ?? null,
    stories: ((Array.isArray(r.data) ? r.data : []) as any[]).slice(0, Math.min(25, Math.max(1, limit))).map((s) => ({
      id: String(s.short_id),
      title: clip(s.title ?? '', 200),
      link: s.url ? String(s.url) : null,
      score: Number(s.score ?? 0),
      comments: Number(s.comment_count ?? 0),
      tags: (s.tags ?? []) as string[],
      submitter: String(typeof s.submitter_user === 'string' ? s.submitter_user : s.submitter_user?.username ?? ''),
      created: String(s.created_at ?? ''),
      url: String(s.comments_url ?? s.short_id_url ?? `https://lobste.rs/s/${s.short_id}`),
    })),
    sourceUrl: t ? `https://lobste.rs/t/${t}` : 'https://lobste.rs/',
    fetchedAt: r.fetchedAt,
  };
}
