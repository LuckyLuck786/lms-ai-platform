import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiErrorMessage } from '../../services/api';
import { Alert, Spinner } from '../common/ui';
import { useI18n } from '../../utils/i18n';

interface Props {
  lectureId: string;
  moduleId: string;
  courseId: string;
}

interface MasteryRow {
  module_id: string;
  module_title: string;
  mastery_score: string | number;
  depth: string;
}

const DEPTH_COLOR: Record<string, string> = {
  beginner: 'bg-rose-500',
  intermediate: 'bg-amber-500',
  advanced: 'bg-emerald-500',
};

/**
 * One-click AI generation tools (FR-A3/A4/A5/A7): lecture summaries,
 * auto-generated quiz drafts, module flashcards, and a personalized
 * study plan from quiz history. Also surfaces the learner's topic-mastery
 * scores (FR-A8) that drive adaptive chat and quiz difficulty.
 */
type Tab = 'summary' | 'flashcards' | 'quiz' | 'plan';

export default function AiTools({ lectureId, moduleId, courseId }: Props) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [active, setActive] = useState<Tab | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [cards, setCards] = useState<{ question: string; answer: string }[] | null>(null);
  const [plan, setPlan] = useState<string[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // FR-A8: per-module mastery feeding adaptive chat + quiz difficulty.
  const mastery = useQuery({
    queryKey: ['mastery', courseId],
    queryFn: async () =>
      (await api.get<{ items: MasteryRow[] }>('/users/me/mastery', {
        params: { course_id: courseId },
      })).data,
  });

  const summarize = useMutation({
    mutationFn: async () => (await api.post(`/ai/lectures/${lectureId}/summarize`)).data,
    onSuccess: (d: { summary: string }) => {
      setActive('summary');
      setSummary(d.summary);
      setError(null);
    },
    onError: (e) => setError(apiErrorMessage(e)),
  });

  const flashcards = useMutation({
    mutationFn: async () => (await api.post(`/ai/modules/${moduleId}/flashcards`)).data,
    onSuccess: (d: { cards: { question: string; answer: string }[] }) => {
      setActive('flashcards');
      setCards(d.cards);
      setError(null);
    },
    onError: (e) => setError(apiErrorMessage(e)),
  });

  const generateQuiz = useMutation({
    mutationFn: async () =>
      (await api.post(`/ai/lectures/${lectureId}/generate-quiz`)).data as Promise<{
        quiz_id: string;
        question_count: number;
        difficulty?: string;
      }>,
    onSuccess: (d) => {
      setActive('quiz');
      setError(null);
      const difficulty = d.difficulty
        ? ` · ${t('ai.quizDifficulty', { level: t(`player.mode.${d.difficulty}`) })}`
        : '';
      setMessage(t('ai.quizDraftCreated', { count: d.question_count }) + difficulty);
      queryClient.invalidateQueries({ queryKey: ['course'] });
    },
    onError: (e) => setError(apiErrorMessage(e)),
  });

  const studyPlan = useMutation({
    mutationFn: async () => (await api.post('/ai/study-plan', {})).data,
    onSuccess: (d: { plan: { items: { module_title: string; reason: string; priority: string }[] } }) => {
      setActive('plan');
      setPlan(d.plan.items.map((i) => `${i.module_title} — ${i.reason}`));
      setError(null);
    },
    onError: (e) => setError(apiErrorMessage(e)),
  });

  const pending =
    summarize.isPending || flashcards.isPending || generateQuiz.isPending || studyPlan.isPending;

  return (
    <section aria-label={t('player.aiTools')} className="card">
      <h2 className="mb-3 font-semibold">🤖 {t('player.aiTools')}</h2>
      {error && <div className="mb-3"><Alert>{error}</Alert></div>}

      <div className="flex flex-wrap gap-2">
        <button className="btn-secondary" disabled={pending} onClick={() => summarize.mutate()}>
          {t('player.summarize')}
        </button>
        <button className="btn-secondary" disabled={pending} onClick={() => flashcards.mutate()}>
          {t('player.flashcards')}
        </button>
        <button className="btn-secondary" disabled={pending} onClick={() => generateQuiz.mutate()}>
          {t('ai.generateQuizDraft')}
        </button>
        <button className="btn-secondary" disabled={pending} onClick={() => studyPlan.mutate()}>
          {t('player.studyPlan')}
        </button>
      </div>

      {pending && <div className="mt-3"><Spinner /></div>}
      {message && active === 'quiz' && (
        <p className="mt-3 text-sm text-emerald-600">
          {message}{' '}
          <button
            className="underline"
            onClick={() => void queryClient.invalidateQueries({ queryKey: ['course'] })}
          >
            {t('ai.refresh')}
          </button>
        </p>
      )}

      {active === 'summary' && summary && (
        <div className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
          {summary}
        </div>
      )}

      {active === 'flashcards' && cards && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {cards.map((c, i) => (
            <div key={i} className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
              <div className="font-medium">{t('ai.questionPrefix')} {c.question}</div>
              <div className="mt-1 text-slate-500">{t('ai.answerPrefix')} {c.answer}</div>
            </div>
          ))}
        </div>
      )}

      {active === 'plan' && plan && (
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
          {plan.map((line, i) => <li key={i}>{line}</li>)}
        </ol>
      )}

      <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
          📊 {t('ai.topicMastery')}
        </h3>
        {mastery.isLoading ? (
          <Spinner className="h-4 w-4" />
        ) : (mastery.data?.items.length ?? 0) === 0 ? (
          <p className="text-xs text-slate-400">{t('ai.masteryEmpty')}</p>
        ) : (
          <ul className="space-y-1.5">
            {mastery.data!.items.map((row) => {
              const score = Math.max(0, Math.min(100, Number(row.mastery_score)));
              return (
                <li key={row.module_id} className="text-xs">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-slate-600 dark:text-slate-300">{row.module_title}</span>
                    <span className="shrink-0 font-medium">{score}%</span>
                  </div>
                  <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className={`h-1.5 rounded-full ${DEPTH_COLOR[row.depth] ?? 'bg-slate-400'}`}
                      style={{ width: `${score}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-1.5 text-[11px] text-slate-400">{t('ai.masteryHint')}</p>
      </div>
    </section>
  );
}
