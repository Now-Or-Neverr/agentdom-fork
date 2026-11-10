// Grand Archive, no-key sources: Crossref (scholarly metadata and DOI lookup), Wikidata
// (entity search and facts) and the Internet Archive (catalogue search + Wayback Machine).
import { clip, fetchJson, qs, stripHtml, type CallContext } from './http';

// ---------------- Crossref ----------------
export interface CrossrefWork {
  doi: string;
  title: string;
  authors: string[];
  journal: string | null;
  publisher: string | null;
  type: string | null;
  year: number | null;
  citedBy: number; // Crossref "is-referenced-by-count"
  abstract: string | null;
  license: string | null;
  url: string; // https://doi.org/…
}
export interface CrossrefResult {
  kind: 'search' | 'doi';
  query: string;
  total: number;
  works: CrossrefWork[];
  sourceUrl: string;
  fetchedAt: string;
}
const DOI_RE = /^10\.\d{4,9}\/\S{1,200}$/;
export const isDoi = (s: string) => DOI_RE.test(s.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, ''));
const work = (w: any): CrossrefWork => {
  const parts = w.issued?.['date-parts']?.[0] ?? w.published?.['date-parts']?.[0] ?? [];
  const authors = ((w.author ?? []) as any[]).map((a) => [a.given, a.family].filter(Boolean).join(' ') || a.name).filter(Boolean);
  return {
    doi: String(w.DOI ?? ''),
    title: clip(stripHtml(String(w.title?.[0] ?? '(untitled)')), 260),
    authors: authors.length > 6 ? [...authors.slice(0, 6), `+${authors.length - 6} more`] : authors,
    journal: w['container-title']?.[0] ?? null,
    publisher: w.publisher ?? null,
    type: w.type ?? null,
    year: Number.isFinite(Number(parts[0])) && parts[0] !== null ? Number(parts[0]) : null,
    citedBy: Number(w['is-referenced-by-count'] ?? 0),
    abstract: w.abstract ? clip(stripHtml(String(w.abstract)).replace(/^Abstract\s*/i, ''), 500) : null,
    license: w.license?.[0]?.URL ?? null,
    url: w.DOI ? `https://doi.org/${w.DOI}` : String(w.URL ?? ''),
  };
};

/** Scholarly works from Crossref: a keyword search, or one DOI looked up exactly. */
export async function crossref(input: string, ctx: CallContext, limit = 8): Promise<CrossrefResult> {
  const s = input.trim();
  if (!s || s.length > 250) throw new Error('query or DOI is required (max 250 characters).');
  const o = { provider: 'crossref', ctx, ttlMs: 6 * 3600_000, timeoutMs: 20_000 };
  if (isDoi(s)) {
    const doi = s.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
    const r = await fetchJson<any>(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, { ...o, okStatuses: [404] });
    if (r.status === 404 || !r.data?.message) throw new Error(`Crossref has no record for DOI ${doi}.`);
    return { kind: 'doi', query: doi, total: 1, works: [work(r.data.message)], sourceUrl: `https://search.crossref.org/?q=${encodeURIComponent(doi)}`, fetchedAt: r.fetchedAt };
  }
  const select = 'DOI,title,author,container-title,issued,type,publisher,is-referenced-by-count,URL,abstract,license';
  const r = await fetchJson<any>('https://api.crossref.org/works' + qs({ query: s, rows: Math.min(15, Math.max(1, limit)), select }), o);
  return {
    kind: 'search',
    query: s,
    total: Number(r.data?.message?.['total-results'] ?? 0),
    works: ((r.data?.message?.items ?? []) as any[]).map(work),
    sourceUrl: `https://search.crossref.org/?q=${encodeURIComponent(s)}&from_ui=yes`,
    fetchedAt: r.fetchedAt,
  };
}

