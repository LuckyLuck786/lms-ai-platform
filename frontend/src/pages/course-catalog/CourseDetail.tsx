import { useParams, useNavigate, Link } from 'react-router-dom';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiErrorMessage } from '../../services/api';
import { useAppSelector } from '../../store/hooks';
import {
  Alert,
  Card,
  RatingInput,
  RatingStars,
  Skeleton,
  SkeletonCard,
  SkeletonRows,
} from '../../components/common/ui';
import {
  Assignment,
  CourseDetail as CourseDetailType,
  CourseRating,
  Enrollment,
} from '../../utils/types';
import CourseForum from '../../components/student/CourseForum';
import { useI18n } from '../../utils/i18n';
import { CheckoutCancelled, purchaseCourse } from '../../services/checkout';
import { Check, ClipboardCheck, GraduationCap, Play, Video } from '../../components/common/Icon';

export default function CourseDetail() {
  const { t } = useI18n();
  const { id = '' } = useParams();
  const [review, setReview] = useState('');
  const [reviewSaved, setReviewSaved] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAppSelector((s) => s.auth.user);

  const course = useQuery({
    queryKey: ['course', id],
    queryFn: async () => (await api.get<CourseDetailType>(`/courses/${id}`)).data,
    enabled: !!id,
  });

  // FR-I4: the course owner publishes an AI-generated draft after review.
  const approveQuiz = useMutation({
    mutationFn: async (quizId: string) => (await api.put(`/quizzes/${quizId}/approve`)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['course', id] }),
  });

  const assignments = useQuery({
    queryKey: ['assignments', id],
    queryFn: async () => (await api.get<{ items: Assignment[] }>(`/courses/${id}/assignments`)).data,
    enabled: !!id && !!user,
  });

  const enroll = useMutation({
    mutationFn: async () => (await api.post(`/courses/${id}/enroll`)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['enrollments', 'me'] });
      navigate('/');
    },
    onError: (err) => alert(apiErrorMessage(err)),
  });

  // Paid courses (PRD §15 item 4) go through checkout instead of enrolling
  // directly; the backend refuses a free enrolment for anything with a price.
  const buy = useMutation({
    mutationFn: () => purchaseCourse(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['enrollments', 'me'] });
      queryClient.invalidateQueries({ queryKey: ['course', id] });
      navigate('/');
    },
    onError: (err) => {
      // Dismissing the gateway is a normal choice, not a failure to report.
      if (err instanceof CheckoutCancelled) return;
      alert(apiErrorMessage(err));
    },
  });

  // Ratings (FR-S3): the reviewer must be enrolled (or own/admin the course),
  // which the server enforces too — this just gates the widget.
  const myEnrollments = useQuery({
    queryKey: ['enrollments', 'me'],
    queryFn: async () => (await api.get<{ items: Enrollment[] }>('/enrollments/me')).data,
    enabled: !!user,
  });

  const ratings = useQuery({
    queryKey: ['ratings', id],
    queryFn: async () =>
      (
        await api.get<{
          average: number;
          count: number;
          items: CourseRating[];
          mine: { rating: number; comment: string | null } | null;
        }>(`/courses/${id}/ratings`)
      ).data,
    enabled: !!id,
  });

  const rate = useMutation({
    mutationFn: async (payload: { rating: number; comment?: string }) =>
      (await api.post(`/courses/${id}/ratings`, payload)).data,
    onSuccess: () => {
      setReviewSaved(true);
      queryClient.invalidateQueries({ queryKey: ['ratings', id] });
      queryClient.invalidateQueries({ queryKey: ['course', id] });
      queryClient.invalidateQueries({ queryKey: ['catalog'] });
    },
    onError: (err) => alert(apiErrorMessage(err)),
  });

  if (course.isLoading) {
    return (
      <div className="space-y-6">
        <div className="card flex gap-5">
          <Skeleton className="hidden h-40 w-60 shrink-0 sm:block" />
          <div className="flex-1 space-y-3 py-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-7 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-3 w-full" />
          </div>
        </div>
        <SkeletonCard />
        <SkeletonRows rows={4} />
      </div>
    );
  }
  if (course.error) return <Alert>{apiErrorMessage(course.error)}</Alert>;
  if (!course.data) return null;

  const c = course.data;
  const isOwner = user?.id === c.instructor_id;
  const firstLectureId = c.modules.flatMap((m) => m.lectures)[0]?.id;
  const summary = ratings.data ?? {
    average: Number(c.avg_rating ?? 0),
    count: Number(c.rating_count ?? 0),
    items: [] as CourseRating[],
    mine: null,
  };
  const enrolled = !!myEnrollments.data?.items.some((e) => e.course_id === c.id);
  const isPaid = Number(c.price) > 0;
  const canRate = enrolled || isOwner || !!user?.roles.includes('admin');
  const myRating = ratings.data?.mine?.rating ?? c.my_rating ?? 0;
  const reviewDraft = review || ratings.data?.mine?.comment || '';

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden p-0">
        <div className="grid sm:grid-cols-[240px_1fr]">
          {/* Cover art (FR-I1) — instructor thumbnail or a quiet generated plate. */}
          <div className="relative min-h-[150px] bg-paper-sunk dark:bg-ink-800">
            {c.thumbnail_url ? (
              <img src={c.thumbnail_url} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-white/25">
                <GraduationCap size={40} />
              </span>
            )}
          </div>

          <div className="p-6">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="chip capitalize">{c.difficulty ?? t('course.allLevels')}</span>
              {isOwner || c.status !== 'approved' ? (
                <span className="chip capitalize">
                  <span
                    aria-hidden="true"
                    className={`h-1.5 w-1.5 rounded-sm ${
                      c.status === 'approved' ? 'bg-emerald-800' : 'bg-gold-500'
                    }`}
                  />
                  {c.status}
                </span>
              ) : null}
              {summary.count > 0 && <RatingStars value={summary.average} count={summary.count} />}
            </div>
            <h1 className="font-display text-3xl leading-tight text-ink-950 dark:text-white">{c.title}</h1>
            <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-400">
              {t('course.by', { name: c.instructor_name ?? '' })}
              {c.category ? ` · ${c.category}` : ''}
            </p>
            <p className="mt-3 max-w-2xl text-slate-600 dark:text-slate-300">{c.description}</p>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/80 pt-4 dark:border-white/[0.06]">
              <div className="text-2xl font-semibold text-ink-950 nums dark:text-white">
                {isPaid ? `₹${Number(c.price).toLocaleString()}` : t('catalog.free')}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {user?.roles.includes('student') && !enrolled && !isOwner && (
                  isPaid ? (
                    <button
                      className="btn-primary"
                      disabled={buy.isPending}
                      onClick={() => buy.mutate()}
                    >
                      {buy.isPending ? t('course.processingPayment') : t('course.buyNow')}
                    </button>
                  ) : (
                    <button
                      className="btn-primary"
                      disabled={enroll.isPending}
                      onClick={() => enroll.mutate()}
                    >
                      {enroll.isPending ? t('catalog.enrolling') : t('course.enrollNow')}
                    </button>
                  )
                )}
                {enrolled && (
                  <span className="chip text-emerald-800 dark:text-emerald-400">
                    <Check size={14} />
                    {t('course.enrolled')}
                  </span>
                )}
                {!user && <Link to="/login" className="btn-primary">{t('course.loginToEnroll')}</Link>}
                {firstLectureId && (
                  <Link to={`/learn/${c.id}/${firstLectureId}`} className="btn-secondary">
                    <Play />
                    {t('course.startLearning')}
                  </Link>
                )}
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Ratings & reviews (FR-S3) */}
      <section aria-label={t('course.ratings')} className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Card>
          <h2 className="section-title mb-3">{t('course.ratings')}</h2>
          <div className="flex items-baseline gap-2">
            <span className="font-display text-4xl text-ink-950 nums dark:text-white">
              {summary.count > 0 ? summary.average.toFixed(1) : 'n/a'}
            </span>
            <span className="text-sm text-slate-600 dark:text-slate-400">/ 5</span>
          </div>
          <RatingStars value={summary.average} className="mt-1" />
          <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
            {t('course.ratingCount', { count: summary.count })}
          </p>

          {canRate ? (
            <div className="mt-4 border-t border-slate-200/80 pt-4 dark:border-white/[0.06]">
              <p className="eyebrow mb-2">
                {myRating ? t('course.yourRating') : t('course.rateThisCourse')}
              </p>
              <RatingInput
                label={t('course.rateThisCourse')}
                value={myRating}
                disabled={rate.isPending}
                onChange={(next) => rate.mutate({ rating: next, comment: reviewDraft })}
              />
              <textarea
                className="input mt-3"
                rows={2}
                maxLength={1000}
                placeholder={t('course.reviewPlaceholder')}
                value={reviewDraft}
                aria-label={t('course.reviewPlaceholder')}
                onChange={(e) => {
                  setReview(e.target.value);
                  setReviewSaved(false);
                }}
              />
              <button
                className="btn-secondary mt-2 w-full"
                disabled={!myRating || rate.isPending}
                onClick={() => rate.mutate({ rating: myRating, comment: reviewDraft })}
              >
                {rate.isPending ? t('common.save') : t('course.saveReview')}
              </button>
              {reviewSaved && (
                <p role="status" className="mt-2 text-xs text-emerald-800 dark:text-emerald-400">
                  {t('course.reviewSaved')}
                </p>
              )}
            </div>
          ) : (
            <p className="mt-4 border-t border-slate-200/80 pt-4 text-xs text-slate-600 dark:text-slate-400 dark:border-white/[0.06]">
              {user ? t('course.rateAfterEnrol') : t('course.loginToRate')}
            </p>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 font-semibold">{t('course.reviews')}</h2>
          {summary.items.length === 0 ? (
            <p className="text-sm text-slate-600 dark:text-slate-400">{t('course.noReviews')}</p>
          ) : (
            <ul className="divide-quiet space-y-4">
              {summary.items.slice(0, 5).map((r, i) => (
                <li key={`${r.learner_name}-${i}`} className="pt-4 first:pt-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium">{r.learner_name}</span>
                    <RatingStars value={r.rating} />
                  </div>
                  {r.comment && <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{r.comment}</p>}
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                    {new Date(r.updated_at).toLocaleDateString()}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      {/* Forum + announcements (Phase 4) */}
      {!!user && (
        <CourseForum
          courseId={c.id}
          canPost={
            !!user &&
            (user.roles.some((r) => r === 'admin') ||
              user.id === c.instructor_id ||
              !!user.roles.includes('student'))
          }
          canModerate={user.roles.includes('admin') || user.id === c.instructor_id}
        />
      )}

      {/* Quizzes (FR-S7) */}
      {c.modules.some((m) => m.quizzes?.length > 0) && (
        <section aria-label={t('course.quizzes')} className="space-y-3">
          <h2 className="text-lg font-semibold">{t('course.quizzes')}</h2>
          {c.modules.flatMap((m) =>
            (m.quizzes ?? []).map((q) => (
              <Card key={q.id} className="flex items-center justify-between">
                <div>
                  <span className="flex items-center gap-2 font-medium">
                    <ClipboardCheck className="h-4 w-4 text-slate-600 dark:text-slate-400" />
                    {q.title}
                    {q.status === 'draft' && <span className="chip">{t('course.quizDraft')}</span>}
                  </span>
                  <span className="ml-2 text-sm text-slate-600 dark:text-slate-400">
                    {t('course.questions', { count: q.question_count })}
                  </span>
                  <div className="text-xs text-slate-600 dark:text-slate-400">{m.title}</div>
                </div>
                {q.status === 'draft' && (isOwner || user?.roles.includes('admin')) ? (
                  <div className="flex gap-2">
                    <Link to={`/quiz/${q.id}`} className="btn-secondary">{t('course.reviewQuiz')}</Link>
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={approveQuiz.isPending}
                      onClick={() => approveQuiz.mutate(q.id)}
                    >
                      {t('course.approveQuiz')}
                    </button>
                  </div>
                ) : user ? (
                  <Link to={`/quiz/${q.id}`} className="btn-secondary">{t('course.openQuiz')}</Link>
                ) : (
                  <Link to="/login" className="btn-secondary">{t('course.logIn')}</Link>
                )}
              </Card>
            )),
          )}
        </section>
      )}

      {/* Assignments (FR-S6) */}
      <section aria-label={t('assignments.title')} className="space-y-3">
        <h2 className="text-lg font-semibold">{t('assignments.title')}</h2>
        {assignments.data?.items.length === 0 && (
          <Card className="text-slate-600 dark:text-slate-400">{t('assignments.noAssignments')}</Card>
        )}
        {assignments.data?.items.map((a) => (
          <AssignmentCard key={a.id} assignment={a} canSubmit={!!user?.roles.includes('student')} />
        ))}
      </section>

      <section aria-label={t('course.courseContent')} className="space-y-4">
        <h2 className="text-lg font-semibold">{t('course.courseContent')}</h2>
        {c.modules.length === 0 && <Card className="text-slate-600 dark:text-slate-400">{t('course.noModules')}</Card>}
        {c.modules.map((m) => (
          <Card key={m.id}>
            <h3 className="font-semibold">{m.title}</h3>
            <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
              {m.lectures.map((l) => (
                <li key={l.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="flex items-center gap-2">
                    <Video className="h-4 w-4 shrink-0 text-slate-600 dark:text-slate-400" />
                    {l.title}
                  </span>
                  <span className="text-xs text-slate-600 dark:text-slate-400">
                    {l.duration_seconds
                      ? t('course.minutes', { count: Math.round(l.duration_seconds / 60) })
                      : ''}
                  </span>
                </li>
              ))}
              {m.lectures.length === 0 && (
                <li className="py-2 text-sm text-slate-600 dark:text-slate-400">{t('course.noLectures')}</li>
              )}
            </ul>
          </Card>
        ))}
      </section>

      {isOwner && (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          {t('course.ownerHint')}{' '}
          <Link to="/instructor" className="underline">{t('course.instructorWorkspace')}</Link>
        </p>
      )}
    </div>
  );
}

/** Assignment row with inline file submission (FR-S6). */
function AssignmentCard({ assignment, canSubmit }: { assignment: Assignment; canSubmit: boolean }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.append('file', file!);
      const { data } = await api.post(`/assignments/${assignment.id}/submit`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return data;
    },
    onSuccess: () => {
      setMsg(t('assignments.submitted'));
      setFile(null);
      queryClient.invalidateQueries({ queryKey: ['assignments'] });
    },
    onError: (err) => setMsg(apiErrorMessage(err)),
  });

  const late = assignment.due_date && new Date(assignment.due_date) < new Date();

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-medium">{assignment.title}</h3>
          {assignment.instructions && (
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{assignment.instructions}</p>
          )}
          {assignment.due_date && (
            <p className={`mt-1 text-xs ${late && !assignment.my_submission_id ? 'text-red-500' : 'text-slate-600 dark:text-slate-400'}`}>
              {t('assignments.due', { date: new Date(assignment.due_date).toLocaleString() })}
            </p>
          )}
          {assignment.my_submission_id && (
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
              {t('assignments.submittedOn', {
                date: assignment.my_submitted_at
                  ? new Date(assignment.my_submitted_at).toLocaleString()
                  : '',
              })}
              {assignment.my_grade != null && (
                <span className="ml-2 font-semibold text-emerald-800 dark:text-emerald-400">
                  {t('assignments.gradeLabel', { grade: assignment.my_grade })}
                </span>
              )}
              {assignment.my_feedback && <span className="ml-2 italic">“{assignment.my_feedback}”</span>}
            </p>
          )}
        </div>

        {canSubmit && !assignment.my_submission_id && !late && (
          <div className="flex items-center gap-2">
            <input
              type="file"
              aria-label={t('assignments.uploadFor', { title: assignment.title })}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="text-xs"
            />
            <button
              className="btn-primary"
              disabled={!file || submit.isPending}
              onClick={() => submit.mutate()}
            >
              {submit.isPending ? t('common.uploading') : t('common.submit')}
            </button>
          </div>
        )}
      </div>
      {msg && <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">{msg}</p>}
    </Card>
  );
}
