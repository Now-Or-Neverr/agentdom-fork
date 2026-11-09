// TheMealDB: recipe search with the free public test key "1" (in the path; not a secret).
import { clip, fetchJson, type CallContext } from './http';

export interface Meal {
  id: string;
  name: string;
  category: string | null;
  area: string | null; // cuisine
  ingredients: { name: string; measure: string }[];
  instructions: string;
  thumb: string | null;
  youtube: string | null;
  source: string | null; // original recipe page, when given
  url: string; // themealdb.com page
}
export interface MealSearch {
  query: string;
  results: Meal[];
  sourceUrl: string;
  fetchedAt: string;
}

function mapMeal(m: any): Meal {
  const ingredients: Meal['ingredients'] = [];
  for (let i = 1; i <= 20; i++) {
    const name = String(m[`strIngredient${i}`] ?? '').trim();
    if (name) ingredients.push({ name, measure: String(m[`strMeasure${i}`] ?? '').trim() });
  }
  return {
    id: String(m.idMeal),
    name: String(m.strMeal ?? ''),
    category: m.strCategory || null,
    area: m.strArea || null,
    ingredients,
    instructions: clip(String(m.strInstructions ?? '').replace(/\r/g, ''), 1500),
    thumb: m.strMealThumb || null,
    youtube: m.strYoutube || null,
    source: m.strSource || null,
    url: `https://www.themealdb.com/meal/${m.idMeal}`,
  };
}

/** Recipes whose name matches (e.g. "rendang", "chicken curry"). */
export async function mealSearch(query: string, ctx: CallContext, limit = 4): Promise<MealSearch> {
  const q = query.trim();
  if (!q) throw new Error('query is required.');
  const url = 'https://www.themealdb.com/api/json/v1/1/search.php?s=' + encodeURIComponent(q);
  const r = await fetchJson<any>(url, { provider: 'themealdb', ctx, ttlMs: 6 * 60 * 60_000, timeoutMs: 15_000 });
  const meals = (Array.isArray(r.data?.meals) ? r.data.meals : []) as any[];
  const results = meals.slice(0, Math.min(8, limit)).map(mapMeal);
  return { query: q, results, sourceUrl: results[0]?.url ?? 'https://www.themealdb.com', fetchedAt: r.fetchedAt };
}
