import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoteIdentity } from '../src/lib/vote-identity.ts';
import { SYNC_CHANGE, SYNC_KEY } from '../src/lib/personal-sync.ts';
import { SYNC_STORAGE_CHANGE } from '../src/lib/sync-transaction.ts';

function deferred<T = void>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const tick = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};
const a = { connection: 'connection-a', code: 'a'.repeat(32) };
const b = { connection: 'connection-b', code: 'b'.repeat(32) };
function harness() {
  let session: typeof a | null = null;
  let hydrator = async () => {};
  const target = new EventTarget();
  const migrations: { code: string; signal: AbortSignal; work: ReturnType<typeof deferred> }[] = [];
  let reads = 0,
    hydrations = 0;
  const port = {
    hydrate: async () => {
      hydrations++;
      await hydrator();
    },
    session: () => {
      reads++;
      return session;
    },
    migrate: (code: string, signal: AbortSignal) => {
      const work = deferred();
      migrations.push({ code, signal, work });
      return work.promise;
    },
    events: () => target,
  };
  return {
    store: createVoteIdentity(port),
    port,
    target,
    migrations,
    set session(value: typeof a | null) {
      session = value;
    },
    set hydrator(value: () => Promise<void>) {
      hydrator = value;
    },
    get reads() {
      return reads;
    },
    get hydrations() {
      return hydrations;
    },
    change(kind = SYNC_CHANGE) {
      target.dispatchEvent(new Event(kind));
    },
    storage(value: typeof a | null, key: string | null = SYNC_KEY) {
      const event = new Event('storage');
      Object.defineProperties(event, {
        key: { value: key },
        newValue: { value: value ? JSON.stringify(value) : null },
      });
      target.dispatchEvent(event);
    },
  };
}

test('strict hydration precedes identity reads and migration precedes authenticated requests', async () => {
  const h = harness(),
    hydration = deferred();
  h.hydrator = () => hydration.promise;
  h.session = a;
  const stop = h.store.subscribe(() => {});
  assert.equal(h.store.getSnapshot().status, 'loading');
  assert.throws(() => h.store.request(), /正在同步/);
  assert.equal(h.reads, 0);
  hydration.resolve();
  await tick();
  assert.equal(h.store.getSnapshot().key, 'sync:connection-a');
  assert.equal(h.store.getSnapshot().status, 'migrating');
  assert.equal(h.migrations.length, 1);
  assert.throws(() => h.store.request(), /正在同步/);
  h.migrations[0].work.resolve();
  await tick();
  const request = h.store.request();
  assert.deepEqual(request.headers, { 'X-Sync-Code': a.code });
  assert.equal(request.isCurrent(), true);
  assert.equal(request.key.includes(a.code), false);
  assert.equal(h.store.request(), request);
  const snapshot = h.store.getSnapshot();
  h.change();
  h.change(SYNC_STORAGE_CHANGE);
  h.storage(a);
  assert.equal(h.store.getSnapshot(), snapshot);
  assert.equal(h.migrations.length, 1);
  stop();
});

test('anonymous requests omit the sync header and disconnect gets a new anonymous lifecycle', async () => {
  const h = harness();
  const stop = h.store.subscribe(() => {});
  await tick();
  const anonymous = h.store.request();
  assert.deepEqual(anonymous.headers, {});
  h.session = a;
  h.change();
  assert.equal(anonymous.signal.aborted, true);
  h.migrations[0].work.resolve();
  await tick();
  const connected = h.store.request();
  h.session = null;
  h.change();
  const disconnected = h.store.request();
  assert.equal(connected.signal.aborted, true);
  assert.equal(connected.isCurrent(), false);
  assert.deepEqual(disconnected.headers, {});
  assert.notEqual(disconnected.key, anonymous.key);
  assert.throws(() => h.store.request(connected.key), { name: 'AbortError' });
  stop();
});

test('switching connection aborts the prior request and rejects its delayed response or rollback', async () => {
  const h = harness();
  h.session = a;
  const stop = h.store.subscribe(() => {});
  await tick();
  h.migrations[0].work.resolve();
  await tick();
  const old = h.store.request();
  h.session = b;
  h.change();
  assert.equal(old.signal.aborted, true);
  assert.equal(old.isCurrent(), false);
  assert.equal(h.store.getSnapshot().status, 'migrating');
  h.migrations[1].work.resolve();
  await tick();
  const fresh = h.store.request();
  const writes: string[] = [];
  if (old.isCurrent()) writes.push('late response');
  if (old.isCurrent()) writes.push('late rollback');
  if (fresh.isCurrent()) writes.push('new response');
  assert.deepEqual(writes, ['new response']);
  assert.deepEqual(fresh.headers, { 'X-Sync-Code': b.code });
  stop();
});

