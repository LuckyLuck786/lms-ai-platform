import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth';
import { query, queryOne } from '../../db/pool';
import { forbidden, notFound } from '../../utils/errors';
import { NEW_CARD, schedule } from '../../utils/srs';

/**
 * Flashcard revision on a spaced-repetition schedule (SM-2, utils/srs.ts).
 * Cards come from the AI generator (FR-A7, one set per module); each learner
 * has their own schedule per card in flashcard_reviews.
 *
 *   GET  /users/me/flashcards              per-course counts: due, new, total
 *   GET  /users/me/flashcards/due          the next cards to study
 *   POST /flashcards/:id/review            record again / hard / good / easy
 */
export const flashcardsRouter = Router();

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

flashcardsRouter.get(
  '/users/me/flashcards',
  authenticate,
  wrap(async (req, res) => {
    const courses = await query(
      `SELECT c.id AS course_id, c.title AS course_title,
              count(f.id)::int AS total,
              count(f.id) FILTER (WHERE r.flashcard_id IS NULL)::int AS new,
              count(f.id) FILTER (WHERE r.due_at <= now())::int AS due,
              COALESCE(array_agg(DISTINCT m.id) FILTER (WHERE NOT EXISTS
                (SELECT 1 FROM flashcards f2 WHERE f2.module_id = m.id)), '{}') AS modules_without_cards
       FROM enrollments e
       JOIN courses c ON c.id = e.course_id
       JOIN modules m ON m.course_id = c.id
       LEFT JOIN flashcards f ON f.module_id = m.id
       LEFT JOIN flashcard_reviews r ON r.flashcard_id = f.id AND r.user_id = e.user_id
       WHERE e.user_id = $1
       GROUP BY c.id, c.title
       ORDER BY c.title`,
      [req.user!.id],
    );
    const totals = courses.reduce<{ due: number; new: number }>(
      (acc, c) => ({ due: acc.due + (c as { due: number }).due, new: acc.new + (c as { new: number }).new }),
      { due: 0, new: 0 },
    );
    res.json({ items: courses, ...totals });
  }),
);

const dueQuery = z.object({
  course_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

flashcardsRouter.get(
  '/users/me/flashcards/due',
  authenticate,
  wrap(async (req, res) => {
    const q = dueQuery.parse(req.query);
    // Overdue reviews first (oldest due first), then cards never studied.
    const items = await query(
      `SELECT f.id, f.question, f.answer, m.title AS module_title, c.id AS course_id, c.title AS course_title,
              CASE WHEN r.flashcard_id IS NULL THEN 'new' ELSE 'review' END AS state,
              r.due_at, r.interval_days
       FROM enrollments e
       JOIN courses c ON c.id = e.course_id
       JOIN modules m ON m.course_id = c.id
       JOIN flashcards f ON f.module_id = m.id
       LEFT JOIN flashcard_reviews r ON r.flashcard_id = f.id AND r.user_id = e.user_id
       WHERE e.user_id = $1
         AND ($2::uuid IS NULL OR c.id = $2)
         AND (r.flashcard_id IS NULL OR r.due_at <= now())
       ORDER BY (r.flashcard_id IS NULL), r.due_at, m.order_index, f.id
       LIMIT $3`,
      [req.user!.id, q.course_id ?? null, q.limit],
    );
    res.json({ items });
  }),
);

const reviewSchema = z.object({ rating: z.enum(['again', 'hard', 'good', 'easy']) });

flashcardsRouter.post(
  '/flashcards/:id/review',
  authenticate,
  wrap(async (req, res) => {
    const { rating } = reviewSchema.parse(req.body);
    const card = await queryOne<{ course_id: string }>(
      'SELECT m.course_id FROM flashcards f JOIN modules m ON m.id = f.module_id WHERE f.id = $1',
      [req.params.id],
    );
    if (!card) throw notFound('Flashcard not found');
    const enrolled = await queryOne('SELECT 1 FROM enrollments WHERE user_id = $1 AND course_id = $2', [
      req.user!.id,
      card.course_id,
    ]);
    if (!enrolled) throw forbidden('You are not enrolled in this course');

    const prev = await queryOne<{ repetitions: number; interval_days: number; ease: string }>(
      'SELECT repetitions, interval_days, ease FROM flashcard_reviews WHERE user_id = $1 AND flashcard_id = $2',
      [req.user!.id, req.params.id],
    );
    const next = schedule(
      prev ? { repetitions: prev.repetitions, intervalDays: prev.interval_days, ease: Number(prev.ease) } : NEW_CARD,
      rating,
    );
    await query(
      `INSERT INTO flashcard_reviews (user_id, flashcard_id, repetitions, interval_days, ease, due_at, last_reviewed_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (user_id, flashcard_id) DO UPDATE SET
         repetitions = EXCLUDED.repetitions, interval_days = EXCLUDED.interval_days,
         ease = EXCLUDED.ease, due_at = EXCLUDED.due_at, last_reviewed_at = now()`,
      [req.user!.id, req.params.id, next.repetitions, next.intervalDays, next.ease, next.dueAt],
    );
    res.json({ flashcard_id: req.params.id, rating, interval_days: next.intervalDays, due_at: next.dueAt });
  }),
);
