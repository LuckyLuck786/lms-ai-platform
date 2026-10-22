import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { env } from './config/env';
import { generalRateLimiter } from './middleware/rateLimit';
import { errorHandler, notFoundHandler, requestLogger } from './middleware/errorHandler';
import { requestIdMiddleware } from './middleware/requestId';
import { authenticate } from './middleware/auth';
import { authRouter } from './modules/auth/auth.router';
import { coursesRouter } from './modules/courses/courses.router';
import {
  enrollmentsRouter,
  lecturesRouter,
  modulesRouter,
} from './modules/enrollments/enrollments.router';
import { progressRouter } from './modules/progress/progress.router';
import { attemptsRouter, quizzesRouter } from './modules/quizzes/quizzes.router';
import { assignmentsRouter } from './modules/assignments/assignments.router';
import { gamificationRouter } from './modules/gamification/gamification.router';
import { masteryRouter } from './modules/mastery/mastery.router';
import { aiRouter, recommendationsRouter } from './modules/ai/ai.router';
import { discussionsRouter } from './modules/discussions/discussions.router';
import { announcementsRouter } from './modules/announcements/announcements.router';
import { notificationsRouter } from './modules/notifications/notifications.router';
import { adminRouter } from './modules/admin/admin.router';
import { paymentsRouter } from './modules/payments/payments.router';
import { storageDriver, streamStoredFile } from './utils/storage';

export function createApp(): express.Express {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: env.corsOrigin, credentials: true }));
  // Correlation id first, so body-parse failures and rate limits are logged
  // against the same id as the rest of the request.
  app.use(requestIdMiddleware);
  // The Razorpay webhook authenticates itself with an HMAC over the exact
  // bytes of the request body, so the parsed JSON cannot be re-serialised to
  // verify it. Keep the raw buffer on the request for that one route.
  app.use(
    express.json({
      limit: '2mb',
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );
  app.use(requestLogger);

  // Health check (observability requirement)
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'backend', time: new Date().toISOString() });
  });

  // Root landing response — the real API lives under /api/v1, so give humans
  // and uptime monitors something meaningful here instead of a bare 404.
  app.get('/', (_req, res) => {
    res.json({
      service: 'lms-ai-backend',
      status: 'ok',
      version: '0.1.0',
      api: '/api/v1',
      health: '/health',
      time: new Date().toISOString(),
    });
  });

  // 100 req/min/user on everything except /auth/* and /ai/chat/* (PRD §8.9)
  app.use('/api/v1', generalRateLimiter);

  // Uploaded lecture material, assignment files + generated certificate PDFs.
  // With object storage configured the API streams the object itself (durable
  // across redeploys); otherwise the local disk mount below serves it.
  app.use('/uploads', async (req, res, next) => {
    if (storageDriver() !== 'gcs') return next();
    const key = decodeURIComponent(req.path.replace(/^\/+/, ''));
    if (!key || key.includes('..')) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid file key' } });
      return;
    }
    try {
      const streamed = await streamStoredFile(key, res);
      if (!streamed) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'File not found' } });
      }
    } catch (err) {
      next(err);
    }
  });

  app.use(
    '/uploads',
    express.static(path.join(process.cwd(), 'uploads'), { dotfiles: 'deny', maxAge: '1h' }),
  );

  // All /api/v1 endpoints except /auth/* and public catalog require a JWT.
  // Routers mounted first carry their own per-route guards (incl. the public
  // catalog's optional auth), so the blanket authenticate runs after them.
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/courses', coursesRouter);
  app.use('/api/v1/modules', modulesRouter);
  app.use('/api/v1', lecturesRouter);
  app.use('/api/v1', enrollmentsRouter);
  app.use('/api/v1', progressRouter);
  app.use('/api/v1/quizzes', quizzesRouter);
  app.use('/api/v1', attemptsRouter);
  app.use('/api/v1', assignmentsRouter);
  app.use('/api/v1', gamificationRouter);
  app.use('/api/v1', masteryRouter);
  app.use('/api/v1/ai', aiRouter);
  app.use('/api/v1', recommendationsRouter);
  app.use('/api/v1', discussionsRouter);
  app.use('/api/v1', announcementsRouter);
  app.use('/api/v1', notificationsRouter);
  app.use('/api/v1', paymentsRouter);
  app.use('/api/v1', adminRouter);
  app.use('/api/v1', authenticate);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
