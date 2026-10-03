import { startWorkers } from './worker';
import { registerStreakCron } from './queues';
import { logger } from '../utils/logger';

/** Standalone worker process: `npm run worker`. */
async function main(): Promise<void> {
  const workers = startWorkers();
  await registerStreakCron();
  logger.info('worker_process_ready');

  const shutdown = async () => {
    await workers.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

void main();
