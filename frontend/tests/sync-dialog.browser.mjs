// Run against an isolated build; all API requests are mocked.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROMIUM_EXECUTABLE=/path/to/chrome \
//   BASE_URL=http://127.0.0.1:11454 node tests/sync-dialog.browser.mjs
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
});
const content = { local: { version: 1, window_size: 2, meals: [] }, nickname: '测试' };
const restaurants = ['甲店', '乙店', '丙店', '丁店'].map((name, i) => ({ id: String(i), name }));
const meal = (id, restaurant, date) => ({
  id,
  restaurant_id: String(restaurant),
  eaten_on: date,
  created_at: 1,
  rating: null,
  cost_cents: null,
  post_ids: [],
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript((content) => {
  localStorage.setItem('what-to-eat:onboarding:v1', 'seen');
  localStorage.setItem('what-to-eat:local:v1', JSON.stringify(content.local));
  localStorage.setItem('what-to-eat:nickname:v1', content.nickname);
  localStorage.setItem(
    'what-to-eat:sync:v1',
    JSON.stringify({
      code: '1'.repeat(32),
      connection: 'initial',
      base: { revision: 1, content },
      lastSynced: 1,
    }),
  );
  window.testClipboard = { mode: 'success', value: '' };
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: (value) => {
        const state = window.testClipboard;
        if (state.mode === 'failure') return Promise.reject(new Error('clipboard unavailable'));
        if (state.mode === 'delayed')
          return new Promise((resolve) => {
            state.finish = () => {
              state.value = value;
              resolve();
            };
          });
        state.value = value;
        return Promise.resolve();
      },
    },
  });
}, content);
let revision = 1,
  codeIndex = 1,
  remote = content,
  release,
  blockReads = false;
const mockApi = async (route) => {
  const request = route.request(),
    path = new URL(request.url()).pathname;
  let body = {};
  if (path === '/api/sync') {
    if (request.method() === 'GET' && blockReads)
      await new Promise((resolve) => {
        release = resolve;
      });
    if (request.method() === 'POST') {
      remote = request.postDataJSON();
      revision = 1;
      body = { code: String(++codeIndex).repeat(32), revision, content: remote };
    } else {
      if (request.method() === 'PUT') {
        remote = request.postDataJSON().content;
        revision++;
      }
      body = { revision, content: remote };
    }
  } else if (path === '/api/restaurants') body = restaurants;
  else if (path === '/api/meals') body = [meal('c', 2, '2026-10-10')];
  else if (path === '/api/settings') body = { window_size: 1 };
  else if (path === '/api/posts')
    body = [
      {
        id: 'post',
        restaurant_id: '0',
        eaten_on: '2026-10-10',
        nickname: '测试',
        body: '**加粗** [外链](https://example.com)\n\n![照片](https://example.com/x.png)\n\n<script>alert(1)</script>',
        created_at: 1,
        shared_meal_id: null,
        cost_cents: null,
        images: [],
        likes: 0,
        dislikes: 0,
        my_vote: 0,
      },
    ];
  await route.fulfill({ json: body }).catch(() => {});
};
await context.route('**/api/**', mockApi);
let page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const button = (name) => page.getByRole('button', { name, exact: typeof name === 'string' });
const openSync = () => button('个人餐簿同步').click();
const close = () => button('关闭').click();
const disconnect = async () => {
  await button('断开此设备').click();
  await button('确认断开').click();
};
const reconnect = async () => {
  await disconnect();
  await button('获取我的同步码').click();
  await button('复制同步码').waitFor();
};
try {
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:11454');
  await button('帮我选一家').waitFor();
  await openSync();
  await button('复制同步码').click();
  await button('已复制').waitFor();
  await reconnect();
  assert.equal(await button('已复制').count(), 0);
  assert.equal(await button('确认断开').count(), 0);
  assert.notEqual(
    await page.locator('#my-sync-code').inputValue(),
    await page.evaluate(() => window.testClipboard.value),
  );
  await page.evaluate(() => {
    window.testClipboard.mode = 'failure';
  });
  await button('复制同步码').click();
  await page.getByText('可长按上方同步码，手动复制', { exact: true }).waitFor();
  await reconnect();
  assert.equal(await page.getByText('可长按上方同步码，手动复制', { exact: true }).count(), 0);
  await page.evaluate(() => {
    window.testClipboard.mode = 'delayed';
  });
  await button('复制同步码').click();
  await reconnect();
  await page.evaluate(() => window.testClipboard.finish());
  await page.waitForTimeout(50);
  assert.equal(await button('已复制').count(), 0);
  blockReads = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByText('正在同步', { exact: true }).waitFor();
  await close();
  assert.equal(await page.getByRole('dialog', { name: '随身餐簿', exact: true }).count(), 0);
  await openSync();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog', { name: '随身餐簿', exact: true }).count(), 0);
  blockReads = false;
  release();
  await openSync();
  await disconnect();
  await close();
  await context.close();
  const derivedContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  // Seed legacy data before the app migrates it into its durable store.
  await derivedContext.addInitScript(
    (meals) => {
      localStorage.setItem('what-to-eat:onboarding:v1', 'seen');
      localStorage.setItem(
        'what-to-eat:local:v1',
        JSON.stringify({ version: 1, window_size: 2, meals }),
      );
    },
    [meal('a1', 0, '2026-10-10'), meal('a2', 0, '2026-10-09'), meal('b', 1, '2026-10-08')],
  );
  await derivedContext.route('**/api/**', mockApi);
  page = await derivedContext.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:11454');
  await button('我自己吃').click();
  await button('自己选一家').click();
  const candidates = () => page.locator('.candidate-row > span:nth-child(2)').allTextContents();
  assert.deepEqual(await candidates(), ['丁店']);
  await close();
  await button('选餐偏好').click();
  await button(/近期先换换口味/).click();
  assert.deepEqual(await candidates(), ['甲店', '乙店', '丙店']);
  await close();
  await button('选餐偏好').click();
  await button(/个人窗口/).click();
  await page.getByLabel('避开最近几家饭店').fill('1');
  await button('保存设置').click();
  await button('自己选一家').click();
  assert.deepEqual(await candidates(), ['乙店', '丁店']);
  await close();
  await page.evaluate(() => {
    location.hash = 'history';
  });
  await page.getByText('共 3 顿 · 2 家饭店', { exact: true }).waitFor();
  assert.deepEqual(await page.locator('.ledger-meal strong').allTextContents(), [
    '甲店',
    '甲店',
    '乙店',
  ]);
  for (let i = 0; i < 2; i++) {
    await button('删除这条用餐记录').last().click();
    await button('确认').click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
  }
  await page.getByText('共 1 顿 · 1 家饭店', { exact: true }).waitFor();
  assert.equal(await page.locator('.ledger-meal').count(), 1);
  await page.evaluate(() => {
    location.hash = 'feed';
  });
  await page.locator('.markdown strong').getByText('加粗', { exact: true }).waitFor();
  assert.equal(await page.locator('.markdown img, .markdown script').count(), 0);
  const link = page.locator('.markdown a');
  assert.equal(await link.getAttribute('target'), '_blank');
  assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');
  assert.deepEqual(errors, []);
  console.log(
    'PASS: reconnect state, delayed clipboard, background close/Esc, derived list updates, sanitized lazy Markdown.',
  );
} finally {
  await browser.close();
}
