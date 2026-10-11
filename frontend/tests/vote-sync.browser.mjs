// Real UI + two isolated browser contexts against a disposable backend on port 11454.
// Creates its own fixtures; never point this test at the production service.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROMIUM_EXECUTABLE=/path/to/chrome \
//   BASE_URL=http://127.0.0.1:11454 node tests/vote-sync.browser.mjs
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const origin = process.env.BASE_URL || 'http://127.0.0.1:11454';
const target = new URL(origin);
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname));
assert.equal(target.port, '11454', 'this write test only supports the isolated port 11454');
assert.equal(target.pathname, '/');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
});
const run = `vote-sync-${randomUUID().slice(0, 8)}`;
const contexts = [];
const fixtures = [];
const heldResponses = [];
const errors = [];
let stage = 'fixtures';

async function successful(response, operation) {
  assert.ok(response.ok(), `${operation}: HTTP ${response.status()}`);
  return response;
}
async function jsonResponse(response, operation) {
  return (await successful(response, operation)).json();
}
async function eventually(check, message, timeout = 10_000) {
  const end = Date.now() + timeout;
  let last;
  do {
    try {
      await check();
      return;
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  } while (Date.now() < end);
  throw new Error(message, { cause: last });
}
const button = (page, name) => page.getByRole('button', { name, exact: true });
const card = (page, post) => page.locator('.feed-entry').filter({ hasText: post.body });
async function expectVote(page, post, myVote, likes, dislikes) {
  await eventually(async () => {
    const row = card(page, post);
    assert.equal(await row.count(), 1);
    const like = button(row, '点赞'),
      dislike = button(row, '点踩');
    assert.equal(await like.getAttribute('aria-pressed'), String(myVote === 1));
    assert.equal(await dislike.getAttribute('aria-pressed'), String(myVote === -1));
    assert.equal((await like.textContent()).trim(), String(likes));
    assert.equal((await dislike.textContent()).trim(), String(dislikes));
    assert.equal(await like.isEnabled(), true);
    assert.equal(await dislike.isEnabled(), true);
  }, `${post.label}: UI should show my_vote=${myVote}, likes=${likes}, dislikes=${dislikes}`);
}
async function readPost(context, post, code) {
  const rows = await jsonResponse(
    await context.request.get(`${origin}/api/posts?ids=${post.id}`, {
      headers: code ? { 'X-Sync-Code': code } : {},
    }),
    'read fixture post',
  );
  assert.equal(rows.length, 1);
  return rows[0];
}
async function expectStored(context, post, code, myVote, likes, dislikes) {
  const row = await readPost(context, post, code);
  assert.deepEqual(
    { myVote: row.my_vote, likes: row.likes, dislikes: row.dislikes },
    { myVote, likes, dislikes },
  );
}
async function showFixtures(page, reload = false) {
  if (reload) await page.reload();
  else await page.goto(`${origin}/#feed`);
  await page.getByRole('textbox', { name: '搜索分享', exact: true }).fill(run);
  await card(page, fixtures[0]).waitFor();
}
async function refresh(page) {
  const response = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === '/api/posts' && response.request().method() === 'GET';
  });
  await button(page, '刷新').click();
  await successful(await response, 'refresh feed');
}
async function syncAndRefresh(page) {
  await button(page, '个人餐簿同步').click();
  const dialog = page.getByRole('dialog', { name: '随身餐簿', exact: true });
  const refreshed = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/posts' && response.request().method() === 'GET',
  );
  await button(dialog, '立即同步').click();
  await successful(await refreshed, 'manual sync refreshes shared votes');
  await button(dialog, '关闭').click();
  await dialog.waitFor({ state: 'hidden' });
}
async function connect(page, code) {
  await button(page, '个人餐簿同步').click();
  const dialog = page.getByRole('dialog', { name: '随身餐簿', exact: true });
  await dialog.getByRole('textbox', { name: '输入同步码', exact: true }).fill(code);
  const migrated = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/sync/votes' &&
      response.request().method() === 'POST' &&
      response.request().headers()['x-sync-code'] === code,
  );
  await button(dialog, '连接这份餐簿').click();
  await dialog.locator('#my-sync-code').waitFor();
  await successful(await migrated, 'migrate cookie votes after connecting');
  await button(dialog, '关闭').click();
  await dialog.waitFor({ state: 'hidden' });
}
async function disconnect(page) {
  await button(page, '个人餐簿同步').click();
  const dialog = page.getByRole('dialog', { name: '随身餐簿', exact: true });
  await button(dialog, '断开此设备').click();
  await button(dialog, '确认断开').click();
  await dialog.getByRole('textbox', { name: '输入同步码', exact: true }).waitFor();
  await button(dialog, '关闭').click();
  await dialog.waitFor({ state: 'hidden' });
}
async function switchCode(page, code) {
  await disconnect(page);
  await connect(page, code);
}
async function vote(page, post, value) {
  const response = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/posts/${post.id}/vote` &&
      response.request().method() === 'POST',
  );
  await button(card(page, post), value === 1 ? '点赞' : '点踩').click();
  await successful(await response, 'vote through UI');
}

// Fetch from the real backend first, then hold only delivery to the browser. This covers
// a committed old-identity write/read arriving after a new identity has rendered.
async function holdResponse(page, predicate, validate, beforeFetch = false) {
  let release, completed, captureError;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const done = new Promise((resolve) => {
    completed = resolve;
  });
  let taken = false,
    captured = false;
  const handler = async (route) => {
    if (taken || !predicate(route.request())) return route.continue();
    taken = true;
    try {
      if (beforeFetch) {
        captured = true;
        await gate;
      }
      const response = await route.fetch();
      await successful(response, 'held real backend response');
      await validate(response);
      captured = true;
      await gate;
      // AbortController cancellation after a switch is also a valid protection.
      await route.fulfill({ response }).catch(() => {});
    } catch (error) {
      captureError = error;
      captured = true;
      await route.abort().catch(() => {});
    } finally {
      completed();
    }
  };
  await page.route('**/api/posts**', handler);
  const held = {
    async ready() {
      await eventually(() => assert.equal(captured, true), 'expected request was not captured');
      if (captureError) throw captureError;
    },
    async release() {
      release();
      await page.unroute('**/api/posts**', handler);
      if (taken) await done;
      if (captureError) throw captureError;
    },
  };
  heldResponses.push(held);
  return held;
}

try {
  for (let device = 0; device < 2; device++) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    context.setDefaultTimeout(10_000);
    await context.addInitScript(() => localStorage.setItem('what-to-eat:onboarding:v1', 'seen'));
    await successful(await context.request.get(`${origin}/api/health`), 'establish visitor cookie');
    contexts.push(context);
  }
  const [ca, cb] = contexts;
  const cookie = async (context) =>
    (await context.cookies()).find((c) => c.name === 'wte_visitor')?.value;
  assert.ok(await cookie(ca));
  assert.ok(await cookie(cb));
  assert.notEqual(
    await cookie(ca),
    await cookie(cb),
    'devices must have different visitor cookies',
  );
  const restaurant = await jsonResponse(
    await ca.request.post(`${origin}/api/restaurants`, { data: { name: run } }),
    'create fixture restaurant',
  );
  for (const label of ['shared', 'migration', 'reload', 'late-vote', 'anonymous-write']) {
    const post = await jsonResponse(
      await ca.request.post(`${origin}/api/posts`, {
        multipart: {
          payload: JSON.stringify({
            id: randomUUID(),
            restaurant_id: restaurant.id,
            eaten_on: new Date().toISOString().slice(0, 10),
            nickname: '投票回归',
            body: `${run} ${label}`,
            upload_ids: [],
            record_meal: false,
            meal_rating: null,
            cost_cents: null,
            existing_meal_id: null,
          }),
        },
      }),
      'create fixture post',
    );
    fixtures.push({ ...post, label });
  }
  const [shared, migration, reload, lateVote, anonymousWrite] = fixtures;
  const books = [];
  for (let i = 0; i < 2; i++) {
    books.push(
      await jsonResponse(
        await ca.request.post(`${origin}/api/sync`, {
          data: { local: { version: 1, window_size: 5, meals: [] }, nickname: '' },
        }),
        'create fixture sync book',
      ),
    );
  }
  const [codeA, codeB] = books.map((book) => book.code);
  const [a, b] = await Promise.all(contexts.map((context) => context.newPage()));
  for (const page of [a, b]) page.on('pageerror', (error) => errors.push(error.message));
  await Promise.all([showFixtures(a), showFixtures(b)]);

  stage = 'migrate two old cookie votes without double counting';
  await vote(a, migration, 1);
  await vote(b, migration, 1);
  await expectStored(ca, migration, undefined, 1, 2, 0);
  await connect(a, codeA);
  await connect(b, codeA);
  await refresh(a);
  await expectVote(a, migration, 1, 1, 0);
  await expectVote(b, migration, 1, 1, 0);
  await expectStored(ca, migration, undefined, 0, 1, 0);
  await expectStored(cb, migration, undefined, 0, 1, 0);
  console.log('PASS: different cookies migrate into one shared vote without duplicate totals.');

  stage = 'same-code like, cancel, dislike and change vote';
  await vote(a, shared, 1);
  await refresh(b);
  await expectVote(b, shared, 1, 1, 0);
  await vote(b, shared, 1);
  await refresh(a);
  await expectVote(a, shared, 0, 0, 0);
  await vote(a, shared, -1);
  await refresh(b);
  await expectVote(b, shared, -1, 0, 1);
  await vote(b, shared, 1);
  await syncAndRefresh(a);
  await expectVote(a, shared, 1, 1, 0);
  console.log('PASS: two devices share like/cancel/dislike state with one vote per code.');

  stage = 'cancel tombstone defeats a later cookie migration';
  await vote(a, shared, 1);
  await disconnect(b);
  await expectVote(b, shared, 0, 0, 0);
  await vote(b, shared, 1);
  await expectVote(b, shared, 1, 1, 0);
  await connect(b, codeA);
  await expectVote(b, shared, 0, 0, 0);
  await expectStored(cb, shared, undefined, 0, 0, 0);
  console.log('PASS: reconnecting an old cookie cannot resurrect a cancelled shared vote.');

  stage = 'different codes and disconnect cookie isolation';
  await switchCode(b, codeB);
  await refresh(a);
  await vote(a, shared, 1);
  await refresh(b);
  await expectVote(b, shared, 0, 1, 0);
  await vote(b, shared, -1);
  await refresh(a);
  await expectVote(a, shared, 1, 1, 1);
  await disconnect(b);
  await expectVote(b, shared, 0, 1, 1);
  await vote(b, shared, 1);
  await expectVote(b, shared, 1, 2, 1);
  await connect(b, codeB);
  await expectVote(b, shared, -1, 1, 1);
  await expectStored(cb, shared, undefined, 0, 1, 1);
  console.log('PASS: different codes are independent; disconnect restores cookie identity.');

  stage = 'reload a previously connected browser with a legacy cookie vote';
  await successful(
    await ca.request.post(`${origin}/api/posts/${reload.id}/vote`, {
      data: { value: 1 },
    }),
    'seed old-version cookie vote',
  );
  for (let attempt = 0; attempt < 2; attempt++) {
    const migrated = a.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/sync/votes' &&
        response.request().method() === 'POST',
    );
    await showFixtures(a, true);
    await successful(await migrated, 'hydrate and migrate saved connection');
    await expectVote(a, reload, 1, 1, 0);
    await expectVote(a, migration, 1, 1, 0);
    await expectStored(ca, reload, undefined, 0, 1, 0);
  }
  console.log('PASS: an existing connection migrates legacy cookie votes on reload idempotently.');

  stage = 'late old-code feed response';
  const heldFeed = await holdResponse(
    a,
    (request) =>
      new URL(request.url()).pathname === '/api/posts' &&
      request.method() === 'GET' &&
      request.headers()['x-sync-code'] === codeA,
    async (response) => {
      const rows = await response.json();
      assert.equal(rows.find((post) => post.id === shared.id)?.my_vote, 1);
    },
  );
  await button(a, '刷新').click();
  await heldFeed.ready();
  await switchCode(a, codeB);
  await expectVote(a, shared, -1, 1, 1);
  await heldFeed.release();
  await a.waitForTimeout(200);
  await expectVote(a, shared, -1, 1, 1);
  console.log('PASS: a delayed old-code feed response cannot change the new identity.');

  stage = 'late committed old-code vote response';
  await switchCode(a, codeA);
  await vote(b, lateVote, -1);
  await refresh(a);
  await expectVote(a, lateVote, 0, 0, 1);
  const heldVote = await holdResponse(
    a,
    (request) =>
      new URL(request.url()).pathname === `/api/posts/${lateVote.id}/vote` &&
      request.method() === 'POST' &&
      request.headers()['x-sync-code'] === codeA,
    async (response) => assert.equal((await response.json()).my_vote, 1),
  );
  await button(card(a, lateVote), '点赞').click();
  await heldVote.ready();
  await switchCode(a, codeB);
  await expectVote(a, lateVote, -1, 1, 1);
  await heldVote.release();
  await a.waitForTimeout(200);
  await expectVote(a, lateVote, -1, 1, 1);
  await vote(a, lateVote, -1);
  await expectVote(a, lateVote, 0, 1, 0);
  await expectStored(ca, lateVote, codeA, 1, 1, 0);
  console.log('PASS: a delayed old-code vote cannot overwrite or leave the new identity busy.');
  stage = 'migration waits for an in-flight anonymous vote';
  await disconnect(a);
  await expectVote(a, anonymousWrite, 0, 0, 0);
  const order = [];
  const heldAnonymous = await holdResponse(
    a,
    (request) =>
      new URL(request.url()).pathname === `/api/posts/${anonymousWrite.id}/vote` &&
      request.method() === 'POST' &&
      !request.headers()['x-sync-code'],
    async (response) => {
      assert.equal((await response.json()).my_vote, 1);
      order.push('anonymous-write');
    },
    true,
  );
  await button(card(a, anonymousWrite), '点赞').click();
  await heldAnonymous.ready();
  const observeMigration = (request) => {
    if (
      new URL(request.url()).pathname === '/api/sync/votes' &&
      request.method() === 'POST' &&
      request.headers()['x-sync-code'] === codeA
    )
      order.push('migration');
  };
  a.on('request', observeMigration);
  const connecting = connect(a, codeA);
  // Observe rejection immediately while the browser continues the connection UI.
  void connecting.catch(() => {});
  try {
    await a
      .getByRole('dialog', { name: '随身餐簿', exact: true })
      .locator('#my-sync-code')
      .waitFor();
    await a.waitForTimeout(200);
    assert.deepEqual(order, [], 'migration must wait for the pending anonymous write');
  } finally {
    await heldAnonymous.release();
    await connecting;
    a.off('request', observeMigration);
  }
  assert.deepEqual(order, ['anonymous-write', 'migration']);
  await expectVote(a, anonymousWrite, 1, 1, 0);
  await expectStored(ca, anonymousWrite, undefined, 0, 1, 0);
  await expectStored(ca, anonymousWrite, codeA, 1, 1, 0);
  console.log('PASS: connecting waits for an in-flight anonymous vote, then migrates it once.');
  assert.deepEqual(errors, [], 'unexpected browser errors');
  console.log('PASS: vote sync browser regression completed against real isolated backend.');
} catch (error) {
  console.error(JSON.stringify({ stage, pageErrors: errors }));
  throw error;
} finally {
  // Release network gates before closing pages. Only this run\'s own posts are removed.
  await Promise.allSettled(heldResponses.map((held) => held.release()));
  if (contexts[0]) {
    await Promise.allSettled(
      fixtures.map((post) => contexts[0].request.delete(`${origin}/api/posts/${post.id}`)),
    );
  }
  await browser.close();
}
