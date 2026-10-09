import { candidates, type MealWindow } from './meals.ts';
import type { Meal, Restaurant } from './types.ts';

export interface RestaurantPreference extends Restaurant {
  visits: number;
  likes: number;
  neutral: number;
  dislikes: number;
  rated: number;
  score: number;
  weight: number;
  probability: number;
  eligible: boolean;
}
/** Three neutral prior observations keep small samples from dominating. */
export function preferenceWeight(
  likes: number,
  dislikes: number,
  rated: number,
  visits: number,
): number {
  const score = (likes - dislikes) / (rated + 3);
  const frequency = 1 + (0.12 * visits) / (visits + 3);
  return Math.min(1.8, Math.max(0.5, Math.exp(score) * frequency));
}
export function restaurantPreferences(
  restaurants: Restaurant[],
  meals: Meal[],
  windowSize: number,
  additional: MealWindow[] = [],
): RestaurantPreference[] {
  const eligible = new Set(candidates(restaurants, meals, windowSize, additional).map((r) => r.id));
  const counts = new Map<
    string,
    { visits: number; likes: number; dislikes: number; neutral: number }
  >();
  for (const meal of meals) {
    const count = counts.get(meal.restaurant_id) || {
      visits: 0,
      likes: 0,
      dislikes: 0,
      neutral: 0,
    };
    count.visits++;
    if (meal.rating === 1) count.likes++;
    if (meal.rating === -1) count.dislikes++;
    if (meal.rating === 0) count.neutral++;
    counts.set(meal.restaurant_id, count);
  }
  const rows = restaurants.map((restaurant) => {
    const count = counts.get(restaurant.id) || { visits: 0, likes: 0, dislikes: 0, neutral: 0 };
    const rated = count.likes + count.dislikes + count.neutral;
    return {
      ...restaurant,
      ...count,
      rated,
      score: (count.likes - count.dislikes) / (rated + 3),
      weight: preferenceWeight(count.likes, count.dislikes, rated, count.visits),
      eligible: eligible.has(restaurant.id),
      probability: 0,
    };
  });
  const total = rows.reduce((sum, row) => sum + (row.eligible ? row.weight : 0), 0);
  return rows.map((row) => ({
    ...row,
    probability: row.eligible && total ? row.weight / total : 0,
  }));
}
export function pickWeighted(
  rows: RestaurantPreference[],
  random = Math.random(),
): RestaurantPreference | null {
  const pool = rows.filter((row) => row.eligible);
  const total = pool.reduce((sum, row) => sum + row.weight, 0);
  if (!pool.length || !total) return null;
  let threshold = Math.max(0, Math.min(random, 1 - Number.EPSILON)) * total;
  for (const row of pool) {
    threshold -= row.weight;
    if (threshold < 0) return row;
  }
  return pool.at(-1)!;
}
export function preferenceLabel(row: RestaurantPreference): string {
  if (!row.rated) return '还在了解';
  if (row.score > 0.1) return '偏喜欢';
  if (row.score < -0.1) return '少选一点';
  return '口味均衡';
}
