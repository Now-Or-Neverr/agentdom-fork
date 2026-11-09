// Real tools for agents carrying out decrees. Each tool calls a free public API through
// server/integrations (logged to api_calls with ctx { context: 'decree', ref: <decree id> })
// or renders a real file locally, and returns a compact JSON result for Claude.
// Inputs are validated by hand before anything runs (eager input streaming is on, so the
// API does not validate them for us). Failures become is_error tool results, never crashes.
import fs from 'node:fs';
import path from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import * as I from './integrations';
import { publicUrl } from './integrations/keys';
import { UPLOAD_DIR, uid } from './db';
import { addArtifact, listArtifacts } from './artifacts';
import { queueHeraldDraft } from './herald';
import { hostPage } from './builder';
import type { ProvinceId } from '../shared/realm';
import type { DecreeArtifact } from '../shared/types';

/** Bad input from the model: shown to Claude as an error so it can retry. */
export class ToolInputError extends Error {}

/** Per-run counters behind the caps below (free quotas must survive many decrees). */
export interface ToolUsage {
  images: number;
  imageAttempts: number;
  videos: number;
  pages: number;
  searches: number;
  reads: number;
  discoveries: number;
  wolfram: number;
  places: number;
  youtube: number;
  news: number;
  photos: number;
  cutouts: number;
  films: number;
  sites: number;
  audits: number;
  scrapes: number;
  files: number;
  drafts: number;
  translations: number;
  designs: number;
  jobs: number;
  transcripts: number;
  ocr: number;
  scans: number;
  ukSearches: number;
  ukProfiles: number;
  nutrition: number;
  voiceovers: number;
  brands: number;
  space: number;
  health: number;
  sport: number;
  screen: number;
  music: number;
  games: number;
  press: number;
  unsplash: number;
  unsplashUsed: number;
  vulns: number;
  recipes: number;
}
export const newUsage = (): ToolUsage => ({
  images: 0,
  imageAttempts: 0,
  videos: 0,
  pages: 0,
  searches: 0,
  reads: 0,
  discoveries: 0,
  wolfram: 0,
  places: 0,
  youtube: 0,
  news: 0,
  photos: 0,
  cutouts: 0,
  films: 0,
  sites: 0,
  audits: 0,
  scrapes: 0,
  files: 0,
  drafts: 0,
  translations: 0,
  designs: 0,
  jobs: 0,
  transcripts: 0,
  ocr: 0,
  scans: 0,
  ukSearches: 0,
  ukProfiles: 0,
  nutrition: 0,
  voiceovers: 0,
  brands: 0,
  space: 0,
  health: 0,
  sport: 0,
  screen: 0,
  music: 0,
  games: 0,
  press: 0,
  unsplash: 0,
  unsplashUsed: 0,
  vulns: 0,
  recipes: 0,
});

export interface ToolCtx {
  decreeId: string;
  revision: number;
  province: ProvinceId;
  /** Requester id: only for per-user quotas (remove.bg). Never logged or sent to Claude. */
  userId: string;
  /** Owner's charter selection (null = every guild tool). */
  allowed: string[] | null;
  usage: ToolUsage;
}

export interface ToolResult {
  /** Compact JSON-able data handed back to Claude. */
  data: unknown;
  /** One line for the work log. */
  summary: string;
  sourceName?: string | null;
  sourceUrl?: string | null;
  /** Set when the tool produced a file (for the activity feed). */
  produced?: DecreeArtifact['kind'];
  /** Custom activity-feed line ("inspected owner/repo"), shown once per tool per run. */
  activity?: string;
}

interface ToolDef {
  name: string;
  label: string; // human name in the work log
  description: string;
  schema: Anthropic.Beta.BetaTool.InputSchema;
  /** Short live line for decrees.now_doing / the map bubble. */
  doing: (input: Record<string, unknown>) => string;
  run: (input: Record<string, unknown>, c: ToolCtx) => Promise<ToolResult>;
}

// ---------------- input checks ----------------
type O = Record<string, unknown>;
function str(o: O, k: string, max: number, required = true): string {
  const v = o[k];
  if (v === undefined || v === null || v === '') {
    if (required) throw new ToolInputError(`"${k}" is required.`);
    return '';
  }
  if (typeof v !== 'string') throw new ToolInputError(`"${k}" must be a string.`);
  const s = v.trim();
  if (required && !s) throw new ToolInputError(`"${k}" must not be empty.`);
  if (s.length > max) throw new ToolInputError(`"${k}" is too long (max ${max} characters).`);
  return s;
}
function num(o: O, k: string, min: number, max: number, def?: number): number {
  const v = o[k];
  if (v === undefined || v === null) {
    if (def === undefined) throw new ToolInputError(`"${k}" is required.`);
    return def;
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new ToolInputError(`"${k}" must be a number.`);
  if (v < min || v > max) throw new ToolInputError(`"${k}" must be between ${min} and ${max}.`);
  return v;
}
function oneOf<T extends string>(o: O, k: string, values: readonly T[], def?: T): T {
  const v = o[k];
  if (v === undefined || v === null || v === '') {
    if (def === undefined) throw new ToolInputError(`"${k}" is required.`);
    return def;
  }
  if (typeof v !== 'string' || !values.includes(v as T)) throw new ToolInputError(`"${k}" must be one of: ${values.join(', ')}.`);
  return v as T;
}
function strList(o: O, k: string, maxItems: number, maxLen: number, required = true): string[] {
  const v = o[k];
  if (v === undefined || v === null) {
    if (required) throw new ToolInputError(`"${k}" is required.`);
    return [];
  }
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw new ToolInputError(`"${k}" must be an array of strings.`);
  if (v.length > maxItems) throw new ToolInputError(`"${k}" may have at most ${maxItems} items.`);
  return (v as string[]).map((s) => s.trim().slice(0, maxLen));
}
const q = (s: string, n = 48) => `“${s.length > n ? s.slice(0, n - 1) + '…' : s}”`;
const ctxOf = (c: ToolCtx): I.CallContext => ({ context: 'decree', ref: c.decreeId });
const name = (provider: string) => I.PROVIDER[provider]?.name ?? provider;
const obj = (props: Record<string, unknown>, required: string[]): Anthropic.Beta.BetaTool.InputSchema => ({
  type: 'object',
  properties: props,
  required,
  additionalProperties: false,
});

/** One-sentence alt text from Cloudflare's vision model; null when it is unavailable (never throws). */
async function altText(url: string, c: ToolCtx): Promise<string | null> {
  if (!I.cfEnabled()) return null;
  try {
    return (await I.cfAltText(url, ctxOf(c))).alt || null;
  } catch {
    return null;
  }
}
const imageCount = (decreeId: string) => listArtifacts(decreeId).filter((a) => a.kind === 'image').length;
/** An image artifact of this decree by its /uploads url, or a ToolInputError. */
function myImage(c: ToolCtx, url: string): DecreeArtifact {
  const a = listArtifacts(c.decreeId).find((x) => x.kind === 'image' && x.url === url.split('?')[0]);
  if (!a) throw new ToolInputError(`${url.slice(0, 80)} is not an image made for this decree. Use a url returned by generate_image or use_stock_photo.`);
  return a;
}
const intList = (o: O, k: string, maxItems: number): number[] => {
  const v = o[k];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'number' || !Number.isInteger(x) || x <= 0)) throw new ToolInputError(`"${k}" must be an array of positive integer ids.`);
  if (v.length > maxItems) throw new ToolInputError(`"${k}" may have at most ${maxItems} items.`);
  return v as number[];
};
const clip = (s: string | null | undefined, n: number) => (s ? (s.length > n ? s.slice(0, n - 1) + '…' : s) : s ?? null);
/** Lines prefixed with their number so findings can link to #L<n>. */
function numbered(text: string, maxChars: number): { text: string; lines: number; shownLines: number } {
  const all = text.split(/\r?\n/);
  const out: string[] = [];
  let len = 0;
  for (let k = 0; k < all.length; k++) {
    const line = `${k + 1}| ${all[k]}`;
    if (len + line.length > maxChars) break;
    out.push(line);
    len += line.length + 1;
  }
  return { text: out.join('\n'), lines: all.length, shownLines: out.length };
}
const ghRepo = (s: string) => {
  try {
    return I.parseGithubRepo(s);
  } catch (e) {
    throw new ToolInputError((e as Error).message);
  }
};
const safeHttp = (s: string, k = 'url') => {
  if (!/^https?:\/\/[^\s]+$/i.test(s)) throw new ToolInputError(`"${k}" must be a full http(s) URL.`);
  return s;
};

/** A file artifact of this decree (of the given kinds) by its /uploads url, or a ToolInputError. */
function myMedia(c: ToolCtx, url: string, kinds: DecreeArtifact['kind'][]): DecreeArtifact {
  const a = listArtifacts(c.decreeId).find((x) => kinds.includes(x.kind) && x.url === url.split('?')[0]);
  if (!a) throw new ToolInputError(`${url.slice(0, 80)} is not a ${kinds.join('/')} file made for this decree. Use a public link or a url a tool returned in this decree.`);
  return a;
}
/** A public link a server may fetch, or a ToolInputError. */
const publicLink = (s: string) => {
  try {
    return publicUrl(s);
  } catch (e) {
    throw new ToolInputError((e as Error).message);
  }
};
/** Save a UTF-8 text file (transcript, subtitles) under data/uploads. */
function saveText(prefix: string, ext: 'txt' | 'srt', text: string): { url: string; bytes: number } {
  const name = `${prefix}-${uid(prefix).slice(prefix.length + 1)}.${ext}`;
  const buf = Buffer.from(text, 'utf8');
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  return { url: `/uploads/${name}`, bytes: buf.length };
}
const pngSize = (b: Buffer) => (b.length > 24 && b.subarray(12, 16).toString('latin1') === 'IHDR' ? { w: b.readUInt32BE(16), h: b.readUInt32BE(20) } : null);

// ---------------- limits ----------------
const IMAGE_LIMIT: Partial<Record<ProvinceId, number>> = { atelier: 3, theatre: 4, heralds: 2 };
const IMAGE_MAX_WAIT_MS = 240_000; // free tier spaces images ~47 s apart; give up beyond this queue
const HTML_MAX = 150_000;

const ASPECT = { landscape: [1280, 720], square: [1024, 1024], portrait: [768, 1152] } as const;

// ---------------- tools ----------------
// ---------------- Observatory, Apothecary, Arena + newspaper/photo/vuln/recipe tools ----------------
const HEALTH_NOTE = 'Information, not medical advice.';
const health = <T extends object>(d: T) => ({ ...d, note: HEALTH_NOTE + ' Tell the requester to talk to a doctor or pharmacist before acting on it.' });
const optStr = (o: O, k: string, max: number) => str(o, k, max, false) || undefined;
function cap(c: ToolCtx, k: keyof ToolUsage, max: number, what: string) {
  if (c.usage[k] >= max) throw new ToolInputError(`${what} limit reached (${max} per decree). Work with the results you have.`);
  c.usage[k]++;
}

