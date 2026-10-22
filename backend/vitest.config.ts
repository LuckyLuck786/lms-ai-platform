import { defineConfig } from 'vitest/config';

// Unit suite: no Postgres or Redis. Integration tests run separately with
// `npm run test:integration` (vitest.integration.config.ts).
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/integration/**', 'node_modules/**'],
  },
});
