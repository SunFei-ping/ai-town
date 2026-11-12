import { test, expect } from '@playwright/test';

test('sample-town-offline：断网浏览示例小镇 7 天，零模型调用', async ({ page }) => {
  const external = [];
  const modelRequests = [];

  page.on('request', (request) => {
    if (/\/v1\//.test(request.url())) modelRequests.push(request.url());
  });

  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
      return route.continue();
    }
    external.push(url.href);
    return route.abort();
  });

  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/#/home');
  await expect(page.locator('.sample-town')).toBeVisible();
  await expect(page.locator('.report')).toBeVisible();
  await expect(page.locator('.sample-town__day')).toHaveCount(7);

  for (let day = 1; day <= 7; day += 1) {
    await page.locator(`.sample-town__day[data-day="${day}"]`).click();
    await expect(page.locator('.report')).toHaveAttribute('data-day', String(day));
    await expect(page.locator('.report__section')).toHaveCount(4);
    await expect(page.locator('.report__unsay')).toHaveCount(5);
  }

  expect(external).toEqual([]);
  expect(modelRequests).toEqual([]);
  expect(errors).toEqual([]);
});
