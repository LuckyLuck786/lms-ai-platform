import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiErrorMessage } from '../../services/api';
import { Alert, Card, Spinner } from '../../components/common/ui';
import { useI18n } from '../../utils/i18n';

interface CourseDeck {
  course_id: string;
  course_title: string;
  total: number;
  new: number;
  due: number;
  modules_without_cards: string[];
}

interface StudyCard {
  id: string;
  question: string;
  answer: string;
  module_title: string;
  course_title: string;
  state: 'new' | 'review';
}

type Rating = 'again' | 'hard' | 'good' | 'easy';
const RATINGS: { value: Rating; key: string; hintKey: string }[] = [
  { value: 'again', key: 'review.again', hintKey: 'review.againHint' },
  { value: 'hard', key: 'review.hard', hintKey: 'review.hardHint' },
  { value: 'good', key: 'review.good', hintKey: 'review.goodHint' },
  { value: 'easy', key: 'review.easy', hintKey: 'review.easyHint' },
];

/**
 * Flashcard revision on a spaced-repetition schedule. Cards answered well come
 * back after longer and longer gaps (1 day, 6 days, then growing); missed
 * cards come back in ten minutes.
 */
export default function Review() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [courseId, setCourseId] = useState<string>('');
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decks = useQuery({
    queryKey: ['flashcards', 'summary'],
    queryFn: async () => (await api.get<{ items: CourseDeck[]; due: number; new: number }>('/users/me/flashcards')).data,
  });

  const queue = useQuery({
    queryKey: ['flashcards', 'due', courseId],
    queryFn: async () =>
      (await api.get<{ items: StudyCard[] }>('/users/me/flashcards/due', { params: courseId ? { course_id: courseId } : {} }))
        .data,
  });

  const createCards = useMutation({
    mutationFn: async (deck: CourseDeck) => {
      for (const moduleId of deck.modules_without_cards) {
        await api.post(`/ai/modules/${moduleId}/flashcards`);
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['flashcards'] }),
    onError: (e) => setError(apiErrorMessage(e)),
  });

  const rate = useMutation({
    mutationFn: async ({ id, rating }: { id: string; rating: Rating }) =>
      (await api.post(`/flashcards/${id}/review`, { rating })).data,
    onSuccess: () => {
      setRevealed(false);
      queryClient.invalidateQueries({ queryKey: ['flashcards'] });
    },
    onError: (e) => setError(apiErrorMessage(e)),
  });

  if (decks.isLoading) return <Spinner />;
  const card = queue.data?.items[0];
  const remaining = queue.data?.items.length ?? 0;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <div className="eyebrow mb-1">{t('review.eyebrow')}</div>
        <h1 className="font-display text-3xl text-ink-950 dark:text-white">{t('review.title')}</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{t('review.subtitle')}</p>
      </div>
      {error && <Alert>{error}</Alert>}

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="deck">{t('review.course')}</label>
          <select id="deck" className="input w-72" value={courseId} onChange={(e) => { setCourseId(e.target.value); setRevealed(false); }}>
            <option value="">{t('review.allCourses')}</option>
            {decks.data?.items.map((d) => (
              <option key={d.course_id} value={d.course_id}>
                {d.course_title} — {t('review.counts', { due: d.due, new: d.new })}
              </option>
            ))}
          </select>
        </div>
      </div>

      {decks.data?.items
        .filter((d) => d.modules_without_cards.length > 0 && (!courseId || d.course_id === courseId))
        .map((d) => (
          <Card key={d.course_id} className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm">{t('review.missingCards', { course: d.course_title, count: d.modules_without_cards.length })}</span>
            <button type="button" className="btn-secondary" disabled={createCards.isPending} onClick={() => createCards.mutate(d)}>
              {createCards.isPending ? t('review.creating') : t('review.createCards')}
            </button>
          </Card>
        ))}

      {queue.isLoading ? (
        <Spinner />
      ) : !card ? (
        <Card className="text-center">
          <h2 className="text-lg font-semibold">{t('review.done')}</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{t('review.doneHint')}</p>
          <Link to="/" className="btn-secondary mt-4 inline-flex">{t('nav.dashboard')}</Link>
        </Card>
      ) : (
        <Card>
          <div className="mb-3 flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
            <span>{card.course_title} · {card.module_title}</span>
            <span>{t('review.remaining', { count: remaining })}{card.state === 'new' ? ` · ${t('review.new')}` : ''}</span>
          </div>
          <p className="font-display text-xl text-ink-950 dark:text-white" aria-live="polite">{card.question}</p>
          {revealed ? (
            <>
              <div className="mt-4 rounded-md border border-slate-300/70 bg-paper-sunk p-4 dark:border-white/10 dark:bg-ink-800">
                <div className="eyebrow mb-1">{t('review.answer')}</div>
                <p>{card.answer}</p>
              </div>
              <p className="mt-4 text-sm text-slate-600 dark:text-slate-400">{t('review.howWell')}</p>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {RATINGS.map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    className={r.value === 'good' ? 'btn-primary' : 'btn-secondary'}
                    disabled={rate.isPending}
                    onClick={() => rate.mutate({ id: card.id, rating: r.value })}
                  >
                    <span className="flex flex-col items-center">
                      <span>{t(r.key)}</span>
                      <span className="text-[11px] font-normal opacity-90">{t(r.hintKey)}</span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <button type="button" className="btn-primary mt-6" onClick={() => setRevealed(true)}>
              {t('review.showAnswer')}
            </button>
          )}
        </Card>
      )}
    </div>
  );
}
