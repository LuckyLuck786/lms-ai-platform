import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middleware/auth';
import { query, queryOne } from '../../db/pool';
import { notFound } from '../../utils/errors';

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
    const items = await query(
      `SELECT id, title, body, is_read, created_at FROM notifications
       WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.user!.id],
    );
    const unread = items.filter((n) => !(n as { is_read: boolean }).is_read).length;
    res.json({ items, unread });
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
