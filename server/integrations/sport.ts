// Arena, no-key sources: Jolpica (Ergast-compatible Formula 1 data), Lichess, TVmaze, AniList,
// Deezer charts and Open Trivia DB.
import { clip, decodeEntities, fetchJson, qs, stripHtml, type CallContext } from './http';

// ---------------- Jolpica F1 ----------------
const F1 = 'jolpica';
const F1_BASE = 'https://api.jolpi.ca/ergast/f1';
export interface F1DriverRow {
  position: number;
  driver: string;
  code: string | null;
  team: string | null;
  points: number;
  wins: number;
}
export interface F1TeamRow {
  position: number;
  team: string;
  points: number;
  wins: number;
}
export interface F1Result {
  position: number;
  driver: string;
  team: string | null;
  grid: number | null;
  laps: number | null;
  status: string;
  time: string | null;
  points: number;
}
export interface F1Race {
  round: number;
  name: string;
  circuit: string;
  locality: string;
  country: string;
  date: string; // YYYY-MM-DD
  time: string | null; // HH:MM:SSZ
  url: string; // Wikipedia page Jolpica links to
}
export interface F1Season {
  season: string;
  round: number | null; // standings after this round
  drivers: F1DriverRow[];
  teams: F1TeamRow[];
  lastRace: (F1Race & { results: F1Result[] }) | null;
  nextRaces: F1Race[];
  sourceUrl: string;
  fetchedAt: string;
}

const race = (r: any): F1Race => ({
  round: Number(r.round),
  name: String(r.raceName ?? ''),
  circuit: String(r.Circuit?.circuitName ?? ''),
  locality: String(r.Circuit?.Location?.locality ?? ''),
  country: String(r.Circuit?.Location?.country ?? ''),
  date: String(r.date ?? ''),
  time: r.time ?? null,
  url: String(r.url ?? 'https://en.wikipedia.org/wiki/Formula_One'),
});
const person = (d: any) => [d?.givenName, d?.familyName].filter(Boolean).join(' ');

/** Current Formula 1 season: driver and constructor standings, the last race result and the next races. */
export async function f1Season(ctx: CallContext): Promise<F1Season> {
  const o = { provider: F1, ctx, ttlMs: 30 * 60_000, timeoutMs: 15_000 };
  const [ds, cs, last, sched] = await Promise.all([
    fetchJson<any>(`${F1_BASE}/current/driverStandings.json`, o),
    fetchJson<any>(`${F1_BASE}/current/constructorStandings.json`, o),
    fetchJson<any>(`${F1_BASE}/current/last/results.json`, o),
    fetchJson<any>(`${F1_BASE}/current.json?limit=40`, o),
  ]);
  const dl = ds.data?.MRData?.StandingsTable?.StandingsLists?.[0];
  const cl = cs.data?.MRData?.StandingsTable?.StandingsLists?.[0];
  const lr = last.data?.MRData?.RaceTable?.Races?.[0];
  const races = ((sched.data?.MRData?.RaceTable?.Races ?? []) as any[]).map(race);
  const today = new Date().toISOString().slice(0, 10);
  return {
    season: String(sched.data?.MRData?.RaceTable?.season ?? dl?.season ?? ''),
    round: dl?.round ? Number(dl.round) : null,
    drivers: ((dl?.DriverStandings ?? []) as any[]).map((d) => ({
      position: Number(d.position ?? d.positionText),
      driver: person(d.Driver),
      code: d.Driver?.code ?? null,
      team: d.Constructors?.[0]?.name ?? null,
      points: Number(d.points ?? 0),
      wins: Number(d.wins ?? 0),
    })),
    teams: ((cl?.ConstructorStandings ?? []) as any[]).map((t) => ({ position: Number(t.position ?? t.positionText), team: String(t.Constructor?.name ?? ''), points: Number(t.points ?? 0), wins: Number(t.wins ?? 0) })),
    lastRace: lr
      ? {
          ...race(lr),
          results: ((lr.Results ?? []) as any[]).map((x) => ({
            position: Number(x.position),
            driver: person(x.Driver),
            team: x.Constructor?.name ?? null,
            grid: x.grid != null ? Number(x.grid) : null,
            laps: x.laps != null ? Number(x.laps) : null,
            status: String(x.status ?? ''),
            time: x.Time?.time ?? null,
            points: Number(x.points ?? 0),
          })),
        }
      : null,
    nextRaces: races.filter((r) => r.date >= today).slice(0, 5),
    sourceUrl: 'https://github.com/jolpica/jolpica-f1',
    fetchedAt: ds.fetchedAt,
  };
}

