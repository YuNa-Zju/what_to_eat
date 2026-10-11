import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SyncConflict,
  SyncEngine,
  joinContent,
  mergeContent,
  normalizeContent,
  type SyncContent,
  type SyncSession,
  type SyncSnapshot,
} from '../src/lib/sync-engine.ts';
import type { Meal } from '../src/lib/types.ts';
const meal = (id: string, rating: Meal['rating'] = null): Meal => ({
  id,
  restaurant_id: 'restaurant',
  eaten_on: '2026-10-11',
  created_at: 1,
  rating,
  cost_cents: null,
});
const content = (...meals: Meal[]): SyncContent =>
  normalizeContent({ local: { version: 1, window_size: 5, meals }, nickname: '' });
const copy = <T>(v: T): T => structuredClone(v);
function harness(initial: SyncContent) {
  let local = copy(initial);
  let remote: SyncSnapshot = { revision: 1, content: copy(initial) };
  let session: SyncSession | null = {
    code: 'test',
    connection: 'one',
    base: copy(remote),
    lastSynced: 0,
  };
  let writes = 0;
  const hooks: { get?: () => Promise<void>; put?: () => Promise<void> } = {};
  const engine = new SyncEngine({
    session: () => session,
    content: () => copy(local),
    get: async () => {
      await hooks.get?.();
      return copy(remote);
    },
    put: async (_, value) => {
      writes++;
      await hooks.put?.();
      if (value.revision !== remote.revision) throw new SyncConflict();
      remote = { content: copy(value.content), revision: value.revision + 1 };
      return copy(remote);
    },
    commit: (next, value) => {
      session = next;
      local = copy(value);
    },
  });
  return {
    engine,
    hooks,
    get local() {
      return local;
    },
    set local(v) {
      local = v;
    },
    get remote() {
      return remote;
    },
    set remote(v) {
      remote = v;
    },
    get session() {
      return session;
    },
    set session(v) {
      session = v;
    },
    get writes() {
      return writes;
    },
  };
}
test('first join unions meals without duplicating IDs and keeps cloud preferences', () => {
  const local = content(meal('a'), meal('b', -1));
  const remote = content(meal('b', 1), meal('c'));
  remote.nickname = '云端昵称';
  remote.local.window_size = 8;
  const joined = joinContent(local, remote);
  assert.deepEqual(
    joined.local.meals.map((m) => m.id),
    ['a', 'b', 'c'],
  );
  assert.equal(joined.local.meals[1].rating, 1);
  assert.equal(joined.nickname, '云端昵称');
  assert.equal(joined.local.window_size, 8);
});
test('independent offline edits merge fields and links; deletions cannot resurrect', () => {
  const base = content(meal('a'), meal('b'));
  const local = copy(base),
    remote = copy(base);
  local.local.meals[0].rating = 1;
  local.local.meals[0].post_ids = ['p1'];
  remote.local.meals[0].cost_cents = 3500;
  remote.local.meals[0].post_ids = ['p2'];
  local.local.meals.pop();
  remote.local.meals[1].rating = -1;
  remote.local.meals.push(meal('c'));
  const result = mergeContent(base, local, remote);
  assert.equal(result.local.meals.length, 2);
  assert.equal(result.local.meals[0].rating, 1);
  assert.equal(result.local.meals[0].cost_cents, 3500);
  assert.deepEqual(result.local.meals[0].post_ids, ['p1', 'p2']);
  assert.ok(!result.local.meals.some((m) => m.id === 'b'));
  assert.ok(!mergeContent(base, remote, local).local.meals.some((m) => m.id === 'b'));
});
test('sync retries compare-and-set conflicts and keeps both devices new meals', async () => {
  const h = harness(content(meal('a')));
  h.local.local.meals.push(meal('b'));
  h.hooks.put = async () => {
    h.hooks.put = undefined;
    h.remote = { revision: 2, content: content(meal('a'), meal('c')) };
  };
  await h.engine.sync();
  assert.deepEqual(
    h.local.local.meals.map((m) => m.id),
    ['a', 'b', 'c'],
  );
  assert.deepEqual(h.local, h.remote.content);
  assert.equal(h.writes, 2);
});
test('offline failure keeps unacknowledged edits and checkpoint for the next retry', async () => {
  const h = harness(content(meal('a')));
  h.local.local.meals[0].rating = -1;
  h.hooks.put = async () => {
    throw new Error('offline');
  };
  await assert.rejects(h.engine.sync(), /offline/);
  assert.equal(h.local.local.meals[0].rating, -1);
  assert.equal(h.session?.base.revision, 1);
  h.hooks.put = undefined;
  await h.engine.sync();
  assert.equal(h.remote.content.local.meals[0].rating, -1);
});
test('edits during an in-flight save survive its response and are sent next', async () => {
  const h = harness(content(meal('a')));
  h.local.nickname = '饭友';
  h.hooks.put = async () => {
    h.hooks.put = undefined;
    h.local.local.meals[0].cost_cents = 2500;
  };
  const first = h.engine.sync();
  assert.equal(h.engine.sync(), first);
  await first;
  assert.equal(h.remote.content.nickname, '饭友');
  assert.equal(h.remote.content.local.meals[0].cost_cents, 2500);
  assert.equal(h.writes, 2);
});
test('a lost successful response is recovered without duplicating meals', async () => {
  const h = harness(content());
  h.local.local.meals.push(meal('a'));
  h.hooks.put = async () => {
    h.hooks.put = undefined;
    h.remote = { revision: 2, content: copy(h.local) };
    throw new Error('lost response');
  };
  await assert.rejects(h.engine.sync(), /lost/);
  await h.engine.sync();
  assert.equal(h.remote.content.local.meals.length, 1);
  assert.equal(h.writes, 1);
});
test('disconnect ignores delayed read responses', async () => {
  const h = harness(content(meal('a')));
  h.remote = { revision: 2, content: content(meal('b')) };
  h.hooks.get = async () => {
    h.session = null;
  };
  await h.engine.sync();
  assert.equal(h.local.local.meals[0].id, 'a');
  assert.equal(h.writes, 0);
});
test('pulling a deletion does not turn it into an offline addition next poll', async () => {
  const h = harness(content(meal('a')));
  h.remote = { revision: 2, content: content() };
  await h.engine.sync();
  await h.engine.sync();
  assert.equal(h.local.local.meals.length, 0);
  assert.equal(h.writes, 0);
});
test('a stale read cannot roll back a newer checkpoint committed by another tab', async () => {
  const h = harness(content(meal('a')));
  const engine = new SyncEngine({
    session: () => h.session,
    content: () => copy(h.local),
    get: async () => {
      const old = copy(h.remote);
      h.remote = { revision: 2, content: content(meal('a'), meal('b')) };
      h.local = copy(h.remote.content);
      h.session = { ...h.session!, base: copy(h.remote) };
      return old;
    },
    put: async (_, value) => {
      if (value.revision !== h.remote.revision) throw new SyncConflict();
      return value;
    },
    commit: (s, value) => {
      h.session = s;
      h.local = value;
    },
  });
  await engine.sync();
  assert.equal(h.session?.base.revision, 2);
  assert.equal(h.local.local.meals.length, 2);
});
