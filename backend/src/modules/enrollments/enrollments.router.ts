import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import { authenticate, requireRole } from '../../middleware/auth';
import { z } from 'zod';
import { query, queryOne } from '../../db/pool';
import { badRequest, forbidden, notFound, conflict } from '../../utils/errors';
import { createLectureSchema } from '../courses/courses.schemas';
import * as coursesService from '../courses/courses.service';
import { UPLOAD_TMP, ensureDir, persistFile, safeExtension } from '../../utils/storage';

export const modulesRouter = Router();

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

/** Lecture video can legitimately be large; slides/PDFs are far smaller. */
const LECTURE_FILE_LIMIT = 512 * 1024 * 1024; // 512 MB

const lectureUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      ensureDir(UPLOAD_TMP);
      cb(null, UPLOAD_TMP);
    },
    // Client filenames are never trusted on disk — generate our own.
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${safeExtension(file.originalname)}`),
  }),
  limits: { fileSize: LECTURE_FILE_LIMIT, files: 11 },
});

const lectureFields = lectureUpload.fields([
  { name: 'video', maxCount: 1 },
  { name: 'resources', maxCount: 10 },
]);

/**
 * POST /modules/:id/lectures (FR-I2) — instructor (owner) adds a lecture.
 *
 * Accepts JSON (unchanged) or multipart/form-data carrying a `video` file and
 * up to 10 `resources` files (PDF / slides). Uploaded files are persisted via
 * the storage helper and written to video_url / resource_urls.
 */
modulesRouter.post(
  '/:id/lectures',
  authenticate,
  requireRole('instructor', 'admin'),
  lectureFields,
  wrap(async (req, res) => {
    const files = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
    const input = createLectureSchema.parse(req.body);

    const video = files.video?.[0];
    if (video) {
      const stored = await persistFile(video.path, video.originalname, 'lectures', video.mimetype);
      input.video_url = stored.url;
    }

    const uploaded = files.resources ?? [];
    if (uploaded.length) {
      const stored = await Promise.all(
        uploaded.map((file) =>
          persistFile(file.path, file.originalname, 'lectures/resources', file.mimetype),
        ),
      );
      input.resource_urls = [...(input.resource_urls ?? []), ...stored.map((s) => s.url)];
    }

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

// ---- Lecture material (FR-I2) ---------------------------------------------
export const lecturesRouter = Router();

/**
 * POST /lectures/:id/resources — attach slides/PDFs to an existing lecture.
 * Instructors record first and upload material later, so this complements the
 * multipart create above. Owner or admin only.
 */
lecturesRouter.post(
  '/lectures/:id/resources',
  authenticate,
  requireRole('instructor', 'admin'),
  lectureUpload.array('resources', 10),
  wrap(async (req, res) => {
    const files = (req.files ?? []) as Express.Multer.File[];
    if (!files.length) throw badRequest('Attach at least one file in the resources field');

    const lecture = await queryOne<{
      id: string;
      resource_urls: string[] | null;
      instructor_id: string;
    }>(
      `SELECT l.id, l.resource_urls, c.instructor_id
       FROM lectures l
       JOIN modules m ON m.id = l.module_id
       JOIN courses c ON c.id = m.course_id
       WHERE l.id = $1`,
      [req.params.id],
    );
    if (!lecture) throw notFound('Lecture not found');
    if (lecture.instructor_id !== req.user!.id && !req.user!.roles.includes('admin')) {
      throw forbidden('You do not own this course');
    }

    const stored = await Promise.all(
      files.map((file) =>
        persistFile(file.path, file.originalname, 'lectures/resources', file.mimetype),
      ),
    );
    const merged = [...(lecture.resource_urls ?? []), ...stored.map((s) => s.url)];
    const updated = await queryOne(
      'UPDATE lectures SET resource_urls = $2 WHERE id = $1 RETURNING id, resource_urls',
      [lecture.id, merged],
    );

    res.status(201).json({
      ...updated,
      added: stored.map((s) => ({ url: s.url, name: s.originalName, size: s.size })),
    });
  }),
);
