import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middleware/auth';
import { query, queryOne } from '../../db/pool';
import { notFound } from '../../utils/errors';
import { pageEnvelope, parsePage } from '../../utils/pagination';

export const notificationsRouter = Router();

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

// GET /users/me/notifications — newest first, unread count
notificationsRouter.get(
  '/users/me/notifications',
  authenticate,
  wrap(async (req, res) => {
    const pg = parsePage(req.query, 50);
    const rows = await query<{ total_count: number }>(
      `SELECT id, title, body, is_read, created_at, count(*) OVER() AS total_count FROM notifications
       WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [req.user!.id, pg.limit, pg.offset],
    );
    // Counted over every notification, not just this page — the badge used to
    // undercount once a learner had more than one page of history.
    const counted = await queryOne<{ unread: number }>(
      'SELECT count(*)::int AS unread FROM notifications WHERE user_id = $1 AND NOT is_read',
      [req.user!.id],
    );
    res.json({ ...pageEnvelope(rows, pg), unread: counted?.unread ?? 0 });
  }),
);

// PUT /notifications/:id/read
notificationsRouter.put(
  '/notifications/:id/read',
  authenticate,
  wrap(async (req, res) => {
    const updated = await query(
      'UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.user!.id],
    );
    if (!updated.length) throw notFound('Notification not found');
    res.json({ ok: true });
  }),
);

// POST /users/me/notifications/read-all
notificationsRouter.post(
  '/users/me/notifications/read-all',
  authenticate,
  wrap(async (req, res) => {
    await query('UPDATE notifications SET is_read = TRUE WHERE user_id = $1', [req.user!.id]);
    res.json({ ok: true });
  }),
);
