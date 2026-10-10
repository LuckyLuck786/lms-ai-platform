import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiErrorMessage } from '../../services/api';
import { Alert, Card } from '../../components/common/ui';
import { Course } from '../../utils/types';
import { useI18n } from '../../utils/i18n';

/**
 * Instructor content tools: add modules/lectures, build quizzes manually
 * (FR-S7/FR-I4), and create assignments with rubric + deadline (FR-I3).
 */

interface ModuleOption {
  id: string;
  title: string;
  lectures?: { id: string; title: string }[];
}

/** Max sizes mirror the backend limits (512 MB video, 10 files per request). */
const VIDEO_MAX_BYTES = 512 * 1024 * 1024;

interface DraftQuestion {
  question_text: string;
  question_type: 'mcq' | 'multi_select' | 'short_answer';
  options: { option_text: string; is_correct: boolean }[];
}

const emptyQuestion = (): DraftQuestion => ({
  question_text: '',
  question_type: 'mcq',
  options: [
    { option_text: '', is_correct: true },
    { option_text: '', is_correct: false },
  ],
});

export default function InstructorContentTools({ courses }: { courses: Course[] }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [courseId, setCourseId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const courseDetail = useQuery({
    queryKey: ['course', courseId],
    queryFn: async () => (await api.get<{ modules: ModuleOption[] }>(`/courses/${courseId}`)).data,
    enabled: !!courseId,
  });
  const modules = courseDetail.data?.modules ?? [];
  const lectures = modules.flatMap((m) => m.lectures ?? []);

  // --- module ---
  const [moduleTitle, setModuleTitle] = useState('');
  const addModule = useMutation({
    mutationFn: async () => (await api.post(`/courses/${courseId}/modules`, { title: moduleTitle })).data,
    onSuccess: () => {
      setModuleTitle('');
      setSuccess(t('tools.moduleAdded'));
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['course', courseId] });
    },
    onError: (e) => setError(apiErrorMessage(e)),
  });

  // --- lecture (FR-I2: video + slide/PDF upload) ---
  const [lecture, setLecture] = useState({ module_id: '', title: '', duration_seconds: '', transcript: '' });
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [resourceFiles, setResourceFiles] = useState<File[]>([]);

  const clearLectureForm = () => {
    setLecture({ module_id: '', title: '', duration_seconds: '', transcript: '' });
    setVideoFile(null);
    setResourceFiles([]);
  };

  const addLecture = useMutation({
    mutationFn: async () => {
      // Multipart when material is attached, plain JSON otherwise — the API
      // accepts both.
      if (videoFile || resourceFiles.length) {
        const form = new FormData();
        form.append('title', lecture.title);
        if (lecture.duration_seconds) form.append('duration_seconds', lecture.duration_seconds);
        if (lecture.transcript) form.append('transcript', lecture.transcript);
        if (videoFile) form.append('video', videoFile);
        resourceFiles.forEach((file) => form.append('resources', file));
        return (await api.post(`/modules/${lecture.module_id}/lectures`, form)).data;
      }
      return (
        await api.post(`/modules/${lecture.module_id}/lectures`, {
          title: lecture.title,
          duration_seconds: lecture.duration_seconds ? Number(lecture.duration_seconds) : undefined,
          transcript: lecture.transcript || undefined,
        })
      ).data;
    },
    onSuccess: () => {
      clearLectureForm();
      setSuccess(t('tools.lectureAdded'));
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['course', courseId] });
    },
    onError: (e) => setError(apiErrorMessage(e)),
  });

  // --- attach material to an existing lecture ---
  const [resourceLectureId, setResourceLectureId] = useState('');
  const [extraFiles, setExtraFiles] = useState<File[]>([]);
  const uploadResources = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      extraFiles.forEach((file) => form.append('resources', file));
      return (await api.post(`/lectures/${resourceLectureId}/resources`, form)).data;
    },
    onSuccess: (data: { added?: unknown[] }) => {
      setExtraFiles([]);
      setSuccess(t('tools.uploadedCount', { count: data.added?.length ?? 0 }));
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['course', courseId] });
    },
    onError: (e) => setError(apiErrorMessage(e)),
  });

  // --- quiz ---
  const [quiz, setQuiz] = useState({ module_id: '', title: '' });
  const [questions, setQuestions] = useState<DraftQuestion[]>([emptyQuestion()]);
  const createQuiz = useMutation({
    mutationFn: async () =>
      (await api.post('/quizzes', { module_id: quiz.module_id, title: quiz.title, questions })).data,
    onSuccess: () => {
      setQuiz({ module_id: '', title: '' });
      setQuestions([emptyQuestion()]);
      setSuccess(t('tools.quizCreated'));
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['course', courseId] });
    },
    onError: (e) => setError(apiErrorMessage(e)),
  });

  const setQuestion = (idx: number, patch: Partial<DraftQuestion>) =>
    setQuestions((qs) => qs.map((q, i) => (i === idx ? { ...q, ...patch } : q)));

  const setOption = (qIdx: number, oIdx: number, patch: Partial<DraftQuestion['options'][number]>) =>
    setQuestions((qs) =>
      qs.map((q, i) =>
        i === qIdx
          ? {
              ...q,
              options: q.options.map((o, j) =>
                j === oIdx
                  ? { ...o, ...patch }
                  : q.question_type === 'mcq'
                    ? { ...o, is_correct: false } // single-select semantics
                    : o,
              ),
            }
          : q,
      ),
    );

  // --- announcement ---
  const [announcement, setAnnouncement] = useState('');
  const postAnnouncement = useMutation({
    mutationFn: async () =>
      (await api.post(`/courses/${courseId}/announcements`, { content: announcement })).data,
    onSuccess: (d: { notified: number }) => {
      setAnnouncement('');
      setSuccess(t('tools.announcementPosted', { count: d.notified }));
      setError(null);
    },
    onError: (e) => setError(apiErrorMessage(e)),
  });

  // --- assignment ---
  const [assignment, setAssignment] = useState({ title: '', instructions: '', due_date: '' });
  const createAssignment = useMutation({
    mutationFn: async () =>
      (
        await api.post('/assignments', {
          course_id: courseId,
          title: assignment.title,
          instructions: assignment.instructions || undefined,
          due_date: assignment.due_date ? new Date(assignment.due_date).toISOString() : undefined,
        })
      ).data,
    onSuccess: () => {
      setAssignment({ title: '', instructions: '', due_date: '' });
      setSuccess(t('tools.assignmentCreated'));
      setError(null);
    },
    onError: (e) => setError(apiErrorMessage(e)),
  });

  const noCourse = !courseId;

  return (
    <div className="space-y-6">
      <Card>
        <label className="label" htmlFor="course-select">{t('tools.selectCourse')}</label>
        <select
          id="course-select"
          className="input max-w-md"
          value={courseId}
          onChange={(e) => {
            setCourseId(e.target.value);
            setSuccess(null);
            setError(null);
          }}
        >
          <option value="">— select a course —</option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>{c.title} ({c.status})</option>
          ))}
        </select>
      </Card>

      {error && <Alert>{error}</Alert>}
      {success && <Alert kind="success">{success}</Alert>}

      {noCourse && <Card className="text-slate-500">{t('tools.selectPrompt')}</Card>}

      {!noCourse && (
        <>
          {/* Module */}
          <Card>
            <h3 className="mb-3 font-semibold">1️⃣ {t('tools.module')}</h3>
            <div className="flex gap-2">
              <input
                className="input flex-1"
                placeholder={t('tools.modulePlaceholder')}
                value={moduleTitle}
                onChange={(e) => setModuleTitle(e.target.value)}
              />
              <button className="btn-primary" disabled={!moduleTitle || addModule.isPending} onClick={() => addModule.mutate()}>
                {t('common.add')}
              </button>
            </div>
          </Card>

          {/* Lecture */}
          <Card>
            <h3 className="mb-3 font-semibold">2️⃣ {t('tools.lecture')}</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <select
                className="input"
                value={lecture.module_id}
                onChange={(e) => setLecture((l) => ({ ...l, module_id: e.target.value }))}
                aria-label={t('tools.selectModule')}
              >
                <option value="">{t('tools.selectModule')}</option>
                {modules.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
              </select>
              <input
                className="input"
                placeholder={t('tools.lectureTitle')}
                value={lecture.title}
                onChange={(e) => setLecture((l) => ({ ...l, title: e.target.value }))}
              />
              <input
                className="input"
                type="number"
                min={0}
                placeholder={t('tools.lectureDuration')}
                value={lecture.duration_seconds}
                onChange={(e) => setLecture((l) => ({ ...l, duration_seconds: e.target.value }))}
              />
              <textarea
                className="input sm:col-span-2"
                rows={2}
                placeholder={t('tools.lectureTranscript')}
                value={lecture.transcript}
                onChange={(e) => setLecture((l) => ({ ...l, transcript: e.target.value }))}
              />
              <div>
                <label className="label" htmlFor="lecture-video">{t('tools.lectureVideo')}</label>
                <input
                  id="lecture-video"
                  className="input"
                  type="file"
                  accept="video/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    if (file && file.size > VIDEO_MAX_BYTES) {
                      setError(t('tools.videoTooLarge', { name: file.name }));
                      setVideoFile(null);
                      e.target.value = '';
                      return;
                    }
                    setError(null);
                    setVideoFile(file);
                  }}
                />
              </div>
              <div>
                <label className="label" htmlFor="lecture-resources">{t('tools.lectureResources')}</label>
                <input
                  id="lecture-resources"
                  className="input"
                  type="file"
                  multiple
                  accept=".pdf,.ppt,.pptx,.doc,.docx,.txt,.zip,image/*"
                  onChange={(e) => setResourceFiles(Array.from(e.target.files ?? []))}
                />
              </div>
            </div>
            <button
              className="btn-primary mt-3"
              disabled={!lecture.module_id || !lecture.title || addLecture.isPending}
              onClick={() => addLecture.mutate()}
            >
              {addLecture.isPending ? t('common.uploading') : t('tools.addLecture')}
            </button>
          </Card>

          {/* Attach material to an existing lecture (FR-I2) */}
          <Card>
            <h3 className="mb-3 font-semibold">📎 {t('tools.attachMaterial')}</h3>
            <p className="mb-3 text-sm text-slate-500">{t('tools.attachHint')}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <select
                className="input"
                value={resourceLectureId}
                onChange={(e) => setResourceLectureId(e.target.value)}
                aria-label={t('tools.pickLecture')}
              >
                <option value="">{t('tools.pickLecture')}</option>
                {lectures.map((l) => (
                  <option key={l.id} value={l.id}>{l.title}</option>
                ))}
              </select>
              <input
                className="input"
                type="file"
                multiple
                accept=".pdf,.ppt,.pptx,.doc,.docx,.txt,.zip,image/*"
                onChange={(e) => setExtraFiles(Array.from(e.target.files ?? []))}
                aria-label={t('tools.lectureResources')}
              />
            </div>
            <button
              className="btn-primary mt-3"
              disabled={!resourceLectureId || !extraFiles.length || uploadResources.isPending}
              onClick={() => uploadResources.mutate()}
            >
              {uploadResources.isPending ? t('common.uploading') : t('tools.uploadMaterial')}
            </button>
            {!lectures.length && (
              <p className="mt-2 text-sm text-slate-500">{t('tools.noLecturesYet')}</p>
            )}
          </Card>

          {/* Quiz builder */}
          <Card>
            <h3 className="mb-3 font-semibold">3️⃣ {t('tools.quiz')}</h3>
            <div className="mb-3 grid gap-3 sm:grid-cols-2">
              <select
                className="input"
                value={quiz.module_id}
                onChange={(e) => setQuiz((q) => ({ ...q, module_id: e.target.value }))}
                aria-label={t('tools.selectModule')}
              >
                <option value="">{t('tools.selectModule')}</option>
                {modules.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
              </select>
              <input
                className="input"
                placeholder={t('tools.quizTitle')}
                value={quiz.title}
                onChange={(e) => setQuiz((q) => ({ ...q, title: e.target.value }))}
              />
            </div>

            <div className="space-y-4">
              {questions.map((q, qi) => (
                <div key={qi} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <div className="mb-2 flex gap-2">
                    <input
                      className="input flex-1"
                      placeholder={t('tools.question', { number: qi + 1 })}
                      value={q.question_text}
                      onChange={(e) => setQuestion(qi, { question_text: e.target.value })}
                    />
                    <select
                      className="input w-40"
                      value={q.question_type}
                      onChange={(e) => {
                        const type = e.target.value as DraftQuestion['question_type'];
                        setQuestion(qi, {
                          question_type: type,
                          options:
                            type === 'short_answer'
                              ? []
                              : q.options.length >= 2
                                ? q.options.map((o, j) => ({ ...o, is_correct: type === 'mcq' ? j === 0 : o.is_correct }))
                                : emptyQuestion().options,
                        });
                      }}
                      aria-label={t('tools.questionType')}
                    >
                      <option value="mcq">{t('tools.mcq')}</option>
                      <option value="multi_select">{t('tools.multiSelect')}</option>
                      <option value="short_answer">{t('tools.shortAnswer')}</option>
                    </select>
                    {questions.length > 1 && (
                      <button
                        className="btn-secondary"
                        onClick={() => setQuestions((qs) => qs.filter((_, i) => i !== qi))}
                        aria-label={`${t('common.delete')} — ${qi + 1}`}
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  {q.question_type !== 'short_answer' && (
                    <div className="space-y-2">
                      {q.options.map((o, oi) => (
                        <div key={oi} className="flex items-center gap-2">
                          <input
                            type={q.question_type === 'mcq' ? 'radio' : 'checkbox'}
                            name={`correct-${qi}`}
                            checked={o.is_correct}
                            onChange={(e) => setOption(qi, oi, { is_correct: e.target.checked })}
                            aria-label={`${t('tools.addOption')} ${oi + 1}`}
                          />
                          <input
                            className="input flex-1"
                            placeholder={`Option ${oi + 1}`}
                            value={o.option_text}
                            onChange={(e) => setOption(qi, oi, { option_text: e.target.value })}
                          />
                        </div>
                      ))}
                      {q.options.length < 6 && (
                        <button
                          className="text-sm text-brand-600 hover:underline"
                          onClick={() =>
                            setQuestion(qi, {
                              options: [...q.options, { option_text: '', is_correct: false }],
                            })
                          }
                        >
                          {t('tools.addOption')}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-3 flex gap-2">
              <button className="btn-secondary" onClick={() => setQuestions((qs) => [...qs, emptyQuestion()])}>
                {t('tools.addQuestion')}
              </button>
              <button
                className="btn-primary"
                disabled={!quiz.module_id || !quiz.title || createQuiz.isPending}
                onClick={() => createQuiz.mutate()}
              >
                {createQuiz.isPending ? t('common.creating') : t('tools.createQuiz')}
              </button>
            </div>
          </Card>

          {/* Assignment */}
          <Card>
            <h3 className="mb-3 font-semibold">4️⃣ {t('tools.assignment')}</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                className="input"
                placeholder={t('tools.assignmentTitle')}
                value={assignment.title}
                onChange={(e) => setAssignment((a) => ({ ...a, title: e.target.value }))}
              />
              <input
                className="input"
                type="datetime-local"
                value={assignment.due_date}
                onChange={(e) => setAssignment((a) => ({ ...a, due_date: e.target.value }))}
                aria-label={t('tools.assignmentDue')}
              />
              <textarea
                className="input sm:col-span-2"
                rows={3}
                placeholder={t('tools.assignmentInstructions')}
                value={assignment.instructions}
                onChange={(e) => setAssignment((a) => ({ ...a, instructions: e.target.value }))}
              />
            </div>
            <button
              className="btn-primary mt-3"
              disabled={!assignment.title || createAssignment.isPending}
              onClick={(ev: FormEvent) => {
                ev.preventDefault();
                createAssignment.mutate();
              }}
            >
              {t('tools.createAssignment')}
            </button>
          </Card>

          {/* Announcement (FR-I6) */}
          <Card>
            <h3 className="mb-3 font-semibold">📣 {t('tools.announcement')}</h3>
            <div className="flex gap-2">
              <textarea
                className="input flex-1"
                rows={2}
                placeholder={t('tools.announcementPlaceholder')}
                value={announcement}
                onChange={(e) => setAnnouncement(e.target.value)}
                aria-label={t('tools.announcement')}
              />
              <button
                className="btn-primary self-end"
                disabled={!announcement.trim() || postAnnouncement.isPending}
                onClick={() => postAnnouncement.mutate()}
              >
                {postAnnouncement.isPending ? t('tools.posting') : t('tools.post')}
              </button>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