// ---------------- Wikidata ----------------
// Properties shown as facts, in this order. Values that are items are resolved to English labels.
const WD_PROPS: Record<string, string> = {
  P31: 'instance of',
  P279: 'subclass of',
  P17: 'country',
  P131: 'located in',
  P36: 'capital',
  P35: 'head of state',
  P6: 'head of government',
  P1082: 'population',
  P2046: 'area',
  P571: 'founded / inception',
  P112: 'founded by',
  P159: 'headquarters',
  P452: 'industry',
  P169: 'chief executive',
  P569: 'born',
  P570: 'died',
  P19: 'place of birth',
  P27: 'citizenship',
  P106: 'occupation',
  P69: 'educated at',
  P166: 'award received',
  P50: 'author',
  P577: 'published',
  P495: 'country of origin',
  P38: 'currency',
  P37: 'official language',
  P625: 'coordinates',
  P856: 'official website',
};
export interface WikidataHit {
  id: string; // Q-id
  label: string;
  description: string | null;
  url: string;
}
export interface WikidataFact {
  property: string; // P-id
  label: string; // human name of the property
  values: string[];
}
export interface WikidataEntity {
  id: string;
  label: string;
  description: string | null;
  aliases: string[];
  facts: WikidataFact[];
  wikipedia: string | null;
  url: string;
}
export interface WikidataResult {
  query: string;
  hits: WikidataHit[];
  entity: WikidataEntity | null; // facts for the best hit
  sourceUrl: string;
  fetchedAt: string;
}

function wdValue(snak: any): { item?: string; text?: string; unit?: string } | null {
  const v = snak?.datavalue?.value;
  if (v === undefined || v === null) return null;
  switch (snak.datavalue.type) {
    case 'wikibase-entityid':
      return { item: String(v.id) };
    case 'time': {
      // +1945-08-17T00:00:00Z with precision 9 = year, 10 = month, 11 = day
      const m = /^([+-])(\d+)-(\d\d)-(\d\d)/.exec(String(v.time));
      if (!m) return null;
      const y = `${m[1] === '-' ? '-' : ''}${Number(m[2])}`;
      return { text: v.precision >= 11 ? `${y}-${m[3]}-${m[4]}` : v.precision === 10 ? `${y}-${m[3]}` : y };
    }
    case 'quantity': {
      const n = Number(v.amount);
      const unit = /\/(Q\d+)$/.exec(String(v.unit ?? ''))?.[1];
      return { text: Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : String(v.amount), unit };
    }
    case 'globecoordinate':
      return { text: `${Math.round(v.latitude * 1e4) / 1e4}, ${Math.round(v.longitude * 1e4) / 1e4}` };
    case 'monolingualtext':
      return { text: String(v.text) };
    case 'string':
      return { text: String(v) };
    default:
      return null;
  }
}

