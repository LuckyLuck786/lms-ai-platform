import { useMutation } from '@tanstack/react-query';
import { api, apiErrorMessage } from '../../services/api';
import { useI18n } from '../../utils/i18n';
import Markdown from '../common/Markdown';

interface Explanation {
  explanation: string;
  sources: { lecture_id: string; lecture_title: string }[];
}

/**
 * "Explain my mistake" — asks the AI tutor why the learner's answer to one
 * question was wrong, grounded in the course's lectures. Results are cached
 * server-side, so asking again is instant.
 */
export default function ExplainMistake({ attemptId, questionId }: { attemptId: string; questionId: string }) {
  const { t } = useI18n();
  const explain = useMutation({
    mutationFn: async () =>
      (await api.post<Explanation>(`/ai/attempts/${attemptId}/questions/${questionId}/explain`)).data,
  });

  if (explain.data) {
    return (
      <div className="mt-2 rounded-md border border-slate-300/70 bg-paper-sunk p-3 text-sm dark:border-white/10 dark:bg-ink-800" role="region" aria-label={t('quiz.explanation')}>
        <div className="eyebrow mb-1">{t('quiz.explanation')}</div>
        <Markdown content={explain.data.explanation} />
        {explain.data.sources.length > 0 && (
          <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
            {t('quiz.reviewLectures')}: {explain.data.sources.map((s) => s.lecture_title).join(', ')}
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="mt-1">
      <button
        type="button"
        className="text-sm font-medium text-brand-700 hover:underline dark:text-brand-300"
        onClick={() => explain.mutate()}
        disabled={explain.isPending}
      >
        {explain.isPending ? t('quiz.explaining') : t('quiz.explainMistake')}
      </button>
      {explain.isError && <p className="mt-1 text-xs text-red-700 dark:text-red-400">{apiErrorMessage(explain.error)}</p>}
    </div>
  );
}
