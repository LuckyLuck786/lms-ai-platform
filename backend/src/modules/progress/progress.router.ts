import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth';
import { query, queryOne, withTransaction } from '../../db/pool';
import { badRequest, forbidden, notFound } from '../../utils/errors';
import { touchStreak } from '../gamification/gamification.service';
import { awardBadge } from '../../utils/badges';
import { queueCertificate, queueMasteryRecompute } from '../../jobs/queues';
import { logger } from '../../utils/logger';

/**
 * Lecture progress, notes and bookmarks (PRD §8.3, FR-S4/S5).
 */

export const progressRouter = Router();

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

async function requireEnrollment(userId: string, lectureId: string) {
  const row = await queryOne<{ enrollment_id: string; course_id: string; course_title: string }>(
    `SELECT e.id AS enrollment_id, c.id AS course_id, c.title AS course_title
     FROM lectures l
     JOIN modules m ON m.id = l.module_id
     JOIN courses c ON c.id = m.course_id
     JOIN enrollments e ON e.course_id = c.id AND e.user_id = $1
     WHERE l.id = $2`,
    [userId, lectureId],
  );
  if (!row) throw forbidden('You are not enrolled in this course');
  return row;
}

const progressSchema = z.object({
  watched_seconds: z.coerce.number().int().min(0),
  completed: z.boolean().optional(),
});

/**
 * POST /lectures/:id/progress — upsert watched-seconds, mark complete,
 * recompute enrollment progress, trigger certificate at 100%.
 */
progressRouter.post(
  '/lectures/:id/progress',
  authenticate,
  wrap(async (req, res) => {
    const input = progressSchema.parse(req.body);
    const { enrollment_id, course_id } = await requireEnrollment(req.user!.id, req.params.id);

    const lecture = await queryOne<{ duration_seconds: number | null }>(
      'SELECT duration_seconds FROM lectures WHERE id = $1',
      [req.params.id],
    );
    const duration = lecture?.duration_seconds ?? 0;
    // Complete at 90% watched (or explicit completion for text lectures).
    const completed =
      input.completed === true ||
      (duration > 0 && input.watched_seconds >= Math.floor(duration * 0.9));

    const result = await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO lecture_progress (enrollment_id, lecture_id, watched_seconds, completed, last_watched_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT DO NOTHING`,
        [enrollment_id, req.params.id, input.watched_seconds, completed],
      );
      // Never regress: keep max watched_seconds / completed.
      await client.query(
        `UPDATE lecture_progress
         SET watched_seconds = GREATEST(watched_seconds, $3),
             completed = lecture_progress.completed OR $4,
             last_watched_at = now()
         WHERE enrollment_id = $1 AND lecture_id = $2`,
        [enrollment_id, req.params.id, input.watched_seconds, completed],
      );

      const totals = await client.query<{ total: number; done: number }>(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE lp.completed)::int AS done
         FROM lectures l
         JOIN modules m ON m.id = l.module_id
         JOIN lecture_progress lp ON lp.lecture_id = l.id AND lp.enrollment_id = $1
         WHERE m.course_id = $2`,
        [enrollment_id, course_id],
      );
      const { total, done } = totals.rows[0];
      const percent = total > 0 ? Math.round((done / total) * 10000) / 100 : 0;

      await client.query('UPDATE enrollments SET progress_percent = $2 WHERE id = $1', [
        enrollment_id,
        percent,
      ]);
      return { percent, total, done };
    });

    await touchStreak(req.user!.id);

    // FR-A8: a completed lecture moves the module's completion component.
    if (completed) {
      await queueMasteryRecompute({ userId: req.user!.id, courseId: course_id });
    }

    // FR-S8: certificate auto-generated at 100% module/course completion.
    if (result.percent >= 100) {
      const existing = await queryOne(
        'SELECT id FROM certificates WHERE user_id = $1 AND course_id = $2',
        [req.user!.id, course_id],
      );
      if (!existing) {
        await query('INSERT INTO certificates (user_id, course_id) VALUES ($1, $2)', [
          req.user!.id,
          course_id,
        ]);
        await queueCertificate({ userId: req.user!.id, courseId: course_id });
        await awardBadge(req.user!.id, 'first_course_completed');
        logger.info('certificate_queued', { user_id: req.user!.id, course_id });
      }
    }

    res.json({
      watched_seconds: input.watched_seconds,
      completed,
      enrollment_progress_percent: result.percent,
      lectures_done: result.done,
      lectures_total: result.total,
    });
  }),
);

