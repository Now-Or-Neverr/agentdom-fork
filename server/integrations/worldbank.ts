// World Bank Open Data: country indicators.
import { fetchJson, qs, type CallContext } from './http';

/** A few well-known indicator codes (any valid World Bank code also works). */
export const WB_INDICATORS: Record<string, string> = {
  'NY.GDP.MKTP.CD': 'GDP (current US$)',
  'NY.GDP.PCAP.CD': 'GDP per capita (current US$)',
  'NY.GDP.MKTP.KD.ZG': 'GDP growth (annual %)',
  'FP.CPI.TOTL.ZG': 'Inflation, consumer prices (annual %)',
  'SP.POP.TOTL': 'Population, total',
  'SL.UEM.TOTL.ZS': 'Unemployment (% of labor force)',
  'IT.NET.USER.ZS': 'Individuals using the Internet (% of population)',
  'NE.EXP.GNFS.ZS': 'Exports of goods and services (% of GDP)',
};
export const isCountryCode = (c: unknown): c is string => typeof c === 'string' && /^[A-Za-z]{2,3}$/.test(c.trim());
export const isIndicatorCode = (c: unknown): c is string => typeof c === 'string' && /^[A-Za-z0-9.]{3,40}$/.test(c.trim());

export interface Indicator {
  country: string;
  countryName: string;
  indicator: string;
  indicatorName: string;
  points: { year: number; value: number }[]; // newest first, nulls removed
  lastUpdated: string | null;
  sourceUrl: string;
  fetchedAt: string;
}

/** Yearly values of one indicator for one country (ISO2/ISO3), last `years` years. */
export async function wbIndicator(country: string, indicator: string, ctx: CallContext, years = 12): Promise<Indicator> {
  const c = country.trim().toUpperCase();
  const ind = indicator.trim().toUpperCase();
  const y = new Date().getUTCFullYear();
  const url = `https://api.worldbank.org/v2/country/${c}/indicator/${ind}` + qs({ format: 'json', per_page: 60, date: `${y - years}:${y}` });
  const r = await fetchJson<any>(url, { provider: 'worldbank', ctx, ttlMs: 12 * 60 * 60_000, timeoutMs: 15_000 });
  const [meta, rows] = Array.isArray(r.data) ? r.data : [];
  if (meta?.message) throw new Error(meta.message?.[0]?.value ?? 'World Bank rejected the request.');
  const list = (rows ?? []) as any[];
  const first = list[0];
  return {
    country: c,
    countryName: first?.country?.value ?? c,
    indicator: ind,
    indicatorName: first?.indicator?.value ?? WB_INDICATORS[ind] ?? ind,
    points: list.filter((x) => x.value !== null && x.value !== undefined).map((x) => ({ year: Number(x.date), value: Number(x.value) })),
    lastUpdated: meta?.lastupdated ?? null,
    sourceUrl: `https://data.worldbank.org/indicator/${ind}` + qs({ locations: c }),
    fetchedAt: r.fetchedAt,
  };
}
