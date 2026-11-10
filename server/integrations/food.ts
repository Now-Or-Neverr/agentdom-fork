// Apothecary, no-key sources: Open Food Facts (packaged food products by barcode or name, ODbL)
// and MedlinePlus health topics (US National Library of Medicine web service, XML).
import { clip, decodeEntities, fetchJson, fetchText, qs, stripHtml, type CallContext } from './http';

// ---------------- Open Food Facts ----------------
export interface FoodNutrients {
  energyKcal: number | null;
  fat: number | null;
  saturatedFat: number | null;
  carbs: number | null;
  sugars: number | null;
  fiber: number | null;
  protein: number | null;
  salt: number | null;
}
export interface FoodProduct {
  code: string; // barcode
  name: string;
  brands: string | null;
  quantity: string | null;
  nutriScore: string | null; // a-e
  novaGroup: number | null; // 1-4 (processing level)
  allergens: string[];
  ingredients: string | null;
  per100g: FoodNutrients;
  image: string | null;
  url: string;
}
export interface FoodResult {
  kind: 'barcode' | 'search';
  query: string;
  total: number;
  products: FoodProduct[];
  note: string;
  sourceUrl: string;
  fetchedAt: string;
}
const n = (v: unknown) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100) / 100);
const tagName = (t: string) => t.replace(/^[a-z]{2}:/, '').replace(/-/g, ' ');
const FIELDS = 'code,product_name,product_name_en,brands,quantity,nutriscore_grade,nova_group,allergens_tags,ingredients_text_en,ingredients_text,nutriments,image_front_small_url';
const product = (p: any): FoodProduct => {
  const m = p.nutriments ?? {};
  const grade = typeof p.nutriscore_grade === 'string' && /^[a-e]$/.test(p.nutriscore_grade) ? p.nutriscore_grade : null;
  return {
    code: String(p.code ?? ''),
    name: clip(String(p.product_name_en || p.product_name || '(no name)'), 160),
    brands: Array.isArray(p.brands) ? p.brands.join(', ') : p.brands ? String(p.brands) : null,
    quantity: p.quantity ? String(p.quantity) : null,
    nutriScore: grade,
    novaGroup: n(p.nova_group),
    allergens: ((p.allergens_tags ?? []) as string[]).map(tagName).slice(0, 10),
    ingredients: p.ingredients_text_en || p.ingredients_text ? clip(String(p.ingredients_text_en || p.ingredients_text), 500) : null,
    per100g: {
      energyKcal: n(m['energy-kcal_100g'] ?? (m['energy-kj_100g'] != null ? Number(m['energy-kj_100g']) / 4.184 : null)),
      fat: n(m.fat_100g),
      saturatedFat: n(m['saturated-fat_100g']),
      carbs: n(m.carbohydrates_100g),
      sugars: n(m.sugars_100g),
      fiber: n(m.fiber_100g),
      protein: n(m.proteins_100g),
      salt: n(m.salt_100g),
    },
    image: typeof p.image_front_small_url === 'string' ? p.image_front_small_url : null,
    url: `https://world.openfoodfacts.org/product/${encodeURIComponent(String(p.code ?? ''))}`,
  };
};
export const isBarcode = (s: string) => /^\d{8,14}$/.test(s.trim());
const FOOD_NOTE = 'Open Food Facts is filled in by volunteers from product labels. Check the package for allergens before relying on it.';

