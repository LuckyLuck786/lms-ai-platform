import { createApp } from './app';
import { env } from './config/env';
import { logger } from './utils/logger';
import { pool } from './db/pool';
import { redis } from './db/redis';
import { startWorkers } from './jobs/worker';
import { closeQueues, registerStreakCron } from './jobs/queues';

const app = createApp();

const server = app.listen(env.port, () => {
  logger.info('server_listening', { port: env.port, env: env.nodeEnv });
});

// Background jobs: inline in dev (single process), or run `npm run worker`
// in production to keep API instances free of queue consumers.
let workers: { close: () => Promise<void> } | null = null;
if (process.env.DISABLE_INLINE_WORKER !== '1') {
  workers = startWorkers();
  void registerStreakCron();
}

async function shutdown(signal: string): Promise<void> {
  logger.info('shutdown', { signal });
  server.close(async () => {
    await workers?.close().catch(() => undefined);
    await closeQueues().catch(() => undefined);
    await pool.end().catch(() => undefined);
    await redis.quit().catch(() => undefined);
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
