import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { resolveSecret } from './secrets';

/**
 * Locate the monorepo `.env` by walking up from the working directory.
 *
 * `npm run dev` runs with cwd=backend/, so the previous fixed `../../.env`
 * pointed one level *above* the repo and the file was never loaded — every
 * setting silently fell back to its dev default. Docker Compose and cloud
 * hosts inject real env vars, in which case no file is needed.
 */
function findEnvFile(): string | undefined {
  let dir = process.cwd();
  for (let depth = 0; depth < 4; depth += 1) {
    const candidate = path.join(dir, '.env');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

const envFile = process.env.DOTENV_PATH ?? findEnvFile();
if (envFile) dotenv.config({ path: envFile });
dotenv.config({ override: true }); // a service-local ./.env wins if present

/**
 * Read once, before `env` is built, so `resolveSecret` can enforce the
 * production rules while the object literal is still being constructed.
 */
const isProd = process.env.NODE_ENV === 'production';

// PORT is injected by cloud hosts (Render/Cloud Run set $PORT); BACKEND_PORT
// is local. `PORT=0` means "ask the OS for an ephemeral port", which is fine
// for listening but useless for building URLs — hence the 4000 fallback below.
const port = Number(process.env.PORT ?? process.env.BACKEND_PORT ?? 4000);
const listenPort = port || 4000;

/** Production-only: refuse to boot on a missing or placeholder secret. */
const secret = (name: string, devDefault: string): string =>
  resolveSecret(name, process.env[name], { isProd, devDefault });

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProd,
  port,
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',

  /**
   * Absolute origin of this API.
   *
   * The AI service cannot fetch a backend-relative `/uploads/...` path — it
   * runs as its own process and resolves URLs from its own origin. Anything
   * that hands a media URL to another service (transcription) needs this.
   */
  publicApiUrl: (process.env.PUBLIC_API_URL ?? `http://localhost:${listenPort}`).replace(
    /\/+$/,
    '',
  ),

  databaseUrl: secret('DATABASE_URL', 'postgresql://lms:lms_dev_password@localhost:5432/lms'),
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  aiServiceUrl: process.env.AI_SERVICE_URL ?? 'http://localhost:8000',

  // Shared secret presented to the AI service as `X-Internal-Token`. The AI
  // service stays private behind the backend; this is the code-level guard so
  // the RAG ingest route cannot be driven by a third party even if the
  // service is reachable. Empty means "not enforced" (local development).
  internalApiToken: process.env.INTERNAL_API_TOKEN ?? '',

  jwt: {
    // Production refuses the placeholders that ship in .env.example — see
    // config/secrets.ts. An unset secret in production means forgeable tokens,
    // so it fails the boot rather than starting quietly.
    secret: secret('JWT_SECRET', 'dev-only-change-me-jwt-secret-32-chars-min'),
    refreshSecret: secret('JWT_REFRESH_SECRET', 'dev-only-change-me-refresh-secret-32-chars'),
    accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    refreshTtlDays: Number(process.env.JWT_REFRESH_TTL_DAYS ?? 7),
  },

  // Column-level encryption of personal data (NFR §6). The encryption key
  // protects stored emails; the hash key builds the blind index used to look a
  // user up by email without decrypting every row. Losing either key makes
  // existing emails unreadable or unfindable — they live in Secret Manager.
  pii: {
    encryptionKey: secret('PII_ENCRYPTION_KEY', 'dev-only-pii-encryption-key-change-me'),
    hashKey: secret('PII_HASH_KEY', 'dev-only-pii-hash-key-change-me'),
  },

  // Durable object storage for uploaded material. When GCS_BUCKET is set the
  // storage driver writes to Google Cloud Storage using the runtime service
  // account (Application Default Credentials) instead of the container disk,
  // which Cloud Run wipes on every redeploy.
  gcs: {
    bucket: process.env.GCS_BUCKET ?? '',
  },

  smtp: {
    // Empty means "no SMTP configured" — email is logged dry-run instead of
    // failing. Mailpit locally (smtp://localhost:1025), any provider in prod.
    url: process.env.SMTP_URL ?? '',
    from: process.env.EMAIL_FROM ?? 'no-reply@vertexon.example',
    fromName: process.env.EMAIL_FROM_NAME ?? 'Vertexon LMS-AI',
    // Base URL used to build deep links inside transactional email.
    appUrl: process.env.APP_URL ?? process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  },

  razorpay: {
    // Test-mode keys for development; swap for live keys in production.
    // The webhook secret is used to verify incoming payment webhooks.
    keyId: process.env.RAZORPAY_KEY_ID ?? '',
    keySecret: process.env.RAZORPAY_KEY_SECRET ?? '',
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? '',
  },

  rateLimits: {
    authPerMinute: Number(process.env.RATE_LIMIT_AUTH ?? 10),
    aiChatPerMinute: Number(process.env.RATE_LIMIT_AI_CHAT ?? 20),
    generalPerMinute: Number(process.env.RATE_LIMIT_GENERAL ?? 100),
  },
} as const;
