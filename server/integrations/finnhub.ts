// Finnhub: stock quote, company profile and company news (free tier: 60 calls/min, US stocks).
// The token goes in the X-Finnhub-Token header, never in the URL.
import { clip, fetchJson, qs, type CallContext } from './http';
import { requireKey } from './keys';

const P = 'finnhub';
const BASE = 'https://finnhub.io/api/v1';

export const isTicker = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z][A-Za-z0-9.\-]{0,11}$/.test(s.trim());
function ticker(s: string) {
  if (!isTicker(s)) throw new Error('symbol must be a stock ticker, e.g. AAPL or MSFT.');
  return s.trim().toUpperCase();
}
const get = (path: string, ctx: CallContext, ttlMs: number) => fetchJson<any>(`${BASE}${path}`, { provider: P, ctx, ttlMs, timeoutMs: 15_000, headers: { 'x-finnhub-token': requireKey(P) } });
/** A public quote page a human can use to cross-check the numbers (Finnhub has no public quote page). */
export const quotePage = (sym: string) => `https://finance.yahoo.com/quote/${encodeURIComponent(sym)}`;

export interface StockQuote {
  symbol: string;
  price: number;
  change: number | null;
  changePct: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  prevClose: number | null;
  /** Time of the last trade/quote from Finnhub (ISO). */
  asOf: string | null;
  sourceUrl: string;
  fetchedAt: string;
}
export interface CompanyProfile {
  symbol: string;
  found: boolean;
  name: string | null;
  exchange: string | null;
  industry: string | null;
  country: string | null;
  currency: string | null;
  ipo: string | null;
  marketCapMillions: number | null;
  website: string | null;
  logo: string | null;
  sourceUrl: string;
  fetchedAt: string;
}
export interface CompanyNews {
  symbol: string;
  from: string;
  to: string;
  results: { headline: string; summary: string; source: string; url: string; datetime: string }[];
  sourceUrl: string;
  fetchedAt: string;
}

const f = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);

/** Latest quote. Throws if Finnhub knows no price for the symbol. */
export async function stockQuote(symbol: string, ctx: CallContext): Promise<StockQuote> {
  const sym = ticker(symbol);
  const r = await get('/quote' + qs({ symbol: sym }), ctx, 60_000);
  const d = r.data ?? {};
  if (!d.c && !d.pc) throw new Error(`Finnhub has no quote for “${sym}” (the free tier covers US-listed stocks).`);
  return {
    symbol: sym,
    price: d.c,
    change: f(d.d),
    changePct: f(d.dp),
    open: f(d.o),
    high: f(d.h),
    low: f(d.l),
    prevClose: f(d.pc),
    asOf: d.t ? new Date(d.t * 1000).toISOString() : null,
    sourceUrl: quotePage(sym),
    fetchedAt: r.fetchedAt,
  };
}

/** Company profile (name, exchange, industry, market cap…). `found` is false for unknown symbols. */
export async function companyProfile(symbol: string, ctx: CallContext): Promise<CompanyProfile> {
  const sym = ticker(symbol);
  const r = await get('/stock/profile2' + qs({ symbol: sym }), ctx, 24 * 3600_000);
  const d = r.data ?? {};
  const found = !!d.name;
  return {
    symbol: sym,
    found,
    name: d.name ?? null,
    exchange: d.exchange ?? null,
    industry: d.finnhubIndustry ?? null,
    country: d.country ?? null,
    currency: d.currency ?? null,
    ipo: d.ipo ?? null,
    marketCapMillions: f(d.marketCapitalization),
    website: typeof d.weburl === 'string' && /^https?:\/\//.test(d.weburl) ? d.weburl : null,
    logo: typeof d.logo === 'string' && /^https:\/\//.test(d.logo) ? d.logo : null,
    sourceUrl: found && d.weburl ? d.weburl : quotePage(sym),
    fetchedAt: r.fetchedAt,
  };
}

/** Company news from the last `days` (1..30, default 7), newest first, max `limit` items. */
export async function companyNews(symbol: string, ctx: CallContext, days = 7, limit = 10): Promise<CompanyNews> {
  const sym = ticker(symbol);
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - Math.min(30, Math.max(1, days)) * 86400_000).toISOString().slice(0, 10);
  const r = await get('/company-news' + qs({ symbol: sym, from, to }), ctx, 30 * 60_000);
  const rows = (Array.isArray(r.data) ? r.data : []) as any[];
  return {
    symbol: sym,
    from,
    to,
    results: rows
      .filter((x) => typeof x?.url === 'string' && x.headline)
      .sort((a, b) => (b.datetime ?? 0) - (a.datetime ?? 0))
      .slice(0, Math.min(25, Math.max(1, limit)))
      .map((x) => ({ headline: clip(x.headline, 240), summary: clip(x.summary ?? '', 300), source: x.source ?? '', url: x.url, datetime: x.datetime ? new Date(x.datetime * 1000).toISOString() : '' })),
    sourceUrl: quotePage(sym),
    fetchedAt: r.fetchedAt,
  };
}
