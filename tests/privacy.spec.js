const { test, expect } = require('@playwright/test');
const { setItems } = require('./helpers');

test('отказ от аналитики сохраняется после изменения списка и перезагрузки', async ({ page }) => {
  const analytics = [];
  page.on('request', req => { if (new URL(req.url()).pathname === '/api/e') analytics.push(req); });
  await page.goto('/?analytics=off');
  await setItems(page, ['Первый', 'Второй']);
  await expect(page).toHaveURL(/analytics=off/);
  await page.reload();
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(await page.evaluate(() => localStorage.getItem('wof.visitor'))).toBeNull();
  expect(analytics).toHaveLength(0);
});
