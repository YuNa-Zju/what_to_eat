import type { LocalData, Meal } from './types';
import { MAX_COST_CENTS } from './money';
const KEY = 'what-to-eat:local:v1';
const NICKNAME_KEY = 'what-to-eat:nickname:v1';

export function readLastNickname(): string {
  try {
    return localStorage.getItem(NICKNAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function rememberNickname(nickname: string) {
  try {
    // An empty value also remembers the user's choice to publish anonymously.
    localStorage.setItem(NICKNAME_KEY, nickname.trim());
  } catch {
    // Remembering a nickname is optional and must not interrupt publishing.
  }
}

const defaults = (): LocalData => ({ version: 1, window_size: 5, meals: [] });
export function readLocal(): LocalData {
  const raw = localStorage.getItem(KEY);
  if (!raw) return defaults();
  const value = JSON.parse(raw) as LocalData;
  if (
    value.version !== 1 ||
    !Number.isInteger(value.window_size) ||
    value.window_size < 1 ||
    value.window_size > 100 ||
    !Array.isArray(value.meals) ||
    value.meals.some(
      (m) =>
        !m ||
        typeof m.id !== 'string' ||
        typeof m.restaurant_id !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(m.eaten_on) ||
        !Number.isFinite(m.created_at) ||
        (m.post_ids !== undefined &&
          (!Array.isArray(m.post_ids) || m.post_ids.some((id) => typeof id !== 'string'))) ||
        (m.rating != null && ![-1, 0, 1].includes(m.rating)) ||
        (m.cost_cents != null &&
          (!Number.isSafeInteger(m.cost_cents) ||
            m.cost_cents < 0 ||
            m.cost_cents > MAX_COST_CENTS)),
    )
  ) {
    throw new Error('本地记录格式异常，请先备份浏览器数据，不要清空存储');
  }
  return {
    ...value,
    meals: value.meals.map((meal) => ({
      ...meal,
      rating: meal.rating ?? null,
      cost_cents: meal.cost_cents ?? null,
    })),
  };
}
export function writeLocal(value: LocalData) {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    throw new Error('浏览器未能保存本地记录，请检查存储权限或剩余空间');
  }
}
export function updateLocal(change: (current: LocalData) => LocalData): LocalData {
  const next = change(readLocal());
  writeLocal(next);
  return next;
}
export function addLocalMeal(meal: Meal): LocalData {
  return updateLocal((current) => ({
    ...current,
    meals: current.meals.some((m) => m.id === meal.id) ? current.meals : [...current.meals, meal],
  }));
}