/** Search Wikidata for an entity and return the best match with its key facts. */
export async function wikidata(query: string, ctx: CallContext, lang = 'en'): Promise<WikidataResult> {
  const q = query.trim();
  if (!q || q.length > 120) throw new Error('search is required (max 120 characters).');
  const o = { provider: 'wikidata', ctx, ttlMs: 6 * 3600_000, timeoutMs: 15_000 };
  const api = 'https://www.wikidata.org/w/api.php';
  let hits: WikidataHit[];
  let fetchedAt: string;
  if (/^Q\d{1,10}$/.test(q)) {
    hits = [{ id: q, label: q, description: null, url: `https://www.wikidata.org/wiki/${q}` }];
    fetchedAt = new Date().toISOString();
  } else {
    const s = await fetchJson<any>(api + qs({ action: 'wbsearchentities', search: q, language: lang, uselang: lang, type: 'item', limit: 6, format: 'json' }), o);
    hits = ((s.data?.search ?? []) as any[]).map((h) => ({ id: String(h.id), label: String(h.label ?? h.id), description: h.description ?? null, url: `https://www.wikidata.org/wiki/${h.id}` }));
    fetchedAt = s.fetchedAt;
  }
  if (!hits.length) return { query: q, hits, entity: null, sourceUrl: `https://www.wikidata.org/w/index.php?search=${encodeURIComponent(q)}`, fetchedAt };
  const id = hits[0].id;
  const e = await fetchJson<any>(api + qs({ action: 'wbgetentities', ids: id, props: 'labels|descriptions|aliases|claims|sitelinks', languages: `${lang}|mul`, sitefilter: `${lang}wiki`, format: 'json' }), o);
  const ent = e.data?.entities?.[id];
  if (!ent || ent.missing !== undefined) throw new Error(`Wikidata has no entity ${id}.`);
  const raw: { prop: string; vals: { item?: string; text?: string; unit?: string }[] }[] = [];
  for (const prop of Object.keys(WD_PROPS)) {
    const claims = (ent.claims?.[prop] ?? []) as any[];
    if (!claims.length) continue;
    const preferred = claims.filter((c) => c.rank === 'preferred');
    const use = (preferred.length ? preferred : claims.filter((c) => c.rank !== 'deprecated')).slice(0, prop === 'P1082' ? 1 : 4);
    const vals = use.map((c) => wdValue(c.mainsnak)).filter((v): v is { item?: string; text?: string; unit?: string } => !!v);
    if (vals.length) raw.push({ prop, vals });
  }
  // Resolve item values to labels (one call, up to 50 ids).
  const ids = [...new Set(raw.flatMap((r) => r.vals.flatMap((v) => [v.item, v.unit]).filter((x): x is string => !!x)))].slice(0, 50);
  const labels = new Map<string, string>();
  if (ids.length) {
    const l = await fetchJson<any>(api + qs({ action: 'wbgetentities', ids: ids.join('|'), props: 'labels', languages: `${lang}|mul`, format: 'json' }), o);
    for (const [k, v] of Object.entries((l.data?.entities ?? {}) as Record<string, any>)) labels.set(k, v?.labels?.[lang]?.value ?? v?.labels?.mul?.value ?? k);
  }
  const label = ent.labels?.[lang]?.value ?? ent.labels?.mul?.value ?? id;
  hits[0] = { ...hits[0], label: hits[0].label === id ? label : hits[0].label, description: hits[0].description ?? ent.descriptions?.[lang]?.value ?? null };
  const title = ent.sitelinks?.[`${lang}wiki`]?.title;
  return {
    query: q,
    hits,
    entity: {
      id,
      label,
      description: ent.descriptions?.[lang]?.value ?? null,
      aliases: (([...(ent.aliases?.[lang] ?? []), ...(ent.aliases?.mul ?? [])]) as any[]).slice(0, 5).map((a) => String(a.value)),
      facts: raw.map((r) => ({ property: r.prop, label: WD_PROPS[r.prop], values: r.vals.map((v) => (v.item ? labels.get(v.item) ?? v.item : `${v.text ?? ''}${v.unit ? ' ' + (labels.get(v.unit) ?? v.unit) : ''}`)).filter(Boolean) })),
      wikipedia: title ? `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(String(title).replace(/ /g, '_'))}` : null,
      url: `https://www.wikidata.org/wiki/${id}`,
    },
    sourceUrl: `https://www.wikidata.org/wiki/${id}`,
    fetchedAt: e.fetchedAt,
  };
}

// ---------------- Internet Archive ----------------
export const ARCHIVE_MEDIA = ['texts', 'movies', 'audio', 'image', 'software', 'data'] as const;
export type ArchiveMedia = (typeof ARCHIVE_MEDIA)[number];
export interface ArchiveItem {
  id: string;
  title: string;
  mediatype: string | null;
  year: number | null;
  creator: string | null;
  downloads: number;
  url: string;
}
export interface ArchiveSearch {
  query: string;
  mediatype: ArchiveMedia | null;
  total: number;
  items: ArchiveItem[];
  sourceUrl: string;
  fetchedAt: string;
}

