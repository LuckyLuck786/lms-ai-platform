import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { authenticate } from '../../middleware/auth';
import { aiChatRateLimiter } from '../../middleware/rateLimit';
import { env } from '../../config/env';
import { internal } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { queryOne } from '../../db/pool';
import { queueMasteryRecompute } from '../../jobs/queues';

/**
 * AI Tutor proxy (PRD §8.5). The FastAPI service stays internal: the backend
 * enforces JWT auth + the 20 req/min/user AI rate limit, then forwards the
 * request with the authenticated user's identity in headers.
 */

export const aiRouter = Router();

const AI_TIMEOUT_MS = 60_000;

/**
 * Headers every call to the AI service carries.
 *
 * `X-Internal-Token` proves the caller is this backend; the AI service rejects
 * requests without it whenever INTERNAL_API_TOKEN is configured. `X-Request-Id`
 * carries the originating request's correlation id (or a fresh one for
 * background jobs) so a slow AI answer can be joined to the request that
 * caused it across both services' logs. The user headers describe *who* the
 * request is for, never *whether* it is allowed.
 */
function internalHeaders(
  user?: { id: string; roles: string[] },
  requestId?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-request-id': requestId ?? randomRequestId(),
  };
  if (env.internalApiToken) headers['x-internal-token'] = env.internalApiToken;
  if (user) {
    headers['x-user-id'] = user.id;
    headers['x-user-roles'] = user.roles.join(',');
  }
  return headers;
}

/** Correlation id for calls made outside any request context (queues, jobs). */
function randomRequestId(): string {
  return `job-${crypto.randomUUID()}`;
}

async function forward(req: Request, res: Response, targetPath: string): Promise<void> {
  const url = `${env.aiServiceUrl}${targetPath}`;
  try {
    // The AI service (FastAPI) uses snake_case; the backend API uses camelCase.
    // Transform the body for chat endpoints so field names match.
    let body: string | undefined;
    if (!['GET', 'HEAD'].includes(req.method) && req.body) {
      const raw = req.body;
      // Transform camelCase → snake_case for ai-service chat APIs
      if (targetPath.includes('/api/v1/ai/chat/sessions')) {
        const transformed: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(raw)) {
          const snake = key.replace(/[A-Z]/g, (l) => '_' + l.toLowerCase());
          transformed[snake] = value;
        }
        body = JSON.stringify(transformed);
      } else {
        body = JSON.stringify(raw);
      }
    }
    const upstream = await fetch(url, {
      method: req.method,
      headers: internalHeaders(req.user!, req.requestId),
      body,
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
  (pathBuilder: (req: Request) => string | Promise<string>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const targetPath = await pathBuilder(req);
      await forward(req, res, targetPath);
    } catch (err) {
      next(err);
    }
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
  wrap(async (req) => {
    // PRD §9.2 step 5: a background job refreshes the learner's topic-mastery
    // scores after each tutor interaction (deduplicated by user+course).
    const session = await queryOne<{ course_id: string }>(
      'SELECT course_id FROM ai_chat_sessions WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user!.id],
    ).catch(() => null);
    if (session) {
      await queueMasteryRecompute({ userId: req.user!.id, courseId: session.course_id });
    }
    return `/api/v1/ai/chat/sessions/${req.params.id}/messages`;
  }),
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
 * Ask the AI service to transcribe an uploaded lecture video (PRD §9.3).
 *
 * Exported from the router alongside `triggerIngestion` for the same reason:
 * the job worker must not import the routers. Resolves the media URL itself so
 * the AI service never has to construct a backend-relative path it cannot
 * fetch, and re-checks the row first — the lecture may have gained a
 * transcript (or lost its video) since the job was queued.
 */
export async function requestTranscription(lectureId: string): Promise<void> {
  const lecture = await queryOne<{
    transcript: string | null;
    video_url: string | null;
  }>('SELECT transcript, video_url FROM lectures WHERE id = $1', [lectureId]);

  if (!lecture) {
    logger.warn('transcription_skipped', { lecture_id: lectureId, reason: 'lecture not found' });
    return;
  }
  if (lecture.transcript?.trim()) {
    logger.info('transcription_skipped', { lecture_id: lectureId, reason: 'already has transcript' });
    return;
  }
  if (!lecture.video_url) {
    logger.info('transcription_skipped', { lecture_id: lectureId, reason: 'no video' });
    return;
  }

  const upstream = await fetch(`${env.aiServiceUrl}/api/v1/ai/internal/transcribe`, {
    method: 'POST',
    headers: internalHeaders(),
    body: JSON.stringify({
      lecture_id: lectureId,
      media_url: absoluteMediaUrl(lecture.video_url),
    }),
    // Speech-to-text on a real lecture takes minutes, not seconds.
    signal: AbortSignal.timeout(600_000),
  });

  const text = await upstream.text();
  if (!upstream.ok) {
    // Throwing lets BullMQ retry with backoff rather than losing the lecture.
    throw new Error(
      `transcription failed: HTTP ${upstream.status} ${text.slice(0, 400)}`,
    );
  }
  logger.info('transcription_done', { lecture_id: lectureId, response: text.slice(0, 500) });
}

/**
 * Turn a stored `/uploads/...` path into an absolute URL.
 *
 * Absolute, object and data URLs pass through; anything else would resolve
 * against the AI service's own origin and 404.
 */
function absoluteMediaUrl(storedUrl: string): string {
  if (/^(https?:|data:|blob:)/i.test(storedUrl)) return storedUrl;
  const path = storedUrl.startsWith('/') ? storedUrl : `/${storedUrl}`;
  return `${env.publicApiUrl}${path}`;
}

/**
 * Fire-and-forget ingestion trigger used by lecture creation.
 * Exported from the router to avoid a circular dependency with ai.service.
 */
export async function triggerIngestion(lectureId: string): Promise<void> {
  try {
    const upstream = await fetch(`${env.aiServiceUrl}/api/v1/ai/internal/ingest`, {
      method: 'POST',
      headers: internalHeaders(),
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
