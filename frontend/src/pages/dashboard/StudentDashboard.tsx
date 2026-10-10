import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, apiErrorMessage } from '../../services/api';
import { useAppSelector } from '../../store/hooks';
import { Alert, Card, ProgressBar, Spinner } from '../../components/common/ui';
import { Badge, Certificate, Enrollment, Streak } from '../../utils/types';
import { useI18n } from '../../utils/i18n';

export default function StudentDashboard() {
  const { t } = useI18n();
  const user = useAppSelector((s) => s.auth.user);
  const accessToken = useAppSelector((s) => s.auth.accessToken);

  /** Authenticated PDF download (the endpoint requires a Bearer token). */
  const downloadCertificate = async (certId: string) => {
    try {
      const res = await api.get(`/certificates/${certId}/download`, {
        responseType: 'blob',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const url = URL.createObjectURL(res.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = `certificate-${certId}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(apiErrorMessage(err));
    }
  };

  const { data, isLoading, error } = useQuery({
    queryKey: ['enrollments', 'me'],
    queryFn: async () => (await api.get<{ items: Enrollment[] }>('/enrollments/me')).data,
  });

  const streak = useQuery({
    queryKey: ['streak'],
    queryFn: async () => (await api.get<Streak>('/users/me/streak')).data,
  });

  const badges = useQuery({
    queryKey: ['badges'],
    queryFn: async () => (await api.get<{ items: Badge[] }>('/users/me/badges')).data,
  });

  const certificates = useQuery({
    queryKey: ['certificates'],
    queryFn: async () => (await api.get<{ items: Certificate[] }>('/users/me/certificates')).data,
  });

  const recommendations = useQuery({
    queryKey: ['recommendations'],
    queryFn: async () =>
      (
        await api.get<{
          items: {
            course_id: string;
            title: string;
            difficulty: string | null;
            instructor_name: string;
            score: number;
            reason: string;
          }[];
        }>('/ai/recommendations')
      ).data,
  });

  const enrollments = data?.items ?? [];
  const avgProgress = enrollments.length
    ? enrollments.reduce((sum, e) => sum + Number(e.progress_percent), 0) / enrollments.length
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">
            {t('dashboard.welcome', { name: user?.full_name?.split(' ')[0] ?? '' })}
          </h1>
          <p className="text-sm text-slate-500">{t('dashboard.subtitle')}</p>
        </div>
        <div className="card flex items-center gap-6 py-3">
          <div>
            <div className="text-xs uppercase text-slate-400">{t('dashboard.coursesCount')}</div>
            <div className="text-xl font-bold">{enrollments.length}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-slate-400">{t('dashboard.avgProgress')}</div>
            <div className="text-xl font-bold">{Math.round(avgProgress)}%</div>
          </div>
          <div>
            <div className="text-xs uppercase text-slate-400">{t('dashboard.streak')}</div>
            <div className="text-xl font-bold">🔥 {streak.data?.current_streak ?? 0}</div>
          </div>
        </div>
      </div>

      {error && <Alert>{apiErrorMessage(error)}</Alert>}

      {badges.data && badges.data.items.length > 0 && (
        <section aria-label={t('dashboard.badges')}>
          <h2 className="mb-2 text-sm font-semibold uppercase text-slate-400">
            {t('dashboard.badgesEarned')}
          </h2>
          <div className="flex flex-wrap gap-2">
            {badges.data.items.map((b) => (
              <span
                key={b.id}
                title={b.description ?? b.name}
                className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200"
              >
                🏅 {b.name.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        </section>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : enrollments.length === 0 ? (
        <Card className="text-center">
          <p className="mb-4 text-slate-500">{t('dashboard.noCourses')}</p>
          <Link to="/catalog" className="btn-primary">{t('dashboard.browseCatalog')}</Link>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">            {enrollments.map((e) => (
            <Link key={e.id} to={`/catalog/${e.course_id}`} className="card transition hover:shadow-md">
              <div className="mb-2 flex items-start justify-between gap-2">
                <h2 className="font-semibold">{e.title}</h2>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs uppercase dark:bg-slate-800">
                  {e.difficulty ?? '—'}
                </span>
              </div>
              <p className="mb-3 text-sm text-slate-500">{e.instructor_name}</p>
              <ProgressBar percent={Number(e.progress_percent)} />
              <p className="mt-1 text-xs text-slate-400">
                {t('dashboard.percentComplete', { value: Number(e.progress_percent) })}
              </p>
            </Link>
          ))}
        </div>
      )}

      {recommendations.data && recommendations.data.items.length > 0 && (
        <section aria-label={t('dashboard.recommended')}>
          <h2 className="mb-3 text-lg font-semibold">💡 {t('dashboard.recommended')}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recommendations.data.items.map((r) => (
              <Link key={r.course_id} to={`/catalog/${r.course_id}`} className="card transition hover:shadow-md">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold">{r.title}</h3>
                  <span className="shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-slate-800 dark:text-brand-100">
                    {Math.round(r.score)}%
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">{r.reason}</p>
                <p className="mt-2 text-xs text-slate-400">{r.instructor_name}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {certificates.data && certificates.data.items.length > 0 && (
        <section aria-label={t('dashboard.certificates')}>
          <h2 className="mb-3 text-lg font-semibold">🎓 {t('dashboard.certificates')}</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {certificates.data.items.map((cert) => (
              <Card key={cert.id} className="flex items-center justify-between">
                <div>
                  <div className="font-medium">{cert.course_title}</div>
                  <div className="text-xs text-slate-400">
                    {t('dashboard.issuedOn', {
                      date: new Date(cert.issued_at).toLocaleDateString(),
                    })}
                  </div>
                </div>
                <a
                  className="btn-secondary"
                  href={`${import.meta.env.VITE_API_BASE_URL ?? '/api/v1'}/certificates/${cert.id}/download`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => {
                    // Attach bearer token for the download request
                    e.preventDefault();
                    void downloadCertificate(cert.id);
                  }}
                >
                  {t('dashboard.downloadPdf')}
                </a>
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