progressRouter.get(
  '/lectures/:id/progress',
  authenticate,
  wrap(async (req, res) => {
    const { enrollment_id } = await requireEnrollment(req.user!.id, req.params.id);
    const row = await queryOne(
      `SELECT watched_seconds, completed, last_watched_at FROM lecture_progress
       WHERE enrollment_id = $1 AND lecture_id = $2`,
      [enrollment_id, req.params.id],
    );
    res.json(row ?? { watched_seconds: 0, completed: false, last_watched_at: null });
  }),
);

// ---- Notes (FR-S5) --------------------------------------------------------

const noteSchema = z.object({
  timestamp_seconds: z.coerce.number().int().min(0),
  content: z.string().trim().min(1, 'content is required').max(4000),
});

progressRouter.get(
  '/lectures/:id/notes',
  authenticate,
  wrap(async (req, res) => {
    const items = await query(
      `SELECT id, timestamp_seconds, content, created_at FROM notes
       WHERE user_id = $1 AND lecture_id = $2 ORDER BY timestamp_seconds ASC`,
      [req.user!.id, req.params.id],
    );
    res.json({ items });
  }),
);

progressRouter.post(
  '/lectures/:id/notes',
  authenticate,
  wrap(async (req, res) => {
    const input = noteSchema.parse(req.body);
    await requireEnrollment(req.user!.id, req.params.id);
    const note = await queryOne(
      `INSERT INTO notes (user_id, lecture_id, timestamp_seconds, content)
       VALUES ($1, $2, $3, $4) RETURNING id, timestamp_seconds, content, created_at`,
      [req.user!.id, req.params.id, input.timestamp_seconds, input.content],
    );
    res.status(201).json(note);
  }),
);

progressRouter.delete(
  '/notes/:id',
  authenticate,
  wrap(async (req, res) => {
    const deleted = await query('DELETE FROM notes WHERE id = $1 AND user_id = $2 RETURNING id', [
      req.params.id,
      req.user!.id,
    ]);
    if (!deleted.length) throw notFound('Note not found');
    res.json({ ok: true });
  }),
);

// ---- Bookmarks (FR-S5) ----------------------------------------------------

const bookmarkSchema = z.object({
  timestamp_seconds: z.coerce.number().int().min(0),
});

progressRouter.get(
  '/lectures/:id/bookmarks',
  authenticate,
  wrap(async (req, res) => {
    const items = await query(
      `SELECT id, timestamp_seconds, created_at FROM bookmarks
       WHERE user_id = $1 AND lecture_id = $2 ORDER BY timestamp_seconds ASC`,
      [req.user!.id, req.params.id],
    );
    res.json({ items });
  }),
);

progressRouter.post(
  '/lectures/:id/bookmarks',
  authenticate,
  wrap(async (req, res) => {
    const input = bookmarkSchema.parse(req.body);
    await requireEnrollment(req.user!.id, req.params.id);
    const bookmark = await queryOne(
      `INSERT INTO bookmarks (user_id, lecture_id, timestamp_seconds)
       VALUES ($1, $2, $3) RETURNING id, timestamp_seconds, created_at`,
      [req.user!.id, req.params.id, input.timestamp_seconds],
    );
    res.status(201).json(bookmark);
  }),
);

progressRouter.delete(
  '/bookmarks/:id',
  authenticate,
  wrap(async (req, res) => {
    const deleted = await query('DELETE FROM bookmarks WHERE id = $1 AND user_id = $2 RETURNING id', [
      req.params.id,
      req.user!.id,
    ]);
    if (!deleted.length) throw notFound('Bookmark not found');
    res.json({ ok: true });
  }),
);
