// OSV.dev: known vulnerabilities for one package version (npm, PyPI, Go, crates.io, Maven…). No key.
import { clip, fetchJson, type CallContext } from './http';

export const OSV_ECOSYSTEMS = ['npm', 'PyPI', 'Go', 'crates.io', 'Maven', 'NuGet', 'RubyGems', 'Packagist', 'Pub', 'Hex'] as const;
export type OsvEcosystem = (typeof OSV_ECOSYSTEMS)[number];

export interface Vuln {
  id: string;
  aliases: string[]; // CVE ids etc.
  summary: string;
  severity: string | null; // CVSS vector or database severity label
  published: string | null;
  fixedIn: string[];
  url: string;
}
export interface VulnReport {
  package: string;
  ecosystem: string;
  version: string | null;
  count: number;
  vulns: Vuln[];
  sourceUrl: string;
  fetchedAt: string;
}

/** Known vulnerabilities affecting `name@version` (or any version when version is empty). */
export async function osvQuery(name: string, ecosystem: OsvEcosystem, ctx: CallContext, version?: string): Promise<VulnReport> {
  const n = name.trim();
  if (!n || n.length > 200) throw new Error('package name is required (max 200 characters).');
  if (!OSV_ECOSYSTEMS.includes(ecosystem)) throw new Error(`ecosystem must be one of: ${OSV_ECOSYSTEMS.join(', ')}.`);
  const v = version?.trim().replace(/^v(?=\d)/, '') || undefined;
  if (v && v.length > 60) throw new Error('version is too long.');
  const body = JSON.stringify({ package: { name: n, ecosystem }, ...(v ? { version: v } : {}) });
  const r = await fetchJson<any>('https://api.osv.dev/v1/query', { provider: 'osv', ctx, method: 'POST', body, headers: { 'content-type': 'application/json' }, ttlMs: 60 * 60_000, timeoutMs: 20_000 });
  const rows = (r.data?.vulns ?? []) as any[];
  const vulns: Vuln[] = rows.map((x) => {
    const fixed = new Set<string>();
    for (const a of (x.affected ?? []) as any[]) {
      if (a.package?.name && a.package.name !== n) continue;
      for (const rg of (a.ranges ?? []) as any[]) for (const e of (rg.events ?? []) as any[]) if (e.fixed) fixed.add(String(e.fixed));
    }
    return {
      id: String(x.id),
      aliases: ((x.aliases ?? []) as string[]).slice(0, 4),
      summary: clip(x.summary ?? x.details ?? '', 260),
      severity: x.database_specific?.severity ?? x.severity?.[0]?.score ?? null,
      published: x.published ? String(x.published).slice(0, 10) : null,
      fixedIn: [...fixed].slice(0, 5),
      url: `https://osv.dev/vulnerability/${encodeURIComponent(x.id)}`,
    };
  });
  return {
    package: n,
    ecosystem,
    version: v ?? null,
    count: vulns.length,
    vulns: vulns.slice(0, 15),
    sourceUrl: `https://osv.dev/list?ecosystem=${encodeURIComponent(ecosystem)}&q=${encodeURIComponent(n)}`,
    fetchedAt: r.fetchedAt,
  };
}
