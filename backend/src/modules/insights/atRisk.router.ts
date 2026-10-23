import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth';
import { query, queryOne } from '../../db/pool';
import { conflict, notFound } from '../../utils/errors';
import { getOwnedCourse } from '../courses/courses.service';
import { queueEmail } from '../../jobs/queues';
import { decryptPii } from '../../utils/pii';

/**
 * At-risk learner alerts for instructors.
 *
 * A learner is flagged when any of these holds (thresholds below):
 *   - inactive:   no lecture progress or quiz submission for 7+ days
 *   - low_scores: average quiz score under 50 % (at least one attempt)
 *   - stalled:    enrolled 14+ days and still under 25 % progress
 * Finished learners (100 %) are never flagged. Each flag is explained to the
 * instructor, who can nudge the learner (in-app + email, once per 24 hours).
 */
export const atRiskRouter = Router();

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

export const RISK = { inactiveDays: 7, lowScore: 50, stalledDays: 14, stalledProgress: 25 } as const;

export interface LearnerSignals {
  progress: number;
  daysInactive: number;
  daysEnrolled: number;
  avgScore: number | null;
}

/** Pure, so the thresholds are unit-testable. */
export function riskReasons(s: LearnerSignals): string[] {
  if (s.progress >= 100) return [];
  const reasons: string[] = [];
  if (s.daysInactive >= RISK.inactiveDays) reasons.push('inactive');
  if (s.avgScore !== null && s.avgScore < RISK.lowScore) reasons.push('low_scores');
  if (s.daysEnrolled >= RISK.stalledDays && s.progress < RISK.stalledProgress) reasons.push('stalled');
  return reasons;
}

atRiskRouter.get(
  '/courses/:id/at-risk',
  authenticate,
  requireRole('instructor', 'admin'),
  wrap(async (req, res) => {
    await getOwnedCourse(req.params.id, req.user!);
    const rows = await query<{
      user_id: string;
      full_name: string;
      progress: string;
      enrolled_at: Date;
      last_active: Date;
      avg_score: string | null;
      attempts: number;
      last_nudged_at: Date | null;
    }>(
      `SELECT u.id AS user_id, u.full_name, e.progress_percent AS progress, e.enrolled_at,
              GREATEST(e.enrolled_at,
                (SELECT max(lp.last_watched_at) FROM lecture_progress lp WHERE lp.enrollment_id = e.id),
                (SELECT max(qa.submitted_at) FROM quiz_attempts qa
                   JOIN quizzes z ON z.id = qa.quiz_id JOIN modules m ON m.id = z.module_id
                  WHERE qa.user_id = u.id AND m.course_id = e.course_id)) AS last_active,
              (SELECT avg(qa.score) FROM quiz_attempts qa
                 JOIN quizzes z ON z.id = qa.quiz_id JOIN modules m ON m.id = z.module_id
                WHERE qa.user_id = u.id AND m.course_id = e.course_id AND qa.submitted_at IS NOT NULL) AS avg_score,
              (SELECT count(*)::int FROM quiz_attempts qa
                 JOIN quizzes z ON z.id = qa.quiz_id JOIN modules m ON m.id = z.module_id
                WHERE qa.user_id = u.id AND m.course_id = e.course_id AND qa.submitted_at IS NOT NULL) AS attempts,
              (SELECT max(n.created_at) FROM learner_nudges n
                WHERE n.user_id = u.id AND n.course_id = e.course_id) AS last_nudged_at
       FROM enrollments e JOIN users u ON u.id = e.user_id
       WHERE e.course_id = $1 AND u.is_active AND u.deleted_at IS NULL`,
      [req.params.id],
    );
    const now = Date.now();
    const day = 86_400_000;
    const items = rows
      .map((r) => {
        const signals: LearnerSignals = {
          progress: Number(r.progress),
          daysInactive: Math.floor((now - new Date(r.last_active).getTime()) / day),
          daysEnrolled: Math.floor((now - new Date(r.enrolled_at).getTime()) / day),
          avgScore: r.avg_score === null ? null : Math.round(Number(r.avg_score)),
        };
        return {
          user_id: r.user_id,
          full_name: r.full_name,
          ...signals,
          quiz_attempts: r.attempts,
          last_active: r.last_active,
          last_nudged_at: r.last_nudged_at,
          reasons: riskReasons(signals),
        };
      })
      .filter((r) => r.reasons.length > 0)
      .sort((a, b) => b.reasons.length - a.reasons.length || b.daysInactive - a.daysInactive);
    res.json({ items, enrolled: rows.length, thresholds: RISK });
  }),
);

const nudgeSchema = z.object({ message: z.string().trim().min(5).max(1000) });

atRiskRouter.post(
  '/courses/:id/learners/:userId/nudge',
  authenticate,
  requireRole('instructor', 'admin'),
  wrap(async (req, res) => {
    const course = await getOwnedCourse(req.params.id, req.user!);
    const { message } = nudgeSchema.parse(req.body);
    const learner = await queryOne<{ email: string; full_name: string; title: string }>(
      `SELECT u.email, u.full_name, c.title FROM enrollments e
       JOIN users u ON u.id = e.user_id JOIN courses c ON c.id = e.course_id
       WHERE e.course_id = $1 AND e.user_id = $2 AND u.is_active`,
      [course.id, req.params.userId],
    );
    if (!learner) throw notFound('Learner is not enrolled in this course');
    const recent = await queryOne(
      `SELECT 1 FROM learner_nudges WHERE course_id = $1 AND user_id = $2 AND created_at > now() - interval '24 hours'`,
      [course.id, req.params.userId],
    );
    if (recent) throw conflict('This learner was already nudged in the last 24 hours');

    await query('INSERT INTO learner_nudges (course_id, user_id, sent_by, message) VALUES ($1, $2, $3, $4)', [
      course.id,
      req.params.userId,
      req.user!.id,
      message,
    ]);
    await query('INSERT INTO notifications (user_id, title, body) VALUES ($1, $2, $3)', [
      req.params.userId,
      `A note from your instructor in ${learner.title}`,
      message,
    ]);
    await queueEmail({
      kind: 'announcement',
      subject: `A note from your instructor in “${learner.title}”`,
      body: `Hi ${learner.full_name},\n\n${message}`,
      recipients: [decryptPii(learner.email)],
      cta: { label: 'Continue the course', path: `/catalog/${course.id}` },
    });
    res.status(201).json({ nudged: true });
  }),
);
