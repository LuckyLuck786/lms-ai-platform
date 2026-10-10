import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth';
import { query, queryOne } from '../../db/pool';
import { forbidden, notFound } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { queueEmail } from '../../jobs/queues';

/**
 * Per-course threaded discussion forum (PRD §3.1 / FR-AD5).
 * Students enrolled in a course (or the course owner / admin) can read and
 * post; any participant can flag content; the instructor of the course or an
 * admin can remove flagged posts.
 */

export const discussionsRouter = Router();

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

/** Enrolled student, course owner, or platform admin. */
async function requireCourseAccess(userId: string, roles: string[], courseId: string) {
  const course = await queryOne<{ id: string; instructor_id: string }>(
    'SELECT id, instructor_id FROM courses WHERE id = $1',
    [courseId],
  );
  if (!course) throw notFound('Course not found');
  const isStaff = course.instructor_id === userId || roles.includes('admin');
  if (isStaff) return course;
  const enrolled = await queryOne('SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2', [
    userId,
    courseId,
  ]);
  if (!enrolled) throw forbidden('You are not enrolled in this course');
  return course;
}

async function requireThreadAccess(userId: string, roles: string[], threadId: string) {
  const thread = await queryOne<{
    id: string;
    course_id: string;
    created_by: string;
    title: string;
  }>('SELECT id, course_id, created_by, title FROM discussion_threads WHERE id = $1', [
    threadId,
  ]);
  if (!thread) throw notFound('Thread not found');
  await requireCourseAccess(userId, roles, thread.course_id);
  return thread;
}

const threadSchema = z.object({
  title: z.string().trim().min(3).max(200),
});

const postSchema = z.object({
  content: z.string().trim().min(1, 'content is required').max(8000),
});

// ---- Threads ---------------------------------------------------------------

discussionsRouter.get(
  '/courses/:id/threads',
  authenticate,
  wrap(async (req, res) => {
    await requireCourseAccess(req.user!.id, req.user!.roles, req.params.id);
    const items = await query(
      `SELECT t.id, t.title, t.created_at, u.full_name AS created_by_name,
              (SELECT count(*)::int FROM discussion_posts p WHERE p.thread_id = t.id) AS post_count,
              (SELECT max(p.created_at) FROM discussion_posts p WHERE p.thread_id = t.id) AS last_activity_at
       FROM discussion_threads t JOIN users u ON u.id = t.created_by
       WHERE t.course_id = $1
       ORDER BY last_activity_at DESC NULLS LAST, t.created_at DESC`,
      [req.params.id],
    );
    res.json({ items });
  }),
);

discussionsRouter.post(
  '/courses/:id/threads',
  authenticate,
  requireRole('student', 'instructor', 'admin'),
  wrap(async (req, res) => {
    const input = threadSchema.parse(req.body);
    await requireCourseAccess(req.user!.id, req.user!.roles, req.params.id);
    const thread = await queryOne(
      'INSERT INTO discussion_threads (course_id, created_by, title) VALUES ($1, $2, $3) RETURNING *',
      [req.params.id, req.user!.id, input.title],
    );
    res.status(201).json(thread);
  }),
);

// ---- Posts -----------------------------------------------------------------

discussionsRouter.get(
  '/threads/:id/posts',
  authenticate,
  wrap(async (req, res) => {
    await requireThreadAccess(req.user!.id, req.user!.roles, req.params.id);
    const items = await query(
      `SELECT p.id, p.content, p.is_flagged, p.created_at, u.full_name AS author_name,
              u.id AS author_id
       FROM discussion_posts p JOIN users u ON u.id = p.user_id
       WHERE p.thread_id = $1
       ORDER BY p.created_at ASC`,
      [req.params.id],
    );
    res.json({ items });
  }),
);

discussionsRouter.post(
  '/threads/:id/posts',
  authenticate,
  requireRole('student', 'instructor', 'admin'),
  wrap(async (req, res) => {
    const input = postSchema.parse(req.body);
    const thread = await requireThreadAccess(req.user!.id, req.user!.roles, req.params.id);

    const post = await queryOne(
      'INSERT INTO discussion_posts (thread_id, user_id, content) VALUES ($1, $2, $3) RETURNING *',
      [req.params.id, req.user!.id, input.content],
    );

    // Notify the thread author about new activity (not on self-reply),
    // in-app and by email so a slow thread still reaches them.
    if (thread.created_by !== req.user!.id) {
      await query(
        'INSERT INTO notifications (user_id, title, body) VALUES ($1, $2, $3)',
        [thread.created_by, 'New reply in your thread', `${req.user!.email} replied: ${input.content.slice(0, 120)}`],
      );

      const author = await queryOne<{ email: string; is_active: boolean }>(
        'SELECT email, is_active FROM users WHERE id = $1',
        [thread.created_by],
      );
      if (author?.is_active) {
        await queueEmail({
          kind: 'discussion',
          subject: `New reply in “${thread.title}”`,
          body: `${req.user!.email} replied:\n\n${input.content.slice(0, 600)}`,
          recipients: [author.email],
          cta: { label: 'Open the thread', path: `/courses/${thread.course_id}/discussions` },
        });
      }
    }
    res.status(201).json(post);
  }),
);

/** FR-AD5: any participant can flag a post for moderation. */
discussionsRouter.post(
  '/posts/:id/flag',
  authenticate,
  wrap(async (req, res) => {
    const post = await queryOne<{ id: string; thread_id: string }>(
      'SELECT id, thread_id FROM discussion_posts WHERE id = $1',
      [req.params.id],
    );
    if (!post) throw notFound('Post not found');
    await requireThreadAccess(req.user!.id, req.user!.roles, post.thread_id);

    await query('UPDATE discussion_posts SET is_flagged = TRUE WHERE id = $1', [post.id]);
    logger.info('post_flagged', { post_id: post.id, by: req.user!.id });
    res.json({ ok: true, is_flagged: true });
  }),
);

/** Remove a post: course instructor or admin (moderation). */
discussionsRouter.delete(
  '/posts/:id',
  authenticate,
  requireRole('instructor', 'admin'),
  wrap(async (req, res) => {
    const post = await queryOne<{ id: string; thread_id: string }>(
      'SELECT id, thread_id FROM discussion_posts WHERE id = $1',
      [req.params.id],
    );
    if (!post) throw notFound('Post not found');
    const thread = await queryOne<{ course_id: string }>(
      'SELECT course_id FROM discussion_threads WHERE id = $1',
      [post.thread_id],
    );
    const course = await queryOne<{ instructor_id: string }>(
      'SELECT instructor_id FROM courses WHERE id = $1',
      [thread!.course_id],
    );
    const allowed = course!.instructor_id === req.user!.id || req.user!.roles.includes('admin');
    if (!allowed) throw forbidden('You can only moderate your own course');

    await query('DELETE FROM discussion_posts WHERE id = $1', [post.id]);
    logger.info('post_removed', { post_id: post.id, by: req.user!.id });
    res.json({ ok: true });
  }),
);
