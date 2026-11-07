// Live realm data: what every agent is doing, real weather (Open-Meteo) and
// real public holidays (Nager.Date). All of it comes from our server.
import type { Duty, Festival, RealmLive, Weather } from '../../shared/live';

async function get<T>(path: string): Promise<T> {
  const res = await fetch('/api' + path, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return (await res.json()) as T;
}

export interface FestivalInfo {
  today: Festival | null;
  next: Festival | null;
}

export const liveApi = {
  realm: () => get<RealmLive>('/realm/live'),
  weather: (at?: { lat: number; lon: number } | null) =>
    get<Weather>('/weather' + (at ? `?lat=${at.lat.toFixed(3)}&lon=${at.lon.toFixed(3)}` : '')),
  festival: (country: string) => get<FestivalInfo>('/festival?country=' + encodeURIComponent(country)),
  duty: (id: string) => get<Duty>('/duties/' + encodeURIComponent(id)),
};

// Two-letter region of the browser locale ("en-US" -> "US"), or the fallback.
export function localeCountry(fallback = 'US'): string {
  try {
    const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const l of langs) {
      if (!l) continue;
      try {
        const r = new Intl.Locale(l).region;
        if (r && /^[A-Z]{2}$/.test(r)) return r;
      } catch {
        const m = /[-_]([A-Za-z]{2})\b/.exec(l);
        if (m) return m[1].toUpperCase();
      }
    }
  } catch {
    /* ignore */
  }
  return fallback;
}

// Days from today (local) to a YYYY-MM-DD date.
export function daysUntil(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const a = new Date();
  a.setHours(0, 0, 0, 0);
  const b = new Date(y, (m || 1) - 1, d || 1);
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}
