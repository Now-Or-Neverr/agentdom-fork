// OpenAQ v3: latest air-quality readings from the nearest monitoring station that reported recently.
// Key goes in the X-API-Key header. Many stations are stale, so only those with a reading in the
// last 3 days are used.
import { fetchJson, qs, type CallContext } from './http';
import { requireKey } from './keys';

const P = 'openaq';
const BASE = 'https://api.openaq.org/v3';
const FRESH_MS = 3 * 86400_000;

export interface AirReading {
  parameter: string; // pm25, pm10, o3, no2…
  label: string; // PM2.5
  value: number;
  units: string;
  at: string; // ISO UTC
}
export interface AirQuality {
  station: string;
  locality: string | null;
  country: string | null;
  network: string | null; // who runs the station
  distanceKm: number;
  lat: number;
  lon: number;
  readings: AirReading[];
  sourceUrl: string; // OpenAQ Explorer page for the station
  fetchedAt: string;
}

/** Latest readings at the closest recently-reporting station within `radiusKm` (max 25). */
export async function airQuality(lat: number, lon: number, ctx: CallContext, radiusKm = 25): Promise<AirQuality> {
  const key = requireKey(P);
  const headers = { 'X-API-Key': key };
  const radius = Math.round(Math.min(25, Math.max(1, radiusKm)) * 1000);
  const url = `${BASE}/locations` + qs({ coordinates: `${lat.toFixed(4)},${lon.toFixed(4)}`, radius, limit: 50 });
  const r = await fetchJson<any>(url, { provider: P, ctx, headers, ttlMs: 30 * 60_000, timeoutMs: 15_000 });
  const t = Date.now();
  const locs = ((r.data?.results ?? []) as any[])
    .filter((l) => l.datetimeLast?.utc && t - Date.parse(l.datetimeLast.utc) < FRESH_MS)
    .sort((a, b) => Number(a.distance ?? 0) - Number(b.distance ?? 0));
  const loc = locs[0];
  if (!loc) throw new Error(`OpenAQ has no station within ${radius / 1000} km that reported in the last 3 days.`);
  const sensors = new Map<number, any>(((loc.sensors ?? []) as any[]).map((s) => [Number(s.id), s.parameter]));
  const lr = await fetchJson<any>(`${BASE}/locations/${loc.id}/latest`, { provider: P, ctx, headers, ttlMs: 15 * 60_000, timeoutMs: 15_000 });
  const seen = new Set<string>();
  const readings: AirReading[] = [];
  for (const x of (lr.data?.results ?? []) as any[]) {
    const p = sensors.get(Number(x.sensorsId));
    if (!p || !Number.isFinite(Number(x.value)) || seen.has(p.name)) continue;
    if (!x.datetime?.utc || t - Date.parse(x.datetime.utc) > FRESH_MS) continue;
    seen.add(p.name);
    readings.push({ parameter: p.name, label: p.displayName ?? p.name, value: Math.round(Number(x.value) * 100) / 100, units: p.units ?? '', at: x.datetime.utc });
  }
  return {
    station: String(loc.name ?? 'Unnamed station').trim(),
    locality: loc.locality ?? null,
    country: loc.country?.name ?? null,
    network: loc.provider?.name ?? null,
    distanceKm: Math.round(Number(loc.distance ?? 0) / 100) / 10,
    lat: Number(loc.coordinates?.latitude ?? lat),
    lon: Number(loc.coordinates?.longitude ?? lon),
    readings,
    sourceUrl: `https://explore.openaq.org/locations/${loc.id}`,
    fetchedAt: lr.fetchedAt,
  };
}
