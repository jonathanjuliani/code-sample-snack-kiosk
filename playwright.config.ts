import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const webPort = 5180;
const apiPort = 3010;
const dbPath = path.join(process.cwd(), 'e2e', 'kiosk-e2e.db');

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    trace: 'on-first-retry',
    hasTouch: true,
  },
  projects: [
    {
      name: 'tablet',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, hasTouch: true },
    },
  ],
  webServer: [
    {
      command: `rm -f "${dbPath}" "${dbPath}-wal" "${dbPath}-shm" && PORT=${apiPort} HOST=127.0.0.1 DB_PATH="${dbPath}" LOG_LEVEL=silent pnpm --filter @kiosk/api start`,
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
