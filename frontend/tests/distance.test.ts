import test from 'node:test';
import assert from 'node:assert/strict';
import { distanceKm, distanceWeight } from '../src/lib/distance.ts';
import { pickWeighted, restaurantPreferences } from '../src/lib/preferences.ts';
import type { Meal, Restaurant, RestaurantLocation } from '../src/lib/types.ts';

const origin: RestaurantLocation = { lng: 120, lat: 30, coordinate_system: 'gcj02' };
const places: Restaurant[] = [
  { id: 'near', name: '附近', active: true, location: { ...origin, lat: 30.001 } },
  { id: 'far', name: '远处', active: true, location: { ...origin, lat: 30.1 } },
  { id: 'unknown', name: '未标位置', active: true },
];

test('distance stays finite, symmetric and ignores missing or invalid points', () => {
  assert.equal(distanceKm(origin, origin), 0);
  assert.equal(distanceKm(origin, null), null);
  assert.equal(distanceKm(origin, { ...origin, lng: NaN }), null);
  assert.equal(distanceKm(origin, { ...origin, lat: 91 }), null);
  assert.equal(
    distanceKm(origin, { ...origin, coordinate_system: 'wgs84' } as unknown as RestaurantLocation),
    null,
  );
  const km = distanceKm(origin, places[1].location)!;
  assert.ok(km > 11 && km < 11.2);
  assert.equal(km, distanceKm(places[1].location, origin));
  assert.ok(
    Number.isFinite(distanceKm({ ...origin, lat: 0, lng: 0 }, { ...origin, lat: 0, lng: 180 })),
  );
});

test('nearby receives a mild advantage; unknown and disabled distance retain base weight', () => {
  const original = restaurantPreferences(places, [], 0);
  assert.ok(original.every((r) => r.weight === 1 && r.distanceKm === null));
  const weighted = restaurantPreferences(places, [], 0, [], origin);
  assert.ok(weighted[0].probability > weighted[2].probability);
  assert.ok(weighted[2].probability > weighted[1].probability);
  assert.equal(weighted[2].weight, 1);
  assert.ok(weighted.every((r) => r.weight >= 0.8 && r.weight <= 1.201));
  assert.ok(Math.abs(weighted.reduce((n, r) => n + r.probability, 0) - 1) < 1e-12);
  assert.equal(distanceWeight(null), 1);
  assert.equal(distanceWeight(NaN), 1);
  assert.ok(distanceWeight(10000) >= 0.8);
});

test('distance cannot restore excluded restaurants or dilute personal history isolation', () => {
  const shared: Meal[] = [
    { id: 'shared', restaurant_id: 'near', eaten_on: '2026-10-09', created_at: 1, rating: 1 },
  ];
  const weighted = restaurantPreferences(places, [], 0, [{ meals: shared, size: 1 }], origin);
  assert.equal(weighted[0].probability, 0);
  assert.equal(weighted[0].likes, 0);
  for (const random of [0, 0.1, 0.4, 0.8, 1])
    assert.notEqual(pickWeighted(weighted, random)?.id, 'near');
  const none = restaurantPreferences(
    places,
    places.map((r, i) => ({
      id: String(i),
      restaurant_id: r.id,
      eaten_on: '2026-10-09',
      created_at: i,
      rating: null,
    })),
    3,
    [],
    origin,
  );
  assert.equal(pickWeighted(none), null);
  assert.ok(none.every((r) => r.probability === 0));
});

test('clear dislike still weighs less than a liked restaurant despite a shorter distance', () => {
  const meals: Meal[] = Array.from({ length: 4 }, (_, i) => [
    {
      id: `n${i}`,
      restaurant_id: 'near',
      eaten_on: '2026-10-09',
      created_at: i,
      rating: -1 as const,
    },
    {
      id: `f${i}`,
      restaurant_id: 'far',
      eaten_on: '2026-10-09',
      created_at: i,
      rating: 1 as const,
    },
  ]).flat();
  const weighted = restaurantPreferences(places, meals, 0, [], origin);
  assert.ok(weighted[0].probability < weighted[1].probability);
});
