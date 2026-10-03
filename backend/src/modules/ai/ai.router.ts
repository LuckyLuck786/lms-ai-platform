import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middleware/auth';
import { aiChatRateLimiter } from '../../middleware/rateLimit';
import { env } from '../../config/env';
import { internal } from '../../utils/errors';
import { logger } from '../../utils/logger';

/**
 * AI Tutor proxy (PRD §8.5). The FastAPI service stays internal: the backend
 * enforces JWT auth + the 20 req/min/user AI rate limit, then forwards the
 * request with the authenticated user's identity in headers.
 */

export const aiRouter = Router();

const AI_TIMEOUT_MS = 60_000;

async function forward(req: Request, res: Response, targetPath: string): Promise<void> {
  const url = `${env.aiServiceUrl}${targetPath}`;
  try {
    const upstream = await fetch(url, {
      method: req.method,
      headers: {
        'content-type': 'application/json',
        'x-user-id': req.user!.id,
        'x-user-roles': req.user!.roles.join(','),
      },
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body ?? {}),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    });
    const text = await upstream.text();
    res.status(upstream.status).type('application/json').send(text || '{}');
  } catch (err) {
    logger.error('ai_proxy_failed', {
      path: targetPath,
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(502).json({
      error: {
        code: 'AI_SERVICE_UNAVAILABLE',
        message: 'AI service is unavailable — is ai-service running on port 8000?',
      },
    });
  }
}

const wrap =
  (pathBuilder: (req: Request) => string) =>
  (req: Request, res: Response, next: NextFunction) => {
    forward(req, res, pathBuilder(req)).catch(next);
  };

// Chat endpoints apply authenticate + the 20/min/user AI limit per route.

aiRouter.post('/chat/sessions', authenticate, aiChatRateLimiter, wrap(() => `/api/v1/ai/chat/sessions`));
aiRouter.get('/chat/sessions', authenticate, aiChatRateLimiter, wrap(() => `/api/v1/ai/chat/sessions`));
aiRouter.get(
  '/chat/sessions/:id/messages',
  authenticate,
  aiChatRateLimiter,
  wrap((req) => `/api/v1/ai/chat/sessions/${req.params.id}/messages`),
);
aiRouter.post(
  '/chat/sessions/:id/messages',
  authenticate,
  aiChatRateLimiter,
  wrap((req) => `/api/v1/ai/chat/sessions/${req.params.id}/messages`),
);
aiRouter.put(
  '/chat/sessions/:id/mode',
  authenticate,
  aiChatRateLimiter,
  wrap((req) => `/api/v1/ai/chat/sessions/${req.params.id}/mode`),
);

// Content generation + recommendations
aiRouter.post('/lectures/:id/summarize', authenticate, wrap((req) => `/api/v1/ai/lectures/${req.params.id}/summarize`));
aiRouter.post(
  '/lectures/:id/generate-quiz',
  authenticate,
  wrap((req) => `/api/v1/ai/lectures/${req.params.id}/generate-quiz`),
);
aiRouter.post('/modules/:id/flashcards', authenticate, wrap((req) => `/api/v1/ai/modules/${req.params.id}/flashcards`));
aiRouter.post('/study-plan', authenticate, wrap(() => `/api/v1/ai/study-plan`));
aiRouter.get('/recommendations', authenticate, wrap(() => `/api/v1/ai/recommendations`));

/**
 * Fire-and-forget ingestion trigger used by lecture creation.
 * Exported from the router to avoid a circular dependency with ai.service.
 */
export async function triggerIngestion(lectureId: string): Promise<void> {
  try {
    const upstream = await fetch(`${env.aiServiceUrl}/api/v1/ai/internal/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lecture_id: lectureId }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!upstream.ok) {
      logger.warn('ingestion_trigger_failed', { lecture_id: lectureId, status: upstream.status });
    } else {
      logger.info('ingestion_triggered', { lecture_id: lectureId });
    }
  } catch (err) {
    logger.warn('ingestion_trigger_unreachable', {
      lecture_id: lectureId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
