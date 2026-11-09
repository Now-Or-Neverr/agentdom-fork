// Royal duties: automatic work agents do with free public APIs (no Claude, no credit).
//
// Scheduler (startDuties): every ~45-60 s one active agent that is not working on a decree
// (the one that waited longest since its last duty) does one real duty for its guild.
// - every summary is built only from the API response; the row keeps the source link
// - a provider is not hit by duties more than once per minute (PROVIDER_GAP_MS)
// - at most DUTIES_PER_HOUR duties per hour; DUTIES=off disables the scheduler
// - failures are logged to the console and skipped: no duty row is written
// - all state that matters lives in the `duties` table, so restarts are safe
import { db, now, uid, type Row } from './db';
import { logActivity } from './events';
import { workingAgents } from './core';
import * as I from './integrations';
import { PROVINCE, type ProvinceId } from '../shared/realm';
import type { Duty } from '../shared/live';

db.exec(`
CREATE TABLE IF NOT EXISTS duties (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  province TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT 'null',
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  image_url TEXT,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS duties_at ON duties(at);
CREATE INDEX IF NOT EXISTS duties_agent ON duties(agent_id, at);
CREATE INDEX IF NOT EXISTS duties_kind ON duties(kind, at);
`);

// How long a finished duty keeps the agent in the "duty" state on the map.
export const DUTY_SHOW_MS = 4 * 60 * 1000;

const INTERVAL_MS = Math.max(20_000, Number(process.env.DUTY_INTERVAL_MS) || 50_000);
const PER_HOUR = Math.max(1, Number(process.env.DUTIES_PER_HOUR) || 60);
const PROVIDER_GAP_MS = 60_000;
const FAIL_COOLDOWN_MS = 15 * 60_000;
const IDLE_COOLDOWN_MS = 30 * 60_000; // a kind with nothing new waits this long before it is tried again
const POSTER_EVERY_MS = (Number(process.env.DUTY_POSTER_HOURS) || 4) * 60 * 60_000;

export function toDuty(r: Row): Duty {
  const a = db.prepare('SELECT name FROM agents WHERE id = ?').get(r.agent_id) as Row | undefined;
  let data: unknown = null;
  try {
    data = JSON.parse(r.data);
  } catch {
    /* keep null */
  }
  return {
    id: r.id,
    agentId: r.agent_id,
    agentName: a?.name ?? 'Unknown',
    province: r.province,
    kind: r.kind,
    title: r.title,
    summary: r.summary,
    data,
    sourceName: r.source_name,
    sourceUrl: r.source_url,
    imageUrl: r.image_url ?? null,
    at: r.at,
  };
}

// Latest duty per agent finished within DUTY_SHOW_MS.
export function recentDutyByAgent(): Map<string, Row> {
  const since = new Date(Date.now() - DUTY_SHOW_MS).toISOString();
  const rows = db.prepare('SELECT * FROM duties WHERE at >= ? ORDER BY at DESC').all(since) as Row[];
  const out = new Map<string, Row>();
  for (const r of rows) if (!out.has(r.agent_id)) out.set(r.agent_id, r);
  return out;
}

// The duty being carried out right now (an API call is in flight), if any.
export interface DutyInProgress {
  agentId: string;
  kind: string;
  task: string;
  since: string;
}
let current: DutyInProgress | null = null;
export const dutyInProgress = () => current;

// ---------------- duty kinds ----------------
interface DutyResult {
  key: string; // what was reported; the same key is not reported twice within the kind's window
  title: string;
  summary: string;
  data: Record<string, unknown>;
  sourceName: string;
  sourceUrl: string;
  imageUrl?: string | null;
}
interface DutyKind {
  kind: string;
  province: ProvinceId;
  providers: string[];
  task: string; // shown on the map while the call is in flight
  repeatHours: number; // window in which the same key is not reported again
  run: (ctx: I.CallContext, seen: Set<string>) => Promise<DutyResult | null>;
}

const n0 = (n: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n);
const n2 = (n: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: n >= 100 ? 2 : 4 }).format(n);
const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
const today = () => new Date().toISOString().slice(0, 10);
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const firstSentence = (s: string) => {
  const m = s.match(/^.+?[.!?](\s|$)/);
  return (m ? m[0] : s).trim();
};
const COUNTRY: Record<string, string> = { ID: 'Indonesia', US: 'the United States', GB: 'the United Kingdom', JP: 'Japan', DE: 'Germany', FR: 'France', BR: 'Brazil', IN: 'India', SG: 'Singapore', AU: 'Australia', CA: 'Canada', KR: 'South Korea', CN: 'China', MX: 'Mexico', NG: 'Nigeria', ZA: 'South Africa' };
const CURRENCY_NAME: Record<string, string> = { IDR: 'rupiah', EUR: 'euro', JPY: 'yen', CNY: 'yuan', GBP: 'pound', SGD: 'Singapore dollar', USD: 'US dollar', AUD: 'Australian dollar', INR: 'rupee', KRW: 'won', CHF: 'Swiss franc', CAD: 'Canadian dollar' };

