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

test('town-scene：可点选居民、暂停、拖动时间轴并查看对话', async ({ page }) => {
  await startTown(page);
  await page.getByRole('button', { name: '过一天' }).click();
  await expect(page.getByRole('heading', { name: '今日小报' })).toBeVisible();

  // 点选居民
  const chip = page.locator('.town-scene__chip', { hasText: '陈望' });
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.town-scene__panel')).toBeVisible();
  await expect(page.locator('.town-scene__panel h3')).toHaveText('陈望');
  await expect(page.locator('.town-scene__panel')).toContainText('今日计划');
  await expect(page.locator('.town-scene__panel')).toContainText('镜头跟随');

  await page.getByRole('button', { name: '关闭信息面板' }).click();
  await expect(page.locator('.town-scene__panel')).toBeHidden();

  // 暂停 / 继续
  const toggle = page.locator('.town-scene__controls button').first();
  await toggle.click();
  await expect(toggle).toHaveText('继续');
  await toggle.click();
  await expect(toggle).toHaveText('暂停');

  // 时间轴拖到 14:00
  await page.locator('.town-scene__controls input[type="range"]').evaluate((element) => {
    element.value = '8';
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('.town-scene__hud')).toContainText('14:00');

  // 点击相遇气泡查看完整对话
  await expect(page.locator('.town-scene__bubble')).toBeVisible();
  await page.locator('.town-scene__bubble').click();
  await expect(page.locator('.town-scene__panel h3')).toContainText('码头');
  await expect(page.locator('.town-scene__panel li').first()).toBeVisible();
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
