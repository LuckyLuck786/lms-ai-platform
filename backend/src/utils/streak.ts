/**
 * Pure streak arithmetic used by activity touches and the daily cron job.
 * A user stays "on a streak" if their last active date was yesterday;
 * activity today is a no-op, a gap resets to day 1.
 */

export interface StreakState {
  current_streak: number;
  longest_streak: number;
  last_active_date: string | null; // ISO date (YYYY-MM-DD)
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

/** Computes the streak after activity on `today` (defaults to UTC today). */
export function applyActivity(state: StreakState, today: string = isoDate(new Date())): StreakState {
  if (state.last_active_date === today) {
    return state; // already counted today
  }

  let current = 1;
  if (state.last_active_date && state.last_active_date === addDays(today, -1)) {
    current = state.current_streak + 1;
  }

  return {
    current_streak: current,
    longest_streak: Math.max(state.longest_streak, current),
    last_active_date: today,
  };
}

/**
 * Daily cron evaluation: a streak is broken when the last active day is
 * older than yesterday (no activity since the day before yesterday).
 */
export function evaluateStreak(state: StreakState, today: string = isoDate(new Date())): StreakState {
  if (!state.last_active_date || state.last_active_date < addDays(today, -1)) {
    return { ...state, current_streak: 0 };
  }
  return state;
}

export function qualifiesForSevenDayStreak(state: StreakState): boolean {
  return state.longest_streak >= 7;
}
