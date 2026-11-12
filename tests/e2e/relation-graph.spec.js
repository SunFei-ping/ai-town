import { test, expect } from '@playwright/test';

async function createAndRunOneDay(page) {
  await page.goto('/#/create');
  await expect(page.locator('.agent-card')).toHaveCount(5);
  await page.getByRole('button', { name: '开始' }).click();
  await expect(page).toHaveURL(/#\/town$/);

  await page.getByRole('button', { name: '过一天' }).click();
  await expect(page.getByRole('heading', { name: /今日计划/ })).toBeVisible();
}

test('关系图：5 个节点与有向关系边，三态图例可辨', async ({ page }) => {
  await createAndRunOneDay(page);

  const graph = page.locator('.relation-graph');
  await expect(graph).toBeVisible();
  await expect(page.locator('.relation-graph__node')).toHaveCount(5);
  await expect(page.locator('.relation-graph__edge')).toHaveCount(2);

  await expect(page.locator('.relation-graph__legend li')).toHaveCount(3);
  for (const state of ['familiar', 'stranger', 'knot']) {
    await expect(page.locator(`.relation-graph__legend-item[data-state="${state}"]`)).toHaveCount(1);
  }

  await expect(page.locator('.relation-graph__node[aria-label^="陈望"]')).toHaveCount(1);
  await expect(page.locator('.relation-graph__edges li')).toHaveCount(2);
  await expect(page.locator('.relation-graph__edges li').first()).toContainText('→');
});