// ---------------- Lichess ----------------
export const CHESS_PERFS = ['bullet', 'blitz', 'rapid', 'classical', 'ultraBullet', 'chess960'] as const;
export type ChessPerf = (typeof CHESS_PERFS)[number];
export interface ChessPlayer {
  rank: number;
  username: string;
  title: string | null; // GM, IM…
  rating: number;
  progress: number; // rating change over the last games
  url: string;
}
export interface ChessPuzzle {
  id: string;
  rating: number;
  plays: number;
  themes: string[];
  fen: string; // position to solve (after the opponent's lastMove)
  lastMove: string | null;
  solution: string[]; // UCI moves
  toMove: 'white' | 'black';
  game: { id: string; perf: string | null; players: string[]; url: string };
  url: string;
}
export interface ChessBoard {
  perf: ChessPerf;
  top: ChessPlayer[];
  puzzle: ChessPuzzle | null;
  sourceUrl: string;
  fetchedAt: string;
}

/** Top-10 Lichess players for a time control, and the Lichess daily puzzle. */
export async function chessBoard(ctx: CallContext, perf: ChessPerf = 'blitz'): Promise<ChessBoard> {
  if (!CHESS_PERFS.includes(perf)) throw new Error(`perf must be one of: ${CHESS_PERFS.join(', ')}.`);
  const o = { provider: 'lichess', ctx, timeoutMs: 15_000 };
  const [top, daily] = await Promise.all([fetchJson<any>(`https://lichess.org/api/player/top/10/${perf}`, { ...o, ttlMs: 30 * 60_000 }), fetchJson<any>('https://lichess.org/api/puzzle/daily', { ...o, ttlMs: 60 * 60_000 })]);
  const p = daily.data?.puzzle;
  const g = daily.data?.game;
  // FEN in the daily puzzle is the position to solve; the side to move is its second field.
  const fen = String(p?.fen ?? '');
  return {
    perf,
    top: ((top.data?.users ?? []) as any[]).map((u, i) => ({
      rank: i + 1,
      username: String(u.username ?? u.id),
      title: u.title ?? null,
      rating: Number(u.perfs?.[perf]?.rating ?? 0),
      progress: Number(u.perfs?.[perf]?.progress ?? 0),
      url: `https://lichess.org/@/${encodeURIComponent(u.id ?? u.username)}`,
    })),
    puzzle: p
      ? {
          id: String(p.id),
          rating: Number(p.rating ?? 0),
          plays: Number(p.plays ?? 0),
          themes: ((p.themes ?? []) as string[]).slice(0, 6),
          fen,
          lastMove: p.lastMove ?? null,
          solution: (p.solution ?? []) as string[],
          toMove: fen.split(' ')[1] === 'b' ? 'black' : 'white',
          game: { id: String(g?.id ?? ''), perf: g?.perf?.name ?? null, players: ((g?.players ?? []) as any[]).map((x) => `${x.name}${x.rating ? ` (${x.rating})` : ''}`), url: `https://lichess.org/${encodeURIComponent(g?.id ?? '')}` },
          url: `https://lichess.org/training/${encodeURIComponent(p.id)}`,
        }
      : null,
    sourceUrl: 'https://lichess.org/api',
    fetchedAt: top.fetchedAt,
  };
}

