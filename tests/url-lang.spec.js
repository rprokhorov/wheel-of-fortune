// @ts-check
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

test.describe('Состояние в строке запроса', () => {
  test.beforeEach(async ({ page }) => {
    await h.resetStorage(page);
  });

  test('параметры из ссылки применяются', async ({ page }) => {
    await h.openApp(page, {
      items: 'Костя,Вася,Диман',
      duration: '5',
      music: 'nupogodi',
      volume: '70',
      sound: '0'
    });

    await expect(page.locator('#counter')).toHaveText('3');
    await expect(page.locator('#duration')).toHaveValue('5');
    await expect(page.locator('#music')).toHaveValue('nupogodi');
    await expect(page.locator('#volume')).toHaveValue('70');
    await expect(page.locator('#sound-on')).toHaveClass(/is-muted/);
  });

  test('ссылка важнее сохранённого состояния', async ({ page }) => {
    await h.openApp(page);
    await h.setItems(page, ['Старый1', 'Старый2']);

    await h.openApp(page, { items: 'Новый1,Новый2,Новый3' });

    await expect(page.locator('#counter')).toHaveText('3');
    expect(await h.storedItems(page)).toEqual(['Новый1', 'Новый2', 'Новый3']);
  });

  test('адрес обновляется при изменениях', async ({ page }) => {
    await h.openApp(page);
    await h.setItems(page, ['Ух', 'Ты']);
    await h.setDuration(page, 9);

    const params = await h.queryParams(page);
    expect(params.items).toBe('Ух,Ты');
    expect(params.duration).toBe('9');
    expect(params).toHaveProperty('music');
    expect(params).toHaveProperty('volume');
    expect(params).toHaveProperty('sound');
  });

  test('некорректные значения зажимаются, страница не ломается', async ({ page }) => {
    await h.openApp(page, {
      items: 'А,Б',
      duration: '999',
      volume: '-40',
      music: 'несуществующий'
    });

    // 999 → 20 (максимум), -40 → 0, неизвестный трек → без музыки
    await expect(page.locator('#duration')).toHaveValue('20');
    await expect(page.locator('#volume')).toHaveValue('0');
    await expect(page.locator('#music')).toHaveValue('none');
    await expect(page.locator('#spin')).toBeEnabled();
  });

  test('ссылка копируется в буфер', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'clipboard API только в chromium');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);

    await h.openApp(page);
    await h.setItems(page, ['Копия1', 'Копия2']);
    await page.locator('#copy-link').click();

    await expect(page.locator('#toast')).toBeVisible();

    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain('items=');
    expect(decodeURIComponent(copied)).toContain('Копия1,Копия2');
  });

  test('состояние переносится по ссылке между вкладками', async ({ page, context }) => {
    await h.openApp(page);
    await h.setItems(page, ['Перенос1', 'Перенос2', 'Перенос3']);
    await h.setDuration(page, 4);

    const url = page.url();

    const second = await context.newPage();
    await second.goto(url);
    await expect(second.locator('#counter')).toHaveText('3');
    await expect(second.locator('#duration')).toHaveValue('4');
    await second.close();
  });
});

test.describe('Переключение языка', () => {
  test.beforeEach(async ({ page }) => {
    await h.resetStorage(page);
  });

  test('русский по умолчанию при русской локали', async ({ page }) => {
    await h.openApp(page, { lang: 'ru' });

    await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
    await expect(page.locator('#spin .spin-button__text')).toHaveText('Крутить колесо');
  });

  test('английский через параметр ссылки', async ({ page }) => {
    await h.openApp(page, { lang: 'en' });

    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('#spin .spin-button__text')).toHaveText('Spin the wheel');
    await expect(page.locator('#lang-switch')).toHaveText('Русский');
  });

  test('кнопка переключает язык интерфейса', async ({ page }) => {
    await h.openApp(page, { lang: 'ru' });
    await expect(page.locator('#spin .spin-button__text')).toHaveText('Крутить колесо');

    await page.locator('#lang-switch').click();

    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('#spin .spin-button__text')).toHaveText('Spin the wheel');
    await expect(page.locator('#items-input')).toBeAttached();
  });

  test('выбор языка сохраняется', async ({ page }) => {
    await h.openApp(page, { lang: 'ru' });
    await page.locator('#lang-switch').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    // Открываем без параметра lang — должен подхватиться сохранённый выбор
    await page.goto('/?analytics=off');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('имена треков не переводятся, «без музыки» переводится', async ({ page }) => {
    await h.openApp(page, { lang: 'en' });

    const labels = await page.locator('#music option').evaluateAll(
      (els) => els.map((e) => e.textContent?.trim()));

    expect(labels[0]).toBe('No music');
    expect(labels).toContain('Деревня дураков');
    expect(labels).toContain('Ну, погоди!');
  });

  test('переключение языка не ломает список и колесо', async ({ page }) => {
    await h.openApp(page, { lang: 'ru' });
    await h.setItems(page, ['Один', 'Два', 'Три']);

    await page.locator('#lang-switch').click();

    // Пользовательский список не должен подмениться дефолтным
    await expect(page.locator('#counter')).toHaveText('3');
    expect(await h.storedItems(page)).toEqual(['Один', 'Два', 'Три']);

    await h.setDuration(page, 1);
    await h.spinAndWait(page);
    await expect(page.locator('#decision-dialog')).toBeVisible();
  });

  test('английская версия имеет свой список по умолчанию', async ({ page }) => {
    await h.openApp(page, { lang: 'en' });

    // Дефолтный список не пишется в хранилище, пока его не тронули,
    // поэтому читаем то, что реально показано в редакторе
    const shown = await page.locator('#items-input').inputValue();
    expect(shown).toMatch(/[A-Za-z]/);
    expect(shown).not.toContain('Пицца');
  });
});
