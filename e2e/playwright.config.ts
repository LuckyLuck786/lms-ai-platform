import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end suite (PRD §16.2): the built SPA against a real backend, Postgres
 * and Redis. BASE_URL is the frontend origin; it must be a local or CI stack
 * seeded with `npm run seed`, never production — the tests log in with the
 * seeded demo accounts and enrol users.
 */
export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
