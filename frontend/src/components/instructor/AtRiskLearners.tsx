import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiErrorMessage } from '../../services/api';
import { Alert, Card, Spinner } from '../common/ui';
import { useI18n } from '../../utils/i18n';

interface AtRiskLearner {
  user_id: string;
  full_name: string;
  progress: number;
  daysInactive: number;
  avgScore: number | null;
  reasons: ('inactive' | 'low_scores' | 'stalled')[];
  last_nudged_at: string | null;
}

/**
 * Learners who look likely to drop out — inactive for a week, failing quizzes,
 * or stalled early — with a one-click nudge (in-app notification + email).
 */
export default function AtRiskLearners({ courseId }: { courseId: string }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const list = useQuery({
    queryKey: ['at-risk', courseId],
    queryFn: async () =>
      (await api.get<{ items: AtRiskLearner[]; enrolled: number }>(`/courses/${courseId}/at-risk`)).data,
    enabled: Boolean(courseId),
  });

  const nudge = useMutation({
    mutationFn: async (userId: string) =>
      (await api.post(`/courses/${courseId}/learners/${userId}/nudge`, { message })).data,
    onSuccess: () => {
      setStatus({ kind: 'success', text: t('atRisk.sent') });
      setOpen(null);
      queryClient.invalidateQueries({ queryKey: ['at-risk', courseId] });
    },
    onError: (e) => setStatus({ kind: 'error', text: apiErrorMessage(e) }),
  });

  const reasonText = (l: AtRiskLearner, r: AtRiskLearner['reasons'][number]) =>
    r === 'inactive'
      ? t('atRisk.inactive', { days: l.daysInactive })
      : r === 'low_scores'
        ? t('atRisk.lowScores', { score: l.avgScore ?? 0 })
        : t('atRisk.stalled', { progress: Math.round(l.progress) });

  return (
    <Card>
      <h3 className="mb-1 font-semibold">{t('atRisk.title')}</h3>
      <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">{t('atRisk.hint')}</p>
      {status && <div className="mb-3"><Alert kind={status.kind}>{status.text}</Alert></div>}
      {list.isLoading ? (
        <Spinner />
      ) : list.isError ? (
        <Alert>{apiErrorMessage(list.error)}</Alert>
      ) : !list.data?.items.length ? (
        <p className="text-sm">{t('atRisk.none', { count: list.data?.enrolled ?? 0 })}</p>
      ) : (
        <ul className="divide-y divide-slate-300/70 dark:divide-white/10">
          {list.data.items.map((l) => (
            <li key={l.user_id} className="py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-medium">{l.full_name}</div>
                  <ul className="mt-1 flex flex-wrap gap-2">
                    {l.reasons.map((r) => (
                      <li key={r} className="chip-gold">{reasonText(l, r)}</li>
                    ))}
                  </ul>
                  {l.last_nudged_at && (
                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                      {t('atRisk.lastNudged', { date: new Date(l.last_nudged_at).toLocaleDateString() })}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setStatus(null);
                    setOpen(open === l.user_id ? null : l.user_id);
                    setMessage(t('atRisk.template', { name: l.full_name.split(' ')[0] }));
                  }}
                >
                  {t('atRisk.nudge')}
                </button>
              </div>
              {open === l.user_id && (
                <div className="mt-3 space-y-2">
                  <label className="label" htmlFor={`nudge-${l.user_id}`}>{t('atRisk.message')}</label>
                  <textarea
                    id={`nudge-${l.user_id}`}
                    className="input min-h-[80px]"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={nudge.isPending || message.trim().length < 5}
                    onClick={() => nudge.mutate(l.user_id)}
                  >
                    {t('atRisk.send')}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
