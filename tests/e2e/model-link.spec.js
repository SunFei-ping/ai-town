import { test, expect } from '@playwright/test';

async function startTown(page) {
  await page.goto('/#/create');
  await expect(page.locator('.agent-card')).toHaveCount(5);
  await page.getByRole('button', { name: '开始' }).click();
  await expect(page).toHaveURL(/#\/town$/);
}

test('model-link：连接 Key 后走服务端 SSE 推进，并落库展示', async ({ page }) => {
  await startTown(page);

  await expect(page.getByText('当前：桩模型', { exact: false })).toBeVisible();
  await page.locator('input[type="password"]').fill('sk-e2e-1234567890');
  await page.getByRole('button', { name: '连接模型' }).click();

  await expect(page.getByText('当前：真实模型', { exact: false })).toBeVisible();

  const tickRequest = page.waitForRequest(
    (request) => request.url().includes('/v1/towns/') && request.url().endsWith('/tick')
  );
  await page.getByRole('button', { name: '过一天' }).click();

  const request = await tickRequest;
  expect(request.method()).toBe('POST');
  expect(request.headers().authorization).toMatch(/^Bearer sess_/);

  await expect(page.getByRole('heading', { name: '今日小报' })).toBeVisible();
  await expect(page.locator('.report__section')).toHaveCount(4);
  await expect(page.locator('.report__unsay')).toHaveCount(5);
  await expect(page.locator('.screen__eyebrow')).toHaveText('第 1 天');

  await page.reload();
  await expect(page.getByText('当前：真实模型', { exact: false })).toBeVisible();
  await expect(page.locator('.screen__eyebrow')).toHaveText('第 1 天');
});

test('model-link：无效 Key 就地提示，不进入真实模型', async ({ page }) => {
  await startTown(page);

  await page.locator('input[type="password"]').fill('invalid-key-123456');
  await page.getByRole('button', { name: '连接模型' }).click();

  await expect(page.getByText(/API Key 无效/)).toBeVisible();
  await expect(page.getByText('当前：桩模型', { exact: false })).toBeVisible();
});
