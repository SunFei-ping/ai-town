import { test, expect } from '@playwright/test';

test('四屏可导航，刷新后停留在当前屏', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#screen h1')).toHaveText('AI小镇');

  await page.getByRole('link', { name: '建镇' }).click();
  await expect(page.locator('#screen h1')).toHaveText('建镇');
  await expect(page).toHaveURL(/#\/create$/);

  await page.reload();
  await expect(page.locator('#screen h1')).toHaveText('建镇');

  await page.getByRole('link', { name: '小镇' }).click();
  await expect(page.locator('#screen h1')).toHaveText('小镇');

  await page.getByRole('link', { name: '年报' }).click();
  await expect(page.locator('#screen h1')).toHaveText('年报');

  await page.getByRole('link', { name: '首页' }).click();
  await expect(page.locator('#screen h1')).toHaveText('AI小镇');
});

test('导航项正确标记当前屏，且无脚本错误', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');
  await expect(page.locator('[data-route="home"]')).toHaveAttribute('aria-current', 'page');

  await page.getByRole('link', { name: '建镇' }).click();
  await expect(page.locator('[data-route="create"]')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('[data-route="home"]')).not.toHaveAttribute('aria-current', 'page');

  expect(errors).toEqual([]);
});

test('未知路由回落到首页', async ({ page }) => {
  await page.goto('/#/not-exist');
  await expect(page.locator('#screen h1')).toHaveText('AI小镇');
});
