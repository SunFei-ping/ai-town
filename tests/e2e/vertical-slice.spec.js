import { test, expect } from '@playwright/test';

test('垂直切片：建镇 → 跑一天 → 展示计划与独白 → 刷新不丢', async ({ page }) => {
  await page.goto('/#/create');

  await expect(page.locator('.agent-card')).toHaveCount(5);
  await expect(page.locator('#screen h1')).toHaveText('建镇');

  await page.getByRole('button', { name: '开始' }).click();

  await expect(page).toHaveURL(/#\/town$/);
  await expect(page.locator('#screen h1')).toHaveText('小镇');
  await expect(page.locator('.screen__eyebrow')).toHaveText('第 0 天');

  await page.getByRole('button', { name: '过一天' }).click();

  await expect(page.getByRole('heading', { name: /今日计划/ })).toBeVisible();
  await expect(page.locator('.quote')).toBeVisible();
  await expect(page.locator('.plan-list li')).toHaveCount(4);
  await expect(page.locator('.screen__eyebrow')).toHaveText('第 1 天');

  await page.reload();
  await expect(page.locator('.screen__eyebrow')).toHaveText('第 1 天');
  await expect(page.getByRole('button', { name: '过一天' })).toBeEnabled();
});

test('五阶段进度在推进过程中可见', async ({ page }) => {
  await page.goto('/#/create');
  await expect(page.locator('.agent-card')).toHaveCount(5);
  await page.getByRole('button', { name: '开始' }).click();
  await expect(page).toHaveURL(/#\/town$/);

  await page.getByRole('button', { name: '过一天' }).click();
  await expect(page.getByRole('heading', { name: /今日计划/ })).toBeVisible();

  for (const stage of ['validating', 'planning', 'simulating', 'reflecting', 'reporting']) {
    await expect(page.locator(`.progress__item[data-stage="${stage}"]`)).toHaveCount(1);
  }
});
