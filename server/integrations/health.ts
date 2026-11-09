// Apothecary, no-key sources: openFDA (drug labels, recalls), PubMed E-utilities, ClinicalTrials.gov v2.
// Everything here is public information, never medical advice; callers must say so.
import { clip, fetchJson, qs, type CallContext } from './http';

export const HEALTH_NOTE = 'Information, not medical advice. Talk to a doctor or pharmacist before acting on it.';
const first = (v: unknown, n: number): string | null => (Array.isArray(v) && v.length ? clip(String(v[0]).replace(/\s+/g, ' '), n) : null);
const fdaDate = (s: unknown) => (typeof s === 'string' && /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null);
const quote = (s: string) => s.replace(/["\\]/g, ' ').trim();

// ---------------- openFDA ----------------
export interface DrugLabel {
  brand: string | null;
  generic: string | null;
  manufacturer: string | null;
  route: string | null;
  purpose: string | null;
  indications: string | null;
  boxedWarning: string | null;
  warnings: string | null;
  dosage: string | null;
  updated: string | null;
  url: string; // DailyMed page for this label
}
export interface DrugLabels {
  query: string;
  total: number;
  results: DrugLabel[];
  note: string;
  sourceUrl: string;
  fetchedAt: string;
}

/** FDA drug labels whose brand or generic name matches. */
export async function drugLabel(name: string, ctx: CallContext, limit = 3): Promise<DrugLabels> {
  const n = quote(name);
  if (!n) throw new Error('drug name is required.');
  const search = `openfda.brand_name:"${n}" openfda.generic_name:"${n}"`;
  const url = 'https://api.fda.gov/drug/label.json' + qs({ search, limit: Math.min(5, Math.max(1, limit)) });
  const r = await fetchJson<any>(url, { provider: 'openfda', ctx, ttlMs: 6 * 60 * 60_000, timeoutMs: 15_000, okStatuses: [404] });
  const docs = (r.data?.results ?? []) as any[];
  return {
    query: n,
    total: Number(r.data?.meta?.results?.total ?? docs.length),
    results: docs.map((d) => ({
      brand: first(d.openfda?.brand_name, 120),
      generic: first(d.openfda?.generic_name, 160),
      manufacturer: first(d.openfda?.manufacturer_name, 120),
      route: first(d.openfda?.route, 60),
      purpose: first(d.purpose, 300),
      indications: first(d.indications_and_usage, 700),
      boxedWarning: first(d.boxed_warning, 600),
      warnings: first(d.warnings ?? d.warnings_and_cautions, 700),
      dosage: first(d.dosage_and_administration, 500),
      updated: fdaDate(d.effective_time),
      url: d.set_id ? `https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=${d.set_id}` : 'https://dailymed.nlm.nih.gov',
    })),
    note: HEALTH_NOTE,
    sourceUrl: 'https://open.fda.gov/apis/drug/label/',
    fetchedAt: r.fetchedAt,
  };
}

export const RECALL_KINDS = ['drug', 'food', 'device'] as const;
export type RecallKind = (typeof RECALL_KINDS)[number];
export interface Recall {
  number: string;
  product: string;
  reason: string;
  firm: string;
  classification: string; // Class I (most serious) .. III
  status: string;
  distribution: string;
  country: string | null;
  initiated: string | null;
  reported: string | null;
}
export interface Recalls {
  kind: RecallKind;
  query: string | null;
  total: number;
  results: Recall[]; // newest report first
  note: string;
  /** The openFDA API answer itself (FDA has no page per recall); reportsUrl is the FDA's searchable list. */
  sourceUrl: string;
  reportsUrl: string;
  fetchedAt: string;
}

/** Newest FDA enforcement reports (recalls) for drugs, food or devices, optionally matching words. */
export async function fdaRecalls(kind: RecallKind, ctx: CallContext, query?: string, limit = 6): Promise<Recalls> {
  if (!RECALL_KINDS.includes(kind)) throw new Error(`kind must be one of: ${RECALL_KINDS.join(', ')}.`);
  const q = query ? quote(query) : '';
  const search = q ? `product_description:"${q}" reason_for_recall:"${q}" recalling_firm:"${q}"` : undefined;
  const url = `https://api.fda.gov/${kind}/enforcement.json` + qs({ search, sort: 'report_date:desc', limit: Math.min(10, Math.max(1, limit)) });
  const r = await fetchJson<any>(url, { provider: 'openfda', ctx, ttlMs: 60 * 60_000, timeoutMs: 15_000, okStatuses: [404] });
  const docs = (r.data?.results ?? []) as any[];
  return {
    kind,
    query: q || null,
    total: Number(r.data?.meta?.results?.total ?? docs.length),
    results: docs.map((d) => ({
      number: String(d.recall_number ?? ''),
      product: clip(d.product_description ?? '', 300),
      reason: clip(d.reason_for_recall ?? '', 300),
      firm: clip(d.recalling_firm ?? '', 120),
      classification: String(d.classification ?? ''),
      status: String(d.status ?? ''),
      distribution: clip(d.distribution_pattern ?? '', 200),
      country: d.country || null,
      initiated: fdaDate(d.recall_initiation_date),
      reported: fdaDate(d.report_date),
    })),
    note: HEALTH_NOTE,
    sourceUrl: url,
    reportsUrl: 'https://www.accessdata.fda.gov/scripts/ires/index.cfm',
    fetchedAt: r.fetchedAt,
  };
}

// ---------------- PubMed ----------------
export interface PubmedArticle {
  pmid: string;
  title: string;
  journal: string;
  published: string;
  authors: string[];
  doi: string | null;
  types: string[]; // e.g. Review, Randomized Controlled Trial
  url: string;
}
export interface PubmedSearch {
  query: string;
  total: number;
  results: PubmedArticle[];
  note: string;
  sourceUrl: string;
  fetchedAt: string;
}

const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

/** PubMed search (most relevant first) with titles, journals and authors. */
export async function pubmedSearch(query: string, ctx: CallContext, limit = 6, sort: 'relevance' | 'date' = 'relevance'): Promise<PubmedSearch> {
  const q = query.trim();
  if (!q) throw new Error('query is required.');
  const n = Math.min(10, Math.max(1, limit));
  const s = await fetchJson<any>(`${EUTILS}/esearch.fcgi` + qs({ db: 'pubmed', term: q, retmode: 'json', retmax: n, sort: sort === 'date' ? 'pub_date' : 'relevance', tool: 'agentdom' }), {
    provider: 'pubmed',
    ctx,
    ttlMs: 6 * 60 * 60_000,
    timeoutMs: 15_000,
  });
  const ids = ((s.data?.esearchresult?.idlist ?? []) as string[]).slice(0, n);
  const total = Number(s.data?.esearchresult?.count ?? 0);
  const sourceUrl = 'https://pubmed.ncbi.nlm.nih.gov/' + qs({ term: q });
  if (!ids.length) return { query: q, total, results: [], note: HEALTH_NOTE, sourceUrl, fetchedAt: s.fetchedAt };
  const r = await fetchJson<any>(`${EUTILS}/esummary.fcgi` + qs({ db: 'pubmed', id: ids.join(','), retmode: 'json', tool: 'agentdom' }), { provider: 'pubmed', ctx, ttlMs: 6 * 60 * 60_000, timeoutMs: 15_000 });
  const res = r.data?.result ?? {};
  return {
    query: q,
    total,
    results: ids
      .map((id) => res[id])
      .filter(Boolean)
      .map((d: any) => ({
        pmid: String(d.uid),
        title: clip(String(d.title ?? '').replace(/<[^>]*>/g, ''), 300),
        journal: clip(d.fulljournalname || d.source || '', 160),
        published: String(d.pubdate ?? ''),
        authors: ((d.authors ?? []) as any[]).slice(0, 4).map((a) => String(a.name)),
        doi: ((d.articleids ?? []) as any[]).find((a) => a.idtype === 'doi')?.value ?? null,
        types: ((d.pubtype ?? []) as string[]).slice(0, 3),
        url: `https://pubmed.ncbi.nlm.nih.gov/${d.uid}/`,
      })),
    note: HEALTH_NOTE,
    sourceUrl,
    fetchedAt: r.fetchedAt,
  };
}

// ---------------- ClinicalTrials.gov ----------------
export interface Trial {
  nctId: string;
  title: string;
  status: string;
  phases: string[];
  conditions: string[];
  sponsor: string | null;
  start: string | null;
  enrollment: number | null;
  url: string;
}
export interface TrialSearch {
  query: string;
  recruitingOnly: boolean;
  total: number;
  results: Trial[];
  note: string;
  sourceUrl: string;
  fetchedAt: string;
}

/** Clinical studies matching a condition, drug or keyword. */
export async function trialSearch(query: string, ctx: CallContext, opts: { recruiting?: boolean; limit?: number } = {}): Promise<TrialSearch> {
  const q = query.trim();
  if (!q) throw new Error('query is required.');
  const url =
    'https://clinicaltrials.gov/api/v2/studies' +
    qs({
      'query.term': q,
      'filter.overallStatus': opts.recruiting ? 'RECRUITING' : undefined,
      pageSize: Math.min(10, Math.max(1, opts.limit ?? 6)),
      countTotal: true,
      fields: 'NCTId,BriefTitle,OverallStatus,Phase,StartDate,Condition,LeadSponsorName,EnrollmentCount',
    });
  const r = await fetchJson<any>(url, { provider: 'clinicaltrials', ctx, ttlMs: 60 * 60_000, timeoutMs: 15_000 });
  const studies = (r.data?.studies ?? []) as any[];
  return {
    query: q,
    recruitingOnly: !!opts.recruiting,
    total: Number(r.data?.totalCount ?? studies.length),
    results: studies.map((s) => {
      const p = s.protocolSection ?? {};
      const id = String(p.identificationModule?.nctId ?? '');
      return {
        nctId: id,
        title: clip(p.identificationModule?.briefTitle ?? '', 300),
        status: String(p.statusModule?.overallStatus ?? ''),
        phases: (p.designModule?.phases ?? []) as string[],
        conditions: ((p.conditionsModule?.conditions ?? []) as string[]).slice(0, 4),
        sponsor: p.sponsorCollaboratorsModule?.leadSponsor?.name ?? null,
        start: p.statusModule?.startDateStruct?.date ?? null,
        enrollment: p.designModule?.enrollmentInfo?.count ?? null,
        url: `https://clinicaltrials.gov/study/${id}`,
      };
    }),
    note: HEALTH_NOTE,
    sourceUrl: 'https://clinicaltrials.gov/search' + qs({ term: q, aggFilters: opts.recruiting ? 'status:rec' : undefined }),
    fetchedAt: r.fetchedAt,
  };
}
