// Read side of the api_calls log (for the Royal Couriers status page).
import { db, type Row } from '../db';
import { PROVIDERS, enabled } from './registry';
import type { ProvinceId } from '../../shared/realm';

export interface ProviderStatus {
  id: string;
  name: string;
  homepage: string;
  docsUrl: string;
  purpose: string;
  guild: ProvinceId | 'realm';
  needsKey: boolean;
  enabled: boolean;
  calls24h: number;
  errors24h: number;
  avgMs24h: number | null;
  lastCallAt: string | null;
  lastStatus: number | null;
  lastOk: boolean | null;
}

export interface ApiCallRow {
  id: string;
  provider: string;
  endpoint: string;
  status: number;
  ok: boolean;
  ms: number;
  context: string;
  ref: string | null;
  at: string;
}

/** Every provider with its last-24h numbers. No secrets. */
export function providerStatuses(): ProviderStatus[] {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const agg = new Map(
    (
      db
        .prepare('SELECT provider, COUNT(*) AS n, SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS errs, AVG(ms) AS avg FROM api_calls WHERE at >= ? GROUP BY provider')
        .all(since) as Row[]
    ).map((r) => [r.provider as string, r]),
  );
  const last = new Map(
    (
      db
        .prepare('SELECT a.provider, a.at, a.status, a.ok FROM api_calls a JOIN (SELECT provider, MAX(at) AS m FROM api_calls GROUP BY provider) b ON a.provider = b.provider AND a.at = b.m')
        .all() as Row[]
    ).map((r) => [r.provider as string, r]),
  );
  return PROVIDERS.map((p) => {
    const a = agg.get(p.id);
    const l = last.get(p.id);
    return {
      id: p.id,
      name: p.name,
      homepage: p.homepage,
      docsUrl: p.docsUrl,
      purpose: p.purpose,
      guild: p.guild,
      needsKey: p.needsKey,
      enabled: enabled(p),
      calls24h: Number(a?.n ?? 0),
      errors24h: Number(a?.errs ?? 0),
      avgMs24h: a?.avg == null ? null : Math.round(a.avg),
      lastCallAt: l?.at ?? null,
      lastStatus: l ? Number(l.status) : null,
      lastOk: l ? !!l.ok : null,
    };
  });
}

/** Most recent logged calls, newest first. */
export function recentCalls(provider?: string, limit = 50): ApiCallRow[] {
  const n = Math.min(Math.max(1, limit), 200);
  const rows = (
    provider
      ? db.prepare('SELECT * FROM api_calls WHERE provider = ? ORDER BY at DESC LIMIT ?').all(provider, n)
      : db.prepare('SELECT * FROM api_calls ORDER BY at DESC LIMIT ?').all(n)
  ) as Row[];
  return rows.map((r) => ({ id: r.id, provider: r.provider, endpoint: r.endpoint, status: r.status, ok: !!r.ok, ms: r.ms, context: r.context, ref: r.ref ?? null, at: r.at }));
}
