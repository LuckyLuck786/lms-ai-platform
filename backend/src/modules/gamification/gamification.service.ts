import { query, queryOne } from '../../db/pool';
import { awardBadge } from '../../utils/badges';
import { applyActivity, evaluateStreak, isoDate, qualifiesForSevenDayStreak, StreakState } from '../../utils/streak';
import { logger } from '../../utils/logger';

/**
 * Streak + gamification service (FR-S9, daily cron per PRD §9.3).
 */

export async function getStreak(userId: string): Promise<StreakState> {
  const row = await queryOne<{ current_streak: number; longest_streak: number; last_active_date: string | null }>(
    'SELECT current_streak, longest_streak, last_active_date FROM streaks WHERE user_id = $1',
    [userId],
  );
  const state: StreakState = {
    current_streak: row?.current_streak ?? 0,
    longest_streak: row?.longest_streak ?? 0,
    last_active_date: row?.last_active_date ? isoDate(new Date(row.last_active_date)) : null,
  };
  return state;
}

/**
 * Call on every meaningful learning activity (progress update, quiz submit).
 * Idempotent within a day; extends or resets the streak accordingly.
 */
export async function touchStreak(userId: string): Promise<StreakState> {
  const state = await getStreak(userId);
  const next = applyActivity(state);

  if (next.last_active_date === state.last_active_date && next.current_streak === state.current_streak) {
    return state; // no change needed today
  }

  await query(
    `INSERT INTO streaks (user_id, current_streak, longest_streak, last_active_date)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE
       SET current_streak = EXCLUDED.current_streak,
           longest_streak = GREATEST(streaks.longest_streak, EXCLUDED.longest_streak),
           last_active_date = EXCLUDED.last_active_date`,
    [userId, next.current_streak, next.longest_streak, next.last_active_date],
  );

  if (qualifiesForSevenDayStreak(next)) {
    await awardBadge(userId, 'seven_day_streak');
  }
  return next;
}

/**
 * Daily cron job: zero out broken streaks across the platform (PRD §9.3).
 * Returns the number of streaks reset, for logging.
 */
export async function evaluateAllStreaks(today: string = isoDate(new Date())): Promise<number> {
  const rows = await query<{ user_id: string; current_streak: number; longest_streak: number; last_active_date: string | null }>(
    'SELECT user_id, current_streak, longest_streak, last_active_date FROM streaks',
  );
  let reset = 0;
  for (const row of rows) {
    const state: StreakState = {
      current_streak: row.current_streak,
      longest_streak: row.longest_streak,
      last_active_date: row.last_active_date ? isoDate(new Date(row.last_active_date)) : null,
    };
    const next = evaluateStreak(state, today);
    if (next.current_streak !== state.current_streak) {
      await query('UPDATE streaks SET current_streak = $2 WHERE user_id = $1', [
        row.user_id,
        next.current_streak,
      ]);
      reset += 1;
    }
  }
  logger.info('streak_evaluation_done', { today, reset });
  return reset;
}