const RESEARCH_TOPICS = ['AI agents', 'large language models', 'climate change', 'renewable energy', 'quantum computing', 'protein folding', 'robotics', 'dark matter', 'battery chemistry', 'coral reefs', 'gene editing', 'exoplanets'];
const MED_TOPICS = ['hypertension', 'type 2 diabetes', 'asthma', 'migraine', 'sleep', 'vaccines', 'antibiotic resistance', 'depression', 'Alzheimer disease', 'heart failure', 'obesity', 'malaria', 'dengue', 'gut microbiome'];
const SE_TOPICS = ['software engineering', 'program synthesis', 'code generation', 'static analysis', 'software testing', 'type inference', 'compiler optimization'];
const TECH_TOPICS = ['typescript', 'rust', 'sqlite', 'postgres', 'webassembly', 'react', 'node.js', 'linux', 'python', 'kubernetes', 'git', 'open source'];
const WORDS = [
  'serendipity', 'ephemeral', 'luminous', 'resilient', 'eloquent', 'meticulous', 'tenacious', 'gregarious', 'quixotic', 'ineffable',
  'sonorous', 'halcyon', 'petrichor', 'labyrinth', 'zephyr', 'ebullient', 'sagacious', 'ubiquitous', 'wistful', 'candor',
  'benevolent', 'cogent', 'diligent', 'fervent', 'gossamer', 'harbinger', 'idyllic', 'jubilant', 'kindred', 'lucid',
  'mellifluous', 'nebulous', 'oblivion', 'paragon', 'quintessence', 'reverie', 'solace', 'tranquil', 'umbra', 'vestige',
  'whimsical', 'yearning', 'zenith', 'aplomb', 'bucolic', 'clandestine', 'dulcet', 'effervescent', 'felicity', 'gallant',
];
const STAGE_WORKS = [
  'Casablanca (film)', 'Citizen Kane', 'La traviata', 'The Magic Flute', 'Hamlet', 'Seven Samurai', 'Spirited Away', 'Carmen', 'Swan Lake',
  'The Godfather', "Singin' in the Rain", 'Madama Butterfly', 'Rashomon', 'Metropolis (1927 film)', 'Tosca', 'Don Giovanni',
  'Parasite (2019 film)', '2001: A Space Odyssey (film)', 'Romeo and Juliet', 'The Nutcracker', 'La bohème', 'Vertigo (film)',
  'Les Misérables (musical)', 'Macbeth', 'The Barber of Seville', 'Tokyo Story', 'Bicycle Thieves', 'Aida',
];
const ARTWORKS = [
  'Mona Lisa', 'The Starry Night', 'Girl with a Pearl Earring', 'The Great Wave off Kanagawa', 'The Birth of Venus', 'The Persistence of Memory',
  'The Night Watch', 'Las Meninas', 'The Kiss (Klimt)', 'Guernica (Picasso)', 'The Scream', 'Liberty Leading the People',
  'The Garden of Earthly Delights', 'Wanderer above the Sea of Fog', 'American Gothic', 'Nighthawks (Hopper)', 'The Arnolfini Portrait',
  'The School of Athens', 'Sunflowers (Van Gogh series)', 'Impression, Sunrise',
];
const FX_PAIRS: [string, string][] = [['EUR', 'USD'], ['GBP', 'USD'], ['USD', 'JPY'], ['USD', 'CNY'], ['USD', 'CHF'], ['AUD', 'USD'], ['USD', 'CAD'], ['EUR', 'GBP']];
const CONVERT: [number, string, string][] = [[100, 'USD', 'EUR'], [100, 'GBP', 'USD'], [1000, 'JPY', 'USD'], [100, 'EUR', 'GBP'], [100, 'CNY', 'USD'], [100, 'CAD', 'USD'], [100, 'GBP', 'JPY'], [100, 'AUD', 'USD']];
const HOLIDAY_COUNTRIES = ['US', 'GB', 'JP', 'DE', 'FR', 'BR', 'IN', 'SG', 'AU', 'CA', 'KR', 'MX', 'ZA'];
const WB_PAIRS: [string, string][] = [
  ['FR', 'FP.CPI.TOTL.ZG'], ['US', 'NY.GDP.MKTP.KD.ZG'], ['IN', 'NY.GDP.MKTP.KD.ZG'], ['JP', 'SL.UEM.TOTL.ZS'], ['DE', 'FP.CPI.TOTL.ZG'], ['BR', 'SL.UEM.TOTL.ZS'],
  ['MX', 'IT.NET.USER.ZS'], ['CN', 'NY.GDP.MKTP.KD.ZG'], ['GB', 'FP.CPI.TOTL.ZG'], ['CA', 'NY.GDP.PCAP.CD'], ['NG', 'SP.POP.TOTL'], ['KR', 'NE.EXP.GNFS.ZS'],
];

