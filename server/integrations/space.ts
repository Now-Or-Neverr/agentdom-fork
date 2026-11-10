// Observatory, no-key sources: NOAA SWPC space weather, Launch Library 2 (The Space Devs),
// Spaceflight News API and sunrise-sunset.org.
// Launch Library 2 allows about 15 requests an hour without a key, so it is always called with
// the same URL and cached for 30 minutes (at most ~2 real calls an hour).
import { clip, fetchJson, qs, stripHtml, type CallContext } from './http';

// ---------------- NOAA SWPC ----------------
export interface KpReading {
  time: string; // ISO (UTC), start of the 3-hour window
  kp: number;
}
export interface NoaaScale {
  scale: number; // 0-5
  text: string; // none, minor, moderate, strong, severe, extreme
}
export interface SolarFlare {
  beginTime: string | null;
  maxTime: string | null;
  endTime: string | null;
  maxClass: string | null; // e.g. "M1.2"
  currentClass: string | null;
}
export interface SpaceWeather {
  kpNow: KpReading | null;
  kpMax24h: KpReading | null;
  kpRecent: KpReading[]; // last 24 h, oldest first
  stormLevel: string; // plain words for kpNow
  scales: { radio: NoaaScale; solar: NoaaScale; geomagnetic: NoaaScale; at: string | null };
  flare: SolarFlare | null;
  auroraUrl: string; // NOAA 30-minute aurora forecast page
  sourceUrl: string;
  fetchedAt: string;
}

const kpWords = (kp: number) => (kp >= 9 ? 'extreme storm (G5)' : kp >= 8 ? 'severe storm (G4)' : kp >= 7 ? 'strong storm (G3)' : kp >= 6 ? 'moderate storm (G2)' : kp >= 5 ? 'minor storm (G1)' : kp >= 4 ? 'active' : 'quiet');
const isoZ = (s: unknown) => (typeof s === 'string' && s ? (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? new Date(s).toISOString() : new Date(s + 'Z').toISOString()) : null);
const scale = (o: any): NoaaScale => ({ scale: Number(o?.Scale ?? 0) || 0, text: String(o?.Text ?? 'none') });

/** Planetary Kp index (last 24 h), NOAA R/S/G scales right now and the latest solar flare. */
export async function spaceWeather(ctx: CallContext): Promise<SpaceWeather> {
  const opts = { provider: 'swpc', ctx, ttlMs: 10 * 60_000, timeoutMs: 15_000 };
  const [kp, scales, flares] = await Promise.all([
    fetchJson<any>('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json', opts),
    fetchJson<any>('https://services.swpc.noaa.gov/products/noaa-scales.json', opts),
    fetchJson<any>('https://services.swpc.noaa.gov/json/goes/primary/xray-flares-latest.json', opts),
  ]);
  // The Kp product is either a list of objects (current) or a header row + arrays (older format).
  const rows = (Array.isArray(kp.data) ? kp.data : []) as any[];
  const readings: KpReading[] = rows
    .map((r) => (Array.isArray(r) ? { time: r[0], kp: r[1] } : { time: r?.time_tag, kp: r?.Kp ?? r?.kp_index }))
    .filter((r) => r.time && r.time !== 'time_tag' && Number.isFinite(Number(r.kp)))
    .map((r) => ({ time: isoZ(r.time) as string, kp: Math.round(Number(r.kp) * 100) / 100 }));
  const since = Date.now() - 24 * 3600_000;
  const recent = readings.filter((r) => new Date(r.time).getTime() >= since - 3 * 3600_000);
  const kpNow = readings.at(-1) ?? null;
  const kpMax24h = recent.length ? recent.reduce((a, b) => (b.kp > a.kp ? b : a)) : null;
  const s0 = scales.data?.['0'] ?? {};
  const f = ((Array.isArray(flares.data) ? flares.data : []) as any[])[0];
  return {
    kpNow,
    kpMax24h,
    kpRecent: recent.slice(-8),
    stormLevel: kpNow ? kpWords(kpNow.kp) : 'unknown',
    scales: { radio: scale(s0.R), solar: scale(s0.S), geomagnetic: scale(s0.G), at: s0.DateStamp ? `${s0.DateStamp}T${s0.TimeStamp ?? '00:00:00'}Z` : null },
    flare: f ? { beginTime: isoZ(f.begin_time), maxTime: isoZ(f.max_time), endTime: isoZ(f.end_time), maxClass: f.max_class ?? null, currentClass: f.current_class ?? null } : null,
    auroraUrl: 'https://www.swpc.noaa.gov/products/aurora-30-minute-forecast',
    sourceUrl: 'https://www.swpc.noaa.gov/',
    fetchedAt: kp.fetchedAt,
  };
}

// ---------------- Launch Library 2 ----------------
export interface RocketLaunch {
  id: string;
  name: string;
  net: string | null; // ISO, "no earlier than"
  windowStart: string | null;
  status: string; // Go for Launch, TBD, TBC…
  statusDetail: string;
  precision: string | null; // Minute, Hour, Day, Month…
  provider: string | null;
  rocket: string | null;
  mission: string | null;
  missionType: string | null;
  orbit: string | null;
  missionDescription: string;
  pad: string | null;
  location: string | null;
  image: string | null;
  url: string; // spacelaunchnow / thespacedevs page
}
export interface LaunchList {
  count: number;
  launches: RocketLaunch[];
  sourceUrl: string;
  fetchedAt: string;
}

