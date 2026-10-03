import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth';
import { query, queryOne } from '../../db/pool';
import { forbidden, notFound } from '../../utils/errors';
import { queueEmail } from '../../jobs/queues';

export const announcementsRouter = Router();

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

const announcementSchema = z.object({
  content: z.string().trim().min(2, 'content is required').max(4000),
});

async function requireOwnedCourse(userId: string, roles: string[], courseId: string) {
  const course = await queryOne<{ id: string; instructor_id: string; title: string }>(
    'SELECT id, instructor_id, title FROM courses WHERE id = $1',
    [courseId],
  );
  if (!course) throw notFound('Course not found');
  if (course.instructor_id !== userId && !roles.includes('admin')) {
    throw forbidden('You do not own this course');
  }
  return course;
}

// POST /courses/:id/announcements — instructor (FR-I6): post + fan out
announcementsRouter.post(
  '/courses/:id/announcements',
  authenticate,
  requireRole('instructor', 'admin'),
  wrap(async (req, res) => {
    const input = announcementSchema.parse(req.body);
    const course = await requireOwnedCourse(req.user!.id, req.user!.roles, req.params.id);

    const announcement = await queryOne(
      'INSERT INTO announcements (course_id, posted_by, content) VALUES ($1, $2, $3) RETURNING *',
      [req.params.id, req.user!.id, input.content],
    );

    // In-app notifications for every enrolled student + queued email dispatch
    const students = await query<{ user_id: string; email: string }>(
      'SELECT user_id, email FROM enrollments e JOIN users u ON u.id = e.user_id WHERE e.course_id = $1 AND u.is_active',
      [req.params.id],
    );
    if (students.length) {
      await query(
        `INSERT INTO notifications (user_id, title, body)
         SELECT e.user_id, $2, $3 FROM enrollments e WHERE e.course_id = $1`,
        [req.params.id, `Announcement: ${course.title}`, input.content.slice(0, 400)],
      );
      await queueEmail({
        kind: 'announcement',
        subject: `New announcement in ${course.title}`,
        body: input.content,
        recipients: students.map((s) => s.email),
      });
    }

    res.status(201).json({ ...announcement, notified: students.length });
  }),
);

// GET /courses/:id/announcements — enrolled students / owner / admin
announcementsRouter.get(
  '/courses/:id/announcements',
  authenticate,
  wrap(async (req, res) => {
    const course = await queryOne<{ id: string; instructor_id: string }>(
      'SELECT id, instructor_id FROM courses WHERE id = $1',
      [req.params.id],
    );
    if (!course) throw notFound('Course not found');
    const isStaff = course.instructor_id === req.user!.id || req.user!.roles.includes('admin');
    if (!isStaff) {
      const enrolled = await queryOne(
        'SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2',
        [req.user!.id, req.params.id],
      );
      if (!enrolled) throw forbidden('You are not enrolled in this course');
    }
    const items = await query(
      `SELECT a.id, a.content, a.created_at, u.full_name AS posted_by_name
       FROM announcements a JOIN users u ON u.id = a.posted_by
       WHERE a.course_id = $1 ORDER BY a.created_at DESC`,
      [req.params.id],
    );
    res.json({ items });
  }),
);
