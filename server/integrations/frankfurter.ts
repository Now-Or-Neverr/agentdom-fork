// Frankfurter: ECB reference exchange rates (working days, ~16:00 CET).
import { fetchJson, qs, type CallContext } from './http';

const BASE = 'https://api.frankfurter.dev/v1';
const P = 'frankfurter';
const cur = (c: string) => c.trim().toUpperCase();
export const isCurrency = (c: unknown): c is string => typeof c === 'string' && /^[A-Za-z]{3}$/.test(c.trim());

export interface FxLatest {
  base: string;
  date: string; // ECB reference date
  rates: Record<string, number>;
  sourceUrl: string;
  fetchedAt: string;
}

/** Latest rates for `base` (optionally only some symbols). */
export async function fxLatest(base: string, ctx: CallContext, symbols?: string[]): Promise<FxLatest> {
  const url = `${BASE}/latest` + qs({ base: cur(base), symbols: symbols?.length ? symbols.map(cur).join(',') : undefined });
  const r = await fetchJson<any>(url, { provider: P, ctx, ttlMs: 30 * 60_000, timeoutMs: 20_000 });
  return { base: r.data.base, date: r.data.date, rates: r.data.rates ?? {}, sourceUrl: url, fetchedAt: r.fetchedAt };
}

export interface FxConversion {
  amount: number;
  from: string;
  to: string;
  rate: number;
  result: number;
  date: string;
  sourceUrl: string;
  fetchedAt: string;
}

/** Convert an amount with the latest ECB rate. */
export async function fxConvert(amount: number, from: string, to: string, ctx: CallContext): Promise<FxConversion> {
  const f = cur(from);
  const t = cur(to);
  if (f === t) throw new Error('Pick two different currencies.');
  const url = `${BASE}/latest` + qs({ base: f, symbols: t });
  const r = await fetchJson<any>(url, { provider: P, ctx, ttlMs: 30 * 60_000, timeoutMs: 20_000 });
  const rate = Number(r.data?.rates?.[t]);
  if (!Number.isFinite(rate)) throw new Error(`No rate for ${f} → ${t}.`);
  return { amount, from: f, to: t, rate, result: Math.round(amount * rate * 10000) / 10000, date: r.data.date, sourceUrl: url, fetchedAt: r.fetchedAt };
}

export interface FxSeries {
  base: string;
  to: string;
  start: string;
  end: string;
  points: { date: string; rate: number }[];
  sourceUrl: string;
  fetchedAt: string;
}

/** Daily rates between two dates (YYYY-MM-DD). Defaults: the last 30 days. */
export async function fxSeries(base: string, to: string, ctx: CallContext, start?: string, end?: string): Promise<FxSeries> {
  const e = end ?? new Date().toISOString().slice(0, 10);
  const s = start ?? new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const url = `${BASE}/${s}..${e}` + qs({ base: cur(base), symbols: cur(to) });
  const r = await fetchJson<any>(url, { provider: P, ctx, ttlMs: 60 * 60_000, timeoutMs: 20_000 });
  const rates = (r.data?.rates ?? {}) as Record<string, Record<string, number>>;
  return {
    base: cur(base),
    to: cur(to),
    start: r.data?.start_date ?? s,
    end: r.data?.end_date ?? e,
    points: Object.entries(rates)
      .map(([date, v]) => ({ date, rate: Number(v[cur(to)]) }))
      .filter((p) => Number.isFinite(p.rate))
      .sort((a, b) => a.date.localeCompare(b.date)),
    sourceUrl: url,
    fetchedAt: r.fetchedAt,
  };
}

export interface FxCurrencies {
  currencies: Record<string, string>; // code -> name
  sourceUrl: string;
  fetchedAt: string;
}

/** Currencies Frankfurter supports. */
export async function fxCurrencies(ctx: CallContext): Promise<FxCurrencies> {
  const url = `${BASE}/currencies`;
  const r = await fetchJson<Record<string, string>>(url, { provider: P, ctx, ttlMs: 24 * 60 * 60_000 });
  return { currencies: r.data ?? {}, sourceUrl: url, fetchedAt: r.fetchedAt };
}
