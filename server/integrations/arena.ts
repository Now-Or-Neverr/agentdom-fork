// Arena sources: football-data.org (key), TMDB (key), Last.fm (key), MusicBrainz, CheapShark, FreeToGame.
// Keys go in headers where the provider allows it (football-data, TMDB bearer) or in `api_key`
// (stripped from logs). TMDB results carry the attribution TMDB requires.
import { clip, fetchJson, qs, stripHtml, UpstreamError, type CallContext } from './http';
import { requireKey } from './keys';

const day = (d: Date) => d.toISOString().slice(0, 10);

// ---------------- football-data.org ----------------
// Free tier: these competitions only, about 10 requests a minute.
export const FOOTBALL_COMPETITIONS: Record<string, string> = {
  PL: 'Premier League (England)',
  PD: 'La Liga (Spain)',
  BL1: 'Bundesliga (Germany)',
  SA: 'Serie A (Italy)',
  FL1: 'Ligue 1 (France)',
  DED: 'Eredivisie (Netherlands)',
  PPL: 'Primeira Liga (Portugal)',
  ELC: 'Championship (England)',
  BSA: 'Série A (Brazil)',
  CL: 'UEFA Champions League',
  EC: 'European Championship',
  WC: 'FIFA World Cup',
};
export const isCompetition = (c: unknown): c is string => typeof c === 'string' && c.toUpperCase() in FOOTBALL_COMPETITIONS;
const FD = 'footballdata';
const fdHeaders = () => ({ 'X-Auth-Token': requireKey(FD) });

export interface TableRow {
  position: number;
  team: string;
  played: number;
  won: number;
  draw: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDiff: number;
  points: number;
  crest: string | null;
}
export interface Standings {
  competition: string;
  code: string;
  season: string | null;
  matchday: number | null;
  group: string | null; // for cup group stages
  table: TableRow[];
  sourceUrl: string;
  fetchedAt: string;
}

/** League table (first table: regular season or the first group). */
export async function footballStandings(code: string, ctx: CallContext): Promise<Standings> {
  const c = code.toUpperCase();
  if (!isCompetition(c)) throw new Error(`competition must be one of: ${Object.keys(FOOTBALL_COMPETITIONS).join(', ')}.`);
  const r = await fetchJson<any>(`https://api.football-data.org/v4/competitions/${c}/standings`, { provider: FD, ctx, headers: fdHeaders(), ttlMs: 15 * 60_000, timeoutMs: 15_000 });
  const st = ((r.data?.standings ?? []) as any[]).find((s) => s.type === 'TOTAL') ?? r.data?.standings?.[0];
  return {
    competition: String(r.data?.competition?.name ?? FOOTBALL_COMPETITIONS[c]),
    code: c,
    season: r.data?.season?.startDate ? `${String(r.data.season.startDate).slice(0, 4)}/${String(r.data.season.endDate ?? '').slice(2, 4)}` : null,
    matchday: r.data?.season?.currentMatchday ?? null,
    group: st?.group && st.group !== 'Matchday' ? String(st.group) : null,
    table: ((st?.table ?? []) as any[]).map((t) => ({
      position: Number(t.position),
      team: String(t.team?.shortName || t.team?.name || ''),
      played: Number(t.playedGames ?? 0),
      won: Number(t.won ?? 0),
      draw: Number(t.draw ?? 0),
      lost: Number(t.lost ?? 0),
      goalsFor: Number(t.goalsFor ?? 0),
      goalsAgainst: Number(t.goalsAgainst ?? 0),
      goalDiff: Number(t.goalDifference ?? 0),
      points: Number(t.points ?? 0),
      crest: typeof t.team?.crest === 'string' ? t.team.crest : null,
    })),
    sourceUrl: 'https://www.football-data.org/coverage',
    fetchedAt: r.fetchedAt,
  };
}

export interface Match {
  utcDate: string;
  status: string; // SCHEDULED, TIMED, IN_PLAY, FINISHED…
  matchday: number | null;
  home: string;
  away: string;
  score: { home: number | null; away: number | null };
}
export interface Matches {
  competition: string;
  code: string;
  from: string;
  to: string;
  matches: Match[];
  sourceUrl: string;
  fetchedAt: string;
}

