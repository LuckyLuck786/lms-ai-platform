import { Worker, Job } from 'bullmq';
import { query, queryOne } from '../db/pool';
import { generateCertificatePdf } from '../utils/certificate';
import { evaluateAllStreaks } from '../modules/gamification/gamification.service';
import { EmailJob, queueConnection, queueEmail } from './queues';
import { recomputeTopicMasterySafe } from '../utils/mastery';
import { closeEmailTransport, sendEmail } from '../services/email';
import { logger } from '../utils/logger';

/**
 * Background workers (PRD §9.3): certificate PDF generation + daily streak
 * evaluation. Run in-process during dev, or standalone via `npm run worker`.
 */

export function startWorkers(): { close: () => Promise<void> } {
  const certificateWorker = new Worker(
    'certificates',
    async (job: Job<{ userId: string; courseId: string }>) => {
      const { userId, courseId } = job.data;

      const cert = await queryOne<{ id: string }>(
        'SELECT id FROM certificates WHERE user_id = $1 AND course_id = $2 AND certificate_url IS NULL',
        [userId, courseId],
      );
      if (!cert) return { skipped: true };

      const user = await queryOne<{ full_name: string; email: string }>(
        'SELECT full_name, email FROM users WHERE id = $1',
        [userId],
      );
      const course = await queryOne<{ title: string }>('SELECT title FROM courses WHERE id = $1', [courseId]);
      if (!user || !course) return { skipped: true };
      const student = user; // named for readability in the email step below

      const filePath = await generateCertificatePdf({
        certificateId: cert.id,
        studentName: user.full_name,
        courseTitle: course.title,
        issuedAt: new Date(),
      });

      await query('UPDATE certificates SET certificate_url = $2 WHERE id = $1', [cert.id, filePath]);
      await query(
        'INSERT INTO notifications (user_id, title, body) VALUES ($1, $2, $3)',
        [userId, 'Certificate issued! 🎓', `You completed “${course.title}”. Your certificate is ready.`],
      );

      // Email the learner too — a certificate is worth an inbox notification.
      await queueEmail({
        kind: 'certificate',
        subject: `Your certificate for “${course.title}” is ready`,
        body:
          `Congratulations ${user.full_name}! You completed “${course.title}”.\n\n` +
          'Your certificate PDF is available on your dashboard.',
        recipients: [student.email],
        cta: { label: 'View certificate', path: '/dashboard' },
      });

      logger.info('certificate_generated', { certificate_id: cert.id, user_id: userId });
      return { certificateId: cert.id, filePath };
    },
    { connection: queueConnection(), concurrency: 2 },
  );

  const streakWorker = new Worker(
    'streaks',
    async () => {
      const reset = await evaluateAllStreaks();
      return { reset };
    },
    { connection: queueConnection(), concurrency: 1 },
  );

  // Email dispatch (PRD §9.3): real SMTP when SMTP_URL is configured,
  // structured dry-run log otherwise so local demos stay functional.
  const notificationWorker = new Worker(
    'notifications',
    async (job: Job<EmailJob>) => sendEmail(job.data),
    { connection: queueConnection(), concurrency: 2 },
  );

  // Topic-mastery recompute (FR-A8, PRD §9.2 step 5): runs after quiz
  // submissions, lecture completions and AI-tutor interactions.
  const masteryWorker = new Worker(
    'mastery',
    async (job: Job<{ userId: string; courseId: string }>) => {
      const { userId, courseId } = job.data;
      await recomputeTopicMasterySafe(userId, courseId);
      return { user_id: userId, course_id: courseId };
    },
    { connection: queueConnection(), concurrency: 2 },
  );

  for (const [name, w] of [
    ['certificates', certificateWorker],
    ['streaks', streakWorker],
    ['notifications', notificationWorker],
    ['mastery', masteryWorker],
  ] as const) {
    w.on('failed', (job, err) => {
      logger.error('job_failed', { queue: name, jobId: job?.id, error: err.message });
    });
  }

  logger.info('workers_started', {
    queues: ['certificates', 'streaks', 'notifications', 'mastery'],
  });

  return {
    close: async () => {
      await Promise.all([
        certificateWorker.close(),
        streakWorker.close(),
        notificationWorker.close(),
        masteryWorker.close(),
        closeEmailTransport(),
      ]);
    },
  };
}
