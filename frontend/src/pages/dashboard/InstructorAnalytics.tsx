import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, apiErrorMessage } from '../../services/api';
import { Alert, Card, Spinner } from '../../components/common/ui';
import { Course } from '../../utils/types';
import { useI18n } from '../../utils/i18n';

interface LectureStat {
  id: string;
  title: string;
  module_title: string;
  duration_seconds: number;
  learners: number;
  completions: number;
  avg_watched_seconds: number;
  completion_rate: number;
  watched_percent: number;
  drop_off_percent: number;
}

interface QuizStat {
  id: string;
  title: string;
  module_title: string;
  attempts: number;
  learners: number;
  avg_score: number;
}

interface Analytics {
  course_id: string;
  overview: {
    enrollments: number;
    active_learners: number;
    completion_rate: number;
    avg_progress_percent: number;
    avg_quiz_score: number;
    attempts: number;
    watch_hours: number;
  };
  lectures: LectureStat[];
  quizzes: QuizStat[];
}

const fmtTime = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <Card className="!p-4">
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </Card>
  );
}

/**
 * Instructor analytics (FR-I5): per-lecture drop-off, average quiz scores
 * and time-on-task for one owned course.
 */
export default function InstructorAnalytics({ courses }: { courses: Course[] }) {
  const { t } = useI18n();
  const [courseId, setCourseId] = useState<string>('');

  useEffect(() => {
    if (!courseId && courses.length) setCourseId(courses[0].id);
  }, [courses, courseId]);

  const analytics = useQuery({
    queryKey: ['course-analytics', courseId],
    queryFn: async () =>
      (await api.get<Analytics>(`/courses/${courseId}/analytics`)).data,
    enabled: Boolean(courseId),
  });

  if (courses.length === 0) return null;

  const data = analytics.data;
  const worstDropOff = (data?.lectures ?? []).reduce(
    (max, lec) => Math.max(max, lec.drop_off_percent),
    0,
  );

  return (
    <section aria-label={t('instructor.analytics')} className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{t('instructor.analytics')}</h2>
        <p className="text-sm text-slate-500">{t('instructor.analyticsHint')}</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="analytics-course" className="label mb-0">
          {t('instructor.selectCourse')}
        </label>
        <select
          id="analytics-course"
          className="input w-full max-w-sm"
          value={courseId}
          onChange={(e) => setCourseId(e.target.value)}
        >
          {courses.map((c) => (
            <option key={c.id} value={c.id}>{c.title}</option>
          ))}
        </select>
      </div>

      {analytics.isLoading && (
        <div className="flex justify-center py-6"><Spinner /></div>
      )}
      {analytics.isError && <Alert>{apiErrorMessage(analytics.error)}</Alert>}

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Kpi label={t('instructor.enrolled')} value={data.overview.enrollments} />
            <Kpi
              label={t('instructor.completionRate')}
              value={`${Number(data.overview.completion_rate)}%`}
            />
            <Kpi
              label={t('instructor.avgProgress')}
              value={`${Number(data.overview.avg_progress_percent)}%`}
            />
            <Kpi
              label={t('instructor.avgQuizScore')}
              value={`${Number(data.overview.avg_quiz_score)}%`}
            />
            <Kpi label={t('instructor.quizAttempts')} value={data.overview.attempts} />
            <Kpi
              label={t('instructor.watchHours')}
              value={Number(data.overview.watch_hours)}
            />
          </div>

          <Card>
            <h3 className="mb-3 font-semibold">{t('instructor.lectureDropoff')}</h3>
            {data.lectures.length === 0 ? (
              <p className="text-sm text-slate-500">{t('instructor.noLearnersYet')}</p>
            ) : data.overview.enrollments === 0 ? (
              <p className="text-sm text-slate-500">{t('instructor.noLearnersYet')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase text-slate-400 dark:border-slate-800">
                      <th className="py-2 pr-3">{t('instructor.colLecture')}</th>
                      <th className="py-2 pr-3">{t('instructor.colLearners')}</th>
                      <th className="py-2 pr-3">{t('instructor.colCompleted')}</th>
                      <th className="py-2 pr-3">{t('instructor.colAvgWatched')}</th>
                      <th className="py-2 pr-3">{t('instructor.colDropOff')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.lectures.map((lec) => (
                      <tr
                        key={lec.id}
                        className="border-b border-slate-100 last:border-0 dark:border-slate-800/60"
                      >
                        <td className="py-2 pr-3">
                          <span className="font-medium">{lec.title}</span>
                          <span className="block text-xs text-slate-400">{lec.module_title}</span>
                        </td>
                        <td className="py-2 pr-3">{lec.learners}</td>
                        <td className="py-2 pr-3">
                          {lec.completions}/{lec.learners}
                        </td>
                        <td className="py-2 pr-3">
                          {fmtTime(lec.avg_watched_seconds)} / {fmtTime(lec.duration_seconds)}
                        </td>
                        <td className="py-2 pr-3">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                              <div
                                className={`h-1.5 rounded-full ${
                                  lec.drop_off_percent >= 50
                                    ? 'bg-rose-500'
                                    : lec.drop_off_percent > 0
                                      ? 'bg-amber-500'
                                      : 'bg-emerald-500'
                                }`}
                                style={{ width: `${lec.drop_off_percent}%` }}
                              />
                            </div>
                            <span className="text-xs">{lec.drop_off_percent}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {worstDropOff > 0 && (
                  <p className="mt-2 text-xs text-slate-400">
                    🔎 {t('instructor.analyticsHint')}
                  </p>
                )}
              </div>
            )}
          </Card>

          <Card>
            <h3 className="mb-3 font-semibold">{t('instructor.quizPerformance')}</h3>
            {data.quizzes.length === 0 ? (
              <p className="text-sm text-slate-500">{t('quiz.noQuizzes')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase text-slate-400 dark:border-slate-800">
                      <th className="py-2 pr-3">{t('instructor.colQuiz')}</th>
                      <th className="py-2 pr-3">{t('instructor.colAttempts')}</th>
                      <th className="py-2 pr-3">{t('instructor.colScore')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.quizzes.map((q) => (
                      <tr
                        key={q.id}
                        className="border-b border-slate-100 last:border-0 dark:border-slate-800/60"
                      >
                        <td className="py-2 pr-3">
                          <span className="font-medium">{q.title}</span>
                          <span className="block text-xs text-slate-400">{q.module_title}</span>
                        </td>
                        <td className="py-2 pr-3">{q.attempts}</td>
                        <td className="py-2 pr-3">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                              <div
                                className={`h-1.5 rounded-full ${
                                  q.avg_score >= 70
                                    ? 'bg-emerald-500'
                                    : q.avg_score >= 40
                                      ? 'bg-amber-500'
                                      : 'bg-rose-500'
                                }`}
                                style={{ width: `${Math.min(100, q.avg_score)}%` }}
                              />
                            </div>
                            <span className="text-xs">{q.avg_score}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </section>
  );
}
