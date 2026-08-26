// @ts-check
const { expect } = require('@playwright/test');

/**
 * Открыть сайт с чистым состоянием.
 * Аналитику отключаем через ?analytics=off, чтобы тесты не засоряли
 * боевую статистику и не зависели от доступности коллектора.
 */
async function openApp(page, params = {}) {
  const qs = new URLSearchParams({ analytics: 'off', ...params }).toString();
  await page.goto(`/?${qs}`);
  await expect(page.locator('#spin')).toBeVisible();
  // Ждём первую отрисовку колеса, иначе клики уходят в пустоту
  await page.waitForFunction(() => document.querySelector('canvas#wheel') !== null);
}

/** Полностью очистить сохранённое состояние между тестами. */
async function resetStorage(page) {
  await page.goto('/?analytics=off');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
}

/** Задать список вариантов через редактор. */
async function setItems(page, items) {
  const editor = page.locator('#items-editor');
  if (!(await editor.evaluate((el) => el.hasAttribute('open')))) {
    await editor.locator('summary').click();
  }
  await page.locator('#items-input').fill(items.join('\n'));
  await page.locator('#apply-items').click();
  await expect(page.locator('#counter')).toHaveText(String(items.length));
}

/** Выставить длительность вращения (ползунок 1–20 секунд). */
async function setDuration(page, seconds) {
  await page.locator('#duration').fill(String(seconds));
  // Ползунок сохраняется по событию change, которое fill не всегда шлёт
  await page.locator('#duration').dispatchEvent('change');
}

/**
 * Крутить колесо и дождаться результата.
 * Диалог выбора открывается через 650 мс после остановки.
 */
async function spinAndWait(page) {
  await page.locator('#spin').click();
  await expect(page.locator('#decision-dialog')).toBeVisible({ timeout: 40_000 });
  return page.locator('#decision-name').textContent();
}

/** Ответить в диалоге после розыгрыша. */
async function decide(page, choice) {
  const button = choice === 'remove'
    ? page.locator('#remove-btn')
    : page.locator('.decision-dialog__keep');
  await button.click();
  await expect(page.locator('#decision-dialog')).toBeHidden();
}

/** Прочитать список вариантов из localStorage. */
function storedItems(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('wof.items') || '[]'));
}

/** Прочитать настройки из localStorage. */
function storedSettings(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('wof.settings') || '{}'));
}

/** Разобрать текущую строку запроса. */
function queryParams(page) {
  return page.evaluate(() =>
    Object.fromEntries(new URLSearchParams(location.search).entries()));
}

module.exports = {
  openApp, resetStorage, setItems, setDuration,
  spinAndWait, decide, storedItems, storedSettings, queryParams
};
