import { query } from '../db/pool';
import { logger } from './logger';

/**
 * Per-topic (per-module) mastery tracking — FR-A8, PRD §9.2 step 5.
 *
 * Mastery blends the two signals the platform already records honestly:
 *
 *   - quiz performance  (70%): average submitted-attempt score on the
 *     module's quizzes, so it reacts to what the learner actually demonstrates;
 *   - lecture completion ( 30%): watched/total lectures in the module, so a
 *     learner who studies but hasn't quizzed yet still shows a score.
 *
 * Rows are (user, module) unique and upserted. Recomputation runs as a
 * background BullMQ job (queue "mastery") after quiz submissions, lecture
 * completions and AI-tutor interactions, exactly as PRD §9.2 step 5 describes.
 */

export const MASTERY_QUIZ_WEIGHT = 0.7;
export const MASTERY_COMPLETION_WEIGHT = 0.3;

/** One computed module row before it is persisted. Pure — unit tested. */
export interface ModuleMasteryInput {
  module_id: string;
  course_id: string;
  quiz_avg: number | null; // mean of submitted attempt scores, null if none
  attempts: number;
  completion_percent: number; // 0-100
}

export interface ModuleMastery extends ModuleMasteryInput {
  mastery_score: number; // 0-100, rounded to 2 decimals
}

/** Blend quiz average + completion into a 0-100 mastery score (pure). */
export function computeMasteryScore(input: ModuleMasteryInput): number {
  const hasQuiz = input.attempts > 0 && input.quiz_avg !== null && input.quiz_avg !== undefined;
  // No quiz data yet → completion alone carries the score at the completion
  // weight, so "watched but never tested" never reads as real mastery.
  const score = hasQuiz
    ? (input.quiz_avg as number) * MASTERY_QUIZ_WEIGHT +
      input.completion_percent * MASTERY_COMPLETION_WEIGHT
    : input.completion_percent * MASTERY_COMPLETION_WEIGHT;
  return Math.min(100, Math.max(0, Math.round(score * 100) / 100));
}

/**
 * Map a mastery score to the chat/quiz difficulty band (FR-A6/FR-A8).
 * Kept in one place so backend, ai-service and demo mode agree.
 */
export function resolveDepth(mastery: number | null | undefined): 'beginner' | 'intermediate' | 'advanced' {
  if (mastery === null || mastery === undefined || Number.isNaN(mastery)) return 'intermediate';
  if (mastery < 55) return 'beginner';
  if (mastery < 80) return 'intermediate';
  return 'advanced';
}

/**
 * Recompute and persist mastery rows for one learner's course.
 * Safe to call repeatedly — it upserts in a single pass per module.
 */
export async function recomputeTopicMastery(userId: string, courseId: string): Promise<ModuleMastery[]> {
  const rows = await query<ModuleMasteryInput>(
    `WITH module_stats AS (
       SELECT m.id AS module_id,
              m.course_id,
              COALESCE((
                 SELECT AVG(qa.score)
                 FROM quizzes q
                 JOIN quiz_attempts qa ON qa.quiz_id = q.id
                 WHERE q.module_id = m.id
                   AND qa.user_id = $1
                   AND qa.submitted_at IS NOT NULL
                   AND qa.score IS NOT NULL
               ), 0)::float AS quiz_avg,
              COALESCE((
                 SELECT COUNT(*)
                 FROM quizzes q
                 JOIN quiz_attempts qa ON qa.quiz_id = q.id
                 WHERE q.module_id = m.id
                   AND qa.user_id = $1
                   AND qa.submitted_at IS NOT NULL
               ), 0)::int AS attempts,
              COALESCE((
                 SELECT 100.0 * COUNT(*) FILTER (WHERE lp.completed) / NULLIF(COUNT(*), 0)
                 FROM lectures l
                 LEFT JOIN lecture_progress lp
                        ON lp.lecture_id = l.id
                       AND lp.enrollment_id IN (SELECT id FROM enrollments WHERE user_id = $1 AND course_id = m.course_id)
                 WHERE l.module_id = m.id
               ), 0)::float AS completion_percent
       FROM modules m
       WHERE m.course_id = $2
     )
     SELECT module_id, course_id, quiz_avg, attempts, completion_percent
     FROM module_stats
     ORDER BY module_id`,
    [userId, courseId],
  );

  const scored: ModuleMastery[] = [];
  for (const row of rows) {
    const mastery = computeMasteryScore(row);
    scored.push({ ...row, mastery_score: mastery });
    await query(
      `INSERT INTO topic_mastery (user_id, course_id, module_id, mastery_score, quiz_avg, completion_percent, attempts, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (user_id, module_id) DO UPDATE SET
         mastery_score = EXCLUDED.mastery_score,
         quiz_avg = EXCLUDED.quiz_avg,
         completion_percent = EXCLUDED.completion_percent,
         attempts = EXCLUDED.attempts,
         updated_at = now()`,
      [userId, courseId, row.module_id, mastery, row.quiz_avg, row.completion_percent, row.attempts],
    );
  }
  return scored;
}

/** Background-job entry point: never throws into the caller. */
export async function recomputeTopicMasterySafe(userId: string, courseId: string): Promise<void> {
  try {
    await recomputeTopicMastery(userId, courseId);
  } catch (err) {
    logger.warn('mastery_recompute_failed', {
      user_id: userId,
      course_id: courseId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
