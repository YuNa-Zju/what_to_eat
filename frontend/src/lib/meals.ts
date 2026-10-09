import type { Meal, Restaurant } from './types.ts';

export function orderedMeals(meals: Meal[]): Meal[] {
  return [...meals].sort(
    (a, b) =>
      b.eaten_on.localeCompare(a.eaten_on) ||
      b.created_at - a.created_at ||
      b.id.localeCompare(a.id),
  );
}
export function recentDistinct(meals: Meal[], size: number): Meal[] {
  const seen = new Set<string>();
  return orderedMeals(meals)
    .filter((meal) => {
      if (seen.has(meal.restaurant_id)) return false;
      seen.add(meal.restaurant_id);
      return true;
    })
    .slice(0, size);
}
export interface MealWindow {
  meals: Meal[];
  size: number;
}
export function excludedRestaurants(
  meals: Meal[],
  size: number,
  additional: MealWindow[] = [],
): Set<string> {
  return new Set(
    [{ meals, size }, ...additional].flatMap((w) =>
      recentDistinct(w.meals, w.size).map((m) => m.restaurant_id),
    ),
  );
}
export function candidates(
  restaurants: Restaurant[],
  meals: Meal[],
  size: number,
  additional: MealWindow[] = [],
): Restaurant[] {
  const excluded = excludedRestaurants(meals, size, additional);
  return restaurants.filter((restaurant) => restaurant.active && !excluded.has(restaurant.id));
}
export function today(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
