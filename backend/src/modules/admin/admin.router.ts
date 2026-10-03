import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../../middleware/auth';
import { query, queryOne, withTransaction } from '../../db/pool';
import { notFound, badRequest } from '../../utils/errors';
import { revokeAllRefreshTokens } from '../../utils/jwt';
import { listPendingCourses } from '../courses/courses.service';
import { logger } from '../../utils/logger';

/**
 * Admin panel APIs (FR-AD1..FR-AD5, PRD §8.7). Every route requires the
 * admin role; mutations are written to audit_logs for the audit trail.
 */

export const adminRouter = Router();

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

async function audit(
  actorId: string,
  action: string,
  entity: string,
  entityId: string | null,
  metadata: Record<string, unknown> = {},
) {
  await query(
    'INSERT INTO audit_logs (actor_id, action, entity, entity_id, metadata) VALUES ($1, $2, $3, $4, $5)',
    [actorId, action, entity, entityId, JSON.stringify(metadata)],
  );
}

adminRouter.use(authenticate, requireRole('admin'));

// GET /admin/analytics/overview — platform-wide metrics (FR-AD3)
adminRouter.get(
  '/admin/analytics/overview',
  wrap(async (_req, res) => {
    const [users, courses, enrollments, completion, revenue, dau, flagged] = await Promise.all([
      queryOne<{ total: string; active: string }>(
        "SELECT count(*)::text AS total, count(*) FILTER (WHERE is_active)::text AS active FROM users",
      ),
      queryOne<{ total: string; approved: string; pending: string }>(
        `SELECT count(*)::text AS total,
                count(*) FILTER (WHERE status = 'approved')::text AS approved,
                count(*) FILTER (WHERE status = 'pending')::text AS pending FROM courses`,
      ),
      queryOne<{ total: string }>('SELECT count(*)::text AS total FROM enrollments'),
      queryOne<{ rate: number }>(
        `SELECT COALESCE(
           round(100.0 * count(*) FILTER (WHERE progress_percent >= 100)
                 / NULLIF(count(*), 0), 1), 0) AS rate
         FROM enrollments`,
      ),
      queryOne<{ revenue: string }>(
        "SELECT COALESCE(sum(amount) FILTER (WHERE status = 'success'), 0)::text AS revenue FROM payments",
      ),
      queryOne<{ dau: string }>(
        `SELECT count(*)::text AS dau FROM (
           SELECT user_id FROM streaks WHERE last_active_date = CURRENT_DATE
           UNION
           SELECT e.user_id FROM lecture_progress lp
           JOIN enrollments e ON e.id = lp.enrollment_id
           WHERE lp.last_watched_at::date = CURRENT_DATE
         ) active_today`,
      ),
      queryOne<{ flagged: string }>(
        'SELECT count(*)::text AS flagged FROM discussion_posts WHERE is_flagged',
      ),
    ]);

    res.json({
      total_users: Number(users?.total ?? 0),
      active_users: Number(users?.active ?? 0),
      dau: Number(dau?.dau ?? 0),
      total_courses: Number(courses?.total ?? 0),
      approved_courses: Number(courses?.approved ?? 0),
      pending_courses: Number(courses?.pending ?? 0),
      total_enrollments: Number(enrollments?.total ?? 0),
      completion_rate: Number(completion?.rate ?? 0),
      revenue: Number(revenue?.revenue ?? 0),
      flagged_posts: Number(flagged?.flagged ?? 0),
    });
  }),
);

// GET /admin/users — list/search users (FR-AD2)
adminRouter.get(
  '/admin/users',
  wrap(async (req, res) => {
    const q = z.string().trim().max(200).optional().parse(req.query.q || undefined);
    const params: unknown[] = [];
    let where = 'TRUE';
    if (q) {
      params.push(`%${q}%`);
      where = `(u.full_name ILIKE $1 OR u.email ILIKE $1)`;
    }
    const items = await query(
      `SELECT u.id, u.full_name, u.email, u.is_active, u.created_at,
              COALESCE(ARRAY_AGG(r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles,
              (SELECT count(*)::int FROM enrollments e WHERE e.user_id = u.id) AS enrollment_count
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       LEFT JOIN roles r ON r.id = ur.role_id
       WHERE ${where}
       GROUP BY u.id
       ORDER BY u.created_at DESC
       LIMIT 100`,
      params,
    );
    res.json({ items });
  }),
);

