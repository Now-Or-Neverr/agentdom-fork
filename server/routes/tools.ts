// Integrations routes: provider status, call log, realm weather/festival and the Guild Workshop
// tools. Mounted under /api by server/index.ts. Every external call goes through
// server/integrations (logged to api_calls); nothing here invents data.
import { Router, type Request } from 'express';
import { db, now, uid, type Row } from '../db';
import { HttpError, currentUser, h, startOfDay, text } from '../core';
import * as I from '../integrations';

export const router = Router();

const WS = (tool: string): I.CallContext => ({ context: 'workshop', ref: tool });
const REALM: I.CallContext = { context: 'realm', ref: null };

db.exec(`
CREATE TABLE IF NOT EXISTS workshop_images (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  url TEXT NOT NULL,
  prompt TEXT NOT NULL,
  source_url TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS workshop_images_user ON workshop_images(user_id, at);
`);
const IMG_PER_USER = Number(process.env.WORKSHOP_IMAGES_PER_USER) || 8;
const IMG_GLOBAL = Number(process.env.WORKSHOP_IMAGES_GLOBAL) || 150;
const IMG_MAX_WAIT_MS = 100_000; // fail fast rather than hold a request for minutes

// ---------------- helpers ----------------
/** Turn integration failures into honest HTTP errors. */
async function run<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if (e instanceof I.ImageBusyError) throw new HttpError(429, e.message);
    if (e instanceof I.QuotaError) throw new HttpError(429, e.message);
    if (e instanceof I.UpstreamError) throw new HttpError(502, e.message);
    throw new HttpError(400, (e as Error).message || 'Request failed.');
  }
}

export interface Section<T> {
  provider: string;
  name: string;
  ok: boolean;
  data: T | null;
  error: string | null;
}
async function section<T>(provider: string, p: Promise<T>): Promise<Section<T>> {
  const name = I.PROVIDER[provider]?.name ?? provider;
  try {
    return { provider, name, ok: true, data: await p, error: null };
  } catch (e) {
    return { provider, name, ok: false, data: null, error: (e as Error).message || 'Request failed.' };
  }
}
const single = <T extends object>(provider: string, data: T) => ({ provider, name: I.PROVIDER[provider]?.name ?? provider, ...data });

// Per-IP sliding-window limiter for workshop endpoints (in memory).
const hits = new Map<string, number[]>();
function limitIp(req: Request, bucket: string, max: number, windowMs = 60_000) {
  const key = `${bucket}:${req.ip ?? 'unknown'}`;
  const t = Date.now();
  const arr = (hits.get(key) ?? []).filter((x) => x > t - windowMs);
  if (arr.length >= max) {
    const wait = Math.ceil((arr[0] + windowMs - t) / 1000);
    throw new HttpError(429, `Too many requests. Please wait ${wait} s and try again.`);
  }
  arr.push(t);
  hits.set(key, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((x) => x > t - windowMs)) hits.delete(k);
}
const ws = (req: Request, bucket = 'tools', max = 40) => limitIp(req, bucket, max);

const q = (req: Request, k: string) => (typeof req.query[k] === 'string' ? (req.query[k] as string).trim() : '');
const num = (s: string, name: string) => {
  const n = Number(s);
  if (s === '' || !Number.isFinite(n)) throw new HttpError(400, `${name} must be a number.`);
  return n;
};
function country(s: string, def = 'US') {
  const c = (s || def).toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) throw new HttpError(400, 'country must be a 2-letter ISO code (e.g. US, GB).');
  return c;
}
function latLon(req: Request): { lat: number; lon: number } {
  const la = q(req, 'lat');
  const lo = q(req, 'lon');
  if (!la && !lo) return I.realmLocation();
  const lat = num(la, 'lat');
  const lon = num(lo, 'lon');
  if (!I.validLatLon(lat, lon)) throw new HttpError(400, 'lat must be -90..90 and lon -180..180.');
  return { lat, lon };
}

// ---------------- status ----------------
router.get(
  '/integrations',
  h((_req, res) => {
    res.json({ providers: I.providerStatuses(), at: now() });
  }),
);

