import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, apiErrorMessage } from '../../services/api';
import { Alert, Spinner } from '../common/ui';

interface Props {
  lectureId: string;
  moduleId: string;
}

type Tab = 'summary' | 'flashcards' | 'quiz' | 'plan';

/**
 * One-click AI generation tools (FR-A3/A4/A5/A7): lecture summaries,
 * auto-generated quiz drafts, module flashcards, and a personalized
 * study plan from quiz history.
 */
export default function AiTools({ lectureId, moduleId }: Props) {
  const queryClient = useQueryClient();
  const [active, setActive] = useState<Tab | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [cards, setCards] = useState<{ question: string; answer: string }[] | null>(null);
  const [plan, setPlan] = useState<string[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      }>,
    onSuccess: (d) => {
      setActive('quiz');
      setError(null);
      setMessage(`Draft with ${d.question_count} questions created for instructor review.`);
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
    <section aria-label="AI tools" className="card">
      <h2 className="mb-3 font-semibold">🤖 AI tools</h2>
      {error && <div className="mb-3"><Alert>{error}</Alert></div>}

      <div className="flex flex-wrap gap-2">
        <button className="btn-secondary" disabled={pending} onClick={() => summarize.mutate()}>
          Summarize lecture
        </button>
        <button className="btn-secondary" disabled={pending} onClick={() => flashcards.mutate()}>
          Make flashcards
        </button>
        <button className="btn-secondary" disabled={pending} onClick={() => generateQuiz.mutate()}>
          Generate quiz draft
        </button>
        <button className="btn-secondary" disabled={pending} onClick={() => studyPlan.mutate()}>
          My study plan
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
            Refresh
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
              <div className="font-medium">Q: {c.question}</div>
              <div className="mt-1 text-slate-500">A: {c.answer}</div>
            </div>
          ))}
        </div>
      )}

      {active === 'plan' && plan && (
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
          {plan.map((line, i) => <li key={i}>{line}</li>)}
        </ol>
      )}
    </section>
  );
}
