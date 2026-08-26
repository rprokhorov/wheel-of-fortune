// @ts-check
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

test.describe('Музыка и звук', () => {
  test.beforeEach(async ({ page }) => {
    await h.resetStorage(page);
  });

  test('в списке музыки все треки и «без музыки»', async ({ page }) => {
    await h.openApp(page);

    const options = page.locator('#music option');
    await expect(options).toHaveCount(4);

    const values = await options.evaluateAll((els) => els.map((e) => e.value));
    expect(values).toEqual(['none', 'kalambur', 'nupogodi', 'benny']);
  });

  test('по умолчанию выбран «Деревня дураков»', async ({ page }) => {
    await h.openApp(page);
    await expect(page.locator('#music')).toHaveValue('kalambur');
  });

  test('выбор трека сохраняется', async ({ page }) => {
    await h.openApp(page);
    await page.locator('#music').selectOption('benny');

    expect((await h.storedSettings(page)).music).toBe('benny');

    await page.reload();
    await expect(page.locator('#music')).toHaveValue('benny');
  });

  test('при «без музыки» громкость скрыта', async ({ page }) => {
    await h.openApp(page);
    await expect(page.locator('#volume-field')).toBeVisible();

    await page.locator('#music').selectOption('none');
    await expect(page.locator('#volume-field')).toBeHidden();

    await page.locator('#music').selectOption('nupogodi');
    await expect(page.locator('#volume-field')).toBeVisible();
  });

  test('громкость сохраняется', async ({ page }) => {
    await h.openApp(page);
    await page.locator('#volume').fill('25');
    await page.locator('#volume').dispatchEvent('change');

    expect((await h.storedSettings(page)).volume).toBe(25);
  });

  test('музыка играет во время вращения и смолкает после', async ({ page }) => {
    await h.openApp(page);
    await h.setItems(page, ['А', 'Б']);
    await h.setDuration(page, 3);
    await page.locator('#music').selectOption('nupogodi');

    await page.locator('#spin').click();

    // Эквалайзер показывает, что трек реально запущен
    await expect(page.locator('#equalizer')).toHaveClass(/is-playing/, { timeout: 5000 });

    await expect(page.locator('#decision-dialog')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#equalizer')).not.toHaveClass(/is-playing/);
  });

  test('при «без музыки» эквалайзер не включается', async ({ page }) => {
    await h.openApp(page);
    await h.setItems(page, ['А', 'Б']);
    await h.setDuration(page, 2);
    await page.locator('#music').selectOption('none');

    await page.locator('#spin').click();
    await page.waitForTimeout(800);
    await expect(page.locator('#equalizer')).not.toHaveClass(/is-playing/);
  });

  test('звуковые эффекты переключаются и сохраняются', async ({ page }) => {
    await h.openApp(page);
    const button = page.locator('#sound-on');

    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await button.click();

    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(button).toHaveClass(/is-muted/);
    expect((await h.storedSettings(page)).sound).toBe(false);

    await page.reload();
    await expect(page.locator('#sound-on')).toHaveClass(/is-muted/);
  });

  test('аудиофайлы треков доступны', async ({ page }) => {
    for (const file of ['kalambur', 'nu-pogodi', 'benny-hill']) {
      const response = await page.request.get(`/music/${file}.m4a`);
      expect(response.status(), `music/${file}.m4a`).toBe(200);
      expect(Number(response.headers()['content-length'])).toBeGreaterThan(10_000);
    }
  });
});

test.describe('Длительность вращения', () => {
  test.beforeEach(async ({ page }) => {
    await h.resetStorage(page);
  });

  test('по умолчанию 20 секунд, диапазон 1–20', async ({ page }) => {
    await h.openApp(page);

    const slider = page.locator('#duration');
    await expect(slider).toHaveValue('20');
    await expect(slider).toHaveAttribute('min', '1');
    await expect(slider).toHaveAttribute('max', '20');
  });

  test('длительность сохраняется', async ({ page }) => {
    await h.openApp(page);
    await h.setDuration(page, 7);

    expect((await h.storedSettings(page)).duration).toBe(7);

    await page.reload();
    await expect(page.locator('#duration')).toHaveValue('7');
  });

  test('подпись показывает выбранное значение', async ({ page }) => {
    await h.openApp(page);
    await page.locator('#duration').fill('12');

    await expect(page.locator('#duration-out')).toContainText('12');
  });
});
