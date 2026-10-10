import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import type { EmailCta, EmailKind } from '../services/email';

/**
 * Background job queues (PRD §9.3): Redis + BullMQ.
 *  - certificates: generated when a learner hits 100% course completion
 *  - notifications: transactional email dispatch (SMTP)
 *  - streaks: daily cron evaluating broken streaks platform-wide
 */

// BullMQ requires maxRetriesPerRequest: null on its shared connection.
export const queueConnection = () =>
  new IORedis(env.redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: false });

let certificateQueue: Queue | null = null;
let streakQueue: Queue | null = null;
let notificationQueue: Queue | null = null;
let masteryQueue: Queue | null = null;

export interface EmailJob {
  kind: EmailKind;
  subject: string;
  body: string;
  recipients: string[];
  cta?: EmailCta;
}

function getCertificateQueue(): Queue {
  certificateQueue ??= new Queue('certificates', { connection: queueConnection() });
  return certificateQueue;
}

function getStreakQueue(): Queue {
  streakQueue ??= new Queue('streaks', { connection: queueConnection() });
  return streakQueue;
}

export async function queueCertificate(payload: { userId: string; courseId: string }): Promise<void> {
  try {
    await getCertificateQueue().add('issue', payload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: 100,
    });
  } catch (err) {
    logger.warn('certificate_queue_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function queueEmail(payload: EmailJob): Promise<void> {
  try {
    await getNotificationQueue().add('email', payload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: 100,
    });
  } catch (err) {
    logger.warn('email_queue_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function getNotificationQueue(): Queue {
  notificationQueue ??= new Queue('notifications', { connection: queueConnection() });
  return notificationQueue;
}

function getMasteryQueue(): Queue {
  masteryQueue ??= new Queue('mastery', { connection: queueConnection() });
  return masteryQueue;
}

/**
 * Recompute a learner's topic-mastery rows (FR-A8). Jobs are deduplicated by
 * user+course so a burst of chat/quiz events collapses into one recompute.
 */
export async function queueMasteryRecompute(payload: {
  userId: string;
  courseId: string;
}): Promise<void> {
  try {
    await getMasteryQueue().add('recompute', payload, {
      jobId: `${payload.userId}:${payload.courseId}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: 100,
    });
  } catch (err) {
    logger.warn('mastery_queue_failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Registers the daily streak-evaluation cron (idempotent). */
export async function registerStreakCron(): Promise<void> {
  try {
    // BullMQ v6: repeating jobs are expressed as job schedulers.
    await getStreakQueue().upsertJobScheduler(
      'streak-evaluation-daily',
      { pattern: '0 3 * * *' }, // 03:00 UTC daily
      { name: 'evaluate-daily', data: {} },
    );
    logger.info('streak_cron_registered');
  } catch (err) {
    logger.warn('streak_cron_failed', { error: err instanceof Error ? err.message : String(err) });
  }
}

export async function closeQueues(): Promise<void> {
  await Promise.all([
    certificateQueue?.close(),
    streakQueue?.close(),
    notificationQueue?.close(),
    masteryQueue?.close(),
  ]);
}
