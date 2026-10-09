import test from 'node:test';
import assert from 'node:assert/strict';
import { candidates } from '../src/lib/meals.ts';
import { restaurantPreferences } from '../src/lib/preferences.ts';
import { OptimisticStore } from '../src/lib/optimistic.ts';
import type { Meal, Restaurant } from '../src/lib/types.ts';
const restaurants: Restaurant[] = ['a', 'b', 'c', 'd'].map((id) => ({
  id,
  name: id,
  active: true,
}));
const meal = (id: string, day: number, rating: Meal['rating'] = null): Meal => ({
  id: `${id}-${day}`,
  restaurant_id: id,
  eaten_on: `2026-10-${String(day).padStart(2, '0')}`,
  created_at: day,
  rating,
});
test('personal and shared distinct windows are unioned independently', () => {
  const personal = [meal('a', 9), meal('a', 8), meal('b', 7)],
    shared = [meal('c', 9), meal('a', 8)];
  assert.deepEqual(
    candidates(restaurants, personal, 2, [{ meals: shared, size: 2 }]).map((r) => r.id),
    ['d'],
  );
  assert.deepEqual(
    candidates(restaurants, shared, 1).map((r) => r.id),
    ['a', 'b', 'd'],
  );
  assert.equal(
    candidates(restaurants, personal, 2, [{ meals: [...shared, meal('d', 7)], size: 3 }]).length,
    0,
  );
  const stats = restaurantPreferences(restaurants, personal, 1, [
    { meals: [meal('c', 9, -1)], size: 1 },
  ]);
  assert.equal(stats.find((r) => r.id === 'c')?.dislikes, 0);
  assert.equal(stats.find((r) => r.id === 'c')?.probability, 0);
  assert.ok(Math.abs(stats.reduce((n, r) => n + r.probability, 0) - 1) < 1e-9);
});
function deferred<T>() {
  let resolve!: (v: T) => void, reject!: (e: Error) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
test('pending patches survive refresh; failures only rollback their entity', async () => {
  const store = new OptimisticStore({ a: 0, b: 0 });
  const a = deferred<void>(),
    b = deferred<void>();
  const pa = store.mutate(
    'a',
    (s) => ({ ...s, a: 1 }),
    () => a.promise,
  );
  const failure = assert.rejects(pa, /offline/);
  const pb = store.mutate(
    'b',
    (s) => ({ ...s, b: 2 }),
    () => b.promise,
  );
  store.refresh({ a: 0, b: 0 }, store.version());
  assert.deepEqual(store.snapshot(), { a: 1, b: 2 });
  b.resolve();
  await pb;
  a.reject(new Error('offline'));
  await failure;
  assert.deepEqual(store.snapshot(), { a: 0, b: 2 });
});
test('old reads and duplicate writes cannot clobber committed state', async () => {
  const store = new OptimisticStore({ a: 0 });
  const version = store.version(),
    a = deferred<void>();
  const first = store.mutate(
    'a',
    (s) => ({ ...s, a: 2 }),
    () => a.promise,
  );
  await assert.rejects(
    store.mutate(
      'a',
      (s) => s,
      async () => {},
    ),
    /正在保存/,
  );
  a.resolve();
  await first;
  store.refresh({ a: 0 }, version);
  assert.deepEqual(store.snapshot(), { a: 2 });
});
