import { test, expect } from '@playwright/test';

test.describe('小报渲染（375px）', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('report-render：四类版块齐全、5 条 unsaid、无横向溢出', async ({ page }) => {
    await page.goto('/#/create');
    await expect(page.locator('.agent-card')).toHaveCount(5);
    await page.getByRole('button', { name: '开始' }).click();
    await expect(page).toHaveURL(/#\/town$/);

    await page.getByRole('button', { name: '过一天' }).click();
    await expect(page.getByRole('heading', { name: '今日小报' })).toBeVisible();

    await expect(page.locator('.report')).toHaveCount(1);
    for (const kind of ['headline', 'scene', 'relation', 'unsaid']) {
      await expect(page.locator(`.report__section[data-kind="${kind}"]`)).toHaveCount(1);
    }
    await expect(page.locator('.report__unsay')).toHaveCount(5);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);

    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator('.report')).toHaveScreenshot('report-375.png', {
      maxDiffPixelRatio: 0.05,
      animations: 'disabled',
    });
  });
});
