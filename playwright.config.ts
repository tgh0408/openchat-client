import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test',
  outputDir: './test-results',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  timeout: 30_000,
  webServer: {
    command: 'npm run dev:web -- --port 5175',
    url: 'http://127.0.0.1:5175',
    reuseExistingServer: false,
  },
});