/** The next rocket launches worldwide (Launch Library 2, free tier: cached 30 min). */
export async function upcomingLaunches(ctx: CallContext, limit = 10): Promise<LaunchList> {
  // Always the same URL so every caller shares one cached answer.
  const r = await fetchJson<any>('https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=12', { provider: 'launchlibrary', ctx, ttlMs: 30 * 60_000, timeoutMs: 20_000 });
  const launches: RocketLaunch[] = ((r.data?.results ?? []) as any[]).map((l) => ({
    id: String(l.id),
    name: clip(l.name ?? '', 140),
    net: l.net ?? null,
    windowStart: l.window_start ?? null,
    status: String(l.status?.name ?? 'Unknown'),
    statusDetail: clip(l.status?.description ?? '', 160),
    precision: l.net_precision?.name ?? null,
    provider: l.launch_service_provider?.name ?? null,
    rocket: l.rocket?.configuration?.full_name ?? l.rocket?.configuration?.name ?? null,
    mission: l.mission?.name ?? null,
    missionType: l.mission?.type ?? null,
    orbit: l.mission?.orbit?.name ?? null,
    missionDescription: clip(l.mission?.description ?? '', 300),
    pad: l.pad?.name ?? null,
    location: l.pad?.location?.name ?? null,
    image: typeof l.image === 'string' ? l.image : null,
    // Space Launch Now is The Space Devs' own human-readable page for each launch.
    url: l.slug ? `https://spacelaunchnow.app/launch/${encodeURIComponent(l.slug)}/` : 'https://thespacedevs.com/llapi',
  }));
  return { count: Number(r.data?.count ?? launches.length), launches: launches.slice(0, Math.min(12, limit)), sourceUrl: 'https://thespacedevs.com/llapi', fetchedAt: r.fetchedAt };
}

// ---------------- Spaceflight News API ----------------
export interface SpaceArticle {
  id: number;
  title: string;
  site: string;
  summary: string;
  published: string;
  url: string;
  image: string | null;
}
export interface SpaceNews {
  query: string | null;
  articles: SpaceArticle[];
  sourceUrl: string;
  fetchedAt: string;
}

/** Latest spaceflight news articles (optionally matching a search word). */
export async function spaceNews(ctx: CallContext, query?: string, limit = 8): Promise<SpaceNews> {
  const s = query?.trim() || undefined;
  if (s && s.length > 100) throw new Error('search is too long (max 100 characters).');
  const r = await fetchJson<any>('https://api.spaceflightnewsapi.net/v4/articles/' + qs({ limit: Math.min(20, Math.max(1, limit)), search: s }), { provider: 'spaceflightnews', ctx, ttlMs: 15 * 60_000, timeoutMs: 15_000 });
  return {
    query: s ?? null,
    articles: ((r.data?.results ?? []) as any[]).map((a) => ({
      id: Number(a.id),
      title: clip(a.title ?? '', 200),
      site: String(a.news_site ?? ''),
      summary: clip(stripHtml(a.summary ?? ''), 300),
      published: String(a.published_at ?? ''),
      url: String(a.url ?? ''),
      image: typeof a.image_url === 'string' && a.image_url ? a.image_url : null,
    })),
    sourceUrl: 'https://spaceflightnewsapi.net/',
    fetchedAt: r.fetchedAt,
  };
}

// ---------------- sunrise-sunset.org ----------------
export interface SunTimes {
  lat: number;
  lon: number;
  date: string; // YYYY-MM-DD (UTC date asked for)
  sunrise: string | null; // ISO UTC
  sunset: string | null;
  solarNoon: string | null;
  dayLengthSec: number | null;
  civilDawn: string | null;
  civilDusk: string | null;
  nauticalDawn: string | null;
  nauticalDusk: string | null;
  astronomicalDawn: string | null;
  astronomicalDusk: string | null;
  note: string | null; // polar day/night etc.
  attribution: string;
  sourceUrl: string;
  fetchedAt: string;
}

/** Sunrise, sunset, solar noon and twilight times (UTC) for a point on a date (default today). */
export async function sunTimes(lat: number, lon: number, ctx: CallContext, date?: string): Promise<SunTimes> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error('lat must be -90..90 and lon -180..180.');
  const d = date ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error('date must be YYYY-MM-DD.');
  const la = Math.round(lat * 1000) / 1000;
  const lo = Math.round(lon * 1000) / 1000;
  const r = await fetchJson<any>('https://api.sunrise-sunset.org/json' + qs({ lat: la, lng: lo, date: d, formatted: 0 }), { provider: 'sunrisesunset', ctx, ttlMs: 6 * 3600_000, timeoutMs: 12_000 });
  if (r.data?.status && r.data.status !== 'OK') throw new Error(`sunrise-sunset.org said: ${r.data.status}`);
  const x = r.data?.results ?? {};
  // 1970-01-01T00:00:01+00:00 marks "no sunrise/sunset" (polar day or night).
  const t = (v: unknown) => (typeof v === 'string' && !v.startsWith('1970-01-01') ? new Date(v).toISOString() : null);
  const dl = Number(x.day_length);
  return {
    lat: la,
    lon: lo,
    date: d,
    sunrise: t(x.sunrise),
    sunset: t(x.sunset),
    solarNoon: t(x.solar_noon),
    dayLengthSec: Number.isFinite(dl) ? dl : null,
    civilDawn: t(x.civil_twilight_begin),
    civilDusk: t(x.civil_twilight_end),
    nauticalDawn: t(x.nautical_twilight_begin),
    nauticalDusk: t(x.nautical_twilight_end),
    astronomicalDawn: t(x.astronomical_twilight_begin),
    astronomicalDusk: t(x.astronomical_twilight_end),
    note: !t(x.sunrise) && !t(x.sunset) ? (dl > 0 ? 'The sun does not set on this day (polar day).' : 'The sun does not rise on this day (polar night).') : null,
    attribution: 'Sunrise and sunset times by sunrise-sunset.org',
    sourceUrl: 'https://sunrise-sunset.org/',
    fetchedAt: r.fetchedAt,
  };
}
