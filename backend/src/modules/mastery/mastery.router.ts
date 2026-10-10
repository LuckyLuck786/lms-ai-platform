import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middleware/auth';
import { query } from '../../db/pool';
import { resolveDepth, recomputeTopicMasterySafe } from '../../utils/mastery';

/**
 * Topic-mastery surface (FR-A8): per-module mastery scores for the current
 * learner, with the difficulty band each score maps to (FR-A6).
 */
export const masteryRouter = Router();

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

/**
 * GET /users/me/mastery?course_id= — per-topic mastery rows (FR-A8).
 *
 * With `course_id` the rows are recomputed first so the answer is fresh even
 * when the background queue has not run yet; without it the stored rows are
 * returned as-is (cheap for dashboards listing every course).
 */
masteryRouter.get(
  '/users/me/mastery',
  authenticate,
  wrap(async (req, res) => {
    const courseId = typeof req.query.course_id === 'string' ? req.query.course_id : '';
    if (courseId) await recomputeTopicMasterySafe(req.user!.id, courseId);

    const params: unknown[] = [req.user!.id];
    let where = 'tm.user_id = $1';
    if (courseId) {
      params.push(courseId);
      where += ' AND tm.course_id = $2';
    }

    const items = await query(
      `SELECT tm.course_id, tm.module_id, m.title AS module_title,
              tm.mastery_score, tm.quiz_avg, tm.completion_percent,
              tm.attempts, tm.updated_at
       FROM topic_mastery tm
       JOIN modules m ON m.id = tm.module_id
       WHERE ${where}
       ORDER BY m.order_index, m.title`,
      params,
    );

    res.json({
      items: (items as Record<string, unknown>[]).map((row) => ({
        ...row,
        depth: resolveDepth(Number(row.mastery_score)),
      })),
    });
  }),
);
