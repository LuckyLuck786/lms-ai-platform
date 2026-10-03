import { Worker, Job } from 'bullmq';
import nodemailer from 'nodemailer';
import { query, queryOne } from '../db/pool';
import { generateCertificatePdf } from '../utils/certificate';
import { evaluateAllStreaks } from '../modules/gamification/gamification.service';
import { EmailJob, queueConnection } from './queues';
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

      const user = await queryOne<{ full_name: string }>('SELECT full_name FROM users WHERE id = $1', [userId]);
      const course = await queryOne<{ title: string }>('SELECT title FROM courses WHERE id = $1', [courseId]);
      if (!user || !course) return { skipped: true };

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
    async (job: Job<EmailJob>) => {
      const { subject, body, recipients, kind } = job.data;
      if (!recipients.length) return { skipped: true };

      const smtpUrl = process.env.SMTP_URL;
      if (!smtpUrl) {
        logger.info('email_dry_run', { kind, subject, recipients: recipients.length });
        return { dry_run: true };
      }

      const transporter = nodemailer.createTransport(smtpUrl);
      await transporter.sendMail({
        from: process.env.EMAIL_FROM ?? 'no-reply@vertexon.example',
        to: recipients.join(','),
        subject,
        text: body,
      });
      logger.info('email_sent', { kind, subject, recipients: recipients.length });
      return { sent: recipients.length };
    },
    { connection: queueConnection(), concurrency: 2 },
  );

  for (const [name, w] of [
    ['certificates', certificateWorker],
    ['streaks', streakWorker],
    ['notifications', notificationWorker],
  ] as const) {
    w.on('failed', (job, err) => {
      logger.error('job_failed', { queue: name, jobId: job?.id, error: err.message });
    });
  }

  logger.info('workers_started', { queues: ['certificates', 'streaks'] });

  return {
    close: async () => {
      await Promise.all([certificateWorker.close(), streakWorker.close()]);
    },
  };
}
