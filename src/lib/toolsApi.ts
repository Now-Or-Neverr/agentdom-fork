// Client for the Guild Workshop tools and the Royal Couriers status page.
// Every call goes to our own server, which calls the public APIs (never the browser).
// Type-only imports from the server are erased at build time.
import type * as I from '../../server/integrations';
import type { Section } from '../../server/routes/tools';
import type { Festival, Weather } from '../../shared/live';
import { getUid } from './api';

export type { Section };
export type Named<T> = T & { provider: string; name: string };

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  const uid = getUid();
  if (uid) headers['x-user'] = uid;
  if (typeof init.body === 'string') headers['content-type'] = 'application/json';
  const res = await fetch('/api' + path, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (HTTP ${res.status})`);
  return data as T;
}
const qs = (o: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? '?' + s : '';
};

export interface ImageQuota {
  used: number;
  limit: number;
  left: number;
  globalLeft: number;
  queueWaitSec: number;
}
export type WorkshopImage = Omit<I.GeneratedImage, 'file'> & { id: string; quota: ImageQuota };

export const tools = {
  // status
  integrations: () => req<{ providers: I.ProviderStatus[]; at: string }>('/integrations'),
  calls: (provider?: string) => req<{ calls: I.ApiCallRow[]; at: string }>('/integrations/calls' + qs({ provider })),
  // realm
  weather: (lat?: number, lon?: number) => req<Weather>('/weather' + qs({ lat, lon })),
  festival: (country = 'US') => req<{ today: Festival | null; next: Festival | null }>('/festival' + qs({ country })),
  // workshop
  fx: (from: string, to: string, amount: number, days = 30) =>
    req<Named<{ conversion: I.FxConversion; series: I.FxSeries }>>('/tools/fx' + qs({ from, to, amount, days })),
  currencies: () => req<Named<I.FxCurrencies>>('/tools/fx/currencies'),
  worldbank: (country: string, indicator: string) => req<Named<I.Indicator & { known: Record<string, string> }>>('/tools/worldbank' + qs({ country, indicator })),
  holidays: (country: string, year?: number) => req<Named<I.Holidays>>('/tools/holidays' + qs({ country, year })),
  holidayCountries: () => req<Named<I.Countries>>('/tools/holidays/countries'),
  grammar: (text: string, language = 'en-US') => req<Named<I.GrammarCheck>>('/tools/grammar', { method: 'POST', body: JSON.stringify({ text, language }) }),
  words: (word: string) =>
    req<{ word: string; definition: Section<I.Definition>; synonyms: Section<I.WordList>; rhymes: Section<I.WordList>; related: Section<I.WordList> }>(
      '/tools/words' + qs({ word }),
    ),
  research: (q: string) =>
    req<{ query: string; sections: Section<I.WikiSearch | I.WorksSearch | I.PreprintSearch | I.BookSearch>[] }>('/tools/research' + qs({ q })),
  trends: (q?: string) => req<{ query: string | null; hn: Section<I.Stories>; tags: Section<I.TrendTags>; links: Section<I.TrendLinks> }>('/tools/trends' + qs({ q })),
  regulations: (q?: string, type?: string) => req<Named<I.FrSearch>>('/tools/regulations' + qs({ q, type })),
  cityWeather: (city?: string) =>
    req<Named<{ place: I.Place | null; weather: Weather; summary: string; sourceUrl: string; fetchedAt: string }>>('/tools/weather' + qs({ city })),
  imageQuota: () => req<ImageQuota>('/tools/image/quota'),
  myImages: () => req<{ id: string; url: string; prompt: string; sourceUrl: string; at: string }[]>('/tools/image/mine'),
  image: (prompt: string, shape: 'landscape' | 'square' | 'portrait' | 'banner') => req<Named<WorkshopImage>>('/tools/image', { method: 'POST', body: JSON.stringify({ prompt, shape }) }),
};

// ---- credentialed data & research tools (server/integrations/pro-data) ----
export const dataTools = {
  webSearch: (q: string) => req<Named<I.WebSearch>>('/tools/websearch' + qs({ q })),
  readLink: (url: string) => req<Named<I.PageText>>('/tools/readlink' + qs({ url })),
  scrape: (url: string) => req<Named<I.ScrapedPage>>('/tools/scrape' + qs({ url })),
  crawl: (url: string, limit = 3) => req<Named<I.Crawl>>('/tools/crawl' + qs({ url, limit })),
  audit: (url: string, strategy: 'mobile' | 'desktop' = 'mobile') => req<Named<I.SiteAudit>>('/tools/audit' + qs({ url, strategy })),
  repo: (repo: string) =>
    req<Named<{ info: I.RepoInfo; tree: Section<I.RepoTree>; readme: Section<I.RepoFile>; commits: Section<I.RepoCommits> }>>('/tools/repo' + qs({ repo })),
  repoFile: (repo: string, path: string) => req<Named<I.RepoFile>>('/tools/repo/file' + qs({ repo, path })),
  similar: (input: { url?: string; q?: string }) => req<Named<I.ExaResults>>('/tools/similar' + qs(input)),
  places: (place: string, category: string) => req<Named<I.LocalBusinesses & { known: Record<string, string> }>>('/tools/places' + qs({ place, category })),
  stock: (symbol: string) => req<Named<{ quote: I.StockQuote; profile: Section<I.CompanyProfile>; news: Section<I.CompanyNews> }>>('/tools/stock' + qs({ symbol })),
  fred: (series: string, limit = 60) => req<Named<I.FredObservations & { popular: Record<string, string> }>>('/tools/fred' + qs({ series, limit })),
  fredSearch: (q: string) => req<Named<I.FredSearch>>('/tools/fred/search' + qs({ q })),
  wolfram: (q: string) => req<Named<I.WolframAnswer>>('/tools/wolfram' + qs({ q })),
  news: (o: { q?: string; category?: string; country?: string }) => req<Named<I.NewsList>>('/tools/news' + qs(o)),
  youtube: (o: { q?: string; region?: string }) => req<Named<I.YtVideoList>>('/tools/youtube' + qs(o)),
  cases: (q: string, order?: 'newest') => req<Named<I.CaseSearch>>('/tools/cases' + qs({ q, order })),
};

// ---- Observatory, Apothecary, Arena ----
export const realmTools = {
  space: () => req<{ quakes: Section<I.QuakeFeed>; iss: Section<I.IssPosition>; asteroids: Section<I.AsteroidFeed> }>('/tools/space'),
  apod: (date?: string) => req<Named<I.Apod>>('/tools/apod' + qs({ date })),
  air: (city: string) => req<Named<I.AirQuality & { place: I.Place }>>('/tools/air' + qs({ city })),
  drug: (name: string) => req<{ name: string; note: string; label: Section<I.DrugLabels>; recalls: Section<I.Recalls> }>('/tools/drug' + qs({ name })),
  recalls: (kind: string, q?: string) => req<Named<I.Recalls>>('/tools/recalls' + qs({ kind, q })),
  medResearch: (q: string, recruiting = false) =>
    req<{ query: string; note: string; papers: Section<I.PubmedSearch>; trials: Section<I.TrialSearch> }>('/tools/medresearch' + qs({ q, recruiting: recruiting ? 1 : undefined })),
  football: (competition: string) => req<{ code: string; competitions: Record<string, string>; table: Section<I.Standings>; matches: Section<I.Matches> }>('/tools/football' + qs({ competition })),
  screen: (o: { q?: string; type?: 'movie' | 'tv' }) => req<Named<I.TitleList>>('/tools/screen' + qs(o)),
  music: (o: { artist?: string; country?: string }) => req<{ kind: 'artist' | 'chart'; artist?: Section<I.ArtistInfo>; chart?: Section<I.MusicChart> }>('/tools/music' + qs(o)),
  games: (title?: string) => req<{ title: string | null; deals: Section<I.GameDeals>; free: Section<I.FreeGames> | null }>('/tools/games' + qs({ title })),
};

// ---- Royal Mint (Robinhood Chain, read-only) ----
export const chainTools = {
  pulse: () => req<Named<I.ChainPulse>>('/tools/chain/pulse'),
  tx: (hash: string) => req<Named<I.TxExplained>>('/tools/chain/tx' + qs({ hash })),
  address: (address: string) => req<Named<I.AddressReport>>('/tools/chain/address' + qs({ address })),
  contract: (address: string) => req<Named<I.ContractReport>>('/tools/chain/contract' + qs({ address })),
  stocks: () => req<Named<I.StockBoard>>('/tools/chain/stocks'),
  agentdom: () => req<Named<I.AgentdomStats>>('/tools/chain/agentdom'),
};

/** "12:04:31" local time, for "fetched at" labels. */
export const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
export const num = (n: number, d = 2) => new Intl.NumberFormat('en-US', { maximumFractionDigits: d }).format(n);
export const compact = (n: number) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(n);
