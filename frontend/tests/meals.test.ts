import test from 'node:test';
import assert from 'node:assert/strict';
import { candidates, recentDistinct } from '../src/lib/meals.ts';
import type { Meal } from '../src/lib/types.ts';
const meal = (restaurant_id: string, created_at: number, eaten_on = '2026-10-08'): Meal => ({
  id: `meal-${created_at}`,
  restaurant_id,
  created_at,
  rating: null,
  eaten_on,
});

test('重复饭店移到最近，只占一个位置', () => {
  const rows = [meal('a', 1), meal('b', 2), meal('c', 3), meal('a', 4)];
  assert.deepEqual(
    recentDistinct(rows, 3).map((m) => m.restaurant_id),
    ['a', 'c', 'b'],
  );
  assert.equal(rows.length, 4);
});
test('补记按用餐日期排序，缩短再放大窗口不会丢掉历史', () => {
  const rows = [meal('old', 100, '2026-10-01'), meal('new', 1, '2026-10-08')];
  assert.deepEqual(
    recentDistinct(rows, 1).map((m) => m.restaurant_id),
    ['new'],
  );
  assert.deepEqual(
    recentDistinct(rows, 5).map((m) => m.restaurant_id),
    ['new', 'old'],
  );
});
test('全部饭店参与推荐，旧停用标记不再排除饭店，窗口仍然生效', () => {
  const restaurants = [
    { id: 'a', name: 'A', active: true },
    { id: 'b', name: 'B', active: false },
  ];
  assert.deepEqual(
    candidates(restaurants, [meal('a', 1)], 5).map((r) => r.id),
    ['b'],
  );
  assert.deepEqual(
    candidates(restaurants, [], 5).map((r) => r.id),
    ['a', 'b'],
  );
  assert.deepEqual(candidates(restaurants, [meal('a', 1), meal('b', 2)], 5), []);
});
test('本地和共享记录分别计算', () => {
  const restaurants = [
    { id: 'a', name: 'A', active: true },
    { id: 'b', name: 'B', active: true },
  ];
  assert.deepEqual(
    candidates(restaurants, [meal('a', 1)], 1).map((r) => r.id),
    ['b'],
  );
  assert.deepEqual(
    candidates(restaurants, [meal('b', 1)], 1).map((r) => r.id),
    ['a'],
  );
});
