const { test, expect } = require('@playwright/test');
const { startCollector } = require('./collector-fixture');

test('аналитика безопасно показывает сохранённый HTML из публичного события', async ({ browser }) => {
  const fixture = await startCollector(null, { DASH_PASS: 'fixture-password' });
  const context = await browser.newContext({ httpCredentials: { username: 'test', password: 'fixture-password' } });
  try {
    const payload = '<img src=x onerror="window.__storedXss=true">';
    await fetch(fixture.base + '/api/e', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: [{ name: 'spin_start', session_id: 'xss-test',
        visitor_id: 'xss-test', items_text: [payload], props: { music: payload } }] })
    });
    const page = await context.newPage();
    await page.goto(fixture.base + '/api/dashboard');
    await expect(page.locator('#top-items')).toContainText(payload);
    await page.evaluate(() => {
      window.echarts.getInstanceByDom(document.getElementById('music-chart'))
        .dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: 0 });
    });
    await expect(page.locator('#music-chart img')).toHaveCount(0);
    expect(await page.evaluate(() => window.__storedXss)).toBeUndefined();
    await page.getByRole('button', { name: 'Сессии', exact: true }).click();
    await expect(page.locator('#sessions-view')).toContainText(payload);
    await page.locator('.sess__head').click();
    await expect(page.locator('.sess__body')).toContainText(payload);
    expect(await page.evaluate(() => window.__storedXss)).toBeUndefined();
  } finally {
    await context.close();
    await fixture.close();
  }
});
