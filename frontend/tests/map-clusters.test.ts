import test from 'node:test';
import assert from 'node:assert/strict';
import { clusterMapPoints, MAP_MARKER_HEIGHT, MAP_MARKER_WIDTH } from '../src/lib/map-clusters.ts';
import type { MapPoint } from '../src/lib/map-clusters.ts';

function point(id: string, x: number, y = 0): MapPoint {
  return { restaurant: { id, name: `饭店 ${id}` }, x, y };
}

function ids(points: ReturnType<typeof clusterMapPoints>) {
  return points.map((cluster) => cluster.restaurants.map((restaurant) => restaurant.id));
}

test('empty and non-finite screen points do not produce markers', () => {
  assert.deepEqual(clusterMapPoints([]), []);
  assert.deepEqual(
    clusterMapPoints([
      point('nan-x', NaN),
      point('nan-y', 0, NaN),
      point('infinity-x', Infinity),
      point('infinity-y', 0, -Infinity),
    ]),
    [],
  );
});

test('restaurants at the same coordinates share one stable marker', () => {
  const clusters = clusterMapPoints([
    point('c', 120, 30),
    point('a', 120, 30),
    point('b', 120, 30),
  ]);
  assert.deepEqual(ids(clusters), [['a', 'b', 'c']]);
  assert.deepEqual({ x: clusters[0].x, y: clusters[0].y }, { x: 120, y: 30 });
});

test('separated markers remain separate, including the collision boundary', () => {
  assert.equal(MAP_MARKER_WIDTH, 148);
  assert.equal(MAP_MARKER_HEIGHT, 44);
  for (const [x, y] of [
    [156, 0],
    [0, 54],
    [500, 500],
    [-156, 0],
    [0, -54],
  ]) {
    assert.deepEqual(ids(clusterMapPoints([point('a', 0), point('b', x, y)])), [['a'], ['b']]);
  }
  assert.deepEqual(ids(clusterMapPoints([point('a', 0), point('b', 155, 53)])), [['a', 'b']]);
});

test('a long overlapping chain stays in several bounded groups', () => {
  const points = Array.from({ length: 8 }, (_, index) => point(String(index), index * 100));
  const clusters = clusterMapPoints(points);
  assert.deepEqual(ids(clusters), [
    ['0', '1'],
    ['2', '3'],
    ['4', '5'],
    ['6', '7'],
  ]);
  assert.deepEqual(
    clusters.map(({ x }) => x),
    [0, 200, 400, 600],
  );
  for (const cluster of clusters) {
    for (const restaurant of cluster.restaurants) {
      const member = points.find((candidate) => candidate.restaurant === restaurant)!;
      assert.ok(Math.abs(member.x - cluster.x) < 156);
      assert.ok(Math.abs(member.y - cluster.y) < 54);
    }
  }
});

test('a point overlapping two existing groups chooses the nearest fixed seed', () => {
  const clusters = clusterMapPoints([point('a', 0), point('b', 200), point('c', 140)]);
  assert.deepEqual(ids(clusters), [['a'], ['b', 'c']]);
  assert.deepEqual(
    clusters.map(({ x }) => x),
    [0, 200],
  );
});

test('zooming in can split a group into individual markers', () => {
  const points = [point('a', 100, 100), point('b', 140, 100), point('c', 180, 100)];
  assert.deepEqual(ids(clusterMapPoints(points)), [['a', 'b', 'c']]);
  const zoomed = points.map((entry) => ({ ...entry, x: entry.x * 4, y: entry.y * 4 }));
  assert.deepEqual(ids(clusterMapPoints(zoomed)), [['a'], ['b'], ['c']]);
});

test('input order does not change groups or seeds and input objects stay untouched', () => {
  const points = [point('d', 140, 10), point('a', 0), point('c', 300), point('b', 200)];
  const original = structuredClone(points);
  for (const entry of points) {
    Object.freeze(entry.restaurant);
    Object.freeze(entry);
  }
  Object.freeze(points);
  const clusters = clusterMapPoints(points);
  assert.deepEqual(clusterMapPoints([...points].reverse()), clusters);
  assert.deepEqual(clusterMapPoints([points[1], points[3], points[0], points[2]]), clusters);
  assert.deepEqual(points, original);
});

test('every valid point appears exactly once and final markers do not overlap', () => {
  const valid = Array.from({ length: 40 }, (_, index) =>
    point(String(index).padStart(2, '0'), (index % 8) * 90, Math.floor(index / 8) * 40),
  );
  const clusters = clusterMapPoints([...valid, point('invalid', NaN)]);
  const members = clusters.flatMap((cluster) => cluster.restaurants);
  assert.equal(members.length, valid.length);
  assert.equal(new Set(members).size, valid.length);
  assert.deepEqual(
    members.map((restaurant) => restaurant.id).sort(),
    valid.map((entry) => entry.restaurant.id),
  );
  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      assert.ok(
        Math.abs(clusters[i].x - clusters[j].x) >= 156 ||
          Math.abs(clusters[i].y - clusters[j].y) >= 54,
      );
    }
  }
});
