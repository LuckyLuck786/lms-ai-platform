import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth';
import { query, queryOne } from '../../db/pool';
import { badRequest, forbidden, notFound } from '../../utils/errors';
import { getOwnedCourse } from '../courses/courses.service';
import { queueEmail } from '../../jobs/queues';
import { decryptPii } from '../../utils/pii';

/**
 * Live classes: the instructor schedules a session with an external meeting
 * link (Google Meet, Zoom, Teams…); enrolled learners join through the
 * platform, which records attendance and then hands them the link.
 *
 * The link is only ever given to enrolled learners (and the course owner),
 * and only from 15 minutes before the start until the session ends, so a
 * forwarded course page does not leak it.
 */
export const liveRouter = Router();

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

export const JOIN_OPENS_MINUTES = 15;

/** Pure: can a learner join right now? */
export function joinWindow(startsAt: Date, durationMinutes: number, now = new Date()): 'early' | 'open' | 'ended' {
  const opens = startsAt.getTime() - JOIN_OPENS_MINUTES * 60_000;
  const ends = startsAt.getTime() + durationMinutes * 60_000;
  if (now.getTime() < opens) return 'early';
  if (now.getTime() > ends) return 'ended';
  return 'open';
}

const createSchema = z.object({
  title: z.string().trim().min(3).max(200),
  starts_at: z.string().datetime({ offset: true }),
  duration_minutes: z.coerce.number().int().min(5).max(600),
  join_url: z
    .string()
    .url('join_url must be a URL')
    .refine((u) => u.startsWith('https://'), 'join_url must be an https:// meeting link'),
});

