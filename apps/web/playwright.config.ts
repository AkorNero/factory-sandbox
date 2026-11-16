import { defineConfig, devices } from '@playwright/test';

// Set E2E_PORT to run e2e in several worktrees at once.
const E2E_PORT = Number(process.env.E2E_PORT ?? 4173);

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
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
    serviceWorkers: 'block',
    timezoneId: 'Europe/Berlin',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `npm run build -- --mode test && npm run preview -- --port ${E2E_PORT} --strictPort --mode test`,
    env: { VITE_SYNC: 'off' },
    url: `http://127.0.0.1:${E2E_PORT}`,
    // Never reuse: another worktree's server on this port would run its code.
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