function NEW_GUILD_TOOLS(): ToolDef[] {
  return [
    // ---- Observatory (space & earth) ----
    {
      name: 'nasa_apod',
      label: 'NASA picture of the day',
      description: 'NASA Astronomy Picture of the Day (today or a YYYY-MM-DD date since 1995-06-16): title, explanation, image url, copyright and the apod.nasa.gov page. The APOD service is sometimes down; if this fails, say so and use nasa_images instead. Max 6 space calls per decree (shared with near_earth_asteroids and nasa_images).',
      schema: obj({ date: { type: 'string', description: 'Optional YYYY-MM-DD.' } }, []),
      doing: () => 'Opening NASA’s picture of the day',
      run: async (i, c) => {
        const date = optStr(i, 'date', 10);
        cap(c, 'space', 6, 'Space data');
        const r = await I.nasaApod(ctxOf(c), date);
        return { data: r, summary: `APOD ${r.date}: “${clip(r.title, 60)}”`, sourceName: name('nasa'), sourceUrl: r.sourceUrl };
      },
    },
    {
      name: 'near_earth_asteroids',
      label: 'Near-Earth asteroids',
      description: 'Asteroids passing Earth on a date range (NASA NeoWs, max 7 days): name, closest approach time, miss distance (km and lunar distances), speed, estimated diameter, potentially-hazardous flag and JPL link. Closest first. "Potentially hazardous" is an orbit class, not a prediction of impact.',
      schema: obj({ start: { type: 'string', description: 'YYYY-MM-DD, default today.' }, end: { type: 'string', description: 'YYYY-MM-DD, 0-7 days after start, default = start.' } }, []),
      doing: () => 'Tracking near-Earth asteroids',
      run: async (i, c) => {
        cap(c, 'space', 6, 'Space data');
        const r = await I.nasaAsteroids(ctxOf(c), optStr(i, 'start', 10), optStr(i, 'end', 10), 10);
        return { data: r, summary: `${r.count} asteroids pass Earth ${r.start}${r.end !== r.start ? '..' + r.end : ''}`, sourceName: name('nasa'), sourceUrl: r.sourceUrl };
      },
    },
    {
      name: 'nasa_images',
      label: 'NASA image search',
      description: 'Search the NASA Image and Video Library (public NASA images): title, date, centre, credit, short description, thumbnail and the images.nasa.gov page.',
      schema: obj({ query: { type: 'string', description: 'e.g. "Saturn rings", "Artemis launch".' } }, ['query']),
      doing: (i) => `Searching NASA images for ${q(String(i.query))}`,
      run: async (i, c) => {
        const query = str(i, 'query', 120);
        cap(c, 'space', 6, 'Space data');
        const r = await I.nasaImages(query, ctxOf(c), 8);
        return { data: r, summary: `${r.results.length} NASA images for ${q(query)}`, sourceName: name('nasaimages'), sourceUrl: r.sourceUrl };
      },
    },
    {
      name: 'earthquakes',
      label: 'Recent earthquakes',
      description: `Recent earthquakes from the USGS live feeds: magnitude, place, time (UTC), depth, coordinates, tsunami flag, PAGER alert and the USGS event page. level: ${I.QUAKE_LEVELS.join(', ')} (minimum magnitude, or "significant"); period: ${I.QUAKE_PERIODS.join(', ')}. Newest first.`,
      schema: obj({ level: { type: 'string', enum: [...I.QUAKE_LEVELS], description: 'Default 4.5.' }, period: { type: 'string', enum: [...I.QUAKE_PERIODS], description: 'Default day.' } }, []),
      doing: () => 'Reading the USGS earthquake feed',
      run: async (i, c) => {
        const level = oneOf(i, 'level', I.QUAKE_LEVELS, '4.5');
        const period = oneOf(i, 'period', I.QUAKE_PERIODS, 'day');
        cap(c, 'space', 6, 'Space data');
        const r = await I.earthquakes(ctxOf(c), level, period, 12);
        return { data: r, summary: `${r.count} earthquakes (${r.feed})${r.quakes[0] ? `, latest M${r.quakes[0].magnitude} ${clip(r.quakes[0].place, 50)}` : ''}`, sourceName: name('usgs'), sourceUrl: r.sourceUrl };
      },
    },
    {
      name: 'iss_position',
      label: 'ISS position',
      description: 'Where the International Space Station is right now: latitude, longitude, altitude, speed, whether it is in daylight, and an OpenStreetMap link.',
      schema: obj({}, []),
      doing: () => 'Locating the International Space Station',
      run: async (_i, c) => {
        cap(c, 'space', 6, 'Space data');
        const r = await I.issPosition(ctxOf(c));
        return { data: r, summary: `ISS at ${r.lat}, ${r.lon} · ${r.altitudeKm} km up`, sourceName: name('wheretheiss'), sourceUrl: r.sourceUrl };
      },
    },
    {
      name: 'air_quality',
      label: 'Air quality',
      description: 'Latest air-quality readings (PM2.5, PM10, O3, NO2… with units and time) from the nearest OpenAQ monitoring station that reported in the last 3 days, within 25 km of a named place. Say which station and how far away it is; low-cost sensors can be less accurate than official monitors. Shares the 6-call space budget.',
      schema: obj({ place: { type: 'string', description: 'City or place, e.g. "Jakarta", "Delhi".' } }, ['place']),
      doing: (i) => `Checking the air in ${q(String(i.place), 30)}`,
      run: async (i, c) => {
        const place = str(i, 'place', 100);
        cap(c, 'space', 6, 'Space data');
        const g = await I.geocode(place, ctxOf(c), 1);
        const p = g.results[0];
        if (!p) throw new ToolInputError(`Open-Meteo found no place called ${q(place, 60)}.`);
        const r = await I.airQuality(p.lat, p.lon, ctxOf(c));
        return {
          data: { place: [p.name, p.admin, p.country].filter(Boolean).join(', '), ...r },
          summary: `${r.station} (${r.distanceKm} km from ${p.name}): ${r.readings.map((x) => `${x.label} ${x.value} ${x.units}`).slice(0, 3).join(', ') || 'no fresh readings'}`,
          sourceName: name('openaq'),
          sourceUrl: r.sourceUrl,
        };
      },
    },

    // ---- Apothecary (health & life science). Every result carries "Information, not medical advice." ----
    {
      name: 'drug_label',
      label: 'Drug label',
      description: 'Official US FDA drug label (openFDA) by brand or generic name: purpose, indications, boxed warning, warnings, dosage (as printed on the label), manufacturer and the DailyMed page. Quote the label, do not invent doses. Information, not medical advice. Max 6 health lookups per decree.',
      schema: obj({ name: { type: 'string', description: 'Brand or generic name, e.g. "ibuprofen", "Lipitor".' } }, ['name']),
      doing: (i) => `Reading the FDA label for ${q(String(i.name), 30)}`,
      run: async (i, c) => {
        const n = str(i, 'name', 80);
        cap(c, 'health', 6, 'Health lookup');
        const r = await I.drugLabel(n, ctxOf(c), 3);
        return { data: health(r), summary: `${r.results.length} FDA labels for ${q(n)} · ${HEALTH_NOTE}`, sourceName: name('openfda'), sourceUrl: r.results[0]?.url ?? r.sourceUrl };
      },
    },
    {
      name: 'fda_recalls',
      label: 'FDA recalls',
      description: `Newest FDA enforcement reports (recalls) for ${I.RECALL_KINDS.join(', ')}: product, reason, firm, class (I = most serious), status, distribution and dates. Optional words to match product, reason or firm. Information, not medical advice.`,
      schema: obj({ kind: { type: 'string', enum: [...I.RECALL_KINDS], description: 'Default drug.' }, query: { type: 'string', description: 'Optional words, e.g. "peanut", "insulin pump".' } }, []),
      doing: (i) => `Checking FDA ${String(i.kind ?? 'drug')} recalls`,
      run: async (i, c) => {
        const kind = oneOf(i, 'kind', I.RECALL_KINDS, 'drug');
        const query = optStr(i, 'query', 80);
        cap(c, 'health', 6, 'Health lookup');
        const r = await I.fdaRecalls(kind, ctxOf(c), query, 8);
        return { data: health(r), summary: `${r.results.length} ${kind} recalls${query ? ` for ${q(query)}` : ''} · ${HEALTH_NOTE}`, sourceName: name('openfda'), sourceUrl: r.sourceUrl };
      },
    },
    {
      name: 'pubmed_search',
      label: 'PubMed search',
      description: 'Search PubMed biomedical literature: title, journal, date, authors, DOI, publication type (Review, RCT…) and PubMed link. Prefer reviews and trials; one paper is not a consensus. Information, not medical advice.',
      schema: obj({ query: { type: 'string', description: 'PubMed query, e.g. "intermittent fasting type 2 diabetes".' }, sort: { type: 'string', enum: ['relevance', 'date'], description: 'Default relevance.' } }, ['query']),
      doing: (i) => `Searching PubMed for ${q(String(i.query))}`,
      run: async (i, c) => {
        const query = str(i, 'query', 200);
        const sort = oneOf(i, 'sort', ['relevance', 'date'] as const, 'relevance');
        cap(c, 'health', 6, 'Health lookup');
        const r = await I.pubmedSearch(query, ctxOf(c), 8, sort);
        return { data: health(r), summary: `${r.results.length} of ${r.total.toLocaleString('en')} PubMed papers for ${q(query)} · ${HEALTH_NOTE}`, sourceName: name('pubmed'), sourceUrl: r.sourceUrl };
      },
    },
    {
      name: 'clinical_trials',
      label: 'Clinical trials',
      description: 'Search ClinicalTrials.gov for registered studies on a condition, drug or keyword: NCT id, title, status, phase, conditions, sponsor, start date, enrollment and study page. recruiting=true shows only studies recruiting now. Information, not medical advice; eligibility is decided by the study team.',
      schema: obj({ query: { type: 'string', description: 'e.g. "psoriasis", "semaglutide".' }, recruiting: { type: 'boolean', description: 'Only recruiting studies. Default false.' } }, ['query']),
      doing: (i) => `Searching clinical trials for ${q(String(i.query))}`,
      run: async (i, c) => {
        const query = str(i, 'query', 200);
        if (i.recruiting !== undefined && typeof i.recruiting !== 'boolean') throw new ToolInputError('"recruiting" must be true or false.');
        cap(c, 'health', 6, 'Health lookup');
        const r = await I.trialSearch(query, ctxOf(c), { recruiting: i.recruiting === true, limit: 8 });
        return { data: health(r), summary: `${r.results.length} of ${r.total.toLocaleString('en')} trials for ${q(query)} · ${HEALTH_NOTE}`, sourceName: name('clinicaltrials'), sourceUrl: r.sourceUrl };
      },
    },

    // ---- Arena (sport, film, music, games) ----
    {
      name: 'football_table',
      label: 'Football table',
      description: 'Current league table from football-data.org for one competition code: ' + Object.entries(I.FOOTBALL_COMPETITIONS).map(([k, v]) => `${k} = ${v}`).join('; ') + '. Max 4 football calls per decree.',
      schema: obj({ competition: { type: 'string', enum: Object.keys(I.FOOTBALL_COMPETITIONS), description: 'Competition code, default PL.' } }, []),
      doing: (i) => `Reading the ${String(i.competition ?? 'PL')} table`,
      run: async (i, c) => {
        const code = oneOf(i, 'competition', Object.keys(I.FOOTBALL_COMPETITIONS), 'PL');
        cap(c, 'sport', 4, 'Football');
        const r = await I.footballStandings(code, ctxOf(c));
        const { table, ...rest } = r;
        return { data: { ...rest, table: table.map(({ crest: _c, ...t }) => t) }, summary: `${r.competition}${r.table[0] ? `: ${r.table[0].team} lead on ${r.table[0].points} pts` : ''}`, sourceName: name('footballdata'), sourceUrl: r.sourceUrl };
      },
    },
    {
      name: 'football_matches',
      label: 'Football fixtures',
      description: 'Results and fixtures of one competition (same codes as football_table) from 3 days ago to 4 days ahead: date (UTC), status, teams and full-time score.',
      schema: obj({ competition: { type: 'string', enum: Object.keys(I.FOOTBALL_COMPETITIONS), description: 'Competition code, default PL.' } }, []),
      doing: (i) => `Checking ${String(i.competition ?? 'PL')} fixtures`,
      run: async (i, c) => {
        const code = oneOf(i, 'competition', Object.keys(I.FOOTBALL_COMPETITIONS), 'PL');
        cap(c, 'sport', 4, 'Football');
        const r = await I.footballMatches(code, ctxOf(c));
        return { data: r, summary: `${r.matches.length} ${r.competition} matches ${r.from}..${r.to}`, sourceName: name('footballdata'), sourceUrl: r.sourceUrl };
      },
    },
    {
      name: 'film_search',
      label: 'Film & TV search',
      description: 'Search films and TV shows on TMDB: title, type, release date, short overview, TMDB user score, votes and themoviedb.org link. Credit "Data: TMDB" in the result. Max 4 film calls per decree.',
      schema: obj({ query: { type: 'string', description: 'Title, e.g. "Dune", "The Bear".' } }, ['query']),
      doing: (i) => `Looking up ${q(String(i.query))} on TMDB`,
      run: async (i, c) => {
        const query = str(i, 'query', 100);
        cap(c, 'screen', 4, 'Film');
        const r = await I.tmdbSearch(query, ctxOf(c), 8);
        return { data: { ...r, results: r.results.map(({ poster: _p, ...t }) => t) }, summary: `${r.results.length} TMDB titles for ${q(query)}`, sourceName: name('tmdb'), sourceUrl: r.sourceUrl };
      },
    },
    {
      name: 'film_trending',
      label: 'Trending films & TV',
      description: 'What is trending on TMDB this week (or today): films or TV shows with date, overview, score and link. Credit "Data: TMDB" in the result.',
      schema: obj({ type: { type: 'string', enum: ['movie', 'tv'], description: 'Default movie.' }, window: { type: 'string', enum: ['day', 'week'], description: 'Default week.' } }, []),
      doing: (i) => `Checking trending ${i.type === 'tv' ? 'TV' : 'films'} on TMDB`,
      run: async (i, c) => {
        const type = oneOf(i, 'type', ['movie', 'tv'] as const, 'movie');
        const window = oneOf(i, 'window', ['day', 'week'] as const, 'week');
        cap(c, 'screen', 4, 'Film');
        const r = await I.tmdbTrending(ctxOf(c), type, window, 10);
        return { data: { ...r, results: r.results.map(({ poster: _p, ...t }) => t) }, summary: `${r.results.length} trending ${type === 'tv' ? 'shows' : 'films'} (${window})`, sourceName: name('tmdb'), sourceUrl: r.sourceUrl };
      },
    },
    {
      name: 'music_charts',
      label: 'Music charts',
      description: 'Last.fm top tracks or artists, worldwide or for one country (English country name, e.g. "Indonesia", "Brazil"), with listener counts and Last.fm links. Last.fm charts reflect its own users’ scrobbles, not sales. Max 4 music calls per decree.',
      schema: obj({ kind: { type: 'string', enum: ['tracks', 'artists'], description: 'Default tracks.' }, country: { type: 'string', description: 'Optional country name.' } }, []),
      doing: (i) => `Reading the Last.fm ${String(i.kind ?? 'tracks')} chart`,
      run: async (i, c) => {
        const kind = oneOf(i, 'kind', ['tracks', 'artists'] as const, 'tracks');
        const country = optStr(i, 'country', 60);
        cap(c, 'music', 4, 'Music');
        const r = await I.musicChart(ctxOf(c), kind, country, 10);
        return { data: r, summary: `Last.fm top ${kind}${country ? ` in ${country}` : ''}: ${r.results[0]?.name ?? 'none'}`, sourceName: name('lastfm'), sourceUrl: r.sourceUrl };
      },
    },
    {
      name: 'music_artist',
      label: 'Music artist',
      description: 'One artist: Last.fm listeners, plays, tags, similar artists and short bio, plus MusicBrainz identity (type, country, active years) when found.',
      schema: obj({ artist: { type: 'string', description: 'Artist name, e.g. "Radiohead".' } }, ['artist']),
      doing: (i) => `Looking up ${q(String(i.artist))}`,
      run: async (i, c) => {
        const artist = str(i, 'artist', 100);
        cap(c, 'music', 4, 'Music');
        const r = await I.artistInfo(artist, ctxOf(c));
        return { data: r, summary: `${r.name}: ${r.listeners.toLocaleString('en')} Last.fm listeners`, sourceName: name('lastfm'), sourceUrl: r.sourceUrl };
      },
    },
    {
      name: 'game_deals',
      label: 'Game deals',
      description: 'PC game prices from CheapShark (USD). Without a title: the best-rated current deals (store, sale and normal price, savings, Metacritic). With a title: the cheapest current price per matching game. Deals can end at any time. Max 4 game calls per decree.',
      schema: obj({ title: { type: 'string', description: 'Optional game title.' } }, []),
      doing: (i) => (i.title ? `Pricing ${q(String(i.title))}` : 'Hunting for game deals'),
      run: async (i, c) => {
        const title = optStr(i, 'title', 100);
        cap(c, 'games', 4, 'Games');
        const r = await I.gameDeals(ctxOf(c), title, 8);
        return { data: r, summary: `${r.results.length} game prices${title ? ` for ${q(title)}` : ''}`, sourceName: name('cheapshark'), sourceUrl: r.sourceUrl };
      },
    },
    {
      name: 'free_games',
      label: 'Free-to-play games',
      description: 'Free-to-play games from FreeToGame: title, genre, platform, publisher, release date, short description and link. Optional platform (all, pc, browser), genre tag (e.g. shooter, mmorpg, strategy, moba, racing, card) and sort (popularity or release-date). Credit "Data from FreeToGame.com".',
      schema: obj(
        { platform: { type: 'string', enum: [...I.FREE_GAME_PLATFORMS], description: 'Default all.' }, category: { type: 'string', description: 'Optional genre tag.' }, sort: { type: 'string', enum: ['popularity', 'release-date'], description: 'Default popularity.' } },
        [],
      ),
      doing: () => 'Browsing free-to-play games',
      run: async (i, c) => {
        const platform = oneOf(i, 'platform', I.FREE_GAME_PLATFORMS, 'all');
        const sort = oneOf(i, 'sort', ['popularity', 'release-date'] as const, 'popularity');
        cap(c, 'games', 4, 'Games');
        const r = await I.freeGames(ctxOf(c), { platform, category: optStr(i, 'category', 30), sort, limit: 10 });
        return { data: { ...r, results: r.results.map(({ thumb: _t, ...g }) => g) }, summary: `${r.results.length} free games (${r.total} matching)`, sourceName: name('freetogame'), sourceUrl: r.sourceUrl };
      },
    },

    // ---- newspapers (Heralds, Archive): headline + short summary + link only ----
    {
      name: 'guardian_news',
      label: 'The Guardian',
      description: 'Guardian articles: with a query, newest matches; without, the latest in a section (e.g. world, technology, business, sport, environment). Returns headline, short trail, section, byline, date and link ONLY. Never reproduce article text beyond that; link back. Max 4 newspaper calls per decree.',
      schema: obj({ query: { type: 'string', description: 'Optional search words.' }, section: { type: 'string', description: 'Optional Guardian section id.' } }, []),
      doing: (i) => (i.query ? `Searching the Guardian for ${q(String(i.query))}` : 'Reading the Guardian'),
      run: async (i, c) => {
        const query = optStr(i, 'query', 200);
        const section = optStr(i, 'section', 40);
        cap(c, 'press', 4, 'Newspaper');
        const r = await I.guardianSearch(ctxOf(c), { query, section, limit: 8 });
        return { data: r, summary: `${r.results.length} Guardian headlines${query ? ` for ${q(query)}` : ''}`, sourceName: name('guardian'), sourceUrl: r.sourceUrl };
      },
    },
    {
      name: 'nyt_news',
      label: 'The New York Times',
      description: `New York Times articles. mode "top" = top stories of a section (${I.NYT_SECTIONS.join(', ')}); "search" = newest articles matching a query; "popular" = most viewed in the last day. Returns headline, abstract, byline, date and link ONLY; link back for the full story. The NYT allows few calls, so max 4 newspaper calls per decree.`,
      schema: obj({ mode: { type: 'string', enum: ['top', 'search', 'popular'], description: 'Default top.' }, section: { type: 'string', enum: [...I.NYT_SECTIONS], description: 'For top. Default home.' }, query: { type: 'string', description: 'For search.' } }, []),
      doing: (i) => (i.query ? `Searching the NYT for ${q(String(i.query))}` : 'Reading the New York Times'),
      run: async (i, c) => {
        const mode = oneOf(i, 'mode', ['top', 'search', 'popular'] as const, i.query ? 'search' : 'top');
        const section = oneOf(i, 'section', I.NYT_SECTIONS, 'home');
        const query = optStr(i, 'query', 200);
        if (mode === 'search' && !query) throw new ToolInputError('"query" is required for mode "search".');
        cap(c, 'press', 4, 'Newspaper');
        const r = mode === 'search' ? await I.nytSearch(query!, ctxOf(c), 8) : mode === 'popular' ? await I.nytMostPopular(ctxOf(c), 1, 8) : await I.nytTopStories(ctxOf(c), section, 8);
        return { data: r, summary: `${r.results.length} NYT ${mode === 'top' ? `${section} top stories` : mode === 'popular' ? 'most viewed' : `articles for ${q(query!)}`}`, sourceName: name('nyt'), sourceUrl: r.sourceUrl };
      },
    },
    {
      name: 'nyt_bestsellers',
      label: 'NYT bestsellers',
      description: 'Current New York Times bestseller list: rank, weeks on list, title, author, publisher and short description. list e.g. hardcover-fiction, hardcover-nonfiction, trade-fiction-paperback, young-adult-hardcover, advice-how-to-and-miscellaneous.',
      schema: obj({ list: { type: 'string', description: 'Default hardcover-fiction.' } }, []),
      doing: () => 'Reading the NYT bestseller list',
      run: async (i, c) => {
        const list = optStr(i, 'list', 60) ?? 'hardcover-fiction';
        cap(c, 'press', 4, 'Newspaper');
        const r = await I.nytBestsellers(ctxOf(c), list, 10);
        return { data: r, summary: `${r.listName} (${r.published ?? '?'}): #1 ${r.books[0]?.title ?? 'none'}`, sourceName: name('nyt'), sourceUrl: r.sourceUrl };
      },
    },

    // ---- Atelier: Unsplash ----
    {
      name: 'unsplash_photos',
      label: 'Unsplash search',
      description: 'Search free Unsplash photos: id, description, size, colour, photographer and photo page. Then call use_unsplash_photo with an id to put it in the decree. The realm has a small hourly Unsplash allowance, so search at most twice per decree.',
      schema: obj({ query: { type: 'string', description: 'Search words in English.' }, orientation: { type: 'string', enum: ['landscape', 'portrait', 'squarish'], description: 'Optional.' } }, ['query']),
      doing: (i) => `Searching Unsplash for ${q(String(i.query))}`,
      run: async (i, c) => {
        const query = str(i, 'query', 100);
        const orientation = i.orientation === undefined || i.orientation === null || i.orientation === '' ? undefined : oneOf(i, 'orientation', ['landscape', 'portrait', 'squarish'] as const);
        cap(c, 'unsplash', 2, 'Unsplash search');
        let r: I.UnsplashSearch;
        try {
          r = await I.unsplashSearch(query, ctxOf(c), { perPage: 8, orientation });
        } catch (e) {
          if (e instanceof I.QuotaError) throw new ToolInputError(e.message);
          throw e;
        }
        unsplashSeen.set(c.decreeId, [...(unsplashSeen.get(c.decreeId) ?? []), ...r.results].slice(-40));
        if (unsplashSeen.size > 200) unsplashSeen.delete(unsplashSeen.keys().next().value as string);
        return {
          data: { total: r.total, results: r.results.map((p) => ({ id: p.id, description: p.description, width: p.width, height: p.height, color: p.color, photographer: p.photographer, pageUrl: p.pageUrl })) },
          summary: `${r.results.length} Unsplash photos for ${q(query)}`,
          sourceName: name('unsplash'),
          sourceUrl: r.sourceUrl,
        };
      },
    },
    {
      name: 'use_unsplash_photo',
      label: 'Unsplash photo',
      description: 'Put one Unsplash photo (id from unsplash_photos in this decree) into the decree gallery with alt text and the required credit "Photo by <name> on Unsplash" (with links). Up to 3 per decree. Always show that credit with the photo in your result.',
      schema: obj({ id: { type: 'string', description: 'Unsplash photo id.' }, title: { type: 'string', description: 'Short caption for the gallery.' } }, ['id', 'title']),
      doing: () => 'Fetching an Unsplash photo',
      run: async (i, c) => {
        const id = str(i, 'id', 40);
        const title = str(i, 'title', 100);
        const p = (unsplashSeen.get(c.decreeId) ?? []).find((x) => x.id === id);
        if (!p) throw new ToolInputError('Unknown Unsplash id. Use an id returned by unsplash_photos in this decree.');
        cap(c, 'unsplashUsed', 3, 'Unsplash photo');
        try {
          await I.unsplashTrackDownload(p.downloadLocation, ctxOf(c));
        } catch (e) {
          if (e instanceof I.QuotaError) throw new ToolInputError(e.message);
          throw e;
        }
        const alt = (await altText(p.regular, c)) ?? (p.description || null);
        const n = imageCount(c.decreeId) + 1;
        const credit = { author: p.photographer, authorUrl: p.photographerUrl, pageUrl: p.pageUrl, license: 'Unsplash License', licenseUrl: 'https://unsplash.com/license' };
        addArtifact(c.decreeId, c.revision, { kind: 'image', url: p.regular, title, meta: { provider: 'Unsplash', width: p.width, height: p.height, sourceUrl: p.pageUrl, alt, credit } });
        return {
          data: { image_number: n, url: p.regular, alt, credit, note: `Saved as Image ${n}. Credit: ${p.credit} (${p.photographerUrl}, ${p.pageUrl}).` },
          summary: `Saved Unsplash photo by ${p.photographer} as Image ${n}`,
          sourceName: name('unsplash'),
          sourceUrl: p.pageUrl,
          produced: 'image',
        };
      },
    },

    // ---- Forge: OSV ----
    {
      name: 'check_vulnerabilities',
      label: 'Vulnerability check',
      description: `Known security vulnerabilities for one open-source package version from OSV.dev (ecosystems: ${I.OSV_ECOSYSTEMS.join(', ')}): id, CVE aliases, summary, severity, fixed versions and osv.dev link. No version = every known vuln for the package. Max 8 per decree. "No known vulnerabilities" is not proof the code is safe.`,
      schema: obj(
        { package: { type: 'string', description: 'Package name, e.g. "lodash", "requests".' }, ecosystem: { type: 'string', enum: [...I.OSV_ECOSYSTEMS], description: 'Default npm.' }, version: { type: 'string', description: 'Exact version, e.g. "4.17.15".' } },
        ['package'],
      ),
      doing: (i) => `Checking ${String(i.package ?? '').slice(0, 40)}${i.version ? '@' + String(i.version).slice(0, 20) : ''} for vulnerabilities`,
      run: async (i, c) => {
        const pkg = str(i, 'package', 200);
        const eco = oneOf(i, 'ecosystem', I.OSV_ECOSYSTEMS, 'npm');
        const version = optStr(i, 'version', 60);
        cap(c, 'vulns', 8, 'Vulnerability check');
        const r = await I.osvQuery(pkg, eco, ctxOf(c), version);
        return { data: r, summary: `${pkg}${version ? '@' + version : ''} (${eco}): ${r.count} known vulnerabilities`, sourceName: name('osv'), sourceUrl: r.sourceUrl };
      },
    },

    // ---- Bazaar: TheMealDB ----
    {
      name: 'recipe_search',
      label: 'Recipe search',
      description: 'Recipes from TheMealDB by dish name: category, cuisine, ingredients with measures, method, photo, video and page link. Coverage is limited (a few hundred dishes); say when nothing is found. Max 3 per decree.',
      schema: obj({ dish: { type: 'string', description: 'Dish name, e.g. "rendang", "lasagne".' } }, ['dish']),
      doing: (i) => `Looking up recipes for ${q(String(i.dish))}`,
      run: async (i, c) => {
        const dish = str(i, 'dish', 80);
        cap(c, 'recipes', 3, 'Recipe');
        const r = await I.mealSearch(dish, ctxOf(c), 3);
        return { data: r, summary: `${r.results.length} recipes for ${q(dish)}`, sourceName: name('themealdb'), sourceUrl: r.sourceUrl };
      },
    },
  ];
}
// Unsplash results seen per decree, so use_unsplash_photo needs no extra search call.
const unsplashSeen = new Map<string, I.UnsplashPhoto[]>();

