import test from 'node:test';
import assert from 'node:assert/strict';
import { pickWeighted, preferenceWeight, restaurantPreferences } from '../src/lib/preferences.ts';
import type { Meal, Restaurant, Rating } from '../src/lib/types.ts';
const restaurants: Restaurant[] = ['a', 'b', 'new'].map((id) => ({ id, name: id, active: true }));
const meal = (id: string, rating: Rating, index: number): Meal => ({
  id: String(index),
  restaurant_id: id,
  rating,
  created_at: index,
  eaten_on: '2026-10-08',
});

test('不喜欢会降低概率，即使到访次数相同', () => {
  const rows = restaurantPreferences(restaurants, [meal('a', -1, 1), meal('b', 1, 2)], 0);
  assert.ok(rows[0].probability < rows[2].probability);
  assert.ok(rows[2].probability < rows[1].probability);
  assert.ok(Math.abs(rows.reduce((sum, r) => sum + r.probability, 0) - 1) < 1e-12);
});
test('就餐频率的加成温和，不能盖过明确的不喜欢', () => {
  assert.ok(preferenceWeight(0, 0, 0, 1000) < 1.12);
  assert.ok(preferenceWeight(0, 100, 100, 100) < 1);
  assert.equal(preferenceWeight(0, 0, 0, 0), 1);
  assert.ok(preferenceWeight(0, 1000, 1000, 1000) >= 0.5);
});
test('窗口和停用仍然优先，评价不能把它们放回池子', () => {
  const rows = restaurantPreferences(
    [{ ...restaurants[0], active: false }, restaurants[1], restaurants[2]],
    [meal('b', 1, 2)],
    1,
  );
  assert.equal(rows[0].probability, 0);
  assert.equal(rows[1].probability, 0);
  assert.equal(rows[2].probability, 1);
  assert.equal(pickWeighted(rows, 0.5)?.id, 'new');
});
test('抽样边界、空池和历史隔离', () => {
  const rows = restaurantPreferences(restaurants, [], 5);
  assert.equal(pickWeighted(rows, 0)?.id, 'a');
  assert.equal(pickWeighted(rows, 1)?.id, 'new');
  assert.equal(pickWeighted([]), null);
  const personal = restaurantPreferences(restaurants, [meal('a', -1, 1)], 0);
  assert.notEqual(personal[0].probability, rows[0].probability);
});
