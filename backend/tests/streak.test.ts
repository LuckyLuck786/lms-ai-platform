import { describe, expect, it } from 'vitest';
import { applyActivity, evaluateStreak, qualifiesForSevenDayStreak } from '../src/utils/streak';

const state = (current: number, longest: number, last: string | null) => ({
  current_streak: current,
  longest_streak: longest,
  last_active_date: last,
});

describe('streak logic (FR-S9 + daily cron)', () => {
  it('starts a streak at 1 on first activity', () => {
    expect(applyActivity(state(0, 0, null), '2026-10-03')).toEqual({
      current_streak: 1,
      longest_streak: 1,
      last_active_date: '2026-10-03',
    });
  });

  it('increments when the last activity was yesterday', () => {
    expect(applyActivity(state(3, 3, '2026-10-02'), '2026-10-03').current_streak).toBe(4);
  });

  it('is a no-op when already active today', () => {
    expect(applyActivity(state(5, 5, '2026-10-03'), '2026-10-03').current_streak).toBe(5);
  });

  it('resets to 1 after a gap', () => {
    expect(applyActivity(state(6, 6, '2026-09-30'), '2026-10-03').current_streak).toBe(1);
  });

  it('keeps the all-time longest streak', () => {
    expect(applyActivity(state(2, 10, '2026-10-02'), '2026-10-03').longest_streak).toBe(10);
  });

  it('daily evaluation zeroes broken streaks only', () => {
    expect(evaluateStreak(state(4, 4, '2026-10-01'), '2026-10-03').current_streak).toBe(0);
    expect(evaluateStreak(state(4, 4, '2026-10-02'), '2026-10-03').current_streak).toBe(4);
    expect(evaluateStreak(state(4, 4, '2026-10-03'), '2026-10-03').current_streak).toBe(4);
    expect(evaluateStreak(state(4, 4, null), '2026-10-03').current_streak).toBe(0);
  });

  it('awards the 7-day badge at longest >= 7', () => {
    expect(qualifiesForSevenDayStreak(state(7, 7, '2026-10-03'))).toBe(true);
    expect(qualifiesForSevenDayStreak(state(2, 6, '2026-10-03'))).toBe(false);
  });
});
