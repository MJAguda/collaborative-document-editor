import { defineConfig, devices } from '@playwright/test';

// Starts its own server on a throwaway in-memory database: never point this at the deployed URL.
export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  use: { baseURL: 'http://localhost:3100', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && PORT=3100 DB_PATH=:memory: node server/index.ts',
    url: 'http://localhost:3100/',
    reuseExistingServer: false,
  },
});
