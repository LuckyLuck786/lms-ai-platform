import { defineConfig } from 'vitest/config';

// Unit suite: no Postgres or Redis. Integration tests run separately with
// `npm run test:integration` (vitest.integration.config.ts).
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/integration/**', 'node_modules/**'],
    // Never inherit real credentials from a developer's .env: tests that need
    // a key set one explicitly. dotenv does not override variables already set.
    env: {
      RAZORPAY_KEY_ID: '',
      RAZORPAY_KEY_SECRET: '',
      RAZORPAY_WEBHOOK_SECRET: '',
      SMTP_URL: '',
      GOOGLE_CLIENT_ID: '',
      VIDEO_BUCKET: '',
      GCS_BUCKET: '',
    },
  },
});
