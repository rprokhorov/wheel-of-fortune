// @ts-check
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

test.describe('Список вариантов', () => {
  test.beforeEach(async ({ page }) => {
    await h.resetStorage(page);
  });

  test('список редактируется и сохраняется', async ({ page }) => {
    await h.openApp(page);
    await h.setItems(page, ['Первый', 'Второй', 'Третий']);

    expect(await h.storedItems(page)).toEqual(['Первый', 'Второй', 'Третий']);
  });

  test('список переживает перезагрузку', async ({ page }) => {
    await h.openApp(page);
    await h.setItems(page, ['Альфа', 'Бета', 'Гамма']);

    await page.reload();
    await expect(page.locator('#counter')).toHaveText('3');
    expect(await h.storedItems(page)).toEqual(['Альфа', 'Бета', 'Гамма']);
  });

  test('дубликаты отсеиваются без учёта регистра', async ({ page }) => {
    await h.openApp(page);
    const editor = page.locator('#items-editor');
    await editor.locator('summary').click();
    await page.locator('#items-input').fill('Вася\nвася\nВАСЯ\nПетя');
    await page.locator('#apply-items').click();

    await expect(page.locator('#counter')).toHaveText('2');
    expect(await h.storedItems(page)).toEqual(['Вася', 'Петя']);
  });

  test('запятая и точка с запятой тоже разделяют варианты', async ({ page }) => {
    await h.openApp(page);
    const editor = page.locator('#items-editor');
    await editor.locator('summary').click();
    await page.locator('#items-input').fill('Раз, Два; Три');
    await page.locator('#apply-items').click();

    await expect(page.locator('#counter')).toHaveText('3');
    expect(await h.storedItems(page)).toEqual(['Раз', 'Два', 'Три']);
  });

  test('пустой список не применяется', async ({ page }) => {
    await h.openApp(page);
    await h.setItems(page, ['Один', 'Два']);

    await page.locator('#items-input').fill('   \n  ');
    await page.locator('#apply-items').click();

    // Прежний список сохраняется, показывается подсказка
    await expect(page.locator('#counter')).toHaveText('2');
    await expect(page.locator('#toast')).toBeVisible();
  });

  test('список ограничен 30 вариантами', async ({ page }) => {
    await h.openApp(page);
    const many = Array.from({ length: 45 }, (_, i) => `Вариант ${i + 1}`);

    const editor = page.locator('#items-editor');
    await editor.locator('summary').click();
    await page.locator('#items-input').fill(many.join('\n'));
    await page.locator('#apply-items').click();

    await expect(page.locator('#counter')).toHaveText('30');
  });

  test('перемешивание сохраняет состав', async ({ page }) => {
    await h.openApp(page);
    const items = ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З'];
    await h.setItems(page, items);

    await page.locator('#shuffle').click();

    const after = await h.storedItems(page);
    expect(after).toHaveLength(items.length);
    expect([...after].sort()).toEqual([...items].sort());
  });

  test('история очищается', async ({ page }) => {
    await h.openApp(page);
    await h.setItems(page, ['А', 'Б']);
    await h.setDuration(page, 1);

    await h.spinAndWait(page);
    await h.decide(page, 'keep');
    await expect(page.locator('#history-count')).toHaveText('1');

    const history = page.locator('#history-box, .history-box').first();
    await history.locator('summary').click();
    await page.locator('#clear-history').click();

    await expect(page.locator('#history-count')).toHaveText('0');
  });

  test('экспорт отдаёт корректный JSON', async ({ page }) => {
    await h.openApp(page);
    await h.setItems(page, ['Экспорт1', 'Экспорт2']);

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#export').click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe('wheel-items.json');

    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));

    expect(parsed).toEqual(['Экспорт1', 'Экспорт2']);
  });

  test('пустое колесо не крутится', async ({ page }) => {
    // Пустой список задаём через URL — интерфейс его применить не даёт
    await h.openApp(page, { items: '' });

    await expect(page.locator('#counter')).toHaveText('0');
    await page.locator('#spin').click();

    // Диалог не появляется, кнопка остаётся активной
    await page.waitForTimeout(1500);
    await expect(page.locator('#decision-dialog')).toBeHidden();
    await expect(page.locator('#spin')).toBeEnabled();
  });
});