/** Matches of a competition from `daysBack` days ago to `daysAhead` days ahead (max 10-day window). */
export async function footballMatches(code: string, ctx: CallContext, daysBack = 3, daysAhead = 4): Promise<Matches> {
  const c = code.toUpperCase();
  if (!isCompetition(c)) throw new Error(`competition must be one of: ${Object.keys(FOOTBALL_COMPETITIONS).join(', ')}.`);
  const from = day(new Date(Date.now() - Math.min(7, Math.max(0, daysBack)) * 86400_000));
  const to = day(new Date(Date.now() + Math.min(7, Math.max(0, daysAhead)) * 86400_000));
  const r = await fetchJson<any>(`https://api.football-data.org/v4/competitions/${c}/matches` + qs({ dateFrom: from, dateTo: to }), { provider: FD, ctx, headers: fdHeaders(), ttlMs: 10 * 60_000, timeoutMs: 15_000 });
  return {
    competition: String(r.data?.competition?.name ?? FOOTBALL_COMPETITIONS[c]),
    code: c,
    from,
    to,
    matches: ((r.data?.matches ?? []) as any[]).slice(0, 30).map((m) => ({
      utcDate: String(m.utcDate ?? ''),
      status: String(m.status ?? ''),
      matchday: m.matchday ?? null,
      home: String(m.homeTeam?.shortName || m.homeTeam?.name || 'TBD'),
      away: String(m.awayTeam?.shortName || m.awayTeam?.name || 'TBD'),
      score: { home: m.score?.fullTime?.home ?? null, away: m.score?.fullTime?.away ?? null },
    })),
    sourceUrl: 'https://www.football-data.org/coverage',
    fetchedAt: r.fetchedAt,
  };
}

// ---------------- TMDB ----------------
export const TMDB_ATTRIBUTION = 'Data: TMDB (themoviedb.org). This product uses the TMDB API but is not endorsed or certified by TMDB.';
const TM = 'tmdb';

export interface Title {
  id: number;
  type: 'movie' | 'tv';
  title: string;
  date: string | null;
  overview: string;
  rating: number | null; // TMDB user score 0-10
  votes: number;
  poster: string | null;
  url: string; // themoviedb.org page
}
export interface TitleList {
  kind: 'search' | 'trending';
  query: string | null;
  results: Title[];
  attribution: string;
  sourceUrl: string;
  fetchedAt: string;
}

async function tmdb(path: string, params: Record<string, string | number | undefined>, ctx: CallContext) {
  const token = process.env.TMDB_READ_TOKEN;
  const key = token ? undefined : requireKey(TM);
  const url = `https://api.themoviedb.org/3${path}` + qs({ ...params, api_key: key });
  return fetchJson<any>(url, { provider: TM, ctx, headers: token ? { Authorization: `Bearer ${token}` } : {}, ttlMs: 30 * 60_000, timeoutMs: 15_000 });
}
function mapTitles(rows: any[], fallback?: 'movie' | 'tv'): Title[] {
  return rows
    .filter((x) => (x.media_type ?? fallback) === 'movie' || (x.media_type ?? fallback) === 'tv')
    .map((x) => {
      const type = (x.media_type ?? fallback) as 'movie' | 'tv';
      return {
        id: Number(x.id),
        type,
        title: clip(x.title ?? x.name ?? '', 200),
        date: (x.release_date || x.first_air_date || null) as string | null,
        overview: clip(x.overview ?? '', 320),
        rating: x.vote_count ? Math.round(Number(x.vote_average) * 10) / 10 : null,
        votes: Number(x.vote_count ?? 0),
        poster: x.poster_path ? `https://image.tmdb.org/t/p/w342${x.poster_path}` : null,
        url: `https://www.themoviedb.org/${type}/${x.id}`,
      };
    });
}

/** Search films and TV shows by title. */
export async function tmdbSearch(query: string, ctx: CallContext, limit = 8): Promise<TitleList> {
  const q = query.trim();
  if (!q) throw new Error('query is required.');
  const r = await tmdb('/search/multi', { query: q, include_adult: 'false' }, ctx);
  return { kind: 'search', query: q, results: mapTitles(r.data?.results ?? []).slice(0, limit), attribution: TMDB_ATTRIBUTION, sourceUrl: 'https://www.themoviedb.org/search' + qs({ query: q }), fetchedAt: r.fetchedAt };
}