// ---------------- TVmaze ----------------
export interface TvShow {
  id: number;
  name: string;
  type: string | null;
  language: string | null;
  genres: string[];
  status: string | null;
  premiered: string | null;
  ended: string | null;
  rating: number | null;
  network: string | null;
  summary: string;
  image: string | null;
  url: string;
}
export interface TvEpisode {
  show: string;
  showUrl: string;
  episode: string;
  season: number | null;
  number: number | null;
  airstamp: string | null;
  runtime: number | null;
  network: string | null;
  url: string;
}
export interface TvGuide {
  kind: 'schedule' | 'search';
  country: string | null;
  query: string | null;
  shows: TvShow[];
  episodes: TvEpisode[];
  attribution: string;
  sourceUrl: string;
  fetchedAt: string;
}
export const TVMAZE_ATTRIBUTION = 'Data from TVmaze (tvmaze.com), CC BY-SA.';

const show = (s: any): TvShow => ({
  id: Number(s.id),
  name: String(s.name ?? ''),
  type: s.type ?? null,
  language: s.language ?? null,
  genres: (s.genres ?? []) as string[],
  status: s.status ?? null,
  premiered: s.premiered ?? null,
  ended: s.ended ?? null,
  rating: s.rating?.average ?? null,
  network: s.network?.name ?? s.webChannel?.name ?? null,
  summary: clip(stripHtml(s.summary ?? ''), 280),
  image: s.image?.medium ?? null,
  url: String(s.url ?? `https://www.tvmaze.com/shows/${s.id}`),
});

/** Today's TV schedule for a country (main shows first), or a show search when a query is given. */
export async function tvGuide(ctx: CallContext, opts: { query?: string; country?: string } = {}): Promise<TvGuide> {
  const o = { provider: 'tvmaze', ctx, timeoutMs: 15_000 };
  if (opts.query) {
    const q = opts.query.trim();
    if (!q || q.length > 100) throw new Error('show name is required (max 100 characters).');
    const r = await fetchJson<any>('https://api.tvmaze.com/search/shows' + qs({ q }), { ...o, ttlMs: 60 * 60_000 });
    return { kind: 'search', country: null, query: q, shows: ((r.data ?? []) as any[]).slice(0, 10).map((x) => show(x.show ?? {})), episodes: [], attribution: TVMAZE_ATTRIBUTION, sourceUrl: `https://www.tvmaze.com/search?q=${encodeURIComponent(q)}`, fetchedAt: r.fetchedAt };
  }
  const c = (opts.country || 'US').toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) throw new Error('country must be a 2-letter ISO code.');
  const r = await fetchJson<any>('https://api.tvmaze.com/schedule' + qs({ country: c }), { ...o, ttlMs: 30 * 60_000 });
  const eps = ((r.data ?? []) as any[])
    // Most-followed shows first (TVmaze "weight"), then by air time.
    .sort((a, b) => Number(b.show?.weight ?? 0) - Number(a.show?.weight ?? 0))
    .slice(0, 15)
    .sort((a, b) => String(a.airstamp ?? '').localeCompare(String(b.airstamp ?? '')));
  return {
    kind: 'schedule',
    country: c,
    query: null,
    shows: [],
    episodes: eps.map((e) => ({
      show: String(e.show?.name ?? ''),
      showUrl: String(e.show?.url ?? ''),
      episode: String(e.name ?? ''),
      season: e.season ?? null,
      number: e.number ?? null,
      airstamp: e.airstamp ?? null,
      runtime: e.runtime ?? null,
      network: e.show?.network?.name ?? e.show?.webChannel?.name ?? null,
      url: String(e.url ?? ''),
    })),
    attribution: TVMAZE_ATTRIBUTION,
    sourceUrl: `https://www.tvmaze.com/schedule?country=${c}`,
    fetchedAt: r.fetchedAt,
  };
}

