/**
 * Instructor analytics derivations (FR-I5) — pure helpers, unit tested.
 *
 * The SQL in courses.service gathers raw counts; these functions turn them
 * into the percentages the dashboard renders (drop-off, engagement, rates).
 */

/** 100% minus the share of starters who finished a lecture. 0 when nobody started. */
export function dropOffPercent(completions: number, learners: number): number {
  if (learners <= 0) return 0;
  const rate = Math.min(1, Math.max(0, completions / learners));
  return Math.round((1 - rate) * 10000) / 100;
}

/** Share of enrollees who finished the course. 0 enrolments → 0. */
export function completionRate(completed: number, enrolled: number): number {
  if (enrolled <= 0) return 0;
  const rate = Math.min(1, Math.max(0, completed / enrolled));
  return Math.round(rate * 10000) / 100;
}

/** Average watched time as a percentage of the lecture duration. 0-duration → 0. */
export function watchedPercent(avgWatchedSeconds: number, durationSeconds: number): number {
  if (durationSeconds <= 0) return 0;
  const rate = Math.min(1, Math.max(0, avgWatchedSeconds / durationSeconds));
  return Math.round(rate * 10000) / 100;
}

export interface LectureStatRow {
  id: string;
  title: string;
  module_title: string;
  duration_seconds: number | null;
  learners: number;
  completions: number;
  avg_watched_seconds: number;
}

export interface LectureStat extends LectureStatRow {
  duration_seconds: number;
  completion_rate: number;
  watched_percent: number;
  drop_off_percent: number;
}

/** Shape one raw lecture aggregate row for the dashboard. */
export function decorateLectureStat(row: LectureStatRow): LectureStat {
  const duration = row.duration_seconds ?? 0;
  return {
    ...row,
    duration_seconds: duration,
    completion_rate: completionRate(row.completions, row.learners),
    watched_percent: watchedPercent(row.avg_watched_seconds, duration),
    drop_off_percent: dropOffPercent(row.completions, row.learners),
  };
}
