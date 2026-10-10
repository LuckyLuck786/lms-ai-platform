import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

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

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProd: process.env.NODE_ENV === 'production',
  // PORT is injected by cloud hosts (Render sets $PORT); BACKEND_PORT is local.
  port: Number(process.env.PORT ?? process.env.BACKEND_PORT ?? 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',

  databaseUrl: required('DATABASE_URL', 'postgresql://lms:lms_dev_password@localhost:5432/lms'),
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  aiServiceUrl: process.env.AI_SERVICE_URL ?? 'http://localhost:8000',

  jwt: {
    secret: required('JWT_SECRET', 'dev-only-change-me-jwt-secret-32-chars-min'),
    refreshSecret: required('JWT_REFRESH_SECRET', 'dev-only-change-me-refresh-secret-32-chars'),
    accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    refreshTtlDays: Number(process.env.JWT_REFRESH_TTL_DAYS ?? 7),
  },

  s3: {
    endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
    region: process.env.S3_REGION ?? 'us-east-1',
    accessKey: process.env.S3_ACCESS_KEY ?? 'minioadmin',
    secretKey: process.env.S3_SECRET_KEY ?? 'minioadmin',
    bucket: process.env.S3_BUCKET ?? 'lms-media',
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
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

  rateLimits: {
    authPerMinute: Number(process.env.RATE_LIMIT_AUTH ?? 10),
    aiChatPerMinute: Number(process.env.RATE_LIMIT_AI_CHAT ?? 20),
    generalPerMinute: Number(process.env.RATE_LIMIT_GENERAL ?? 100),
  },
} as const;
