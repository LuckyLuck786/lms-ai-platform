import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiErrorMessage } from '../../services/api';
import { Alert, Card } from '../../components/common/ui';
import { Course } from '../../utils/types';

/**
 * Instructor content tools: add modules/lectures, build quizzes manually
 * (FR-S7/FR-I4), and create assignments with rubric + deadline (FR-I3).
 */

interface ModuleOption {
  id: string;
  title: string;
}

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

  // --- module ---
  const [moduleTitle, setModuleTitle] = useState('');
  const addModule = useMutation({
    mutationFn: async () => (await api.post(`/courses/${courseId}/modules`, { title: moduleTitle })).data,
    onSuccess: () => {
      setModuleTitle('');
      setSuccess('Module added');
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['course', courseId] });
    },
    onError: (e) => setError(apiErrorMessage(e)),
  });

  // --- lecture ---
  const [lecture, setLecture] = useState({ module_id: '', title: '', duration_seconds: '', transcript: '' });
  const addLecture = useMutation({
    mutationFn: async () =>
      (
        await api.post(`/modules/${lecture.module_id}/lectures`, {
          title: lecture.title,
          duration_seconds: lecture.duration_seconds ? Number(lecture.duration_seconds) : undefined,
          transcript: lecture.transcript || undefined,
        })
      ).data,
    onSuccess: () => {
      setLecture({ module_id: '', title: '', duration_seconds: '', transcript: '' });
      setSuccess('Lecture added');
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
      setSuccess('Quiz created');
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
      setSuccess(`Announcement posted — ${d.notified} student(s) notified`);
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
      setSuccess('Assignment created');
      setError(null);
    },
    onError: (e) => setError(apiErrorMessage(e)),
  });

  const noCourse = !courseId;

  return (
    <div className="space-y-6">
      <Card>
        <label className="label" htmlFor="course-select">Work on course</label>
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

      {noCourse && <Card className="text-slate-500">Select a course above to manage its content.</Card>}

      {!noCourse && (
        <>
          {/* Module */}
          <Card>
            <h3 className="mb-3 font-semibold">1️⃣ Add a module</h3>
            <div className="flex gap-2">
              <input
                className="input flex-1"
                placeholder="Module title"
                value={moduleTitle}
                onChange={(e) => setModuleTitle(e.target.value)}
              />
              <button className="btn-primary" disabled={!moduleTitle || addModule.isPending} onClick={() => addModule.mutate()}>
                Add
              </button>
            </div>
          </Card>

          {/* Lecture */}
          <Card>
            <h3 className="mb-3 font-semibold">2️⃣ Add a lecture</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <select
                className="input"
                value={lecture.module_id}
                onChange={(e) => setLecture((l) => ({ ...l, module_id: e.target.value }))}
                aria-label="Module"
              >
                <option value="">— module —</option>
                {modules.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
              </select>
              <input
                className="input"
                placeholder="Lecture title"
                value={lecture.title}
                onChange={(e) => setLecture((l) => ({ ...l, title: e.target.value }))}
              />
              <input
                className="input"
                type="number"
                min={0}
                placeholder="Duration (seconds)"
                value={lecture.duration_seconds}
                onChange={(e) => setLecture((l) => ({ ...l, duration_seconds: e.target.value }))}
              />
              <textarea
                className="input"
                rows={2}
                placeholder="Transcript (powers AI tutor in Phase 3)"
                value={lecture.transcript}
                onChange={(e) => setLecture((l) => ({ ...l, transcript: e.target.value }))}
              />
            </div>
            <button
              className="btn-primary mt-3"
              disabled={!lecture.module_id || !lecture.title || addLecture.isPending}
              onClick={() => addLecture.mutate()}
            >
              Add lecture
            </button>
          </Card>

          {/* Quiz builder */}
          <Card>
            <h3 className="mb-3 font-semibold">3️⃣ Build a quiz (auto-graded)</h3>
            <div className="mb-3 grid gap-3 sm:grid-cols-2">
              <select
                className="input"
                value={quiz.module_id}
                onChange={(e) => setQuiz((q) => ({ ...q, module_id: e.target.value }))}
                aria-label="Quiz module"
              >
                <option value="">— module —</option>
                {modules.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}
              </select>
              <input
                className="input"
                placeholder="Quiz title"
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
                      placeholder={`Question ${qi + 1}`}
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
                      aria-label="Question type"
                    >
                      <option value="mcq">MCQ</option>
                      <option value="multi_select">Multi-select</option>
                      <option value="short_answer">Short answer</option>
                    </select>
                    {questions.length > 1 && (
                      <button
                        className="btn-secondary"
                        onClick={() => setQuestions((qs) => qs.filter((_, i) => i !== qi))}
                        aria-label={`Remove question ${qi + 1}`}
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
                            aria-label={`Mark option ${oi + 1} correct`}
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
                          + Add option
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-3 flex gap-2">
              <button className="btn-secondary" onClick={() => setQuestions((qs) => [...qs, emptyQuestion()])}>
                + Question
              </button>
              <button
                className="btn-primary"
                disabled={!quiz.module_id || !quiz.title || createQuiz.isPending}
                onClick={() => createQuiz.mutate()}
              >
                {createQuiz.isPending ? 'Creating…' : 'Create quiz'}
              </button>
            </div>
          </Card>

          {/* Assignment */}
          <Card>
            <h3 className="mb-3 font-semibold">4️⃣ Create an assignment</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                className="input"
                placeholder="Title"
                value={assignment.title}
                onChange={(e) => setAssignment((a) => ({ ...a, title: e.target.value }))}
              />
              <input
                className="input"
                type="datetime-local"
                value={assignment.due_date}
                onChange={(e) => setAssignment((a) => ({ ...a, due_date: e.target.value }))}
                aria-label="Due date"
              />
              <textarea
                className="input sm:col-span-2"
                rows={3}
                placeholder="Instructions / rubric"
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
              Create assignment
            </button>
          </Card>

          {/* Announcement (FR-I6) */}
          <Card>
            <h3 className="mb-3 font-semibold">📣 Post an announcement</h3>
            <div className="flex gap-2">
              <textarea
                className="input flex-1"
                rows={2}
                placeholder="Message to all enrolled students (in-app + email)…"
                value={announcement}
                onChange={(e) => setAnnouncement(e.target.value)}
                aria-label="Announcement content"
              />
              <button
                className="btn-primary self-end"
                disabled={!announcement.trim() || postAnnouncement.isPending}
                onClick={() => postAnnouncement.mutate()}
              >
                {postAnnouncement.isPending ? 'Posting…' : 'Post'}
              </button>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
