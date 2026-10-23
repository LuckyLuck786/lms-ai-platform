import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { authenticate, requireRole } from '../../middleware/auth';
import { aiChatRateLimiter } from '../../middleware/rateLimit';
import { env } from '../../config/env';
import { badRequest, forbidden, notFound } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { query, queryOne } from '../../db/pool';
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
// Quiz drafts are written into the course, so only its instructor or an admin
// may generate one (PRD §11: students cannot create AI quizzes).
aiRouter.post(
  '/lectures/:id/generate-quiz',
  authenticate,
  requireRole('instructor', 'admin'),
  wrap(async (req) => {
    const lecture = await queryOne<{ instructor_id: string }>(
      `SELECT c.instructor_id FROM lectures l
       JOIN modules m ON m.id = l.module_id
       JOIN courses c ON c.id = m.course_id
       WHERE l.id = $1`,
      [req.params.id],
    );
    if (!lecture) throw notFound('Lecture not found');
    if (lecture.instructor_id !== req.user!.id && !req.user!.roles.includes('admin')) {
      throw forbidden('You do not own this course');
    }
    return `/api/v1/ai/lectures/${req.params.id}/generate-quiz`;
  }),
);
aiRouter.post('/modules/:id/flashcards', authenticate, wrap((req) => `/api/v1/ai/modules/${req.params.id}/flashcards`));
aiRouter.post('/study-plan', authenticate, wrap(() => `/api/v1/ai/study-plan`));
aiRouter.get('/recommendations', authenticate, wrap(() => `/api/v1/ai/recommendations`));

/**
 * POST /ai/attempts/:attemptId/questions/:questionId/explain — "Explain my
 * mistake". Only for the learner's own submitted attempt and a question they
 * got wrong. The AI service receives the question with every option marked
 * correct/chosen, retrieves course material and explains; the result is
 * cached per attempt+question, so reopening it costs no LLM call.
 */
