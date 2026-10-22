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
 *  - recommendations: nightly cron recomputing every learner's suggestions
 */

// BullMQ requires maxRetriesPerRequest: null on its shared connection.
export const queueConnection = () =>
  new IORedis(env.redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: false });

let certificateQueue: Queue | null = null;
let streakQueue: Queue | null = null;
let notificationQueue: Queue | null = null;
let masteryQueue: Queue | null = null;
let transcriptionQueue: Queue | null = null;
let recommendationQueue: Queue | null = null;

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

function getTranscriptionQueue(): Queue {
  transcriptionQueue ??= new Queue('transcription', { connection: queueConnection() });
  return transcriptionQueue;
}

/**
 * Ask the AI service to transcribe an uploaded lecture video (PRD §9.3).
 *
 * Ingestion is only reachable once a transcript exists, so this is the step
 * that decides whether uploaded video is searchable by the AI tutor. Jobs are
 * deduplicated by lecture: re-uploading a file must not start two Whisper
 * calls for the same row.
 */
export async function queueTranscription(payload: {
  lectureId: string;
  mediaUrl?: string;
}): Promise<void> {
  try {
    await getTranscriptionQueue().add('transcribe', payload, {
      jobId: `transcribe:${payload.lectureId}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: 100,
      removeOnFail: 100,
    });
    logger.info('transcription_queued', { lecture_id: payload.lectureId });
  } catch (err) {
    logger.warn('transcription_queue_failed', {
      lecture_id: payload.lectureId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function getRecommendationQueue(): Queue {
  recommendationQueue ??= new Queue('recommendations', { connection: queueConnection() });
  return recommendationQueue;
}

/**
 * Registers the nightly recommendation recalculation (PRD §9.3, idempotent).
 * Runs at 02:00 UTC, an hour ahead of the streak job, so the two batch scans
 * never compete for the database.
 */
export async function registerRecommendationCron(): Promise<void> {
  try {
    await getRecommendationQueue().upsertJobScheduler(
      'recommendations-nightly',
      { pattern: '0 2 * * *' },
      { name: 'recompute-all', data: {} },
    );
    logger.info('recommendation_cron_registered');
  } catch (err) {
    logger.warn('recommendation_cron_failed', {
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
    transcriptionQueue?.close(),
    recommendationQueue?.close(),
  ]);
}
