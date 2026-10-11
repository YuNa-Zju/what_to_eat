import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SyncConflict,
  SyncEngine,
  joinContent,
  mergeContent,
  normalizeContent,
  sameCheckpoint,
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
  let writes = 0,
    commits = 0,
    sequence = 0;
  const receipts = new Map<string, SyncSnapshot>();
  const operations: string[] = [];
  const hooks: {
    get?: () => Promise<void>;
    put?: () => Promise<void>;
    afterPut?: () => Promise<void>;
    save?: () => void;
  } = {};
  const port = {
    session: () => session,
    content: () => copy(local),
    get: async (_code: string, revision: number) => {
      await hooks.get?.();
      return remote.revision === revision ? null : copy(remote);
    },
    put: async (_code: string, value: SyncSnapshot, operation: string) => {
      writes++;
      operations.push(operation);
      const receipt = receipts.get(operation);
      if (receipt) return copy(receipt);
      await hooks.put?.();
      if (value.revision !== remote.revision) throw new SyncConflict();
      remote = { content: copy(value.content), revision: value.revision + 1 };
      receipts.set(operation, copy(remote));
      await hooks.afterPut?.();
      return copy(remote);
    },
    save: async (
      expected: SyncSession,
      next: SyncSession,
      apply?: { before: SyncContent; next: SyncContent },
    ) => {
      hooks.save?.();
      if (!sameCheckpoint(session, expected)) return false;
      session = { ...next, checkpoint: String(++sequence) };
      if (apply) local = mergeContent(apply.before, local, apply.next);
      commits++;
      return true;
    },
  };
  return {
    engine: new SyncEngine(port),
    restart: () => new SyncEngine(port),
    hooks,
    operations,
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
      session = v ? { ...v, checkpoint: String(++sequence) } : null;
    },
    get writes() {
      return writes;
    },
    get commits() {
      return commits;
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
  h.hooks.afterPut = async () => {
    h.hooks.afterPut = undefined;
    throw new Error('lost response');
  };
  await assert.rejects(h.engine.sync(), /lost/);
  await h.engine.sync();
  assert.equal(h.remote.content.local.meals.length, 1);
  assert.equal(h.writes, 2);
  assert.equal(h.operations[0], h.operations[1]);
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
test('GET waiting for another tab cannot restore a deletion at the same remote revision', async () => {
  const h = harness(content(meal('a')));
  h.hooks.get = async () => {
    h.hooks.get = undefined;
    h.remote = { revision: 2, content: content(meal('a'), meal('b')) };
    h.session = { ...h.session!, base: copy(h.remote) };
    // The other tab has applied b, and the user has already deleted it again.
    h.local = content(meal('a'));
  };
  await h.engine.sync();
  assert.deepEqual(
    h.remote.content.local.meals.map((m) => m.id),
    ['a'],
  );
  assert.deepEqual(h.local, h.remote.content);
});
test('same-revision checkpoint replacement is detected before preparing a write', async () => {
  const h = harness(content(meal('a')));
  h.local.local.meals[0].rating = 1;
  let reads = 0;
  h.hooks.get = async () => {
    if (++reads === 1) h.session = { ...h.session! };
  };
  await h.engine.sync();
  assert.ok(reads >= 3);
  assert.equal(h.remote.content.local.meals[0].rating, 1);
  assert.equal(h.writes, 1);
});
test('a saved operation receipt survives reload and preserves a later edit on another device', async () => {
  const h = harness(content());
  h.local = content(meal('a'));
  h.hooks.afterPut = async () => {
    h.hooks.afterPut = undefined;
    throw new Error('lost response');
  };
  await assert.rejects(h.engine.sync(), /lost response/);
  assert.ok(h.session?.pendingWrite);
  h.remote = { revision: 3, content: content({ ...meal('a'), cost_cents: 3500 }) };
  await h.restart().sync();
  assert.equal(h.remote.revision, 3);
  assert.equal(h.local.local.meals[0].cost_cents, 3500);
  assert.equal(h.operations[0], h.operations[1]);
  assert.equal(h.session?.pendingWrite, undefined);
});
test('local deletion after an uncertain save is rebased against its acknowledgement', async () => {
  const h = harness(content());
  h.local = content(meal('a'));
  h.hooks.afterPut = async () => {
    h.hooks.afterPut = undefined;
    throw new Error('lost response');
  };
  await assert.rejects(h.engine.sync());
  h.local = content();
  await h.restart().sync();
  assert.equal(h.remote.content.local.meals.length, 0);
});
test('an unchanged conditional GET does not write a checkpoint', async () => {
  const h = harness(content(meal('a')));
  await h.engine.sync();
  await h.engine.sync();
  assert.equal(h.writes, 0);
  assert.equal(h.commits, 0);
});
test('a user edit immediately before committing a pull survives the storage transaction', async () => {
  const h = harness(content(meal('a')));
  h.remote = { revision: 2, content: content({ ...meal('a'), cost_cents: 1200 }) };
  h.hooks.save = () => {
    h.hooks.save = undefined;
    h.local.local.meals[0].rating = 1;
  };
  await h.engine.sync();
  assert.equal(h.local.local.meals[0].rating, 1);
  assert.equal(h.local.local.meals[0].cost_cents, 1200);
  assert.deepEqual(h.local, h.remote.content);
});
