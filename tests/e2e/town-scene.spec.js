import { test, expect } from '@playwright/test';

async function startTown(page) {
  await page.goto('/#/create');
  await expect(page.locator('.agent-card')).toHaveCount(5);
  await page.getByRole('button', { name: '开始' }).click();
  await expect(page).toHaveURL(/#\/town$/);
}

test('town-scene：主界面渲染 3D 小镇并在推进后播放', async ({ page }) => {
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));

  await startTown(page);

  await expect(page.locator('.town-scene canvas')).toHaveCount(1);
  await expect(page.locator('.town-scene__fallback')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '重播' })).toBeHidden();

  await page.getByRole('button', { name: '过一天' }).click();
  await expect(page.getByRole('heading', { name: '今日小报' })).toBeVisible();

  await expect(page.locator('.town-scene__hud')).toContainText('第 1 天');
  await expect(page.getByRole('button', { name: '重播' })).toBeVisible();

  await page.getByRole('button', { name: '重播' }).click();
  await expect(page.locator('.town-scene__hud')).toContainText('第 1 天');

  expect(errors).toEqual([]);
});

test.describe('town-scene：375px', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('场景不造成横向溢出', async ({ page }) => {
    await startTown(page);
    await expect(page.locator('.town-scene canvas')).toHaveCount(1);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
