// Google PageSpeed Insights v5 (Lighthouse): performance, SEO, accessibility and
// best-practices scores plus the biggest fixes. Slow (10-40 s), so long timeout + 1 h cache.
// The key goes in `key` (stripped from logs).
import { clip, fetchJson, type CallContext } from './http';
import { publicUrl, requireKey } from './keys';

const P = 'pagespeed';
const CATS = ['performance', 'seo', 'accessibility', 'best-practices'] as const;
const METRICS: Record<string, string> = {
  'first-contentful-paint': 'First Contentful Paint',
  'largest-contentful-paint': 'Largest Contentful Paint',
  'total-blocking-time': 'Total Blocking Time',
  'cumulative-layout-shift': 'Cumulative Layout Shift',
  'speed-index': 'Speed Index',
};

export interface SiteAudit {
  url: string; // the final URL Lighthouse tested
  strategy: 'mobile' | 'desktop';
  scores: Record<(typeof CATS)[number], number | null>; // 0..100
  metrics: { id: string; label: string; value: string; score: number | null }[];
  opportunities: { id: string; title: string; savings: string | null; score: number | null; category: string }[];
  lighthouseVersion: string | null;
  sourceUrl: string; // pagespeed.web.dev report for the same URL
  fetchedAt: string;
}

export const pagespeedPage = (url: string, strategy: string) => `https://pagespeed.web.dev/analysis?url=${encodeURIComponent(url)}&form_factor=${strategy}`;

/** Run Lighthouse on a public URL through PageSpeed Insights. */
export async function auditSite(url: string, ctx: CallContext, strategy: 'mobile' | 'desktop' = 'mobile'): Promise<SiteAudit> {
  const key = requireKey(P);
  const u = publicUrl(url);
  const s = strategy === 'desktop' ? 'desktop' : 'mobile';
  const p = new URLSearchParams({ url: u, strategy: s });
  for (const c of CATS) p.append('category', c);
  p.set('key', key);
  const r = await fetchJson<any>('https://www.googleapis.com/pagespeedonline/v5/runPagespeed?' + p.toString(), {
    provider: P,
    ctx,
    ttlMs: 3600_000,
    timeoutMs: 90_000,
    retries: 0,
  });
  const lh = r.data?.lighthouseResult;
  if (!lh) throw new Error('PageSpeed Insights returned no Lighthouse result for that page.');
  const audits = (lh.audits ?? {}) as Record<string, any>;
  const cats = (lh.categories ?? {}) as Record<string, any>;
  const scores = Object.fromEntries(CATS.map((c) => [c, typeof cats[c]?.score === 'number' ? Math.round(cats[c].score * 100) : null])) as SiteAudit['scores'];
  const metrics = Object.entries(METRICS)
    .filter(([id]) => audits[id])
    .map(([id, label]) => ({ id, label, value: String(audits[id].displayValue ?? ''), score: typeof audits[id].score === 'number' ? Math.round(audits[id].score * 100) : null }));
  // Failing audits that belong to a category (not the metrics themselves), worst / biggest savings first.
  const seen = new Set<string>();
  const opportunities: SiteAudit['opportunities'] = [];
  for (const c of CATS) {
    for (const ref of (cats[c]?.auditRefs ?? []) as any[]) {
      const a = audits[ref.id];
      if (!a || seen.has(ref.id) || METRICS[ref.id] || ref.group === 'metrics' || ref.group === 'hidden') continue;
      if (typeof a.score !== 'number' || a.score >= 0.9) continue;
      if (!['numeric', 'binary', 'metricSavings'].includes(a.scoreDisplayMode)) continue;
      seen.add(ref.id);
      const ms = Number(a.details?.overallSavingsMs ?? a.numericValue);
      const bytes = Number(a.details?.overallSavingsBytes);
      opportunities.push({
        id: ref.id,
        title: clip(String(a.title ?? ref.id).replace(/`/g, ''), 160),
        savings: a.displayValue ? clip(String(a.displayValue), 80) : Number.isFinite(bytes) && bytes > 0 ? `${Math.round(bytes / 1024)} KiB` : null,
        score: Math.round(a.score * 100),
        category: c,
        _w: (1 - a.score) * (ref.weight || 1) + (c === 'performance' && Number.isFinite(ms) ? ms / 1000 : 0),
      } as any);
    }
  }
  opportunities.sort((a: any, b: any) => b._w - a._w);
  return {
    url: lh.finalDisplayedUrl ?? lh.finalUrl ?? u,
    strategy: s,
    scores,
    metrics,
    opportunities: opportunities.slice(0, 10).map(({ _w, ...o }: any) => o),
    lighthouseVersion: lh.lighthouseVersion ?? null,
    sourceUrl: pagespeedPage(u, s),
    fetchedAt: r.fetchedAt,
  };
}
