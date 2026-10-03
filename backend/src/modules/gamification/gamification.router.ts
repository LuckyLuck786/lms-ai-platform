import { Router, Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import { authenticate } from '../../middleware/auth';
import { query, queryOne } from '../../db/pool';
import { notFound } from '../../utils/errors';
import { getUserBadges } from '../../utils/badges';
import { getStreak, touchStreak } from './gamification.service';

export const gamificationRouter = Router();

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

// GET /users/me/streak — current + longest streak (FR-S9)
gamificationRouter.get(
  '/users/me/streak',
  authenticate,
  wrap(async (req, res) => {
    res.json(await getStreak(req.user!.id));
  }),
);

// POST /users/me/activity — record a learning activity day (called by the UI)
gamificationRouter.post(
  '/users/me/activity',
  authenticate,
  wrap(async (req, res) => {
    res.json(await touchStreak(req.user!.id));
  }),
);

// GET /users/me/badges — earned badges
gamificationRouter.get(
  '/users/me/badges',
  authenticate,
  wrap(async (req, res) => {
    res.json({ items: await getUserBadges(req.user!.id) });
  }),
);

// GET /users/me/certificates — my certificates (FR-S8)
gamificationRouter.get(
  '/users/me/certificates',
  authenticate,
  wrap(async (req, res) => {
    const items = await query(
      `SELECT c.id, c.issued_at, c.certificate_url, co.title AS course_title
       FROM certificates c JOIN courses co ON co.id = c.course_id
       WHERE c.user_id = $1 ORDER BY c.issued_at DESC`,
      [req.user!.id],
    );
    res.json({ items });
  }),
);

// GET /certificates/:id/download — PDF download (owner or admin)
gamificationRouter.get(
  '/certificates/:id/download',
  authenticate,
  wrap(async (req, res) => {
    const cert = await queryOne<{ id: string; user_id: string; certificate_url: string | null }>(
      'SELECT id, user_id, certificate_url FROM certificates WHERE id = $1',
      [req.params.id],
    );
    if (!cert) throw notFound('Certificate not found');
    if (cert.user_id !== req.user!.id && !req.user!.roles.includes('admin')) {
      throw notFound('Certificate not found');
    }
    if (!cert.certificate_url || !fs.existsSync(cert.certificate_url)) {
      throw notFound('Certificate PDF is still being generated — try again shortly');
    }
    res.download(path.resolve(cert.certificate_url), `certificate-${cert.id}.pdf`);
  }),
);

// GET /leaderboard/:courseId — engagement leaderboard (PRD §8.6)
gamificationRouter.get(
  '/leaderboard/:courseId',
  authenticate,
  wrap(async (req, res) => {
    const rows = await query(
      `SELECT u.id AS user_id, u.full_name,
              e.progress_percent,
              COALESCE(SUM(qa.score), 0)::float AS total_quiz_score,
              COALESCE(COUNT(qa.id), 0)::int AS quizzes_taken
       FROM enrollments e
       JOIN users u ON u.id = e.user_id
       LEFT JOIN quiz_attempts qa ON qa.user_id = u.id
         AND qa.quiz_id IN (
           SELECT q.id FROM quizzes q
           JOIN modules m ON m.id = q.module_id
           WHERE m.course_id = e.course_id
         )
       WHERE e.course_id = $1
       GROUP BY u.id, u.full_name, e.progress_percent
       ORDER BY e.progress_percent DESC, total_quiz_score DESC
       LIMIT 50`,
      [req.params.courseId],
    );
    res.json({ items: rows });
  }),
);
