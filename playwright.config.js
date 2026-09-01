// @ts-check
const { defineConfig, devices } = require('@playwright/test');

const PORT = 8000;
const BASE = `http://127.0.0.1:${PORT}`;

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Одна повторная попытка и локально: параллельные воркеры изредка
  // мешают друг другу общим localStorage, и это не регрессия продукта
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: BASE,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Колесо крутится до 20 секунд, поэтому действиям нужен запас
    actionTimeout: 10_000
  },

  // Вращение занимает реальное время — даём тестам достаточный лимит
  timeout: 60_000,
  expect: { timeout: 10_000 },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Разрешаем автоплей: иначе музыка не запустится и события
        // audio_blocked исказят проверки
        launchOptions: {
          args: ['--autoplay-policy=no-user-gesture-required']
        }
      }
    },
    {
      // Мобильная вёрстка и тач-взаимодействие. Локально — на WebKit
      // (ближе к реальному iOS), в CI — на мобильном Chromium: WebKit
      // на ubuntu-раннере не стартует, роняя весь прогон.
      name: 'mobile',
      use: process.env.CI
        ? {
            ...devices['Pixel 7'],
            launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] }
          }
        : {
            ...devices['iPhone 13'],
            launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] }
          }
    }
  ],

  webServer: {
    command: `python3 -m http.server ${PORT} --bind 127.0.0.1`,
    url: BASE,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000
  }
});
