import { defineConfig, devices } from '@playwright/test';

const webPort = 5180;
const apiPort = 3010;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  retries: 0,
  timeout: 45_000,
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'tablet', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: [
    {
      command: `PORT=${apiPort} HOST=127.0.0.1 DB_PATH=:memory: LOG_LEVEL=silent pnpm --filter @kiosk/api start`,
      url: `http://127.0.0.1:${apiPort}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `API_URL=http://127.0.0.1:${apiPort} pnpm --filter @kiosk/web exec vite --host 127.0.0.1 --port ${webPort}`,
      url: `http://127.0.0.1:${webPort}`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
