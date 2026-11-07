// Geoapify: geocode any place name worldwide, then list businesses of a category there
// (Places API v2, OpenStreetMap data). The key goes in `apiKey` (stripped from logs).
import { clip, fetchJson, qs, type CallContext } from './http';
import { requireKey } from './keys';

const P = 'geoapify';
const BASE = 'https://api.geoapify.com';

/** A friendly subset of Geoapify categories (any valid category id is accepted). */
export const PLACE_CATEGORIES: Record<string, string> = {
  'catering.cafe': 'Cafes',
  'catering.restaurant': 'Restaurants',
  'catering.fast_food': 'Fast food',
  'catering.bar': 'Bars',
  'commercial.supermarket': 'Supermarkets',
  'commercial.convenience': 'Convenience stores',
  'commercial.clothing': 'Clothing shops',
  'commercial.elektronics': 'Electronics shops',
  'commercial.hairdresser': 'Hairdressers',
  'commercial.marketplace': 'Markets',
  'service.beauty': 'Beauty services',
  'service.vehicle': 'Vehicle services',
  'accommodation.hotel': 'Hotels',
  'healthcare.pharmacy': 'Pharmacies',
  'healthcare.dentist': 'Dentists',
  'education.school': 'Schools',
  'office.coworking': 'Coworking spaces',
  'sport.fitness': 'Gyms & fitness',
  'pet': 'Pet shops & vets',
};
export const isPlaceCategory = (s: unknown): s is string =>
  typeof s === 'string' && s.split(',').length <= 3 && s.split(',').every((c) => /^[a-z_]+(\.[a-z_0-9]+){0,3}$/.test(c.trim()));

export interface GeoPlace {
  name: string;
  formatted: string;
  city: string | null;
  state: string | null;
  country: string | null;
  countryCode: string | null;
  type: string | null; // city, county, street…
  lat: number;
  lon: number;
  placeId: string;
}
export interface LocalBusiness {
  name: string;
  address: string;
  categories: string[];
  website: string | null;
  phone: string | null;
  openingHours: string | null;
  lat: number;
  lon: number;
  distanceM: number | null;
  osmUrl: string;
}
export interface LocalBusinesses {
  area: GeoPlace;
  category: string;
  /** 'area' = inside the city/region boundary; 'radius' = within radiusM of the point. */
  filter: 'area' | 'radius';
  radiusM: number | null;
  results: LocalBusiness[];
  sourceUrl: string; // OpenStreetMap at the area
  fetchedAt: string;
}

export const osmPoint = (lat: number, lon: number, zoom = 17) => `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=${zoom}/${lat}/${lon}`;
const AREA_TYPES = new Set(['city', 'county', 'state', 'postcode', 'district', 'suburb', 'country']);

/** Geocode a free-text place name anywhere in the world (best match first). */
export async function geoapifyGeocode(text: string, ctx: CallContext, limit = 1): Promise<{ query: string; results: GeoPlace[]; fetchedAt: string }> {
  const key = requireKey(P);
  const q = text.trim();
  if (!q) throw new Error('place is required.');
  if (q.length > 120) throw new Error('place is too long (max 120 characters).');
  const r = await fetchJson<any>(`${BASE}/v1/geocode/search` + qs({ text: q, limit: Math.min(5, Math.max(1, limit)), format: 'json', apiKey: key }), {
    provider: P,
    ctx,
    ttlMs: 7 * 86400_000,
    timeoutMs: 15_000,
  });
  const results: GeoPlace[] = ((r.data?.results ?? []) as any[])
    .filter((x) => Number.isFinite(x?.lat) && Number.isFinite(x?.lon) && x.place_id)
    .map((x) => ({
      name: x.name ?? x.city ?? x.formatted ?? q,
      formatted: x.formatted ?? '',
      city: x.city ?? null,
      state: x.state ?? null,
      country: x.country ?? null,
      countryCode: x.country_code ? String(x.country_code).toUpperCase() : null,
      type: x.result_type ?? null,
      lat: x.lat,
      lon: x.lon,
      placeId: x.place_id,
    }));
  return { query: q, results, fetchedAt: r.fetchedAt };
}

/**
 * Businesses of `category` (e.g. 'catering.cafe', up to 3 comma-separated) in `place`.
 * Cities and regions are searched inside their boundary; addresses/streets within `radiusM` (default 3 km).
 */
export async function localBusinesses(place: string, category: string, ctx: CallContext, opts: { limit?: number; radiusM?: number } = {}): Promise<LocalBusinesses> {
  const key = requireKey(P);
  const cat = category.trim().toLowerCase();
  if (!isPlaceCategory(cat)) throw new Error('category must be a Geoapify category such as catering.cafe or commercial.supermarket.');
  const g = await geoapifyGeocode(place, ctx, 1);
  const area = g.results[0];
  if (!area) throw new Error(`No place called “${place.trim()}” was found.`);
  const useArea = !!area.type && AREA_TYPES.has(area.type) && area.type !== 'country';
  const radiusM = Math.min(20_000, Math.max(200, Math.round(opts.radiusM ?? 3000)));
  const filter = useArea ? `place:${area.placeId}` : `circle:${area.lon},${area.lat},${radiusM}`;
  const r = await fetchJson<any>(
    `${BASE}/v2/places` + qs({ categories: cat, filter, bias: `proximity:${area.lon},${area.lat}`, limit: Math.min(40, Math.max(1, opts.limit ?? 20)), apiKey: key }),
    { provider: P, ctx, ttlMs: 24 * 3600_000, timeoutMs: 20_000 },
  );
  const results: LocalBusiness[] = ((r.data?.features ?? []) as any[])
    .map((f) => f?.properties ?? {})
    .filter((p) => p.name && Number.isFinite(p.lat) && Number.isFinite(p.lon))
    .map((p) => {
      const raw = p.datasource?.raw ?? {};
      const osmType = ({ n: 'node', w: 'way', r: 'relation', node: 'node', way: 'way', relation: 'relation' } as Record<string, string>)[raw.osm_type ?? ''];
      const osmId = Number.isFinite(Number(raw.osm_id)) ? Math.abs(Number(raw.osm_id)) : null;
      const site = p.website ?? raw.website ?? raw['contact:website'] ?? null;
      return {
        name: clip(String(p.name), 160),
        address: clip(String(p.address_line2 || p.formatted || ''), 240),
        categories: (Array.isArray(p.categories) ? (p.categories as unknown[]) : []).map(String).slice(0, 4),
        website: typeof site === 'string' && /^https?:\/\//.test(site) ? site : null,
        phone: (p.contact?.phone ?? raw.phone ?? raw['contact:phone'] ?? null) === null ? null : String(p.contact?.phone ?? raw.phone ?? raw['contact:phone']),
        openingHours: p.opening_hours ?? raw.opening_hours ? clip(String(p.opening_hours ?? raw.opening_hours), 200) : null,
        lat: p.lat,
        lon: p.lon,
        distanceM: typeof p.distance === 'number' ? Math.round(p.distance) : null,
        osmUrl: osmType && osmId ? `https://www.openstreetmap.org/${osmType}/${osmId}` : osmPoint(p.lat, p.lon),
      };
    });
  return { area, category: cat, filter: useArea ? 'area' : 'radius', radiusM: useArea ? null : radiusM, results, sourceUrl: osmPoint(area.lat, area.lon, useArea ? 12 : 15), fetchedAt: r.fetchedAt };
}