const TOOLS: ToolDef[] = [
  {
    name: 'wiki_search',
    label: 'Wikipedia search',
    description:
      'Full-text search of English Wikipedia. Call this whenever the decree needs facts about people, places, organisations, history, science or definitions you should verify. Returns up to 6 page titles with short snippets and URLs. Follow up with wiki_summary on the best title.',
    schema: obj({ query: { type: 'string', description: 'Search words, e.g. "lithium iron phosphate battery".' } }, ['query']),
    doing: (i) => `Searching Wikipedia for ${q(String(i.query))}`,
    run: async (i, c) => {
      const query = str(i, 'query', 200);
      const r = await I.wikiSearch(query, ctxOf(c), 6);
      return { data: { total: r.total, results: r.results, source: r.sourceUrl }, summary: `${r.results.length} pages for ${q(query)}`, sourceName: 'Wikipedia', sourceUrl: r.sourceUrl };
    },
  },
  {
    name: 'wiki_summary',
    label: 'Wikipedia summary',
    description: 'Lead summary (about 900 characters) of one English Wikipedia page by its exact title. Use after wiki_search, or when you know the exact page title. Cite the returned url.',
    schema: obj({ title: { type: 'string', description: 'Exact page title, e.g. "Solid-state battery".' } }, ['title']),
    doing: (i) => `Reading Wikipedia: ${q(String(i.title))}`,
    run: async (i, c) => {
      const title = str(i, 'title', 200);
      const r = await I.wikiSummary(title, ctxOf(c));
      if (!r) throw new ToolInputError(`No English Wikipedia page is titled ${q(title, 80)}. Use wiki_search to find the right title.`);
      return { data: { title: r.title, description: r.description, extract: r.extract, url: r.url }, summary: `Read “${r.title}”`, sourceName: 'Wikipedia', sourceUrl: r.url };
    },
  },
  {
    name: 'search_openalex',
    label: 'OpenAlex works',
    description:
      'Search 250M+ scholarly works on OpenAlex (papers, books, datasets) with year, citation count, authors, venue and DOI. Call this for any research, literature review or evidence question. Cite the DOI/url of each work you use.',
    schema: obj({ query: { type: 'string', description: 'Keywords, e.g. "sodium-ion battery cathode".' }, limit: { type: 'integer', description: '1-8, default 6.' } }, ['query']),
    doing: (i) => `Searching OpenAlex for ${q(String(i.query))}`,
    run: async (i, c) => {
      const query = str(i, 'query', 200);
      const r = await I.openAlexWorks(query, ctxOf(c), num(i, 'limit', 1, 8, 6));
      return { data: { total: r.total, results: r.results }, summary: `${r.results.length} works for ${q(query)} (${r.total.toLocaleString('en')} total)`, sourceName: 'OpenAlex', sourceUrl: r.sourceUrl };
    },
  },
  {
    name: 'search_arxiv',
    label: 'arXiv preprints',
    description: 'Search arXiv preprints (physics, maths, computer science, AI, quantitative biology/finance), newest relevant first. Use for recent technical research. Summaries are trimmed. Cite the url.',
    schema: obj({ query: { type: 'string', description: 'Keywords, e.g. "retrieval augmented generation evaluation".' }, limit: { type: 'integer', description: '1-6, default 5.' } }, ['query']),
    doing: (i) => `Searching arXiv for ${q(String(i.query))}`,
    run: async (i, c) => {
      const query = str(i, 'query', 200);
      const r = await I.arxivSearch(query, ctxOf(c), num(i, 'limit', 1, 6, 5));
      const results = r.results.map((p) => ({ ...p, summary: p.summary.slice(0, 420) }));
      return { data: { total: r.total, results }, summary: `${results.length} preprints for ${q(query)}`, sourceName: 'arXiv', sourceUrl: r.sourceUrl };
    },
  },
  {
    name: 'search_openlibrary',
    label: 'Open Library books',
    description: 'Search books on Open Library (title, authors, first publish year, editions). Use for reading lists, book facts and author bibliographies.',
    schema: obj({ query: { type: 'string', description: 'Title, author or subject.' }, limit: { type: 'integer', description: '1-8, default 6.' } }, ['query']),
    doing: (i) => `Searching Open Library for ${q(String(i.query))}`,
    run: async (i, c) => {
      const query = str(i, 'query', 200);
      const r = await I.openLibrarySearch(query, ctxOf(c), num(i, 'limit', 1, 8, 6));
      return { data: { total: r.total, results: r.results.map(({ cover: _c, ...b }) => b) }, summary: `${r.results.length} books for ${q(query)}`, sourceName: 'Open Library', sourceUrl: r.sourceUrl };
    },
  },
  {
    name: 'world_bank_indicator',
    label: 'World Bank data',
    description:
      'Official yearly statistics from World Bank Open Data for one country. Call this whenever the decree needs GDP, growth, inflation, population, unemployment, internet use or exports figures. Common indicator codes: ' +
      Object.entries(I.WB_INDICATORS)
        .map(([k, v]) => `${k} = ${v}`)
        .join('; ') +
      '. Returns newest-first values (nulls removed).',
    schema: obj(
      {
        country: { type: 'string', description: 'ISO 3166 alpha-2 or alpha-3 code, e.g. "US", "GBR", or "WLD" for the world.' },
        indicator: { type: 'string', description: 'Indicator code, e.g. "NY.GDP.MKTP.CD".' },
        years: { type: 'integer', description: 'How many recent years, 1-15, default 8.' },
      },
      ['country', 'indicator'],
    ),
    doing: (i) => `Pulling World Bank data for ${String(i.country ?? '').toUpperCase()}`,
    run: async (i, c) => {
      const country = str(i, 'country', 3);
      const indicator = str(i, 'indicator', 40);
      if (!I.isCountryCode(country)) throw new ToolInputError('"country" must be a 2- or 3-letter ISO code.');
      if (!I.isIndicatorCode(indicator)) throw new ToolInputError('"indicator" is not a valid World Bank indicator code.');
      const r = await I.wbIndicator(country, indicator, ctxOf(c), num(i, 'years', 1, 15, 8));
      return {
        data: { country: r.countryName, indicator: r.indicatorName, code: r.indicator, points: r.points, lastUpdated: r.lastUpdated, source: r.sourceUrl },
        summary: `${r.indicatorName} · ${r.countryName} · ${r.points.length} years`,
        sourceName: 'World Bank Open Data',
        sourceUrl: r.sourceUrl,
      };
    },
  },
  {
    name: 'hn_stories',
    label: 'Hacker News',
    description:
      'Hacker News stories via the Algolia API. With a query: the most relevant stories about it (points, comments, links). Without a query: the current front page. Use to gauge what the tech audience is discussing right now.',
    schema: obj({ query: { type: 'string', description: 'Optional search words. Omit for the live front page.' } }, []),
    doing: (i) => (i.query ? `Reading Hacker News on ${q(String(i.query))}` : 'Reading the Hacker News front page'),
    run: async (i, c) => {
      const query = str(i, 'query', 200, false);
      const r = query ? await I.hnSearch(query, ctxOf(c), 10) : await I.hnFrontPage(ctxOf(c), 10);
      return {
        data: { results: r.results.map((s) => ({ title: s.title, url: s.url, hnUrl: s.hnUrl, points: s.points, comments: s.comments, at: s.at })) },
        summary: query ? `${r.results.length} stories for ${q(query)}` : `${r.results.length} front-page stories`,
        sourceName: name('hackernews'),
        sourceUrl: r.sourceUrl,
      };
    },
  },
  {
    name: 'mastodon_trends',
    label: 'Mastodon trends',
    description: 'What is trending right now on mastodon.social: hashtags (with posts and accounts in the last 2 days) or shared links. Use for hashtag picks and timely campaign hooks.',
    schema: obj({ kind: { type: 'string', enum: ['tags', 'links'], description: '"tags" (default) or "links".' } }, []),
    doing: (i) => `Checking Mastodon trending ${i.kind === 'links' ? 'links' : 'hashtags'}`,
    run: async (i, c) => {
      const kind = oneOf(i, 'kind', ['tags', 'links'] as const, 'tags');
      if (kind === 'tags') {
        const r = await I.mastodonTrendingTags(ctxOf(c), 10);
        return { data: r.results, summary: `${r.results.length} trending hashtags`, sourceName: name('mastodon'), sourceUrl: r.sourceUrl };
      }
      const r = await I.mastodonTrendingLinks(ctxOf(c), 8);
      return { data: r.results.map((l) => ({ ...l, description: l.description.slice(0, 200) })), summary: `${r.results.length} trending links`, sourceName: name('mastodon'), sourceUrl: r.sourceUrl };
    },
  },
  {
    name: 'fx_convert',
    label: 'Currency conversion',
    description: 'Convert an amount between currencies at the latest European Central Bank reference rate (Frankfurter). Call this instead of guessing exchange rates.',
    schema: obj(
      { amount: { type: 'number', description: 'Amount to convert.' }, from: { type: 'string', description: 'ISO 4217 code, e.g. "USD".' }, to: { type: 'string', description: 'ISO 4217 code, e.g. "EUR".' } },
      ['amount', 'from', 'to'],
    ),
    doing: (i) => `Converting ${String(i.from ?? '').toUpperCase()} to ${String(i.to ?? '').toUpperCase()}`,
    run: async (i, c) => {
      const amount = num(i, 'amount', 0, 1e12);
      const from = str(i, 'from', 3).toUpperCase();
      const to = str(i, 'to', 3).toUpperCase();
      if (!I.isCurrency(from) || !I.isCurrency(to)) throw new ToolInputError('Currencies must be 3-letter ISO codes.');
      const r = await I.fxConvert(amount, from, to, ctxOf(c));
      return { data: r, summary: `${r.amount} ${r.from} = ${r.result} ${r.to} (ECB ${r.date})`, sourceName: 'Frankfurter (ECB rates)', sourceUrl: r.sourceUrl };
    },
  },
  {
    name: 'fx_rates',
    label: 'Exchange rates',
    description: 'Latest ECB reference exchange rates for a base currency (Frankfurter), optionally only some target currencies.',
    schema: obj(
      { base: { type: 'string', description: 'ISO 4217 code, e.g. "EUR".' }, symbols: { type: 'array', items: { type: 'string' }, description: 'Optional target codes, e.g. ["USD","JPY"].' } },
      ['base'],
    ),
    doing: (i) => `Fetching ${String(i.base ?? '').toUpperCase()} exchange rates`,
    run: async (i, c) => {
      const base = str(i, 'base', 3).toUpperCase();
      const symbols = strList(i, 'symbols', 12, 3, false).map((s) => s.toUpperCase());
      if (!I.isCurrency(base) || symbols.some((s) => !I.isCurrency(s))) throw new ToolInputError('Currencies must be 3-letter ISO codes.');
      const r = await I.fxLatest(base, ctxOf(c), symbols.length ? symbols : undefined);
      return { data: r, summary: `${Object.keys(r.rates).length} rates for ${r.base} (ECB ${r.date})`, sourceName: 'Frankfurter (ECB rates)', sourceUrl: r.sourceUrl };
    },
  },
  {
    name: 'fx_history',
    label: 'Exchange-rate history',
    description: 'Daily ECB exchange-rate history between two currencies (Frankfurter). Returns up to 30 evenly spaced points plus first, last, min and max.',
    schema: obj(
      {
        base: { type: 'string', description: 'ISO 4217 code.' },
        to: { type: 'string', description: 'ISO 4217 code.' },
        start: { type: 'string', description: 'Optional YYYY-MM-DD (default: 90 days ago).' },
        end: { type: 'string', description: 'Optional YYYY-MM-DD (default: today).' },
      },
      ['base', 'to'],
    ),
    doing: (i) => `Charting ${String(i.base ?? '').toUpperCase()}/${String(i.to ?? '').toUpperCase()} history`,
    run: async (i, c) => {
      const base = str(i, 'base', 3).toUpperCase();
      const to = str(i, 'to', 3).toUpperCase();
      const date = /^\d{4}-\d{2}-\d{2}$/;
      const start = str(i, 'start', 10, false) || undefined;
      const end = str(i, 'end', 10, false) || undefined;
      if (!I.isCurrency(base) || !I.isCurrency(to)) throw new ToolInputError('Currencies must be 3-letter ISO codes.');
      if ((start && !date.test(start)) || (end && !date.test(end))) throw new ToolInputError('Dates must be YYYY-MM-DD.');
      const r = await I.fxSeries(base, to, ctxOf(c), start, end);
      const pts = r.points;
      const step = Math.max(1, Math.ceil(pts.length / 30));
      const sample = pts.filter((_, k) => k % step === 0 || k === pts.length - 1);
      const rates = pts.map((p) => p.rate);
      return {
        data: { base: r.base, to: r.to, start: r.start, end: r.end, first: pts[0] ?? null, last: pts[pts.length - 1] ?? null, min: rates.length ? Math.min(...rates) : null, max: rates.length ? Math.max(...rates) : null, points: sample },
        summary: `${r.base}/${r.to} ${r.start} → ${r.end} · ${pts.length} days`,
        sourceName: 'Frankfurter (ECB rates)',
        sourceUrl: r.sourceUrl,
      };
    },
  },
  {
    name: 'public_holidays',
    label: 'Public holidays',
    description: 'Official public holidays for a country (Nager.Date). With a year: all holidays that year. Without: the upcoming holidays. Use for launch dates, campaign calendars and business-day planning.',
    schema: obj({ country: { type: 'string', description: 'ISO 3166 alpha-2, e.g. "US", "GB", "DE".' }, year: { type: 'integer', description: 'Optional year, e.g. 2027.' } }, ['country']),
    doing: (i) => `Checking public holidays in ${String(i.country ?? '').toUpperCase()}`,
    run: async (i, c) => {
      const country = str(i, 'country', 2).toUpperCase();
      if (!/^[A-Z]{2}$/.test(country)) throw new ToolInputError('"country" must be a 2-letter ISO code.');
      const year = i.year === undefined || i.year === null ? null : Math.round(num(i, 'year', 1990, 2100));
      const r = year ? await I.publicHolidays(country, year, ctxOf(c)) : await I.nextHolidays(country, ctxOf(c));
      return {
        data: { country: r.country, year: r.year, holidays: r.holidays.slice(0, 30).map((h) => ({ date: h.date, name: h.name, localName: h.localName, global: h.global })) },
        summary: `${r.holidays.length} ${year ? `holidays in ${year}` : 'upcoming holidays'} · ${country}`,
        sourceName: 'Nager.Date',
        sourceUrl: r.sourceUrl,
      };
    },
  },
  {
    name: 'federal_register',
    label: 'Federal Register',
    description:
      'Search the US Federal Register (official journal of US federal rules, proposed rules, notices and presidential documents), newest first. Call this for any question about US federal regulation. Cite document numbers and urls; this is not legal advice.',
    schema: obj(
      {
        query: { type: 'string', description: 'Search words, e.g. "artificial intelligence disclosure".' },
        type: { type: 'string', enum: ['RULE', 'PRORULE', 'NOTICE', 'PRESDOCU'], description: 'Optional document type filter.' },
      },
      ['query'],
    ),
    doing: (i) => `Searching the Federal Register for ${q(String(i.query))}`,
    run: async (i, c) => {
      const query = str(i, 'query', 200);
      const type = i.type === undefined || i.type === null || i.type === '' ? undefined : oneOf(i, 'type', ['RULE', 'PRORULE', 'NOTICE', 'PRESDOCU'] as const);
      const r = await I.federalRegister(ctxOf(c), query, 8, type);
      return {
        data: { total: r.total, results: r.results.map((d) => ({ ...d, abstract: d.abstract ? d.abstract.slice(0, 400) : null })) },
        summary: `${r.results.length} documents for ${q(query)} (${r.total.toLocaleString('en')} total)`,
        sourceName: 'Federal Register',
        sourceUrl: r.sourceUrl,
      };
    },
  },
  {
    name: 'check_grammar',
    label: 'Grammar check',
    description:
      'Proofread text with LanguageTool (grammar, spelling, style). Good practice: run it on your own draft before you deliver it, then fix the real issues. Returns up to 25 issues with suggested replacements.',
    schema: obj(
      { text: { type: 'string', description: `The text to check (max ${I.GRAMMAR_MAX_BYTES} bytes).` }, language: { type: 'string', description: 'Optional language code, e.g. "en-US", "en-GB", "id", "de-DE", or "auto". Default en-US.' } },
      ['text'],
    ),
    doing: () => 'Proofreading the draft',
    run: async (i, c) => {
      const text = str(i, 'text', 20_000);
      if (Buffer.byteLength(text, 'utf8') > I.GRAMMAR_MAX_BYTES) throw new ToolInputError(`"text" is too long (max ${I.GRAMMAR_MAX_BYTES} bytes). Check it in parts.`);
      const lang = str(i, 'language', 10, false) || 'en-US';
      if (!/^(auto|[a-z]{2,3}(-[A-Za-z]{2,4})?)$/.test(lang)) throw new ToolInputError('"language" must look like "en-US" or "auto".');
      const r = await I.checkGrammar(text, ctxOf(c), lang);
      return {
        data: { language: r.language, checkedChars: r.checkedChars, issues: r.issues.slice(0, 25).map((x) => ({ message: x.message, bad: x.bad, replacements: x.replacements.slice(0, 3), category: x.category })) },
        summary: `${r.issues.length} issue${r.issues.length === 1 ? '' : 's'} in ${r.checkedChars.toLocaleString('en')} characters`,
        sourceName: 'LanguageTool',
        sourceUrl: r.sourceUrl,
      };
    },
  },
  {
    name: 'define_word',
    label: 'Dictionary',
    description: 'English dictionary entry (Free Dictionary API): phonetic, parts of speech, definitions, examples and synonyms. Use to check a word’s exact meaning or usage.',
    schema: obj({ word: { type: 'string', description: 'One English word.' } }, ['word']),
    doing: (i) => `Looking up ${q(String(i.word))}`,
    run: async (i, c) => {
      const word = str(i, 'word', 60);
      const r = await I.define(word, ctxOf(c));
      if (!r.found) return { data: { word, found: false }, summary: `No dictionary entry for ${q(word)}`, sourceName: name('dictionary'), sourceUrl: r.sourceUrl };
      const meanings = r.meanings.slice(0, 4).map((m) => ({ partOfSpeech: m.partOfSpeech, definitions: m.definitions.slice(0, 3), synonyms: m.synonyms.slice(0, 8) }));
      return { data: { word: r.word, phonetic: r.phonetic, meanings }, summary: `Defined ${q(r.word)}`, sourceName: name('dictionary'), sourceUrl: r.sourceUrl };
    },
  },
  {
    name: 'related_words',
    label: 'Related words',
    description: 'Synonyms, antonyms, rhymes or loosely related words for an English word (Datamuse). Use for word choice, taglines and verse.',
    schema: obj(
      { word: { type: 'string', description: 'An English word or short phrase.' }, relation: { type: 'string', enum: ['synonyms', 'antonyms', 'rhymes', 'related'], description: 'Which relation.' } },
      ['word', 'relation'],
    ),
    doing: (i) => `Finding ${String(i.relation ?? 'related')} for ${q(String(i.word))}`,
    run: async (i, c) => {
      const word = str(i, 'word', 60);
      const relation = oneOf(i, 'relation', ['synonyms', 'antonyms', 'rhymes', 'related'] as const);
      const r = await I.relatedWords(word, relation, ctxOf(c), 20);
      return { data: { word, relation, words: r.words }, summary: `${r.words.length} ${relation} for ${q(word)}`, sourceName: 'Datamuse', sourceUrl: r.sourceUrl };
    },
  },
  {
    name: 'current_weather',
    label: 'Weather',
    description: 'Current weather (temperature, conditions, wind) for a named place, via Open-Meteo geocoding + forecast. Use whenever the decree depends on the weather somewhere right now.',
    schema: obj({ place: { type: 'string', description: 'City or place name, e.g. "Bandung" or "Lisbon".' } }, ['place']),
    doing: (i) => `Checking the weather in ${q(String(i.place), 30)}`,
    run: async (i, c) => {
      const place = str(i, 'place', 100);
      const g = await I.geocode(place, ctxOf(c), 1);
      const p = g.results[0];
      if (!p) throw new ToolInputError(`Open-Meteo found no place called ${q(place, 60)}.`);
      const w = await I.currentWeather(p.lat, p.lon, ctxOf(c));
      const src = I.weatherSourceUrl(p.lat, p.lon);
      return {
        data: { place: [p.name, p.admin, p.country].filter(Boolean).join(', '), conditions: I.weatherText(w.code), tempC: w.tempC, windKmh: w.windKmh, isDay: w.isDay, fetchedAt: w.fetchedAt },
        summary: `${p.name}: ${I.weatherText(w.code)}, ${w.tempC} °C`,
        sourceName: 'Open-Meteo',
        sourceUrl: src,
      };
    },
  },
  {
    name: 'generate_image',
    label: 'Image generation',
    description:
      'Paint one real image with a text-to-image model: Cloudflare Workers AI FLUX.1 [schnell] (square 1024×1024, no watermark), falling back to Pollinations when Cloudflare is unavailable (then the aspect applies; the free tier spaces images ~45 s apart). The image is saved, given alt text by a vision model, and shown to the requester in the Artifacts gallery automatically. Request only the images the decree truly needs. Write a vivid, concrete visual prompt in English (subject, composition, style, lighting, palette). Do not ask for legible text inside the image; image models render text badly.',
    schema: obj(
      {
        prompt: { type: 'string', description: `Visual description, max ${I.IMAGE_PROMPT_MAX} characters.` },
        title: { type: 'string', description: 'Short caption for the gallery, e.g. "Hero visual, dusk version".' },
        aspect: { type: 'string', enum: ['landscape', 'square', 'portrait'], description: 'landscape 1280×720 (default), square 1024×1024, portrait 768×1152.' },
      },
      ['prompt', 'title'],
    ),
    doing: () => 'Painting an image',
    run: async (i, c) => {
      const limit = IMAGE_LIMIT[c.province] ?? 0;
      const prompt = str(i, 'prompt', I.IMAGE_PROMPT_MAX);
      const title = str(i, 'title', 100);
      const aspect = oneOf(i, 'aspect', ['landscape', 'square', 'portrait'] as const, 'landscape');
      if (c.usage.images >= limit) throw new ToolInputError(`Image limit reached: at most ${limit} images per decree in this guild. Work with the images you already have.`);
      if (c.usage.imageAttempts >= limit + 2) throw new ToolInputError('Too many image attempts for this decree. Deliver with what you have and say so.');
      c.usage.imageAttempts++;
      const [width, height] = ASPECT[aspect];
      let img: { url: string; width: number; height: number; bytes: number; prompt: string; sourceUrl: string; seed: number | null; provider: string } | null = null;
      let cfNote: string | null = null;
      if (I.cfEnabled()) {
        try {
          const r = await I.cfImage(prompt, ctxOf(c));
          img = { url: r.url, width: 1024, height: 1024, bytes: r.bytes, prompt: r.prompt, sourceUrl: r.sourceUrl, seed: null, provider: 'Cloudflare Workers AI (FLUX.1 schnell)' };
        } catch (e) {
          cfNote = (e as Error)?.message || 'Cloudflare failed';
        }
      }
      if (!img) {
        try {
          const r = await I.generateImage(prompt, ctxOf(c), { width, height, maxWaitMs: IMAGE_MAX_WAIT_MS });
          img = { url: r.url, width: r.width, height: r.height, bytes: r.bytes, prompt: r.prompt, sourceUrl: r.sourceUrl, seed: r.seed, provider: 'Pollinations' };
        } catch (e) {
          if (e instanceof I.ImageBusyError) throw new ToolInputError(e.message + ' Deliver without this image and tell the requester.');
          throw e;
        }
      }
      c.usage.images++;
      const alt = await altText(img.url, c);
      const n = imageCount(c.decreeId) + 1;
      addArtifact(c.decreeId, c.revision, {
        kind: 'image',
        url: img.url,
        title,
        meta: { prompt: img.prompt, sourceUrl: img.sourceUrl, width: img.width, height: img.height, seed: img.seed, bytes: img.bytes, provider: img.provider, alt, ...(cfNote ? { fallbackReason: cfNote.slice(0, 200) } : {}) },
      });
      return {
        data: { image_number: n, url: img.url, width: img.width, height: img.height, model: img.provider, alt, note: 'Saved. The requester sees it in the Artifacts gallery; refer to it as “Image ' + n + '”.' },
        summary: `Painted “${title}” (${img.width}×${img.height}, ${img.provider === 'Pollinations' ? 'Pollinations' : 'Cloudflare FLUX'})`,
        sourceName: img.provider === 'Pollinations' ? 'Pollinations' : 'Cloudflare Workers AI',
        sourceUrl: img.sourceUrl,
        produced: 'image',
      };
    },
  },
  {
    name: 'design_image',
    label: 'Designed image',
    description:
      'Make ONE finished, polished graphic with a premium image model (Google Gemini image via OpenRouter): ads, posters, social posts, thumbnails, covers, menus or flyers, WITH clear, correctly spelled text inside the picture. Put the exact words to show in "text" (short: a headline and maybe a tagline). Costs real credit, so at most 2 per decree and only when the decree needs a finished graphic; for plain illustrations or mood images without text use generate_image. Aspect: 1:1, 4:5 (Instagram feed), 9:16 (Stories/Reels), 16:9 (YouTube/banner) or 3:2.',
    schema: obj(
      {
        prompt: { type: 'string', description: 'The visual: subject, layout, style, palette, mood, where the text sits. English, max 1500 characters.' },
        text: { type: 'string', description: 'Exact text to render in the image (max 200 characters). Omit for no text.' },
        title: { type: 'string', description: 'Short caption for the gallery.' },
        aspect: { type: 'string', enum: [...I.OR_ASPECTS], description: 'Default 1:1.' },
      },
      ['prompt', 'title'],
    ),
    doing: () => 'Designing a graphic',
    run: async (i, c) => {
      const prompt = str(i, 'prompt', I.OR_IMAGE_PROMPT_MAX);
      const title = str(i, 'title', 100);
      const text = str(i, 'text', 200, false) || undefined;
      const aspect = oneOf(i, 'aspect', I.OR_ASPECTS, '1:1');
      if (c.usage.designs >= 2) throw new ToolInputError('Designed image limit reached (2 per decree). Work with the ones you have.');
      c.usage.designs++;
      const r = await I.designImage(prompt, ctxOf(c), { aspect, text });
      const alt = await altText(r.url, c);
      const n = imageCount(c.decreeId) + 1;
      addArtifact(c.decreeId, c.revision, {
        kind: 'image',
        url: r.url,
        title,
        meta: { prompt, text: text ?? null, aspect: r.aspect, bytes: r.bytes, provider: 'Google Gemini image (OpenRouter)', model: r.model, alt },
      });
      return {
        data: { image_number: n, url: r.url, aspect: r.aspect, model: r.model, alt, note: 'Saved. The requester sees it in the Artifacts gallery; refer to it as “Image ' + n + '”. Check the alt text: if the text in the image is misspelled, say so.' },
        summary: `Designed “${title}” (${r.aspect})`,
        sourceName: 'OpenRouter · Google Gemini image',
        sourceUrl: 'https://openrouter.ai/' + r.model,
        produced: 'image',
      };
    },
  },
  {
    name: 'make_video',
    label: 'Video render',
    description:
      'Render a real H.264 .mp4 slideshow (gentle zoom/pan, fades, captions burned into the picture) from 3 to 6 images you generated for THIS decree with generate_image. Pass their url values in order and one short caption per image. Call it once, after all frames exist.',
    schema: obj(
      {
        images: { type: 'array', items: { type: 'string' }, description: 'The /uploads/… url of each frame, in order (3-6).' },
        captions: { type: 'array', items: { type: 'string' }, description: 'One caption per image (max 120 characters each).' },
        title: { type: 'string', description: 'Video title.' },
        seconds_per_slide: { type: 'number', description: '2-6, default 3.5.' },
      },
      ['images', 'title'],
    ),
    doing: () => 'Rendering the video',
    run: async (i, c) => {
      const images = strList(i, 'images', 6, 200);
      const captions = strList(i, 'captions', 6, 120, false);
      const title = str(i, 'title', 100);
      const secs = num(i, 'seconds_per_slide', 2, 6, 3.5);
      if (images.length < 3) throw new ToolInputError('A video needs at least 3 images. Generate more frames first.');
      if (c.usage.videos >= 1) throw new ToolInputError('Only one video per decree run.');
      const mine = new Set(listArtifacts(c.decreeId).filter((a) => a.kind === 'image' && a.url).map((a) => a.url as string));
      const bad = images.filter((u) => !mine.has(u));
      if (bad.length) throw new ToolInputError(`These are not images generated for this decree: ${bad.join(', ')}. Use the url values returned by generate_image.`);
      const v = await I.makeSlideshow({ images, captions, secondsPerSlide: secs, width: 1280, height: 720 });
      c.usage.videos++;
      addArtifact(c.decreeId, c.revision, {
        kind: 'video',
        url: v.url,
        title,
        meta: { durationSec: v.durationSec, slides: v.slides, width: v.width, height: v.height, bytes: v.bytes, subtitles: v.subtitles, captions, frames: images, renderer: 'ffmpeg (local)' },
      });
      return {
        data: { url: v.url, durationSec: v.durationSec, slides: v.slides, size: `${v.width}×${v.height}`, subtitles: v.subtitles, note: 'Saved. The requester sees it in the Artifacts player.' },
        summary: `Rendered “${title}” · ${v.slides} slides · ${v.durationSec} s`,
        sourceName: 'ffmpeg (local render)',
        sourceUrl: v.url,
        produced: 'video',
      };
    },
  },
  {
    name: 'publish_web_page',
    label: 'Web page',
    description:
      'Publish a complete single-file web page (HTML with inline <style> and <script>) as a live artifact. The requester sees it running in a sandboxed preview and can download it. Use it whenever the decree asks for a page, landing page, widget, demo, prototype or anything that runs in a browser. Rules: one self-contained file starting with <!doctype html> and ending with </html>; no external requests except optional Google Fonts or a CDN script from cdnjs.cloudflare.com / cdn.jsdelivr.net; no localStorage/cookies requirement (the sandbox blocks them; wrap in try/catch); keep it under 60 KB; responsive and accessible. The page goes live at its own public link (liveUrl in the result), so give that link to the requester. To change a page, call it again with the full new file.',
    schema: obj(
      { title: { type: 'string', description: 'Page title shown on the artifact card.' }, html: { type: 'string', description: 'The full HTML file.' } },
      ['title', 'html'],
    ),
    doing: () => 'Building the web page',
    run: async (i, c) => {
      const title = str(i, 'title', 100);
      const html = str(i, 'html', HTML_MAX);
      if (c.usage.pages >= 3) throw new ToolInputError('Page limit reached for this decree run.');
      if (html.length < 200 || !/<html[\s>]/i.test(html)) throw new ToolInputError('"html" must be a complete HTML document (with <html> … </html>).');
      if (!/<\/html>\s*$/i.test(html)) throw new ToolInputError('The HTML looks cut off (it does not end with </html>). Send the complete file, shorter if needed.');
      c.usage.pages++;
      const hosted = hostPage(c.userId || null, title, html, c.decreeId);
      addArtifact(c.decreeId, c.revision, { kind: 'html', content: html, title, meta: { bytes: Buffer.byteLength(html, 'utf8'), liveUrl: hosted.url, slug: hosted.slug } });
      return {
        data: { published: true, liveUrl: hosted.url, bytes: Buffer.byteLength(html, 'utf8'), note: 'The page is live at liveUrl (anyone with the link can open it; it runs in a sandbox). Give the requester this link.' },
        summary: `Published “${title}” (${(Buffer.byteLength(html, 'utf8') / 1024).toFixed(1)} KB)`,
        sourceName: 'Agentdom artifact',
        sourceUrl: hosted.url,
        produced: 'html',
      };
    },
  },

  // ---------------- web research (Tavily, Jina, Exa) ----------------
  {
    name: 'web_search',
    label: 'Web search',
    description:
      'Live web search (Tavily). Returns up to 6 results with title, url and a content snippet, plus a short synthesized answer. Use for current facts, prices, companies, events or anything not on Wikipedia. Cite the result urls, not the answer. At most 4 searches per decree, so choose queries carefully.',
    schema: obj(
      { query: { type: 'string', description: 'Search words or a question, max 300 characters.' }, topic: { type: 'string', enum: ['general', 'news'], description: '"news" for recent news only. Default general.' } },
      ['query'],
    ),
    doing: (i) => `Searching the web for ${q(String(i.query))}`,
    run: async (i, c) => {
      const query = str(i, 'query', 300);
      const topic = oneOf(i, 'topic', ['general', 'news'] as const, 'general');
      if (c.usage.searches >= 4) throw new ToolInputError('Search limit reached (4 per decree). Work with the results you have.');
      c.usage.searches++;
      const r = await I.tavilySearch(query, ctxOf(c), { max: 6, topic, answer: true });
      return {
        data: { answer: clip(r.answer, 600), results: r.results.map((h) => ({ title: h.title, url: h.url, snippet: clip(h.snippet, 500) })) },
        summary: `${r.results.length} web results for ${q(query)}`,
        sourceName: name('tavily'),
        sourceUrl: r.sourceUrl,
      };
    },
  },
  {
    name: 'read_url',
    label: 'Read web page',
    description: 'Read one public web page as clean text (Jina Reader), up to about 6,000 characters. Use after web_search to read the most promising result, or on a url the requester gave. At most 4 reads per decree.',
    schema: obj({ url: { type: 'string', description: 'Full http(s) URL of a public page.' } }, ['url']),
    doing: (i) => `Reading ${q(String(i.url ?? '').replace(/^https?:\/\//, ''), 40)}`,
    run: async (i, c) => {
      const url = safeHttp(str(i, 'url', 500));
      if (c.usage.reads >= 4) throw new ToolInputError('Page-read limit reached (4 per decree).');
      c.usage.reads++;
      const r = await I.readUrl(url, ctxOf(c), 6000);
      return { data: { url: r.url, title: r.title, description: r.description, text: r.text, truncated: r.truncated }, summary: `Read “${clip(r.title || r.url, 60)}” (${r.chars.toLocaleString('en')} chars)`, sourceName: name('jina'), sourceUrl: r.sourceUrl };
    },
  },
  {
    name: 'exa_search',
    label: 'Exa neural search',
    description:
      'Neural web search (Exa) that understands meaning, good for finding companies, research papers, GitHub projects, personal sites or reports that match a description. Optional category: ' +
      I.EXA_CATEGORIES.join(', ') +
      '. Returns up to 6 hits with url, date and snippet. Shares a budget of 3 calls per decree with find_similar_companies.',
    schema: obj(
      { query: { type: 'string', description: 'A natural description, e.g. "open-source tools for invoice OCR".' }, category: { type: 'string', enum: [...I.EXA_CATEGORIES], description: 'Optional category.' } },
      ['query'],
    ),
    doing: (i) => `Searching Exa for ${q(String(i.query))}`,
    run: async (i, c) => {
      const query = str(i, 'query', 300);
      const category = i.category === undefined || i.category === null || i.category === '' ? undefined : oneOf(i, 'category', I.EXA_CATEGORIES);
      if (c.usage.discoveries >= 3) throw new ToolInputError('Exa limit reached (3 per decree).');
      c.usage.discoveries++;
      const r = await I.exaSearch(query, ctxOf(c), { num: 6, category });
      return { data: { results: r.results }, summary: `${r.results.length} Exa hits for ${q(query)}`, sourceName: name('exa'), sourceUrl: r.sourceUrl };
    },
  },
  {
    name: 'find_similar_companies',
    label: 'Similar companies',
    description: 'Given the website of a company (or any page), find similar pages on other domains with Exa, e.g. competitors or comparable businesses. Returns up to 6 hits with url and snippet. Shares a budget of 3 calls per decree with exa_search.',
    schema: obj({ url: { type: 'string', description: 'Full URL of the company site, e.g. "https://www.notion.so".' } }, ['url']),
    doing: (i) => `Finding companies like ${q(String(i.url ?? '').replace(/^https?:\/\//, ''), 36)}`,
    run: async (i, c) => {
      const url = safeHttp(str(i, 'url', 300));
      if (c.usage.discoveries >= 3) throw new ToolInputError('Exa limit reached (3 per decree).');
      c.usage.discoveries++;
      const r = await I.exaFindSimilar(url, ctxOf(c), { num: 6 });
      return { data: { similarTo: r.query, results: r.results }, summary: `${r.results.length} pages similar to ${q(url.replace(/^https?:\/\//, ''), 40)}`, sourceName: name('exa'), sourceUrl: r.sourceUrl };
    },
  },

  // ---------------- data (FRED, Wolfram, Finnhub) ----------------
  {
    name: 'fred_search',
    label: 'FRED series search',
    description: 'Find US/international economic time series on FRED (St. Louis Fed) by keywords. Returns series ids, titles, frequency and units. Popular ids: ' + Object.entries(I.FRED_POPULAR).map(([k, v]) => `${k} = ${v}`).join('; ') + '.',
    schema: obj({ query: { type: 'string', description: 'Keywords, e.g. "euro area inflation".' } }, ['query']),
    doing: (i) => `Searching FRED for ${q(String(i.query))}`,
    run: async (i, c) => {
      const query = str(i, 'query', 120);
      const r = await I.fredSearch(query, ctxOf(c), 8);
      return {
        data: { total: r.total, results: r.results.map((s) => ({ id: s.id, title: s.title, frequency: s.frequency, units: s.units, start: s.start, end: s.end, url: s.url })) },
        summary: `${r.results.length} FRED series for ${q(query)}`,
        sourceName: name('fred'),
        sourceUrl: r.sourceUrl,
      };
    },
  },
  {
    name: 'fred_series',
    label: 'FRED data',
    description: 'Observations of one FRED series by id (newest values, oldest first in the result), with title, units and last update. Use for official rates, inflation, unemployment, yields and similar figures.',
    schema: obj({ series: { type: 'string', description: 'FRED series id, e.g. "CPIAUCSL".' }, points: { type: 'integer', description: 'How many recent observations, 2-36, default 12.' } }, ['series']),
    doing: (i) => `Pulling FRED series ${String(i.series ?? '').toUpperCase()}`,
    run: async (i, c) => {
      const series = str(i, 'series', 40);
      if (!I.isSeriesId(series)) throw new ToolInputError('"series" must be a FRED series id such as UNRATE.');
      const r = await I.fredSeries(series, ctxOf(c), num(i, 'points', 2, 36, 12));
      const s = r.series;
      return {
        data: { id: s.id, title: s.title, units: s.units, frequency: s.frequency, lastUpdated: s.lastUpdated, points: r.points, url: s.url },
        summary: `${s.title} · ${r.points.length} points`,
        sourceName: name('fred'),
        sourceUrl: r.sourceUrl,
      };
    },
  },
  {
    name: 'ask_wolfram',
    label: 'Wolfram|Alpha',
    description: 'Ask Wolfram|Alpha a computational or factual question (maths, unit conversions, physical constants, dates, nutrition, statistics). Phrase it as a short query, e.g. "integrate x^2 sin x" or "population of Lisbon". At most 3 per decree.',
    schema: obj({ input: { type: 'string', description: `The query, max ${I.WOLFRAM_MAX_INPUT} characters.` } }, ['input']),
    doing: (i) => `Asking Wolfram|Alpha ${q(String(i.input))}`,
    run: async (i, c) => {
      const input = str(i, 'input', I.WOLFRAM_MAX_INPUT);
      if (c.usage.wolfram >= 3) throw new ToolInputError('Wolfram|Alpha limit reached (3 per decree).');
      c.usage.wolfram++;
      const r = await I.askWolfram(input, ctxOf(c), 2500);
      return { data: { understood: r.understood, answer: r.text, url: r.sourceUrl }, summary: r.understood ? `Answered ${q(input)}` : `Wolfram|Alpha did not understand ${q(input)}`, sourceName: name('wolfram'), sourceUrl: r.sourceUrl };
    },
  },
  {
    name: 'stock_quote',
    label: 'Stock quote',
    description: 'Latest stock quote from Finnhub for a US-listed ticker: price, change, day range, previous close and quote time. Never guess share prices.',
    schema: obj({ symbol: { type: 'string', description: 'Ticker, e.g. "AAPL".' } }, ['symbol']),
    doing: (i) => `Checking the ${String(i.symbol ?? '').toUpperCase()} quote`,
    run: async (i, c) => {
      const symbol = str(i, 'symbol', 12);
      if (!I.isTicker(symbol)) throw new ToolInputError('"symbol" must be a ticker such as AAPL.');
      const r = await I.stockQuote(symbol, ctxOf(c));
      return { data: r, summary: `${r.symbol} ${r.price}${r.changePct != null ? ` (${r.changePct > 0 ? '+' : ''}${r.changePct.toFixed(2)}%)` : ''}`, sourceName: name('finnhub'), sourceUrl: r.sourceUrl };
    },
  },
  {
    name: 'company_profile',
    label: 'Company profile',
    description: 'Company profile from Finnhub for a ticker: name, exchange, industry, country, currency, IPO date, market cap (millions) and website.',
    schema: obj({ symbol: { type: 'string', description: 'Ticker, e.g. "MSFT".' } }, ['symbol']),
    doing: (i) => `Reading the ${String(i.symbol ?? '').toUpperCase()} company profile`,
    run: async (i, c) => {
      const symbol = str(i, 'symbol', 12);
      if (!I.isTicker(symbol)) throw new ToolInputError('"symbol" must be a ticker such as MSFT.');
      const r = await I.companyProfile(symbol, ctxOf(c));
      const { logo: _l, ...rest } = r;
      return { data: rest, summary: r.found ? `${r.name} (${r.exchange ?? '?'})` : `No profile for ${r.symbol}`, sourceName: name('finnhub'), sourceUrl: r.sourceUrl };
    },
  },
  {
    name: 'company_news',
    label: 'Company news',
    description: 'Recent news headlines about one listed company from Finnhub (last 1-30 days, newest first, up to 8), with source and url.',
    schema: obj({ symbol: { type: 'string', description: 'Ticker, e.g. "NVDA".' }, days: { type: 'integer', description: '1-30, default 7.' } }, ['symbol']),
    doing: (i) => `Reading ${String(i.symbol ?? '').toUpperCase()} company news`,
    run: async (i, c) => {
      const symbol = str(i, 'symbol', 12);
      if (!I.isTicker(symbol)) throw new ToolInputError('"symbol" must be a ticker.');
      const r = await I.companyNews(symbol, ctxOf(c), num(i, 'days', 1, 30, 7), 8);
      return { data: { symbol: r.symbol, from: r.from, to: r.to, results: r.results.map((n) => ({ ...n, summary: clip(n.summary, 280) })) }, summary: `${r.results.length} ${r.symbol} headlines`, sourceName: name('finnhub'), sourceUrl: r.sourceUrl };
    },
  },

  // ---------------- heralds (GNews, YouTube, Bluesky draft) ----------------
  {
    name: 'news',
    label: 'News headlines',
    description:
      'Current news from GNews. With a query: recent articles matching it (supports quotes, AND, OR, NOT). Without a query: top headlines for a category (' +
      I.GNEWS_CATEGORIES.join(', ') +
      '). Optional 2-letter country and language. Up to 8 articles with source, date and url. At most 3 calls per decree.',
    schema: obj(
      {
        query: { type: 'string', description: 'Optional search words.' },
        category: { type: 'string', enum: [...I.GNEWS_CATEGORIES], description: 'For top headlines (no query). Default general.' },
        country: { type: 'string', description: 'Optional 2-letter country code, e.g. "us", "gb", "id".' },
        lang: { type: 'string', description: 'Optional 2-letter language code, default "en".' },
      },
      [],
    ),
    doing: (i) => (i.query ? `Reading the news on ${q(String(i.query))}` : `Reading ${String(i.category ?? 'top')} headlines`),
    run: async (i, c) => {
      const query = str(i, 'query', 200, false);
      const category = oneOf(i, 'category', I.GNEWS_CATEGORIES, 'general');
      const country = str(i, 'country', 2, false).toLowerCase() || undefined;
      const lang = str(i, 'lang', 2, false).toLowerCase() || undefined;
      if ((country && !/^[a-z]{2}$/.test(country)) || (lang && !/^[a-z]{2}$/.test(lang))) throw new ToolInputError('country and lang must be 2-letter codes.');
      if (c.usage.news >= 3) throw new ToolInputError('News limit reached (3 per decree).');
      c.usage.news++;
      const r = query ? await I.newsSearch(query, ctxOf(c), { country, lang, max: 8 }) : await I.newsTop(ctxOf(c), { category, country, lang, max: 8 });
      return {
        data: { total: r.total, articles: r.articles.map((a) => ({ title: a.title, description: clip(a.description, 240), url: a.url, source: a.source, publishedAt: a.publishedAt })) },
        summary: query ? `${r.articles.length} articles for ${q(query)}` : `${r.articles.length} ${category} headlines`,
        sourceName: name('gnews'),
        sourceUrl: r.sourceUrl,
      };
    },
  },
  {
    name: 'youtube_trending',
    label: 'YouTube trending',
    description: 'The most popular YouTube videos right now in a region (title, channel, views, likes, duration, url). Use to see what audiences are watching.',
    schema: obj({ region: { type: 'string', description: '2-letter region code, default "US".' } }, []),
    doing: (i) => `Checking YouTube trending in ${String(i.region ?? 'US').toUpperCase()}`,
    run: async (i, c) => {
      const region = (str(i, 'region', 2, false) || 'US').toUpperCase();
      if (!/^[A-Z]{2}$/.test(region)) throw new ToolInputError('"region" must be a 2-letter code.');
      if (c.usage.youtube >= 2) throw new ToolInputError('YouTube limit reached (2 per decree).');
      c.usage.youtube++;
      const r = await I.youtubeTrending(ctxOf(c), region, 10);
      return { data: { region: r.region, results: r.results.map(({ thumbnail: _t, description, ...v }) => ({ ...v, description: clip(description, 160) })) }, summary: `${r.results.length} trending videos in ${r.region}`, sourceName: name('youtube'), sourceUrl: r.sourceUrl };
    },
  },
  {
    name: 'youtube_search',
    label: 'YouTube search',
    description: 'Search YouTube videos for a topic (title, channel, views, likes, url). Costly on the free quota: shares 2 calls per decree with youtube_trending.',
    schema: obj({ query: { type: 'string', description: 'Search words.' }, region: { type: 'string', description: '2-letter region code, default "US".' } }, ['query']),
    doing: (i) => `Searching YouTube for ${q(String(i.query))}`,
    run: async (i, c) => {
      const query = str(i, 'query', 150);
      const region = (str(i, 'region', 2, false) || 'US').toUpperCase();
      if (!/^[A-Z]{2}$/.test(region)) throw new ToolInputError('"region" must be a 2-letter code.');
      if (c.usage.youtube >= 2) throw new ToolInputError('YouTube limit reached (2 per decree).');
      c.usage.youtube++;
      const r = await I.youtubeSearch(query, ctxOf(c), region, 8);
      return { data: { results: r.results.map(({ thumbnail: _t, description, ...v }) => ({ ...v, description: clip(description, 160) })) }, summary: `${r.results.length} videos for ${q(query)}`, sourceName: name('youtube'), sourceUrl: r.sourceUrl };
    },
  },
  {
    name: 'draft_bluesky_post',
    label: 'Bluesky draft',
    description:
      'Queue ONE Bluesky post as a draft for the realm’s Herald (the owner) to approve. It is NOT posted: nothing goes out until a human approves it in the Herald queue. Max 300 characters, no emoji unless the requester asked; optionally attach one image made for this decree (its url) with alt text. In your result, say plainly that it is a pending draft awaiting approval, not a published post.',
    schema: obj(
      {
        text: { type: 'string', description: 'The post text (max 300 characters, links allowed).' },
        image: { type: 'string', description: 'Optional /uploads/… url of an image made for this decree.' },
        alt: { type: 'string', description: 'Alt text for the image (defaults to the generated alt text).' },
      },
      ['text'],
    ),
    doing: () => 'Drafting a Bluesky post for the Herald',
    run: async (i, c) => {
      const text = str(i, 'text', 1000);
      const image = str(i, 'image', 200, false) || null;
      let alt = str(i, 'alt', 1000, false) || null;
      if (c.usage.drafts >= 1) throw new ToolInputError('Only one Bluesky draft per decree run.');
      if (image) {
        const a = myImage(c, image);
        alt = alt || (typeof a.meta.alt === 'string' ? a.meta.alt : null) || a.title;
      }
      let post: ReturnType<typeof queueHeraldDraft>;
      try {
        post = queueHeraldDraft({ text, image, alt, decreeId: c.decreeId });
      } catch (e) {
        throw new ToolInputError((e as Error).message);
      }
      c.usage.drafts++;
      addArtifact(c.decreeId, c.revision, { kind: 'draft', title: 'Bluesky draft', meta: { network: 'Bluesky', heraldId: post.id, status: 'pending', text: post.text, image: post.image, alt: post.alt } });
      return {
        data: { queued: true, posted: false, status: 'pending', note: 'Queued for the Herald’s approval. It has NOT been posted and has no post URL. Tell the requester it is a pending draft.' },
        summary: 'Queued a Bluesky draft (pending approval, not posted)',
        sourceName: 'Herald queue',
        sourceUrl: null,
        produced: 'draft',
        activity: 'drafted a Bluesky post for the Herald’s approval',
      };
    },
  },

  // ---------------- bazaar (Geoapify) ----------------
  {
    name: 'local_businesses',
    label: 'Local businesses',
    description:
      'Real businesses of one category in a city or area anywhere in the world (Geoapify over OpenStreetMap): name, address, website, phone, opening hours and an OpenStreetMap link. Categories: ' +
      Object.entries(I.PLACE_CATEGORIES)
        .map(([k, v]) => `${k} (${v})`)
        .join(', ') +
      '. Up to 2 comma-separated categories. Data comes from OpenStreetMap volunteers: coverage varies, say so. At most 3 calls per decree.',
    schema: obj(
      {
        place: { type: 'string', description: 'City or area, e.g. "Porto, Portugal" or "Shibuya, Tokyo".' },
        category: { type: 'string', description: 'Geoapify category, e.g. "catering.cafe".' },
        limit: { type: 'integer', description: '1-20, default 12.' },
      },
      ['place', 'category'],
    ),
    doing: (i) => `Finding ${I.PLACE_CATEGORIES[String(i.category)]?.toLowerCase() ?? 'businesses'} in ${q(String(i.place), 30)}`,
    run: async (i, c) => {
      const place = str(i, 'place', 120);
      const category = str(i, 'category', 120).toLowerCase();
      if (!I.isPlaceCategory(category) || category.split(',').length > 2) throw new ToolInputError('"category" must be one or two Geoapify categories such as catering.cafe.');
      if (c.usage.places >= 3) throw new ToolInputError('Local-business limit reached (3 per decree).');
      c.usage.places++;
      const r = await I.localBusinesses(place, category, ctxOf(c), { limit: num(i, 'limit', 1, 20, 12) });
      return {
        data: {
          area: r.area.formatted,
          country: r.area.country,
          filter: r.filter,
          results: r.results.map((b) => ({ name: b.name, address: b.address, website: b.website, phone: b.phone, openingHours: b.openingHours, distanceM: b.distanceM, osmUrl: b.osmUrl })),
          note: 'OpenStreetMap data: names and hours may be incomplete or outdated.',
        },
        summary: `${r.results.length} ${category} in ${clip(r.area.formatted, 50)}`,
        sourceName: name('geoapify'),
        sourceUrl: r.sourceUrl,
      };
    },
  },

  // ---------------- court (CourtListener) ----------------
  {
    name: 'case_law',
    label: 'Case law',
    description: 'Search US court opinions on CourtListener (Free Law Project): case name, court, date filed, citations, cited-by count, snippet and url. Optional court ids (e.g. "scotus", "ca9") and order. Cite each case you use with its url; this is general information, not legal advice.',
    schema: obj(
      {
        query: { type: 'string', description: 'Search words, e.g. "fair use software API".' },
        court: { type: 'string', description: 'Optional CourtListener court ids, space separated.' },
        order: { type: 'string', enum: ['relevance', 'newest'], description: 'Default relevance.' },
        filed_after: { type: 'string', description: 'Optional YYYY-MM-DD.' },
      },
      ['query'],
    ),
    doing: (i) => `Searching case law for ${q(String(i.query))}`,
    run: async (i, c) => {
      const query = str(i, 'query', 300);
      const court = str(i, 'court', 80, false).toLowerCase() || undefined;
      const order = oneOf(i, 'order', ['relevance', 'newest'] as const, 'relevance');
      const filedAfter = str(i, 'filed_after', 10, false) || undefined;
      if (court && !/^[a-z0-9 ]{2,80}$/.test(court)) throw new ToolInputError('"court" must be CourtListener court ids such as scotus.');
      if (filedAfter && !/^\d{4}-\d{2}-\d{2}$/.test(filedAfter)) throw new ToolInputError('"filed_after" must be YYYY-MM-DD.');
      const r = await I.caseLawSearch(query, ctxOf(c), { limit: 8, order: order === 'newest' ? 'dateFiled desc' : 'score desc', court, filedAfter });
      return { data: { total: r.total, results: r.results }, summary: `${r.results.length} opinions for ${q(query)} (${r.total.toLocaleString('en')} total)`, sourceName: name('courtlistener'), sourceUrl: r.sourceUrl };
    },
  },

  // ---------------- scriptorium (Cloudflare m2m100) ----------------
  {
    name: 'translate',
    label: 'Translation',
    description: `Machine-translate text with Meta M2M100 1.2B on Cloudflare Workers AI. Language codes like en, id, fr, de, es, ja, zh, ar. Max ${I.TRANSLATE_MAX_CHARS} characters per call; at most 4 calls per decree. Review the output: machine translation can be stiff, so polish it and say it was machine-translated then edited.`,
    schema: obj(
      { text: { type: 'string', description: 'Text to translate.' }, target: { type: 'string', description: 'Target language code, e.g. "fr".' }, source: { type: 'string', description: 'Source language code, default "en".' } },
      ['text', 'target'],
    ),
    doing: (i) => `Translating into ${String(i.target ?? '').toLowerCase()}`,
    run: async (i, c) => {
      const text = str(i, 'text', I.TRANSLATE_MAX_CHARS);
      const target = str(i, 'target', 3).toLowerCase();
      const source = (str(i, 'source', 3, false) || 'en').toLowerCase();
      if (!/^[a-z]{2,3}$/.test(target) || !/^[a-z]{2,3}$/.test(source)) throw new ToolInputError('Language codes must look like en, id or fr.');
      if (c.usage.translations >= 4) throw new ToolInputError('Translation limit reached (4 per decree).');
      c.usage.translations++;
      const r = await I.cfTranslate(text, target, ctxOf(c), source);
      return { data: { source: r.source, target: r.target, translated: r.translated, model: r.model }, summary: `Translated ${text.length.toLocaleString('en')} chars ${r.source} → ${r.target}`, sourceName: name('cloudflare'), sourceUrl: r.sourceUrl };
    },
  },

  // ---------------- atelier (Pixabay photos, remove.bg) ----------------
  {
    name: 'stock_photos',
    label: 'Stock photo search',
    description: 'Search free Pixabay photos (Pixabay Content License, safe search). Returns ids, tags, size and photographer. Then call use_stock_photo with an id to download it into the decree. Real photos suit products, places and mood boards better than generated images.',
    schema: obj({ query: { type: 'string', description: 'Search words in English, e.g. "coffee beans close up".' }, orientation: { type: 'string', enum: ['horizontal', 'vertical'], description: 'Optional.' } }, ['query']),
    doing: (i) => `Searching Pixabay photos for ${q(String(i.query))}`,
    run: async (i, c) => {
      const query = str(i, 'query', 100);
      const orientation = i.orientation === undefined || i.orientation === null || i.orientation === '' ? undefined : oneOf(i, 'orientation', ['horizontal', 'vertical'] as const);
      const r = await I.pixabayImages(query, ctxOf(c), { perPage: 8, orientation });
      return {
        data: { total: r.total, results: r.results.map((p) => ({ id: p.id, tags: p.tags, width: p.width, height: p.height, author: p.author, pageUrl: p.pageUrl })) },
        summary: `${r.results.length} photos for ${q(query)} (${r.total.toLocaleString('en')} total)`,
        sourceName: name('pixabay'),
        sourceUrl: r.sourceUrl,
      };
    },
  },
  {
    name: 'use_stock_photo',
    label: 'Stock photo',
    description: 'Download one Pixabay photo by id (from stock_photos) into this decree, with photographer credit and generated alt text. It appears in the Artifacts gallery like a generated image and can be used by other tools. Up to 4 per decree.',
    schema: obj({ id: { type: 'integer', description: 'Pixabay photo id.' }, title: { type: 'string', description: 'Short caption for the gallery.' } }, ['id', 'title']),
    doing: () => 'Fetching a Pixabay photo',
    run: async (i, c) => {
      const id = Math.round(num(i, 'id', 1, 1e12));
      const title = str(i, 'title', 100);
      if (c.usage.photos >= 4) throw new ToolInputError('Stock photo limit reached (4 per decree).');
      c.usage.photos++;
      const p = await I.pixabayDownloadImage(id, ctxOf(c), { large: true });
      const alt = await altText(p.url, c);
      const n = imageCount(c.decreeId) + 1;
      const credit = { author: p.author, authorUrl: p.authorUrl, pageUrl: p.pageUrl, license: p.license, licenseUrl: p.licenseUrl };
      addArtifact(c.decreeId, c.revision, { kind: 'image', url: p.url, title, meta: { provider: 'Pixabay', width: p.width, height: p.height, bytes: p.bytes, sourceUrl: p.pageUrl, alt, credit } });
      return {
        data: { image_number: n, url: p.url, width: p.width, height: p.height, alt, credit, note: `Saved as Image ${n}. Credit: photo by ${p.author} on Pixabay (${p.pageUrl}).` },
        summary: `Saved Pixabay photo by ${p.author} as Image ${n}`,
        sourceName: name('pixabay'),
        sourceUrl: p.pageUrl,
        produced: 'image',
      };
    },
  },
  {
    name: 'remove_background',
    label: 'Background removal',
    description: 'Cut the subject out of ONE image made for this decree (remove.bg, transparent PNG, preview resolution). Only one per decree because the free quota is tiny; use it only when the decree needs a cutout (product shot, sticker, logo mock-up).',
    schema: obj({ image: { type: 'string', description: '/uploads/… url of an image made for this decree.' }, title: { type: 'string', description: 'Caption for the cutout.' } }, ['image', 'title']),
    doing: () => 'Removing the background',
    run: async (i, c) => {
      const image = str(i, 'image', 200);
      const title = str(i, 'title', 100);
      if (c.usage.cutouts >= 1) throw new ToolInputError('Only one background removal per decree.');
      const src = myImage(c, image);
      c.usage.cutouts++;
      let r: Awaited<ReturnType<typeof I.removeBackground>>;
      try {
        r = await I.removeBackground(src.url!, c.userId, ctxOf(c));
      } catch (e) {
        if (e instanceof I.QuotaError) throw new ToolInputError(e.message + ' Deliver without the cutout and say so.');
        throw e;
      }
      const alt = await altText(r.url, c);
      const n = imageCount(c.decreeId) + 1;
      addArtifact(c.decreeId, c.revision, { kind: 'image', url: r.url, title, meta: { provider: 'remove.bg', width: r.width, height: r.height, bytes: r.bytes, cutoutOf: src.url, alt, sourceUrl: r.sourceUrl } });
      return { data: { image_number: n, url: r.url, width: r.width, height: r.height, alt, note: `Saved as Image ${n} (transparent PNG).` }, summary: `Cut out “${title}”`, sourceName: name('removebg'), sourceUrl: r.sourceUrl, produced: 'image' };
    },
  },

  // ---------------- theatre (Pixabay video, Freesound, Cloudflare TTS, ffmpeg) ----------------
  {
    name: 'stock_videos',
    label: 'Stock footage search',
    description: 'Search free Pixabay video clips (real footage, Pixabay Content License). Returns ids, duration, tags, the largest size and the author. Pick 2-4 clips for make_film.',
    schema: obj({ query: { type: 'string', description: 'Search words in English, e.g. "ocean waves sunrise".' } }, ['query']),
    doing: (i) => `Searching Pixabay footage for ${q(String(i.query))}`,
    run: async (i, c) => {
      const query = str(i, 'query', 100);
      const r = await I.pixabayVideos(query, ctxOf(c), { perPage: 8 });
      return {
        data: { total: r.total, results: r.results.map((v) => ({ id: v.id, durationSec: v.durationSec, tags: v.tags, maxSize: v.sizes[0] ? `${v.sizes[0].width}×${v.sizes[0].height}` : null, author: v.author, pageUrl: v.pageUrl })) },
        summary: `${r.results.length} clips for ${q(query)} (${r.total.toLocaleString('en')} total)`,
        sourceName: name('pixabay'),
        sourceUrl: r.sourceUrl,
      };
    },
  },
  {
    name: 'find_music',
    label: 'Music search',
    description: 'Search Freesound for CC0 / CC BY music beds (kind "music", 20 s to 10 min) or sound effects (kind "sfx"). Returns ids, name, author, license, duration. Pass one id as music_id to make_film. CC BY needs a credit, which make_film records.',
    schema: obj({ query: { type: 'string', description: 'Mood or genre words, e.g. "calm piano ambient".' }, kind: { type: 'string', enum: ['music', 'sfx'], description: 'Default music.' } }, ['query']),
    doing: (i) => `Searching Freesound for ${q(String(i.query))}`,
    run: async (i, c) => {
      const query = str(i, 'query', 100);
      const kind = oneOf(i, 'kind', ['music', 'sfx'] as const, 'music');
      const r = await I.freesoundSearch(query, ctxOf(c), { kind, perPage: 8 });
      return {
        data: { total: r.total, results: r.results.map((s) => ({ id: s.id, name: s.name, author: s.author, license: s.license, needsCredit: s.needsCredit, durationSec: s.durationSec, tags: s.tags, pageUrl: s.pageUrl })) },
        summary: `${r.results.length} sounds for ${q(query)}`,
        sourceName: name('freesound'),
        sourceUrl: r.sourceUrl,
      };
    },
  },
  {
    name: 'make_film',
    label: 'Film render',
    description:
      'Render ONE real short film (.mp4, H.264 + AAC): real Pixabay footage (clip_ids from stock_videos, played first) and/or images made for this decree (their urls), captions burned into the picture (one per scene, clips first), a spoken narration (Cloudflare MeloTTS; languages ' +
      I.TTS_LANGS.join(', ') +
      ') and a Freesound music bed (music_id from find_music) ducked under the voice. Up to 4 clips and 6 images, 2-8 scenes in total. The film is at least as long as the narration, so keep narration to about 15-40 seconds of speech (roughly 200-600 characters). Credits for every clip and the music (author, license, links) are recorded and shown with the player; list them in your result. Call it once, after you picked the clips and music.',
    schema: obj(
      {
        title: { type: 'string', description: 'Film title.' },
        clip_ids: { type: 'array', items: { type: 'integer' }, description: 'Pixabay video ids, in order (0-4).' },
        images: { type: 'array', items: { type: 'string' }, description: 'Optional /uploads/… urls of images made for this decree, shown after the clips (0-6).' },
        captions: { type: 'array', items: { type: 'string' }, description: 'One short caption per scene (clips first, then images), max 120 characters each.' },
        narration: { type: 'string', description: 'Optional voice-over text, max 1200 characters.' },
        narration_lang: { type: 'string', enum: [...I.TTS_LANGS], description: 'Narration language, default en.' },
        music_id: { type: 'integer', description: 'Optional Freesound sound id for the music bed.' },
      },
      ['title'],
    ),
    doing: () => 'Cutting the film (footage, voice, music)',
    run: async (i, c) => {
      const title = str(i, 'title', 100);
      const clipIds = intList(i, 'clip_ids', 4);
      const images = strList(i, 'images', 6, 200, false);
      const captions = strList(i, 'captions', 10, 120, false);
      const narration = str(i, 'narration', 1200, false);
      const lang = oneOf(i, 'narration_lang', I.TTS_LANGS, 'en');
      const musicId = i.music_id === undefined || i.music_id === null ? null : Math.round(num(i, 'music_id', 1, 1e12));
      const scenes = clipIds.length + images.length;
      if (scenes < 2 || scenes > 8) throw new ToolInputError('A film needs 2-8 scenes in total (clips + images).');
      for (const u of images) myImage(c, u);
      if (c.usage.films >= 1) throw new ToolInputError('Only one film per decree run.');
      c.usage.films++;

      const ctx = ctxOf(c);
      const notes: string[] = [];
      type Credit = { kind: 'footage' | 'music' | 'photo'; title: string; author: string; authorUrl: string; pageUrl: string; license: string; licenseUrl: string };
      const credits: Credit[] = [];
      const clips: string[] = [];
      const okIdx: number[] = [];
      for (const [k, id] of clipIds.entries()) {
        try {
          const v = await I.pixabayDownloadVideo(id, ctx, { maxHeight: 720 });
          clips.push(v.url);
          okIdx.push(k);
          credits.push({ kind: 'footage', title: `Pixabay clip ${id}`, author: v.author, authorUrl: v.authorUrl, pageUrl: v.pageUrl, license: v.license, licenseUrl: v.licenseUrl });
        } catch (e) {
          notes.push(`Clip ${id} could not be downloaded: ${(e as Error).message}`);
        }
      }
      for (const u of images) {
        const cr = myImage(c, u).meta.credit as Credit | undefined;
        if (cr && cr.author) credits.push({ ...cr, kind: 'photo', title: 'Pixabay photo' });
      }
      if (clips.length + images.length < 1) throw new ToolInputError(`No scenes left to film. ${notes.join(' ')}`);

      let narrationUrl: string | null = null;
      let narrationModel: string | null = null;
      if (narration) {
        try {
          const s = await I.cfSpeak(narration, ctx, { lang });
          narrationUrl = s.url;
          narrationModel = s.model;
        } catch (e) {
          notes.push(`Narration failed, so the film has no voice-over: ${(e as Error).message}`);
        }
      }
      let musicUrl: string | null = null;
      if (musicId) {
        try {
          const m = await I.freesoundDownload(musicId, ctx);
          musicUrl = m.url;
          credits.push({ kind: 'music', title: m.name, author: m.author, authorUrl: m.authorUrl, pageUrl: m.pageUrl, license: m.license, licenseUrl: m.licenseUrl });
        } catch (e) {
          notes.push(`Music ${musicId} could not be used: ${(e as Error).message}`);
        }
      }

      // Captions: drop the ones for clips that failed to download.
      const capList = captions.length ? [...okIdx.map((k) => captions[k] ?? ''), ...captions.slice(clipIds.length)] : [];
      const f = await I.makeFilm({ clips, images, captions: capList, narration: narrationUrl, music: musicUrl, maxClipSec: 6, secondsPerImage: 3.5, width: 1280, height: 720 });
      addArtifact(c.decreeId, c.revision, {
        kind: 'video',
        url: f.url,
        title,
        meta: {
          film: true,
          durationSec: f.durationSec,
          scenes: f.scenes,
          width: f.width,
          height: f.height,
          bytes: f.bytes,
          subtitles: f.subtitles,
          narration: f.narration,
          narrationText: narrationUrl ? narration : null,
          narrationModel,
          music: f.music,
          streams: f.streams,
          captions: capList,
          frames: images,
          credits,
          notes,
          renderer: 'ffmpeg (local)',
        },
      });
      return {
        data: { url: f.url, durationSec: f.durationSec, scenes: f.scenes, narration: f.narration, music: f.music, streams: f.streams, credits, problems: notes, note: 'Saved. The requester sees it in the Artifacts player with the credits. Include a Credits section with these authors, licenses and links.' },
        summary: `Rendered film “${title}” · ${f.scenes} scenes · ${f.durationSec} s · ${f.narration ? 'voice' : 'no voice'}${f.music ? ' + music' : ''}`,
        sourceName: 'ffmpeg (local render)',
        sourceUrl: f.url,
        produced: 'video',
        activity: `cut a ${Math.round(f.durationSec)}-second film`,
      };
    },
  },

  // ---------------- forge (GitHub Pages, PageSpeed, Firecrawl, GitHub read) ----------------
  {
    name: 'publish_site',
    label: 'Site publish',
    description:
      'Publish the latest web page you made with publish_web_page in THIS decree to the realm’s GitHub Pages under a short site name (slug). Call publish_web_page first. One per decree. The result says the real status: "prepared" (publishing is switched off on this server: nothing is online and there is NO url), "building" (committed, GitHub is still deploying: not live yet) or "live" (with the url). Report exactly that status; never give a site url unless the status is live.',
    schema: obj({ slug: { type: 'string', description: 'Site name: 1-48 lowercase letters, digits or dashes, e.g. "bakery-landing".' } }, ['slug']),
    doing: (i) => `Publishing the site ${q(String(i.slug), 30)}`,
    run: async (i, c) => {
      const slug = str(i, 'slug', 48).toLowerCase();
      try {
        I.checkSlug(slug);
      } catch (e) {
        throw new ToolInputError((e as Error).message);
      }
      const page = [...listArtifacts(c.decreeId)].reverse().find((a) => a.kind === 'html' && a.html);
      if (!page?.html) throw new ToolInputError('There is no web page in this decree yet. Build it with publish_web_page first.');
      if (c.usage.sites >= 1) throw new ToolInputError('Only one site publish per decree run.');
      c.usage.sites++;
      const r = await I.publishSite(slug, page.html, ctxOf(c), { waitMs: 30_000, message: `Publish ${slug} (decree ${c.decreeId})` });
      const status = r.mode === 'dry-run' ? 'dry-run' : r.status === 'live' ? 'live' : 'building';
      addArtifact(c.decreeId, c.revision, {
        kind: 'site',
        url: status === 'live' ? r.url : null,
        title: page.title,
        meta: { slug: r.slug, status, mode: r.mode, commitUrl: r.commitUrl, at: r.at, host: 'GitHub Pages' },
      });
      const data =
        status === 'live'
          ? { status: 'live', url: r.url, commitUrl: r.commitUrl, note: 'The page is live at this url (checked: it serves exactly this HTML).' }
          : status === 'building'
            ? { status: 'building', live: false, commitUrl: r.commitUrl, note: 'Committed to GitHub, but GitHub Pages is still deploying. It is NOT live yet; do not give a url. Tell the requester it should go live in a few minutes and the decree page will show the address when it is.' }
            : { status: 'prepared', live: false, note: 'Prepared for publishing, not live yet: publishing is switched off on this server (dry run). Nothing was uploaded and there is no url. Tell the requester exactly this.' };
      return {
        data,
        summary: status === 'live' ? `Site “${slug}” is live` : status === 'building' ? `Site “${slug}” committed, GitHub Pages still building` : `Site “${slug}” prepared for publishing (dry run, not live)`,
        sourceName: name('github'),
        sourceUrl: status === 'live' ? r.url : r.commitUrl,
        produced: 'site',
        activity: status === 'live' ? `published the site “${slug}”` : `prepared the site “${slug}” for publishing`,
      };
    },
  },
  {
    name: 'audit_site',
    label: 'Site audit',
    description: 'Run Google Lighthouse (PageSpeed Insights) on a public URL: performance, accessibility, best-practices and SEO scores (0-100), key metrics and top opportunities. Omit url to audit the site you published in this decree (only works once it is live). Takes up to a minute. At most 2 per decree.',
    schema: obj({ url: { type: 'string', description: 'Optional public URL.' }, strategy: { type: 'string', enum: ['mobile', 'desktop'], description: 'Default mobile.' } }, []),
    doing: (i) => (i.url ? `Auditing ${q(String(i.url).replace(/^https?:\/\//, ''), 36)} with Lighthouse` : 'Auditing the published site with Lighthouse'),
    run: async (i, c) => {
      let url = str(i, 'url', 500, false);
      const strategy = oneOf(i, 'strategy', ['mobile', 'desktop'] as const, 'mobile');
      if (!url) {
        const site = [...listArtifacts(c.decreeId)].reverse().find((a) => a.kind === 'site');
        if (!site) throw new ToolInputError('No site was published in this decree. Pass a public url.');
        if (!site.url) throw new ToolInputError('The site from this decree is not live (dry run or still building), so it cannot be audited yet. Say so, or audit another public url.');
        url = site.url;
      }
      safeHttp(url);
      if (c.usage.audits >= 2) throw new ToolInputError('Audit limit reached (2 per decree).');
      c.usage.audits++;
      const r = await I.auditSite(url, ctxOf(c), strategy);
      const metrics = r.metrics.slice(0, 6);
      const opportunities = r.opportunities.slice(0, 6);
      addArtifact(c.decreeId, c.revision, { kind: 'audit', title: `Lighthouse · ${r.url.replace(/^https?:\/\//, '').slice(0, 80)}`, meta: { url: r.url, strategy: r.strategy, scores: r.scores, metrics, opportunities, lighthouseVersion: r.lighthouseVersion, sourceUrl: r.sourceUrl, fetchedAt: r.fetchedAt } });
      return {
        data: { url: r.url, strategy: r.strategy, scores: r.scores, metrics, opportunities, report: r.sourceUrl },
        summary: `Lighthouse ${r.strategy}: ${Object.entries(r.scores).map(([k, v]) => `${k} ${v ?? '–'}`).join(', ')}`,
        sourceName: name('pagespeed'),
        sourceUrl: r.sourceUrl,
        produced: 'audit',
      };
    },
  },
  {
    name: 'scrape_site',
    label: 'Site scrape',
    description: 'Scrape a public website with Firecrawl as clean Markdown: pages=1 reads just that page, 2-3 crawls a few linked pages too. Use for redesign briefs, competitor teardown or content migration. At most 2 calls per decree.',
    schema: obj({ url: { type: 'string', description: 'Start URL.' }, pages: { type: 'integer', description: '1-3, default 1.' } }, ['url']),
    doing: (i) => `Scraping ${q(String(i.url ?? '').replace(/^https?:\/\//, ''), 36)}`,
    run: async (i, c) => {
      const url = safeHttp(str(i, 'url', 500));
      const pages = Math.round(num(i, 'pages', 1, 3, 1));
      if (c.usage.scrapes >= 2) throw new ToolInputError('Scrape limit reached (2 per decree).');
      c.usage.scrapes++;
      if (pages === 1) {
        const p = await I.scrapeUrl(url, ctxOf(c), 7000);
        return { data: { pages: [{ url: p.url, title: p.title, description: p.description, markdown: p.markdown, truncated: p.truncated }] }, summary: `Scraped “${clip(p.title || p.url, 60)}”`, sourceName: name('firecrawl'), sourceUrl: p.sourceUrl };
      }
      const r = await I.crawlSite(url, ctxOf(c), pages, 3000);
      return {
        data: { status: r.status, total: r.total, pages: r.pages.map((p) => ({ url: p.url, title: p.title, markdown: p.markdown, truncated: p.truncated })) },
        summary: `Crawled ${r.pages.length} page${r.pages.length === 1 ? '' : 's'} from ${clip(url.replace(/^https?:\/\//, ''), 40)} (${r.status})`,
        sourceName: name('firecrawl'),
        sourceUrl: r.sourceUrl,
      };
    },
  },
  {
    name: 'repo_info',
    label: 'Repository info',
    description:
      'Royal Inspection, step 1: metadata of a PUBLIC GitHub repository (description, default branch, stars, license, languages, last push) plus its latest commits. The newest commit sha is returned as `ref`: pass it to repo_tree and repo_file so every finding can link to a permanent line.',
    schema: obj({ repo: { type: 'string', description: '"owner/name" or a github.com URL.' } }, ['repo']),
    doing: (i) => `Inspecting ${q(String(i.repo), 40)} on GitHub`,
    run: async (i, c) => {
      const ref = ghRepo(str(i, 'repo', 200));
      const info = await I.repoInfo(ref, ctxOf(c));
      const commits = await I.repoCommits(ref, ctxOf(c), 5).catch(() => null);
      const head = commits?.results[0]?.sha ?? info.defaultBranch;
      return {
        data: { ...info, ref: head, recentCommits: commits?.results ?? [], linkPattern: `https://github.com/${info.owner}/${info.repo}/blob/${head}/<path>#L<line>` },
        summary: `${info.fullName} · ★${info.stars} · ${info.languages[0]?.name ?? 'no language'} · ref ${head}`,
        sourceName: name('github'),
        sourceUrl: info.sourceUrl,
        activity: `inspected the repository ${info.fullName}`,
      };
    },
  },
  {
    name: 'repo_tree',
    label: 'Repository tree',
    description: 'Royal Inspection, step 2: the file list of a public GitHub repository at a ref (up to 300 entries, with sizes). Use it to choose which files to read.',
    schema: obj({ repo: { type: 'string', description: '"owner/name".' }, ref: { type: 'string', description: 'Commit sha from repo_info (or a branch).' } }, ['repo']),
    doing: (i) => `Listing the files of ${q(String(i.repo), 40)}`,
    run: async (i, c) => {
      const ref = ghRepo(str(i, 'repo', 200));
      const at = str(i, 'ref', 120, false) || undefined;
      const t = await I.repoTree(ref, ctxOf(c), at, 300);
      return {
        data: { ref: t.ref, totalEntries: t.totalEntries, truncated: t.truncated, entries: t.entries.map((e) => (e.type === 'dir' ? `${e.path}/` : `${e.path} (${e.size ?? '?'} B)`)) },
        summary: `${t.totalEntries} entries in ${t.owner}/${t.repo}@${t.ref}`,
        sourceName: name('github'),
        sourceUrl: t.sourceUrl,
      };
    },
  },
  {
    name: 'repo_file',
    label: 'Repository file',
    description:
      'Royal Inspection, step 3: read one text file of a public GitHub repository at a ref. Lines come numbered ("12| code") and `link` is the permanent blob url: cite findings as [path#L12](link#L12). You only READ code; never claim you ran, built or tested it. At most 8 files per decree.',
    schema: obj(
      { repo: { type: 'string', description: '"owner/name".' }, path: { type: 'string', description: 'File path, e.g. "src/index.js".' }, ref: { type: 'string', description: 'Commit sha from repo_info (or a branch).' } },
      ['repo', 'path'],
    ),
    doing: (i) => `Reading ${q(String(i.path), 40)}`,
    run: async (i, c) => {
      const ref = ghRepo(str(i, 'repo', 200));
      const path = str(i, 'path', 300);
      const at = str(i, 'ref', 120, false) || undefined;
      if (c.usage.files >= 8) throw new ToolInputError('File limit reached (8 per decree). Write the report with what you have read.');
      c.usage.files++;
      const f = await I.repoFile(ref, path, ctxOf(c), at, 40_000);
      const usedRef = f.ref ?? at ?? 'HEAD';
      const link = `https://github.com/${f.owner}/${f.repo}/blob/${usedRef}/${f.path.split('/').map(encodeURIComponent).join('/')}`;
      if (f.binary || f.text == null) return { data: { path: f.path, binary: true, size: f.size, link }, summary: `${f.path} is binary (${f.size} B)`, sourceName: name('github'), sourceUrl: link };
      const n = numbered(f.text, 10_000);
      return {
        data: { path: f.path, ref: usedRef, size: f.size, lines: n.lines, shownLines: n.shownLines, truncated: f.truncated || n.shownLines < n.lines, link, text: n.text },
        summary: `Read ${f.path} (${n.lines} lines${n.shownLines < n.lines ? `, first ${n.shownLines} shown` : ''})`,
        sourceName: name('github'),
        sourceUrl: link,
      };
    },
  },

  // ---------------- jobs, transcripts, OCR, link scans, UK companies, nutrition, voice, brands ----------------
  {
    name: 'job_search',
    label: 'Job search',
    description:
      'Live job ads from Adzuna (19 countries: ' +
      I.ADZUNA_COUNTRIES.join(', ') +
      '). Returns up to 10 real ads with title, company, location, contract, salary range (marked when Adzuna estimated it), posting date, a snippet and the ad link. Use it to find real openings that fit a résumé; list only ads it returned, with their links. At most 3 searches per decree.',
    schema: obj(
      {
        query: { type: 'string', description: 'Job title or keywords, e.g. "junior data analyst".' },
        country: { type: 'string', enum: [...I.ADZUNA_COUNTRIES], description: 'Country code, default gb.' },
        where: { type: 'string', description: 'Optional city or region, e.g. "Manchester".' },
        salary_min: { type: 'number', description: 'Optional minimum yearly salary in local currency.' },
        full_time: { type: 'boolean', description: 'Optional: only full-time ads.' },
      },
      ['query'],
    ),
    doing: (i) => `Searching job ads for ${q(String(i.query))}`,
    run: async (i, c) => {
      const query = str(i, 'query', 120);
      const country = oneOf(i, 'country', I.ADZUNA_COUNTRIES, 'gb');
      const where = str(i, 'where', 80, false) || undefined;
      const salaryMin = i.salary_min === undefined || i.salary_min === null ? undefined : num(i, 'salary_min', 0, 10_000_000);
      if (i.full_time !== undefined && typeof i.full_time !== 'boolean') throw new ToolInputError('"full_time" must be true or false.');
      if (c.usage.jobs >= 3) throw new ToolInputError('Job-search limit reached (3 per decree). Work with the ads you have.');
      c.usage.jobs++;
      const r = await I.jobSearch(query, ctxOf(c), { country, where, max: 10, salaryMin, fullTime: i.full_time === true });
      return {
        data: { total: r.total, country: r.country, where: r.where, jobs: r.jobs, fetchedAt: r.fetchedAt, note: r.jobs.length ? 'Live ads; they can close at any time.' : 'No ads matched. Try broader keywords or another place.' },
        summary: `${r.jobs.length} job ads for ${q(query)}${r.where ? ` in ${r.where}` : ''} (${r.total.toLocaleString('en')} total)`,
        sourceName: name('adzuna'),
        sourceUrl: r.sourceUrl,
      };
    },
  },
  {
    name: 'transcribe_audio',
    label: 'Transcription',
    description:
      `Transcribe speech into text and subtitles with Whisper large-v3 turbo (Groq). Input: a public direct link to an audio or video file (mp3, wav, ogg, flac, m4a, mp4, webm; up to 80 MB download, audio is compressed to fit Groq's 25 MB limit) or an /uploads/ audio/video made in this decree. Only the first ${I.GROQ_MAX_SEC / 60} minutes are transcribed. Page links (YouTube, Drive previews, podcast pages) do not work; ask for the direct file link. Saves a .txt transcript and an .srt subtitle file as artifacts. One per decree. Machine transcripts contain errors on names and jargon: say so.`,
    schema: obj(
      {
        url: { type: 'string', description: 'Public direct link to the audio/video file, or an /uploads/… url made in this decree.' },
        title: { type: 'string', description: 'Short name for the transcript, e.g. "Episode 12 interview".' },
        language: { type: 'string', description: 'Optional 2-letter language code (e.g. "en", "id") to skip detection.' },
      },
      ['url', 'title'],
    ),
    doing: () => 'Transcribing the recording',
    run: async (i, c) => {
      const url = str(i, 'url', 1000);
      const title = str(i, 'title', 100);
      const language = str(i, 'language', 2, false).toLowerCase() || undefined;
      if (language && !/^[a-z]{2}$/.test(language)) throw new ToolInputError('"language" must be a 2-letter code.');
      if (c.usage.transcripts >= 1) throw new ToolInputError('Only one transcription per decree.');
      const src = url.startsWith('/uploads/') ? { upload: myMedia(c, url, ['audio', 'video']).url! } : { url: publicLink(url) };
      c.usage.transcripts++;
      const r = await I.groqTranscribe(src, ctxOf(c), { language });
      if (!r.text) throw new ToolInputError('No speech was found in that recording.');
      const txt = saveText('transcript', 'txt', r.text + '\n');
      const srt = r.srt ? saveText('subtitles', 'srt', r.srt) : null;
      const meta = { provider: `Groq (${r.model})`, language: r.language, durationSec: r.durationSec, truncated: r.truncated, source: url.startsWith('/uploads/') ? url : r.source, sourceUrl: r.sourceUrl };
      addArtifact(c.decreeId, c.revision, { kind: 'file', url: txt.url, title: `${title} (transcript)`, meta: { ...meta, format: 'txt', bytes: txt.bytes, preview: r.text.slice(0, 600) } });
      if (srt) addArtifact(c.decreeId, c.revision, { kind: 'file', url: srt.url, title: `${title} (subtitles)`, meta: { ...meta, format: 'srt', bytes: srt.bytes, cues: r.segments.length } });
      return {
        data: {
          language: r.language,
          durationSec: r.durationSec,
          truncated: r.truncated,
          text: clip(r.text, 9000),
          segments: r.segments.slice(0, 40).map((s) => ({ start: Math.round(s.start * 10) / 10, end: Math.round(s.end * 10) / 10, text: s.text })),
          files: { transcript: txt.url, subtitles: srt?.url ?? null },
          note: 'The .txt and .srt files are saved and shown to the requester. Quote the transcript faithfully; flag words that look misheard.',
        },
        summary: `Transcribed “${title}” · ${Math.round(r.durationSec)} s · ${r.language ?? 'language unknown'}`,
        sourceName: name('groq'),
        sourceUrl: r.sourceUrl,
        produced: 'file',
        activity: `transcribed ${Math.round(r.durationSec)} seconds of audio`,
      };
    },
  },
  {
    name: 'read_image_text',
    label: 'Text from image (OCR)',
    description:
      'Read the text in a photo, screenshot, receipt, invoice or PDF with OCR.space (engine 2, auto language). Input: a public direct link to a JPG/PNG/GIF/PDF, or an /uploads/ image made in this decree. Free-plan limits: files up to 1 MB and PDFs up to 3 pages. Set table=true for receipts, invoices and tables (keeps line order). Returns the raw text; OCR can misread digits, so mark any value you are unsure of. At most 3 per decree.',
    schema: obj(
      {
        url: { type: 'string', description: 'Public direct link to the image/PDF, or an /uploads/… image url made in this decree.' },
        table: { type: 'boolean', description: 'true for receipts, invoices and tables.' },
      },
      ['url'],
    ),
    doing: () => 'Reading the text in the image',
    run: async (i, c) => {
      const url = str(i, 'url', 1000);
      if (i.table !== undefined && typeof i.table !== 'boolean') throw new ToolInputError('"table" must be true or false.');
      if (c.usage.ocr >= 3) throw new ToolInputError('OCR limit reached (3 per decree).');
      const src = url.startsWith('/uploads/') ? { upload: myMedia(c, url, ['image']).url! } : { url: publicLink(url) };
      c.usage.ocr++;
      const r = await I.ocrRead(src, ctxOf(c), { table: i.table === true });
      return {
        data: { text: r.text, pages: r.pages, truncated: r.truncated, empty: !r.text.trim() },
        summary: r.text.trim() ? `Read ${r.text.length.toLocaleString('en')} characters from ${r.pages} page${r.pages === 1 ? '' : 's'}` : 'No text found in the image',
        sourceName: name('ocrspace'),
        sourceUrl: r.sourceUrl,
      };
    },
  },
  {
    name: 'scan_url',
    label: 'Link scan',
    description:
      'Open a suspicious link in urlscan.io’s sandboxed browser (scan is unlisted, not public) and report what it really loads: urlscan’s verdict (malicious flag, score, categories, impersonated brands), the final URL after redirects, page domain, IP, hosting network, server, TLS certificate issuer and dates, and a screenshot saved as an image artifact. Takes up to about a minute. A clean verdict is not proof a link is safe (new phishing pages are often not flagged yet): say so. At most 2 per decree.',
    schema: obj({ url: { type: 'string', description: 'The link to scan, e.g. "https://paypa1-secure-login.com/verify".' } }, ['url']),
    doing: (i) => `Scanning ${q(String(i.url ?? '').replace(/^https?:\/\//, ''), 40)} in a sandbox`,
    run: async (i, c) => {
      const url = publicLink(str(i, 'url', 1000));
      if (c.usage.scans >= 2) throw new ToolInputError('Link-scan limit reached (2 per decree).');
      c.usage.scans++;
      const r = await I.scanUrl(url, ctxOf(c));
      let shot: string | null = null;
      const png = await I.urlscanScreenshot(r, ctxOf(c));
      if (png) {
        try {
          const saved = I.saveUpload(png, 'scan', ['png', 'jpg'], 'screenshot');
          const size = pngSize(png);
          addArtifact(c.decreeId, c.revision, {
            kind: 'image',
            url: saved.url,
            title: `Screenshot of ${(r.page.domain ?? url).slice(0, 80)} (urlscan.io sandbox)`,
            meta: { provider: 'urlscan.io', width: size?.w ?? 1280, height: size?.h ?? 1024, bytes: saved.bytes, sourceUrl: r.reportUrl, alt: `Sandbox screenshot of ${r.finalUrl ?? url}` },
          });
          shot = saved.url;
        } catch {
          shot = null;
        }
      }
      const { uuid: _u, sourceUrl: _s, screenshotUrl: _x, ...rest } = r;
      return {
        data: { ...rest, screenshot: shot, note: 'Report the verdict exactly. "malicious: false" only means urlscan.io did not flag it.' },
        summary: `Scanned ${r.page.domain ?? url}: ${r.verdict.malicious ? 'flagged malicious' : 'not flagged'}${r.verdict.score != null ? ` (score ${r.verdict.score})` : ''}`,
        sourceName: name('urlscan'),
        sourceUrl: r.reportUrl,
        produced: shot ? 'image' : undefined,
        activity: `scanned a suspicious link in the sandbox`,
      };
    },
  },
  {
    name: 'uk_company_search',
    label: 'UK company search',
    description: 'Search the official UK Companies House register by company name. Returns up to 8 companies with company number, status (active, dissolved, liquidation…), type, incorporation date, registered address and register link. Then call uk_company_profile with the right number. At most 3 per decree.',
    schema: obj({ query: { type: 'string', description: 'Company name, e.g. "Monzo Bank".' } }, ['query']),
    doing: (i) => `Searching Companies House for ${q(String(i.query))}`,
    run: async (i, c) => {
      const query = str(i, 'query', 160);
      if (c.usage.ukSearches >= 3) throw new ToolInputError('Companies House search limit reached (3 per decree).');
      c.usage.ukSearches++;
      const r = await I.ukCompanySearch(query, ctxOf(c), 8);
      return { data: { total: r.total, results: r.results }, summary: `${r.results.length} UK companies for ${q(query)}`, sourceName: name('companieshouse'), sourceUrl: r.sourceUrl };
    },
  },
  {
    name: 'uk_company_profile',
    label: 'UK company profile',
    description:
      'Full Companies House record for one UK company number: status, type, incorporation/dissolution dates, registered office, SIC codes, whether accounts or the confirmation statement are overdue, charges and insolvency flags, current officers (directors, secretaries, with appointment dates) and the 10 latest filings. Use it to check a company before dealing with it; report red flags (overdue filings, recent officer churn, insolvency history) and link the register page. At most 3 per decree.',
    schema: obj({ company_number: { type: 'string', description: '8-character company number, e.g. "00445790" or "SC123456".' } }, ['company_number']),
    doing: (i) => `Reading the Companies House record ${String(i.company_number ?? '')}`,
    run: async (i, c) => {
      const n = str(i, 'company_number', 12).toUpperCase();
      if (!I.isCompanyNumber(n)) throw new ToolInputError('"company_number" must be the 8-character Companies House number (pad with leading zeros, e.g. 00445790).');
      if (c.usage.ukProfiles >= 3) throw new ToolInputError('Companies House profile limit reached (3 per decree).');
      c.usage.ukProfiles++;
      const r = await I.ukCompanyProfile(n, ctxOf(c));
      return { data: r, summary: `${r.name} (${r.number}) · ${r.status ?? 'status unknown'}`, sourceName: name('companieshouse'), sourceUrl: r.url };
    },
  },
  {
    name: 'nutrition_lookup',
    label: 'Nutrition lookup',
    description:
      'Look up one food or ingredient in USDA FoodData Central (Foundation and SR Legacy foods first, survey foods as fallback). Returns up to 5 matches with fdcId, description, data type, link and key nutrients per 100 g (energy kcal, protein, fat, saturated fat, carbohydrate, fibre, sugars, sodium, potassium, calcium, iron, vitamin C, cholesterol). Pick the match that fits (raw vs cooked matters), scale by the real gram amounts and show your arithmetic. At most 4 lookups per decree, so search the main ingredients.',
    schema: obj({ food: { type: 'string', description: 'One food in English, e.g. "banana raw", "chicken breast roasted", "rolled oats".' } }, ['food']),
    doing: (i) => `Looking up nutrition for ${q(String(i.food))}`,
    run: async (i, c) => {
      const food = str(i, 'food', 120);
      if (c.usage.nutrition >= 4) throw new ToolInputError('Nutrition lookup limit reached (4 per decree). Estimate the rest from similar foods and say so.');
      c.usage.nutrition++;
      const r = await I.nutritionLookup(food, ctxOf(c), 5);
      return {
        data: { total: r.total, results: r.results, note: r.results.length ? 'Values are per 100 g of the food as described.' : 'No match. Try a simpler or more generic name.' },
        summary: `${r.results.length} USDA foods for ${q(food)}`,
        sourceName: name('usda'),
        sourceUrl: r.sourceUrl,
      };
    },
  },
  {
    name: 'record_voiceover',
    label: 'Voice-over recording',
    description:
      `Record a real MP3 voice-over with ElevenLabs (model ${I.ELEVEN_MODEL}, many languages; the text language is detected). Voices: ` +
      I.ELEVEN_VOICE_LIST.map((v) => `${v.name} (${v.description})`).join('; ') +
      `. Max ${I.VOICE_MAX_CHARS} characters per call; write it to be read aloud (plain punctuation, no stage directions or markup, numbers as words where it matters). The realm has a small monthly voice allowance, so the tool may refuse when it is used up: then deliver the script only and say so. One per decree. The file is shown to the requester with the credit "Voice by ElevenLabs".`,
    schema: obj(
      {
        text: { type: 'string', description: `The exact words to speak, max ${I.VOICE_MAX_CHARS} characters.` },
        voice: { type: 'string', enum: [...I.ELEVEN_VOICES], description: `Voice name, default ${I.ELEVEN_VOICES[0]}.` },
        title: { type: 'string', description: 'Short title, e.g. "Podcast intro, take 1".' },
      },
      ['text', 'title'],
    ),
    doing: () => 'Recording the voice-over',
    run: async (i, c) => {
      const text = str(i, 'text', I.VOICE_MAX_CHARS);
      const title = str(i, 'title', 100);
      const voice = oneOf(i, 'voice', I.ELEVEN_VOICES, I.ELEVEN_VOICES[0]);
      if (c.usage.voiceovers >= 1) throw new ToolInputError('Only one voice-over recording per decree.');
      c.usage.voiceovers++;
      let r: Awaited<ReturnType<typeof I.elevenSpeak>>;
      try {
        r = await I.elevenSpeak(text, ctxOf(c), { voice });
      } catch (e) {
        if (e instanceof I.QuotaError) throw new ToolInputError(e.message + ' Deliver the script without a recording and say so.');
        throw e;
      }
      addArtifact(c.decreeId, c.revision, {
        kind: 'audio',
        url: r.url,
        title,
        meta: { provider: 'ElevenLabs', model: r.model, voice: r.voice, durationSec: r.durationSec, bytes: r.bytes, chars: r.chars, format: 'mp3', text, attribution: r.attribution, sourceUrl: r.sourceUrl },
      });
      return {
        data: { url: r.url, voice: r.voice, durationSec: r.durationSec, chars: r.chars, note: 'Saved as an MP3 the requester can play and download. Credit it as "Voice by ElevenLabs".' },
        summary: `Recorded “${title}” · ${r.voice} · ${r.durationSec != null ? `${Math.round(r.durationSec)} s` : `${r.chars} chars`}`,
        sourceName: name('elevenlabs'),
        sourceUrl: r.sourceUrl,
        produced: 'audio',
        activity: `recorded a voice-over`,
      };
    },
  },
  {
    name: 'brand_lookup',
    label: 'Brand lookup',
    description:
      'Brand assets of a company from Brandfetch by its website domain: name, short description, logo files (svg/png links, light/dark, icon vs full logo), brand colours (hex with role: accent, dark, light, brand) and fonts (name, title/body, Google or custom). Each domain is looked up once and kept, and the realm has a small one-time lookup allowance, so look up only the brands the decree is about (max 2 new domains per decree). Report only what it returns; if a field is empty, say Brandfetch had no data.',
    schema: obj({ domain: { type: 'string', description: 'Company domain, e.g. "stripe.com".' } }, ['domain']),
    doing: (i) => `Looking up the brand of ${String(i.domain ?? '').slice(0, 60)}`,
    run: async (i, c) => {
      let domain: string;
      try {
        domain = I.normalizeDomain(str(i, 'domain', 200));
      } catch (e) {
        throw new ToolInputError((e as Error).message);
      }
      if (c.usage.brands >= 2) throw new ToolInputError('Brand lookup limit reached (2 per decree).');
      c.usage.brands++;
      let r: Awaited<ReturnType<typeof I.brandLookup>>;
      try {
        r = await I.brandLookup(domain, ctxOf(c));
      } catch (e) {
        if (e instanceof I.QuotaError) throw new ToolInputError(e.message);
        throw e;
      }
      const { callsLeft: _l, ...data } = r;
      return {
        data: r.found ? data : { domain: r.domain, found: false, note: 'Brandfetch has no brand for this domain. Work from the company website instead.' },
        summary: r.found ? `Brand of ${r.name ?? domain}: ${r.logos.length} logos, ${r.colors.length} colours, ${r.fonts.length} fonts` : `No Brandfetch brand for ${domain}`,
        sourceName: name('brandfetch'),
        sourceUrl: r.sourceUrl,
      };
    },
  },
  ...NEW_GUILD_TOOLS(),
];

