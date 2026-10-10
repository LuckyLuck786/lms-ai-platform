import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiErrorMessage } from '../../services/api';
import { Alert, Card, Spinner } from '../../components/common/ui';
import { AttemptSubmission, Quiz } from '../../utils/types';
import { useI18n } from '../../utils/i18n';

type Selections = Record<string, string[]>; // question_id -> option_ids

/**
 * Student quiz-taking UI (FR-S7): MCQ radio, multi-select checkboxes,
 * short-answer text; submits once for auto-grading and shows the score.
 */
export default function QuizTake() {
  const { t } = useI18n();
  const { quizId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selections, setSelections] = useState<Selections>({});
  const [textAnswers, setTextAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<AttemptSubmission | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const quiz = useQuery({
    queryKey: ['quiz', quizId],
    queryFn: async () => (await api.get<Quiz>(`/quizzes/${quizId}`)).data,
    enabled: !!quizId,
  });

  const answeredCount = useMemo(
    () =>
      (quiz.data?.questions ?? []).filter((q) =>
        q.question_type === 'short_answer'
          ? (textAnswers[q.id] ?? '').trim().length > 0
          : (selections[q.id] ?? []).length > 0,
      ).length,
    [quiz.data, selections, textAnswers],
  );

  const submit = useMutation({
    mutationFn: async () => {
      const attempt = await api.post<{ id: string }>(`/quizzes/${quizId}/attempt`, {});
      const answers: {
        question_id: string;
        selected_option_ids?: string[];
        text_answer?: string;
      }[] = [];
      for (const q of quiz.data?.questions ?? []) {
        if (q.question_type === 'short_answer') {
          const text = (textAnswers[q.id] ?? '').trim();
          if (text) answers.push({ question_id: q.id, text_answer: text });
        } else {
          const selected = selections[q.id] ?? [];
          if (selected.length) answers.push({ question_id: q.id, selected_option_ids: selected });
        }
      }
      const { data } = await api.post<AttemptSubmission>(`/attempts/${attempt.data.id}/submit`, {
        answers,
      });
      return data;
    },
    onSuccess: (data) => {
      setResult(data);
      setFormError(null);
      queryClient.invalidateQueries({ queryKey: ['enrollments', 'me'] });
    },
    onError: (err) => setFormError(apiErrorMessage(err)),
  });

  if (quiz.isLoading) return <div className="flex justify-center py-12"><Spinner /></div>;
  if (quiz.error) return <Alert>{apiErrorMessage(quiz.error)}</Alert>;
  if (!quiz.data) return null;

  const toggleOption = (questionId: string, optionId: string, type: string) => {
    setSelections((prev) => {
      const current = prev[questionId] ?? [];
      if (type === 'mcq') return { ...prev, [questionId]: [optionId] };
      return {
        ...prev,
        [questionId]: current.includes(optionId)
          ? current.filter((x) => x !== optionId)
          : [...current, optionId],
      };
    });
  };

  if (result) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Card className="text-center">
          <h1 className="text-xl font-bold">{quiz.data.title}</h1>
          <div className="my-6 text-5xl font-bold">
            {result.score === null ? '—' : `${result.score}%`}
          </div>
          {result.score !== null && (
            <p className="text-slate-500">
              {result.score >= 70
                ? `🎉 ${t('quiz.passed')}!`
                : t('quiz.keepPractising')}
            </p>
          )}
          <div className="mt-6 flex justify-center gap-3">
            <button className="btn-secondary" onClick={() => navigate(-1)}>
              {t('quiz.backToCourse')}
            </button>
          </div>
        </Card>
        <Card>
          <h2 className="mb-3 font-semibold">{t('quiz.perQuestion')}</h2>
          <ul className="space-y-2 text-sm">
            {quiz.data.questions.map((q, i) => {
              const outcome = result.per_question.find((p) => p.question_id === q.id);
              return (
                <li key={q.id} className="flex items-start justify-between gap-3">
                  <span>
                    {i + 1}. {q.question_text}
                  </span>
                  <span
                    className={
                      outcome?.is_correct === null
                        ? 'text-slate-400'
                        : outcome?.is_correct
                          ? 'text-emerald-600'
                          : 'text-red-500'
                    }
                  >
                    {outcome?.is_correct === null ? t('quiz.ungraded') : outcome?.is_correct ? '✓' : '✕'}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{quiz.data.title}</h1>
        <span className="text-sm text-slate-500">
          {t('quiz.answered', {
            answered: answeredCount,
            total: quiz.data.questions.length,
          })}
        </span>
      </div>

      {formError && <Alert>{formError}</Alert>}

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit.mutate();
        }}
      >
        {quiz.data.questions.map((q, i) => (
          <Card key={q.id}>
            <div className="mb-3 flex items-start justify-between gap-2">
              <h2 className="font-semibold">
                {i + 1}. {q.question_text}
              </h2>
              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs uppercase dark:bg-slate-800">
                {q.question_type === 'mcq'
                  ? t('quiz.typeSingle')
                  : q.question_type === 'multi_select'
                    ? t('quiz.typeMulti')
                    : t('quiz.typeWritten')}
              </span>
            </div>

            {q.question_type === 'short_answer' ? (
              <textarea
                className="input"
                rows={4}
                placeholder={t('quiz.shortAnswerPlaceholder')}
                value={textAnswers[q.id] ?? ''}
                onChange={(e) => setTextAnswers((p) => ({ ...p, [q.id]: e.target.value }))}
                aria-label={t('quiz.answerFor', { number: i + 1 })}
              />
            ) : (
              <fieldset>
                <legend className="sr-only">{q.question_text}</legend>
                <div className="space-y-2">
                  {q.options.map((o) => (
                    <label
                      key={o.id}
                      className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                    >
                      <input
                        type={q.question_type === 'mcq' ? 'radio' : 'checkbox'}
                        name={`q-${q.id}`}
                        checked={(selections[q.id] ?? []).includes(o.id)}
                        onChange={() => toggleOption(q.id, o.id, q.question_type)}
                      />
                      {o.option_text}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
          </Card>
        ))}

        <button type="submit" className="btn-primary w-full" disabled={submit.isPending}>
          {submit.isPending ? t('quiz.grading') : t('quiz.submit')}
        </button>
      </form>
    </div>
  );
}