/** Trending films or TV this week (or today). */
export async function tmdbTrending(ctx: CallContext, type: 'movie' | 'tv' = 'movie', window: 'day' | 'week' = 'week', limit = 10): Promise<TitleList> {
  if (type !== 'movie' && type !== 'tv') throw new Error('type must be movie or tv.');
  const r = await tmdb(`/trending/${type}/${window === 'day' ? 'day' : 'week'}`, {}, ctx);
  return { kind: 'trending', query: null, results: mapTitles(r.data?.results ?? [], type).slice(0, limit), attribution: TMDB_ATTRIBUTION, sourceUrl: `https://www.themoviedb.org/${type === 'tv' ? 'tv' : 'movie'}`, fetchedAt: r.fetchedAt };
}

// ---------------- Last.fm ----------------
const LF = 'lastfm';
async function lastfm(params: Record<string, string | number | undefined>, ctx: CallContext) {
  const url = 'https://ws.audioscrobbler.com/2.0/' + qs({ ...params, api_key: requireKey(LF), format: 'json' });
  const r = await fetchJson<any>(url, { provider: LF, ctx, ttlMs: 60 * 60_000, timeoutMs: 15_000 });
  // Last.fm reports errors inside a 200 body.
  if (r.data?.error) throw new UpstreamError(LF, 200, `Last.fm: ${r.data.message ?? 'error ' + r.data.error}`);
  return r;
}

export interface ChartEntry {
  rank: number;
  name: string;
  artist: string | null; // for tracks
  listeners: number;
  plays: number | null;
  url: string;
}
export interface MusicChart {
  kind: 'artists' | 'tracks';
  country: string | null;
  results: ChartEntry[];
  sourceUrl: string;
  fetchedAt: string;
}

/** Last.fm top artists or tracks, worldwide or for one country (English country name, e.g. "Indonesia"). */
export async function musicChart(ctx: CallContext, kind: 'artists' | 'tracks' = 'tracks', country?: string, limit = 10): Promise<MusicChart> {
  const n = Math.min(25, Math.max(1, limit));
  const c = country?.trim() || undefined;
  const method = c ? (kind === 'artists' ? 'geo.gettopartists' : 'geo.gettoptracks') : kind === 'artists' ? 'chart.gettopartists' : 'chart.gettoptracks';
  const r = await lastfm({ method, country: c, limit: n }, ctx);
  const rows = (kind === 'artists' ? (c ? r.data?.topartists?.artist : r.data?.artists?.artist) : c ? r.data?.tracks?.track : r.data?.tracks?.track) ?? [];
  return {
    kind,
    country: c ?? null,
    results: (rows as any[]).slice(0, n).map((x, i) => ({
      rank: i + 1,
      name: String(x.name ?? ''),
      artist: kind === 'tracks' ? String(x.artist?.name ?? '') : null,
      listeners: Number(x.listeners ?? 0),
      plays: x.playcount != null ? Number(x.playcount) : null,
      url: String(x.url ?? 'https://www.last.fm/charts'),
    })),
    sourceUrl: c ? `https://www.last.fm/place/${encodeURIComponent(c)}` : 'https://www.last.fm/charts',
    fetchedAt: r.fetchedAt,
  };
}

export interface ArtistInfo {
  name: string;
  listeners: number;
  plays: number;
  tags: string[];
  similar: string[];
  bio: string | null; // short Last.fm wiki summary
  url: string;
  /** From MusicBrainz when found. */
  musicbrainz: { id: string; type: string | null; country: string | null; begin: string | null; end: string | null; disambiguation: string | null; url: string } | null;
  sourceUrl: string;
  fetchedAt: string;
}

