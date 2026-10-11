import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({
  ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
  headless: true,
});
try {
  const page = await browser.newPage({ viewport: { width: 1365, height: 1000 } });
  const requests = [],
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('what-to-eat:onboarding:v1', 'seen'));
  const posts = Array.from({ length: 80 }, (_, i) => ({
    id: 'p' + i,
    restaurant_id: 'r1',
    eaten_on: '2026-10-11',
    nickname: 'test',
    body: 'A meal',
    created_at: 100 - i,
    shared_meal_id: null,
    images: [],
    likes: 0,
    dislikes: 0,
    my_vote: 0,
  }));
  await page.route('**/api/**', async (r) => {
    const u = new URL(r.request().url());
    let body;
    if (u.pathname === '/api/health') body = { ok: true };
    else if (u.pathname === '/api/restaurants') body = [{ id: 'r1', name: 'test restaurant' }];
    else if (u.pathname === '/api/settings') body = { window_size: 5 };
    else if (u.pathname === '/api/posts') {
      const offset = Number(u.searchParams.get('offset') || 0);
      requests.push(offset);
      body = posts.slice(offset, offset + 20);
    } else if (u.pathname === '/api/maps/config') body = { enabled: false };
    else body = [];
    await r.fulfill({ json: body });
  });
  await page.clock.install();
  await page.goto((process.env.BASE_URL || 'http://127.0.0.1:11454') + '/#feed');
  await page.locator('.feed-entry').last().waitFor();
  const button = page.getByRole('button', { name: '再看一些分享', exact: true });
  for (let i = 0; i < 2; i++) {
    await button.click();
    await assert.doesNotReject(() =>
      page.waitForFunction(
        (n) => document.querySelectorAll('.feed-entry').length === n,
        40 + i * 20,
      ),
    );
  }
  const pagination = [...requests];
  await page.evaluate(() => (location.hash = 'choose'));
  await page.waitForTimeout(500);
  requests.length = 0;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.clock.runFor(31_000);
  await page.waitForTimeout(200);
  const report = {
    paginationOffsets: pagination,
    pagesRequestedFor60Posts: pagination.length,
    hiddenFeedFocusOffsets: requests,
    feedActuallyHidden: await page
      .locator('.food-journal')
      .evaluate((el) => el.closest('[hidden]') !== null),
    errors,
  };
  assert.deepEqual(pagination, [0, 20, 40]);
  assert.deepEqual(requests, []);
  assert.equal(report.feedActuallyHidden, true);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
