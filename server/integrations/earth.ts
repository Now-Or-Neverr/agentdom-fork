// Observatory, no-key sources: USGS earthquake feeds and the ISS position (wheretheiss.at).
import { clip, fetchJson, type CallContext } from './http';

export interface Quake {
  id: string;
  magnitude: number;
  place: string;
  time: string; // ISO
  depthKm: number;
  lat: number;
  lon: number;
  tsunami: boolean;
  alert: string | null; // PAGER level: green/yellow/orange/red
  felt: number | null;
  url: string; // USGS event page
}
export interface QuakeFeed {
  feed: string;
  title: string;
  count: number;
  quakes: Quake[]; // newest first
  sourceUrl: string;
  fetchedAt: string;
}

export const QUAKE_LEVELS = ['significant', '4.5', '2.5', 'all'] as const;
export const QUAKE_PERIODS = ['hour', 'day', 'week'] as const;
export type QuakeLevel = (typeof QUAKE_LEVELS)[number];
export type QuakePeriod = (typeof QUAKE_PERIODS)[number];

/** Recent earthquakes from a USGS summary feed (e.g. 4.5+ in the past day). */
export async function earthquakes(ctx: CallContext, level: QuakeLevel = '4.5', period: QuakePeriod = 'day', limit = 10): Promise<QuakeFeed> {
  if (!QUAKE_LEVELS.includes(level)) throw new Error(`level must be one of: ${QUAKE_LEVELS.join(', ')}.`);
  if (!QUAKE_PERIODS.includes(period)) throw new Error(`period must be one of: ${QUAKE_PERIODS.join(', ')}.`);
  const url = `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${level}_${period}.geojson`;
  const r = await fetchJson<any>(url, { provider: 'usgs', ctx, ttlMs: 5 * 60_000, timeoutMs: 15_000 });
  const feats = (r.data?.features ?? []) as any[];
  const quakes: Quake[] = feats
    .map((f) => {
      const p = f.properties ?? {};
      const c = f.geometry?.coordinates ?? [];
      return {
        id: String(f.id),
        magnitude: Math.round(Number(p.mag ?? 0) * 10) / 10,
        place: clip(p.place ?? p.title ?? 'Unknown location', 160),
        time: new Date(Number(p.time ?? 0)).toISOString(),
        depthKm: Math.round(Number(c[2] ?? 0) * 10) / 10,
        lat: Number(c[1] ?? 0),
        lon: Number(c[0] ?? 0),
        tsunami: Number(p.tsunami ?? 0) === 1,
        alert: p.alert ?? null,
        felt: p.felt ?? null,
        url: String(p.url ?? `https://earthquake.usgs.gov/earthquakes/eventpage/${f.id}`),
      };
    })
    .sort((a, b) => b.time.localeCompare(a.time));
  return {
    feed: `${level}_${period}`,
    title: String(r.data?.metadata?.title ?? `USGS ${level} earthquakes, past ${period}`),
    count: quakes.length,
    quakes: quakes.slice(0, Math.min(50, limit)),
    sourceUrl: 'https://earthquake.usgs.gov/earthquakes/map/',
    fetchedAt: r.fetchedAt,
  };
}

export interface IssPosition {
  lat: number;
  lon: number;
  altitudeKm: number;
  speedKmh: number;
  visibility: string; // daylight / eclipsed
  at: string; // ISO time of the position
  mapUrl: string; // OpenStreetMap at that point
  sourceUrl: string;
  fetchedAt: string;
}

/** Where the International Space Station is right now. */
export async function issPosition(ctx: CallContext): Promise<IssPosition> {
  const r = await fetchJson<any>('https://api.wheretheiss.at/v1/satellites/25544', { provider: 'wheretheiss', ctx, ttlMs: 10_000, timeoutMs: 10_000 });
  const d = r.data ?? {};
  const lat = Math.round(Number(d.latitude) * 1000) / 1000;
  const lon = Math.round(Number(d.longitude) * 1000) / 1000;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('wheretheiss.at sent no position.');
  return {
    lat,
    lon,
    altitudeKm: Math.round(Number(d.altitude ?? 0)),
    speedKmh: Math.round(Number(d.velocity ?? 0)),
    visibility: String(d.visibility ?? ''),
    at: new Date(Number(d.timestamp ?? 0) * 1000).toISOString(),
    mapUrl: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=4/${lat}/${lon}`,
    sourceUrl: 'https://wheretheiss.at/',
    fetchedAt: r.fetchedAt,
  };
}
