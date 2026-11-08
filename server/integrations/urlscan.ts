// urlscan.io: opens a URL in a sandboxed browser and reports what it really loaded.
// Every scan is submitted with visibility "unlisted" (never public). The key goes in the
// `API-Key` header. Results take ~10-30 s; we poll for up to 60 s.
import { clip, fetchBuffer, fetchJson, UpstreamError, type CallContext } from './http';
import { publicUrl, requireKey } from './keys';

const P = 'urlscan';
const BASE = 'https://urlscan.io/api/v1';

export interface UrlScan {
  uuid: string;
  submittedUrl: string;
  finalUrl: string | null;
  verdict: { malicious: boolean; score: number | null; categories: string[]; brands: string[]; engines: { malicious: number; benign: number } | null };
  page: { domain: string | null; ip: string | null; country: string | null; server: string | null; asn: string | null; asnName: string | null; title: string | null; status: string | null };
  certificate: { issuer: string | null; subject: string | null; validFrom: string | null; validTo: string | null } | null;
  requests: number | null;
  domains: number | null;
  screenshotUrl: string;
  reportUrl: string;
  sourceUrl: string;
  fetchedAt: string;
}

const s = (x: unknown) => (typeof x === 'string' && x ? x : null);
const iso = (x: unknown) => (typeof x === 'number' ? new Date(x * 1000).toISOString().slice(0, 10) : s(x));

export async function scanUrl(input: string, ctx: CallContext): Promise<UrlScan> {
  const key = requireKey(P);
  const url = publicUrl(input);
  const sub = await fetchJson<any>(`${BASE}/scan/`, {
    provider: P,
    ctx,
    method: 'POST',
    body: JSON.stringify({ url, visibility: 'unlisted' }),
    headers: { 'API-Key': key, 'content-type': 'application/json' },
    ttlMs: 0,
    retries: 0,
    timeoutMs: 20_000,
    okStatuses: [400, 429],
  });
  if (sub.status === 429) throw new UpstreamError(P, 429, 'urlscan.io scan quota is used up for now. Try again later.');
  if (sub.status === 400) throw new UpstreamError(P, 400, `urlscan.io refused to scan this URL${sub.data?.message ? `: ${clip(String(sub.data.message), 200)}` : '.'}`);
  const uuid = String(sub.data?.uuid ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(uuid)) throw new UpstreamError(P, sub.status, 'urlscan.io did not return a scan id.');
  // Poll the result: 404 while the scan is still running.
  const t0 = Date.now();
  await new Promise((r) => setTimeout(r, 12_000));
  let res: any = null;
  let fetchedAt = '';
  while (Date.now() - t0 < 70_000) {
    const r = await fetchJson<any>(`${BASE}/result/${uuid}/`, { provider: P, ctx, ttlMs: 0, retries: 0, timeoutMs: 15_000, headers: { 'API-Key': key }, okStatuses: [404] });
    if (r.status === 200 && r.data?.page) {
      res = r.data;
      fetchedAt = r.fetchedAt;
      break;
    }
    if (r.status === 200 && r.data?.status === 400) throw new UpstreamError(P, 400, `urlscan.io could not load the page${r.data?.message ? `: ${clip(String(r.data.message), 160)}` : '.'}`);
    await new Promise((res) => setTimeout(res, 5000));
  }
  const reportUrl = `https://urlscan.io/result/${uuid}/`;
  if (!res) throw new UpstreamError(P, 0, `The urlscan.io scan did not finish within a minute. The report may appear later at ${reportUrl}.`);
  const v = res.verdicts ?? {};
  const o = v.overall ?? {};
  const eng = v.engines ?? null;
  const cert = (Array.isArray(res.lists?.certificates) ? res.lists.certificates : [])[0] ?? null;
  const pg = res.page ?? {};
  return {
    uuid,
    submittedUrl: url,
    finalUrl: s(pg.url) ?? s(res.task?.url),
    verdict: {
      malicious: !!o.malicious,
      score: typeof o.score === 'number' ? o.score : null,
      categories: Array.isArray(o.categories) ? o.categories.map(String).slice(0, 10) : [],
      brands: Array.isArray(o.brands) ? o.brands.map((b: any) => (typeof b === 'string' ? b : String(b?.name ?? b?.key ?? ''))).filter(Boolean).slice(0, 10) : [],
      engines: eng ? { malicious: Number(eng.maliciousTotal ?? (Array.isArray(eng.malicious) ? eng.malicious.length : 0)) || 0, benign: Number(eng.benignTotal ?? (Array.isArray(eng.benign) ? eng.benign.length : 0)) || 0 } : null,
    },
    page: {
      domain: s(pg.domain),
      ip: s(pg.ip),
      country: s(pg.country),
      server: s(pg.server),
      asn: s(pg.asn),
      asnName: s(pg.asnname),
      title: s(pg.title) ? clip(pg.title, 200) : null,
      status: pg.status != null ? String(pg.status) : null,
    },
    certificate: cert || pg.tlsIssuer ? { issuer: s(cert?.issuer) ?? s(pg.tlsIssuer), subject: s(cert?.subjectName), validFrom: iso(cert?.validFrom), validTo: iso(cert?.validTo) } : null,
    requests: Array.isArray(res.data?.requests) ? res.data.requests.length : null,
    domains: Array.isArray(res.lists?.domains) ? res.lists.domains.length : null,
    screenshotUrl: s(res.task?.screenshotURL) ?? `https://urlscan.io/screenshots/${uuid}.png`,
    reportUrl,
    sourceUrl: reportUrl,
    fetchedAt,
  };
}

/** The scan screenshot (PNG bytes), or null if urlscan.io has none. */
export async function urlscanScreenshot(scan: UrlScan, ctx: CallContext): Promise<Buffer | null> {
  try {
    const r = await fetchBuffer(scan.screenshotUrl, { provider: P, ctx, timeoutMs: 20_000, retries: 1, okStatuses: [404] });
    return r.status === 200 && r.data.buf.length > 1000 ? r.data.buf : null;
  } catch {
    return null;
  }
}
