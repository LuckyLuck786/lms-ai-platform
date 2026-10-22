import { defineConfig } from 'vitest/config';

// Integration suite: a real Postgres (pgvector) and Redis, migrated and seeded
// from scratch by the global setup. Never point it at a shared database.
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.int.test.ts'],
    globalSetup: ['tests/integration/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
