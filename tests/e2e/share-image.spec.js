import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function startTown(page) {
  await page.goto('/#/create');
  await expect(page.locator('.agent-card')).toHaveCount(5);
  await page.getByRole('button', { name: '开始' }).click();
  await expect(page).toHaveURL(/#\/town$/);
}

test('share-image：导出 PNG 长图，文件名含天数', async ({ page }) => {
  await startTown(page);
  await page.getByRole('button', { name: '过一天' }).click();
  await expect(page.locator('.report')).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '保存分享图' }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe('ai-town-day-1.png');
  const path = await download.path();
  expect(path).toBeTruthy();

  const buffer = await readFile(path);
  expect(buffer.subarray(1, 4).toString('utf8')).toBe('PNG');

  // 长图：高度明显大于 375px 的移动端宽度
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  expect(width).toBe(750);
  expect(height).toBeGreaterThan(width);
});
