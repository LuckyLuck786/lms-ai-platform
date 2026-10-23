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
    // Pin anything that could otherwise leak in from a developer's repo-root
    // .env: no real AI service, no real SMTP. dotenv never overrides a value
    // already present in the environment.
    env: {
      AI_SERVICE_URL: 'http://127.0.0.1:9',
      SMTP_URL: '',
      INTERNAL_API_TOKEN: '',
      RAZORPAY_KEY_ID: '',
      RAZORPAY_KEY_SECRET: '',
      RAZORPAY_WEBHOOK_SECRET: '',
      GOOGLE_CLIENT_ID: '',
      VIDEO_BUCKET: '',
      GCS_BUCKET: '',
    },
  },
});
