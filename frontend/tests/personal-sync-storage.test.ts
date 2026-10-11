import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPersonalSyncClient,
  readSync,
  SYNC_KEY,
  SYNC_MIGRATION_KEY,
} from '../src/lib/personal-sync.ts';
import {
  LOCAL_KEY,
  LOCAL_CHANGE,
  readLocal,
  readLastNickname,
  writePersonalData,
  getLocalSnapshot,
  getLocalError,
  subscribeLocal,
} from '../src/lib/storage.ts';
import { normalizeContent, type SyncContent, type SyncSnapshot } from '../src/lib/sync-engine.ts';
import type { Meal } from '../src/lib/types.ts';
const meal = (id: string): Meal => ({
  id,
  restaurant_id: 'r',
  eaten_on: '2026-10-11',
  created_at: 1,
  rating: null,
  cost_cents: null,
  post_ids: [],
});
const content = (...meals: Meal[]): SyncContent =>
  normalizeContent({ local: { version: 1, window_size: 5, meals }, nickname: '' });
function setup(local: SyncContent, cloud = local) {
  const values = new Map<string, string>();
  const writes: string[] = [];
  let fail: ((key: string, value: string) => boolean) | undefined;
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (fail?.(key, value))
        throw new DOMException('injected quota failure', 'QuotaExceededError');
      writes.push(key);
      values.set(key, value);
    },
    removeItem: (key: string) => values.delete(key),
  };
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
  Object.defineProperty(globalThis, 'window', { value: new EventTarget(), configurable: true });
  let queue = Promise.resolve();
  const transaction = <T>(action: () => T): Promise<T> => {
    const result = queue.then(action);
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  let remote: SyncSnapshot = { revision: 1, content: structuredClone(cloud) };
  const requests: { method: string; operation?: string; body?: string }[] = [];
  const receipts = new Map<string, { body: string; value: SyncSnapshot }>();
  let loseResponse = false;
  let beforeGet: (() => Promise<void>) | undefined;
  globalThis.fetch = async (_url, init) => {
    const method = init!.method!;
    const headers = init!.headers as Record<string, string>;
    const operation = headers['X-Sync-Operation'];
    requests.push({ method, operation, body: init?.body as string | undefined });
    if (method === 'GET') {
      await beforeGet?.();
      if (Number(headers['X-Sync-Revision']) === remote.revision)
        return new Response(null, { status: 204 });
      return Response.json(remote);
    }
    if (method === 'POST') return Response.json({ ...remote, code: '1'.repeat(32) });
    const body = init!.body as string;
    const existing = receipts.get(operation);
    if (existing) {
      assert.equal(body, existing.body);
      return Response.json(existing.value);
    }
    const snapshot = JSON.parse(body) as SyncSnapshot;
    if (snapshot.revision !== remote.revision) return Response.json({}, { status: 409 });
    remote = { revision: remote.revision + 1, content: snapshot.content };
    receipts.set(operation, { body, value: structuredClone(remote) });
    if (loseResponse) {
      loseResponse = false;
      throw new TypeError('lost response');
    }
    return Response.json(remote);
  };
  storage.setItem(LOCAL_KEY, JSON.stringify(local.local));
  storage.setItem('what-to-eat:nickname:v1', local.nickname);
  let events = 0;
  window.addEventListener(LOCAL_CHANGE, () => events++);
  return {
    storage,
    writes,
    requests,
    client: createPersonalSyncClient(transaction),
    newTab: () => createPersonalSyncClient(transaction),
    get remote() {
      return remote;
    },
    set remote(v) {
      remote = v;
    },
    get events() {
      return events;
    },
    failOnce(predicate: (key: string, value: string) => boolean) {
      fail = (key, value) => {
        if (!predicate(key, value)) return false;
        fail = undefined;
        return true;
      };
    },
    loseResponse() {
      loseResponse = true;
    },
    set beforeGet(v: (() => Promise<void>) | undefined) {
      beforeGet = v;
    },
  };
}
test('stable snapshots, nickname-only updates, storage subscriptions and unreadable data', () => {
  const h = setup(content(meal('a')));
  const first = getLocalSnapshot();
  assert.equal(getLocalSnapshot(), first);
  let calls = 0;
  const unsubscribe = subscribeLocal(() => calls++);
  writePersonalData(first, '饭友');
  assert.equal(readLastNickname(), '饭友');
  assert.equal(getLocalSnapshot(), first);
  assert.equal(calls, 1);
  const external = new Event('storage');
  Object.defineProperty(external, 'key', { value: LOCAL_KEY });
  window.dispatchEvent(external);
  assert.equal(calls, 2);
  h.storage.setItem(LOCAL_KEY, '{invalid');
  assert.equal(getLocalSnapshot(), first);
  assert.ok(getLocalError());
  assert.throws(readLocal);
  unsubscribe();
});
test('matching legacy content journal is cleared without changing local records', async () => {
  const h = setup(content(meal('a')));
  h.storage.setItem(
    SYNC_KEY,
    JSON.stringify({
      code: '1'.repeat(32),
      connection: 'legacy',
      base: h.remote,
      lastSynced: 0,
      pendingApply: h.remote.content,
    }),
  );
  await h.client.syncNow();
  assert.equal(readSync()?.pendingApply, undefined);
  assert.deepEqual(
    readLocal().meals.map((m) => m.id),
    ['a'],
  );
  assert.equal(
    h.requests.some((r) => r.method === 'PUT'),
    false,
  );
});
test('ambiguous legacy journal never overwrites edits and is backed up before disconnecting', async () => {
  const local = content(meal('a'), meal('new'));
  const h = setup(local, content(meal('a'), meal('remote')));
  const session = {
    code: '1'.repeat(32),
    connection: 'legacy',
    base: h.remote,
    lastSynced: 0,
    pendingApply: h.remote.content,
  };
  h.storage.setItem(SYNC_KEY, JSON.stringify(session));
  const writes = h.writes.length;
  await assert.rejects(h.client.syncNow(), /请断开后重新连接/);
  assert.equal(h.writes.length, writes);
  assert.equal(h.requests.length, 0);
  assert.deepEqual(
    readLocal().meals.map((m) => m.id),
    ['a', 'new'],
  );
  await h.client.disconnectSync();
  assert.equal(readSync(), null);
  const backup = JSON.parse(h.storage.getItem(SYNC_MIGRATION_KEY)!);
  assert.deepEqual(backup.session, session);
  assert.deepEqual(backup.content.local, local.local);
  assert.deepEqual(
    readLocal().meals.map((m) => m.id),
    ['a', 'new'],
  );
});
test('lost PUT response is recovered with identical durable operation and body after reload', async () => {
  const h = setup(content());
  await h.client.connectSync();
  writePersonalData(content(meal('a')).local, '');
  h.loseResponse();
  await assert.rejects(h.client.syncNow(), /联网后继续同步/);
  const operation = readSync()?.pendingWrite?.operation;
  assert.ok(operation);
  h.remote = { revision: 3, content: content({ ...meal('a'), cost_cents: 3500 }) };
  await h.newTab().syncNow();
  assert.equal(readLocal().meals[0].cost_cents, 3500);
  const puts = h.requests.filter((r) => r.method === 'PUT');
  assert.equal(puts.length, 2);
  assert.equal(puts[0].operation, puts[1].operation);
  assert.equal(puts[0].body, puts[1].body);
  assert.equal(h.remote.revision, 3);
});
test('unchanged polling has no storage writes or local notifications', async () => {
  const h = setup(content(meal('a')));
  await h.client.connectSync();
  const beforeWrites = h.writes.length,
    beforeEvents = h.events;
  await h.client.syncNow();
  await h.client.syncNow();
  assert.equal(h.writes.length, beforeWrites);
  assert.equal(h.events, beforeEvents);
});
test('one remote data and nickname application emits one local notification', async () => {
  const h = setup(content(meal('a')));
  await h.client.connectSync();
  const before = h.events;
  h.remote = { revision: 2, content: { ...content(meal('a'), meal('b')), nickname: '云端' } };
  await h.client.syncNow();
  assert.equal(h.events - before, 1);
  assert.equal(readLastNickname(), '云端');
});
test('two independent clients recheck the shared checkpoint after a delayed GET', async () => {
  const h = setup(content(meal('a')));
  await h.client.connectSync();
  const other = h.newTab();
  h.remote = { revision: 2, content: content(meal('a'), meal('b')) };
  let release!: () => void, waiting!: () => void;
  const started = new Promise<void>((resolve) => (waiting = resolve));
  const blocked = new Promise<void>((resolve) => (release = resolve));
  h.beforeGet = async () => {
    h.beforeGet = undefined;
    waiting();
    await blocked;
  };
  const original = h.client.syncNow();
  await started;
  await other.syncNow();
  writePersonalData(content(meal('a')).local, '');
  release();
  await original;
  assert.deepEqual(
    readLocal().meals.map((m) => m.id),
    ['a'],
  );
  assert.deepEqual(
    h.remote.content.local.meals.map((m) => m.id),
    ['a'],
  );
});