/** Last.fm artist stats + MusicBrainz identity (MusicBrainz failure is tolerated). */
export async function artistInfo(name: string, ctx: CallContext): Promise<ArtistInfo> {
  const q = name.trim();
  if (!q) throw new Error('artist is required.');
  const r = await lastfm({ method: 'artist.getinfo', artist: q, autocorrect: 1 }, ctx);
  const a = r.data?.artist ?? {};
  let mb: ArtistInfo['musicbrainz'] = null;
  try {
    mb = await musicBrainzArtist(a.mbid || null, a.name || q, ctx);
  } catch {
    mb = null;
  }
  return {
    name: String(a.name ?? q),
    listeners: Number(a.stats?.listeners ?? 0),
    plays: Number(a.stats?.playcount ?? 0),
    tags: ((a.tags?.tag ?? []) as any[]).slice(0, 5).map((t) => String(t.name)),
    similar: ((a.similar?.artist ?? []) as any[]).slice(0, 5).map((t) => String(t.name)),
    bio: a.bio?.summary ? clip(stripHtml(String(a.bio.summary)).replace(/Read more on Last\.fm\.?$/i, '').trim(), 600) || null : null,
    url: String(a.url ?? `https://www.last.fm/music/${encodeURIComponent(q)}`),
    musicbrainz: mb,
    sourceUrl: String(a.url ?? `https://www.last.fm/music/${encodeURIComponent(q)}`),
    fetchedAt: r.fetchedAt,
  };
}

/** One MusicBrainz artist by MBID, or the best name match. Needs our User-Agent; 1 request/s. */
export async function musicBrainzArtist(mbid: string | null, name: string, ctx: CallContext): Promise<ArtistInfo['musicbrainz']> {
  const url = mbid ? `https://musicbrainz.org/ws/2/artist/${encodeURIComponent(mbid)}?fmt=json` : 'https://musicbrainz.org/ws/2/artist' + qs({ query: `artist:"${name.replace(/"/g, '')}"`, limit: 1, fmt: 'json' });
  const r = await fetchJson<any>(url, { provider: 'musicbrainz', ctx, ttlMs: 24 * 60 * 60_000, timeoutMs: 15_000 });
  const a = mbid ? r.data : r.data?.artists?.[0];
  if (!a?.id) return null;
  return {
    id: String(a.id),
    type: a.type ?? null,
    country: a.country ?? a.area?.name ?? null,
    begin: a['life-span']?.begin ?? null,
    end: a['life-span']?.end ?? null,
    disambiguation: a.disambiguation || null,
    url: `https://musicbrainz.org/artist/${a.id}`,
  };
}

// ---------------- CheapShark ----------------
export interface GameDeal {
  title: string;
  store: string;
  salePrice: number;
  normalPrice: number | null;
  savingsPct: number | null;
  metacritic: number | null;
  steamRating: string | null;
  url: string; // CheapShark redirect to the store (their required link format)
}
export interface GameDeals {
  query: string | null;
  results: GameDeal[];
  note: string;
  sourceUrl: string;
  fetchedAt: string;
}

async function cheapStores(ctx: CallContext): Promise<Map<string, string>> {
  const r = await fetchJson<any[]>('https://www.cheapshark.com/api/1.0/stores', { provider: 'cheapshark', ctx, ttlMs: 24 * 60 * 60_000, timeoutMs: 15_000 });
  return new Map((r.data ?? []).map((s: any) => [String(s.storeID), String(s.storeName)]));
}

