import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiErrorMessage } from '../../services/api';
import { Alert, Card } from '../common/ui';
import { useI18n } from '../../utils/i18n';

interface LiveSession {
  id: string;
  title: string;
  starts_at: string;
  duration_minutes: number;
  window: 'early' | 'open' | 'ended';
  attended: boolean;
  join_url?: string;
  attendee_count?: number;
}

/**
 * Live classes for a course: the instructor schedules a session with a Meet /
 * Zoom / Teams link; learners join through the platform (which records
 * attendance) from 15 minutes before the start.
 */
export default function LiveClasses({ courseId, isOwner }: { courseId: string; isOwner: boolean }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ title: '', starts_at: '', duration_minutes: 60, join_url: '' });
  const [attendanceFor, setAttendanceFor] = useState<string | null>(null);

  const sessions = useQuery({
    queryKey: ['live', courseId],
    queryFn: async () => (await api.get<{ items: LiveSession[]; is_owner: boolean }>(`/courses/${courseId}/live-sessions`)).data,
    refetchInterval: 60_000, // the join window opens on its own
  });

  const attendance = useQuery({
    queryKey: ['live-attendance', attendanceFor],
    queryFn: async () =>
      (await api.get<{ items: { user_id: string; full_name: string; joined_at: string }[]; enrolled: number }>(
        `/live-sessions/${attendanceFor}/attendance`,
      )).data,
    enabled: Boolean(attendanceFor),
  });

  const schedule = useMutation({
    mutationFn: async () =>
      (await api.post(`/courses/${courseId}/live-sessions`, {
        ...form,
        starts_at: new Date(form.starts_at).toISOString(),
      })).data,
    onSuccess: () => {
      setForm({ title: '', starts_at: '', duration_minutes: 60, join_url: '' });
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['live', courseId] });
    },
    onError: (e) => setError(apiErrorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/live-sessions/${id}`)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['live', courseId] }),
    onError: (e) => setError(apiErrorMessage(e)),
  });

  const join = useMutation({
    mutationFn: async (id: string) => (await api.post<{ join_url: string }>(`/live-sessions/${id}/join`)).data,
    onSuccess: (d) => {
      window.open(d.join_url, '_blank', 'noopener,noreferrer');
      queryClient.invalidateQueries({ queryKey: ['live', courseId] });
    },
    onError: (e) => setError(apiErrorMessage(e)),
  });

  // Not enrolled (403) — the section simply does not apply.
  if (sessions.isError || !sessions.data) return null;
  const items = sessions.data.items;
  if (!isOwner && items.length === 0) return null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    schedule.mutate();
  };

  return (
    <section aria-label={t('live.title')} className="space-y-3">
      <h2 className="text-lg font-semibold">{t('live.title')}</h2>
      {error && <Alert>{error}</Alert>}
      {items.length === 0 && <p className="text-sm text-slate-600 dark:text-slate-400">{t('live.none')}</p>}
      {items.map((s) => (
        <Card key={s.id} className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-medium">{s.title}</div>
              <div className="text-sm text-slate-600 dark:text-slate-400">
                {new Date(s.starts_at).toLocaleString()} · {t('live.minutes', { count: s.duration_minutes })}
                {s.window === 'open' && <span className="chip ml-2">{t('live.liveNow')}</span>}
              </div>
            </div>
            {isOwner ? (
              <div className="flex flex-wrap gap-2">
                <a className="btn-secondary" href={s.join_url} target="_blank" rel="noreferrer">{t('live.openLink')}</a>
                <button type="button" className="btn-secondary" onClick={() => setAttendanceFor(attendanceFor === s.id ? null : s.id)}>
                  {t('live.attendance', { count: s.attendee_count ?? 0 })}
                </button>
                <button type="button" className="btn-secondary" disabled={remove.isPending} onClick={() => remove.mutate(s.id)}>
                  {t('live.cancel')}
                </button>
              </div>
            ) : s.window === 'open' ? (
              <button type="button" className="btn-primary" disabled={join.isPending} onClick={() => join.mutate(s.id)}>
                {t('live.join')}
              </button>
            ) : s.window === 'ended' ? (
              <span className="text-sm">{s.attended ? t('live.attended') : t('live.missed')}</span>
            ) : (
              <span className="text-sm text-slate-600 dark:text-slate-400">{t('live.opensSoon')}</span>
            )}
          </div>
          {isOwner && attendanceFor === s.id && attendance.data && (
            <div className="text-sm">
              <p className="mb-1">{t('live.attendanceSummary', { attended: attendance.data.items.length, enrolled: attendance.data.enrolled })}</p>
              <ul className="list-disc pl-5">
                {attendance.data.items.map((a) => (
                  <li key={a.user_id}>{a.full_name} — {new Date(a.joined_at).toLocaleTimeString()}</li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      ))}

      {isOwner && (
        <Card>
          <h3 className="mb-3 font-semibold">{t('live.schedule')}</h3>
          <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label" htmlFor="live-title">{t('live.sessionTitle')}</label>
              <input id="live-title" className="input" required minLength={3} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="live-start">{t('live.startsAt')}</label>
              <input id="live-start" className="input" type="datetime-local" required value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="live-duration">{t('live.duration')}</label>
              <input id="live-duration" className="input" type="number" min={5} max={600} required value={form.duration_minutes} onChange={(e) => setForm({ ...form, duration_minutes: Number(e.target.value) })} />
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="live-url">{t('live.link')}</label>
              <input id="live-url" className="input" type="url" required placeholder="https://meet.google.com/…" value={form.join_url} onChange={(e) => setForm({ ...form, join_url: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <button type="submit" className="btn-primary" disabled={schedule.isPending}>{t('live.scheduleButton')}</button>
            </div>
          </form>
        </Card>
      )}
    </section>
  );
}
