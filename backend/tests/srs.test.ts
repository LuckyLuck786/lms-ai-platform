import { describe, it, expect } from 'vitest';
import { NEW_CARD, schedule } from '../src/utils/srs';

const now = new Date('2026-10-24T10:00:00Z');
const days = (d: Date) => Math.round((d.getTime() - now.getTime()) / 86_400_000);

describe('SM-2 scheduling', () => {
  it('spaces a card out 1 → 6 → ~15 days as it keeps being answered "good"', () => {
    const a = schedule(NEW_CARD, 'good', now);
    expect([a.repetitions, a.intervalDays, days(a.dueAt)]).toEqual([1, 1, 1]);
    const b = schedule(a, 'good', now);
    expect(b.intervalDays).toBe(6);
    const c = schedule(b, 'good', now);
    expect(c.intervalDays).toBe(15); // 6 × 2.5
  });

  it('brings a missed card back within the session and resets its progress', () => {
    const learned = schedule(schedule(NEW_CARD, 'good', now), 'good', now);
    const missed = schedule(learned, 'again', now);
    expect(missed.repetitions).toBe(0);
    expect((missed.dueAt.getTime() - now.getTime()) / 60_000).toBe(10);
    expect(missed.ease).toBeLessThan(learned.ease);
  });

  it('never lets ease fall below 1.3', () => {
    let s = { ...NEW_CARD };
    for (let i = 0; i < 20; i++) s = schedule(s, 'again', now);
    expect(s.ease).toBe(1.3);
  });

  it('rewards "easy" and holds back "hard"', () => {
    const base = schedule(schedule(NEW_CARD, 'good', now), 'good', now);
    expect(schedule(base, 'easy', now).intervalDays).toBeGreaterThan(schedule(base, 'good', now).intervalDays);
    expect(schedule(base, 'hard', now).intervalDays).toBeLessThan(schedule(base, 'good', now).intervalDays);
  });
});
