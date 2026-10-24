import { browserOptions } from './tests/helpers/browser-config.js';
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    ...browserOptions(),
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node scripts/reader-extensions-browser-fixture.mjs',
      url: 'http://127.0.0.1:4178/health/ready',
      reuseExistingServer: false,
    },
    {
      command: 'node scripts/localized-browser-fixture.mjs',
      url: 'http://127.0.0.1:4177/health/ready',
      reuseExistingServer: false,
    },
    {
      command: 'node scripts/lifecycle-browser-fixture.mjs',
      url: 'http://127.0.0.1:4176/health/ready',
      reuseExistingServer: false,
    },
    {
      command: 'node scripts/mock-oauth.mjs',
      url: 'http://127.0.0.1:4020/health',
      reuseExistingServer: false,
    },
    {
      command:
        'node packages/cli/dist/main.js dev examples/components --trust-content --port 4174',
      url: 'http://127.0.0.1:4174/health/ready',
      reuseExistingServer: false,
    },
    {
      command:
        'node packages/cli/dist/main.js serve examples/demo/.doctopus/site --port 4173',
      url: 'http://127.0.0.1:4173/health/ready',
      reuseExistingServer: false,
    },
    {
      command: 'node scripts/mock-api.mjs',
      url: 'http://127.0.0.1:4010/v1/projects',
      reuseExistingServer: false,
    },
  ],
});
