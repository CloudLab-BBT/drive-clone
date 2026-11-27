import { defineConfig } from '@playwright/test';

const stateDir = process.env.E2E_STATE_DIR ?? '/tmp/drive-clone-e2e-state';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [
    ['json', { outputFile: 'reports/e2e/results.json' }],
    ['html', { outputFolder: 'reports/e2e/html', open: 'never' }],
  ],
  outputDir: 'reports/e2e/artifacts',
  use: {
    baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:8080',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  metadata: { stateDir },
});