/** Search the Internet Archive catalogue (most downloaded first), optionally one media type. */
export async function archiveSearch(query: string, ctx: CallContext, mediatype?: ArchiveMedia, limit = 10): Promise<ArchiveSearch> {
  const q = query.trim();
  if (!q || q.length > 150) throw new Error('search is required (max 150 characters).');
  if (mediatype && !ARCHIVE_MEDIA.includes(mediatype)) throw new Error(`mediatype must be one of: ${ARCHIVE_MEDIA.join(', ')}.`);
  // Quote-free user text; the media type is our own allow-listed value.
  const clean = q.replace(/["\\():[\]{}^~*?]/g, ' ').trim() || 'archive';
  // Title matches first: plain full-text search is swamped by unrelated, much-downloaded items.
  const full = `title:(${clean})${mediatype ? ` AND mediatype:${mediatype}` : ''}`;
  const p = new URLSearchParams({ q: full, rows: String(Math.min(20, Math.max(1, limit))), output: 'json' });
  for (const f of ['identifier', 'title', 'mediatype', 'year', 'creator', 'downloads']) p.append('fl[]', f);
  p.append('sort[]', 'downloads desc');
  const r = await fetchJson<any>('https://archive.org/advancedsearch.php?' + p.toString(), { provider: 'internetarchive', ctx, ttlMs: 6 * 3600_000, timeoutMs: 20_000 });
  const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);
  return {
    query: q,
    mediatype: mediatype ?? null,
    total: Number(r.data?.response?.numFound ?? 0),
    items: ((r.data?.response?.docs ?? []) as any[]).map((d) => ({
      id: String(d.identifier),
      title: clip(String(first(d.title) ?? d.identifier), 200),
      mediatype: d.mediatype ?? null,
      year: Number.isFinite(Number(first(d.year))) ? Number(first(d.year)) : null,
      creator: first(d.creator) ? clip(String(first(d.creator)), 100) : null,
      downloads: Number(d.downloads ?? 0),
      url: `https://archive.org/details/${encodeURIComponent(d.identifier)}`,
    })),
    sourceUrl: `https://archive.org/search?query=${encodeURIComponent(q)}${mediatype ? `&and[]=mediatype%3A%22${mediatype}%22` : ''}`,
    fetchedAt: r.fetchedAt,
  };
}

export interface WaybackSnapshot {
  url: string; // the address asked about
  archived: boolean;
  snapshotUrl: string | null;
  timestamp: string | null; // ISO
  status: string | null; // HTTP status the crawler saw
  sourceUrl: string;
  fetchedAt: string;
}

/** The Wayback Machine snapshot closest to a date (default: the newest). */
export async function waybackSnapshot(address: string, ctx: CallContext, date?: string): Promise<WaybackSnapshot> {
  const a = address.trim();
  if (!a || a.length > 500 || /\s/.test(a)) throw new Error('a web address is required (max 500 characters, no spaces).');
  if (date && !/^\d{4}(\d{2}){0,2}$/.test(date)) throw new Error('date must look like YYYY, YYYYMM or YYYYMMDD.');
  const r = await fetchJson<any>('https://archive.org/wayback/available' + qs({ url: a, timestamp: date }), { provider: 'internetarchive', ctx, ttlMs: 60 * 60_000, timeoutMs: 20_000 });
  const c = r.data?.archived_snapshots?.closest;
  const ts = typeof c?.timestamp === 'string' && /^\d{14}$/.test(c.timestamp) ? `${c.timestamp.slice(0, 4)}-${c.timestamp.slice(4, 6)}-${c.timestamp.slice(6, 8)}T${c.timestamp.slice(8, 10)}:${c.timestamp.slice(10, 12)}:${c.timestamp.slice(12, 14)}Z` : null;
  return {
    url: a,
    archived: Boolean(c?.available),
    snapshotUrl: c?.url ? String(c.url).replace(/^http:/, 'https:') : null,
    timestamp: ts,
    status: c?.status ?? null,
    sourceUrl: `https://web.archive.org/web/*/${a}`,
    fetchedAt: r.fetchedAt,
  };
}
