import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/db/pool', () => ({ query: vi.fn(), queryOne: vi.fn(), pool: {} }));
vi.mock('../src/db/redis', () => ({ redis: {}, cacheGet: vi.fn(), cacheSet: vi.fn(), cacheDel: vi.fn() }));
vi.mock('../src/jobs/queues', () => ({ queueEmail: vi.fn() }));

const { riskReasons } = await import('../src/modules/insights/atRisk.router');
const { joinWindow } = await import('../src/modules/live/live.router');

describe('at-risk thresholds', () => {
  const base = { progress: 50, daysInactive: 0, daysEnrolled: 3, avgScore: 80 };
  it('flags 7+ days of inactivity', () => {
    expect(riskReasons({ ...base, daysInactive: 6 })).toEqual([]);
    expect(riskReasons({ ...base, daysInactive: 7 })).toEqual(['inactive']);
  });
  it('flags a quiz average under 50 % but not "no quizzes yet"', () => {
    expect(riskReasons({ ...base, avgScore: 49 })).toEqual(['low_scores']);
    expect(riskReasons({ ...base, avgScore: null })).toEqual([]);
  });
  it('flags learners stalled under 25 % after two weeks', () => {
    expect(riskReasons({ ...base, daysEnrolled: 14, progress: 24 })).toEqual(['stalled']);
    expect(riskReasons({ ...base, daysEnrolled: 13, progress: 0 })).toEqual([]);
  });
  it('never flags someone who finished the course', () => {
    expect(riskReasons({ progress: 100, daysInactive: 90, daysEnrolled: 90, avgScore: 10 })).toEqual([]);
  });
});

describe('live class join window', () => {
  const start = new Date('2026-10-24T10:00:00Z');
  it('opens 15 minutes early and closes at the end', () => {
    expect(joinWindow(start, 60, new Date('2026-10-24T09:44:00Z'))).toBe('early');
    expect(joinWindow(start, 60, new Date('2026-10-24T09:45:00Z'))).toBe('open');
    expect(joinWindow(start, 60, new Date('2026-10-24T11:00:00Z'))).toBe('open');
    expect(joinWindow(start, 60, new Date('2026-10-24T11:00:01Z'))).toBe('ended');
  });
});
