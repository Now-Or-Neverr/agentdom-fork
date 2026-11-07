// Nager.Date: public holidays.
import { fetchJson, type CallContext } from './http';
import type { Festival } from '../../shared/live';

const BASE = 'https://date.nager.at/api/v3';
const P = 'nagerdate';

export interface Holiday {
  date: string; // YYYY-MM-DD
  name: string;
  localName: string;
  global: boolean;
  types: string[];
}
export interface Holidays {
  country: string;
  year: number | null; // null for "next holidays"
  holidays: Holiday[];
  sourceUrl: string;
  fetchedAt: string;
}
const map = (h: any): Holiday => ({ date: h.date, name: h.name, localName: h.localName, global: !!h.global, types: h.types ?? [] });
const pageUrl = (c: string, y: number) => `https://date.nager.at/PublicHoliday/Country/${c}/${y}`;

/** All public holidays of a country in a year. Unknown country → empty list. */
export async function publicHolidays(country: string, year: number, ctx: CallContext): Promise<Holidays> {
  const c = country.trim().toUpperCase();
  const url = `${BASE}/PublicHolidays/${year}/${c}`;
  const r = await fetchJson<any[]>(url, { provider: P, ctx, ttlMs: 24 * 60 * 60_000, okStatuses: [204, 404] });
  return { country: c, year, holidays: Array.isArray(r.data) ? r.data.map(map) : [], sourceUrl: pageUrl(c, year), fetchedAt: r.fetchedAt };
}

/** Public holidays in the next 365 days. */
export async function nextHolidays(country: string, ctx: CallContext): Promise<Holidays> {
  const c = country.trim().toUpperCase();
  const url = `${BASE}/NextPublicHolidays/${c}`;
  const r = await fetchJson<any[]>(url, { provider: P, ctx, ttlMs: 6 * 60 * 60_000, okStatuses: [204, 404] });
  return { country: c, year: null, holidays: Array.isArray(r.data) ? r.data.map(map) : [], sourceUrl: pageUrl(c, new Date().getUTCFullYear()), fetchedAt: r.fetchedAt };
}

export interface Countries {
  countries: { code: string; name: string }[];
  sourceUrl: string;
  fetchedAt: string;
}

/** Countries Nager.Date covers. */
export async function holidayCountries(ctx: CallContext): Promise<Countries> {
  const url = `${BASE}/AvailableCountries`;
  const r = await fetchJson<any[]>(url, { provider: P, ctx, ttlMs: 7 * 24 * 60 * 60_000 });
  return { countries: (r.data ?? []).map((x) => ({ code: x.countryCode, name: x.name })), sourceUrl: 'https://date.nager.at/Country', fetchedAt: r.fetchedAt };
}

const festivalCache = new Map<string, { today: Festival | null; next: Festival | null }>();

/** Today's holiday (if any) and the next upcoming one. Cached per country per UTC day. */
export async function festival(country: string, ctx: CallContext): Promise<{ today: Festival | null; next: Festival | null }> {
  const c = country.trim().toUpperCase();
  const day = new Date().toISOString().slice(0, 10);
  const key = `${c}:${day}`;
  const hit = festivalCache.get(key);
  if (hit) return hit;
  const [year, next] = await Promise.all([publicHolidays(c, Number(day.slice(0, 4)), ctx), nextHolidays(c, ctx)]);
  const toF = (h: Holiday | undefined): Festival | null => (h ? { date: h.date, name: h.name, localName: h.localName, country: c, source: 'nager.date' } : null);
  const out = { today: toF(year.holidays.find((h) => h.date === day)), next: toF(next.holidays.find((h) => h.date > day)) };
  if (festivalCache.size > 300) festivalCache.clear();
  festivalCache.set(key, out);
  return out;
}