const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

const COMMON = ['wiki_search', 'wiki_summary'];
const GUILD_TOOLS: Record<ProvinceId, string[]> = {
  throne: ['current_weather', 'web_search'],
  forge: ['publish_web_page', 'publish_site', 'audit_site', 'scrape_site', 'repo_info', 'repo_tree', 'repo_file', 'scan_url', 'check_vulnerabilities'],
  scriptorium: ['check_grammar', 'define_word', 'related_words', 'translate', 'job_search'],
  atelier: ['design_image', 'generate_image', 'stock_photos', 'use_stock_photo', 'unsplash_photos', 'use_unsplash_photo', 'remove_background', 'brand_lookup'],
  theatre: ['design_image', 'stock_videos', 'find_music', 'make_film', 'generate_image', 'make_video', 'transcribe_audio', 'record_voiceover'],
  archive: ['web_search', 'read_url', 'exa_search', 'search_openalex', 'search_arxiv', 'search_openlibrary', 'world_bank_indicator', 'fred_search', 'fred_series', 'ask_wolfram', 'nutrition_lookup', 'read_image_text', 'guardian_news', 'nyt_news', 'nyt_bestsellers'],
  heralds: ['news', 'guardian_news', 'nyt_news', 'youtube_trending', 'youtube_search', 'web_search', 'hn_stories', 'mastodon_trends', 'design_image', 'generate_image', 'draft_bluesky_post'],
  bazaar: ['local_businesses', 'find_similar_companies', 'web_search', 'read_url', 'fx_convert', 'fx_rates', 'fx_history', 'world_bank_indicator', 'public_holidays', 'uk_company_search', 'uk_company_profile', 'brand_lookup', 'recipe_search'],
  treasury: ['stock_quote', 'company_profile', 'company_news', 'fred_search', 'fred_series', 'ask_wolfram', 'fx_convert', 'fx_rates', 'fx_history', 'world_bank_indicator', 'public_holidays', 'read_image_text', 'uk_company_search', 'uk_company_profile'],
  court: ['case_law', 'federal_register', 'web_search', 'read_url', 'read_image_text', 'scan_url'],
  observatory: ['nasa_apod', 'near_earth_asteroids', 'nasa_images', 'earthquakes', 'iss_position', 'air_quality', 'current_weather', 'web_search', 'search_arxiv'],
  apothecary: ['drug_label', 'fda_recalls', 'pubmed_search', 'clinical_trials', 'nutrition_lookup', 'web_search', 'read_url'],
  arena: ['football_table', 'football_matches', 'film_search', 'film_trending', 'music_charts', 'music_artist', 'game_deals', 'free_games', 'youtube_search', 'web_search', 'design_image'],
};

