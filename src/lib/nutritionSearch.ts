export interface NutritionSearchResult {
  id: string;
  name: string;
  source: 'Open Food Facts' | 'USDA';
  caloriesPer100g: number;
  proteinPer100g?: number;
  fatPer100g?: number;
  carbsPer100g?: number;
}

interface OffProduct {
  code?: string;
  product_name?: string;
  brands?: string;
  nutriments?: Record<string, number>;
}

interface UsdaNutrient {
  nutrientNumber?: string | number;
  value?: number;
}

interface UsdaFood {
  fdcId: number;
  description: string;
  foodNutrients?: UsdaNutrient[];
}

const USDA_NUTRIENT_MAP: Record<string, keyof Omit<NutritionSearchResult, 'id' | 'name' | 'source'>> = {
  '208': 'caloriesPer100g',
  '203': 'proteinPer100g',
  '204': 'fatPer100g',
  '205': 'carbsPer100g',
};

export async function searchOpenFoodFacts(query: string): Promise<NutritionSearchResult[]> {
  try {
    const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=8`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    const products: OffProduct[] = data.products || [];
    return products
      .filter((p) => p.product_name && p.nutriments && p.nutriments['energy-kcal_100g'] != null)
      .slice(0, 8)
      .map((p) => ({
        id: `off-${p.code || p.product_name}`,
        name: p.brands ? `${p.product_name} (${p.brands})` : p.product_name || '',
        source: 'Open Food Facts' as const,
        caloriesPer100g: Math.round(p.nutriments!['energy-kcal_100g']),
        proteinPer100g: p.nutriments!['proteins_100g'] != null ? Math.round(p.nutriments!['proteins_100g']) : undefined,
        fatPer100g: p.nutriments!['fat_100g'] != null ? Math.round(p.nutriments!['fat_100g']) : undefined,
        carbsPer100g: p.nutriments!['carbohydrates_100g'] != null ? Math.round(p.nutriments!['carbohydrates_100g']) : undefined,
      }));
  } catch {
    return [];
  }
}

export async function searchUsda(query: string): Promise<NutritionSearchResult[]> {
  try {
    const apiKey = import.meta.env.VITE_USDA_API_KEY || 'DEMO_KEY';
    const url = `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${apiKey}&query=${encodeURIComponent(query)}&pageSize=8`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    const foods: UsdaFood[] = data.foods || [];
    return foods
      .map((f) => {
        const result: Partial<NutritionSearchResult> = {
          id: `usda-${f.fdcId}`,
          name: f.description,
          source: 'USDA',
        };
        (f.foodNutrients || []).forEach((n) => {
          const key = USDA_NUTRIENT_MAP[String(n.nutrientNumber)];
          if (key && n.value != null) result[key] = Math.round(n.value);
        });
        return result as NutritionSearchResult;
      })
      .filter((r) => r.caloriesPer100g != null)
      .slice(0, 8);
  } catch {
    return [];
  }
}

/** Ищет одновременно в USDA (обычные продукты/ингредиенты) и Open Food Facts (упакованные товары). */
export async function searchNutritionDatabases(query: string): Promise<NutritionSearchResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const [usdaResult, offResult] = await Promise.allSettled([searchUsda(trimmed), searchOpenFoodFacts(trimmed)]);
  const usda = usdaResult.status === 'fulfilled' ? usdaResult.value : [];
  const off = offResult.status === 'fulfilled' ? offResult.value : [];
  return [...usda, ...off];
}
