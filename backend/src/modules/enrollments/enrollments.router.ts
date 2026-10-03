import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, requireRole } from '../../middleware/auth';
import { z } from 'zod';
import { query, queryOne } from '../../db/pool';
import { forbidden, notFound, conflict } from '../../utils/errors';
import { createLectureSchema } from '../courses/courses.schemas';
import * as coursesService from '../courses/courses.service';

export const modulesRouter = Router();

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

// POST /modules/:id/lectures — instructor (owner) adds a lecture to their module
modulesRouter.post(
  '/:id/lectures',
  authenticate,
  requireRole('instructor', 'admin'),
  wrap(async (req, res) => {
    const input = createLectureSchema.parse(req.body);
    res.status(201).json(await coursesService.addLecture(req.user!, req.params.id, input));
  }),
);

// GET /modules/:id — module with its lectures (requires course access)
modulesRouter.get(
  '/:id',
  authenticate,
  wrap(async (req, res) => {
    const mod = await queryOne<{ id: string; course_id: string; title: string; order_index: number }>(
      'SELECT id, course_id, title, order_index FROM modules WHERE id = $1',
      [req.params.id],
    );
    if (!mod) throw notFound('Module not found');
    const lectures = await query(
      `SELECT id, module_id, title, video_url, duration_seconds, order_index, resource_urls
       FROM lectures WHERE module_id = $1 ORDER BY order_index`,
      [mod.id],
    );
    res.json({ ...mod, lectures });
  }),
);

// ---- Enrollment & progress (PRD §8.3) ------------------------------------
export const enrollmentsRouter = Router();

const enrollSchema = z.object({}); // enrollment needs no body

enrollmentsRouter.post(
  '/courses/:id/enroll',
  authenticate,
  requireRole('student'),
  wrap(async (req, res) => {
    enrollSchema.parse(req.body ?? {});
    const course = await queryOne<{ id: string; status: string }>(
      'SELECT id, status FROM courses WHERE id = $1',
      [req.params.id],
    );
    if (!course) throw notFound('Course not found');
    if (course.status !== 'approved') throw forbidden('Course is not open for enrollment');

    const existing = await queryOne('SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2', [
      req.user!.id,
      course.id,
    ]);
    if (existing) throw conflict('You are already enrolled in this course');

    const enrollment = await queryOne(
      'INSERT INTO enrollments (user_id, course_id) VALUES ($1, $2) RETURNING *',
      [req.user!.id, course.id],
    );
    res.status(201).json(enrollment);
  }),
);

enrollmentsRouter.get(
  '/enrollments/me',
  authenticate,
  wrap(async (req, res) => {
    const rows = await query(
      `SELECT e.id, e.enrolled_at, e.progress_percent,
              c.id AS course_id, c.title, c.category, c.difficulty, c.thumbnail_url, c.status,
              u.full_name AS instructor_name
       FROM enrollments e
       JOIN courses c ON c.id = e.course_id
       JOIN users u ON u.id = c.instructor_id
       WHERE e.user_id = $1
       ORDER BY e.enrolled_at DESC`,
      [req.user!.id],
    );
    res.json({ items: rows });
  }),
);

enrollmentsRouter.get(
  '/enrollments/:id/lectures/:lectureId/progress',
  authenticate,
  wrap(async (req, res) => {
    const row = await queryOne(
      `SELECT lp.* FROM lecture_progress lp
       JOIN enrollments e ON e.id = lp.enrollment_id
       WHERE e.id = $1 AND e.user_id = $2 AND lp.lecture_id = $3`,
      [req.params.id, req.user!.id, req.params.lectureId],
    );
    res.json(row ?? { watched_seconds: 0, completed: false });
  }),
);
