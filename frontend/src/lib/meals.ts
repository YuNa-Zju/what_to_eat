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
export function candidates(restaurants: Restaurant[], meals: Meal[], size: number): Restaurant[] {
  const excluded = new Set(recentDistinct(meals, size).map((meal) => meal.restaurant_id));
  return restaurants.filter((restaurant) => restaurant.active && !excluded.has(restaurant.id));
}
export function today(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