test('late migration completion cannot overwrite a new identity or an anonymous disconnect', async () => {
  const h = harness();
  h.session = a;
  const stop = h.store.subscribe(() => {});
  await tick();
  h.session = b;
  h.change();
  assert.equal(h.migrations[0].signal.aborted, true);
  h.migrations[1].work.reject(new Error('migration failed'));
  await tick();
  h.migrations[0].work.resolve();
  await tick();
  assert.equal(h.store.getSnapshot().key, 'sync:connection-b');
  assert.equal(h.store.getSnapshot().error, 'migration failed');
  const retry = h.store.retry();
  h.session = null;
  h.change();
  const anonymous = h.store.getSnapshot();
  h.migrations[2].work.resolve();
  assert.equal(await retry, false);
  assert.equal(h.store.getSnapshot(), anonymous);
  stop();
});

test('migration failures remain on the sync identity and explicit retry is deduplicated', async () => {
  const h = harness();
  h.session = a;
  const stop = h.store.subscribe(() => {});
  await tick();
  h.migrations[0].work.reject(new Error('network unavailable'));
  await tick();
  assert.equal(h.store.getSnapshot().status, 'error');
  assert.equal(h.store.getSnapshot().key, 'sync:connection-a');
  assert.throws(() => h.store.request(), /network unavailable/);
  h.change();
  assert.equal(h.migrations.length, 1);
  const one = h.store.retry(),
    two = h.store.retry();
  assert.equal(h.migrations.length, 2);
  h.migrations[1].work.resolve();
  assert.equal(await one, true);
  assert.equal(await two, true);
  assert.equal(h.store.getSnapshot().status, 'ready');
  stop();
});

test('a failed authoritative hydration never falls back to cookie identity', async () => {
  const h = harness();
  h.hydrator = async () => {
    throw new Error('storage unavailable');
  };
  const stop = h.store.subscribe(() => {});
  await tick();
  assert.equal(h.store.getSnapshot().status, 'error');
  assert.equal(h.reads, 0);
  assert.throws(() => h.store.request(), /storage unavailable/);
  h.hydrator = async () => {};
  assert.equal(await h.store.retry(), true);
  assert.deepEqual(h.store.request().headers, {});
  stop();
});

test('a different cross-tab storage identity aborts immediately and waits for authoritative hydration', async () => {
  const h = harness();
  h.session = a;
  const stop = h.store.subscribe(() => {});
  await tick();
  h.migrations[0].work.resolve();
  await tick();
  const old = h.store.request(),
    pending = deferred();
  h.hydrator = () => pending.promise;
  h.storage(b);
  assert.equal(old.signal.aborted, true);
  assert.equal(h.store.getSnapshot().status, 'loading');
  assert.equal(h.migrations.length, 1);
  h.session = b;
  pending.resolve();
  await tick();
  assert.equal(h.migrations.length, 2);
  h.migrations[1].work.resolve();
  await tick();
  assert.equal(h.store.request().key, 'sync:connection-b');
  stop();
});

test('shared subscribers only hydrate once, and remount cannot receive an old hydration result', async () => {
  const h = harness(),
    first = deferred(),
    second = deferred();
  h.hydrator = () => first.promise;
  const stopOne = h.store.subscribe(() => {}),
    stopTwo = h.store.subscribe(() => {});
  assert.equal(h.hydrations, 1);
  stopOne();
  stopTwo();
  h.hydrator = () => second.promise;
  h.session = b;
  const stopNew = h.store.subscribe(() => {});
  first.resolve();
  await tick();
  assert.equal(h.store.getSnapshot().status, 'loading');
  assert.equal(h.migrations.length, 0);
  second.resolve();
  await tick();
  assert.equal(h.migrations.length, 1);
  assert.equal(h.migrations[0].code, b.code);
  h.migrations[0].work.resolve();
  await tick();
  const request = h.store.request();
  stopNew();
  assert.equal(request.signal.aborted, true);
});

