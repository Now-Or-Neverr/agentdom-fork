// Forge, no-key sources: the npm registry + npm download counts, PyPI JSON + pypistats.org,
// CISA's Known Exploited Vulnerabilities catalogue, the NVD CVE API 2.0 and RDAP (rdap.org).
// NVD allows 5 requests per 30 s without a key: the provider throttle spaces calls 6.5 s apart and
// answers are cached for a day. The KEV catalogue is one ~2 MB file, cached for 6 hours.
import { clip, fetchJson, qs, UpstreamError, type CallContext } from './http';

// ---------------- packages ----------------
export const PACKAGE_ECOSYSTEMS = ['npm', 'pypi'] as const;
export type PackageEcosystem = (typeof PACKAGE_ECOSYSTEMS)[number];
const NPM_NAME = /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/;
const PYPI_NAME = /^[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?$/;
export const isPackageName = (eco: PackageEcosystem, n: string) => n.length <= 214 && (eco === 'npm' ? NPM_NAME.test(n) : PYPI_NAME.test(n));

export interface PackageInfo {
  ecosystem: PackageEcosystem;
  name: string;
  version: string;
  summary: string;
  license: string | null;
  released: string | null; // when this version was published
  releases: number | null; // number of published versions
  requires: string | null; // node engines / requires_python
  dependencies: number | null; // runtime dependencies of this version
  homepage: string | null;
  repository: string | null;
  downloads: { lastDay: number | null; lastWeek: number | null; lastMonth: number | null };
  deprecated: string | null;
  url: string;
  sourceUrl: string;
  fetchedAt: string;
}

const repoUrl = (r: unknown): string | null => {
  const s = typeof r === 'string' ? r : (r as { url?: string })?.url;
  if (!s) return null;
  return s.replace(/^git\+/, '').replace(/^git:\/\//, 'https://').replace(/\.git$/, '').replace(/^github:/, 'https://github.com/');
};

/** Latest version, licence, links and download counts of an npm or PyPI package. */
export async function packageInfo(eco: PackageEcosystem, name: string, ctx: CallContext): Promise<PackageInfo> {
  const n = name.trim();
  if (!PACKAGE_ECOSYSTEMS.includes(eco)) throw new Error('ecosystem must be npm or pypi.');
  if (!isPackageName(eco, eco === 'npm' ? n.toLowerCase() : n)) throw new Error(`"${clip(n, 60)}" is not a valid ${eco} package name.`);
  if (eco === 'npm') {
    const p = n.toLowerCase();
    const enc = p.replace('/', '%2f');
    const o = { provider: 'npm', ctx, timeoutMs: 15_000 };
    const [meta, week, month] = await Promise.all([
      fetchJson<any>(`https://registry.npmjs.org/${enc}/latest`, { ...o, ttlMs: 60 * 60_000, okStatuses: [404] }),
      fetchJson<any>(`https://api.npmjs.org/downloads/point/last-week/${p}`, { ...o, ttlMs: 6 * 3600_000, okStatuses: [404] }),
      fetchJson<any>(`https://api.npmjs.org/downloads/point/last-month/${p}`, { ...o, ttlMs: 6 * 3600_000, okStatuses: [404] }),
    ]);
    if (meta.status === 404 || !meta.data?.version) throw new Error(`npm has no package called "${p}".`);
    const d = meta.data;
    return {
      ecosystem: 'npm',
      name: String(d.name ?? p),
      version: String(d.version),
      summary: clip(d.description ?? '', 300),
      license: typeof d.license === 'string' ? d.license : d.license?.type ?? null,
      released: null, // the /latest document carries no publish time
      releases: null,
      requires: d.engines?.node ? `node ${d.engines.node}` : null,
      dependencies: d.dependencies ? Object.keys(d.dependencies).length : 0,
      homepage: typeof d.homepage === 'string' ? d.homepage : null,
      repository: repoUrl(d.repository),
      downloads: { lastDay: null, lastWeek: week.status === 404 ? null : Number(week.data?.downloads ?? 0), lastMonth: month.status === 404 ? null : Number(month.data?.downloads ?? 0) },
      deprecated: typeof d.deprecated === 'string' ? clip(d.deprecated, 200) : null,
      url: `https://www.npmjs.com/package/${p}`,
      sourceUrl: `https://www.npmjs.com/package/${p}`,
      fetchedAt: meta.fetchedAt,
    };
  }
  const o = { ctx, timeoutMs: 15_000 };
  const meta = await fetchJson<any>(`https://pypi.org/pypi/${encodeURIComponent(n)}/json`, { ...o, provider: 'pypi', ttlMs: 60 * 60_000, okStatuses: [404] });
  if (meta.status === 404 || !meta.data?.info) throw new Error(`PyPI has no project called "${n}".`);
  const i = meta.data.info;
  // pypistats.org is optional: the package facts stand on their own if it is slow or down.
  let dl: { lastDay: number | null; lastWeek: number | null; lastMonth: number | null } = { lastDay: null, lastWeek: null, lastMonth: null };
  try {
    const s = await fetchJson<any>(`https://pypistats.org/api/packages/${encodeURIComponent(String(i.name ?? n).toLowerCase())}/recent`, { ...o, provider: 'pypistats', ttlMs: 6 * 3600_000, retries: 0 });
    dl = { lastDay: s.data?.data?.last_day ?? null, lastWeek: s.data?.data?.last_week ?? null, lastMonth: s.data?.data?.last_month ?? null };
  } catch (e) {
    if (!(e instanceof UpstreamError)) throw e;
  }
  const urls = (i.project_urls ?? {}) as Record<string, string>;
  const repo = Object.entries(urls).find(([k, v]) => /source|repo|code|github/i.test(k) || /github\.com|gitlab\.com/.test(v))?.[1] ?? null;
  const files = (meta.data.urls ?? []) as any[];
  return {
    ecosystem: 'pypi',
    name: String(i.name ?? n),
    version: String(i.version ?? ''),
    summary: clip(i.summary ?? '', 300),
    license: clip(i.license_expression || (i.license && i.license.length < 80 ? i.license : '') || (i.classifiers ?? []).find((c: string) => c.startsWith('License ::'))?.split(' :: ').pop() || '', 80) || null,
    released: files[0]?.upload_time_iso_8601 ?? null,
    releases: meta.data.releases ? Object.keys(meta.data.releases).length : null,
    requires: i.requires_python ? `python ${i.requires_python}` : null,
    dependencies: Array.isArray(i.requires_dist) ? i.requires_dist.filter((r: string) => !/extra\s*==/.test(r)).length : 0,
    homepage: i.home_page || urls.Homepage || urls.Documentation || null,
    repository: repo,
    downloads: dl,
    deprecated: i.yanked ? `yanked: ${i.yanked_reason || 'no reason given'}` : null,
    url: `https://pypi.org/project/${encodeURIComponent(String(i.name ?? n))}/`,
    sourceUrl: `https://pypi.org/project/${encodeURIComponent(String(i.name ?? n))}/`,
    fetchedAt: meta.fetchedAt,
  };
}

// ---------------- CISA KEV ----------------
export interface KevEntry {
  cve: string;
  vendor: string;
  product: string;
  name: string;
  added: string; // YYYY-MM-DD
  due: string | null;
  ransomware: string; // "Known" or "Unknown"
  description: string;
  action: string;
  cwes: string[];
  url: string; // NVD page
}
export interface KevList {
  query: string | null;
  catalogVersion: string | null;
  total: number; // in the whole catalogue
  matched: number;
  entries: KevEntry[]; // newest first
  sourceUrl: string;
  fetchedAt: string;
}

/** CISA's catalogue of vulnerabilities known to be exploited in the wild: newest, or matching a vendor/product/CVE. */
export async function kevCatalog(ctx: CallContext, query?: string, limit = 10): Promise<KevList> {
  const q = query?.trim().toLowerCase() || '';
  if (q.length > 80) throw new Error('search is too long (max 80 characters).');
  const r = await fetchJson<any>('https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json', { provider: 'cisakev', ctx, ttlMs: 6 * 3600_000, timeoutMs: 30_000 });
  const all = ((r.data?.vulnerabilities ?? []) as any[]).map(
    (v): KevEntry => ({
      cve: String(v.cveID),
      vendor: String(v.vendorProject ?? ''),
      product: String(v.product ?? ''),
      name: String(v.vulnerabilityName ?? ''),
      added: String(v.dateAdded ?? ''),
      due: v.dueDate ?? null,
      ransomware: String(v.knownRansomwareCampaignUse ?? 'Unknown'),
      description: clip(v.shortDescription ?? '', 400),
      action: clip(v.requiredAction ?? '', 240),
      cwes: (v.cwes ?? []) as string[],
      url: `https://nvd.nist.gov/vuln/detail/${encodeURIComponent(v.cveID)}`,
    }),
  );
  const hits = (q ? all.filter((v) => `${v.cve} ${v.vendor} ${v.product} ${v.name}`.toLowerCase().includes(q)) : all).sort((a, b) => b.added.localeCompare(a.added));
  return {
    query: q || null,
    catalogVersion: r.data?.catalogVersion ?? null,
    total: all.length,
    matched: hits.length,
    entries: hits.slice(0, Math.min(25, Math.max(1, limit))),
    sourceUrl: 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog',
    fetchedAt: r.fetchedAt,
  };
}

// ---------------- NVD CVE ----------------
export const CVE_RE = /^CVE-\d{4}-\d{4,7}$/;
export interface CveRecord {
  id: string;
  status: string | null;
  published: string | null;
  modified: string | null;
  description: string;
  cvss: { version: string; score: number; severity: string; vector: string } | null;
  weaknesses: string[]; // CWE ids
  references: { url: string; tags: string[] }[];
  exploitedInWild: boolean; // NVD carries CISA KEV fields on listed CVEs
  url: string;
  sourceUrl: string;
  fetchedAt: string;
}

/** One CVE from the US National Vulnerability Database: description, CVSS score, CWE and references. */
export async function cveLookup(id: string, ctx: CallContext): Promise<CveRecord> {
  const cve = id.trim().toUpperCase();
  if (!CVE_RE.test(cve)) throw new Error('CVE id must look like CVE-2021-44228.');
  const r = await fetchJson<any>('https://services.nvd.nist.gov/rest/json/cves/2.0' + qs({ cveId: cve }), { provider: 'nvd', ctx, ttlMs: 24 * 3600_000, timeoutMs: 25_000 });
  const c = r.data?.vulnerabilities?.[0]?.cve;
  if (!c) throw new Error(`NVD has no record for ${cve} (it may be reserved or not yet published).`);
  const m = c.metrics ?? {};
  const pick = (list: any[] | undefined) => (list ?? []).find((x) => x.type === 'Primary') ?? (list ?? [])[0];
  const best = pick(m.cvssMetricV40) ?? pick(m.cvssMetricV31) ?? pick(m.cvssMetricV30) ?? pick(m.cvssMetricV2);
  const cd = best?.cvssData;
  return {
    id: String(c.id),
    status: c.vulnStatus ?? null,
    published: c.published ? new Date(c.published + (/(Z|[+-]\d\d:?\d\d)$/.test(c.published) ? '' : 'Z')).toISOString() : null,
    modified: c.lastModified ? new Date(c.lastModified + (/(Z|[+-]\d\d:?\d\d)$/.test(c.lastModified) ? '' : 'Z')).toISOString() : null,
    description: clip(((c.descriptions ?? []) as any[]).find((d) => d.lang === 'en')?.value ?? '', 900),
    cvss: cd ? { version: String(cd.version ?? ''), score: Number(cd.baseScore ?? 0), severity: String(cd.baseSeverity ?? best?.baseSeverity ?? ''), vector: String(cd.vectorString ?? '') } : null,
    weaknesses: [...new Set(((c.weaknesses ?? []) as any[]).flatMap((w) => ((w.description ?? []) as any[]).map((d) => String(d.value))).filter((v) => /^CWE-\d+$/.test(v)))].slice(0, 6),
    references: ((c.references ?? []) as any[]).slice(0, 8).map((x) => ({ url: String(x.url), tags: ((x.tags ?? []) as string[]).slice(0, 3) })),
    exploitedInWild: Boolean(c.cisaExploitAdd),
    url: `https://nvd.nist.gov/vuln/detail/${cve}`,
    sourceUrl: `https://nvd.nist.gov/vuln/detail/${cve}`,
    fetchedAt: r.fetchedAt,
  };
}

// ---------------- RDAP ----------------
const DOMAIN_RE = /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
export const isDomain = (s: string) => DOMAIN_RE.test(s);
export interface DomainRecord {
  domain: string;
  registrar: string | null;
  registered: string | null;
  expires: string | null;
  lastChanged: string | null;
  ageDays: number | null;
  status: string[];
  nameservers: string[];
  dnssec: boolean | null;
  rdapServer: string | null;
  sourceUrl: string;
  fetchedAt: string;
}
const vcardName = (e: any): string | null => {
  const card = e?.vcardArray?.[1] as any[] | undefined;
  const fn = card?.find((x) => x[0] === 'fn');
  return fn?.[3] ? String(fn[3]) : null;
};

/** Public registration data for a domain (RDAP, the successor of WHOIS): registrar, dates, status, name servers. */
export async function domainLookup(domain: string, ctx: CallContext): Promise<DomainRecord> {
  const d = domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/^www\./, '');
  if (!isDomain(d)) throw new Error('give a domain like example.com (letters, digits and hyphens).');
  const r = await fetchJson<any>(`https://rdap.org/domain/${d}`, { provider: 'rdap', ctx, ttlMs: 6 * 3600_000, timeoutMs: 20_000, accept: 'application/rdap+json, application/json', okStatuses: [404] });
  if (r.status === 404 || !r.data?.ldhName) throw new Error(`No RDAP record for ${d}. The domain may be unregistered, or its registry does not publish RDAP.`);
  const ev = (a: string) => ((r.data.events ?? []) as any[]).find((e) => e.eventAction === a)?.eventDate ?? null;
  const registrar = ((r.data.entities ?? []) as any[]).find((e) => (e.roles ?? []).includes('registrar'));
  const reg = ev('registration');
  const self = ((r.data.links ?? []) as any[]).find((l) => l.rel === 'self')?.href ?? null;
  return {
    domain: String(r.data.ldhName).toLowerCase(),
    registrar: vcardName(registrar) ?? registrar?.handle ?? null,
    registered: reg,
    expires: ev('expiration'),
    lastChanged: ev('last changed'),
    ageDays: reg ? Math.floor((Date.now() - new Date(reg).getTime()) / 86400_000) : null,
    status: ((r.data.status ?? []) as string[]).slice(0, 8),
    nameservers: ((r.data.nameservers ?? []) as any[]).map((n) => String(n.ldhName ?? '').toLowerCase()).filter(Boolean).slice(0, 8),
    dnssec: typeof r.data.secureDNS?.delegationSigned === 'boolean' ? r.data.secureDNS.delegationSigned : null,
    rdapServer: self ? new URL(self).host : null,
    sourceUrl: `https://client.rdap.org/?type=domain&object=${encodeURIComponent(d)}`,
    fetchedAt: r.fetchedAt,
  };
}
