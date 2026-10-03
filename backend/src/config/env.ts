import dotenv from 'dotenv';
dotenv.config({ path: process.env.DOTENV_PATH ?? '../../.env' });
dotenv.config(); // local backend/.env overrides

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
  port: Number(process.env.BACKEND_PORT ?? 4000),
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

  rateLimits: {
    authPerMinute: Number(process.env.RATE_LIMIT_AUTH ?? 10),
    aiChatPerMinute: Number(process.env.RATE_LIMIT_AI_CHAT ?? 20),
    generalPerMinute: Number(process.env.RATE_LIMIT_GENERAL ?? 100),
  },
} as const;
