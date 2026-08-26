// @ts-check
const { test, expect } = require('@playwright/test');
const h = require('./helpers');

test.describe('Колесо', () => {
  test.beforeEach(async ({ page }) => {
    await h.resetStorage(page);
  });

  test('страница открывается со списком по умолчанию', async ({ page }) => {
    await h.openApp(page);

    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('#wheel')).toBeVisible();
    await expect(page.locator('#spin')).toBeEnabled();
    // Дефолтный список — шесть вариантов
    await expect(page.locator('#counter')).toHaveText('6');
  });

  test('розыгрыш доходит до конца и открывает диалог', async ({ page }) => {
    await h.openApp(page);
    await h.setItems(page, ['Один', 'Два', 'Три']);
    await h.setDuration(page, 1);

    const winner = await h.spinAndWait(page);

    // Победитель — один из вариантов списка, а не пустая строка
    expect(['Один', 'Два', 'Три']).toContain(winner?.trim());
    await expect(page.locator('#result-text')).toHaveText(winner?.trim() || '');
  });

  test('во время вращения кнопка заблокирована', async ({ page }) => {
    await h.openApp(page);
    await h.setItems(page, ['А', 'Б', 'В']);
    await h.setDuration(page, 3);

    await page.locator('#spin').click();
    await expect(page.locator('#spin')).toBeDisabled();
    // Ползунок длительности тоже блокируется, чтобы не менять на лету
    await expect(page.locator('#duration')).toBeDisabled();

    await expect(page.locator('#decision-dialog')).toBeVisible({ timeout: 30_000 });
    await h.decide(page, 'keep');
    await expect(page.locator('#spin')).toBeEnabled();
  });

  test('клик по колесу тоже запускает вращение', async ({ page }) => {
    await h.openApp(page);
    await h.setItems(page, ['А', 'Б']);
    await h.setDuration(page, 1);

    // Кликаем ближе к центру: углы квадратного canvas перекрыты обёрткой,
    // а центральную «шляпку» колеса делает некликабельной pointer-events: none
    await page.locator('#wheel').click({ position: { x: 200, y: 200 } });
    await expect(page.locator('#decision-dialog')).toBeVisible({ timeout: 30_000 });
  });

  test('пробел запускает вращение', async ({ page }) => {
    await h.openApp(page);
    await h.setItems(page, ['А', 'Б']);
    await h.setDuration(page, 1);

    // Снимаем фокус с редактора: пробел намеренно игнорируется, пока
    // курсор в поле ввода, иначе он крутил бы колесо вместо набора текста
    await page.locator('h1').click();
    await page.keyboard.press('Space');
    await expect(page.locator('#decision-dialog')).toBeVisible({ timeout: 30_000 });
  });

  test('длительность влияет на реальное время вращения', async ({ page }) => {
    await h.openApp(page);
    await h.setItems(page, ['А', 'Б', 'В']);
    await h.setDuration(page, 2);

    const started = Date.now();
    await h.spinAndWait(page);
    const elapsed = Date.now() - started;

    // 2 секунды вращения + 650 мс до диалога; сверху даём запас
    expect(elapsed).toBeGreaterThanOrEqual(2000);
    expect(elapsed).toBeLessThan(12_000);
  });

  test('результат попадает в историю', async ({ page }) => {
    await h.openApp(page);
    await h.setItems(page, ['Альфа', 'Бета']);
    await h.setDuration(page, 1);

    const winner = (await h.spinAndWait(page))?.trim();
    await h.decide(page, 'keep');

    await expect(page.locator('#history-count')).toHaveText('1');

    const history = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('wof.history') || '[]'));
    expect(history[0].name).toBe(winner);
  });
});

test.describe('Диалог после розыгрыша', () => {
  test.beforeEach(async ({ page }) => {
    await h.resetStorage(page);
  });

  test('«удалить» убирает победителя из списка', async ({ page }) => {
    await h.openApp(page);
    await h.setItems(page, ['Раз', 'Два', 'Три', 'Четыре']);
    await h.setDuration(page, 1);

    const winner = (await h.spinAndWait(page))?.trim();
    await h.decide(page, 'remove');

    await expect(page.locator('#counter')).toHaveText('3');
    const items = await h.storedItems(page);
    expect(items).toHaveLength(3);
    expect(items).not.toContain(winner);
  });

  test('«оставить» не меняет список', async ({ page }) => {
    await h.openApp(page);
    await h.setItems(page, ['Раз', 'Два', 'Три']);
    await h.setDuration(page, 1);

    await h.spinAndWait(page);
    await h.decide(page, 'keep');

    await expect(page.locator('#counter')).toHaveText('3');
    expect(await h.storedItems(page)).toHaveLength(3);
  });

  test('последний вариант удалить нельзя', async ({ page }) => {
    await h.openApp(page);
    await h.setItems(page, ['Единственный']);
    await h.setDuration(page, 1);

    await h.spinAndWait(page);

    await expect(page.locator('#remove-btn')).toBeDisabled();
    await expect(page.locator('#decision-hint')).not.toBeEmpty();
  });

  test('Escape закрывает диалог, список не меняется', async ({ page }) => {
    await h.openApp(page);
    await h.setItems(page, ['Раз', 'Два', 'Три']);
    await h.setDuration(page, 1);

    await h.spinAndWait(page);
    await page.keyboard.press('Escape');

    await expect(page.locator('#decision-dialog')).toBeHidden();
    await expect(page.locator('#counter')).toHaveText('3');
  });
});