// ---------------- AniList ----------------
export interface Anime {
  id: number;
  title: string;
  titleNative: string | null;
  format: string | null;
  episodes: number | null;
  status: string | null;
  score: number | null; // AniList average score 0-100
  popularity: number | null;
  genres: string[];
  season: string | null;
  year: number | null;
  nextEpisode: { episode: number; airingAt: string } | null;
  description: string;
  image: string | null;
  url: string;
}
export interface AnimeList {
  kind: 'trending' | 'search';
  query: string | null;
  results: Anime[];
  sourceUrl: string;
  fetchedAt: string;
}
const ANIME_FIELDS = 'id title { romaji english native } format episodes status averageScore popularity genres season seasonYear siteUrl coverImage { medium } nextAiringEpisode { episode airingAt } description(asHtml: false)';

/** Trending anime on AniList right now, or a title search. */
export async function animeList(ctx: CallContext, query?: string, limit = 10): Promise<AnimeList> {
  const q = query?.trim() || undefined;
  if (q && q.length > 100) throw new Error('title is too long (max 100 characters).');
  const per = Math.min(15, Math.max(1, limit));
  const gql = q
    ? `query ($q: String, $n: Int) { Page(perPage: $n) { media(type: ANIME, search: $q, sort: SEARCH_MATCH, isAdult: false) { ${ANIME_FIELDS} } } }`
    : `query ($n: Int) { Page(perPage: $n) { media(type: ANIME, sort: TRENDING_DESC, isAdult: false) { ${ANIME_FIELDS} } } }`;
  const body = JSON.stringify({ query: gql, variables: q ? { q, n: per } : { n: per } });
  const r = await fetchJson<any>('https://graphql.anilist.co', { provider: 'anilist', ctx, method: 'POST', body, headers: { 'content-type': 'application/json' }, ttlMs: 30 * 60_000, timeoutMs: 15_000, logEndpoint: q ? `graphql: search anime “${q.slice(0, 60)}”` : 'graphql: trending anime' });
  if (r.data?.errors?.length) throw new Error(`AniList: ${String(r.data.errors[0]?.message ?? 'query failed')}`);
  const media = (r.data?.data?.Page?.media ?? []) as any[];
  return {
    kind: q ? 'search' : 'trending',
    query: q ?? null,
    results: media.map((m) => ({
      id: Number(m.id),
      title: String(m.title?.english || m.title?.romaji || ''),
      titleNative: m.title?.native ?? null,
      format: m.format ?? null,
      episodes: m.episodes ?? null,
      status: m.status ?? null,
      score: m.averageScore ?? null,
      popularity: m.popularity ?? null,
      genres: (m.genres ?? []) as string[],
      season: m.season ?? null,
      year: m.seasonYear ?? null,
      nextEpisode: m.nextAiringEpisode ? { episode: Number(m.nextAiringEpisode.episode), airingAt: new Date(Number(m.nextAiringEpisode.airingAt) * 1000).toISOString() } : null,
      description: clip(stripHtml(m.description ?? ''), 280),
      image: m.coverImage?.medium ?? null,
      url: String(m.siteUrl ?? `https://anilist.co/anime/${m.id}`),
    })),
    sourceUrl: q ? `https://anilist.co/search/anime?search=${encodeURIComponent(q)}` : 'https://anilist.co/search/anime/trending',
    fetchedAt: r.fetchedAt,
  };
}

// ---------------- Deezer ----------------
export interface ChartTrack {
  position: number;
  title: string;
  artist: string;
  album: string | null;
  durationSec: number;
  explicit: boolean;
  cover: string | null;
  url: string;
}
export interface MusicTop {
  tracks: ChartTrack[];
  note: string;
  sourceUrl: string;
  fetchedAt: string;
}

