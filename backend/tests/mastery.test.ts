import { describe, expect, it } from 'vitest';
import {
  computeMasteryScore,
  resolveDepth,
  MASTERY_QUIZ_WEIGHT,
  MASTERY_COMPLETION_WEIGHT,
} from '../src/utils/mastery';

const base = {
  module_id: 'm1',
  course_id: 'c1',
  quiz_avg: null as number | null,
  attempts: 0,
  completion_percent: 0,
};

describe('topic mastery scoring (FR-A8)', () => {
  it('blends quiz average and completion when quiz data exists', () => {
    const score = computeMasteryScore({ ...base, quiz_avg: 80, attempts: 3, completion_percent: 50 });
    expect(score).toBeCloseTo(80 * MASTERY_QUIZ_WEIGHT + 50 * MASTERY_COMPLETION_WEIGHT, 2);
  });

  it('weights completion only (at the completion weight) when no quiz was attempted', () => {
    // Watched everything, never tested → capped low so it never reads as mastery.
    expect(computeMasteryScore({ ...base, completion_percent: 100 })).toBe(
      100 * MASTERY_COMPLETION_WEIGHT,
    );
    expect(computeMasteryScore({ ...base, completion_percent: 0 })).toBe(0);
  });

  it('ignores a null quiz average even if attempts is non-zero', () => {
    const score = computeMasteryScore({ ...base, quiz_avg: null, attempts: 2, completion_percent: 40 });
    expect(score).toBeCloseTo(40 * MASTERY_COMPLETION_WEIGHT, 2);
  });

  it('clamps to the 0-100 range', () => {
    expect(computeMasteryScore({ ...base, quiz_avg: 150, attempts: 1, completion_percent: 200 })).toBe(100);
    expect(computeMasteryScore({ ...base, quiz_avg: -20, attempts: 1, completion_percent: -50 })).toBe(0);
  });

  it('rounds to two decimals', () => {
    const score = computeMasteryScore({ ...base, quiz_avg: 33.333, attempts: 3, completion_percent: 33.333 });
    expect(score).toBe(Math.round(score * 100) / 100);
  });
});

describe('difficulty band from mastery (FR-A6 + FR-A8)', () => {
  it('maps scores to beginner / intermediate / advanced', () => {
    expect(resolveDepth(0)).toBe('beginner');
    expect(resolveDepth(54.99)).toBe('beginner');
    expect(resolveDepth(55)).toBe('intermediate');
    expect(resolveDepth(79.99)).toBe('intermediate');
    expect(resolveDepth(80)).toBe('advanced');
    expect(resolveDepth(100)).toBe('advanced');
  });

  it('defaults to intermediate for missing scores', () => {
    expect(resolveDepth(null)).toBe('intermediate');
    expect(resolveDepth(undefined)).toBe('intermediate');
    expect(resolveDepth(Number.NaN)).toBe('intermediate');
  });
});
