import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { env } from './config/env';
import { generalRateLimiter } from './middleware/rateLimit';
import { errorHandler, notFoundHandler, requestLogger } from './middleware/errorHandler';
import { authenticate } from './middleware/auth';
import { authRouter } from './modules/auth/auth.router';
import { coursesRouter } from './modules/courses/courses.router';
import { enrollmentsRouter, modulesRouter } from './modules/enrollments/enrollments.router';
import { progressRouter } from './modules/progress/progress.router';
import { attemptsRouter, quizzesRouter } from './modules/quizzes/quizzes.router';
import { assignmentsRouter } from './modules/assignments/assignments.router';
import { gamificationRouter } from './modules/gamification/gamification.router';
import { aiRouter } from './modules/ai/ai.router';
import { discussionsRouter } from './modules/discussions/discussions.router';
import { announcementsRouter } from './modules/announcements/announcements.router';
import { notificationsRouter } from './modules/notifications/notifications.router';
import { adminRouter } from './modules/admin/admin.router';

export function createApp(): express.Express {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: env.corsOrigin, credentials: true }));
  app.use(express.json({ limit: '2mb' }));
  app.use(requestLogger);

  // Health check (observability requirement)
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'backend', time: new Date().toISOString() });
  });

  // 100 req/min/user on everything except /auth/* and /ai/chat/* (PRD §8.9)
  app.use('/api/v1', generalRateLimiter);

  // Uploaded assignment files + generated certificate PDFs
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
  app.use('/api/v1', enrollmentsRouter);
  app.use('/api/v1', progressRouter);
  app.use('/api/v1/quizzes', quizzesRouter);
  app.use('/api/v1', attemptsRouter);
  app.use('/api/v1', assignmentsRouter);
  app.use('/api/v1', gamificationRouter);
  app.use('/api/v1/ai', aiRouter);
  app.use('/api/v1', discussionsRouter);
  app.use('/api/v1', announcementsRouter);
  app.use('/api/v1', notificationsRouter);
  app.use('/api/v1', adminRouter);
  app.use('/api/v1', authenticate);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
