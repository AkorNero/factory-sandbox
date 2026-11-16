import { defineConfig, devices } from '@playwright/test';

/**
 * Seam 3, sync smoke tests: two browser contexts are two devices. They need the real compose stack
 * (Postgres + PowerSync + API serving the built PWA):
 *
 *   docker compose -f infra/compose.yaml up -d --build
 *   npm run test:e2e:sync          # SYNC_BASE_URL defaults to http://127.0.0.1:8080
 *
 * COMPOSE_PROJECT_NAME (default "dayplanner") tells the tests which Postgres container to ask.
 */
export default defineConfig({
  testDir: 'e2e',
  testMatch: /sync\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  use: {
    baseURL: process.env.SYNC_BASE_URL ?? 'http://127.0.0.1:8080',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }],
});
