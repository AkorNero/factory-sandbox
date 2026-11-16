import { defineConfig, devices } from '@playwright/test';

/**
 * Seam 3, smoke tests with no server: sync is off (VITE_SYNC=off), so only the built app is needed.
 * Everything runs at a fixed clock and timezone.
 */
export default defineConfig({
  testDir: 'e2e',
  testIgnore: /sync\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    serviceWorkers: 'block',
    timezoneId: 'Europe/Berlin',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npm run build -- --mode test && npm run preview -- --port 4173 --strictPort --mode test',
    env: { VITE_SYNC: 'off' },
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
