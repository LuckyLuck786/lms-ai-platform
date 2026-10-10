import { describe, expect, it } from 'vitest';
import {
  completionRate,
  decorateLectureStat,
  dropOffPercent,
  watchedPercent,
} from '../src/modules/courses/analytics';

describe('instructor analytics derivations (FR-I5)', () => {
  it('computes drop-off as the share of starters who did not finish', () => {
    expect(dropOffPercent(7, 10)).toBe(30);
    expect(dropOffPercent(10, 10)).toBe(0);
    expect(dropOffPercent(0, 4)).toBe(100);
  });

  it('returns 0 drop-off when nobody started the lecture', () => {
    expect(dropOffPercent(0, 0)).toBe(0);
  });

  it('computes completion rate over enrolments', () => {
    expect(completionRate(3, 12)).toBe(25);
    expect(completionRate(0, 0)).toBe(0);
    expect(completionRate(5, 3)).toBe(100); // clamped
  });

  it('computes watched percentage against the lecture duration', () => {
    expect(watchedPercent(90, 100)).toBe(90);
    expect(watchedPercent(50, 0)).toBe(0); // text/unknown-duration lecture
    expect(watchedPercent(120, 100)).toBe(100); // clamped
  });

  it('decorates a raw lecture row with derived fields', () => {
    const stat = decorateLectureStat({
      id: 'l1',
      title: 'Quicksort',
      module_title: 'Sorting',
      duration_seconds: 200,
      learners: 8,
      completions: 6,
      avg_watched_seconds: 150,
    });
    expect(stat.duration_seconds).toBe(200);
    expect(stat.completion_rate).toBe(75);
    expect(stat.watched_percent).toBe(75);
    expect(stat.drop_off_percent).toBe(25);
  });

  it('treats a missing duration as 0 without dividing by zero', () => {
    const stat = decorateLectureStat({
      id: 'l2',
      title: 'Reading',
      module_title: 'Basics',
      duration_seconds: null,
      learners: 2,
      completions: 1,
      avg_watched_seconds: 30,
    });
    expect(stat.duration_seconds).toBe(0);
    expect(stat.watched_percent).toBe(0);
    expect(stat.drop_off_percent).toBe(50);
  });
});
