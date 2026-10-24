import { browserOptions } from './tests/helpers/browser-config.js';
import { readFileSync } from 'node:fs';
import { defineConfig } from '@playwright/test';
const deployed = process.env.PAGES_DEMO_URL;
const site = deployed
  ? undefined
  : JSON.parse(readFileSync('.doctopus/pages-demo/site.json', 'utf8'));
const address = new URL(
  deployed ?? `http://127.0.0.1:4180${site.config.basePath}/`,
);
if (
  (address.protocol !== 'https:' &&
    !(address.protocol === 'http:' && address.hostname === '127.0.0.1')) ||
  address.username ||
  address.password ||
  address.search ||
  address.hash
)
  throw new Error('PAGES_DEMO_URL must be a credential-free HTTPS site URL.');
if (!address.pathname.endsWith('/')) address.pathname += '/';
export default defineConfig({
  testDir: './tests/pages',
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-pages-report', open: 'never' }],
  ],
  use: {
    baseURL: address.href,
    ...browserOptions(),
    trace: 'retain-on-failure',
    serviceWorkers: 'block',
  },
  ...(!deployed
    ? {
        webServer: {
          command: 'node scripts/pages-demo-browser-fixture.mjs',
          url: address.href,
          reuseExistingServer: false,
        },
      }
    : {}),
});
