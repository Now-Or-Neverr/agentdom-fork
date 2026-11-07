// Open-Meteo: current weather + city geocoding.
import { fetchJson, qs, type CallContext } from './http';
import type { Weather, WeatherKind } from '../../shared/live';

/** WMO weather code → the realm's weather kind. */
export function weatherKind(code: number): WeatherKind {
  if (code === 0 || code === 1) return 'clear';
  if (code === 2 || code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'storm';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  return 'cloudy';
}

const WMO_TEXT: Record<number, string> = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Rime fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Dense drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Rain showers', 81: 'Rain showers', 82: 'Violent rain showers',
  85: 'Snow showers', 86: 'Snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with hail',
};
export const weatherText = (code: number) => WMO_TEXT[code] ?? `WMO code ${code}`;

export const round1 = (n: number) => Math.round(n * 10) / 10;
export const validLatLon = (lat: number, lon: number) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

/** Realm default location: env REALM_LAT/REALM_LON, else London. */
export function realmLocation(): { lat: number; lon: number } {
  const lat = Number(process.env.REALM_LAT);
  const lon = Number(process.env.REALM_LON);
  return process.env.REALM_LAT && process.env.REALM_LON && validLatLon(lat, lon) ? { lat, lon } : { lat: 51.51, lon: -0.13 };
}

/** Current weather (lat/lon rounded to 1 decimal, cached 10 min). */
export async function currentWeather(lat: number, lon: number, ctx: CallContext): Promise<Weather> {
  const la = round1(lat);
  const lo = round1(lon);
  const url = 'https://api.open-meteo.com/v1/forecast' + qs({ latitude: la, longitude: lo, current: 'temperature_2m,weather_code,wind_speed_10m,is_day' });
  const r = await fetchJson<any>(url, { provider: 'openmeteo', ctx, ttlMs: 10 * 60_000 });
  const c = r.data?.current;
  if (!c || c.weather_code === undefined) throw new Error('Open-Meteo returned no current weather.');
  const code = Number(c.weather_code);
  return { kind: weatherKind(code), code, tempC: Number(c.temperature_2m), windKmh: Number(c.wind_speed_10m), isDay: c.is_day === 1, lat: la, lon: lo, source: 'open-meteo', fetchedAt: r.fetchedAt };
}

/** Public page where a person can check the same forecast. */
export const weatherSourceUrl = (lat: number, lon: number) => 'https://open-meteo.com/en/docs' + qs({ latitude: round1(lat), longitude: round1(lon) });

export interface Place {
  name: string;
  country: string;
  admin: string | null;
  lat: number;
  lon: number;
  timezone: string | null;
}

/** Find a city by name (best match first). */
export async function geocode(name: string, ctx: CallContext, count = 5): Promise<{ results: Place[]; sourceUrl: string; fetchedAt: string }> {
  const url = 'https://geocoding-api.open-meteo.com/v1/search' + qs({ name: name.trim(), count: Math.min(count, 10), language: 'en', format: 'json' });
  const r = await fetchJson<any>(url, { provider: 'openmeteo', ctx, ttlMs: 24 * 60 * 60_000 });
  return {
    results: ((r.data?.results ?? []) as any[]).map((p) => ({ name: p.name, country: p.country ?? p.country_code ?? '', admin: p.admin1 ?? null, lat: p.latitude, lon: p.longitude, timezone: p.timezone ?? null })),
    sourceUrl: url,
    fetchedAt: r.fetchedAt,
  };
}
