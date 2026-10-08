import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchScore, parseDay, dayValue } from '../src/lib/search.ts';
import { linkLocalPost, localPostIds, sortPosts } from '../src/lib/meal-posts.ts';
import type { LocalData, Post } from '../src/lib/types.ts';

test('restaurant search accepts partial Chinese characters, case and fullwidth input', () => {
  assert.ok(Number.isFinite(matchScore('兰州拉面', '兰拉')));
  assert.equal(matchScore('ＫＦＣ', 'kfc'), 0);
  assert.ok(matchScore('牛小新', '牛') < matchScore('纯味斑鱼府', '鱼'));
  assert.equal(matchScore('牛小新', '新牛'), Infinity);
  assert.equal(matchScore('麦当劳🍔', ' 麦 🍔 '), 3);
});

test('calendar rejects rollover dates and preserves local calendar day', () => {
  assert.equal(parseDay('2026-02-29'), null);
  assert.equal(parseDay('2026-04-31'), null);
  assert.equal(parseDay('2026-13-01'), null);
  assert.equal(parseDay('2026-1-01'), null);
  assert.equal(dayValue(parseDay('2024-02-29')!), '2024-02-29');
});

test('local post links survive retry and retain legacy post-as-meal IDs', () => {
  const data: LocalData = {
    version: 1,
    window_size: 5,
    meals: [{ id: 'meal', restaurant_id: 'r', eaten_on: '2026-10-09', created_at: 1, rating: 1 }],
  };
  const updated = linkLocalPost(linkLocalPost(data, 'meal', 'post'), 'meal', 'post');
  assert.deepEqual(localPostIds(updated.meals[0]), ['meal', 'post']);
  assert.equal(data.meals[0].post_ids, undefined);
  assert.throws(() => linkLocalPost(data, 'deleted', 'post'));
});

test('local scoped posts use the same stable sorting as the server', () => {
  const posts = [
    { id: 'a', created_at: 1, eaten_on: '2026-10-09', likes: 2 },
    { id: 'b', created_at: 2, eaten_on: '2026-10-08', likes: 1 },
    { id: 'c', created_at: 2, eaten_on: '2026-10-08', likes: 1 },
  ] as Post[];
  assert.deepEqual(
    sortPosts(posts, 'latest').map((p) => p.id),
    ['c', 'b', 'a'],
  );
  assert.deepEqual(
    sortPosts(posts, 'liked').map((p) => p.id),
    ['a', 'c', 'b'],
  );
  assert.deepEqual(
    sortPosts(posts, 'eaten').map((p) => p.id),
    ['a', 'c', 'b'],
  );
  assert.deepEqual(
    sortPosts(posts, 'oldest').map((p) => p.id),
    ['a', 'b', 'c'],
  );
});