// PUT /admin/users/:id/role — assign/revoke roles (FR-AD4)
const roleSchema = z.object({ role: z.enum(['student', 'instructor', 'admin']) });

adminRouter.put(
  '/admin/users/:id/role',
  wrap(async (req, res) => {
    const input = roleSchema.parse(req.body);
    const updated = await withTransaction(async (client) => {
      const user = await client.query('SELECT id, email FROM users WHERE id = $1', [req.params.id]);
      if (!user.rowCount) throw notFound('User not found');
      if (user.rows[0].id === req.user!.id) {
        throw badRequest('You cannot change your own role', 'role');
      }
      await client.query('DELETE FROM user_roles WHERE user_id = $1', [req.params.id]);
      await client.query(
        'INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE name = $2',
        [req.params.id, input.role],
      );
      return user.rows[0];
    });

    // Existing tokens carry stale roles — force re-login everywhere.
    await revokeAllRefreshTokens(req.params.id);
    await audit(req.user!.id, 'role_change', 'user', req.params.id, { role: input.role });
    logger.info('role_changed', { target: req.params.id, role: input.role, by: req.user!.id });

    const roles = await query<{ name: string }>(
      'SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1',
      [req.params.id],
    );
    res.json({ id: req.params.id, roles: roles.map((r) => r.name) });
  }),
);

// PUT /admin/users/:id/suspend — suspend/restore account (FR-AD2)
const suspendSchema = z.object({ is_active: z.boolean() });

adminRouter.put(
  '/admin/users/:id/suspend',
  wrap(async (req, res) => {
    const input = suspendSchema.parse(req.body);
    if (req.params.id === req.user!.id) throw badRequest('You cannot suspend yourself', 'is_active');
    const user = await queryOne('SELECT id FROM users WHERE id = $1', [req.params.id]);
    if (!user) throw notFound('User not found');

    await query('UPDATE users SET is_active = $2, updated_at = now() WHERE id = $1', [
      req.params.id,
      input.is_active,
    ]);
    if (!input.is_active) await revokeAllRefreshTokens(req.params.id);

    await audit(req.user!.id, input.is_active ? 'user_restored' : 'user_suspended', 'user', req.params.id);
    res.json({ id: req.params.id, is_active: input.is_active });
  }),
);

// GET /admin/courses/pending — approval queue (FR-AD1)
adminRouter.get(
  '/admin/courses/pending',
  wrap(async (_req, res) => {
    res.json({ items: await listPendingCourses() });
  }),
);

// GET /admin/moderation/flagged-posts — reported forum content (FR-AD5)
adminRouter.get(
  '/admin/moderation/flagged-posts',
  wrap(async (_req, res) => {
    const items = await query(
      `SELECT p.id, p.content, p.created_at, u.full_name AS author_name,
              t.title AS thread_title, t.course_id, c.title AS course_title
       FROM discussion_posts p
       JOIN discussion_threads t ON t.id = p.thread_id
       JOIN courses c ON c.id = t.course_id
       JOIN users u ON u.id = p.user_id
       WHERE p.is_flagged
       ORDER BY p.created_at DESC
       LIMIT 100`,
    );
    res.json({ items });
  }),
);

// DELETE /admin/moderation/posts/:id — remove content + clear flag
adminRouter.delete(
  '/admin/moderation/posts/:id',
  wrap(async (req, res) => {
    const post = await queryOne('SELECT id FROM discussion_posts WHERE id = $1', [req.params.id]);
    if (!post) throw notFound('Post not found');
    await query('DELETE FROM discussion_posts WHERE id = $1', [req.params.id]);
    await audit(req.user!.id, 'post_removed', 'discussion_post', req.params.id);
    res.json({ ok: true });
  }),
);

// GET /admin/audit-logs — recent administrative actions
adminRouter.get(
  '/admin/audit-logs',
  wrap(async (_req, res) => {
    const items = await query(
      `SELECT a.id, a.action, a.entity, a.entity_id, a.metadata, a.created_at, u.full_name AS actor_name
       FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
       ORDER BY a.created_at DESC LIMIT 50`,
    );
    res.json({ items });
  }),
);
