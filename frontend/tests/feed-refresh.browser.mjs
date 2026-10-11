// Publish through the real UI against mocked APIs. No server data is written.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROMIUM_EXECUTABLE=/path/to/chrome \
//   BASE_URL=http://127.0.0.1:11454 node tests/feed-refresh.browser.mjs
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
await context.addInitScript(() => localStorage.setItem('what-to-eat:onboarding:v1', 'seen'));
const newBody = '缓存回归的新分享';
const oldPost = {
  id: 'old-post',
  restaurant_id: 'restaurant',
  eaten_on: '2026-10-10',
  nickname: '饭友',
  body: '已缓存的旧分享',
  created_at: 1,
  shared_meal_id: null,
  cost_cents: null,
  images: [],
  likes: 0,
  dislikes: 0,
  my_vote: 0,
};
const newPost = { ...oldPost, id: 'new-post', body: newBody, created_at: 2 };
let published = false,
  postRequests = 0,
  getRequests = 0;
await context.route('**/api/**', async (route) => {
  const request = route.request(),
    path = new URL(request.url()).pathname;
  let body = {};
  if (path === '/api/posts') {
    if (request.method() === 'POST') {
      assert.match(request.postData(), /缓存回归的新分享/);
      postRequests++;
      published = true;
      body = newPost;
    } else {
      getRequests++;
      body = published ? [newPost, oldPost] : [oldPost];
    }
  } else if (path === '/api/posts/authors') body = [{ nickname: '饭友', count: published ? 2 : 1 }];
  else if (path === '/api/restaurants') body = [{ id: 'restaurant', name: '缓存测试饭店' }];
  else if (path === '/api/meals') body = [];
  else if (path === '/api/settings') body = { window_size: 5 };
  await route.fulfill({ json: body });
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
async function crossScopeEditRegression() {
  const scopeContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await scopeContext.addInitScript(() => {
    localStorage.setItem('what-to-eat:onboarding:v1', 'seen');
    localStorage.setItem(
      'what-to-eat:local:v1',
      JSON.stringify({
        version: 1,
        window_size: 5,
        meals: [
          {
            id: 'local-meal',
            restaurant_id: 'restaurant',
            eaten_on: '2026-10-10',
            created_at: 1,
            rating: null,
            cost_cents: null,
            post_ids: ['old-post'],
          },
        ],
      }),
    );
  });
  const beforeEdit = { ...oldPost, body: '修改前正文' };
  let current = beforeEdit,
    normalReads = 0,
    releaseOldRead;
  await scopeContext.route('**/api/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    let body = {};
    if (url.pathname === '/api/posts') {
      if (!url.searchParams.has('ids') && ++normalReads === 2) {
        await new Promise((resolve) => {
          releaseOldRead = resolve;
        });
        body = [beforeEdit];
      } else body = [current];
    } else if (url.pathname === '/api/posts/old-post' && request.method() === 'PUT') {
      current = { ...beforeEdit, body: '修改后正文' };
      body = current;
    } else if (url.pathname === '/api/posts/authors') body = [];
    else if (url.pathname === '/api/restaurants')
      body = [{ id: 'restaurant', name: '缓存测试饭店' }];
    else if (url.pathname === '/api/meals') body = [];
    else if (url.pathname === '/api/settings') body = { window_size: 5 };
    await route.fulfill({ json: body }).catch(() => {});
  });
  const scopePage = await scopeContext.newPage();
  const button = (name) => scopePage.getByRole('button', { name, exact: true });
  const text = (body) =>
    scopePage.locator('.food-journal .markdown').getByText(body, { exact: true });
  await scopePage.goto(`${process.env.BASE_URL || 'http://127.0.0.1:11454'}/#feed`);
  await text('修改前正文').waitFor();
  await button('刷新').click();
  await scopePage.waitForTimeout(100);
  assert.equal(typeof releaseOldRead, 'function');
  await scopePage.evaluate(() => {
    location.hash = 'history';
  });
  await button('我自己吃').click();
  await scopePage.locator('.ledger-meal').click();
  await scopePage.getByText('这顿本地用餐的分享', { exact: true }).waitFor();
  await button('编辑分享').click();
  await scopePage.getByPlaceholder('用餐感受', { exact: true }).fill('修改后正文');
  await button('保存修改').click();
  await scopePage.getByRole('dialog').waitFor({ state: 'hidden' });
  await text('修改后正文').waitFor();
  releaseOldRead();
  await scopePage.waitForTimeout(100);
  await button('查看全部分享').click();
  await text('修改后正文').waitFor({ timeout: 2000 });
  assert.equal(await text('修改前正文').count(), 0);
  await scopeContext.close();
  console.log('PASS: a late ordinary-feed read cannot undo an edit committed in the linked feed.');
}

try {
  await page.goto(`${process.env.BASE_URL || 'http://127.0.0.1:11454'}/#feed`);
  await page.locator('.food-journal .markdown').getByText(oldPost.body, { exact: true }).waitFor();
  const before = getRequests;
  await page.getByRole('button', { name: '写分享', exact: true }).click();
  await page.getByRole('button', { name: '饭店：搜索或选择饭店', exact: true }).click();
  await page.getByRole('option', { name: '缓存测试饭店', exact: true }).click();
  await page.getByPlaceholder('用餐感受', { exact: true }).fill(newBody);
  await page.getByRole('button', { name: '保存并分享', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  // A fresh cache must still be invalidated after publishing, without waiting for the 30s poll.
  await page
    .locator('.food-journal .markdown')
    .getByText(newBody, { exact: true })
    .waitFor({ timeout: 2000 });
  assert.equal(postRequests, 1);
  assert.ok(getRequests > before, 'publishing must refresh the already-fresh feed query');
  assert.equal(await page.locator('.food-journal .markdown').count(), 2);
  assert.deepEqual(errors, []);
  console.log(
    `PASS: one real UI publication appeared immediately; feed GETs ${before} → ${getRequests}.`,
  );
  await crossScopeEditRegression();
} catch (error) {
  console.error(JSON.stringify({ postRequests, getRequests, published, pageErrors: errors }));
  throw error;
} finally {
  await browser.close();
}