router.get(
  '/integrations/calls',
  h((req, res) => {
    const p = q(req, 'provider');
    if (p && !I.PROVIDER[p]) throw new HttpError(400, 'Unknown provider.');
    res.json({ calls: I.recentCalls(p || undefined, 50), at: now() });
  }),
);

// ---------------- realm ----------------
router.get(
  '/weather',
  h(async (req, res) => {
    const { lat, lon } = latLon(req);
    res.json(await run(I.currentWeather(lat, lon, REALM)));
  }),
);

router.get(
  '/festival',
  h(async (req, res) => {
    res.json(await run(I.festival(country(q(req, 'country')), REALM)));
  }),
);

// ---------------- workshop: Treasury / Bazaar ----------------
router.get(
  '/tools/fx/currencies',
  h(async (req, res) => {
    ws(req);
    res.json(single('frankfurter', await run(I.fxCurrencies(WS('fx')))));
  }),
);

router.get(
  '/tools/fx',
  h(async (req, res) => {
    ws(req);
    const from = (q(req, 'from') || 'USD').toUpperCase();
    const to = (q(req, 'to') || 'EUR').toUpperCase();
    if (!I.isCurrency(from) || !I.isCurrency(to)) throw new HttpError(400, 'Currencies must be 3-letter codes (e.g. USD, EUR).');
    if (from === to) throw new HttpError(400, 'Pick two different currencies.');
    const amount = q(req, 'amount') ? num(q(req, 'amount'), 'amount') : 1;
    if (amount <= 0 || amount > 1e12) throw new HttpError(400, 'amount must be between 0 and 1,000,000,000,000.');
    const days = Math.min(365, Math.max(7, Math.round(q(req, 'days') ? num(q(req, 'days'), 'days') : 30)));
    const start = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
    const [conversion, series] = await run(Promise.all([I.fxConvert(amount, from, to, WS('fx')), I.fxSeries(from, to, WS('fx'), start)]));
    res.json(single('frankfurter', { conversion, series }));
  }),
);

router.get(
  '/tools/worldbank',
  h(async (req, res) => {
    ws(req);
    const c = q(req, 'country') || 'US';
    const ind = q(req, 'indicator') || 'NY.GDP.MKTP.CD';
    if (!I.isCountryCode(c)) throw new HttpError(400, 'country must be a 2 or 3-letter ISO code.');
    if (!I.isIndicatorCode(ind)) throw new HttpError(400, 'indicator must be a World Bank indicator code (e.g. NY.GDP.MKTP.CD).');
    res.json(single('worldbank', { ...(await run(I.wbIndicator(c, ind, WS('worldbank')))), known: I.WB_INDICATORS }));
  }),
);

router.get(
  '/tools/holidays/countries',
  h(async (req, res) => {
    ws(req);
    res.json(single('nagerdate', await run(I.holidayCountries(WS('holidays')))));
  }),
);

router.get(
  '/tools/holidays',
  h(async (req, res) => {
    ws(req);
    const c = country(q(req, 'country'));
    const thisYear = new Date().getUTCFullYear();
    const year = q(req, 'year') ? Math.round(num(q(req, 'year'), 'year')) : thisYear;
    if (year < 1975 || year > thisYear + 5) throw new HttpError(400, `year must be between 1975 and ${thisYear + 5}.`);
    res.json(single('nagerdate', await run(I.publicHolidays(c, year, WS('holidays')))));
  }),
);

// ---------------- workshop: Scriptorium ----------------
router.post(
  '/tools/grammar',
  h(async (req, res) => {
    ws(req, 'grammar', 8);
    const t = text(req.body?.text, 6000, 'text');
    const lang = typeof req.body?.language === 'string' && /^(auto|[a-z]{2}(-[A-Z]{2})?)$/.test(req.body.language) ? req.body.language : 'en-US';
    res.json(single('languagetool', await run(I.checkGrammar(t, WS('grammar'), lang))));
  }),
);

