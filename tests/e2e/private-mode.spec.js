import { test, expect } from '@playwright/test';

test('private-mode：IndexedDB 不可用时降级到内存并常驻提示', async ({ page }) => {
  await page.addInitScript(() => {
    try {
      Object.defineProperty(window, 'indexedDB', {
        configurable: true,
        get: () => undefined,
      });
    } catch {
      /* 忽略：部分浏览器不允许覆盖 */
    }
  });

  await page.goto('/#/create');
  await expect(page.locator('.agent-card')).toHaveCount(5);
  await page.getByRole('button', { name: '开始' }).click();
  await expect(page).toHaveURL(/#\/town$/);

  const notice = page.locator('#storage-notice');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('刷新即丢失');

  // 功能仍可运行：推进一天并看到小报
  await page.getByRole('button', { name: '过一天' }).click();
  await expect(page.getByRole('heading', { name: '今日小报' })).toBeVisible();
  await expect(page.locator('.report')).toBeVisible();
});