export const toolNamesFor = (p: ProvinceId) => [...(GUILD_TOOLS[p] ?? []), ...COMMON];

/** Guild tools the owner's charter allows (null = all). */
export const allowedToolNames = (p: ProvinceId, allowed: string[] | null) => toolNamesFor(p).filter((n) => !allowed || allowed.includes(n));

/** Tool definitions for the Messages API (eager input streaming; inputs validated in runTool). */
export function toolsFor(p: ProvinceId, allowed: string[] | null = null): Anthropic.Beta.BetaTool[] {
  return allowedToolNames(p, allowed).map((n) => {
    const t = BY_NAME.get(n)!;
    return { name: t.name, description: t.description, input_schema: t.schema, eager_input_streaming: true };
  });
}

/** Guild-specific guidance added to the system prompt. */
export function toolGuidance(p: ProvinceId): string {
  const lim = IMAGE_LIMIT[p];
  switch (p) {
    case 'atelier':
      return [
        `- You can paint real images with generate_image (Cloudflare FLUX, 1 to ${lim} per decree) or use real Pixabay photos (stock_photos, then use_stock_photo) when real photography fits better. Every image gets alt text automatically; include it in your notes.`,
        '- remove_background makes one transparent cutout per decree (tiny free quota): only when the decree needs it.',
        '- Credit every Pixabay photo (photographer + link) in your result.',
        '- unsplash_photos / use_unsplash_photo give high-quality Unsplash photos (small hourly allowance). Credit each one exactly as "Photo by <name> on Unsplash" with the photographer and photo links.',
        '- For a brand teardown or a "make it look like X" brief, brand_lookup the company domain first and use its real logos, hex colours and fonts; say when Brandfetch had no data.',
      ].join('\n');
    case 'theatre':
      return [
        '- For a film: find 2-4 real clips with stock_videos and a music bed with find_music, write a short narration (about 15-40 seconds of speech), then call make_film ONCE with clip_ids, captions, narration and music_id. You may add images from generate_image as extra scenes.',
        '- If footage is unsuitable or make_film fails, fall back to 3-4 generate_image frames and make_video (silent slideshow), and say so.',
        '- End the result with a "Credits" section listing every clip author and the music (title, author, license) with the links make_film returned. Only state that the film has a voice or music if make_film reported it.',
        '- transcribe_audio turns a public direct audio/video link into a transcript (.txt) and subtitles (.srt). If the requester gave a page link (YouTube, Drive preview), ask for the direct file instead of guessing the content.',
        '- record_voiceover records one MP3 voice-over (max 1,500 characters). Write the script first, then record exactly that script. Credit it as "Voice by ElevenLabs". If the voice allowance is used up, deliver the script and say so.',
      ].join('\n');
    case 'heralds':
      return [
        `- Ground campaigns in what is happening now: news (GNews), youtube_trending / youtube_search, web_search, hn_stories, mastodon_trends. You may paint up to ${lim} visuals with generate_image.`,
        '- draft_bluesky_post only QUEUES one draft for the Herald (a human) to approve. Never say it was posted or give a post link; say it is waiting for approval.',
        '- guardian_news and nyt_news give headline, short summary and link only: never reproduce or paraphrase whole articles; quote the headline and link back.',
      ].join('\n');
    case 'forge':
      return [
        '- When the decree asks for anything that runs in a browser, build it with publish_web_page (live sandbox preview). Explain the structure briefly instead of repeating the whole file.',
        '- If the requester wants it online, call publish_site after publish_web_page and report its exact status: "prepared for publishing, not live yet" (dry run), "building" or "live". Give a site url only when the status is live. audit_site runs Lighthouse on a live url.',
        '- For a redesign brief, scrape_site the current site first (1-3 pages). For a speed/SEO review, audit_site the url.',
        '- Royal Inspection of a GitHub repository: repo_info → repo_tree → repo_file on the few files that matter (use the ref from repo_info). Link every finding to its line as [path#L12](https://github.com/owner/repo/blob/<ref>/<path>#L12). State plainly in the report that the code was read, not executed, built or tested.',
        '- check_vulnerabilities looks up known vulnerabilities for a package version on OSV.dev (e.g. dependencies from package.json). Report ids, severity and fixed versions; no result is not proof of safety.',
        '- For "is this link safe?", run scan_url and report urlscan.io’s verdict, final URL, hosting and certificate exactly. A clean verdict is not proof of safety; list the warning signs you can see yourself (look-alike domain, very new certificate, login form on an unrelated domain).',
      ].join('\n');
    case 'scriptorium':
      return [
        '- Before you deliver a text of more than a few sentences, run check_grammar on your draft and fix the real issues (ignore false alarms on names and stylistic choices).',
        '- For translations, use translate (machine translation) as a first pass, then polish it yourself and say that you did.',
        '- For job hunting, use job_search (live Adzuna ads) and list only real ads it returned, with title, company, location, salary as given and the link. Say that ads can close at any time.',
      ].join('\n');
    case 'archive':
      return '- For research, look up real sources (web_search + read_url for the current web, exa_search for companies/papers/projects, search_openalex, search_arxiv, search_openlibrary, world_bank_indicator, fred_series, ask_wolfram for calculations, Wikipedia) and cite them with the urls the tools return.\n- For nutrition, use nutrition_lookup (USDA FoodData Central, per 100 g) for each main ingredient, scale by the real amounts and show the arithmetic; mark anything estimated. read_image_text reads text from a public image or PDF link.\n- guardian_news, nyt_news and nyt_bestsellers give headlines, short summaries and links only (never full articles): cite and link them.';
    case 'bazaar':
      return [
        '- For local markets, use local_businesses (real OpenStreetMap businesses worldwide) and list the actual names and addresses it returns; note that coverage varies. Use find_similar_companies to map competitors from a company url, web_search / read_url for current details.',
        '- Use fx_convert / fx_rates / fx_history for exchange rates, world_bank_indicator for macro figures and public_holidays for calendars. Never guess these numbers.',
        '- To check a UK company, use uk_company_search then uk_company_profile (official Companies House register) and report status, age, officers, overdue filings and other red flags with the register link. brand_lookup gives a company’s real logos, colours and fonts.',
        '- recipe_search (TheMealDB) gives real recipes with ingredients for food businesses and menus; say when it has no match.',
      ].join('\n');
    case 'treasury':
      return '- Use stock_quote / company_profile / company_news (Finnhub) for listed companies, fred_series for official US rates and series, ask_wolfram for calculations, fx tools for exchange rates and world_bank_indicator for macro figures. Never guess these numbers, and note that this is not financial advice.\n- read_image_text reads a receipt, invoice or statement from a public image/PDF link (use table=true); rebuild it as a clean table and flag any digit the OCR may have misread. uk_company_search / uk_company_profile check UK companies on the official register.';
    case 'court':
      return '- Use case_law (CourtListener) for US court opinions, federal_register for US federal rules and notices, and web_search for other jurisdictions; cite case names, document numbers and urls. Make clear this is general information, not legal advice.\n- When a scam or phishing link is part of the facts, scan_url records what it really loads (unlisted urlscan.io scan with screenshot) as evidence; report the verdict exactly.\n- When the requester gives a public link to a contract, policy or terms page, read it with read_url; for a public image or PDF scan of a document, use read_image_text. Say how much of the document you could read.';
    case 'throne':
      return '- Use current_weather when the decree depends on the weather somewhere right now, and web_search for current facts.';
    case 'observatory':
      return [
        '- Use earthquakes (USGS), near_earth_asteroids and nasa_apod / nasa_images (NASA), iss_position, air_quality (OpenAQ) and current_weather for live space and earth facts; cite the event, asteroid or station links they return. search_arxiv finds astronomy and earth-science preprints.',
        '- Report numbers exactly with units and times (UTC). "Potentially hazardous" asteroids are an orbit class, not an impact forecast. For air quality, name the station and its distance. If NASA APOD is down, say so and use nasa_images.',
      ].join('\n');
    case 'apothecary':
      return [
        '- Use drug_label (FDA labels), fda_recalls, pubmed_search, clinical_trials and nutrition_lookup, and cite every label, paper or trial link.',
        '- Start or end every result with the line "Information, not medical advice." Never diagnose, never give personal dosing beyond quoting the label, and tell the requester to ask a doctor or pharmacist. For emergencies, tell them to contact local emergency services.',
      ].join('\n');
    case 'arena':
      return [
        '- Use football_table / football_matches (football-data.org, major competitions only), film_search / film_trending (TMDB), music_charts / music_artist (Last.fm + MusicBrainz), game_deals (CheapShark) and free_games (FreeToGame). Never guess scores, tables or prices.',
        '- Credit sources in the result: "Data: TMDB" (link themoviedb.org) for film/TV, "Data from FreeToGame.com" for free games, Last.fm for charts. Prices change fast: give the time they were fetched.',
      ].join('\n');
  }
}