router.get(
  '/tools/words',
  h(async (req, res) => {
    ws(req);
    const word = q(req, 'word').toLowerCase();
    if (!word) throw new HttpError(400, 'word is required.');
    if (!/^[a-z][a-z' -]{0,39}$/.test(word)) throw new HttpError(400, 'word must be a single English word or short phrase (letters only, max 40).');
    const c = WS('words');
    const [definition, synonyms, rhymes, related] = await Promise.all([
      section('dictionary', I.define(word, c)),
      section('datamuse', I.relatedWords(word, 'synonyms', c, 15)),
      section('datamuse', I.relatedWords(word, 'rhymes', c, 15)),
      section('datamuse', I.relatedWords(word, 'related', c, 15)),
    ]);
    res.json({ word, definition, synonyms, rhymes, related });
  }),
);

// ---------------- workshop: Grand Archive ----------------
const RESEARCH_SOURCES = ['wikipedia', 'openalex', 'arxiv', 'openlibrary'] as const;
router.get(
  '/tools/research',
  h(async (req, res) => {
    ws(req, 'research', 15);
    const query = text(req.query.q, 200, 'q');
    const want = q(req, 'sources') ? q(req, 'sources').split(',') : [...RESEARCH_SOURCES];
    const pick = RESEARCH_SOURCES.filter((s) => want.includes(s));
    if (!pick.length) throw new HttpError(400, `sources must include one of: ${RESEARCH_SOURCES.join(', ')}.`);
    const c = WS('research');
    const fns: Record<(typeof RESEARCH_SOURCES)[number], () => Promise<unknown>> = {
      wikipedia: () => I.wikiSearch(query, c, 5),
      openalex: () => I.openAlexWorks(query, c, 5),
      arxiv: () => I.arxivSearch(query, c, 5),
      openlibrary: () => I.openLibrarySearch(query, c, 5),
    };
    const sections = await Promise.all(pick.map((s) => section(s, fns[s]())));
    res.json({ query, sections });
  }),
);

// ---------------- workshop: Heralds' Tower ----------------
router.get(
  '/tools/trends',
  h(async (req, res) => {
    ws(req, 'trends', 20);
    const query = text(req.query.q, 120, 'q', false);
    const c = WS('trends');
    const [hn, tags, links] = await Promise.all([
      section('hackernews', query ? I.hnSearch(query, c, 10) : I.hnFrontPage(c, 10)),
      section('mastodon', I.mastodonTrendingTags(c, 10)),
      section('mastodon', I.mastodonTrendingLinks(c, 6)),
    ]);
    res.json({ query: query || null, hn, tags, links });
  }),
);

// ---------------- workshop: High Court ----------------
router.get(
  '/tools/regulations',
  h(async (req, res) => {
    ws(req);
    const query = text(req.query.q, 160, 'q', false);
    const type = q(req, 'type').toUpperCase();
    if (type && !['RULE', 'PRORULE', 'NOTICE', 'PRESDOCU'].includes(type)) throw new HttpError(400, 'type must be RULE, PRORULE, NOTICE or PRESDOCU.');
    res.json(single('federalregister', await run(I.federalRegister(WS('regulations'), query || undefined, 10, (type || undefined) as 'RULE' | undefined))));
  }),
);

// ---------------- workshop: Imperial Throne ----------------
router.get(
  '/tools/weather',
  h(async (req, res) => {
    ws(req);
    const city = text(req.query.city, 80, 'city', false);
    const c = WS('weather');
    let place: I.Place | null = null;
    let lat: number;
    let lon: number;
    if (city) {
      const g = await run(I.geocode(city, c, 1));
      place = g.results[0] ?? null;
      if (!place) throw new HttpError(404, `No place called “${city}” was found.`);
      lat = place.lat;
      lon = place.lon;
    } else ({ lat, lon } = latLon(req));
    const weather = await run(I.currentWeather(lat, lon, c));
    res.json(single('openmeteo', { place, weather, summary: I.weatherText(weather.code), sourceUrl: I.weatherSourceUrl(lat, lon), fetchedAt: weather.fetchedAt }));
  }),
);

// ---------------- workshop: Atelier ----------------
function imageQuota(userId: string) {
  const today = startOfDay();
  const mine = Number((db.prepare('SELECT COUNT(*) AS n FROM workshop_images WHERE user_id = ? AND at >= ?').get(userId, today) as Row).n);
  const all = Number((db.prepare('SELECT COUNT(*) AS n FROM workshop_images WHERE at >= ?').get(today) as Row).n);
  return { used: mine, limit: IMG_PER_USER, left: Math.max(0, Math.min(IMG_PER_USER - mine, IMG_GLOBAL - all)), globalLeft: Math.max(0, IMG_GLOBAL - all), queueWaitSec: Math.ceil(I.imageQueueWaitMs() / 1000) };
}
const inProgress = new Set<string>();

router.get(
  '/tools/image/quota',
  h((req, res) => {
    const u = currentUser(req);
    res.json(imageQuota(u.id));
  }),
);

router.get(
  '/tools/image/mine',
  h((req, res) => {
    const u = currentUser(req);
    const rows = db.prepare('SELECT * FROM workshop_images WHERE user_id = ? ORDER BY at DESC LIMIT 24').all(u.id) as Row[];
    res.json(rows.map((r) => ({ id: r.id, url: r.url, prompt: r.prompt, sourceUrl: r.source_url, at: r.at })));
  }),
);

router.post(
  '/tools/image',
  h(async (req, res) => {
    const u = currentUser(req);
    ws(req, 'image', 6);
    const prompt = text(req.body?.prompt, I.IMAGE_PROMPT_MAX, 'prompt');
    if (prompt.length < 3) throw new HttpError(400, 'prompt is too short.');
    const sizes: Record<string, [number, number]> = { landscape: [1024, 640], square: [768, 768], portrait: [640, 960], banner: [1280, 448] };
    const shape = typeof req.body?.shape === 'string' && sizes[req.body.shape] ? req.body.shape : 'landscape';
    const quota = imageQuota(u.id);
    if (quota.used >= IMG_PER_USER) throw new HttpError(429, `You have used all ${IMG_PER_USER} images for today. The limit resets at 00:00 UTC.`);
    if (quota.globalLeft <= 0) throw new HttpError(429, 'The Atelier has used its image budget for today. Please come back tomorrow.');
    if (inProgress.has(u.id)) throw new HttpError(429, 'Your previous image is still being painted.');
    inProgress.add(u.id);
    try {
      const [width, height] = sizes[shape];
      const img = await run(I.generateImage(prompt, WS('image'), { width, height, maxWaitMs: IMG_MAX_WAIT_MS }));
      const id = uid('wim');
      db.prepare('INSERT INTO workshop_images (id, user_id, url, prompt, source_url, at) VALUES (?,?,?,?,?,?)').run(id, u.id, img.url, img.prompt, img.sourceUrl, now());
      const { file: _file, ...pub } = img;
      res.json(single('pollinations', { id, ...pub, quota: imageQuota(u.id) }));
    } finally {
      inProgress.delete(u.id);
    }
  }),
);

// ================= workshop: credentialed data & research tools =================
// Free tiers are small, so each tool has a per-IP limit (per minute and per hour) and a
// realm-wide daily budget (in memory, resets 00:00 UTC). Answers are cached in http.ts,
// so repeated questions do not spend quota upstream.
const budgets = new Map<string, { day: string; n: number }>();
const DAILY: Record<string, number> = {
  tavily: 40, // 1,000 credits/month
  exa: 25, // ~$10/month of credits
  jina: 150,
  firecrawl: 30, // 1,000 credits/month
  gnews: 70, // 100 requests/day, some left for decrees
  'youtube-search': 50, // 101 units each, of 10,000/day
  youtube: 400,
  finnhub: 2000,
  fred: 2000,
  wolfram: 50, // 2,000/month
  courtlistener: 500,
  geoapify: 1000,
  pagespeed: 300,
  github: 1500,
  nasa: 500, // 1,000 requests/hour per key
  openaq: 500,
  footballdata: 400, // 10 requests/minute
  tmdb: 2000,
  lastfm: 2000,
};
function budget(bucket: string) {
  const day = new Date().toISOString().slice(0, 10);
  const b = budgets.get(bucket);
  const cur = b && b.day === day ? b : { day, n: 0 };
  if (cur.n >= (DAILY[bucket] ?? 500)) throw new HttpError(429, 'This workshop tool has used its free daily budget. It resets at 00:00 UTC.');
  cur.n++;
  budgets.set(bucket, cur);
}
/** Key configured? + per-IP limits (minute and hour) + realm-wide daily budget. */
function gate(req: Request, provider: string, perMin: number, perHour: number, bucket = provider) {
  if (!I.enabled(provider)) throw new HttpError(503, `${I.PROVIDER[provider]?.name ?? provider} is not configured on this server.`);
  limitIp(req, `${bucket}:m`, perMin);
  limitIp(req, `${bucket}:h`, perHour, 3600_000);
  budget(bucket);
}
/** A required url query param; the client function does the full public-URL check. */
const urlParam = (req: Request, k = 'url') => text(req.query[k], 1000, k);

// ---- Grand Archive ----
router.get(
  '/tools/websearch',
  h(async (req, res) => {
    const query = text(req.query.q, 300, 'q');
    gate(req, 'tavily', 5, 30);
    res.json(single('tavily', await run(I.tavilySearch(query, WS('websearch'), { max: 6 }))));
  }),
);

router.get(
  '/tools/readlink',
  h(async (req, res) => {
    const url = urlParam(req);
    gate(req, 'jina', 6, 40);
    res.json(single('jina', await run(I.readUrl(url, WS('readlink'), 8000))));
  }),
);

// ---- Forge ----
router.get(
  '/tools/scrape',
  h(async (req, res) => {
    const url = urlParam(req);
    gate(req, 'firecrawl', 2, 10);
    res.json(single('firecrawl', await run(I.scrapeUrl(url, WS('scrape'), 8000))));
  }),
);

router.get(
  '/tools/crawl',
  h(async (req, res) => {
    const url = urlParam(req);
    const limit = q(req, 'limit') ? Math.round(num(q(req, 'limit'), 'limit')) : 3;
    if (limit < 1 || limit > I.CRAWL_MAX_PAGES) throw new HttpError(400, `limit must be 1..${I.CRAWL_MAX_PAGES}.`);
    gate(req, 'firecrawl', 1, 3);
    res.json(single('firecrawl', await run(I.crawlSite(url, WS('crawl'), limit, 3000))));
  }),
);

router.get(
  '/tools/audit',
  h(async (req, res) => {
    const url = urlParam(req);
    const strategy = q(req, 'strategy') === 'desktop' ? 'desktop' : 'mobile';
    gate(req, 'pagespeed', 2, 12);
    res.json(single('pagespeed', await run(I.auditSite(url, WS('audit'), strategy))));
  }),
);

function repoRef(req: Request): I.GithubRepoRef {
  const repo = text(req.query.repo, 200, 'repo');
  try {
    return I.parseGithubRepo(repo);
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
}

router.get(
  '/tools/repo',
  h(async (req, res) => {
    const ref = repoRef(req);
    gate(req, 'github', 6, 60);
    const c = WS('repo');
    const info = await run(I.repoInfo(ref, c));
    const [tree, readme, commits] = await Promise.all([
      section('github', I.repoTree(ref, c, undefined, 300)),
      section('github', I.repoReadme(ref, c, 12_000)),
      section('github', I.repoCommits(ref, c, 8)),
    ]);
    res.json(single('github', { info, tree, readme, commits }));
  }),
);

router.get(
  '/tools/repo/file',
  h(async (req, res) => {
    const ref = repoRef(req);
    const path = text(req.query.path, 300, 'path');
    gate(req, 'github', 10, 120);
    res.json(single('github', await run(I.repoFile(ref, path, WS('repo-file'), undefined, 60_000))));
  }),
);

// ---- Grand Bazaar ----
router.get(
  '/tools/similar',
  h(async (req, res) => {
    const url = text(req.query.url, 1000, 'url', false);
    const query = text(req.query.q, 300, 'q', false);
    if (!url && !query) throw new HttpError(400, 'Give a company website (url) or a description (q).');
    gate(req, 'exa', 2, 8);
    const c = WS('similar');
    res.json(single('exa', await run(url ? I.exaFindSimilar(url, c, { num: 6 }) : I.exaSearch(query, c, { num: 6, category: 'company' }))));
  }),
);

router.get(
  '/tools/places',
  h(async (req, res) => {
    const place = text(req.query.place, 120, 'place');
    const category = q(req, 'category') || 'catering.cafe';
    if (!I.isPlaceCategory(I.normalizePlaceCategory(category))) throw new HttpError(400, 'category must be a Geoapify category such as catering.cafe.');
    gate(req, 'geoapify', 8, 80);
    res.json(single('geoapify', { ...(await run(I.localBusinesses(place, category, WS('places'), { limit: 20 }))), known: I.PLACE_CATEGORIES }));
  }),
);

// ---- Royal Treasury ----
router.get(
  '/tools/stock',
  h(async (req, res) => {
    const symbol = (q(req, 'symbol') || 'AAPL').toUpperCase();
    if (!I.isTicker(symbol)) throw new HttpError(400, 'symbol must be a stock ticker, e.g. AAPL.');
    gate(req, 'finnhub', 10, 120);
    const c = WS('stock');
    const quote = await run(I.stockQuote(symbol, c));
    const [profile, news] = await Promise.all([section('finnhub', I.companyProfile(symbol, c)), section('finnhub', I.companyNews(symbol, c, 7, 6))]);
    res.json(single('finnhub', { quote, profile, news }));
  }),
);

router.get(
  '/tools/fred',
  h(async (req, res) => {
    const series = (q(req, 'series') || 'CPIAUCSL').toUpperCase();
    if (!I.isSeriesId(series)) throw new HttpError(400, 'series must be a FRED series id, e.g. CPIAUCSL.');
    const limit = q(req, 'limit') ? Math.round(num(q(req, 'limit'), 'limit')) : 60;
    if (limit < 2 || limit > 500) throw new HttpError(400, 'limit must be 2..500.');
    gate(req, 'fred', 15, 200);
    res.json(single('fred', { ...(await run(I.fredSeries(series, WS('fred'), limit))), popular: I.FRED_POPULAR }));
  }),
);

router.get(
  '/tools/fred/search',
  h(async (req, res) => {
    const query = text(req.query.q, 120, 'q');
    gate(req, 'fred', 15, 200);
    res.json(single('fred', await run(I.fredSearch(query, WS('fred-search'), 10))));
  }),
);

router.get(
  '/tools/wolfram',
  h(async (req, res) => {
    const input = text(req.query.q, I.WOLFRAM_MAX_INPUT, 'q');
    gate(req, 'wolfram', 3, 15);
    res.json(single('wolfram', await run(I.askWolfram(input, WS('wolfram'), 3000))));
  }),
);

// ---- Heralds' Tower ----
router.get(
  '/tools/news',
  h(async (req, res) => {
    const query = text(req.query.q, 200, 'q', false);
    const category = (q(req, 'category') || 'general') as I.GnewsCategory;
    if (!I.GNEWS_CATEGORIES.includes(category)) throw new HttpError(400, `category must be one of: ${I.GNEWS_CATEGORIES.join(', ')}.`);
    const ctry = q(req, 'country') ? country(q(req, 'country')).toLowerCase() : undefined;
    const lang = q(req, 'lang') || 'en';
    if (!/^[a-z]{2}$/.test(lang)) throw new HttpError(400, 'lang must be a 2-letter code, e.g. en.');
    gate(req, 'gnews', 5, 30);
    const c = WS('news');
    res.json(single('gnews', await run(query ? I.newsSearch(query, c, { country: ctry, lang }) : I.newsTop(c, { category, country: ctry, lang }))));
  }),
);

router.get(
  '/tools/youtube',
  h(async (req, res) => {
    const query = text(req.query.q, 150, 'q', false);
    const region = country(q(req, 'region'), 'US');
    if (query) gate(req, 'youtube', 2, 8, 'youtube-search');
    else gate(req, 'youtube', 8, 60);
    const c = WS('youtube');
    res.json(single('youtube', await run(query ? I.youtubeSearch(query, c, region, 8) : I.youtubeTrending(c, region, 12))));
  }),
);

// ---- High Court ----
router.get(
  '/tools/cases',
  h(async (req, res) => {
    const query = text(req.query.q, 300, 'q');
    const order = q(req, 'order') === 'newest' ? 'dateFiled desc' : 'score desc';
    gate(req, 'courtlistener', 6, 60);
    res.json(single('courtlistener', await run(I.caseLawSearch(query, WS('cases'), { limit: 10, order }))));
  }),
);

// ================= workshop: Observatory, Apothecary, Arena =================
// ---- Observatory ----
router.get(
  '/tools/space',
  h(async (req, res) => {
    ws(req, 'space', 20);
    const c = WS('space');
    const asteroids = I.enabled('nasa') ? section('nasa', I.nasaAsteroids(c)) : Promise.resolve({ provider: 'nasa', name: I.PROVIDER.nasa.name, ok: false, data: null, error: 'not configured on this server' } as Section<I.AsteroidFeed>);
    const [quakes, iss, neo] = await Promise.all([section('usgs', I.earthquakes(c, '4.5', 'day', 10)), section('wheretheiss', I.issPosition(c)), asteroids]);
    res.json({ quakes, iss, asteroids: neo });
  }),
);

router.get(
  '/tools/apod',
  h(async (req, res) => {
    const date = q(req, 'date') || undefined;
    gate(req, 'nasa', 10, 60);
    res.json(single('nasa', await run(I.nasaApod(WS('apod'), date))));
  }),
);

router.get(
  '/tools/air',
  h(async (req, res) => {
    const city = text(req.query.city, 80, 'city');
    gate(req, 'openaq', 6, 40);
    const c = WS('air');
    const g = await run(I.geocode(city, c, 1));
    const place = g.results[0];
    if (!place) throw new HttpError(404, `No place called “${city}” was found.`);
    res.json(single('openaq', { place, ...(await run(I.airQuality(place.lat, place.lon, c))) }));
  }),
);

// ---- Apothecary (information, not medical advice) ----
router.get(
  '/tools/drug',
  h(async (req, res) => {
    const name = text(req.query.name, 80, 'name');
    ws(req, 'openfda', 20);
    const c = WS('drug');
    const [label, recalls] = await Promise.all([section('openfda', I.drugLabel(name, c, 2)), section('openfda', I.fdaRecalls('drug', c, name, 5))]);
    res.json({ name, note: I.HEALTH_NOTE, label, recalls });
  }),
);

router.get(
  '/tools/recalls',
  h(async (req, res) => {
    const kind = (q(req, 'kind') || 'food') as I.RecallKind;
    if (!I.RECALL_KINDS.includes(kind)) throw new HttpError(400, `kind must be one of: ${I.RECALL_KINDS.join(', ')}.`);
    const query = text(req.query.q, 80, 'q', false) || undefined;
    ws(req, 'openfda', 20);
    res.json(single('openfda', await run(I.fdaRecalls(kind, WS('recalls'), query, 8))));
  }),
);

router.get(
  '/tools/medresearch',
  h(async (req, res) => {
    const query = text(req.query.q, 200, 'q');
    ws(req, 'medresearch', 15);
    const c = WS('medresearch');
    const [papers, trials] = await Promise.all([section('pubmed', I.pubmedSearch(query, c, 6)), section('clinicaltrials', I.trialSearch(query, c, { recruiting: q(req, 'recruiting') === '1', limit: 6 }))]);
    res.json({ query, note: I.HEALTH_NOTE, papers, trials });
  }),
);

// ---- Arena ----
router.get(
  '/tools/football',
  h(async (req, res) => {
    const code = (q(req, 'competition') || 'PL').toUpperCase();
    if (!I.isCompetition(code)) throw new HttpError(400, `competition must be one of: ${Object.keys(I.FOOTBALL_COMPETITIONS).join(', ')}.`);
    gate(req, 'footballdata', 4, 40);
    const c = WS('football');
    const [table, matches] = await Promise.all([section('footballdata', I.footballStandings(code, c)), section('footballdata', I.footballMatches(code, c))]);
    res.json({ code, competitions: I.FOOTBALL_COMPETITIONS, table, matches });
  }),
);

router.get(
  '/tools/screen',
  h(async (req, res) => {
    const query = text(req.query.q, 100, 'q', false);
    const type = q(req, 'type') === 'tv' ? 'tv' : 'movie';
    gate(req, 'tmdb', 15, 150);
    const c = WS('screen');
    res.json(single('tmdb', await run(query ? I.tmdbSearch(query, c, 12) : I.tmdbTrending(c, type, 'week', 12))));
  }),
);

router.get(
  '/tools/music',
  h(async (req, res) => {
    const artist = text(req.query.artist, 100, 'artist', false);
    const country = text(req.query.country, 60, 'country', false) || undefined;
    gate(req, 'lastfm', 12, 120);
    const c = WS('music');
    if (artist) res.json({ kind: 'artist', artist: await section('lastfm', I.artistInfo(artist, c)) });
    else res.json({ kind: 'chart', chart: await section('lastfm', I.musicChart(c, 'tracks', country, 15)) });
  }),
);

router.get(
  '/tools/games',
  h(async (req, res) => {
    const title = text(req.query.title, 100, 'title', false) || undefined;
    ws(req, 'games', 15);
    const c = WS('games');
    const [deals, free] = await Promise.all([section('cheapshark', I.gameDeals(c, title, 8)), title ? Promise.resolve(null) : section('freetogame', I.freeGames(c, { limit: 8 }))]);
    res.json({ title: title ?? null, deals, free });
  }),
);

// ---- Royal Mint (Robinhood Chain, read-only) ----
router.get(
  '/tools/chain/pulse',
  h(async (req, res) => {
    ws(req, 'chain-pulse', 30);
    res.json(single('robinhoodrpc', await run(I.chainPulse(WS('chain-pulse')))));
  }),
);
router.get(
  '/tools/chain/tx',
  h(async (req, res) => {
    const hash = text(req.query.hash, 80, 'hash');
    ws(req, 'chain-tx', 30);
    res.json(single('robinhoodrpc', await run(I.explainTx(hash, WS('chain-tx')))));
  }),
);
router.get(
  '/tools/chain/address',
  h(async (req, res) => {
    const address = text(req.query.address, 60, 'address');
    ws(req, 'chain-address', 20);
    res.json(single('robinhoodrpc', await run(I.inspectAddress(address, WS('chain-address')))));
  }),
);
router.get(
  '/tools/chain/contract',
  h(async (req, res) => {
    const address = text(req.query.address, 60, 'address');
    ws(req, 'chain-contract', 20);
    res.json(single('robinhoodrpc', await run(I.scanContract(address, WS('chain-contract')))));
  }),
);
router.get(
  '/tools/chain/stocks',
  h(async (req, res) => {
    const symbols = q(req, 'symbols').split(',').map((x) => x.trim().toUpperCase()).filter((x) => /^[A-Z.]{1,8}$/.test(x)).slice(0, 20);
    ws(req, 'chain-stocks', 15);
    res.json(single('robinhoodapi', await run(I.stockBoard(WS('chain-stocks'), symbols.length ? symbols : undefined))));
  }),
);
router.get(
  '/tools/chain/agentdom',
  h(async (req, res) => {
    ws(req, 'chain-agentdom', 30);
    res.json(single('dexscreener', await run(I.agentdomStats(WS('chain-agentdom')))));
  }),
);

router.get(
  '/tools/chain/stock',
  h(async (req, res) => {
    const symbol = text(req.query.symbol, 60, 'symbol');
    ws(req, 'chain-stock', 20);
    res.json(single('robinhoodapi', await run(I.stockDetail(symbol, WS('chain-stock')))));
  }),
);
router.get(
  '/tools/chain/actions',
  h(async (req, res) => {
    const symbol = q(req, 'symbol').toUpperCase() || undefined;
    ws(req, 'chain-actions', 20);
    res.json(single('robinhoodapi', await run(I.corporateActions(WS('chain-actions'), symbol, 40))));
  }),
);
router.get(
  '/tools/chain/oracles',
  h(async (req, res) => {
    const k = q(req, 'kind');
    const kind = k === 'stock' || k === 'all' ? k : 'crypto';
    ws(req, 'chain-oracles', 15);
    res.json(single('chainlink', await run(I.oraclePrices(WS('chain-oracles'), kind, 62))));
  }),
);
router.get(
  '/tools/chain/markets',
  h(async (req, res) => {
    ws(req, 'chain-markets', 15);
    res.json(single('geckoterminal', await run(I.marketPulse(WS('chain-markets'), 12))));
  }),
);
