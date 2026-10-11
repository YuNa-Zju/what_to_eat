// Run against an isolated build; API responses and failing chunks are intercepted.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs CHROMIUM_EXECUTABLE=/path/to/chrome \
//   BASE_URL=http://127.0.0.1:11454 node tests/lazy-loading.browser.mjs
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
});
const base = process.env.BASE_URL || 'http://127.0.0.1:11454';
const text = '**正文** <script>alert(1)</script> ![照片](https://example.com/image.png)';
async function fixture() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => localStorage.setItem('what-to-eat:onboarding:v1', 'seen'));
  await context.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body = {};
    if (path === '/api/restaurants') body = [{ id: 'restaurant', name: '测试饭店' }];
    else if (path === '/api/meals' || path === '/api/posts/authors') body = [];
    else if (path === '/api/settings') body = { window_size: 5 };
    else if (path === '/api/posts')
      body = [
        {
          id: 'post',
          restaurant_id: 'restaurant',
          eaten_on: '2026-10-10',
          nickname: '饭友',
          body: text,
          created_at: 1,
          shared_meal_id: null,
          cost_cents: null,
          images: [],
          likes: 0,
          dislikes: 0,
          my_vote: 0,
        },
      ];
    await route.fulfill({ json: body });
  });
  const page = await context.newPage(),
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return { context, page, errors };
}
try {
  const failure = await fixture();
  let abortComposer = true;
  await failure.context.route('**/assets/composer-*.js', async (route) => {
    if (abortComposer) {
      abortComposer = false;
      await route.abort('failed');
    } else await route.continue();
  });
  await failure.page.goto(base);
  await failure.page.getByRole('button', { name: '记一顿', exact: true }).click();
  const errorDialog = failure.page.getByRole('dialog', { name: '编辑器暂时没有打开', exact: true });
  await errorDialog.waitFor();
  assert.ok(await failure.page.locator('#root').evaluate((root) => root.childElementCount));
  await errorDialog.getByRole('button', { name: '关闭', exact: true }).click();
  await failure.page.getByRole('button', { name: '记一顿', exact: true }).click();
  await errorDialog.waitFor();
  await Promise.all([
    failure.page.waitForEvent('load'),
    errorDialog.getByRole('button', { name: '刷新页面', exact: true }).click(),
  ]);
  await failure.page.getByRole('button', { name: '记一顿', exact: true }).click();
  await failure.page.getByRole('dialog', { name: '记下这顿饭', exact: true }).waitFor();
  assert.deepEqual(failure.errors, []);
  await failure.context.close();

  const pending = await fixture();
  let release;
  await pending.context.route('**/assets/composer-*.js', async (route) => {
    await new Promise((resolve) => {
      release = resolve;
    });
    await route.continue();
  });
  await pending.page.goto(base);
  await pending.page.getByRole('button', { name: '记一顿', exact: true }).click();
  await pending.page.getByRole('dialog', { name: '正在打开编辑器', exact: true }).waitFor();
  await pending.page.keyboard.press('Escape');
  assert.equal(await pending.page.getByRole('dialog').count(), 0);
  await pending.page.getByRole('button', { name: '记一顿', exact: true }).click();
  await pending.page.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await pending.page.getByRole('dialog').count(), 0);
  release();
  await pending.page.waitForTimeout(200);
  assert.equal(await pending.page.getByRole('dialog').count(), 0);
  assert.deepEqual(pending.errors, []);
  await pending.context.close();

  const markdown = await fixture();
  await markdown.context.route('**/assets/markdown-content-*.js', (route) => route.abort('failed'));
  await markdown.page.goto(`${base}/#feed`);
  await markdown.page.locator('.markdown').getByText(text, { exact: true }).waitFor();
  assert.ok(await markdown.page.locator('#root').evaluate((root) => root.childElementCount));
  assert.equal(await markdown.page.locator('.markdown script, .markdown img').count(), 0);
  await markdown.page.evaluate(() => {
    location.hash = 'choose';
  });
  await markdown.page.getByRole('button', { name: '帮我选一家', exact: true }).waitFor();
  assert.deepEqual(markdown.errors, []);
  await markdown.context.close();
  console.log(
    'PASS: failed chunks stay local; editor can close/reload/recover; pending editor can cancel/Esc; Markdown falls back to safe text.',
  );
} finally {
  await browser.close();
}