/** A packaged food by barcode (EAN/UPC), or a product name search. Nutrition per 100 g. */
export async function foodFacts(input: string, ctx: CallContext, limit = 6): Promise<FoodResult> {
  const s = input.trim();
  if (!s || s.length > 100) throw new Error('a barcode or product name is required (max 100 characters).');
  if (isBarcode(s)) {
    const r = await fetchJson<any>(`https://world.openfoodfacts.org/api/v2/product/${s}.json` + qs({ fields: FIELDS }), { provider: 'openfoodfacts', ctx, ttlMs: 24 * 3600_000, timeoutMs: 15_000, okStatuses: [404] });
    if (r.status === 404 || Number(r.data?.status) === 0 || !r.data?.product) throw new Error(`Open Food Facts has no product with barcode ${s}.`);
    return { kind: 'barcode', query: s, total: 1, products: [product({ code: s, ...r.data.product })], note: FOOD_NOTE, sourceUrl: `https://world.openfoodfacts.org/product/${s}`, fetchedAt: r.fetchedAt };
  }
  // Name search runs on Open Food Facts' search service (search.openfoodfacts.org).
  const r = await fetchJson<any>('https://search.openfoodfacts.org/search' + qs({ q: s, page_size: Math.min(12, Math.max(1, limit)), fields: FIELDS }), { provider: 'openfoodfacts', ctx, ttlMs: 6 * 3600_000, timeoutMs: 20_000 });
  return {
    kind: 'search',
    query: s,
    total: Number(r.data?.count ?? (r.data?.page_count ?? 0) * (r.data?.page_size ?? 0)),
    products: ((r.data?.hits ?? []) as any[]).map(product),
    note: FOOD_NOTE,
    sourceUrl: `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(s)}&search_simple=1`,
    fetchedAt: r.fetchedAt,
  };
}

// ---------------- MedlinePlus ----------------
export interface HealthTopic {
  title: string;
  altTitles: string[];
  summary: string;
  groups: string[];
  url: string;
}
export interface HealthTopics {
  query: string;
  language: 'en' | 'es';
  total: number;
  topics: HealthTopic[];
  note: string;
  sourceUrl: string;
  fetchedAt: string;
}

/** Consumer health topics from MedlinePlus (NIH): plain-language summary and the topic page. */
export async function healthTopics(query: string, ctx: CallContext, language: 'en' | 'es' = 'en', limit = 5): Promise<HealthTopics> {
  const q = query.trim();
  if (!q || q.length > 100) throw new Error('a health topic is required (max 100 characters).');
  const db = language === 'es' ? 'healthTopicsSpanish' : 'healthTopics';
  const r = await fetchText('https://wsearch.nlm.nih.gov/ws/query' + qs({ db, term: q, retmax: Math.min(10, Math.max(1, limit)) }), { provider: 'medlineplus', ctx, ttlMs: 24 * 3600_000, timeoutMs: 15_000, accept: 'application/xml, text/xml' });
  const xml = String(r.data ?? '');
  if (!/<nlmSearchResult/.test(xml)) throw new Error('MedlinePlus sent an answer we could not read.');
  const total = Number(/<count>(\d+)<\/count>/.exec(xml)?.[1] ?? 0);
  // Tags become spaces so "<p>What is it?</p><p>It is…" does not run together.
  const clean = (s: string) => stripHtml(decodeEntities(s).replace(/<\/?(p|li|ul|ol|br|div|h\d)\b[^>]*>/gi, ' '));
  const topics: HealthTopic[] = [];
  for (const m of xml.matchAll(/<document[^>]*url="([^"]+)"[^>]*>([\s\S]*?)<\/document>/g)) {
    const body = m[2];
    const all = (name: string) => [...body.matchAll(new RegExp(`<content name="${name}">([\\s\\S]*?)</content>`, 'g'))].map((x) => clean(x[1]));
    topics.push({
      title: all('title')[0] ?? '',
      altTitles: all('altTitle').slice(0, 4),
      summary: clip(all('FullSummary')[0] ?? all('snippet')[0] ?? '', 700),
      groups: all('groupName').slice(0, 4),
      url: decodeEntities(m[1]),
    });
  }
  return {
    query: q,
    language,
    total,
    topics,
    note: 'Information, not medical advice.',
    sourceUrl: `https://vsearch.nlm.nih.gov/vivisimo/cgi-bin/query-meta?v%3Aproject=medlineplus&query=${encodeURIComponent(q)}`,
    fetchedAt: r.fetchedAt,
  };
}