/** Current PC game deals (USD): best-rated deals, or the cheapest price per game matching a title. */
export async function gameDeals(ctx: CallContext, title?: string, limit = 8): Promise<GameDeals> {
  const t = title?.trim() || undefined;
  if (t) {
    // Title search: /games gives the cheapest current price per matching game (no store or list price).
    const r = await fetchJson<any[]>('https://www.cheapshark.com/api/1.0/games' + qs({ title: t, limit: Math.min(20, Math.max(1, limit)) }), { provider: 'cheapshark', ctx, ttlMs: 30 * 60_000, timeoutMs: 15_000 });
    return {
      query: t,
      results: ((Array.isArray(r.data) ? r.data : []) as any[]).map((g) => ({
        title: clip(g.external ?? '', 160),
        store: 'cheapest store',
        salePrice: Number(g.cheapest),
        normalPrice: null,
        savingsPct: null,
        metacritic: null,
        steamRating: null,
        url: `https://www.cheapshark.com/redirect?dealID=${encodeURIComponent(decodeURIComponent(String(g.cheapestDealID)))}`,
      })),
      note: 'Cheapest current price per game in USD as listed by CheapShark; deals can end at any time.',
      sourceUrl: 'https://www.cheapshark.com/browse' + qs({ title: t }),
      fetchedAt: r.fetchedAt,
    };
  }
  const url = 'https://www.cheapshark.com/api/1.0/deals' + qs({ pageSize: Math.min(20, Math.max(1, limit)), sortBy: 'Deal Rating', onSale: 1 });
  const [r, stores] = await Promise.all([fetchJson<any[]>(url, { provider: 'cheapshark', ctx, ttlMs: 30 * 60_000, timeoutMs: 15_000 }), cheapStores(ctx).catch(() => new Map<string, string>())]);
  return {
    query: null,
    results: ((Array.isArray(r.data) ? r.data : []) as any[]).map((d) => ({
      title: clip(d.title ?? '', 160),
      store: stores.get(String(d.storeID)) ?? `Store ${d.storeID}`,
      salePrice: Number(d.salePrice),
      normalPrice: Number(d.normalPrice),
      savingsPct: Math.round(Number(d.savings ?? 0)),
      metacritic: Number(d.metacriticScore) || null,
      steamRating: d.steamRatingText ?? null,
      url: `https://www.cheapshark.com/redirect?dealID=${encodeURIComponent(decodeURIComponent(String(d.dealID)))}`,
    })),
    note: 'Prices in USD as listed by CheapShark; deals can end at any time.',
    sourceUrl: 'https://www.cheapshark.com/browse',
    fetchedAt: r.fetchedAt,
  };
}

// ---------------- FreeToGame ----------------
export const FREE_GAME_PLATFORMS = ['all', 'pc', 'browser'] as const;
export interface FreeGame {
  title: string;
  genre: string;
  platform: string;
  publisher: string;
  released: string | null;
  description: string;
  thumb: string | null;
  url: string; // freetogame.com profile
}
export interface FreeGames {
  platform: string;
  category: string | null;
  sort: string;
  total: number;
  results: FreeGame[];
  credit: string;
  sourceUrl: string;
  fetchedAt: string;
}

/** Free-to-play games from FreeToGame (popular or newest), optional genre tag like "shooter" or "mmorpg". */
export async function freeGames(ctx: CallContext, opts: { platform?: (typeof FREE_GAME_PLATFORMS)[number]; category?: string; sort?: 'popularity' | 'release-date'; limit?: number } = {}): Promise<FreeGames> {
  const platform = opts.platform ?? 'all';
  if (!FREE_GAME_PLATFORMS.includes(platform)) throw new Error('platform must be all, pc or browser.');
  const category = opts.category?.trim().toLowerCase() || undefined;
  if (category && !/^[a-z0-9-]{2,30}$/.test(category)) throw new Error('category must be one word, e.g. shooter, mmorpg, strategy.');
  const sort = opts.sort === 'release-date' ? 'release-date' : 'popularity';
  const url = 'https://www.freetogame.com/api/games' + qs({ platform, category, 'sort-by': sort });
  const r = await fetchJson<any>(url, { provider: 'freetogame', ctx, ttlMs: 60 * 60_000, timeoutMs: 15_000, okStatuses: [404] });
  const rows = Array.isArray(r.data) ? (r.data as any[]) : [];
  return {
    platform,
    category: category ?? null,
    sort,
    total: rows.length,
    results: rows.slice(0, Math.min(20, opts.limit ?? 8)).map((g) => ({
      title: clip(g.title ?? '', 120),
      genre: String(g.genre ?? ''),
      platform: String(g.platform ?? ''),
      publisher: clip(g.publisher ?? '', 80),
      released: g.release_date ?? null,
      description: clip(g.short_description ?? '', 240),
      thumb: g.thumbnail ?? null,
      url: String(g.freetogame_profile_url ?? g.game_url ?? 'https://www.freetogame.com'),
    })),
    credit: 'Data from FreeToGame.com',
    sourceUrl: 'https://www.freetogame.com/games',
    fetchedAt: r.fetchedAt,
  };
}