// First item whose key is not in `seen`, starting at a rotating offset.
function fresh<T>(items: T[], key: (t: T) => string, seen: Set<string>): T | null {
  for (const t of items) if (!seen.has(key(t))) return t;
  return null;
}
const shuffled = <T>(items: T[]) => {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const KINDS: DutyKind[] = [
  // ---------- Royal Treasury ----------
  {
    kind: 'fx_rates',
    province: 'treasury',
    providers: ['frankfurter'],
    task: 'Reading the ECB exchange rates on Frankfurter…',
    repeatHours: 30,
    async run(ctx, seen) {
      const syms = ['EUR', 'GBP', 'JPY', 'CNY', 'CHF', 'CAD'];
      const fx = await I.fxLatest('USD', ctx, syms);
      const key = fx.date;
      if (seen.has(key)) return null; // ECB publishes once per working day
      const s = await I.fxSeries('EUR', 'USD', ctx, new Date(Date.now() - 10 * 86400_000).toISOString().slice(0, 10));
      const pts = s.points;
      const last = pts[pts.length - 1];
      const prev = pts[pts.length - 2];
      const change = last && prev ? ((last.rate - prev.rate) / prev.rate) * 100 : null;
      const parts = syms.filter((c) => fx.rates[c] !== undefined).map((c) => `${n2(fx.rates[c])} ${c}`);
      const summary =
        `ECB rates for ${fx.date}: 1 USD = ${parts.join(' · ')}.` +
        (change !== null && prev ? ` EUR/USD ${pct(change)} vs ${prev.date}.` : '');
      return {
        key,
        title: 'Exchange rates for the Treasury',
        summary,
        data: { base: 'USD', date: fx.date, rates: fx.rates, eurusd: change !== null ? { prevDate: prev.date, prev: prev.rate, last: last.rate, changePct: Number(change.toFixed(3)) } : null },
        sourceName: 'Frankfurter (ECB)',
        sourceUrl: fx.sourceUrl,
      };
    },
  },
  {
    kind: 'fx_trend',
    province: 'treasury',
    providers: ['frankfurter'],
    task: 'Charting a currency pair over the last two weeks…',
    repeatHours: 20,
    async run(ctx, seen) {
      const d = today();
      const pair = fresh(FX_PAIRS, ([a, b]) => `${a}${b}:${d}`, seen);
      if (!pair) return null;
      const [base, to] = pair;
      const s = await I.fxSeries(base, to, ctx, new Date(Date.now() - 14 * 86400_000).toISOString().slice(0, 10));
      if (s.points.length < 2) throw new Error(`Frankfurter returned ${s.points.length} points for ${base}/${to}.`);
      const first = s.points[0];
      const last = s.points[s.points.length - 1];
      const prev = s.points[s.points.length - 2];
      const day = ((last.rate - prev.rate) / prev.rate) * 100;
      const span = ((last.rate - first.rate) / first.rate) * 100;
      const hi = Math.max(...s.points.map((p) => p.rate));
      const lo = Math.min(...s.points.map((p) => p.rate));
      return {
        key: `${base}${to}:${d}`,
        title: `${base}/${to} over two weeks`,
        summary: `${base}/${to} closed at ${n2(last.rate)} on ${last.date}: ${pct(day)} vs ${prev.date} and ${pct(span)} since ${first.date} (range ${n2(lo)}–${n2(hi)}).`,
        data: { base, to, points: s.points, dayChangePct: Number(day.toFixed(3)), spanChangePct: Number(span.toFixed(3)) },
        sourceName: 'Frankfurter (ECB)',
        sourceUrl: s.sourceUrl,
      };
    },
  },
  {
    kind: 'wb_indicator',
    province: 'treasury',
    providers: ['worldbank'],
    task: 'Looking up a World Bank indicator…',
    repeatHours: 24 * 20,
    async run(ctx, seen) {
      const pick = fresh(shuffled(WB_PAIRS), ([c, i]) => `${c}:${i}`, seen);
      if (!pick) return null;
      const [c, ind] = pick;
      const r = await I.wbIndicator(c, ind, ctx, 8);
      const [latest, before] = r.points;
      if (!latest) throw new Error(`World Bank has no recent values for ${c} ${ind}.`);
      const fmtV = (v: number) => (Math.abs(v) >= 1e6 ? n0(v) : v.toFixed(2));
      return {
        key: `${c}:${ind}`,
        title: `${r.countryName}: ${r.indicatorName}`,
        summary: `${r.indicatorName} for ${r.countryName} was ${fmtV(latest.value)} in ${latest.year}` + (before ? ` (${fmtV(before.value)} in ${before.year}).` : '.'),
        data: { country: c, countryName: r.countryName, indicator: ind, indicatorName: r.indicatorName, points: r.points.slice(0, 6) },
        sourceName: 'World Bank Open Data',
        sourceUrl: r.sourceUrl,
      };
    },
  },
  // ---------- Grand Bazaar ----------
  {
    kind: 'fx_convert',
    province: 'bazaar',
    providers: ['frankfurter'],
    task: 'Updating the Bazaar price board…',
    repeatHours: 20,
    async run(ctx, seen) {
      const d = today();
      const pick = fresh(CONVERT, ([a, f, t]) => `${a}${f}${t}:${d}`, seen);
      if (!pick) return null;
      const [amount, from, to] = pick;
      const r = await I.fxConvert(amount, from, to, ctx);
      const name = CURRENCY_NAME[to] ? ` (${CURRENCY_NAME[to]})` : '';
      return {
        key: `${amount}${from}${to}:${d}`,
        title: `Price board: ${from} to ${to}`,
        summary: `At the ${r.date} ECB rate, ${n0(amount)} ${from} buys ${n2(r.result)} ${to}${name} (1 ${from} = ${n2(r.rate)} ${to}).`,
        data: { amount, from, to, rate: r.rate, result: r.result, date: r.date },
        sourceName: 'Frankfurter (ECB)',
        sourceUrl: r.sourceUrl,
      };
    },
  },
  {
    kind: 'holidays_ahead',
    province: 'bazaar',
    providers: ['nagerdate'],
    task: 'Checking which holidays will move the markets…',
    repeatHours: 24 * 3,
    async run(ctx, seen) {
      const d = today();
      for (const c of shuffled(HOLIDAY_COUNTRIES)) {
        if ([...seen].some((k) => k.startsWith(c + ':'))) continue;
        const r = await I.nextHolidays(c, ctx);
        const h = r.holidays.find((x) => x.date >= d);
        if (!h) continue; // Nager.Date has no data for some countries (e.g. IN): try the next one
        const days = Math.round((Date.parse(h.date) - Date.parse(d)) / 86400_000);
        const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
        const local = h.localName && h.localName !== h.name ? ` (${h.localName})` : '';
        return {
          key: `${c}:${h.date}`,
          title: `Next holiday in ${COUNTRY[c] ?? c}`,
          summary: `Next public holiday in ${COUNTRY[c] ?? c}: ${h.name}${local} on ${h.date}, ${when}. Merchants plan their stock around it.`,
          data: { country: c, holiday: h, daysAway: days },
          sourceName: 'Nager.Date',
          sourceUrl: `https://date.nager.at/PublicHoliday/Country/${c}`,
        };
      }
      return null;
    },
  },
  // ---------- Grand Archive ----------
  {
    kind: 'on_this_day',
    province: 'archive',
    providers: ['wikipedia'],
    task: 'Reading “On this day” on Wikipedia…',
    repeatHours: 48,
    async run(ctx, seen) {
      const r = await I.wikiOnThisDay(ctx, undefined, undefined, 20);
      const e = fresh(r.events, (x) => `${r.month}-${r.day}:${x.year}:${x.text.slice(0, 40)}`, seen);
      if (!e) return null;
      return {
        key: `${r.month}-${r.day}:${e.year}:${e.text.slice(0, 40)}`,
        title: `On this day in ${e.year}`,
        summary: `On this day in ${e.year}: ${e.text}`,
        data: { month: r.month, day: r.day, year: e.year, text: e.text, page: e.pageTitle, pageUrl: e.url },
        sourceName: 'Wikipedia',
        sourceUrl: e.url ?? r.sourceUrl,
      };
    },
  },
  {
    kind: 'arxiv_paper',
    province: 'archive',
    providers: ['arxiv'],
    task: 'Searching arXiv for a paper…',
    repeatHours: 24 * 30,
    async run(ctx, seen) {
      const topic = RESEARCH_TOPICS[Math.floor(Math.random() * RESEARCH_TOPICS.length)];
      const r = await I.arxivSearch(topic.includes(" ") ? `"${topic}"` : topic, ctx, 8);
      const p = fresh(r.results, (x) => x.id, seen);
      if (!p) return null;
      const by = p.authors.length ? ` by ${p.authors.slice(0, 2).join(', ')}${p.authors.length > 2 ? ' et al.' : ''}` : '';
      return {
        key: p.id,
        title: `From arXiv: ${topic}`,
        summary: `“${p.title}”${by} (${p.published}). ${clip(firstSentence(p.summary), 220)}`,
        data: { topic, id: p.id, title: p.title, authors: p.authors, published: p.published },
        sourceName: 'arXiv',
        sourceUrl: p.url,
      };
    },
  },
  {
    kind: 'openalex_work',
    province: 'archive',
    providers: ['openalex'],
    task: 'Searching OpenAlex for a well-cited work…',
    repeatHours: 24 * 30,
    async run(ctx, seen) {
      const topic = RESEARCH_TOPICS[Math.floor(Math.random() * RESEARCH_TOPICS.length)];
      const r = await I.openAlexWorks(topic, ctx, 8);
      const w = fresh(r.results, (x) => x.url, seen);
      if (!w || !w.url) return null;
      const by = w.authors.length ? ` by ${w.authors.slice(0, 2).join(', ')}${w.authors.length > 2 ? ' et al.' : ''}` : '';
      return {
        key: w.url,
        title: `Scholarship: ${topic}`,
        summary: `“${w.title}”${by}${w.year ? ` (${w.year}${w.venue ? `, ${w.venue}` : ''})` : ''}, cited ${n0(w.citations)} times.`,
        data: { topic, title: w.title, authors: w.authors, year: w.year, venue: w.venue, citations: w.citations, doi: w.doi },
        sourceName: 'OpenAlex',
        sourceUrl: w.url,
      };
    },
  },
  // ---------- Heralds' Tower ----------
  {
    kind: 'hn_top',
    province: 'heralds',
    providers: ['hackernews'],
    task: 'Reading the Hacker News front page…',
    repeatHours: 48,
    async run(ctx, seen) {
      const r = await I.hnFrontPage(ctx, 15);
      const s = fresh(r.results, (x) => x.id, seen);
      if (!s) return null;
      const rank = r.results.indexOf(s) + 1;
      return {
        key: s.id,
        title: 'From the Hacker News front page',
        summary: `“${s.title}” is on the Hacker News front page with ${n0(s.points)} points and ${n0(s.comments)} comments.`,
        data: { id: s.id, title: s.title, url: s.url, hnUrl: s.hnUrl, points: s.points, comments: s.comments, rank, author: s.author },
        sourceName: 'Hacker News',
        sourceUrl: s.hnUrl,
      };
    },
  },
  {
    kind: 'mastodon_tag',
    province: 'heralds',
    providers: ['mastodon'],
    task: 'Listening to the fediverse trends…',
    repeatHours: 24,
    async run(ctx, seen) {
      const r = await I.mastodonTrendingTags(ctx, 10);
      const t = fresh(r.results, (x) => x.name.toLowerCase(), seen);
      if (!t) return null;
      return {
        key: t.name.toLowerCase(),
        title: 'Trending on Mastodon',
        summary: `#${t.name} is trending on mastodon.social: ${n0(t.uses)} posts by ${n0(t.accounts)} accounts in the last two days.`,
        data: { name: t.name, uses: t.uses, accounts: t.accounts, rank: r.results.indexOf(t) + 1 },
        sourceName: 'Mastodon',
        sourceUrl: t.url,
      };
    },
  },
  {
    kind: 'mastodon_link',
    province: 'heralds',
    providers: ['mastodon'],
    task: 'Collecting the most shared links on Mastodon…',
    repeatHours: 48,
    async run(ctx, seen) {
      const r = await I.mastodonTrendingLinks(ctx, 10);
      const l = fresh(r.results.filter((x) => x.title), (x) => x.url, seen);
      if (!l) return null;
      return {
        key: l.url,
        title: 'Most shared on Mastodon',
        summary: `“${clip(l.title, 160)}” (${l.site}) was shared ${n0(l.uses)} times on mastodon.social in the last two days.`,
        data: { title: l.title, url: l.url, site: l.site, uses: l.uses },
        sourceName: 'Mastodon',
        sourceUrl: l.url,
      };
    },
  },
  // ---------- Scriptorium ----------
  {
    kind: 'word_of_day',
    province: 'scriptorium',
    providers: ['dictionary', 'datamuse'],
    task: 'Choosing a word of the day from the dictionary…',
    repeatHours: 24 * 40,
    async run(ctx, seen) {
      const w = fresh(shuffled(WORDS), (x) => x, seen);
      if (!w) return null;
      const d = await I.define(w, ctx);
      const m = d.meanings.find((x) => x.definitions.length);
      if (!d.found || !m) throw new Error(`The Free Dictionary has no entry for “${w}”.`);
      let syn: string[] = [];
      try {
        syn = (await I.relatedWords(w, 'synonyms', ctx, 6)).words.slice(0, 4);
      } catch (e) {
        console.warn('[duties] datamuse synonyms failed:', (e as Error).message);
        syn = m.synonyms.slice(0, 4);
      }
      const def = m.definitions[0];
      return {
        key: w,
        title: `Word of the day: ${w}`,
        summary: `${w}${d.phonetic ? ` ${d.phonetic}` : ''}, ${m.partOfSpeech}: ${clip(def.text, 200)}${syn.length ? ` Synonyms: ${syn.join(', ')}.` : ''}`,
        data: { word: w, phonetic: d.phonetic, partOfSpeech: m.partOfSpeech, definition: def.text, example: def.example, synonyms: syn },
        sourceName: 'Free Dictionary API · Datamuse',
        sourceUrl: d.sourceUrl,
      };
    },
  },
  // ---------- High Court ----------
  {
    kind: 'federal_rule',
    province: 'court',
    providers: ['federalregister'],
    task: 'Reading the newest rules in the Federal Register…',
    repeatHours: 24 * 14,
    async run(ctx, seen) {
      const r = await I.federalRegister(ctx, undefined, 10, 'RULE');
      const doc = fresh(r.results, (x) => x.number, seen);
      if (!doc) return null;
      return {
        key: doc.number,
        title: 'New rule in the Federal Register',
        summary: `${doc.agencies[0] ?? 'A US agency'} published a final rule on ${doc.published}: “${clip(doc.title, 180)}”.`,
        data: { number: doc.number, title: doc.title, type: doc.type, agencies: doc.agencies, published: doc.published, abstract: doc.abstract },
        sourceName: 'Federal Register',
        sourceUrl: doc.url,
      };
    },
  },
  {
    kind: 'presidential_doc',
    province: 'court',
    providers: ['federalregister'],
    task: 'Reading the newest presidential documents…',
    repeatHours: 24 * 14,
    async run(ctx, seen) {
      const r = await I.federalRegister(ctx, undefined, 10, 'PRESDOCU');
      const doc = fresh(r.results, (x) => x.number, seen);
      if (!doc) return null;
      return {
        key: doc.number,
        title: 'Presidential document',
        summary: `Published in the Federal Register on ${doc.published}: “${clip(doc.title, 200)}”.`,
        data: { number: doc.number, title: doc.title, type: doc.type, agencies: doc.agencies, published: doc.published },
        sourceName: 'Federal Register',
        sourceUrl: doc.url,
      };
    },
  },
  // ---------- Imperial Throne ----------
  {
    kind: 'weather_report',
    province: 'throne',
    providers: ['openmeteo'],
    task: 'Reading the sky over the realm…',
    repeatHours: 1,
    async run(ctx, seen) {
      const hour = new Date().toISOString().slice(0, 13);
      if (seen.has(hour)) return null;
      const { lat, lon } = I.realmLocation();
      const w = await I.currentWeather(lat, lon, ctx);
      return {
        key: hour,
        title: 'Weather over the realm',
        summary: `Over the realm (${w.lat}, ${w.lon}) it is ${I.weatherText(w.code).toLowerCase()}, ${w.tempC.toFixed(1)}°C with wind at ${w.windKmh.toFixed(0)} km/h (${w.isDay ? 'day' : 'night'}).`,
        data: { code: w.code, kind: w.kind, tempC: w.tempC, windKmh: w.windKmh, isDay: w.isDay, lat: w.lat, lon: w.lon, fetchedAt: w.fetchedAt },
        sourceName: 'Open-Meteo',
        sourceUrl: I.weatherSourceUrl(w.lat, w.lon),
      };
    },
  },
  {
    kind: 'festival_watch',
    province: 'throne',
    providers: ['nagerdate'],
    task: 'Checking the royal calendar for festivals…',
    repeatHours: 20,
    async run(ctx, seen) {
      const d = today();
      if (seen.has(d)) return null;
      const f = await I.festival('US', ctx);
      const summary = f.today
        ? `Today is ${f.today.name} (${f.today.localName}) in the United States, a public holiday. Citizens may claim the festival bonus.`
        : `No public holiday in the United States today.${f.next ? ` The next one is ${f.next.name} (${f.next.localName}) on ${f.next.date}.` : ''}`;
      return {
        key: d,
        title: f.today ? `Festival: ${f.today.name}` : 'The royal calendar',
        summary,
        data: { country: 'US', today: f.today, next: f.next },
        sourceName: 'Nager.Date',
        sourceUrl: 'https://date.nager.at/PublicHoliday/Country/US',
      };
    },
  },
  // ---------- The Forge ----------
  {
    kind: 'hn_tech',
    province: 'forge',
    providers: ['hackernews'],
    task: 'Searching Hacker News for engineering news…',
    repeatHours: 24 * 30,
    async run(ctx, seen) {
      const topic = TECH_TOPICS[Math.floor(Math.random() * TECH_TOPICS.length)];
      const r = await I.hnSearch(topic, ctx, 10);
      const s = fresh(r.results.filter((x) => x.title), (x) => x.id, seen);
      if (!s) return null;
      return {
        key: s.id,
        title: `Forge reading: ${topic}`,
        summary: `On ${topic}: “${s.title}”, ${n0(s.points)} points and ${n0(s.comments)} comments on Hacker News${s.at ? ` (posted ${s.at.slice(0, 10)})` : ''}.`,
        data: { topic, id: s.id, title: s.title, url: s.url, hnUrl: s.hnUrl, points: s.points, comments: s.comments, at: s.at },
        sourceName: 'Hacker News',
        sourceUrl: s.hnUrl,
      };
    },
  },
  {
    kind: 'arxiv_se',
    province: 'forge',
    providers: ['arxiv'],
    task: 'Searching arXiv for software research…',
    repeatHours: 24 * 30,
    async run(ctx, seen) {
      const topic = SE_TOPICS[Math.floor(Math.random() * SE_TOPICS.length)];
      const r = await I.arxivSearch(topic.includes(" ") ? `"${topic}"` : topic, ctx, 8);
      const p = fresh(r.results, (x) => x.id, seen);
      if (!p) return null;
      const by = p.authors.length ? ` by ${p.authors.slice(0, 2).join(', ')}${p.authors.length > 2 ? ' et al.' : ''}` : '';
      return {
        key: p.id,
        title: `Software research: ${topic}`,
        summary: `“${p.title}”${by} (${p.published}). ${clip(firstSentence(p.summary), 200)}`,
        data: { topic, id: p.id, title: p.title, authors: p.authors, published: p.published },
        sourceName: 'arXiv',
        sourceUrl: p.url,
      };
    },
  },
  // ---------- Lantern Theatre ----------
  {
    kind: 'stage_note',
    province: 'theatre',
    providers: ['wikipedia'],
    task: 'Reading about a classic of stage and screen…',
    repeatHours: 24 * 30,
    async run(ctx, seen) {
      const t = fresh(shuffled(STAGE_WORKS), (x) => x, seen);
      if (!t) return null;
      const s = await I.wikiSummary(t, ctx);
      if (!s || !s.extract) throw new Error(`Wikipedia has no summary for “${t}”.`);
      return {
        key: t,
        title: `From the repertoire: ${s.title}`,
        summary: clip(firstSentence(s.extract), 260),
        data: { page: s.title, description: s.description, extract: clip(s.extract, 500) },
        sourceName: 'Wikipedia',
        sourceUrl: s.url,
        imageUrl: s.thumbnail,
      };
    },
  },
  // ---------- Atelier ----------
  {
    kind: 'artwork_note',
    province: 'atelier',
    providers: ['wikipedia'],
    task: 'Studying a masterpiece on Wikipedia…',
    repeatHours: 24 * 30,
    async run(ctx, seen) {
      const t = fresh(shuffled(ARTWORKS), (x) => x, seen);
      if (!t) return null;
      const s = await I.wikiSummary(t, ctx);
      if (!s || !s.extract) throw new Error(`Wikipedia has no summary for “${t}”.`);
      return {
        key: t,
        title: `Masterpiece: ${s.title}`,
        summary: clip(firstSentence(s.extract), 260),
        data: { page: s.title, description: s.description, extract: clip(s.extract, 500) },
        sourceName: 'Wikipedia',
        sourceUrl: s.url,
        imageUrl: s.thumbnail,
      };
    },
  },
  {
    kind: 'gazette_poster',
    province: 'atelier',
    providers: ['pollinations'],
    task: 'Painting a poster for today’s Gazette headline…',
    repeatHours: 48,
    async run(ctx, seen) {
      // Rare on purpose: the free image tier is shared with users' Workshop and decrees.
      const last = db.prepare("SELECT at FROM duties WHERE kind = 'gazette_poster' ORDER BY at DESC LIMIT 1").get() as Row | undefined;
      if (last && Date.now() - Date.parse(last.at) < POSTER_EVERY_MS) return null;
      if (I.imageQueueWaitMs() > 0) return null;
      const head = db
        .prepare("SELECT * FROM duties WHERE at >= ? AND kind IN ('hn_top','on_this_day','federal_rule','mastodon_link') ORDER BY CASE kind WHEN 'hn_top' THEN 0 ELSE 1 END, at DESC LIMIT 1")
        .get(today() + 'T00:00:00.000Z') as Row | undefined;
      if (!head || seen.has(head.id)) return null;
      const hd = JSON.parse(head.data) ?? {};
      const headline = String(hd.title ?? hd.text ?? head.summary);
      const prompt = `Vintage newspaper poster, woodcut illustration in ink with gold accents on cream paper, illustrating the headline: ${clip(headline, 200)}`;
      const img = await I.generateImage(prompt, ctx, { width: 1024, height: 640, maxWaitMs: 0 });
      return {
        key: head.id,
        title: 'Poster for the Gazette',
        summary: `Painted a poster for today’s headline “${clip(headline, 140)}”.`,
        data: { headline, headlineDutyId: head.id, headlineUrl: head.source_url, prompt, seed: img.seed, width: img.width, height: img.height },
        sourceName: 'Pollinations',
        sourceUrl: img.sourceUrl,
        imageUrl: img.url,
      };
    },
  },
  // ---------- The Observatory ----------
  {
    kind: 'quake_watch',
    province: 'observatory',
    providers: ['usgs'],
    task: 'Watching the USGS seismographs…',
    repeatHours: 24 * 7,
    async run(ctx, seen) {
      const r = await I.earthquakes(ctx, '4.5', 'day', 30);
      // Strongest new quake of the past day.
      const q = fresh([...r.quakes].sort((a, b) => b.magnitude - a.magnitude), (x) => x.id, seen);
      if (!q) return null;
      const extra = [q.tsunami ? 'USGS flags a possible tsunami' : null, q.alert ? `PAGER alert ${q.alert}` : null, q.felt ? `${n0(q.felt)} felt reports` : null].filter(Boolean).join(', ');
      return {
        key: q.id,
        title: `Earthquake: M${q.magnitude} ${clip(q.place, 80)}`,
        summary: `A magnitude ${q.magnitude} earthquake struck ${q.place} at ${q.time.slice(11, 16)} UTC on ${q.time.slice(0, 10)}, ${q.depthKm} km deep${extra ? ` (${extra})` : ''}. ${r.count} quakes of M4.5+ in the past day.`,
        data: { id: q.id, magnitude: q.magnitude, place: q.place, time: q.time, depthKm: q.depthKm, lat: q.lat, lon: q.lon, tsunami: q.tsunami, alert: q.alert, dayCount: r.count },
        sourceName: 'USGS',
        sourceUrl: q.url,
      };
    },
  },
  {
    kind: 'asteroid_flyby',
    province: 'observatory',
    providers: ['nasa'],
    task: 'Plotting today’s asteroid flybys with NASA…',
    repeatHours: 24 * 3,
    async run(ctx, seen) {
      const r = await I.nasaAsteroids(ctx);
      const a = fresh(r.asteroids, (x) => x.id, seen);
      if (!a) return null;
      return {
        key: a.id,
        title: `Asteroid flyby: ${a.name}`,
        summary: `Asteroid ${a.name} (about ${n0(a.diameterM.min)}–${n0(a.diameterM.max)} m) passes Earth at ${n2(a.missLunar)} lunar distances (${n0(a.missKm)} km) at ${a.closeApproach.slice(11, 16)} UTC, moving ${n0(a.speedKmh)} km/h${a.hazardous ? '. NASA lists its orbit as potentially hazardous, which is a class, not an impact forecast' : ''}. ${r.count} asteroids pass Earth today.`,
        data: { ...a, date: r.start, dayCount: r.count },
        sourceName: 'NASA NeoWs',
        sourceUrl: a.url,
      };
    },
  },
  // ---------- The Apothecary ----------
  {
    kind: 'fda_recall',
    province: 'apothecary',
    providers: ['openfda'],
    task: 'Reading the newest FDA recall notices…',
    repeatHours: 24 * 30,
    async run(ctx, seen) {
      const kind = (['food', 'drug', 'device'] as const)[Math.floor(Math.random() * 3)];
      const r = await I.fdaRecalls(kind, ctx, undefined, 10);
      // Most serious first among the newest reports.
      const x = fresh([...r.results].sort((a, b) => a.classification.localeCompare(b.classification)), (y) => y.number, seen);
      if (!x) return null;
      return {
        key: x.number,
        title: `FDA ${kind} recall: ${clip(x.product, 70)}`,
        summary: `${x.firm} recalled ${clip(x.product, 140)} (${x.classification}, reported ${x.reported ?? 'recently'}). Reason: ${clip(x.reason, 140).replace(/\.?$/, '.')} Information, not medical advice.`,
        data: { recallKind: kind, ...x, note: 'Information, not medical advice.' },
        sourceName: 'openFDA',
        // openFDA has no page per recall: link the API record for this recall number.
        sourceUrl: `https://api.fda.gov/${kind}/enforcement.json?search=recall_number:${encodeURIComponent(`"${x.number}"`)}`,
      };
    },
  },
  {
    kind: 'pubmed_paper',
    province: 'apothecary',
    providers: ['pubmed'],
    task: 'Reading new medical research on PubMed…',
    repeatHours: 24 * 30,
    async run(ctx, seen) {
      const topic = MED_TOPICS[Math.floor(Math.random() * MED_TOPICS.length)];
      const r = await I.pubmedSearch(`"${topic}"[Title] AND review[pt]`, ctx, 8, 'date');
      const p = fresh(r.results, (x) => x.pmid, seen);
      if (!p) return null;
      return {
        key: p.pmid,
        title: `New review: ${topic}`,
        summary: `“${clip(p.title, 200)}” in ${p.journal} (${p.published}). Information, not medical advice.`,
        data: { topic, pmid: p.pmid, title: p.title, journal: p.journal, published: p.published, authors: p.authors, doi: p.doi, note: 'Information, not medical advice.' },
        sourceName: 'PubMed',
        sourceUrl: p.url,
      };
    },
  },
  // ---------- The Arena ----------
  {
    kind: 'league_leader',
    province: 'arena',
    providers: ['footballdata'],
    task: 'Checking the league tables…',
    repeatHours: 24 * 3,
    async run(ctx, seen) {
      for (const code of shuffled(['PL', 'PD', 'BL1', 'SA', 'FL1'])) {
        const r = await I.footballStandings(code, ctx);
        const [a, b] = r.table;
        if (!a) continue;
        const key = `${code}:${a.team}:${a.played}`;
        if (seen.has(key)) continue;
        const gap = b ? a.points - b.points : null;
        return {
          key,
          title: `${r.competition}: ${a.team} on top`,
          summary: `${a.team} lead the ${r.competition} with ${a.points} points from ${a.played} games${b ? `, ${gap === 0 ? 'level on points with' : `${gap} ahead of`} ${b.team}` : ''} (goal difference ${a.goalDiff > 0 ? '+' : ''}${a.goalDiff}).`,
          data: { code, competition: r.competition, season: r.season, matchday: r.matchday, top: r.table.slice(0, 4).map(({ crest: _c, ...t }) => t) },
          sourceName: 'football-data.org',
          sourceUrl: r.sourceUrl,
        };
      }
      return null;
    },
  },
  {
    kind: 'trending_film',
    province: 'arena',
    providers: ['tmdb'],
    task: 'Seeing what the realm is watching (TMDB)…',
    repeatHours: 24 * 14,
    async run(ctx, seen) {
      const type = Math.random() < 0.6 ? 'movie' : 'tv';
      const r = await I.tmdbTrending(ctx, type, 'week', 20);
      const t = fresh(r.results, (x) => `${x.type}:${x.id}`, seen);
      if (!t) return null;
      const rank = r.results.indexOf(t) + 1;
      return {
        key: `${t.type}:${t.id}`,
        title: `Trending ${t.type === 'tv' ? 'show' : 'film'}: ${t.title}`,
        summary: `${t.title}${t.date ? ` (${t.date.slice(0, 4)})` : ''} is #${rank} among trending ${t.type === 'tv' ? 'TV shows' : 'films'} on TMDB this week${t.rating != null ? `, user score ${t.rating}/10` : ''}. ${clip(firstSentence(t.overview), 160)} Data: TMDB.`,
        data: { id: t.id, type: t.type, title: t.title, date: t.date, rating: t.rating, votes: t.votes, rank, attribution: r.attribution },
        sourceName: 'TMDB',
        sourceUrl: t.url,
        imageUrl: t.poster,
      };
    },
  },
  // ---------- The Royal Mint (Robinhood Chain, read-only) ----------
  {
    kind: 'chain_pulse',
    province: 'mint',
    providers: ['robinhoodrpc'],
    task: 'Reading the latest blocks on Robinhood Chain…',
    repeatHours: 8,
    async run(ctx, seen) {
      const r = await I.chainPulse(ctx);
      const key = `pulse:${Math.floor(r.latestBlock / 100_000)}`;
      if (seen.has(key)) return null;
      return {
        key,
        title: `Robinhood Chain passes block ${r.latestBlock.toLocaleString('en')}`,
        summary: `The latest block is ${r.latestBlock.toLocaleString('en')}. Over the last ${r.blocks.length} blocks the chain averaged ${r.avgTxPerBlock} transactions per block${r.avgBlockSeconds ? `, a new block every ${r.avgBlockSeconds} s` : ''}, with gas at ${r.gasPriceGwei} gwei.`,
        data: { latestBlock: r.latestBlock, avgTxPerBlock: r.avgTxPerBlock, avgBlockSeconds: r.avgBlockSeconds, gasPriceGwei: r.gasPriceGwei },
        sourceName: 'Robinhood Chain RPC',
        sourceUrl: r.sourceUrl,
      };
    },
  },
  {
    kind: 'stock_token_gap',
    province: 'mint',
    providers: ['dexscreener', 'finnhub'],
    task: 'Comparing stock tokens with Wall Street…',
    repeatHours: 24,
    async run(ctx, seen) {
      const r = await I.stockBoard(ctx);
      const day = new Date().toISOString().slice(0, 10);
      const ranked = r.tokens.filter((t) => t.gapPct !== null).sort((a, b) => Math.abs(b.gapPct!) - Math.abs(a.gapPct!));
      const t = ranked.find((x) => !seen.has(`${day}:${x.ticker}`));
      if (!t || t.tokenPriceUsd === null || t.fairTokenPrice === null) return null;
      return {
        key: `${day}:${t.ticker}`,
        title: `${t.ticker} token ${t.gapPct! >= 0 ? 'above' : 'below'} its share price by ${Math.abs(t.gapPct!)}%`,
        summary: `The ${t.name} stock token traded at $${t.tokenPriceUsd} on Robinhood Chain, against $${t.fairTokenPrice.toFixed(2)} for the share price × its multiplier (Finnhub${t.stockAsOf ? `, ${t.stockAsOf.slice(0, 16).replace('T', ' ')} UTC` : ''}). Widest gap of the ${ranked.length} stock tokens checked. Not financial advice.`,
        data: { ticker: t.ticker, tokenPriceUsd: t.tokenPriceUsd, fairTokenPrice: t.fairTokenPrice, gapPct: t.gapPct, liquidityUsd: t.liquidityUsd, multiplier: t.multiplier },
        sourceName: 'DexScreener + Finnhub',
        sourceUrl: t.url,
      };
    },
  },
  {
    kind: 'agentdom_ledger',
    province: 'mint',
    providers: ['dexscreener', 'geckoterminal', 'robinhoodrpc'],
    task: 'Counting the $AGENTDOM holders…',
    repeatHours: 24,
    async run(ctx, seen) {
      const r = await I.agentdomStats(ctx);
      const day = new Date().toISOString().slice(0, 10);
      if (seen.has(day) || r.holders === null) return null;
      return {
        key: day,
        title: `$AGENTDOM: ${r.holders.toLocaleString('en')} holders`,
        summary: `$AGENTDOM has ${r.holders.toLocaleString('en')} holders on Robinhood Chain${r.burned ? `, and ${Math.round(Number(r.burned)).toLocaleString('en')} tokens (${r.burnedPct}% of supply) sit in burn addresses` : ''}. Read from the chain and GeckoTerminal. Not financial advice.`,
        data: { holders: r.holders, top10Pct: r.top10Pct, burned: r.burned, burnedPct: r.burnedPct, totalSupply: r.totalSupply },
        sourceName: 'Robinhood Chain + GeckoTerminal',
        sourceUrl: r.sourceUrl,
      };
    },
  },
];

export const DUTY_KINDS = KINDS.map((k) => ({ kind: k.kind, province: k.province, providers: k.providers }));
const KIND = new Map(KINDS.map((k) => [k.kind, k]));

// ---------------- scheduler ----------------
const providerUsed = new Map<string, number>(); // provider -> last duty call (ms)
const cooldown = new Map<string, number>(); // kind -> retry after (ms)

function seenKeys(kind: string, hours: number): Set<string> {
  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  const rows = db.prepare('SELECT data FROM duties WHERE kind = ? AND at >= ?').all(kind, since) as Row[];
  const out = new Set<string>();
  for (const r of rows) {
    try {
      const k = JSON.parse(r.data)?.key;
      if (typeof k === 'string') out.add(k);
    } catch {
      /* ignore */
    }
  }
  return out;
}

function saveDuty(agent: Row, k: DutyKind, r: DutyResult): Row {
  const row = {
    id: uid('duty'),
    agent_id: agent.id,
    province: k.province,
    kind: k.kind,
    title: clip(r.title, 160),
    summary: clip(r.summary, 400),
    data: JSON.stringify({ key: r.key, ...r.data }).slice(0, 8000),
    source_name: r.sourceName,
    source_url: r.sourceUrl,
    image_url: r.imageUrl ?? null,
    at: now(),
  };
  db.prepare('INSERT INTO duties (id, agent_id, province, kind, title, summary, data, source_name, source_url, image_url, at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
    row.id,
    row.agent_id,
    row.province,
    row.kind,
    row.title,
    row.summary,
    row.data,
    row.source_name,
    row.source_url,
    row.image_url,
    row.at,
  );
  // keep the table bounded (about a few months of duties)
  db.prepare('DELETE FROM duties WHERE id NOT IN (SELECT id FROM duties ORDER BY at DESC LIMIT 20000)').run();
  return row;
}

let busy = false;
async function tick() {
  if (busy) return;
  busy = true;
  try {
    const hourAgo = new Date(Date.now() - 3600_000).toISOString();
    const done = Number((db.prepare('SELECT COUNT(*) AS n FROM duties WHERE at >= ?').get(hourAgo) as Row).n);
    if (done >= PER_HOUR) return;

    const working = workingAgents();
    const agents = db
      .prepare(
        `SELECT a.*, (SELECT MAX(at) FROM duties d WHERE d.agent_id = a.id) AS last_duty
         FROM agents a WHERE a.active = 1 ORDER BY COALESCE(last_duty, '') ASC, RANDOM()`,
      )
      .all() as Row[];
    const lastByKind = new Map((db.prepare('SELECT kind, MAX(at) AS at FROM duties GROUP BY kind').all() as Row[]).map((r) => [r.kind as string, r.at as string]));

    let attempts = 0;
    for (const agent of agents) {
      if (working.has(agent.id) || !PROVINCE[agent.province as ProvinceId]) continue;
      const t = Date.now();
      const kinds = KINDS.filter(
        (k) => k.province === agent.province && (cooldown.get(k.kind) ?? 0) <= t && k.providers.every((p) => t - (providerUsed.get(p) ?? 0) >= PROVIDER_GAP_MS),
      ).sort((a, b) => (lastByKind.get(a.kind) ?? '').localeCompare(lastByKind.get(b.kind) ?? ''));
      for (const k of kinds) {
        if (attempts >= 3) return;
        attempts++;
        const ctx: I.CallContext = { context: 'duty', ref: k.kind };
        current = { agentId: agent.id, kind: k.kind, task: k.task, since: now() };
        try {
          const r = await k.run(ctx, seenKeys(k.kind, k.repeatHours));
          if (!r) {
            // Nothing new to report: rest this kind for a while. Without this the scheduler kept
            // retrying the same three empty kinds every tick and the realm went quiet for hours.
            cooldown.set(k.kind, Date.now() + IDLE_COOLDOWN_MS);
            continue;
          }
          const row = saveDuty(agent, k, r);
          logActivity('duty_done', k.province, `${agent.name} · ${row.summary}`, agent.id);
          return;
        } catch (e) {
          const msg = e instanceof I.UpstreamError ? `${e.provider} ${e.status}: ${e.message}` : (e as Error).message;
          if (e instanceof I.ImageBusyError) continue;
          console.warn(`[duties] ${k.kind} by ${agent.name} failed, skipped: ${msg}`);
          cooldown.set(k.kind, Date.now() + FAIL_COOLDOWN_MS);
          return;
        } finally {
          const u = Date.now();
          for (const p of k.providers) providerUsed.set(p, u);
          current = null;
        }
      }
    }
  } catch (e) {
    console.warn('[duties] scheduler error:', (e as Error).message);
  } finally {
    busy = false;
  }
}

let started = false;
export function startDuties() {
  if (started) return;
  started = true;
  if ((process.env.DUTIES ?? '').toLowerCase() === 'off') {
    console.log('[duties] disabled (DUTIES=off)');
    return;
  }
  // After a restart, respect the per-provider gap for duties that just ran.
  const recent = db.prepare('SELECT kind, at FROM duties WHERE at >= ?').all(new Date(Date.now() - PROVIDER_GAP_MS).toISOString()) as Row[];
  for (const r of recent) for (const p of KIND.get(r.kind)?.providers ?? []) providerUsed.set(p, Math.max(providerUsed.get(p) ?? 0, Date.parse(r.at)));
  const loop = () => {
    const jitter = Math.round((Math.random() - 0.5) * 10_000);
    setTimeout(() => {
      tick().finally(loop);
    }, INTERVAL_MS + jitter).unref?.();
  };
  setTimeout(() => {
    tick().finally(loop);
  }, 15_000).unref?.();
  console.log(`[duties] scheduler on: one duty every ~${Math.round(INTERVAL_MS / 1000)} s, max ${PER_HOUR}/hour`);
}
