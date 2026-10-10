import { useParams, useNavigate, Link } from 'react-router-dom';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiErrorMessage } from '../../services/api';
import { useAppSelector } from '../../store/hooks';
import { Alert, Card, Spinner } from '../../components/common/ui';
import { Assignment, CourseDetail as CourseDetailType } from '../../utils/types';
import CourseForum from '../../components/student/CourseForum';
import { useI18n } from '../../utils/i18n';

export default function CourseDetail() {
  const { t } = useI18n();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAppSelector((s) => s.auth.user);

  const course = useQuery({
    queryKey: ['course', id],
    queryFn: async () => (await api.get<CourseDetailType>(`/courses/${id}`)).data,
    enabled: !!id,
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

  if (course.isLoading) return <div className="flex justify-center py-12"><Spinner /></div>;
  if (course.error) return <Alert>{apiErrorMessage(course.error)}</Alert>;
  if (!course.data) return null;

  const c = course.data;
  const isOwner = user?.id === c.instructor_id;
  const firstLectureId = c.modules.flatMap((m) => m.lectures)[0]?.id;

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs uppercase dark:bg-slate-800">
                {c.difficulty ?? t('course.allLevels')}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-xs uppercase ${
                c.status === 'approved'
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                  : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
              }`}>
                {c.status}
              </span>
            </div>
            <h1 className="text-2xl font-bold">{c.title}</h1>
            <p className="mt-1 text-sm text-slate-500">
              {t('course.by', { name: c.instructor_name ?? '' })}
              {c.category ? ` · ${c.category}` : ''}
            </p>
            <p className="mt-3 max-w-2xl text-slate-600 dark:text-slate-300">{c.description}</p>
          </div>
          <div className="text-right">
            <div className="mb-2 text-2xl font-bold">{Number(c.price) > 0 ? `$${c.price}` : t('catalog.free')}</div>
            {user?.roles.includes('student') && (
              <button className="btn-primary" disabled={enroll.isPending} onClick={() => enroll.mutate()}>
                {enroll.isPending ? t('catalog.enrolling') : t('course.enrollNow')}
              </button>
            )}
            {!user && <Link to="/login" className="btn-primary">{t('course.loginToEnroll')}</Link>}
            {firstLectureId && (
              <div className="mt-2">
                <Link to={`/learn/${c.id}/${firstLectureId}`} className="btn-secondary">
                  {t('course.startLearning')}
                </Link>
              </div>
            )}
          </div>
        </div>
      </Card>

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
                  <span className="font-medium">📝 {q.title}</span>
                  <span className="ml-2 text-sm text-slate-400">
                    {t('course.questions', { count: q.question_count })}
                  </span>
                  <div className="text-xs text-slate-400">{m.title}</div>
                </div>
                {user ? (
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
          <Card className="text-slate-500">{t('assignments.noAssignments')}</Card>
        )}
        {assignments.data?.items.map((a) => (
          <AssignmentCard key={a.id} assignment={a} canSubmit={!!user?.roles.includes('student')} />
        ))}
      </section>

      <section aria-label={t('course.courseContent')} className="space-y-4">
        <h2 className="text-lg font-semibold">{t('course.courseContent')}</h2>
        {c.modules.length === 0 && <Card className="text-slate-500">{t('course.noModules')}</Card>}
        {c.modules.map((m) => (
          <Card key={m.id}>
            <h3 className="font-semibold">{m.title}</h3>
            <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
              {m.lectures.map((l) => (
                <li key={l.id} className="flex items-center justify-between py-2 text-sm">
                  <span>🎬 {l.title}</span>
                  <span className="text-xs text-slate-400">
                    {l.duration_seconds
                      ? t('course.minutes', { count: Math.round(l.duration_seconds / 60) })
                      : ''}
                  </span>
                </li>
              ))}
              {m.lectures.length === 0 && (
                <li className="py-2 text-sm text-slate-400">{t('course.noLectures')}</li>
              )}
            </ul>
          </Card>
        ))}
      </section>

      {isOwner && (
        <p className="text-sm text-slate-400">
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
      setMsg(`${t('assignments.submitted')} ✓`);
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
            <p className="mt-1 text-sm text-slate-500">{assignment.instructions}</p>
          )}
          {assignment.due_date && (
            <p className={`mt-1 text-xs ${late && !assignment.my_submission_id ? 'text-red-500' : 'text-slate-400'}`}>
              {t('assignments.due', { date: new Date(assignment.due_date).toLocaleString() })}
            </p>
          )}
          {assignment.my_submission_id && (
            <p className="mt-1 text-xs text-slate-500">
              {t('assignments.submittedOn', {
                date: assignment.my_submitted_at
                  ? new Date(assignment.my_submitted_at).toLocaleString()
                  : '',
              })}
              {assignment.my_grade != null && (
                <span className="ml-2 font-semibold text-emerald-600">
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
      {msg && <p className="mt-2 text-xs text-slate-500">{msg}</p>}
    </Card>
  );
}