/** Deezer's worldwide top tracks right now. */
export async function deezerChart(ctx: CallContext, limit = 15): Promise<MusicTop> {
  const r = await fetchJson<any>('https://api.deezer.com/chart/0/tracks?limit=25', { provider: 'deezer', ctx, ttlMs: 60 * 60_000, timeoutMs: 15_000 });
  if (r.data?.error) throw new Error(`Deezer: ${String(r.data.error.message ?? 'error')}`);
  return {
    tracks: ((r.data?.data ?? []) as any[]).slice(0, Math.min(25, limit)).map((t, i) => ({
      position: Number(t.position ?? i + 1),
      title: String(t.title ?? ''),
      artist: String(t.artist?.name ?? ''),
      album: t.album?.title ?? null,
      durationSec: Number(t.duration ?? 0),
      explicit: Boolean(t.explicit_lyrics),
      cover: t.album?.cover_small ?? null,
      url: String(t.link ?? 'https://www.deezer.com'),
    })),
    note: 'Deezer chart 0 is its main editorial chart; Deezer may localise it to the country of the server that asks.',
    sourceUrl: 'https://www.deezer.com/en/channels/charts',
    fetchedAt: r.fetchedAt,
  };
}

// ---------------- Open Trivia DB ----------------
export const TRIVIA_CATEGORIES: Record<string, string> = {
  '9': 'General Knowledge',
  '10': 'Books',
  '11': 'Film',
  '12': 'Music',
  '14': 'Television',
  '15': 'Video Games',
  '17': 'Science & Nature',
  '18': 'Computers',
  '19': 'Mathematics',
  '21': 'Sports',
  '22': 'Geography',
  '23': 'History',
  '27': 'Animals',
};
export const TRIVIA_DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type TriviaDifficulty = (typeof TRIVIA_DIFFICULTIES)[number];
export interface TriviaQuestion {
  category: string;
  difficulty: string;
  type: 'multiple' | 'boolean';
  question: string;
  correct: string;
  incorrect: string[];
}
export interface TriviaSet {
  questions: TriviaQuestion[];
  sourceUrl: string;
  fetchedAt: string;
}

/** Fresh trivia questions (Open Trivia DB, CC BY-SA 4.0). Not cached: each call is a new set. */
export async function trivia(ctx: CallContext, opts: { amount?: number; category?: string; difficulty?: TriviaDifficulty } = {}): Promise<TriviaSet> {
  const amount = Math.min(10, Math.max(1, Math.round(opts.amount ?? 5)));
  if (opts.category && !(opts.category in TRIVIA_CATEGORIES)) throw new Error(`category must be one of: ${Object.keys(TRIVIA_CATEGORIES).join(', ')}.`);
  if (opts.difficulty && !TRIVIA_DIFFICULTIES.includes(opts.difficulty)) throw new Error('difficulty must be easy, medium or hard.');
  const r = await fetchJson<any>('https://opentdb.com/api.php' + qs({ amount, category: opts.category, difficulty: opts.difficulty, encode: 'url3986' }), { provider: 'opentdb', ctx, ttlMs: 0, timeoutMs: 12_000 });
  const code = Number(r.data?.response_code ?? 0);
  if (code === 5) throw new Error('Open Trivia DB asks for a short pause (one request every 5 seconds). Try again in a moment.');
  if (code !== 0) throw new Error(code === 1 ? 'Open Trivia DB has not enough questions for that choice. Try another category or difficulty.' : `Open Trivia DB answered with code ${code}.`);
  const d = (s: unknown) => decodeEntities(decodeURIComponent(String(s ?? '')));
  return {
    questions: ((r.data?.results ?? []) as any[]).map((x) => ({
      category: d(x.category),
      difficulty: d(x.difficulty),
      type: d(x.type) === 'boolean' ? 'boolean' : 'multiple',
      question: d(x.question),
      correct: d(x.correct_answer),
      incorrect: ((x.incorrect_answers ?? []) as string[]).map(d),
    })),
    sourceUrl: 'https://opentdb.com/',
    fetchedAt: r.fetchedAt,
  };
}
