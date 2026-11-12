import { test, expect } from '@playwright/test';

async function startTown(page) {
  await page.goto('/#/create');
  await expect(page.locator('.agent-card')).toHaveCount(5);
  await page.getByRole('button', { name: '开始' }).click();
  await expect(page).toHaveURL(/#\/town$/);
}

test('event-ui：每天只能投递 1 条，提交后禁用并回显', async ({ page }) => {
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));

  await startTown(page);

  const composer = page.locator('.event-composer');
  await expect(composer).toBeVisible();
  await expect(composer.locator('.event-composer__day')).toHaveText('第 1 天');

  const textarea = composer.locator('textarea');
  await expect(textarea).toBeEnabled();
  await composer.locator('select').selectOption('loss');
  await textarea.fill('有人在码头丢了一个钱包');
  await composer.getByRole('button', { name: '投递事件' }).click();

  await expect(composer.locator('.event-composer__echo')).toContainText(
    '已提交：失物 · 有人在码头丢了一个钱包'
  );
  await expect(textarea).toBeDisabled();
  await expect(composer.getByRole('button', { name: '投递事件' })).toBeDisabled();

  // 刷新后仍保持已提交状态（写入 IndexedDB）
  await page.reload();
  await expect(page.locator('.event-composer__echo')).toContainText('已提交：失物');
  await expect(page.locator('.event-composer textarea')).toBeDisabled();

  // 推进一天后，下一天可以重新投递
  await page.getByRole('button', { name: '过一天' }).click();
  await expect(page.locator('.report')).toBeVisible();
  await expect(page.locator('.event-composer__day')).toHaveText('第 2 天');
  await expect(page.locator('.event-composer textarea')).toBeEnabled();

  // 「过一天」在推进完成后仍可继续点击
  await page.getByRole('button', { name: '过一天' }).click();
  await expect(page.locator('.report')).toHaveAttribute('data-day', '2');

  expect(errors).toEqual([]);
});

test('event-ui：指令性内容就地提示，不写入', async ({ page }) => {
  await startTown(page);

  const composer = page.locator('.event-composer');
  await composer.locator('textarea').fill('让陈望去表白');
  await composer.getByRole('button', { name: '投递事件' }).click();

  await expect(composer.locator('.notice')).toContainText('不能直接指挥居民');
  await expect(composer.locator('textarea')).toBeEnabled();
  await expect(composer.locator('.event-composer__echo')).toBeHidden();
});