liveRouter.post(
  '/courses/:id/live-sessions',
  authenticate,
  requireRole('instructor', 'admin'),
  wrap(async (req, res) => {
    const course = await getOwnedCourse(req.params.id, req.user!);
    const input = createSchema.parse(req.body);
    if (new Date(input.starts_at).getTime() < Date.now() - 60_000) {
      throw badRequest('A live class must start in the future', 'starts_at');
    }
    const session = await queryOne<{ id: string }>(
      `INSERT INTO live_sessions (course_id, title, starts_at, duration_minutes, join_url, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [course.id, input.title, input.starts_at, input.duration_minutes, input.join_url, req.user!.id],
    );

    const learners = await query<{ user_id: string; email: string }>(
      `SELECT e.user_id, u.email FROM enrollments e JOIN users u ON u.id = e.user_id
       WHERE e.course_id = $1 AND u.is_active`,
      [course.id],
    );
    const title = await queryOne<{ title: string }>('SELECT title FROM courses WHERE id = $1', [course.id]);
    const when = new Date(input.starts_at).toUTCString().replace(' GMT', ' UTC');
    if (learners.length) {
      await query(
        `INSERT INTO notifications (user_id, title, body)
         SELECT e.user_id, $2, $3 FROM enrollments e WHERE e.course_id = $1`,
        [course.id, `Live class scheduled: ${input.title}`, `${title?.title} — ${when}`],
      );
      await queueEmail({
        kind: 'announcement',
        subject: `Live class: ${input.title}`,
        body: `A live class for “${title?.title}” is scheduled for ${when} (${input.duration_minutes} minutes).\n\n` +
          `Join from the course page — the link opens ${JOIN_OPENS_MINUTES} minutes before the start.`,
        recipients: learners.map((l) => decryptPii(l.email)),
        cta: { label: 'Open the course', path: `/catalog/${course.id}` },
      });
    }
    res.status(201).json(session);
  }),
);

liveRouter.get(
  '/courses/:id/live-sessions',
  authenticate,
  wrap(async (req, res) => {
    const course = await queryOne<{ id: string; instructor_id: string }>(
      'SELECT id, instructor_id FROM courses WHERE id = $1',
      [req.params.id],
    );
    if (!course) throw notFound('Course not found');
    const staff = course.instructor_id === req.user!.id || req.user!.roles.includes('admin');
    const enrolled = staff
      ? true
      : !!(await queryOne('SELECT 1 FROM enrollments WHERE user_id = $1 AND course_id = $2', [req.user!.id, course.id]));
    if (!enrolled) throw forbidden('Enrol in this course to see its live classes');

    const rows = await query<{
      id: string;
      title: string;
      starts_at: Date;
      duration_minutes: number;
      join_url: string;
      attended: boolean;
      attendee_count: number;
    }>(
      `SELECT s.id, s.title, s.starts_at, s.duration_minutes, s.join_url,
              EXISTS (SELECT 1 FROM live_attendance a WHERE a.session_id = s.id AND a.user_id = $2) AS attended,
              (SELECT count(*)::int FROM live_attendance a WHERE a.session_id = s.id) AS attendee_count
       FROM live_sessions s WHERE s.course_id = $1 ORDER BY s.starts_at`,
      [course.id, req.user!.id],
    );
    res.json({
      is_owner: staff,
      items: rows.map(({ join_url, attendee_count, ...s }) => ({
        ...s,
        window: joinWindow(new Date(s.starts_at), s.duration_minutes),
        // Learners get the link only through /join (which records attendance).
        ...(staff ? { join_url, attendee_count } : {}),
      })),
    });
  }),
);

liveRouter.post(
  '/live-sessions/:id/join',
  authenticate,
  wrap(async (req, res) => {
    const s = await queryOne<{ id: string; course_id: string; instructor_id: string; starts_at: Date; duration_minutes: number; join_url: string }>(
      `SELECT s.id, s.course_id, c.instructor_id, s.starts_at, s.duration_minutes, s.join_url
       FROM live_sessions s JOIN courses c ON c.id = s.course_id WHERE s.id = $1`,
      [req.params.id],
    );
    if (!s) throw notFound('Live class not found');
    const staff = s.instructor_id === req.user!.id || req.user!.roles.includes('admin');
    if (staff) {
      res.json({ join_url: s.join_url, attendance_recorded: false });
      return;
    }
    const enrolled = await queryOne('SELECT 1 FROM enrollments WHERE user_id = $1 AND course_id = $2', [
      req.user!.id,
      s.course_id,
    ]);
    if (!enrolled) throw forbidden('Enrol in this course to join its live classes');
    const window = joinWindow(new Date(s.starts_at), s.duration_minutes);
    if (window === 'early') throw badRequest(`The link opens ${JOIN_OPENS_MINUTES} minutes before the class starts`);
    if (window === 'ended') throw badRequest('This live class has ended');

    await query(
      'INSERT INTO live_attendance (session_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [s.id, req.user!.id],
    );
    res.json({ join_url: s.join_url, attendance_recorded: true });
  }),
);

liveRouter.get(
  '/live-sessions/:id/attendance',
  authenticate,
  requireRole('instructor', 'admin'),
  wrap(async (req, res) => {
    const s = await queryOne<{ course_id: string }>('SELECT course_id FROM live_sessions WHERE id = $1', [req.params.id]);
    if (!s) throw notFound('Live class not found');
    await getOwnedCourse(s.course_id, req.user!);
    const attendees = await query(
      `SELECT u.id AS user_id, u.full_name, a.joined_at FROM live_attendance a
       JOIN users u ON u.id = a.user_id WHERE a.session_id = $1 ORDER BY a.joined_at`,
      [req.params.id],
    );
    const enrolled = await queryOne<{ n: number }>('SELECT count(*)::int AS n FROM enrollments WHERE course_id = $1', [
      s.course_id,
    ]);
    res.json({ items: attendees, attended: attendees.length, enrolled: enrolled?.n ?? 0 });
  }),
);

liveRouter.delete(
  '/live-sessions/:id',
  authenticate,
  requireRole('instructor', 'admin'),
  wrap(async (req, res) => {
    const s = await queryOne<{ course_id: string }>('SELECT course_id FROM live_sessions WHERE id = $1', [req.params.id]);
    if (!s) throw notFound('Live class not found');
    await getOwnedCourse(s.course_id, req.user!);
    await query('DELETE FROM live_sessions WHERE id = $1', [req.params.id]);
    res.json({ deleted: true });
  }),
);
