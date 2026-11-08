// USDA FoodData Central: nutrient values per 100 g. Free api.data.gov key (1,000 requests
// per hour), sent in the X-Api-Key header. Foundation and SR Legacy foods are preferred
// (lab-analysed, per 100 g); Survey (FNDDS) is the fallback for mixed dishes. Cached 24 h.
import { clip, fetchJson, qs, type CallContext } from './http';
import { requireKey } from './keys';

const P = 'usda';
const BASE = 'https://api.nal.usda.gov/fdc/v1';
const TTL = 24 * 60 * 60_000;
export const foodPage = (id: number) => `https://fdc.nal.usda.gov/food-details/${id}/nutrients`;

// Nutrient numbers (stable across data types) → label.
const KEY_NUTRIENTS: Record<string, string> = {
  '208': 'Energy (kcal)',
  '957': 'Energy (kcal, Atwater general)',
  '958': 'Energy (kcal, Atwater specific)',
  '203': 'Protein',
  '204': 'Total fat',
  '606': 'Saturated fat',
  '205': 'Carbohydrate',
  '291': 'Fibre',
  '269': 'Total sugars',
  '307': 'Sodium',
  '306': 'Potassium',
  '301': 'Calcium',
  '303': 'Iron',
  '401': 'Vitamin C',
  '601': 'Cholesterol',
};

export interface FoodNutrient {
  name: string;
  amount: number;
  unit: string;
}
export interface FoodHit {
  fdcId: number;
  description: string;
  dataType: string;
  brand: string | null;
  per: string;
  nutrients: FoodNutrient[];
  url: string;
}
export interface FoodSearch {
  query: string;
  total: number;
  results: FoodHit[];
  sourceUrl: string;
  fetchedAt: string;
}

function mapFood(f: any): FoodHit {
  const seen = new Set<string>();
  const nutrients: FoodNutrient[] = [];
  for (const n of (f.foodNutrients ?? []) as any[]) {
    const num = String(n.nutrientNumber ?? '');
    const label = KEY_NUTRIENTS[num];
    if (!label || typeof n.value !== 'number') continue;
    const name = label.startsWith('Energy') ? 'Energy' : label;
    if (seen.has(name)) continue;
    seen.add(name);
    nutrients.push({ name, amount: Math.round(n.value * 100) / 100, unit: String(n.unitName ?? '').toLowerCase() });
  }
  const order = ['Energy', ...Object.values(KEY_NUTRIENTS).filter((l) => !l.startsWith('Energy'))];
  nutrients.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
  const branded = f.dataType === 'Branded';
  return {
    fdcId: Number(f.fdcId),
    description: clip(String(f.description ?? ''), 200),
    dataType: String(f.dataType ?? ''),
    brand: typeof f.brandOwner === 'string' ? f.brandOwner : null,
    per: branded && f.servingSize ? `100 g (label serving ${f.servingSize} ${f.servingSizeUnit ?? ''})`.trim() : '100 g',
    nutrients,
    url: foodPage(Number(f.fdcId)),
  };
}

/** Search foods; Foundation + SR Legacy first, Survey (FNDDS) if those find nothing. */
export async function nutritionLookup(query: string, ctx: CallContext, max = 5): Promise<FoodSearch> {
  const key = requireKey(P);
  const q = query.trim();
  if (!q) throw new Error('query is required.');
  if (q.length > 120) throw new Error('query is too long (max 120 characters).');
  const size = Math.min(6, Math.max(1, max));
  const get = (dataType: string) =>
    fetchJson<any>(`${BASE}/foods/search` + qs({ query: q, dataType, pageSize: size }), { provider: P, ctx, ttlMs: TTL, headers: { 'X-Api-Key': key } });
  let r = await get('Foundation,SR Legacy');
  if (!(r.data?.foods ?? []).length) r = await get('Survey (FNDDS)');
  const results = ((r.data?.foods ?? []) as any[]).filter((f) => typeof f?.fdcId === 'number').map(mapFood);
  return {
    query: q,
    total: Number(r.data?.totalHits ?? results.length),
    results,
    sourceUrl: results[0]?.url ?? `https://fdc.nal.usda.gov/food-search?query=${encodeURIComponent(q)}`,
    fetchedAt: r.fetchedAt,
  };
}
