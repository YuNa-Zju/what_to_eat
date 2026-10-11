// Requires an isolated local server/data directory; this test creates sync books.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.BASE_URL || 'http://127.0.0.1:11454';
assert.equal(new URL(origin).hostname, '127.0.0.1');
assert.notEqual(new URL(origin).port, '11451', 'never run writes against production');
const bundle = await build({
  stdin: {
    contents: "export * from './src/lib/personal-sync.ts';export * from './src/lib/storage.ts';",
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
});
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
});
try {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const pages = [];
  for (const context of contexts) {
    await context.route('**/__sync-harness', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<script type="module">window.client = await import("/__sync-harness.js")</script>',
      }),
    );
    await context.route('**/__sync-harness.js', (route) =>
      route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text }),
    );
    await context.addInitScript(() => {
      window.storageWrites = 0;
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (...args) {
        window.storageWrites++;
        return original.apply(this, args);
      };
    });
    const page = await context.newPage();
    await page.goto(origin + '/__sync-harness');
    await page.waitForFunction(() => window.client);
    pages.push(page);
  }
  const [a, b] = pages;
  const restaurants = await (await contexts[0].request.get(origin + '/api/restaurants')).json();
  const sharedBefore = await (await contexts[0].request.get(origin + '/api/meals')).json();
  const meal = () => ({
    id: randomUUID(),
    restaurant_id: restaurants[0].id,
    eaten_on: '2026-10-11',
    created_at: Date.now(),
    rating: null,
    cost_cents: null,
  });
  const first = meal(),
    second = meal(),
    uncertain = meal();
  await a.evaluate((m) => window.client.addLocalMeal(m), first);
  await a.evaluate(() => window.client.connectSync());
  const code = await a.evaluate(() => window.client.readSync().code);
  await b.evaluate((m) => window.client.addLocalMeal(m), second);
  await b.evaluate((code) => window.client.connectSync(code), code);
  await a.evaluate(() => window.client.syncNow());
  assert.equal(await a.evaluate(() => window.client.readLocal().meals.length), 2);
  let dropped = false;
  await a.route('**/api/sync', async (route) => {
    if (route.request().method() === 'PUT' && !dropped) {
      dropped = true;
      await route.fetch();
      await route.abort('failed');
    } else await route.continue();
  });
  await a.evaluate((m) => window.client.addLocalMeal(m), uncertain);
  assert.equal(
    await a.evaluate(() =>
      window.client.syncNow().then(
        () => false,
        () => true,
      ),
    ),
    true,
  );
  assert.equal(await a.evaluate(() => !!window.client.readSync().pendingWrite), true);
  await b.evaluate(() => window.client.syncNow());
  await b.evaluate(
    (id) =>
      window.client.updateLocal((data) => ({
        ...data,
        meals: data.meals.map((m) => (m.id === id ? { ...m, cost_cents: 3500 } : m)),
      })),
    uncertain.id,
  );
  await b.evaluate(() => window.client.syncNow());
  await a.unroute('**/api/sync');
  await a.reload();
  await a.waitForFunction(() => window.client);
  await a.evaluate(() => window.client.syncNow());
  assert.equal(
    await a.evaluate(
      (id) => window.client.readLocal().meals.find((m) => m.id === id).cost_cents,
      uncertain.id,
    ),
    3500,
  );
  const statuses = [];
  a.on('response', (r) => {
    if (r.url().endsWith('/api/sync')) statuses.push(r.status());
  });
  const writes = await a.evaluate(() => window.storageWrites);
  await a.evaluate(() => window.client.syncNow());
  assert.deepEqual(statuses, [204]);
  assert.equal(await a.evaluate(() => window.storageWrites), writes);
  await b.evaluate(
    (id) =>
      window.client.updateLocal((data) => ({
        ...data,
        meals: data.meals.filter((m) => m.id !== id),
      })),
    uncertain.id,
  );
  await b.evaluate(() => window.client.syncNow());
  await a.evaluate(() => window.client.syncNow());
  assert.equal(
    await a.evaluate(
      (id) => window.client.readLocal().meals.some((m) => m.id === id),
      uncertain.id,
    ),
    false,
  );
  const sharedAfter = await (await contexts[0].request.get(origin + '/api/meals')).json();
  assert.deepEqual(sharedAfter, sharedBefore);
  console.log(
    JSON.stringify({
      devices: 2,
      initialMerge: true,
      lostResponseRecoveredAfterReload: true,
      laterRemoteEditPreserved: true,
      unchangedStatus: 204,
      unchangedStorageWrites: 0,
      remoteDeletion: true,
      sharedHistoryUnchanged: true,
    }),
  );
} finally {
  await browser.close();
}
