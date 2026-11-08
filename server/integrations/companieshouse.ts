// Companies House (UK public register). Free key, 600 requests per 5 minutes.
// HTTP Basic auth: the key is the username, the password is empty. Cached for 6 hours.
import { clip, fetchJson, qs, type CallContext } from './http';
import { requireKey } from './keys';

const P = 'companieshouse';
const BASE = 'https://api.company-information.service.gov.uk';
const TTL = 6 * 60 * 60_000;
const PAGE = (n: string) => `https://find-and-update.company-information.service.gov.uk/company/${n}`;

const auth = () => ({ authorization: 'Basic ' + Buffer.from(requireKey(P) + ':').toString('base64') });
const s = (x: unknown) => (typeof x === 'string' && x ? x : null);
export const isCompanyNumber = (n: string) => /^[A-Z0-9]{8}$/i.test(n.trim());

export interface UkCompanyHit {
  number: string;
  name: string;
  status: string | null;
  type: string | null;
  created: string | null;
  address: string | null;
  url: string;
}
export interface UkCompanySearch {
  query: string;
  total: number;
  results: UkCompanyHit[];
  sourceUrl: string;
  fetchedAt: string;
}

export async function ukCompanySearch(query: string, ctx: CallContext, max = 8): Promise<UkCompanySearch> {
  const q = query.trim();
  if (!q) throw new Error('query is required.');
  if (q.length > 160) throw new Error('query is too long (max 160 characters).');
  const r = await fetchJson<any>(`${BASE}/search/companies` + qs({ q, items_per_page: Math.min(20, Math.max(1, max)) }), { provider: P, ctx, ttlMs: TTL, headers: auth() });
  const results: UkCompanyHit[] = ((r.data?.items ?? []) as any[])
    .filter((x) => typeof x?.company_number === 'string')
    .map((x) => ({
      number: x.company_number,
      name: clip(String(x.title ?? ''), 160),
      status: s(x.company_status),
      type: s(x.company_type),
      created: s(x.date_of_creation),
      address: s(x.address_snippet),
      url: PAGE(x.company_number),
    }));
  return {
    query: q,
    total: Number(r.data?.total_results ?? results.length),
    results,
    sourceUrl: `https://find-and-update.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(q)}`,
    fetchedAt: r.fetchedAt,
  };
}

export interface UkCompanyProfile {
  number: string;
  name: string;
  status: string | null;
  type: string | null;
  created: string | null;
  ceased: string | null;
  jurisdiction: string | null;
  address: string | null;
  sicCodes: string[];
  hasCharges: boolean | null;
  hasInsolvencyHistory: boolean | null;
  accounts: { lastMadeUpTo: string | null; nextDue: string | null; overdue: boolean | null };
  confirmationStatement: { lastMadeUpTo: string | null; nextDue: string | null; overdue: boolean | null };
  officers: { active: number | null; resigned: number | null; list: { name: string; role: string | null; appointed: string | null; resigned: string | null; nationality: string | null; occupation: string | null }[] };
  filings: { total: number | null; recent: { date: string | null; category: string | null; type: string | null; description: string | null }[] };
  url: string;
  sourceUrl: string;
  fetchedAt: string;
}

const addr = (a: any) => (a ? [a.care_of, a.premises, a.address_line_1, a.address_line_2, a.locality, a.region, a.postal_code, a.country].filter((x) => typeof x === 'string' && x).join(', ') || null : null);
const nice = (d: string | null) => (d ? d.replace(/-/g, ' ') : null);

/** Profile + current officers + latest filings for one company number (3 requests). */
export async function ukCompanyProfile(number: string, ctx: CallContext): Promise<UkCompanyProfile> {
  const n = number.trim().toUpperCase();
  if (!isCompanyNumber(n)) throw new Error('company_number must be the 8-character Companies House number, e.g. 00445790.');
  const o = { provider: P, ctx, ttlMs: TTL, headers: auth() };
  const p = await fetchJson<any>(`${BASE}/company/${n}`, { ...o, okStatuses: [404] });
  if (p.status === 404 || !p.data?.company_number) throw new Error(`No UK company has the number ${n}.`);
  const [off, fil] = await Promise.all([
    fetchJson<any>(`${BASE}/company/${n}/officers` + qs({ items_per_page: 35, order_by: 'appointed_on' }), { ...o, okStatuses: [404] }).catch(() => null),
    fetchJson<any>(`${BASE}/company/${n}/filing-history` + qs({ items_per_page: 10 }), { ...o, okStatuses: [404] }).catch(() => null),
  ]);
  const d = p.data;
  const offItems = ((off?.data?.items ?? []) as any[]).filter((x) => !x.resigned_on).slice(0, 15);
  return {
    number: n,
    name: String(d.company_name ?? ''),
    status: s(d.company_status),
    type: s(d.type),
    created: s(d.date_of_creation),
    ceased: s(d.date_of_cessation),
    jurisdiction: s(d.jurisdiction),
    address: addr(d.registered_office_address),
    sicCodes: Array.isArray(d.sic_codes) ? d.sic_codes.map(String) : [],
    hasCharges: typeof d.has_charges === 'boolean' ? d.has_charges : null,
    hasInsolvencyHistory: typeof d.has_insolvency_history === 'boolean' ? d.has_insolvency_history : null,
    accounts: { lastMadeUpTo: s(d.accounts?.last_accounts?.made_up_to), nextDue: s(d.accounts?.next_due), overdue: typeof d.accounts?.overdue === 'boolean' ? d.accounts.overdue : null },
    confirmationStatement: { lastMadeUpTo: s(d.confirmation_statement?.last_made_up_to), nextDue: s(d.confirmation_statement?.next_due), overdue: typeof d.confirmation_statement?.overdue === 'boolean' ? d.confirmation_statement.overdue : null },
    officers: {
      active: typeof off?.data?.active_count === 'number' ? off.data.active_count : null,
      resigned: typeof off?.data?.resigned_count === 'number' ? off.data.resigned_count : null,
      list: offItems.map((x) => ({ name: String(x.name ?? ''), role: nice(s(x.officer_role)), appointed: s(x.appointed_on), resigned: s(x.resigned_on), nationality: s(x.nationality), occupation: s(x.occupation) })),
    },
    filings: {
      total: typeof fil?.data?.total_count === 'number' ? fil.data.total_count : null,
      recent: ((fil?.data?.items ?? []) as any[]).slice(0, 10).map((x) => ({ date: s(x.date), category: s(x.category), type: s(x.type), description: nice(s(x.description)) })),
    },
    url: PAGE(n),
    sourceUrl: PAGE(n),
    fetchedAt: p.fetchedAt,
  };
}