export interface ToolOutcome {
  content: string;
  isError: boolean;
  result: ToolResult | null;
  error: string | null;
}

/** Validate and run one tool call. Never throws. */
export async function runTool(toolName: string, input: unknown, c: ToolCtx): Promise<ToolOutcome> {
  const t = BY_NAME.get(toolName);
  if (!t || !toolNamesFor(c.province).includes(toolName)) return { content: `Unknown tool "${toolName}".`, isError: true, result: null, error: `Unknown tool "${toolName}"` };
  if (c.allowed && !c.allowed.includes(toolName))
    return { content: `The owner's charter does not allow "${toolName}" for this agent. Use your other tools or say what you could not do.`, isError: true, result: null, error: 'Not allowed by the charter' };
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    let raw = '';
    try {
      raw = JSON.stringify(input);
    } catch {
      /* ignore */
    }
    return { content: JSON.stringify({ INVALID_JSON: raw }), isError: true, result: null, error: 'Invalid tool input' };
  }
  const allowed = Object.keys((t.schema.properties ?? {}) as object);
  const extra = Object.keys(input).filter((k) => !allowed.includes(k));
  if (extra.length) return { content: `Unknown field(s): ${extra.join(', ')}. Allowed: ${allowed.join(', ')}.`, isError: true, result: null, error: 'Invalid tool input' };
  try {
    const r = await t.run(input as O, c);
    return { content: JSON.stringify(r.data).slice(0, 12_000), isError: false, result: r, error: null };
  } catch (e) {
    let msg: string;
    if (e instanceof ToolInputError) msg = e.message;
    else if (e instanceof I.UpstreamError) msg = `${name(e.provider)} failed${e.status ? ` (HTTP ${e.status})` : ''}: ${e.message}`;
    else msg = (e as Error)?.message || 'The tool failed.';
    return { content: `Tool failed: ${msg}`, isError: true, result: null, error: msg };
  }
}

export const toolDoing = (toolName: string, input: unknown) => {
  const t = BY_NAME.get(toolName);
  try {
    return t ? t.doing((input && typeof input === 'object' ? input : {}) as O) : `Using ${toolName}`;
  } catch {
    return `Using ${t?.label ?? toolName}`;
  }
};
export const toolLabel = (toolName: string) => BY_NAME.get(toolName)?.label ?? toolName;
