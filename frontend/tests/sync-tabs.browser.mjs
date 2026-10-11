// Isolated HTTP origin, mocked network, real browser localStorage and IndexedDB.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROMIUM_EXECUTABLE=/path/to/chrome \
//   BASE_URL=http://sync-review.test node tests/sync-tabs.browser.mjs
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = new URL('../src/lib/', import.meta.url).pathname;
const origin = new URL(process.env.BASE_URL || 'http://sync-review.test').origin;
const result = await build({
  stdin: {
    contents: `export * from '${base}personal-sync.ts'; export * from '${base}storage.ts'; export * from '${base}sync-transaction.ts';`,
    resolveDir: base,
  },
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'review',
  platform: 'browser',
});
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
});
try {
  const context = await browser.newContext();
  await context.route(`${origin}/**`, async (route) => {
    if (route.request().url().endsWith('/module.js'))
      return route.fulfill({
        contentType: 'application/javascript',
        body: result.outputFiles[0].text,
      });
    return route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><script src="/module.js"></script>',
    });
  });
  const a = await context.newPage(),
    b = await context.newPage();
  await Promise.all([a.goto(`${origin}/`), b.goto(`${origin}/`)]);
  const environment = await a.evaluate(() => ({
    secure: isSecureContext,
    webLocks: typeof navigator.locks,
    indexedDB: typeof indexedDB,
  }));
  if (!process.env.BASE_URL) {
    assert.equal(environment.secure, false);
    assert.equal(environment.webLocks, 'undefined');
  }
  await a.evaluate(async () => {
    window.meal = (id) => ({
      id,
      restaurant_id: 'r',
      eaten_on: '2026-10-11',
      created_at: 1,
      rating: null,
      cost_cents: null,
      post_ids: [],
    });
    localStorage.setItem(
      'what-to-eat:local:v1',
      JSON.stringify({ version: 1, window_size: 5, meals: [meal('a')] }),
    );
    localStorage.setItem('what-to-eat:nickname:v1', '旧昵称');
    await review.addLocalMeal(meal('a'));
    if (review.readLastNickname() !== '旧昵称') throw new Error('legacy import lost nickname');
    const open = indexedDB.open('what-to-eat-sync', 1);
    await new Promise((resolve, reject) => {
      open.onsuccess = resolve;
      open.onerror = reject;
    });
    window.heldDatabase = open.result;
    const tx = open.result.transaction('checkpoint', 'readwrite');
    window.holderDone = false;
    window.releaseHolder = false;
    window.lockReady = false;
    tx.oncomplete = () => (window.holderDone = true);
    const keepAlive = () => {
      const request = tx.objectStore('checkpoint').get('lock');
      request.onsuccess = () => {
        window.lockReady = true;
        if (!window.releaseHolder) {
          keepAlive();
          return;
        }
      };
    };
    keepAlive();
  });
  await a.waitForFunction(() => window.lockReady);
  await a.evaluate(() => {
    window.remoteDone = false;
    void review
      .syncTransaction(() => {
        const local = review.readLocal();
        review.writePersonalData({ ...local, meals: [...local.meals, meal('remote')] }, '云端');
      })
      .then(() => (window.remoteDone = true));
  });
  await b.evaluate(() => {
    window.editDone = false;
    window.editPromise = review
      .addLocalMeal({
        id: 'local',
        restaurant_id: 'r',
        eaten_on: '2026-10-11',
        created_at: 1,
        rating: null,
        cost_cents: null,
        post_ids: [],
      })
      .then(() => (window.editDone = true));
  });
  await b.waitForTimeout(100);
  assert.equal(
    await b.evaluate(() => window.editDone),
    false,
    'ordinary edit must wait for the other tab checkpoint transaction',
  );
  await a.evaluate(() => (window.releaseHolder = true));
  await Promise.all([
    a.waitForFunction(() => window.holderDone && window.remoteDone),
    b.waitForFunction(() => window.editDone),
  ]);
  await b.evaluate(() => review.hydrateSyncStorage());
  const ids = await b.evaluate(() =>
    review
      .readLocal()
      .meals.map((m) => m.id)
      .sort(),
  );
  assert.deepEqual(ids, ['a', 'local', 'remote']);
  assert.equal(await b.evaluate(() => review.readLastNickname()), '云端');
  let combined;
  for (let iteration = 1; iteration <= 30; iteration++) {
    const rating = iteration % 2 ? 1 : -1;
    const cost = 3500 + iteration;
    await Promise.all([
      a.evaluate(
        (rating) =>
          review.updateLocal((data) => ({
            ...data,
            meals: data.meals.map((m) => (m.id === 'a' ? { ...m, rating } : m)),
          })),
        rating,
      ),
      b.evaluate(
        (cost) =>
          review.updateLocal((data) => ({
            ...data,
            meals: data.meals.map((m) => (m.id === 'a' ? { ...m, cost_cents: cost } : m)),
          })),
        cost,
      ),
    ]);
    await a.evaluate(() => review.hydrateSyncStorage());
    combined = await a.evaluate(() => review.readLocal().meals.find((m) => m.id === 'a'));
    assert.equal(combined.rating, rating);
    assert.equal(combined.cost_cents, cost);
  }
  // Use the actual adapter with real IndexedDB and shared localStorage for delayed GET concurrency.
  await a.evaluate(() =>
    review.syncTransaction(() => {
      const cloud = {
        local: { version: 1, window_size: 5, meals: review.readLocal().meals },
        nickname: '云端',
      };
      review.syncStorage.setItem(
        'what-to-eat:sync:v1',
        JSON.stringify({
          code: '1'.repeat(32),
          connection: 'browser-shared',
          checkpoint: 'start',
          lastSynced: 1,
          base: { revision: 1, content: cloud },
        }),
      );
    }),
  );
  let remote = {
    revision: 2,
    content: await a.evaluate(() => ({
      local: { ...review.readLocal(), meals: [...review.readLocal().meals, meal('new-remote')] },
      nickname: '云端',
    })),
  };
  let firstGet = true,
    release,
    started;
  const blocked = new Promise((resolve) => (release = resolve)),
    hit = new Promise((resolve) => (started = resolve));
  const receipts = new Map();
  await context.route(`${origin}/api/sync`, async (route) => {
    const req = route.request(),
      headers = req.headers();
    if (req.method() === 'GET') {
      if (firstGet) {
        firstGet = false;
        started();
        await blocked;
      }
      if (Number(headers['x-sync-revision']) === remote.revision)
        return route.fulfill({ status: 204 });
      return route.fulfill({ json: remote });
    }
    const op = headers['x-sync-operation'],
      body = req.postDataJSON();
    if (receipts.has(op)) return route.fulfill({ json: receipts.get(op) });
    if (body.revision !== remote.revision) return route.fulfill({ status: 409, json: {} });
    remote = { revision: remote.revision + 1, content: body.content };
    receipts.set(op, remote);
    return route.fulfill({ json: remote });
  });
  const pending = a.evaluate(() => review.syncNow());
  await hit;
  await b.evaluate(() => review.syncNow());
  await b.evaluate(() =>
    review.updateLocal((data) => ({
      ...data,
      meals: data.meals.filter((m) => m.id !== 'new-remote'),
    })),
  );
  release();
  await pending;
  assert.equal(
    (await a.evaluate(() => review.readLocal().meals.map((m) => m.id))).includes('new-remote'),
    false,
  );
  assert.equal(
    remote.content.local.meals.some((m) => m.id === 'new-remote'),
    false,
  );
  // Failed authoritative commit must not leak staged data into localStorage or notifications.
  const abortResult = await a.evaluate(async () => {
    const before = localStorage.getItem('what-to-eat:local:v1');
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function () {
      throw new DOMException('injected IDB quota', 'QuotaExceededError');
    };
    let failed = false;
    try {
      await review.addLocalMeal(meal('must-abort'));
    } catch {
      failed = true;
    } finally {
      IDBObjectStore.prototype.put = put;
    }
    await review.hydrateSyncStorage();
    return {
      failed,
      mirrorUnchanged: localStorage.getItem('what-to-eat:local:v1') === before,
      absent: !review.readLocal().meals.some((m) => m.id === 'must-abort'),
    };
  });
  assert.deepEqual(abortResult, { failed: true, mirrorUnchanged: true, absent: true });
  await b.close();
  // A full optional mirror must never roll back the authoritative commit, even across reload.
  const mirrorResult = await a.evaluate(async () => {
    const before = localStorage.getItem('what-to-eat:local:v1');
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'what-to-eat:local:v1')
        throw new DOMException('injected mirror quota', 'QuotaExceededError');
      return set.call(this, key, value);
    };
    await review.addLocalMeal(meal('survives-mirror-failure'));
    return {
      cached: review.readLocal().meals.some((m) => m.id === 'survives-mirror-failure'),
      oldMirror: localStorage.getItem('what-to-eat:local:v1') === before,
      error: review.getLocalError(),
    };
  });
  assert.deepEqual(mirrorResult, { cached: true, oldMirror: true, error: null });
  await a.reload();
  await a.evaluate(() => {
    window.hydratedEvents = 0;
    window.stopSubscription = review.subscribeLocal(() => window.hydratedEvents++);
  });
  await a.waitForFunction(() =>
    review.readLocal().meals.some((m) => m.id === 'survives-mirror-failure'),
  );
  assert.ok(await a.evaluate(() => window.hydratedEvents > 0));
  assert.equal(await a.evaluate(() => review.readSync().connection), 'browser-shared');
  console.log(
    JSON.stringify({
      environment,
      legacyImport: true,
      ordinaryWriteWaited: true,
      ids,
      concurrentRounds: 30,
      independentEdits: { rating: combined.rating, cost: combined.cost_cents },
      delayedGetDeletionPreserved: true,
      abortResult,
      mirrorResult,
      startupHydrated: true,
    }),
  );
  await context.close();
} finally {
  await browser.close();
}