aiRouter.post(
  '/attempts/:attemptId/questions/:questionId/explain',
  authenticate,
  aiChatRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { attemptId, questionId } = req.params;
      const answer = await queryOne<{
        user_id: string;
        submitted_at: Date | null;
        is_correct: boolean | null;
        selected_option_ids: string[] | null;
        text_answer: string | null;
        question_text: string;
        question_type: string;
        course_id: string;
        course_title: string;
      }>(
        `SELECT a.user_id, a.submitted_at, qa.is_correct, qa.selected_option_ids, qa.text_answer,
                q.question_text, q.question_type, c.id AS course_id, c.title AS course_title
         FROM quiz_attempts a
         JOIN quiz_answers qa ON qa.attempt_id = a.id AND qa.question_id = $2
         JOIN quiz_questions q ON q.id = qa.question_id
         JOIN quizzes z ON z.id = a.quiz_id
         JOIN modules m ON m.id = z.module_id
         JOIN courses c ON c.id = m.course_id
         WHERE a.id = $1`,
        [attemptId, questionId],
      );
      if (!answer || answer.user_id !== req.user!.id) throw notFound('Answer not found');
      if (!answer.submitted_at) throw badRequest('Submit the quiz before asking for explanations');
      if (answer.is_correct) throw badRequest('This answer was correct — there is no mistake to explain');

      const cached = await queryOne<{ explanation: string; source_lecture_ids: string[] | null }>(
        'SELECT explanation, source_lecture_ids FROM quiz_explanations WHERE attempt_id = $1 AND question_id = $2',
        [attemptId, questionId],
      );
      if (cached) {
        const sources = cached.source_lecture_ids?.length
          ? await query<{ lecture_id: string; lecture_title: string }>(
              'SELECT id AS lecture_id, title AS lecture_title FROM lectures WHERE id = ANY($1)',
              [cached.source_lecture_ids],
            )
          : [];
        res.json({ explanation: cached.explanation, sources, cached: true });
        return;
      }

      const options = await query<{ id: string; option_text: string; is_correct: boolean }>(
        'SELECT id, option_text, is_correct FROM quiz_options WHERE question_id = $1 ORDER BY id',
        [questionId],
      );
      const chosen = new Set(answer.selected_option_ids ?? []);
      const upstream = await fetch(`${env.aiServiceUrl}/api/v1/ai/internal/explain`, {
        method: 'POST',
        headers: internalHeaders(req.user!, req.requestId),
        body: JSON.stringify({
          course_id: answer.course_id,
          course_title: answer.course_title,
          question_text: answer.question_text,
          question_type: answer.question_type,
          text_answer: answer.text_answer,
          options:
            answer.question_type === 'short_answer'
              ? []
              : options.map((o) => ({ text: o.option_text, is_correct: o.is_correct, chosen: chosen.has(o.id) })),
        }),
        signal: AbortSignal.timeout(AI_TIMEOUT_MS),
      });
      if (!upstream.ok) {
        res.status(502).json({ error: { code: 'AI_SERVICE_UNAVAILABLE', message: 'The AI tutor is unavailable — try again shortly' } });
        return;
      }
      const result = (await upstream.json()) as {
        explanation: string;
        sources: { lecture_id: string; lecture_title: string }[];
        demo_mode?: boolean;
      };
      if (!result.demo_mode) {
        await query(
          `INSERT INTO quiz_explanations (attempt_id, question_id, explanation, source_lecture_ids)
           VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [attemptId, questionId, result.explanation, result.sources.map((x) => x.lecture_id)],
        );
      }
      res.json({ explanation: result.explanation, sources: result.sources, cached: false });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /recommendations/me — the path PRD §8.6 specifies. Same handler as
 * /ai/recommendations, which the SPA already calls; both stay supported.
 */
export const recommendationsRouter = Router();
recommendationsRouter.get(
  '/recommendations/me',
  authenticate,
  wrap(() => `/api/v1/ai/recommendations`),
);

/**
 * Ask the AI service to transcribe an uploaded lecture video (PRD §9.3).
 *
 * Exported from the router alongside `requestIngestion` for the same reason:
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
 * Nightly recommendation recalculation (PRD §9.3), called by the scheduled
 * worker job. The AI service owns the scoring and walks every learner itself;
 * a non-2xx throws so BullMQ records the failure and retries with backoff.
 */
export async function requestRecommendationRecompute(): Promise<{
  users: number;
  updated: number;
  failed: number;
}> {
  const upstream = await fetch(`${env.aiServiceUrl}/api/v1/ai/internal/recommendations/recompute`, {
    method: 'POST',
    headers: internalHeaders(),
    // Every learner costs an embedding call; a large platform takes minutes.
    signal: AbortSignal.timeout(900_000),
  });
  const text = await upstream.text();
  if (!upstream.ok) {
    throw new Error(`recommendation recompute failed: HTTP ${upstream.status} ${text.slice(0, 400)}`);
  }
  const summary = JSON.parse(text) as { users: number; updated: number; failed: number };
  logger.info('recommendations_recomputed', summary);
  return summary;
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
 * Chunk + embed a lecture for RAG — run by the `ingestion` queue worker.
 * Exported from the router (like `requestTranscription`) so the worker does
 * not import route modules. Throws on failure so BullMQ retries with backoff.
 */
export async function requestIngestion(lectureId: string): Promise<void> {
  const upstream = await fetch(`${env.aiServiceUrl}/api/v1/ai/internal/ingest`, {
    method: 'POST',
    headers: internalHeaders(),
    body: JSON.stringify({ lecture_id: lectureId }),
    // Embedding a long transcript is many provider calls.
    signal: AbortSignal.timeout(120_000),
  });
  const text = await upstream.text();
  if (!upstream.ok) {
    throw new Error(`ingestion failed: HTTP ${upstream.status} ${text.slice(0, 400)}`);
  }
  logger.info('ingestion_done', { lecture_id: lectureId, response: text.slice(0, 300) });
}
