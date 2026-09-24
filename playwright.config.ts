import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: 'browser.spec.ts', workers: 1, timeout: 30_000,
  use: { browserName: 'chromium', headless: true, viewport: { width: 1440, height: 1000 }, launchOptions: { executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] } },
});