test('a reloaded connected device performs the idempotent migration again', async () => {
  const h = harness();
  h.session = a;
  const first = h.store.subscribe(() => {});
  await tick();
  h.migrations[0].work.resolve();
  await tick();
  first();
  const reloaded = createVoteIdentity(h.port);
  const stop = reloaded.subscribe(() => {});
  await tick();
  assert.equal(h.migrations.length, 2);
  h.migrations[1].work.resolve();
  await tick();
  assert.equal(reloaded.getSnapshot().status, 'ready');
  stop();
});

test('rapid storage switches while hydration completes eventually select the latest connection', async () => {
  const h = harness(),
    latest = { connection: 'connection-c', code: 'c'.repeat(32) };
  h.session = a;
  let switched = false;
  const stop = h.store.subscribe(() => {
    if (!switched && h.store.getSnapshot().key === 'sync:connection-a') {
      switched = true;
      h.session = b;
      h.storage(b);
      h.session = latest;
      h.storage(latest);
    }
  });
  await tick();
  await tick();
  await tick();
  assert.equal(h.store.getSnapshot().key, 'sync:connection-c');
  assert.equal(h.migrations.length, 1);
  assert.equal(h.migrations[0].code, latest.code);
  h.migrations[0].work.resolve();
  await tick();
  assert.equal(h.store.request().key, 'sync:connection-c');
  stop();
});

test('migration waits for an in-flight anonymous write without cancelling its server request', async () => {
  const h = harness(),
    saved = deferred<string>();
  const stop = h.store.subscribe(() => {});
  await tick();
  const request = h.store.request();
  let actualSignal!: AbortSignal;
  const write = h.store.write(request, (signal) => {
    actualSignal = signal;
    return saved.promise;
  });
  await tick();
  h.session = a;
  h.change();
  assert.equal(request.signal.aborted, true);
  assert.equal(request.isCurrent(), false);
  assert.equal(actualSignal.aborted, false);
  assert.equal(h.store.getSnapshot().status, 'migrating');
  assert.equal(h.migrations.length, 0);
  saved.resolve('saved');
  assert.equal(await write, 'saved');
  await tick();
  assert.equal(h.migrations.length, 1);
  h.migrations[0].work.resolve();
  await tick();
  assert.equal(h.store.getSnapshot().status, 'ready');
  stop();
});

test('a failed anonymous write releases migration and cannot roll back the new identity', async () => {
  const h = harness(),
    saved = deferred();
  const stop = h.store.subscribe(() => {});
  await tick();
  const request = h.store.request();
  const write = h.store.write(request, () => saved.promise);
  const failed = assert.rejects(write, /offline/);
  h.session = a;
  h.change();
  assert.equal(h.migrations.length, 0);
  saved.reject(new Error('offline'));
  await failed;
  await tick();
  assert.equal(request.isCurrent(), false);
  assert.equal(h.migrations.length, 1);
  h.migrations[0].work.resolve();
  await tick();
  assert.equal(h.store.getSnapshot().status, 'ready');
  stop();
});

test('a second switch while waiting for anonymous writes only migrates the final connection', async () => {
  const h = harness(),
    saved = deferred();
  const stop = h.store.subscribe(() => {});
  await tick();
  const write = h.store.write(h.store.request(), () => saved.promise);
  h.session = a;
  h.change();
  h.session = b;
  h.change();
  saved.resolve();
  await write;
  await tick();
  assert.equal(h.migrations.length, 1);
  assert.equal(h.migrations[0].code, b.code);
  h.migrations[0].work.resolve();
  await tick();
  assert.equal(h.store.request().key, 'sync:connection-b');
  stop();
});

test('a shared write uses its old identity cancellation and never delays the next migration', async () => {
  const h = harness();
  h.session = a;
  const stop = h.store.subscribe(() => {});
  await tick();
  h.migrations[0].work.resolve();
  await tick();
  const request = h.store.request(),
    saved = deferred();
  let actualSignal!: AbortSignal;
  const write = h.store.write(request, (signal) => {
    actualSignal = signal;
    return saved.promise;
  });
  await tick();
  h.session = b;
  h.change();
  assert.equal(actualSignal.aborted, true);
  assert.equal(h.migrations.length, 2);
  assert.equal(h.migrations[1].code, b.code);
  await assert.rejects(
    h.store.write(request, async () => {}),
    { name: 'AbortError' },
  );
  saved.resolve();
  await write;
  h.migrations[1].work.resolve();
  await tick();
  stop();
});
