import { query, queryOne } from '../db/pool';
import { logger } from './logger';

/**
 * Gamification helpers: badge awards + streak touches (FR-S9).
 * All award paths are idempotent (user_badges PK) and emit an in-app
 * notification so the UI can surface the milestone.
 */

async function notify(userId: string, title: string, body: string): Promise<void> {
  await query('INSERT INTO notifications (user_id, title, body) VALUES ($1, $2, $3)', [
    userId,
    title,
    body,
  ]);
}

export async function awardBadge(userId: string, badgeName: string): Promise<boolean> {
  try {
    const badge = await queryOne<{ id: number; name: string; description: string | null }>(
      'SELECT id, name, description FROM badges WHERE name = $1',
      [badgeName],
    );
    if (!badge) return false;

    const inserted = await query(
      'INSERT INTO user_badges (user_id, badge_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING badge_id',
      [userId, badge.id],
    );
    if (inserted.length === 0) return false; // already earned

    await notify(userId, `Badge earned: ${badge.name}`, badge.description ?? 'Keep it up!');
    logger.info('badge_awarded', { user_id: userId, badge: badgeName });
    return true;
  } catch (err) {
    logger.warn('badge_award_failed', {
      user_id: userId,
      badge: badgeName,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export async function getUserBadges(userId: string) {
  return query(
    `SELECT b.id, b.name, b.description, b.icon_url, ub.earned_at
     FROM user_badges ub JOIN badges b ON b.id = ub.badge_id
     WHERE ub.user_id = $1
     ORDER BY ub.earned_at DESC`,
    [userId],
  );
}
